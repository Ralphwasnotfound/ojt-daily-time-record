-- U4.1 LOCAL foundation only. No attendance mutation/finalization RPC or cutover.
begin;

create table private.attendance_proof_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  student_uid uuid not null references public.profiles(id) on delete restrict,
  action_type text not null check (action_type in ('time_in','time_out')),
  -- Time In preallocates this UUID; deliberately no FK to a not-yet-created row.
  attendance_session_id uuid not null,
  expected_latest_session_id uuid references public.attendance_sessions(id) on delete restrict,
  expected_starts_today integer not null check (expected_starts_today between 0 and 2),
  prepared_manila_day date not null,
  photo_path text not null unique,
  state text not null default 'pending' check (state in ('pending','attached','discarded')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  unique(student_uid,request_id),
  unique(id,student_uid,attendance_session_id,action_type,photo_path),
  check (expires_at > created_at),
  check (photo_path = student_uid::text || '/' || attendance_session_id::text || '/' || id::text || '/proof')
);
create index attendance_proof_upload_cleanup_idx on private.attendance_proof_uploads(state,expires_at);
alter table private.attendance_proof_uploads enable row level security;
revoke all on private.attendance_proof_uploads from public,anon,authenticated;

create table public.attendance_proofs (
  id uuid primary key default gen_random_uuid(),
  attendance_session_id uuid not null,
  student_uid uuid not null,
  action_type text not null check (action_type in ('time_in','time_out')),
  photo_path text not null unique,
  upload_id uuid not null unique,
  official_punch_at timestamptz not null,
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  -- No product accuracy threshold. Exclude NaN/infinity, allow any finite >= 0.
  accuracy numeric not null check (accuracy >= 0 and accuracy < 'Infinity'::numeric),
  attached_at timestamptz not null default clock_timestamp(),
  unique(attendance_session_id,action_type),
  foreign key(attendance_session_id,student_uid)
    references public.attendance_sessions(id,student_uid) on delete restrict,
  foreign key(upload_id,student_uid,attendance_session_id,action_type,photo_path)
    references private.attendance_proof_uploads(id,student_uid,attendance_session_id,action_type,photo_path) on delete restrict
);
create index attendance_proofs_student_idx on public.attendance_proofs(student_uid,attendance_session_id);
alter table public.attendance_proofs enable row level security;
revoke all on public.attendance_proofs from public,anon,authenticated;
grant select on public.attendance_proofs to authenticated;
create policy attendance_proofs_read on public.attendance_proofs for select to authenticated
  using ((student_uid=auth.uid() and private.is_approved_student()) or private.is_approved_admin());

-- Kept independent of Activity lifecycle helpers.
create function private.attendance_proof_student()
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid();
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  perform 1 from public.profiles where id=caller and role='student' and status='approved' for update;
  if not found then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
  return caller;
end; $$;

