begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,email) select ('b6400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'complete-'||n||'@example.invalid' from generate_series(1,8)n;
insert into public.profiles(id,full_name,email,role,status,approved_at) values('b6400000-0000-4000-8000-000000000001','Complete Admin','complete-1@example.invalid','admin','approved',now());
insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
select id,'Complete Student',email,'CMP-'||right(id::text,1),'student',case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,
'BS Information Technology',486,case when right(id::text,1) in ('4','5') then null else now() end,
case when right(id::text,1) in ('4','5') then null else 'b6400000-0000-4000-8000-000000000001'::uuid end from auth.users where id::text like 'b6400000-%' and right(id::text,1)<>'1';
insert into attendance_sessions(id,student_uid,time_in,time_out)
select ('b6410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b6400000-0000-4000-8000-000000000002','2026-08-03 00:00Z'::timestamptz+(n-1)*interval '1 day','2026-08-03 01:00Z'::timestamptz+(n-1)*interval '1 day' from generate_series(1,36)n;
insert into attendance_sessions(id,student_uid,time_in,time_out) values
('b6410000-0000-4000-8000-000000000037','b6400000-0000-4000-8000-000000000002','2026-10-05 15:00Z',null),
('b6410000-0000-4000-8000-000000000038','b6400000-0000-4000-8000-000000000003','2026-07-01 00:00Z','2026-07-01 01:00Z'),
('b6410000-0000-4000-8000-000000000039','b6400000-0000-4000-8000-000000000007','2026-10-04 15:00Z','2026-10-04 17:00Z'),
('b6410000-0000-4000-8000-000000000040','b6400000-0000-4000-8000-000000000008','2026-09-01 00:00Z','2026-09-01 01:00Z');
insert into activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at)
select ('b6420000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b6400000-0000-4000-8000-000000000002','b6410000-0000-4000-8000-000000000001','Other',E'Exact 日本語\nTask '||n,
'b6400000-0000-4000-8000-000000000002/'||('b6420000-0000-4000-8000-'||lpad(n::text,12,'0'))||'/proof',
case when n=1 then '2026-08-02 15:59:59Z'::timestamptz when n=250 then '2026-10-03 16:00Z'::timestamptz else '2026-08-02 16:00Z'::timestamptz+(n-2)*interval '1 microsecond' end from generate_series(1,250)n;
insert into activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at) values
('b6420000-0000-4000-8000-000000000251','b6400000-0000-4000-8000-000000000002','b6410000-0000-4000-8000-000000000001','Other','Tie','b6400000-0000-4000-8000-000000000002/b6420000-0000-4000-8000-000000000251/proof','2026-08-02 16:00Z'),
('b6420000-0000-4000-8000-000000000252','b6400000-0000-4000-8000-000000000008','b6410000-0000-4000-8000-000000000040','Other','Activity later day','b6400000-0000-4000-8000-000000000008/b6420000-0000-4000-8000-000000000252/proof','2026-10-03 16:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000002',true);
select is(journal_complete_period()->>'from','2026-08-02','earliest Activity day extends earlier than Attendance');
select is(journal_complete_period()->>'to','2026-10-05','latest open Time In day extends beyond last Activity');
select throws_ok($$select journal_activity_range('2026-08-02','2026-10-05')$$,'22023','INVALID_JOURNAL_RANGE','range 31-day cap unchanged');
create temp table cmp_a as select journal_complete_activities(100) data;
select is((select jsonb_array_length(data->'activities') from cmp_a),100,'bounded first Activity page');
select is((select data->'activities'->0->>'id' from cmp_a),'b6420000-0000-4000-8000-000000000001','chronological first');
select is((select data->'activities'->1->>'id' from cmp_a),'b6420000-0000-4000-8000-000000000002','first tie');
select is((select data->'activities'->2->>'id' from cmp_a),'b6420000-0000-4000-8000-000000000251','second tie');
select is((select data->'activities'->0->>'description' from cmp_a),E'Exact 日本語\nTask 1','literal text');
select is((select data->'activities'->0->>'photo_path' from cmp_a),'b6400000-0000-4000-8000-000000000002/b6420000-0000-4000-8000-000000000001/proof','correct private association');
select ok(not (select data->'activities'->0 ?| array['student_uid','photo_bytes','jwt','latitude','selfie'] from cmp_a),'no bytes credentials attendance evidence');
create temp table cmp_b as select journal_complete_activities(100,(select (data->'next'->>'created_at')::timestamptz from cmp_a),(select (data->'next'->>'id')::uuid from cmp_a)) data;
create temp table cmp_c as select journal_complete_activities(100,(select (data->'next'->>'created_at')::timestamptz from cmp_b),(select (data->'next'->>'id')::uuid from cmp_b)) data;
select is((select jsonb_array_length(data->'activities') from cmp_b),100,'second page');
select is((select jsonb_array_length(data->'activities') from cmp_c),51,'third page no truncation');
select ok((select data->'next'='null'::jsonb from cmp_c),'terminal Activity cursor');
select is((select count(distinct a->>'id')::integer from (select jsonb_array_elements(data->'activities') a from cmp_a union all select jsonb_array_elements(data->'activities') from cmp_b union all select jsonb_array_elements(data->'activities') from cmp_c) x),251,'all IDs once');
create temp table cmp_att as select journal_complete_attendance(31) data;
select is((select jsonb_array_length(data->'days') from cmp_att),31,'bounded Attendance dates');
select is((select data->'days'->0->>'start_day' from cmp_att),'2026-10-05','latest open date');
select is((select data->'days'->0->>'completed_seconds' from cmp_att),'0','open session zero');
select ok(not (select data->'days'->0->'sessions'->0 ?| array['photo_path','latitude','longitude','accuracy','location','address','student_uid'] from cmp_att),'Attendance facts projection only');
select is(jsonb_array_length(journal_complete_attendance(31,(select (data->>'next_before_day')::date from cmp_att))->'days'),6,'remaining Attendance dates');
select throws_ok($$select journal_complete_activities(101)$$,'22023','INVALID_JOURNAL_CURSOR','Activity cap');
select throws_ok($$select journal_complete_activities(null)$$,'22023','INVALID_JOURNAL_CURSOR','null cap');
select throws_ok($$select journal_complete_activities(1,null,'b6420000-0000-4000-8000-000000000001')$$,'22023','INVALID_JOURNAL_CURSOR','unpaired cursor');
select throws_ok($$select journal_complete_activities(1,'2026-08-02 16:00Z','b6420000-0000-4000-8000-000000000001')$$,'22023','INVALID_JOURNAL_CURSOR','mismatched cursor');
select throws_ok($$select journal_complete_attendance(32)$$,'22023','INVALID_JOURNAL_CURSOR','Attendance cap');
select throws_ok($$select journal_complete_attendance(1,'2026-07-01')$$,'22023','INVALID_JOURNAL_CURSOR','foreign Attendance cursor');
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000003',true);
select is(journal_complete_period()->>'from','2026-07-01','own boundary only');
select is(jsonb_array_length(journal_complete_activities()->'activities'),0,'foreign Student sees no owner Activities');
select throws_ok($$select journal_complete_activities(1,'2026-08-02 15:59:59Z','b6420000-0000-4000-8000-000000000001')$$,'22023','INVALID_JOURNAL_CURSOR','foreign Activity cursor');
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000006',true);
select ok(journal_complete_period()=jsonb_build_object('from',null,'to',null),'no invented period for empty history');
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000007',true);
select is(journal_complete_period()->>'from','2026-10-04','Attendance-only start');
select is(journal_complete_period()->>'to','2026-10-04','overnight stays Time In day');
select is(journal_complete_attendance()->'days'->0->>'completed_seconds','7200.000000','overnight authoritative seconds');
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000008',true);
select is(journal_complete_period()->>'to','2026-10-04','Activity-only later date expands end');
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000004',true);
select throws_ok($$select journal_complete_period()$$,'42501','APPROVED_STUDENT_REQUIRED','pending period denied');
select throws_ok($$select journal_complete_activities()$$,'42501','APPROVED_STUDENT_REQUIRED','pending Activities denied');
select throws_ok($$select journal_complete_attendance()$$,'42501','APPROVED_STUDENT_REQUIRED','pending Attendance denied');
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000005',true);
select throws_ok($$select journal_complete_period()$$,'42501','APPROVED_STUDENT_REQUIRED','rejected period denied');
select throws_ok($$select journal_complete_activities()$$,'42501','APPROVED_STUDENT_REQUIRED','rejected Activities denied');
select throws_ok($$select journal_complete_attendance()$$,'42501','APPROVED_STUDENT_REQUIRED','rejected Attendance denied');
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000001',true);
select throws_ok($$select journal_complete_period()$$,'42501','APPROVED_STUDENT_REQUIRED','Admin period denied');
select throws_ok($$select journal_complete_activities()$$,'42501','APPROVED_STUDENT_REQUIRED','Admin Activities denied');
select throws_ok($$select journal_complete_attendance()$$,'42501','APPROVED_STUDENT_REQUIRED','Admin Attendance denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select journal_complete_period()$$,'42501','AUTHENTICATION_REQUIRED','missing auth');
set local role anon;
select throws_ok($$select journal_complete_period()$$,'42501',null,'anon period denied');
select throws_ok($$select journal_complete_activities()$$,'42501',null,'anon Activities denied');
select throws_ok($$select journal_complete_attendance()$$,'42501',null,'anon Attendance denied');
reset role;
select ok(not has_function_privilege('anon','public.journal_complete_period()','execute'),'no anon grant');
select is((select count(*)::integer from pg_proc where proname in ('journal_complete_period','journal_complete_activities','journal_complete_attendance')),3,'no target UID overload');
insert into attendance_sessions(id,student_uid,time_in,time_out) values
('b6410000-0000-4000-8000-000000000041','b6400000-0000-4000-8000-000000000006','2000-01-01 00:00Z','2000-01-01 01:00Z'),
('b6410000-0000-4000-8000-000000000042','b6400000-0000-4000-8000-000000000006','2026-10-05 00:00Z','2026-10-05 01:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','b6400000-0000-4000-8000-000000000006',true);
select throws_ok($$select journal_complete_period()$$,'22023','JOURNAL_COMPLETE_TOO_LARGE','explicit period ceiling');
select throws_ok($$select journal_complete_activities()$$,'22023','JOURNAL_COMPLETE_TOO_LARGE','Activity page respects period ceiling');
select throws_ok($$select journal_complete_attendance()$$,'22023','JOURNAL_COMPLETE_TOO_LARGE','Attendance page respects period ceiling');
select * from finish();
rollback;
