begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,email) select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'s7-'||n||'@example.invalid' from generate_series(1,5)n;
insert into public.profiles(id,full_name,email,role,status,approved_at) values('70000000-0000-4000-8000-000000000001','S7 Admin','s7-1@example.invalid','admin','approved',now());
insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
select id,'S7 Student '||right(id::text,1),email,'S7-'||right(id::text,12),'student',
case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,'BS Information Technology',486,
case when right(id::text,1) in ('4','5') then null else now() end,
case when right(id::text,1) in ('4','5') then null else '70000000-0000-4000-8000-000000000001'::uuid end
from auth.users where id::text like '70000000-%' and right(id::text,1)<>'1';
insert into public.attendance_sessions(student_uid,time_in,time_out) values
('70000000-0000-4000-8000-000000000002','2020-01-01 00:00:00+00','2020-01-01 01:00:00.5+00');
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select public.attendance_time_in();
create temp table draft as select * from public.activity_prepare('71000000-0000-4000-8000-000000000001');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'activity-proofs',photo_path,'70000000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":100}'::jsonb from draft;
set local role authenticated;
create temp table target as select * from public.activity_create((select upload_id from draft),'Other','Original description');
reset role;
select is((select count(*)::integer from public.activity_revisions where activity_id=(select id from target)),1,'original creates one snapshot');
select ok((select revision=0 and category='Other' and description='Original description' and photo_path=(select photo_path from draft) and version_at=(select created_at from target) and not migration_baseline from public.activity_revisions where activity_id=(select id from target)),'revision zero captures complete server original');
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select public.activity_edit((select id from target),0,'Documentation','First edit');
select public.attendance_time_out();
create temp table replacement as select * from public.activity_prepare('71000000-0000-4000-8000-000000000002',(select id from target));
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'activity-proofs',photo_path,'70000000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":100}'::jsonb from replacement;
set local role authenticated;
select public.activity_edit((select id from target),1,'IT Support','Second edit',(select upload_id from replacement));
select throws_ok($$select public.activity_edit((select id from target),1,'Other','stale')$$,'P0001','ACTIVITY_CHANGED','stale edit fails');
select throws_ok($$select public.activity_edit((select id from target),2,'Invalid','bad')$$,'22023','INVALID_CATEGORY','invalid edit fails');
select throws_ok($$select public.activity_discard_proof((select upload_id from draft))$$,'P0001','PROOF_IN_USE','historical proof retained');
select ok(not private.activity_storage_allowed((select photo_path from draft),'delete'),'historical Storage delete denied');
reset role;
select is((select count(*)::integer from public.activity_revisions where activity_id=(select id from target)),3,'two edits and failures produce exactly three snapshots');
select is((select string_agg(revision::text,',' order by revision) from public.activity_revisions where activity_id=(select id from target)),'0,1,2','revisions ordered');
select ok((select category='Documentation' and description='First edit' and photo_path=(select photo_path from draft) from public.activity_revisions where activity_id=(select id from target) and revision=1),'metadata edit preserves original proof');
select ok((select category='IT Support' and description='Second edit' and photo_path=(select photo_path from replacement) from public.activity_revisions where activity_id=(select id from target) and revision=2),'replacement revision preserves new proof');
select ok((select bool_and(version_at >= (select created_at from target) and version_at <= clock_timestamp()) from public.activity_revisions where activity_id=(select id from target)),'version timestamps server generated');
select ok((select bool_and(student_uid=(select student_uid from target)) from public.activity_revisions where activity_id=(select id from target)),'snapshot ownership fixed');
select throws_ok($$update public.activity_revisions set description='forged' where activity_id=(select id from target)$$,'42501','AUDIT_IMMUTABLE','even direct owner update is blocked');
select throws_ok($$delete from public.activity_revisions where activity_id=(select id from target)$$,'42501','AUDIT_IMMUTABLE','direct historical deletion blocked');
-- Force an audit insert failure to prove activity + audit atomicity.
create function pg_temp.reject_snapshot() returns trigger language plpgsql as $$begin raise exception 'TEST_AUDIT_FAILURE'; end;$$;
create trigger test_reject_snapshot before insert on public.activity_revisions for each row execute function pg_temp.reject_snapshot();
set local role authenticated;
select throws_ok($$select public.activity_edit((select id from target),2,'Other','Must roll back')$$,'P0001','TEST_AUDIT_FAILURE','audit failure aborts edit');
reset role;
drop trigger test_reject_snapshot on public.activity_revisions;
select is((select description from public.activities where id=(select id from target)),'Second edit','failed audit rolls back activity change');
select is((select count(*)::integer from public.activity_revisions where activity_id=(select id from target)),3,'failed audit creates no revision');
-- RPC grant and fixed-search-path hardening.
select ok(prosecdef and 'search_path=""'=any(proconfig),proname||' hardened admin RPC') from pg_proc where pronamespace='public'::regnamespace and proname like 'admin_%';
select ok(not has_function_privilege('anon',oid,'EXECUTE'),proname||' denies anon') from pg_proc where pronamespace='public'::regnamespace and proname like 'admin_%';
select ok(not has_table_privilege('authenticated','public.activity_revisions',op),'no browser audit '||op) from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE'])op;
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select is((public.admin_students(1,null,'S7 Student 2')->0->>'id'),'70000000-0000-4000-8000-000000000002','server search returns selected student');
select is(jsonb_array_length(public.admin_students(25,null,'','pending')),1,'pending directory consistent');
select is(jsonb_array_length(public.admin_students(25,null,'','rejected')),1,'rejected directory consistent');
select is((public.admin_students(1,null,'S7 Student 2')->0->>'completed_seconds')::numeric,
(select sum(extract(epoch from(time_out-time_in))) from public.attendance_sessions where student_uid='70000000-0000-4000-8000-000000000002'), 'completed seconds preserve fractions from timestamps');
select is(jsonb_array_length(public.admin_attendance('70000000-0000-4000-8000-000000000002')),2,'admin attendance reads');
select is(jsonb_array_length(public.admin_activities(25,null,null,'70000000-0000-4000-8000-000000000002')),1,'admin monitor reads');
select is(jsonb_array_length(public.admin_activity_revisions((select id from target))),3,'admin audit reads');
select is(jsonb_array_length(public.admin_activity_revisions((select id from target),1,0)),1,'audit bounded cursor');
select is((public.admin_activity_revisions((select id from target),1,0)->0->>'revision')::integer,1,'audit cursor order');
select is((public.admin_activity_revisions((select id from target))->0->>'current_revision')::integer,2,'current revision identified');
select is((select count(*)::integer from storage.objects where name=(select photo_path from draft)),1,'admin can read historical proof');
select is((select count(*)::integer from storage.objects where name=(select photo_path from replacement)),1,'admin can read current proof');
select throws_ok($$select public.admin_students(101)$$,'P0001','INVALID_PAGE','directory bounded');
select throws_ok($$select public.admin_activities(25,now(),null)$$,'P0001','INVALID_PAGE','paired activity cursor');
select throws_ok($$select public.admin_attendance(null)$$,'P0001','INVALID_PAGE','attendance requires target');
select throws_ok($$select public.admin_activity_revisions((select id from target),101)$$,'P0001','INVALID_PAGE','audit bounded');
select throws_ok($$insert into public.activity_revisions select * from public.activity_revisions limit 1$$,'42501',null,'admin cannot insert audit');
select throws_ok($$update public.activity_revisions set description='admin rewrite'$$,'42501',null,'admin cannot update audit');
select throws_ok($$delete from public.activity_revisions$$,'42501',null,'admin cannot delete audit');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select throws_ok($$insert into public.activity_revisions(activity_id) values(gen_random_uuid())$$,'42501',null,'student cannot insert audit');
select throws_ok($$update public.activity_revisions set description='student rewrite'$$,'42501',null,'student cannot update audit');
select throws_ok($$delete from public.activity_revisions$$,'42501',null,'student cannot delete audit');
select is((select count(*)::integer from public.activity_revisions),0,'student cannot read admin audit');
-- Unattached proof remains inaccessible to admins.
create temp table pending_draft as select * from public.activity_prepare('71000000-0000-4000-8000-000000000003',(select id from target));
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'activity-proofs',photo_path,'70000000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":100}'::jsonb from pending_draft;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('activity-proofs','unrelated-proof','70000000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":100}');
insert into public.attendance_sessions(student_uid,time_in) values('70000000-0000-4000-8000-000000000003',clock_timestamp());
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from storage.objects where name=(select photo_path from pending_draft)),0,'admin cannot read draft');
select is((select count(*)::integer from storage.objects where name='unrelated-proof'),0,'admin cannot read unrelated object');
select is((public.admin_students(1,null,'S7 Student 3')->0->>'completed_seconds')::numeric,0::numeric,'open session excluded from total');
select is((public.admin_dashboard()->>'timed_in')::integer,1,'open session counted as IN');
select lives_ok($$select public.review_student('70000000-0000-4000-8000-000000000004','rejected')$$,'S2 rejection preserved');
-- Test all non-admin trusted states against every read.
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from storage.objects where name in ((select photo_path from draft),(select photo_path from replacement))),0,'other student sees no proofs');
select is((select count(*)::integer from public.activity_revisions),0,'other student sees no history');
select throws_ok($$select public.review_student(auth.uid(),'approved')$$,'42501',null,'student cannot self approve');
select throws_ok($$select public.review_student(auth.uid(),'admin')$$,'42501',null,'student cannot promote');
select throws_ok(query,'42501','APPROVED_ADMIN_REQUIRED','student denied '||label) from (values
('select public.admin_dashboard()','dashboard'),('select public.admin_students()','students'),('select public.admin_activities()','activities'),
('select public.admin_attendance(null)','attendance'),('select public.admin_activity_revisions(null)','revisions'))q(query,label);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.admin_dashboard()$$,'42501','APPROVED_ADMIN_REQUIRED','rejected denied');
reset role;
update public.profiles set status='pending' where id='70000000-0000-4000-8000-000000000005';
set local role authenticated;
select throws_ok($$select public.admin_students()$$,'42501','APPROVED_ADMIN_REQUIRED','pending denied');
set local role anon;
select throws_ok($$select public.admin_dashboard()$$,'42501',null,'anonymous denied');
reset role;
select * from finish();
rollback;