create function public.attendance_proof_prepare(request_id uuid,action_type text)
returns table(upload_id uuid,attendance_session_id uuid,photo_path text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare caller uuid:=private.attendance_proof_student(); ticket private.attendance_proof_uploads;
  current_open uuid; latest uuid; starts integer; today date; current_time_value timestamptz:=clock_timestamp();
  reservation_id uuid:=gen_random_uuid(); target_session uuid;
begin
  if request_id is null then raise exception using errcode='22023',message='REQUEST_ID_REQUIRED'; end if;
  if action_type is null or action_type not in ('time_in','time_out') then
    raise exception using errcode='22023',message='INVALID_ACTION'; end if;
  today:=(current_time_value at time zone 'Asia/Manila')::date;
  select s.id into current_open from public.attendance_sessions s where s.student_uid=caller and s.time_out is null;
  select s.id into latest from public.attendance_sessions s where s.student_uid=caller order by s.time_in desc,s.id desc limit 1;
  select count(*) into starts from public.attendance_sessions s where s.student_uid=caller
    and (s.time_in at time zone 'Asia/Manila')::date=today;
  select * into ticket from private.attendance_proof_uploads p
    where p.student_uid=caller and p.request_id=attendance_proof_prepare.request_id for update;
  if found then
    if ticket.action_type<>action_type then raise exception using errcode='P0001',message='REQUEST_CONFLICT'; end if;
    if ticket.state<>'pending' or ticket.expires_at<=current_time_value then
      raise exception using errcode='P0001',message='UPLOAD_EXPIRED_OR_DISCARDED'; end if;
    if ticket.expected_latest_session_id is distinct from latest
      or (action_type='time_in' and (current_open is not null or ticket.prepared_manila_day<>today or ticket.expected_starts_today<>starts))
      or (action_type='time_out' and ticket.attendance_session_id is distinct from current_open) then
      raise exception using errcode='P0001',message='ATTENDANCE_STATE_CHANGED'; end if;
  else
    if action_type='time_in' then
      if current_open is not null then raise exception using errcode='P0001',message='ALREADY_TIMED_IN'; end if;
      if starts>=2 then raise exception using errcode='P0001',message='DAILY_ATTENDANCE_LIMIT_REACHED'; end if;
      target_session:=gen_random_uuid();
    else
      if current_open is null then raise exception using errcode='P0001',message='NO_OPEN_ATTENDANCE'; end if;
      target_session:=current_open;
    end if;
    insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,
      expected_latest_session_id,expected_starts_today,prepared_manila_day,photo_path,created_at,expires_at)
    values(reservation_id,request_id,caller,action_type,target_session,latest,starts,today,
      caller::text || '/' || target_session::text || '/' || reservation_id::text || '/proof',current_time_value,current_time_value+interval '1 hour')
    returning * into ticket;
  end if;
  return query select ticket.id,ticket.attendance_session_id,ticket.photo_path,ticket.expires_at;
end; $$;

-- Identity/intent never changes; terminal states cannot be revived. Future U4.2
-- INSERT of proof marks attachment through the private trigger below.
create function private.attendance_upload_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state')
    or old.state<>'pending' and new.state<>old.state then
    raise exception using errcode='P0001',message='IMMUTABLE_UPLOAD'; end if;
  if new.state='attached' and not exists(select 1 from public.attendance_proofs p where p.upload_id=new.id) then
    raise exception using errcode='P0001',message='PROOF_REQUIRED'; end if;
  return new;
end; $$;
create trigger attendance_upload_guard before update on private.attendance_proof_uploads
  for each row execute function private.attendance_upload_guard();

