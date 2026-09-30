-- S5 student activity backend only. Storage bytes and Postgres are separate commits.
begin;

alter table public.activities add column updated_at timestamptz,
  add column revision integer not null default 0;
alter table public.activities add constraint activities_revision_check check (
  (revision = 0 and updated_at is null) or (revision > 0 and updated_at is not null and updated_at >= created_at));
alter table public.activities drop constraint activities_photo_path_check;
alter table public.activities add constraint activities_photo_path_check check (
  photo_path = student_uid::text || '/' || id::text || '/proof'
  or photo_path ~ ('^' || student_uid::text || '/' || id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/proof$'));

-- A reservation is necessary to authorize exactly one immutable object, bind it
-- to a session, and tombstone discarded paths before Storage API deletion.
-- It is private lifecycle bookkeeping, never an incomplete public activity.
create table private.activity_proof_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  activity_id uuid not null,
  student_uid uuid not null references public.profiles(id) on delete restrict,
  attendance_session_id uuid not null,
  photo_path text not null unique,
  base_revision integer,
  state text not null default 'pending' check (state in ('pending','attached','retired','discarded')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '1 hour'),
  unique(student_uid,request_id),
  foreign key(attendance_session_id,student_uid) references public.attendance_sessions(id,student_uid) on delete restrict,
  check (base_revision is null or base_revision >= 0),
  check (photo_path = student_uid::text || '/' || activity_id::text || '/proof'
    or photo_path = student_uid::text || '/' || activity_id::text || '/' || id::text || '/proof')
);
create index activity_proof_cleanup_idx on private.activity_proof_uploads(state,expires_at);
alter table private.activity_proof_uploads enable row level security;
revoke all on private.activity_proof_uploads from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('activity-proofs','activity-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create function private.activity_student()
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  perform 1 from public.profiles where id=caller and role='student' and status='approved' for update;
  if not found then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
  return caller;
end; $$;

create function private.activity_content(category text,description text)
returns text language plpgsql set search_path = '' as $$
declare cleaned text := private.trim_text(description);
begin
  if category is null or category not in ('Programming / Development','IT Support','Hardware / Maintenance',
    'Documentation','Training / Seminar','Meeting','Administrative Work','Other') then
    raise exception using errcode='22023',message='INVALID_CATEGORY';
  end if;
  if cleaned is null or char_length(cleaned) not between 1 and 500 then
    raise exception using errcode='22023',message='INVALID_DESCRIPTION';
  end if;
  return cleaned;
end; $$;

create function private.activity_check_object(proof private.activity_proof_uploads)
returns void language plpgsql security definer set search_path = '' as $$
declare metadata jsonb;
begin
  -- Storage metadata is read-only here. No SQL writes/deletes to storage.objects.
  select o.metadata into metadata from storage.objects o where o.bucket_id='activity-proofs'
    and o.name=proof.photo_path and o.owner_id=proof.student_uid::text for share;
  if not found then raise exception using errcode='P0001',message='PROOF_REQUIRED'; end if;
  if metadata->>'mimetype' is null or metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp')
    or metadata->>'size' is null or (metadata->>'size') !~ '^[0-9]+$' then
    raise exception using errcode='22023',message='INVALID_PROOF';
  end if;
  if (metadata->>'size')::numeric not between 1 and 5242880 then
    raise exception using errcode='22023',message='INVALID_PROOF';
  end if;
end; $$;

-- request_id is a retry token, not an identity or authoritative record ID.
-- Reusing it returns the same reservation, never silently allocates a new activity.
create function public.activity_prepare(request_id uuid, existing_activity_id uuid default null)
returns table(upload_id uuid,activity_id uuid,attendance_session_id uuid,photo_path text,expires_at timestamptz,base_revision integer)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := private.activity_student(); ticket private.activity_proof_uploads;
  session_id uuid; target public.activities; new_id uuid := gen_random_uuid(); proof_id uuid := gen_random_uuid();
begin
  if request_id is null then raise exception using errcode='22023',message='REQUEST_ID_REQUIRED'; end if;
  select * into ticket from private.activity_proof_uploads p where p.student_uid=caller and p.request_id=activity_prepare.request_id for update;
  if found then
    if (existing_activity_id is null) <> (ticket.base_revision is null)
      or (existing_activity_id is not null and existing_activity_id <> ticket.activity_id) then
      raise exception using errcode='P0001',message='REQUEST_CONFLICT';
    end if;
  else
    if existing_activity_id is null then
      select id into session_id from public.attendance_sessions where student_uid=caller and time_out is null for update;
      if not found then raise exception using errcode='P0001',message='NO_OPEN_ATTENDANCE'; end if;
    else
      select * into target from public.activities where id=existing_activity_id and student_uid=caller for update;
      if not found then raise exception using errcode='P0001',message='ACTIVITY_NOT_FOUND'; end if;
      new_id := target.id; session_id := target.attendance_session_id;
    end if;
    insert into private.activity_proof_uploads(id,request_id,activity_id,student_uid,attendance_session_id,photo_path,base_revision)
      values(proof_id,request_id,new_id,caller,session_id,caller::text || '/' || new_id::text ||
        case when existing_activity_id is null then '/proof' else '/' || proof_id::text || '/proof' end,
        case when existing_activity_id is null then null else target.revision end) returning * into ticket;
  end if;
  return query select ticket.id,ticket.activity_id,ticket.attendance_session_id,ticket.photo_path,ticket.expires_at,ticket.base_revision;
end; $$;

create function public.activity_create(upload_id uuid,category text,description text)
returns public.activities language plpgsql security definer set search_path = '' as $$
declare caller uuid := private.activity_student(); ticket private.activity_proof_uploads;
  result public.activities; cleaned text := private.activity_content(category,description);
begin
  select * into ticket from private.activity_proof_uploads where id=upload_id and student_uid=caller for update;
  if not found or ticket.base_revision is not null then raise exception using errcode='P0001',message='INVALID_UPLOAD'; end if;
  select * into result from public.activities where id=ticket.activity_id and student_uid=caller;
  if found then
    if result.revision=0 and result.category=activity_create.category and result.description=cleaned and result.photo_path=ticket.photo_path then return result; end if;
    raise exception using errcode='P0001',message='ACTIVITY_ALREADY_EXISTS';
  end if;
  if ticket.state <> 'pending' or ticket.expires_at <= clock_timestamp() then raise exception using errcode='P0001',message='UPLOAD_EXPIRED_OR_DISCARDED'; end if;
  perform 1 from public.attendance_sessions where id=ticket.attendance_session_id and student_uid=caller and time_out is null for update;
  if not found then raise exception using errcode='P0001',message='NO_OPEN_ATTENDANCE'; end if;
  perform private.activity_check_object(ticket);
  insert into public.activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at)
    values(ticket.activity_id,caller,ticket.attendance_session_id,category,cleaned,ticket.photo_path,clock_timestamp()) returning * into result;
  update private.activity_proof_uploads set state='attached' where id=ticket.id;
  return result;
end; $$;

create function public.activity_edit(activity_id uuid,expected_revision integer,category text,description text,replacement_upload_id uuid default null)
returns public.activities language plpgsql security definer set search_path = '' as $$
declare caller uuid := private.activity_student(); target public.activities; ticket private.activity_proof_uploads;
  cleaned text := private.activity_content(category,description); next_path text;
begin
  select * into target from public.activities where id=activity_id and student_uid=caller for update;
  if not found then raise exception using errcode='P0001',message='ACTIVITY_NOT_FOUND'; end if;
  if expected_revision is null or target.revision <> expected_revision then raise exception using errcode='P0001',message='ACTIVITY_CHANGED'; end if;
  next_path := target.photo_path;
  if replacement_upload_id is not null then
    select * into ticket from private.activity_proof_uploads where id=replacement_upload_id and student_uid=caller for update;
    if not found or ticket.activity_id<>target.id or ticket.attendance_session_id<>target.attendance_session_id
      or ticket.base_revision is distinct from target.revision then raise exception using errcode='P0001',message='INVALID_UPLOAD'; end if;
    if ticket.state <> 'pending' or ticket.expires_at <= clock_timestamp() then raise exception using errcode='P0001',message='UPLOAD_EXPIRED_OR_DISCARDED'; end if;
    perform private.activity_check_object(ticket);
    next_path := ticket.photo_path;
    update private.activity_proof_uploads set state='retired' where photo_path=target.photo_path and state='attached';
    update private.activity_proof_uploads set state='attached' where id=ticket.id;
  end if;
  update public.activities set category=activity_edit.category,description=cleaned,photo_path=next_path,
    updated_at=clock_timestamp(),revision=revision+1 where id=target.id returning * into target;
  return target;
end; $$;

-- Tombstone first, then delete bytes through Storage API. Never delete an active
-- proof or a public activity. A discarded reservation cannot be finalized/reused.
create function public.activity_discard_proof(upload_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare caller uuid := private.activity_student(); ticket private.activity_proof_uploads;
begin
  select * into ticket from private.activity_proof_uploads where id=upload_id and student_uid=caller for update;
  if not found then raise exception using errcode='P0001',message='INVALID_UPLOAD'; end if;
  if ticket.state='attached' or exists(select 1 from public.activities where photo_path=ticket.photo_path) then
    raise exception using errcode='P0001',message='PROOF_IN_USE';
  end if;
  update private.activity_proof_uploads set state='discarded' where id=ticket.id;
  return ticket.photo_path;
end; $$;

create function private.activity_storage_allowed(object_name text,operation text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_student() and exists(select 1 from private.activity_proof_uploads p
    where p.student_uid=auth.uid() and p.photo_path=object_name and
      case operation when 'upload' then p.state='pending' and p.expires_at>statement_timestamp()
        when 'delete' then p.state='discarded' else false end);
$$;
create policy activity_proof_insert on storage.objects for insert to authenticated
  with check(bucket_id='activity-proofs' and owner_id=auth.uid()::text and private.activity_storage_allowed(name,'upload'));
create policy activity_proof_read on storage.objects for select to authenticated
  using(bucket_id='activity-proofs' and ((private.is_approved_student() and owner_id=auth.uid()::text
    and split_part(name,'/',1)=auth.uid()::text) or (private.is_approved_admin()
    and exists(select 1 from public.activities a where a.photo_path=name))));
create policy activity_proof_delete on storage.objects for delete to authenticated
  using(bucket_id='activity-proofs' and owner_id=auth.uid()::text and private.activity_storage_allowed(name,'delete'));
-- No UPDATE policy: overwrite/upsert/move of proof bytes is forbidden.

-- Bound history at the database API, keyset cursor stable across edits.
create function public.activity_history(page_size integer default 25,before_created_at timestamptz default null,before_id uuid default null)
returns setof public.activities language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  if not private.is_approved_student() then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
  if page_size is null or page_size not between 1 and 100 or (before_created_at is null) <> (before_id is null) then
    raise exception using errcode='22023',message='INVALID_PAGE';
  end if;
  return query select a.* from public.activities a where a.student_uid=auth.uid()
    and (before_created_at is null or (a.created_at,a.id)<(before_created_at,before_id))
    order by a.created_at desc,a.id desc limit page_size;
end; $$;

revoke all on function private.activity_student(),private.activity_content(text,text),private.activity_check_object(private.activity_proof_uploads),
  private.activity_storage_allowed(text,text) from public,anon,authenticated;
grant execute on function private.activity_storage_allowed(text,text) to authenticated;
revoke all on function public.activity_prepare(uuid,uuid),public.activity_create(uuid,text,text),
  public.activity_edit(uuid,integer,text,text,uuid),public.activity_discard_proof(uuid),public.activity_history(integer,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.activity_prepare(uuid,uuid),public.activity_create(uuid,text,text),
  public.activity_edit(uuid,integer,text,text,uuid),public.activity_discard_proof(uuid),public.activity_history(integer,timestamptz,uuid) to authenticated;
comment on table public.activities is 'S5: RPC-only create/edit; immutable identity/session/creation time; private immutable proof versions. No activity deletion.';
commit;
