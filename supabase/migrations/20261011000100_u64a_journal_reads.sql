begin;
-- Current activities only; no writes, AI state, or proof byte retrieval.
create function public.journal_activity_range(
 from_day date, to_day date, page_size integer default 50,
 after_created_at timestamptz default null, after_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare caller uuid:=auth.uid(); rows jsonb; more boolean; last_row jsonb;
begin
 if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
 if not private.is_approved_student() then raise exception using errcode='42501',message='APPROVED_STUDENT_REQUIRED'; end if;
 if from_day is null or to_day is null or from_day<date '2000-01-01' or to_day>date '2100-12-31'
 or to_day<from_day or to_day-from_day>30 then raise exception using errcode='22023',message='INVALID_JOURNAL_RANGE'; end if;
 if page_size is null or page_size not between 1 and 100 or (after_created_at is null)<>(after_id is null) then
 raise exception using errcode='22023',message='INVALID_JOURNAL_CURSOR'; end if;
 if after_id is not null and not exists(select 1 from public.activities a where a.student_uid=caller and a.id=after_id
 and a.created_at=after_created_at and a.created_at>=(from_day::timestamp at time zone 'Asia/Manila')
 and a.created_at<((to_day+1)::timestamp at time zone 'Asia/Manila')) then
 raise exception using errcode='22023',message='INVALID_JOURNAL_CURSOR'; end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb) into rows from
 (select id,created_at,category,description,revision,updated_at,photo_path,attendance_session_id
 from public.activities where student_uid=caller
 and created_at>=(from_day::timestamp at time zone 'Asia/Manila')
 and created_at<((to_day+1)::timestamp at time zone 'Asia/Manila')
 and (after_id is null or (created_at,id)>(after_created_at,after_id)) order by created_at,id limit page_size+1) a;
 more:=jsonb_array_length(rows)>page_size;
 if more then rows:=rows-page_size; end if;
 last_row:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('activities',rows,'next',case when more then
 jsonb_build_object('created_at',last_row->>'created_at','id',last_row->>'id') else null end);
end $$;
revoke all on function public.journal_activity_range(date,date,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.journal_activity_range(date,date,integer,timestamptz,uuid) to authenticated;
-- Existing (student_uid,created_at DESC,id DESC) index supports backward scan.
commit;
