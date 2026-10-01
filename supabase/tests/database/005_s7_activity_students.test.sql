begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,email) select ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'monitor-'||n||'@example.invalid' from generate_series(1,6)n;
insert into public.profiles(id,full_name,email,role,status,approved_at) values('80000000-0000-4000-8000-000000000001','Monitor Admin','monitor-1@example.invalid','admin','approved',now());
insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
select id,'Same Name',email,'MON-'||right(id::text,1),'student',case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,
'BS Information Technology',486,case when right(id::text,1) in ('4','5') then null else now() end,
case when right(id::text,1) in ('4','5') then null else '80000000-0000-4000-8000-000000000001'::uuid end
from auth.users where id::text like '80000000-%' and right(id::text,1)<>'1';
insert into public.attendance_sessions(id,student_uid,time_in,time_out) values
('81000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','2026-01-01 00:00+00',null),
('81000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','2026-01-01 00:00+00','2026-01-01 01:00+00');
insert into public.activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at)
select ('82000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'80000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002',
case when n=2 then 'Documentation' else 'Other' end,'Activity '||n,
'80000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/proof',
case n when 1 then '2026-01-01 16:00+00'::timestamptz when 2 then '2026-01-02 15:59:59+00'::timestamptz when 3 then '2026-01-02 16:00+00'::timestamptz else '2026-01-01 15:59+00'::timestamptz end
from generate_series(1,27)n;
insert into public.activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at) values
('83000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','Other','Different student',
'80000000-0000-4000-8000-000000000003/83000000-0000-4000-8000-000000000001/proof','2026-01-01 16:00+00');
update public.activities set revision=revision+1,updated_at=clock_timestamp() where id in ('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002');
update public.activities set revision=revision+1,updated_at=clock_timestamp() where id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(public.admin_activity_students()),2,'one student per UID despite 28 activities and identical names');
select is((public.admin_activity_students()->0->>'id'),'80000000-0000-4000-8000-000000000002','stable first UID');
select is((public.admin_activity_students()->1->>'id'),'80000000-0000-4000-8000-000000000003','identical name remains separate UID');
select is((public.admin_activity_students()->0->>'total_activities')::bigint,27::bigint,'all-time activity count covers beyond one activity page');
select is((public.admin_activity_students()->0->>'total_edits')::bigint,3::bigint,'all-time edit count sums authoritative revision');
select is((public.admin_activity_students()->0->>'matching_activities')::bigint,27::bigint,'unfiltered matching equals total');
select is(jsonb_array_length(public.admin_activity_students(1)),1,'student page is bounded');
select is((public.admin_activity_students(1,'80000000-0000-4000-8000-000000000002')->0->>'id'),'80000000-0000-4000-8000-000000000003','student cursor never splits same UID');
select is(jsonb_array_length(public.admin_activity_students(25,'80000000-0000-4000-8000-000000000003')),0,'end cursor empty');
select is(jsonb_array_length(public.admin_activity_students(25,null,'same name')),2,'server case insensitive name search');
select is(jsonb_array_length(public.admin_activity_students(25,null,'mon-2')),1,'server Student ID search');
select is(jsonb_array_length(public.admin_activity_students(25,null,'MON-6')),0,'students without activities excluded');
select is(jsonb_array_length(public.admin_activity_students(25,null,'','Documentation')),1,'category qualifies students by any matching activity');
select is((public.admin_activity_students(25,null,'','Documentation')->0->>'matching_activities')::bigint,1::bigint,'category matching count');
select is((public.admin_activity_students(25,null,'','Documentation')->0->>'total_activities')::bigint,27::bigint,'category leaves all-time total intact');
select is((public.admin_activity_students(25,null,'','Documentation')->0->>'total_edits')::bigint,3::bigint,'category leaves all-time edit total intact');
select is((public.admin_activity_students(25,null,'','','IN')->0->>'id'),'80000000-0000-4000-8000-000000000002','IN uses current open session');
select is((public.admin_activity_students(25,null,'','','OUT')->0->>'id'),'80000000-0000-4000-8000-000000000003','OUT uses current closed state');
select is((public.admin_activity_students(25,null,'MON-2','','','2026-01-02')->0->>'matching_activities')::bigint,2::bigint,'Manila day includes start and excludes next day boundary');
select is((public.admin_activity_students(25,null,'MON-2','Other','','2026-01-02')->0->>'matching_activities')::bigint,1::bigint,'combined category/date matches same activity');
select is(jsonb_array_length(public.admin_activity_students(25,null,'','Documentation','OUT','2026-01-02')),0,'all filters compose');
select is(jsonb_array_length(public.admin_activities(25,null,null,'80000000-0000-4000-8000-000000000002','','Other','IN','2026-01-02')),1,'expanded existing RPC shares matching semantics');
create temp table first_activity_page as select public.admin_activities(25,null,null,'80000000-0000-4000-8000-000000000002') rows;
select is(jsonb_array_length((select rows from first_activity_page)),25,'expanded large history bounded to 25');
select is(jsonb_array_length(public.admin_activities(25,((select rows from first_activity_page)->24->>'created_at')::timestamptz,((select rows from first_activity_page)->24->>'id')::uuid,'80000000-0000-4000-8000-000000000002')),2,'expanded next page gets remaining two activities');
select throws_ok($$select public.admin_activity_students(101)$$,'22023','INVALID_PAGE','page maximum enforced');
select throws_ok($$select public.admin_activity_students(0)$$,'22023','INVALID_PAGE','page minimum enforced');
select throws_ok($$select public.admin_activity_students(25,null,repeat('x',101))$$,'22023','INVALID_PAGE','search length bounded');
select throws_ok($$select public.admin_activity_students(25,null,'','','INVALID')$$,'22023','INVALID_PAGE','invalid attendance rejected');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_activity_students()$$,'42501','APPROVED_ADMIN_REQUIRED','student denied');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.admin_activity_students()$$,'42501','APPROVED_ADMIN_REQUIRED','pending denied');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.admin_activity_students()$$,'42501','APPROVED_ADMIN_REQUIRED','rejected denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.admin_activity_students()$$,'42501','APPROVED_ADMIN_REQUIRED','no identity denied');
set local role anon;
select throws_ok($$select public.admin_activity_students()$$,'42501',null,'anonymous cannot execute');
reset role;
select ok(prosecdef and provolatile='s' and 'search_path=""'=any(proconfig),'stable hardened read-only RPC') from pg_proc where oid='public.admin_activity_students(integer,uuid,text,text,text,date)'::regprocedure;
select ok(not has_function_privilege('anon','public.admin_activity_students(integer,uuid,text,text,text,date)','execute'),'no anon grant');
select is((select count(*)::integer from public.activities where student_uid::text like '80000000-%'),28,'reads never mutate activities');
select is((select count(*)::integer from public.activity_revisions where student_uid::text like '80000000-%'),31,'reads never mutate audit');
select * from finish();
rollback;
