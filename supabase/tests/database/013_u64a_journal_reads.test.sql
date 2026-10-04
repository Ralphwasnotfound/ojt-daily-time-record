begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,email) select ('a6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'journal-'||n||'@example.invalid' from generate_series(1,5)n;
insert into public.profiles(id,full_name,email,role,status,approved_at) values('a6000000-0000-4000-8000-000000000001','Journal Admin','journal-1@example.invalid','admin','approved',now());
insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
select id,'Journal Student',email,'JRN-'||right(id::text,1),'student',case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,
'BS Information Technology',486,case when right(id::text,1) in ('4','5') then null else now() end,
case when right(id::text,1) in ('4','5') then null else 'a6000000-0000-4000-8000-000000000001'::uuid end from auth.users where id::text like 'a6000000-%' and right(id::text,1)<>'1';
insert into public.attendance_sessions(id,student_uid,time_in,time_out)
select ('a6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('a6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'2026-10-03 15:00+00','2026-10-04 18:00+00' from generate_series(2,3)n;
insert into public.activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at)
select ('a6200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a6000000-0000-4000-8000-000000000002','a6100000-0000-4000-8000-000000000002','Other','Recorded task '||n,
'a6000000-0000-4000-8000-000000000002/a6200000-0000-4000-8000-'||lpad(n::text,12,'0')||'/proof',
case when n=1 then '2026-10-03 15:59:59+00'::timestamptz when n=32 then '2026-10-04 16:00+00'::timestamptz else '2026-10-03 16:00+00'::timestamptz + (n-2)*interval '1 minute' end from generate_series(1,32)n;

-- Add tied timestamps and an edit without changing immutable creation/session.
update activities set revision=revision+1,updated_at=clock_timestamp(),description=E'日本語 😀\nExact punctuation!',photo_path=student_uid::text||'/'||id::text||'/a6500000-0000-4000-8000-000000000001/proof' where id='a6200000-0000-4000-8000-000000000002';
insert into activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at)
values('a6200000-0000-4000-8000-000000000033','a6000000-0000-4000-8000-000000000002','a6100000-0000-4000-8000-000000000002','Other','Tied task','a6000000-0000-4000-8000-000000000002/a6200000-0000-4000-8000-000000000033/proof','2026-10-03 16:00+00');
insert into attendance_sessions(id,student_uid,time_in,time_out) values
('a6100000-0000-4000-8000-000000000006','a6000000-0000-4000-8000-000000000002','2026-10-06 01:00+00','2026-10-06 02:00+00'),
('a6100000-0000-4000-8000-000000000007','a6000000-0000-4000-8000-000000000002','2026-10-06 03:00+00',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000002',true);
select is(jsonb_array_length(journal_activity_range('2026-10-03','2026-10-03')->'activities'),1,'before Manila midnight');
select is(jsonb_array_length(journal_activity_range('2026-10-04','2026-10-04',100)->'activities'),31,'not AI 30-item cap');
select is(jsonb_array_length(journal_activity_range('2026-10-05','2026-10-05')->'activities'),1,'next Manila midnight');
select is(jsonb_array_length(journal_activity_range('2026-10-03','2026-10-05',100)->'activities'),33,'complete inclusive date range');
select lives_ok($$select journal_activity_range('2026-10-01','2026-10-31')$$,'31 calendar days');
select throws_ok($$select journal_activity_range('2026-10-01','2026-11-01')$$,'22023','INVALID_JOURNAL_RANGE','32 rejected');
select throws_ok($$select journal_activity_range('2026-10-05','2026-10-04')$$,'22023','INVALID_JOURNAL_RANGE','reversed');
select throws_ok($$select journal_activity_range(null,'2026-10-04')$$,'22023','INVALID_JOURNAL_RANGE','null rejected');
select throws_ok($$select journal_activity_range('2026-02-30','2026-03-01')$$,'22008',null,'invalid calendar date');
select throws_ok($$select journal_activity_range('garbage','2026-03-01')$$,'22007',null,'malformed date');
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04',101)$$,'22023','INVALID_JOURNAL_CURSOR','page cap');
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04',0)$$,'22023','INVALID_JOURNAL_CURSOR','zero page');
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04',null)$$,'22023','INVALID_JOURNAL_CURSOR','null page');
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04',2,null,'a6200000-0000-4000-8000-000000000002')$$,'22023','INVALID_JOURNAL_CURSOR','unpaired cursor');
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04',2,'2026-10-03 16:00Z','a6200000-0000-4000-8000-000000000003')$$,'22023','INVALID_JOURNAL_CURSOR','mismatched cursor');
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04',2,'bad',null)$$,'22007',null,'malformed cursor timestamp');
create temp table first_page as select journal_activity_range('2026-10-04','2026-10-04',2) data;
select is((select data->'activities'->0->>'id' from first_page),'a6200000-0000-4000-8000-000000000002','tie first ID');
select is((select data->'activities'->1->>'id' from first_page),'a6200000-0000-4000-8000-000000000033','tie second ID');
select is((select data->'activities'->0->>'description' from first_page),E'日本語 😀\nExact punctuation!','exact edited text');
select is((select data->'activities'->0->>'revision' from first_page),'1','current revision');
select ok((select data->'activities'->0->>'photo_path' from first_page) like '%/a6500000-0000-4000-8000-000000000001/proof','current replacement reference');
select is((select data->'next'->>'id' from first_page),'a6200000-0000-4000-8000-000000000033','explicit continuation');
create temp table second_page as select journal_activity_range('2026-10-04','2026-10-04',100,
 (select (data->'next'->>'created_at')::timestamptz from first_page),(select (data->'next'->>'id')::uuid from first_page)) data;
select is((select jsonb_array_length(data->'activities') from second_page),29,'remaining rows complete');
select is((select data->'activities'->0->>'id' from second_page),'a6200000-0000-4000-8000-000000000003','strictly after tie, no duplicate');
select ok((select data->'next'='null'::jsonb from second_page),'terminal cursor');
select is(jsonb_array_length(journal_activity_range('2026-10-06','2026-10-06')->'activities'),0,'attendance-only date');
select is(attendance_days(31,null,'2026-10-06')->'days'->0->>'completed_seconds','3600.000000','only completed session counts');
select is(attendance_days(31,null,'2026-10-06')->'days'->0->'sessions'->1->>'session_ordinal','2','second session');
select is(attendance_days(31,null,'2026-10-06')->'days'->0->'sessions'->1->>'completed_seconds','0','open zero');
select is(attendance_days(31,null,'2026-10-03')->'days'->0->'sessions'->0->>'start_day','2026-10-03','overnight belongs to start day');
select is(attendance_days(31,null,'2026-10-03')->'days'->0->>'completed_seconds','97200.000000','overnight authoritative duration retained');
select ok(not (attendance_days(31,null,'2026-10-03')->'days'->0->'sessions'->0 ? 'photo_path'),'historical proofless attendance valid');
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000003',true);
select is(jsonb_array_length(journal_activity_range('2026-10-03','2026-10-05')->'activities'),0,'other approved student cannot read owner records');
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04',2,'2026-10-03 16:00Z','a6200000-0000-4000-8000-000000000002')$$,'22023','INVALID_JOURNAL_CURSOR','foreign cursor denied');
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000004',true);
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04')$$,'42501','APPROVED_STUDENT_REQUIRED','pending denied');
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000005',true);
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04')$$,'42501','APPROVED_STUDENT_REQUIRED','rejected denied');
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000001',true);
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04')$$,'42501','APPROVED_STUDENT_REQUIRED','admin denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04')$$,'42501','AUTHENTICATION_REQUIRED','missing auth denied');
set local role anon;
select throws_ok($$select journal_activity_range('2026-10-04','2026-10-04')$$,'42501',null,'anonymous execute denied');
reset role;
select ok(not has_function_privilege('anon','public.journal_activity_range(date,date,integer,timestamptz,uuid)','execute'),'anon grant absent');
select is((select count(*)::integer from pg_proc where proname='journal_activity_range'),1,'single contract without UID overload');
select * from finish();
rollback;
