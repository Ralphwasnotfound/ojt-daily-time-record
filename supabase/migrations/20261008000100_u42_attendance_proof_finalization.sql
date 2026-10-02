-- U4.2 LOCAL backend enforcement. Deploy only with the U4.3 frontend cutover.
begin;

create function public.attendance_proof_finalize(upload_id uuid,latitude numeric,longitude numeric,accuracy numeric)
returns public.attendance_proofs language plpgsql security definer set search_path='' as $$
declare caller uuid:=private.attendance_proof_student(); ticket private.attendance_proof_uploads;
  receipt public.attendance_proofs; target public.attendance_sessions;
  current_open uuid; latest uuid; starts integer; punch_at timestamptz; today date; metadata jsonb;
begin
  -- Lock order: approved profile (helper above), reservation, existing session,
  -- Storage object. All attendance writers serialize on the profile first.
  select * into ticket from private.attendance_proof_uploads p
    where p.id=upload_id and p.student_uid=caller for update;
  if not found then raise exception using errcode='P0001',message='INVALID_UPLOAD'; end if;
  if latitude is null or not (latitude between -90 and 90)
    or longitude is null or not (longitude between -180 and 180)
    or accuracy is null or not (accuracy>=0 and accuracy<'Infinity'::numeric) then
    raise exception using errcode='22023',message='INVALID_LOCATION'; end if;

  -- Successful retries are independent of current attendance state and expiry.
  -- A changed request is not silently accepted as an edit to immutable evidence.
  if ticket.state='attached' then
    select * into receipt from public.attendance_proofs p where p.upload_id=ticket.id;
    if not found or receipt.student_uid<>caller or receipt.attendance_session_id<>ticket.attendance_session_id
      or receipt.action_type<>ticket.action_type or receipt.photo_path<>ticket.photo_path then
      raise exception using errcode='P0001',message='INVALID_ATTACHMENT'; end if;
    if (receipt.latitude,receipt.longitude,receipt.accuracy) is distinct from (latitude,longitude,accuracy) then
      raise exception using errcode='P0001',message='REQUEST_CONFLICT'; end if;
    return receipt;
  end if;
  if ticket.state<>'pending' or ticket.expires_at<=clock_timestamp() then
    raise exception using errcode='P0001',message='UPLOAD_EXPIRED_OR_DISCARDED'; end if;
  if ticket.action_type not in ('time_in','time_out') then
    raise exception using errcode='22023',message='INVALID_ACTION'; end if;
  select * into target from public.attendance_sessions s
    where s.student_uid=caller and s.time_out is null for update;
  current_open:=target.id;
  select s.id into latest from public.attendance_sessions s where s.student_uid=caller order by s.time_in desc,s.id desc limit 1;

  -- Storage bytes are uploaded first. Only read/lock metadata here; never delete
  -- objects with SQL or treat Storage API deletion as part of this transaction.
  select o.metadata into metadata from storage.objects o where o.bucket_id='attendance-proofs'
    and o.name=ticket.photo_path and o.owner_id=caller::text for share;
  if not found then raise exception using errcode='P0001',message='PROOF_REQUIRED'; end if;
  if coalesce(metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp')
    or coalesce(metadata->>'size','') !~ '^[0-9]+$' then
    raise exception using errcode='22023',message='INVALID_PROOF'; end if;
  if (metadata->>'size')::numeric not between 1 and 5242880 then
    raise exception using errcode='22023',message='INVALID_PROOF'; end if;

  -- One official timestamp, after locks. Neither request start nor capture time.
  punch_at:=clock_timestamp();
  if ticket.expires_at<=punch_at then raise exception using errcode='P0001',message='UPLOAD_EXPIRED_OR_DISCARDED'; end if;
  today:=(punch_at at time zone 'Asia/Manila')::date;
  select count(*) into starts from public.attendance_sessions s where s.student_uid=caller
    and (s.time_in at time zone 'Asia/Manila')::date=today;
  if ticket.action_type='time_in' then
    if current_open is not null then raise exception using errcode='P0001',message='ALREADY_TIMED_IN'; end if;
    if starts>=2 then raise exception using errcode='P0001',message='DAILY_ATTENDANCE_LIMIT_REACHED'; end if;
    if ticket.expected_latest_session_id is distinct from latest
      or ticket.prepared_manila_day<>today or ticket.expected_starts_today<>starts then
      raise exception using errcode='P0001',message='ATTENDANCE_STATE_CHANGED'; end if;
    insert into public.attendance_sessions(id,student_uid,time_in)
      values(ticket.attendance_session_id,caller,punch_at);
  else
    if current_open is distinct from ticket.attendance_session_id
      or ticket.expected_latest_session_id is distinct from latest then
      raise exception using errcode='P0001',message='ATTENDANCE_STATE_CHANGED'; end if;
    if punch_at<target.time_in then raise exception using errcode='P0001',message='ATTENDANCE_CLOCK_INVALID'; end if;
    -- Legacy open sessions need no fabricated Time In proof.
    update public.attendance_sessions set time_out=punch_at where id=target.id and student_uid=caller and time_out is null;
  end if;
  insert into public.attendance_proofs(attendance_session_id,student_uid,action_type,photo_path,upload_id,
    official_punch_at,latitude,longitude,accuracy)
  values(ticket.attendance_session_id,caller,ticket.action_type,ticket.photo_path,ticket.id,punch_at,latitude,longitude,accuracy)
  returning * into receipt;
  -- U4.1 INSERT/AFTER triggers validate evidence and mark the reservation attached.
  -- Any trigger/constraint failure rolls back the attendance mutation as well.
  if not exists(select 1 from private.attendance_proof_uploads p where p.id=ticket.id and p.state='attached') then
    raise exception using errcode='P0001',message='INVALID_ATTACHMENT'; end if;
  return receipt;
end; $$;
revoke all on function public.attendance_proof_finalize(uuid,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.attendance_proof_finalize(uuid,numeric,numeric,numeric) to authenticated;

-- No browser compatibility bypass. Retain legacy implementations only for trusted
-- maintenance/historical fixture setup, not PostgREST authenticated/anon clients.
revoke all on function public.attendance_time_in(),public.attendance_time_out() from public,anon,authenticated;
comment on function public.attendance_time_in() is 'U4.2 retired browser RPC: EXECUTE revoked. Proof-backed finalization required.';
comment on function public.attendance_time_out() is 'U4.2 retired browser RPC: EXECUTE revoked. Legacy open sessions close via proof finalization.';
comment on function public.attendance_proof_finalize(uuid,numeric,numeric,numeric) is 'U4.2 atomic punch/proof/attachment. Retry same upload and coordinates returns immutable receipt. LOCAL rollout gate: U4.3 UI required before deployment.';
comment on table public.attendance_proofs is 'U4.2 immutable private evidence attached atomically with attendance; approved owner/Admin reads only.';
commit;
