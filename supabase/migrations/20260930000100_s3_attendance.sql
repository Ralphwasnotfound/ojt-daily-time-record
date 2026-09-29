-- S3 only. Existing S1 indexes, RLS and direct-write denial remain unchanged.
begin;

create function public.attendance_time_in()
returns public.attendance_sessions language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  started_at timestamptz;
  result public.attendance_sessions;
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  -- Both write RPCs take this same lock before reading attendance. The lock also
  -- prevents approval revocation from racing a successful attendance write.
  perform 1 from public.profiles p where p.id = caller
    and p.role = 'student' and p.status = 'approved' for update;
  if not found then raise exception using errcode = '42501', message = 'APPROVED_STUDENT_REQUIRED'; end if;
  if exists (select 1 from public.attendance_sessions s where s.student_uid = caller and s.time_out is null) then
    raise exception using errcode = 'P0001', message = 'ALREADY_TIMED_IN';
  end if;
  -- Capture after waiting for the lock, not at transaction/request start.
  started_at := clock_timestamp();
  if exists (select 1 from public.attendance_sessions s where s.student_uid = caller
    and (s.time_in at time zone 'Asia/Manila')::date = (started_at at time zone 'Asia/Manila')::date) then
    raise exception using errcode = 'P0001', message = 'ALREADY_STARTED_TODAY';
  end if;
  insert into public.attendance_sessions(student_uid, time_in)
    values (caller, started_at) returning * into result;
  return result;
end;
$$;

create function public.attendance_time_out()
returns public.attendance_sessions language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  ended_at timestamptz;
  result public.attendance_sessions;
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  perform 1 from public.profiles p where p.id = caller
    and p.role = 'student' and p.status = 'approved' for update;
  if not found then raise exception using errcode = '42501', message = 'APPROVED_STUDENT_REQUIRED'; end if;
  select s.* into result from public.attendance_sessions s
    where s.student_uid = caller and s.time_out is null for update;
  if not found then raise exception using errcode = 'P0001', message = 'NO_OPEN_ATTENDANCE'; end if;
  ended_at := clock_timestamp();
  if ended_at < result.time_in then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CLOCK_INVALID';
  end if;
  update public.attendance_sessions s set time_out = ended_at
    where s.id = result.id and s.student_uid = caller and s.time_out is null
    returning s.* into result;
  -- S1 has no stored duration: exact completed duration is time_out - time_in.
  return result;
end;
$$;

-- Read-only, own-account snapshot for S4. Invoker security preserves S1 RLS.
create function public.attendance_summary()
returns table(open_session_id uuid, open_time_in timestamptz, started_today boolean,
  completed_seconds numeric, completed_sessions bigint)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  if not exists (select 1 from public.profiles p where p.id = caller
    and p.role = 'student' and p.status = 'approved') then
    raise exception using errcode = '42501', message = 'APPROVED_STUDENT_REQUIRED';
  end if;
  return query
    select
      (select s.id from public.attendance_sessions s where s.student_uid = caller and s.time_out is null),
      (select s.time_in from public.attendance_sessions s where s.student_uid = caller and s.time_out is null),
      exists (select 1 from public.attendance_sessions s where s.student_uid = caller
        and (s.time_in at time zone 'Asia/Manila')::date = (statement_timestamp() at time zone 'Asia/Manila')::date),
      coalesce(sum(extract(epoch from (s.time_out - s.time_in))), 0::numeric),
      count(*)
    from public.attendance_sessions s where s.student_uid = caller and s.time_out is not null;
end;
$$;

revoke all on function public.attendance_time_in(), public.attendance_time_out(), public.attendance_summary()
  from public, anon, authenticated;
grant execute on function public.attendance_time_in(), public.attendance_time_out(), public.attendance_summary()
  to authenticated;
comment on table public.attendance_sessions is 'S3: writes only through approved-student RPCs; profile row lock serializes writes. Current state and exact completed duration derive from timestamps.';
comment on function public.attendance_summary() is 'Own approved-student RLS snapshot. Totals exclude open sessions, retain fractional seconds, and do not round individual sessions.';
commit;