create function public.attendance_proof_discard(upload_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare caller uuid:=private.attendance_proof_student(); ticket private.attendance_proof_uploads;
begin
  select * into ticket from private.attendance_proof_uploads p where p.id=upload_id and p.student_uid=caller for update;
  if not found then raise exception using errcode='P0001',message='INVALID_UPLOAD'; end if;
  if ticket.state='attached' or exists(select 1 from public.attendance_proofs p where p.upload_id=ticket.id) then
    raise exception using errcode='P0001',message='PROOF_IN_USE'; end if;
  update private.attendance_proof_uploads set state='discarded' where id=ticket.id;
  return ticket.photo_path;
end; $$;

-- Defense in depth for future trusted insertion. This does NOT punch attendance:
-- a matching authoritative session timestamp must already exist in the same tx.
create function private.attendance_proof_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare ticket private.attendance_proof_uploads; official timestamptz; object_metadata jsonb;
begin
  if tg_op<>'INSERT' then raise exception using errcode='P0001',message='IMMUTABLE_ATTENDANCE_PROOF'; end if;
  select * into ticket from private.attendance_proof_uploads p where p.id=new.upload_id for update;
  if not found or ticket.student_uid<>new.student_uid or ticket.attendance_session_id<>new.attendance_session_id
    or ticket.action_type<>new.action_type or ticket.photo_path<>new.photo_path then
    raise exception using errcode='P0001',message='INVALID_UPLOAD'; end if;
  if ticket.state<>'pending' or ticket.expires_at<=clock_timestamp() then
    raise exception using errcode='P0001',message='UPLOAD_EXPIRED_OR_DISCARDED'; end if;
  select case new.action_type when 'time_in' then s.time_in else s.time_out end into official
    from public.attendance_sessions s where s.id=new.attendance_session_id and s.student_uid=new.student_uid for share;
  if official is null or official is distinct from new.official_punch_at then
    raise exception using errcode='P0001',message='INVALID_OFFICIAL_PUNCH'; end if;
  select o.metadata into object_metadata from storage.objects o where o.bucket_id='attendance-proofs'
    and o.name=new.photo_path and o.owner_id=new.student_uid::text for share;
  if not found then raise exception using errcode='P0001',message='PROOF_REQUIRED'; end if;
  if coalesce(object_metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp')
    or coalesce(object_metadata->>'size','') !~ '^[0-9]+$' then
    raise exception using errcode='22023',message='INVALID_PROOF'; end if;
  if (object_metadata->>'size')::numeric not between 1 and 5242880 then
    raise exception using errcode='22023',message='INVALID_PROOF'; end if;
  new.attached_at:=clock_timestamp();
  return new;
end; $$;
create trigger attendance_proof_immutable before insert or update or delete on public.attendance_proofs
  for each row execute function private.attendance_proof_guard();
create function private.attendance_proof_attach()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update private.attendance_proof_uploads set state='attached' where id=new.upload_id;
  return new;
end; $$;
create trigger attendance_proof_attach after insert on public.attendance_proofs
  for each row execute function private.attendance_proof_attach();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('attendance-proofs','attendance-proofs',false,5242880,array['image/jpeg','image/png','image/webp']);

create function private.attendance_proof_storage_allowed(object_name text,operation text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when operation='read' and private.is_approved_admin() then
      exists(select 1 from public.attendance_proofs p where p.photo_path=object_name)
    when private.is_approved_student() then exists(
      select 1 from private.attendance_proof_uploads p where p.student_uid=auth.uid() and p.photo_path=object_name
      and case operation
        when 'upload' then p.state='pending' and p.expires_at>statement_timestamp()
        when 'read' then true -- own reserved bytes, including discard/delete reconciliation
        when 'delete' then p.state='discarded' and not exists(select 1 from public.attendance_proofs a where a.upload_id=p.id)
        else false end)
    else false end;
$$;
create policy attendance_proof_insert on storage.objects for insert to authenticated
  with check(bucket_id='attendance-proofs' and owner_id=auth.uid()::text and private.attendance_proof_storage_allowed(name,'upload'));
create policy attendance_proof_read on storage.objects for select to authenticated
  using(bucket_id='attendance-proofs' and private.attendance_proof_storage_allowed(name,'read'));
create policy attendance_proof_delete on storage.objects for delete to authenticated
  using(bucket_id='attendance-proofs' and owner_id=auth.uid()::text and private.attendance_proof_storage_allowed(name,'delete'));
-- No UPDATE policy. No proof/location publication. Existing attendance RPCs untouched.
revoke all on function private.attendance_proof_student(),private.attendance_upload_guard(),
  private.attendance_proof_guard(),private.attendance_proof_attach(),private.attendance_proof_storage_allowed(text,text)
  from public,anon,authenticated;
grant execute on function private.attendance_proof_storage_allowed(text,text) to authenticated;
revoke all on function public.attendance_proof_prepare(uuid,text),public.attendance_proof_discard(uuid) from public,anon,authenticated;
grant execute on function public.attendance_proof_prepare(uuid,text),public.attendance_proof_discard(uuid) to authenticated;
comment on table public.attendance_proofs is 'U4.1 immutable private evidence. No browser insertion or punch finalization yet; official attendance remains attendance_sessions.';
comment on table private.attendance_proof_uploads is 'U4.1 intent only, not attendance. Pending expiry is time-based. Discard before Storage API deletion; orphan worker deferred.';
commit;
