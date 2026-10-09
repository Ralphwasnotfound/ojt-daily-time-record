-- U7.5F.3E LOCAL ONLY. Read-only observations; never a mutation retry/reset permit.
begin;

-- Requires a migration administrator authorized to grant auth schema/uid access.
-- A reserved fresh role: a collision must stop migration rather than reuse privileges.
create role attendance_recovery_reader nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls;
grant attendance_recovery_reader to postgres;
grant usage on schema public,private,storage,auth to attendance_recovery_reader;
grant select(id,role,status) on public.profiles to attendance_recovery_reader;
grant select(id,request_id,student_uid,action_type,attendance_session_id,photo_path,state,expires_at)
  on private.attendance_proof_uploads to attendance_recovery_reader;
grant select(id,student_uid,upload_id,attendance_session_id,action_type,photo_path,official_punch_at,attached_at)
  on public.attendance_proofs to attendance_recovery_reader;
grant select(bucket_id,name,owner_id,metadata) on storage.objects to attendance_recovery_reader;
grant execute on function auth.uid() to attendance_recovery_reader;
do $$ begin
  if not pg_catalog.has_schema_privilege('attendance_recovery_reader','auth','USAGE')
    or not pg_catalog.has_function_privilege('attendance_recovery_reader','auth.uid()','EXECUTE')
    or not pg_catalog.has_column_privilege('attendance_recovery_reader','storage.objects','metadata','SELECT') then
    raise exception using errcode='42501',message='RECOVERY_READER_PRIVILEGES_REQUIRED';
  end if;
end; $$;

-- Role-specific SELECT only; no authenticated/private-table access or Storage writes.
create policy recovery_reader_profile on public.profiles for select to attendance_recovery_reader
  using(id=auth.uid());
create policy recovery_reader_reservation on private.attendance_proof_uploads for select to attendance_recovery_reader
  using(student_uid=auth.uid());
create policy recovery_reader_receipt on public.attendance_proofs for select to attendance_recovery_reader
  using(student_uid=auth.uid());
create policy recovery_reader_object on storage.objects for select to attendance_recovery_reader
  using(bucket_id='attendance-proofs' and exists(
    select 1 from private.attendance_proof_uploads p
    where p.student_uid=auth.uid() and p.photo_path=storage.objects.name));

-- Explicit pg_temp LAST also prevents untrusted temporary TYPE shadowing; an
-- empty search_path implicitly searches pg_temp first for relation/type names.
-- STABLE makes all reads use the caller statement's snapshot. No FOR UPDATE,
-- mutation helpers, dynamic SQL, sequences, Storage bytes or external effects.
create function private.attendance_recovery_snapshot(request_id uuid,upload_id uuid,check_object boolean)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,pg_temp as $$
declare
  caller uuid:=auth.uid(); observed timestamptz:=pg_catalog.statement_timestamp();
  ticket record; object_row record; proof record;
  answer jsonb; reserved jsonb; receipt jsonb:=null;
  object_status text:='not_checked'; receipt_status text:='missing';
  object_count bigint; receipt_count bigint; size_text text;
