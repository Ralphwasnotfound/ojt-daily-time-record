-- U3 forward-only attendance evolution. No historical rows are rewritten.
begin;
drop index public.attendance_one_start_per_manila_day_idx;
create index attendance_student_manila_day_idx on public.attendance_sessions
 (student_uid, ((time_in at time zone 'Asia/Manila')::date));
create or replace function public.attendance_time_in()
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
  if (select count(*) from public.attendance_sessions s where s.student_uid = caller
    and (s.time_in at time zone 'Asia/Manila')::date = (started_at at time zone 'Asia/Manila')::date) >= 2 then
    raise exception using errcode = 'P0001', message = 'DAILY_ATTENDANCE_LIMIT_REACHED';
  end if;
  insert into public.attendance_sessions(student_uid, time_in)
    values (caller, started_at) returning * into result;
  return result;
end;
$$;


-- Derived ordinals are computed over the complete day, before any pagination.
create view private.attendance_ordered as
select s.*, (time_in at time zone 'Asia/Manila')::date start_day,
 row_number() over(partition by student_uid,(time_in at time zone 'Asia/Manila')::date order by time_in,id) session_ordinal,
 case when time_out is null then 0::numeric else extract(epoch from(time_out-time_in)) end completed_seconds
from public.attendance_sessions s;
revoke all on private.attendance_ordered from public,anon,authenticated;

-- Keep summary invoker security: query the RLS-protected table directly.
-- No CASCADE; an unexpected dependency must stop the migration.
drop function public.attendance_summary();
create function public.attendance_summary()
returns table(open_session_id uuid,open_time_in timestamptz,started_today boolean,
 completed_seconds numeric,completed_sessions bigint,manila_day date,starts_today bigint,
 next_action text,today_sessions jsonb,open_session_ordinal bigint,
 today_completed_seconds numeric,days_present bigint)
language plpgsql stable security invoker set search_path='' as $$
declare caller uuid:=auth.uid(); today date:=(statement_timestamp() at time zone 'Asia/Manila')::date;
begin
 if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
 if not exists(select 1 from public.profiles p where p.id=caller and p.role='student' and p.status='approved') then
  raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
 return query with rows as (
  select s.*, (s.time_in at time zone 'Asia/Manila')::date start_day,
   row_number() over(partition by (s.time_in at time zone 'Asia/Manila')::date order by s.time_in,s.id) session_ordinal
  from public.attendance_sessions s where s.student_uid=caller
 ), totals as (
 select count(*) filter(where r.start_day=today) starts,
 coalesce(sum(extract(epoch from(r.time_out-r.time_in))) filter(where r.time_out is not null),0) seconds,
 count(*) filter(where r.time_out is not null) completed,
 coalesce(sum(extract(epoch from(r.time_out-r.time_in))) filter(where r.start_day=today and r.time_out is not null),0) today_seconds,
 count(distinct r.start_day) days from rows r
 )
 select o.id,o.time_in,t.starts>0,t.seconds,t.completed,today,t.starts,
 case when o.id is not null then 'time_out' when t.starts<2 then 'time_in' else 'none' end,
 coalesce((select jsonb_agg(to_jsonb(r) order by r.time_in,r.id) from rows r where r.start_day=today),'[]'::jsonb),
 o.session_ordinal,t.today_seconds,t.days from totals t left join rows o on o.time_out is null;
end; $$;
revoke all on function public.attendance_summary() from public,anon,authenticated;
grant execute on function public.attendance_summary() to authenticated;

-- Internal reader has no browser EXECUTE grant. Public wrappers authorize first.
create function private.attendance_days(target uuid,day_limit integer,before_day date,on_day date)
returns jsonb language sql stable security definer set search_path='' as $$
 with selected_days as (
 select distinct a.start_day from private.attendance_ordered a where a.student_uid=target
 and (before_day is null or a.start_day<before_day) and (on_day is null or a.start_day=on_day)
 order by a.start_day desc limit day_limit+1
 ), page as (select start_day from selected_days order by start_day desc limit day_limit),
 groups as (
 select a.start_day, sum(a.completed_seconds) completed_seconds,
 jsonb_agg(to_jsonb(a) order by a.time_in,a.id) sessions
 from private.attendance_ordered a join page p using(start_day) where a.student_uid=target group by a.start_day
 )
 select jsonb_build_object('days',coalesce((select jsonb_agg(to_jsonb(g) order by g.start_day desc) from groups g),'[]'),
 'next_before_day',case when (select count(*) from selected_days)>day_limit then (select min(start_day) from page) else null end);
$$;
revoke all on function private.attendance_days(uuid,integer,date,date) from public,anon,authenticated;
create function public.attendance_days(day_limit integer default 15,before_day date default null,on_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_approved_student() then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
 if day_limit is null or day_limit not between 1 and 31 then raise exception 'INVALID_PAGE'; end if;
 return private.attendance_days(auth.uid(),day_limit,before_day,on_day);
end; $$;
create function public.admin_attendance_days(target_uid uuid,day_limit integer default 15,before_day date default null,on_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if target_uid is null or day_limit is null or day_limit not between 1 and 31 then raise exception 'INVALID_PAGE'; end if;
 return private.attendance_days(target_uid,day_limit,before_day,on_day);
end; $$;
revoke all on function public.attendance_days(integer,date,date),public.admin_attendance_days(uuid,integer,date,date) from public,anon,authenticated;
grant execute on function public.attendance_days(integer,date,date),public.admin_attendance_days(uuid,integer,date,date) to authenticated;
commit;
