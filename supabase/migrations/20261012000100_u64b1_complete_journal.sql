begin;
-- Complete Journal has no browser-supplied Student UID or arbitrary period.
create function public.journal_complete_period() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare caller uuid:=auth.uid(); first_day date; last_day date;
begin
 if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
 if not private.is_approved_student() then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
 select min(d),max(d) into first_day,last_day from (
 select ((select created_at from public.activities where student_uid=caller order by created_at,id limit 1) at time zone 'Asia/Manila')::date d
 union all select ((select created_at from public.activities where student_uid=caller order by created_at desc,id desc limit 1) at time zone 'Asia/Manila')::date
 union all select ((select time_in from public.attendance_sessions where student_uid=caller order by time_in,id limit 1) at time zone 'Asia/Manila')::date
 union all select ((select time_in from public.attendance_sessions where student_uid=caller order by time_in desc,id desc limit 1) at time zone 'Asia/Manila')::date
 ) bounds;
 if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day>3659 then
 raise exception using errcode='22023',message='JOURNAL_COMPLETE_TOO_LARGE'; end if;
 return jsonb_build_object('from',first_day,'to',last_day);
end $$;
create function public.journal_complete_activities(page_size integer default 100,after_created_at timestamptz default null,after_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare caller uuid:=auth.uid(); rows jsonb; more boolean; last_row jsonb;
begin
 if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
 if not private.is_approved_student() then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
 if page_size is null or page_size not between 1 and 100 or (after_created_at is null)<>(after_id is null) then
 raise exception using errcode='22023',message='INVALID_JOURNAL_CURSOR'; end if;
 if after_id is not null and not exists(select 1 from public.activities where student_uid=caller and id=after_id and created_at=after_created_at) then
 raise exception using errcode='22023',message='INVALID_JOURNAL_CURSOR'; end if;
 perform public.journal_complete_period();
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb) into rows from (
 select id,created_at,category,description,revision,updated_at,photo_path,attendance_session_id from public.activities
 where student_uid=caller and (after_id is null or (created_at,id)>(after_created_at,after_id)) order by created_at,id limit page_size+1) a;
 more:=jsonb_array_length(rows)>page_size;
 if more then rows:=rows-page_size; end if;
 last_row:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('activities',rows,'next',case when more then jsonb_build_object('created_at',last_row->>'created_at','id',last_row->>'id') else null end);
end $$;
create function public.journal_complete_attendance(day_limit integer default 31,before_day date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare caller uuid:=auth.uid(); result jsonb;
begin
 if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
 if not private.is_approved_student() then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
 if day_limit is null or day_limit not between 1 and 31 then raise exception using errcode='22023',message='INVALID_JOURNAL_CURSOR'; end if;
 if before_day is not null and not exists(select 1 from public.attendance_sessions where student_uid=caller and (time_in at time zone 'Asia/Manila')::date=before_day) then
 raise exception using errcode='22023',message='INVALID_JOURNAL_CURSOR'; end if;
 perform public.journal_complete_period();
 with selected_days as (
 select distinct (time_in at time zone 'Asia/Manila')::date start_day from public.attendance_sessions
 where student_uid=caller and (before_day is null or (time_in at time zone 'Asia/Manila')::date<before_day)
 order by start_day desc limit day_limit+1
 ), page as (select start_day from selected_days order by start_day desc limit day_limit), rows as (
 select s.id,s.time_in,s.time_out,(s.time_in at time zone 'Asia/Manila')::date start_day,
 row_number() over(partition by (s.time_in at time zone 'Asia/Manila')::date order by s.time_in,s.id) session_ordinal,
 case when s.time_out is null then 0::numeric else extract(epoch from(s.time_out-s.time_in)) end completed_seconds
 from public.attendance_sessions s join page p on (s.time_in at time zone 'Asia/Manila')::date=p.start_day where s.student_uid=caller order by s.time_in,s.id limit day_limit*2+1
 ), groups as (
 select r.start_day,sum(r.completed_seconds) completed_seconds,jsonb_agg(to_jsonb(r) order by r.time_in,r.id) sessions from rows r group by r.start_day
 ) select jsonb_build_object('days',coalesce((select jsonb_agg(to_jsonb(g) order by g.start_day desc) from groups g),'[]'::jsonb),
 'next_before_day',case when (select count(*) from selected_days)>day_limit then (select min(start_day) from page) else null end) into result;
 if exists(select 1 from jsonb_array_elements(result->'days') d where jsonb_array_length(d->'sessions')>2) then
 raise exception using errcode='22023',message='JOURNAL_COMPLETE_TOO_LARGE'; end if;
 return result;
end $$;
revoke all on function public.journal_complete_period(), public.journal_complete_activities(integer,timestamptz,uuid),public.journal_complete_attendance(integer,date) from public,anon,authenticated;
grant execute on function public.journal_complete_period(), public.journal_complete_activities(integer,timestamptz,uuid),public.journal_complete_attendance(integer,date) to authenticated;
commit;