begin
  if caller is null then
    raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles p where p.id=caller and p.role='student' and p.status='approved') then
    raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
  if request_id is null or check_object is null or (check_object and upload_id is null) then
    raise exception using errcode='22023',message='RECOVERY_ID_REQUIRED'; end if;
  answer:=pg_catalog.jsonb_build_object('contract_version',1,'observed_at',observed,
    'student_uid',caller,'request_id',request_id,'lookup_status','not_found',
    'reservation',null,'object_status','not_checked','receipt_status','unknown','receipt',null);
  select p.id,p.request_id,p.student_uid,p.action_type,p.attendance_session_id,p.photo_path,p.state,p.expires_at
    into ticket from private.attendance_proof_uploads p
    where p.student_uid=caller and p.request_id=attendance_recovery_snapshot.request_id;
  -- No foreign-identity oracle, including when an upload argument is supplied.
  if not found then return answer; end if;
  if check_object and ticket.id<>upload_id then
    raise exception using errcode='22023',message='RECOVERY_IDENTITY_MISMATCH'; end if;
  if not pg_catalog.isfinite(ticket.expires_at) or ticket.photo_path<>caller::text||'/'||ticket.attendance_session_id::text||'/'||ticket.id::text||'/proof'
    or ticket.action_type not in ('time_in','time_out') or ticket.state not in ('pending','attached','discarded') then
    return answer||pg_catalog.jsonb_build_object('lookup_status','unknown','object_status','unknown'); end if;
  reserved:=pg_catalog.jsonb_build_object('upload_id',ticket.id,'attendance_session_id',ticket.attendance_session_id,
    'action_type',ticket.action_type,'state',ticket.state,'expires_at',ticket.expires_at,'expired',ticket.expires_at<=observed);

  select pg_catalog.count(*) into receipt_count from public.attendance_proofs p
    where p.student_uid=caller and p.upload_id=ticket.id;
  if receipt_count>1 then
    return answer||pg_catalog.jsonb_build_object('lookup_status','unknown','object_status','unknown'); end if;
  if receipt_count=1 then
    select p.id,p.student_uid,p.upload_id,p.attendance_session_id,p.action_type,p.photo_path,p.official_punch_at,p.attached_at
      into proof from public.attendance_proofs p where p.student_uid=caller and p.upload_id=ticket.id;
    if ticket.state<>'attached' or proof.attendance_session_id<>ticket.attendance_session_id
      or proof.action_type<>ticket.action_type or proof.photo_path<>ticket.photo_path
      or not pg_catalog.isfinite(proof.official_punch_at) or not pg_catalog.isfinite(proof.attached_at)
      or proof.attached_at<proof.official_punch_at then
      return answer||pg_catalog.jsonb_build_object('lookup_status','unknown','object_status','unknown'); end if;
    receipt_status:='confirmed';
    receipt:=pg_catalog.jsonb_build_object('id',proof.id,'student_uid',proof.student_uid,'upload_id',proof.upload_id,
      'attendance_session_id',proof.attendance_session_id,'action_type',proof.action_type,
      'official_punch_at',proof.official_punch_at,'attached_at',proof.attached_at);
  elsif ticket.state='attached' then
    return answer||pg_catalog.jsonb_build_object('lookup_status','unknown','object_status','unknown');
  end if;

  if check_object then
    select pg_catalog.count(*) into object_count from storage.objects o
      where o.bucket_id='attendance-proofs' and o.name=ticket.photo_path;
    object_status:='missing';
    if object_count>1 then object_status:='unknown';
    elsif object_count=1 then
      select o.owner_id,o.metadata into object_row from storage.objects o
        where o.bucket_id='attendance-proofs' and o.name=ticket.photo_path;
      object_status:='invalid'; size_text:=object_row.metadata->>'size';
      -- Bound text before regexp/cast; accept finite integer metadata only.
      if object_row.owner_id=caller::text and object_row.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
        and pg_catalog.length(size_text) between 1 and 32 then
        if size_text ~ '^[0-9]+$' then
          if size_text::numeric between 1 and 5242880 then object_status:='present'; end if;
        end if;
      end if;
    end if;
  end if;
  return answer||pg_catalog.jsonb_build_object('lookup_status','found','reservation',reserved,
    'object_status',object_status,'receipt_status',receipt_status,'receipt',receipt);
end; $$;

create function public.attendance_proof_recovery_lookup(request_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select private.attendance_recovery_snapshot(request_id,null::uuid,false);
$$;
create function public.attendance_proof_recovery_upload_status(request_id uuid,upload_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select private.attendance_recovery_snapshot(request_id,upload_id,true);
$$;

-- Owner transfer requires temporary CREATE; revoke it and role membership afterward.
grant create on schema public,private to attendance_recovery_reader;
alter function private.attendance_recovery_snapshot(uuid,uuid,boolean) owner to attendance_recovery_reader;
alter function public.attendance_proof_recovery_lookup(uuid) owner to attendance_recovery_reader;
alter function public.attendance_proof_recovery_upload_status(uuid,uuid) owner to attendance_recovery_reader;
revoke create on schema public,private from attendance_recovery_reader;
revoke all on function private.attendance_recovery_snapshot(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.attendance_proof_recovery_lookup(uuid),
  public.attendance_proof_recovery_upload_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.attendance_proof_recovery_lookup(uuid),
  public.attendance_proof_recovery_upload_status(uuid,uuid) to authenticated;
comment on function public.attendance_proof_recovery_lookup(uuid) is
  'Read-only own approved-student snapshot. NOT_FOUND cannot rule out a delayed prepare. Never permits retry/reset.';
comment on function public.attendance_proof_recovery_upload_status(uuid,uuid) is
  'Read-only own reserved-object metadata. MISSING can become PRESENT; PRESENT is not an attendance punch. No retry/reset.';
revoke attendance_recovery_reader from postgres;
commit;
