begin;
-- Read-only student summaries; identity is profiles.id, never a display string.
create function public.admin_activity_students(page_size integer default 25,after_id uuid default null,
 search text default '',category_filter text default '',attendance_status text default '',on_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if page_size is null or page_size not between 1 and 100 or search is null or length(search)>100
 or category_filter is null or attendance_status is null or attendance_status not in ('','IN','OUT') then
   raise exception using errcode='22023',message='INVALID_PAGE';
 end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from (
   select p.id,p.full_name,p.student_id,
     exists(select 1 from public.attendance_sessions t where t.student_uid=p.id and t.time_out is null) is_in,
     totals.total_activities,totals.total_edits,totals.matching_activities,totals.latest_activity_at
   from public.profiles p
   cross join lateral (
     select count(*) total_activities,coalesce(sum(a.revision::bigint),0) total_edits,max(a.created_at) latest_activity_at,
       count(*) filter(where (category_filter='' or a.category=category_filter)
         and (on_day is null or (a.created_at >= (on_day::timestamp at time zone 'Asia/Manila')
           and a.created_at < ((on_day+1)::timestamp at time zone 'Asia/Manila')))) matching_activities
     from public.activities a where a.student_uid=p.id
   ) totals
   where p.role='student' and (after_id is null or p.id>after_id)
     and (search='' or strpos(lower(p.full_name),lower(search))>0 or strpos(lower(p.student_id),lower(search))>0)
     and (attendance_status='' or exists(select 1 from public.attendance_sessions t where t.student_uid=p.id and t.time_out is null)=(attendance_status='IN'))
     and totals.matching_activities>0
   order by p.id limit page_size
 )s);
end; $$;
revoke all on function public.admin_activity_students(integer,uuid,text,text,text,date) from public,anon,authenticated;
grant execute on function public.admin_activity_students(integer,uuid,text,text,text,date) to authenticated;
comment on function public.admin_activity_students(integer,uuid,text,text,text,date) is
 'S7 student-first monitor: bounded UID pages, all-time authoritative activity/revision totals, matching category/Manila submission-day counts. Approved Admin read only.';
commit;
