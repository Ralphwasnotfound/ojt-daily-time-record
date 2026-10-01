-- Run only through the local Supabase test runner. Every fixture is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Synthetic Auth identities: no OAuth requests and no real credentials.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  's1-test-' || n || '@example.invalid', now(), '{}'::jsonb
from generate_series(1, 20) n;
insert into auth.identities (id, user_id, provider_id, provider, identity_data)
select gen_random_uuid(), id, id::text, 'google',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true)
from auth.users where email like 's1-test-%@example.invalid';

create function pg_temp.profile_fixture(p_id integer, patch jsonb default '{}') returns void
language plpgsql as $$
begin
  insert into public.profiles select r.* from jsonb_populate_record(null::public.profiles,
    jsonb_build_object('id', '00000000-0000-4000-8000-' || lpad(p_id::text,12,'0'),
      'full_name','Test Student','student_id','TEST-' || p_id,'email','s1-test-' || p_id || '@example.invalid',
      'role','student','status','pending','program','BS Information Technology','required_hours',486,
      'created_at',now()) || patch) r;
end;
$$;
select lives_ok($$select pg_temp.profile_fixture(1, '{"role":"admin","status":"approved","student_id":null,"program":null,"required_hours":null,"approved_at":"2026-01-01T00:00:00Z","department":"BSIT Department"}')$$, 'bootstrap admin with null approver');
select lives_ok($$select pg_temp.profile_fixture(2, '{"status":"approved","approved_at":"2026-01-01T00:00:00Z","approved_by":"00000000-0000-4000-8000-000000000001"}')$$, 'approved student');
select pg_temp.profile_fixture(20, '{"role":"admin","status":"approved","student_id":null,"program":null,"required_hours":null,"approved_at":"2026-01-01T00:00:00Z"}');
select pg_temp.profile_fixture(3);
select pg_temp.profile_fixture(4, '{"status":"rejected"}');
select pg_temp.profile_fixture(5, '{"status":"approved","approved_at":"2026-01-01T00:00:00Z","approved_by":"00000000-0000-4000-8000-000000000001"}');
select throws_ok($$select pg_temp.profile_fixture(6, '{"student_id":"TEST-2"}')$$, '23505', null, 'Student ID unique');
select throws_ok($$select pg_temp.profile_fixture(6, '{"student_id":"abc"}')$$, '23514', null, 'direct noncanonical ID rejected');
select throws_ok($$select pg_temp.profile_fixture(6, '{"student_id":null}')$$, '23514', null, 'student ID required');
select throws_ok($$select pg_temp.profile_fixture(6, '{"student_id":"AB"}')$$, '23514', null, 'short ID rejected');
select throws_ok($$select pg_temp.profile_fixture(6, '{"role":"owner"}')$$, '23514', null, 'invalid role');
select throws_ok($$select pg_temp.profile_fixture(6, '{"status":"active"}')$$, '23514', null, 'invalid status');
select throws_ok($$select pg_temp.profile_fixture(6, '{"program":"Other"}')$$, '23514', null, 'fixed program');
select throws_ok($$select pg_temp.profile_fixture(6, '{"program":null}')$$, '23514', null, 'NULL cannot bypass program check');
select throws_ok($$select pg_temp.profile_fixture(6, '{"required_hours":485}')$$, '23514', null, 'fixed hours');
select throws_ok($$select pg_temp.profile_fixture(6, '{"required_hours":null}')$$, '23514', null, 'NULL cannot bypass hours check');
select throws_ok($$select pg_temp.profile_fixture(6, '{"department":"BSIT"}')$$, '23514', null, 'student department null');
select throws_ok($$select pg_temp.profile_fixture(6, '{"approved_at":"2026-01-01"}')$$, '23514', null, 'pending cannot carry approval');
select throws_ok($$select pg_temp.profile_fixture(6, '{"status":"approved"}')$$, '23514', null, 'approved requires metadata');
select throws_ok($$select pg_temp.profile_fixture(6, '{"role":"admin","status":"pending","student_id":null,"program":null,"required_hours":null}')$$, '23514', null, 'pending admin cannot exist');
select throws_ok($$select pg_temp.profile_fixture(6, '{"role":"admin","status":"approved","approved_at":"2026-01-01"}')$$, '23514', null, 'admin cannot carry student fields');
select throws_ok($$select pg_temp.profile_fixture(6, '{"status":"approved","approved_at":"2026-01-01","approved_by":"00000000-0000-4000-8000-000000000019"}')$$, '23503', null, 'approver must reference profile');
select throws_ok($$select pg_temp.profile_fixture(99)$$, '23503', null, 'profile must reference Auth user');
select throws_ok($$delete from auth.users where id='00000000-0000-4000-8000-000000000002'$$, '23503', null, 'Auth deletion cannot cascade profile');
select throws_ok($$delete from public.profiles where id='00000000-0000-4000-8000-000000000001'$$, '23503', null, 'approver cannot be silently removed');

insert into public.attendance_sessions(id,student_uid,time_in,time_out) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','2026-09-28 00:00Z','2026-09-28 08:00Z'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','2026-09-29 00:00Z',null),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','2026-09-29 00:00Z',null);
select throws_ok($$insert into public.attendance_sessions(student_uid,time_in) values ('00000000-0000-4000-8000-000000000002','2026-10-01 00:00Z')$$, '23505', null, 'open constraint independent of day');
select throws_ok($$insert into public.attendance_sessions(student_uid,time_in,time_out) values ('00000000-0000-4000-8000-000000000002','2026-09-28 10:00Z','2026-09-28 11:00Z')$$, '23505', null, 'same Manila start date denied after completion');
select throws_ok($$insert into public.attendance_sessions(student_uid,time_in,time_out) values ('00000000-0000-4000-8000-000000000005','2026-08-01 10:00Z','2026-08-01 09:00Z')$$, '23514', null, 'negative interval denied');
set local timezone = 'America/Los_Angeles';
select lives_ok($$insert into public.attendance_sessions(student_uid,time_in,time_out) values ('00000000-0000-4000-8000-000000000005','2026-12-31 15:59:59Z','2026-12-31 16:00Z'), ('00000000-0000-4000-8000-000000000005','2026-12-31 16:00Z','2026-12-31 17:00Z')$$, 'Manila midnight independent of DB timezone');
select throws_ok($$insert into public.attendance_sessions(student_uid,time_in,time_out) values ('00000000-0000-4000-8000-000000000005','2027-01-01 01:00Z','2027-01-01 02:00Z')$$, '23505', null, 'different UTC dates can be same Manila day');
set local timezone = 'UTC';
savepoint future_policy;
drop index public.attendance_one_start_per_manila_day_idx;
select lives_ok($$insert into public.attendance_sessions(student_uid,time_in,time_out) values ('00000000-0000-4000-8000-000000000002','2026-09-28 10:00Z','2026-09-28 11:00Z')$$, 'dropping daily index permits multiple completed sessions');
select throws_ok($$insert into public.attendance_sessions(student_uid,time_in) values ('00000000-0000-4000-8000-000000000002','2026-10-01 00:00Z')$$, '23505', null, 'one-open constraint survives daily policy removal');
-- Restore index without rolling back pgTAP's test counter.
delete from public.attendance_sessions where student_uid='00000000-0000-4000-8000-000000000002' and time_in='2026-09-28 10:00Z';
create unique index attendance_one_start_per_manila_day_idx on public.attendance_sessions (student_uid, ((time_in at time zone 'Asia/Manila')::date));
release savepoint future_policy;

create function pg_temp.activity_fixture(p_id integer, patch jsonb default '{}') returns void language plpgsql as $$
begin
  -- Name S1 columns so later schema defaults (S5 revision) still apply.
  insert into public.activities(id,student_uid,attendance_session_id,category,description,photo_path,created_at)
    select r.id,r.student_uid,r.attendance_session_id,r.category,r.description,r.photo_path,r.created_at
    from jsonb_populate_record(null::public.activities,
    jsonb_build_object('id','20000000-0000-4000-8000-' || lpad(p_id::text,12,'0'),
      'student_uid','00000000-0000-4000-8000-000000000002',
      'attendance_session_id','10000000-0000-4000-8000-000000000002',
      'category','Other','description','A useful update',
      'photo_path','00000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-' || lpad(p_id::text,12,'0') || '/proof',
      'created_at',now()) || patch) r;
end;
$$;
select lives_ok($$select pg_temp.activity_fixture(1)$$, 'valid composite ownership/path');
select lives_ok($$select pg_temp.activity_fixture(2)$$, 'multiple activities per session');
select throws_ok($$select pg_temp.activity_fixture(3, '{"attendance_session_id":"10000000-0000-4000-8000-000000000003"}')$$, '23503', null, 'cross-student session blocked by FK');
select throws_ok($$select pg_temp.activity_fixture(3, '{"category":"Programming"}')$$, '23514', null, 'category exact');
select throws_ok($$select pg_temp.activity_fixture(3, '{"description":""}')$$, '23514', null, 'empty description denied');
select throws_ok($$select pg_temp.activity_fixture(3, jsonb_build_object('description',U&'\00A0\2003'))$$, '23514', null, 'Unicode whitespace denied');
select throws_ok($$select pg_temp.activity_fixture(3, '{"description":" trim "}')$$, '23514', null, 'untrimmed description denied');
select throws_ok($$select pg_temp.activity_fixture(3, '{"description":null}')$$, '23502', null, 'description required');
select throws_ok($$select pg_temp.activity_fixture(3, jsonb_build_object('description', repeat('x',501)))$$, '23514', null, '501 characters denied');
select lives_ok($$select pg_temp.activity_fixture(3, jsonb_build_object('description', repeat(U&'\+01F600',500)))$$, '500 Unicode supplementary characters allowed');
select throws_ok($$select pg_temp.activity_fixture(4, jsonb_build_object('description', repeat(U&'\+01F600',501)))$$, '23514', null, '501 Unicode supplementary characters denied');
select lives_ok($$select pg_temp.activity_fixture(4, jsonb_build_object('description', E'Line one\nLine two'))$$, 'internal newline preserved');
select throws_ok($$select pg_temp.activity_fixture(5, '{"photo_path":"activity-proofs/forged"}')$$, '23514', null, 'bucket prefix/forged path denied');
select throws_ok($$select pg_temp.activity_fixture(5, '{"photo_path":"https://example.invalid/photo"}')$$, '23514', null, 'URL denied');
select throws_ok($$select pg_temp.activity_fixture(5, '{"photo_path":"00000000-0000-4000-8000-000000000005/20000000-0000-4000-8000-000000000005/proof"}')$$, '23514', null, 'other-owner path denied');
select throws_ok($$select pg_temp.activity_fixture(1)$$, '23505', null, 'duplicate activity/path denied');
select ok(exists(select 1 from pg_constraint where conrelid='public.activities'::regclass and conname='activities_photo_path_key' and contype='u'), 'explicit photo unique constraint exists');
select throws_ok($$delete from public.attendance_sessions where id='10000000-0000-4000-8000-000000000002'$$, '23503', null, 'session evidence delete restricted');
select throws_ok($$delete from public.profiles where id='00000000-0000-4000-8000-000000000002'$$, '23503', null, 'profile evidence delete restricted');

select lives_ok(format('select pg_temp.activity_fixture(%s, %L::jsonb)', 10+n,
  jsonb_build_object('category', category)::text), 'allow exact category: ' || category)
from unnest(array['Programming / Development','IT Support','Hardware / Maintenance','Documentation','Training / Seminar','Meeting','Administrative Work','Other']) with ordinality c(category,n);
-- Trusted transaction-only fixture cleanup after S7 adds restrictive audit FKs.
alter table public.activity_revisions disable trigger audit_immutable;
delete from public.activity_revisions where activity_id >= '20000000-0000-4000-8000-000000000010';
alter table public.activity_revisions enable trigger audit_immutable;
delete from public.activities where id >= '20000000-0000-4000-8000-000000000010';

-- RLS tests use real database roles, not the privileged fixture owner.
set local role anon;
select throws_ok('select * from public.profiles', '42501', null, 'anonymous profile read denied');
select throws_ok('select * from public.attendance_sessions', '42501', null, 'anonymous attendance denied');
select throws_ok('select * from public.activities', '42501', null, 'anonymous activity denied');
select throws_ok($$select public.complete_student_registration('Test','ABC')$$, '42501', null, 'anonymous registration denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.profiles),1,'pending sees own profile only');
select is((select count(*)::integer from public.attendance_sessions),0,'pending no attendance');
select is((select count(*)::integer from public.activities),0,'pending no activities');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from public.profiles),1,'rejected sees own profile');
select is((select count(*)::integer from public.activities),0,'rejected no activities');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from public.profiles),1,'approved sees own profile');
select is((select count(*)::integer from public.attendance_sessions),2,'approved sees own attendance');
select is((select count(*)::integer from public.activities),4,'approved sees own activities');
select is((select count(*)::integer from public.profiles where id='00000000-0000-4000-8000-000000000005'),0,'cross-student profile denied');
select is((select count(*)::integer from public.attendance_sessions where student_uid='00000000-0000-4000-8000-000000000005'),0,'cross-student attendance denied');
select throws_ok($$select public.review_student('00000000-0000-4000-8000-000000000003','approved')$$, '42501','APPROVED_ADMIN_REQUIRED','student cannot review');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select is((select count(*)::integer from public.activities),0,'other student cannot read activities');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.profiles),5,'admin reads own and student profiles');
select is((select count(*)::integer from public.profiles where id='00000000-0000-4000-8000-000000000020'),0,'admin cannot read another admin profile');
select is((select count(*)::integer from public.attendance_sessions),5,'admin reads all attendance');
select is((select count(*)::integer from public.activities),4,'admin reads all activities');
reset role;

-- Grants checked for every browser role/table/operation, even when no row matches.
select ok(not has_table_privilege(r, 'public.' || t, p), r || ' lacks ' || p || ' on ' || t)
from (values ('anon'),('authenticated')) roles(r)
cross join (values ('profiles'),('attendance_sessions'),('activities')) tables(t)
cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privileges(p);
select ok(relrowsecurity, relname || ' RLS enabled') from pg_class where oid in
 ('public.profiles'::regclass,'public.attendance_sessions'::regclass,'public.activities'::regclass);
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename in ('profiles','attendance_sessions','activities') and cmd <> 'SELECT'),0,'no table write policies');
select ok(not has_function_privilege('anon','private.is_approved_admin()','EXECUTE'),'anonymous cannot execute helper');
select ok(not has_function_privilege('authenticated','private.trim_text(text)','EXECUTE'),'normalizer is not a public RPC');
select ok(not has_function_privilege('anon','public.review_student(uuid,text)','EXECUTE'),'anonymous cannot review');
select ok(prosecdef and 'search_path=""'=any(proconfig), proname || ' definer hardened')
from pg_proc where oid in ('private.is_approved_student()'::regprocedure,'private.is_approved_admin()'::regprocedure,
 'public.complete_student_registration(text,text)'::regprocedure,'public.review_student(uuid,text)'::regprocedure);

-- RPC identity is derived from Auth-owned records; editable metadata is insufficient.
update auth.users set raw_user_meta_data='{"provider":"google","email_verified":true,"role":"admin"}' where id='00000000-0000-4000-8000-000000000010';
delete from auth.identities where user_id='00000000-0000-4000-8000-000000000010';
update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where user_id='00000000-0000-4000-8000-000000000011';
update auth.users set email_confirmed_at=null where id='00000000-0000-4000-8000-000000000012';
update auth.identities set identity_data=jsonb_set(identity_data,'{email}','"different@example.invalid"') where user_id='00000000-0000-4000-8000-000000000013';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
select throws_ok($$select public.complete_student_registration('Name','TEST-10')$$,'42501','VERIFIED_GOOGLE_IDENTITY_REQUIRED','editable provider metadata grants nothing');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
select throws_ok($$select public.complete_student_registration('Name','TEST-11')$$,'42501','VERIFIED_GOOGLE_IDENTITY_REQUIRED','unverified Google identity denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
select throws_ok($$select public.complete_student_registration('Name','TEST-12')$$,'42501','VERIFIED_GOOGLE_IDENTITY_REQUIRED','unconfirmed Auth email denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000013',true);
select throws_ok($$select public.complete_student_registration('Name','TEST-13')$$,'42501','VERIFIED_GOOGLE_IDENTITY_REQUIRED','identity/Auth email mismatch denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',true);
select lives_ok($$select public.complete_student_registration('  New Student  ','  abc-123  ')$$,'valid registration');
select is((select student_id from public.profiles),'ABC-123','database canonicalizes Student ID');
select is((select full_name from public.profiles),'New Student','database trims name');
select is((select email from public.profiles),'s1-test-6@example.invalid','trusted email copied');
select ok((select role='student' and status='pending' and required_hours=486 and approved_by is null and approved_at is null and created_at=now() from public.profiles),'registration fixes authority fields');
select throws_ok($$select public.complete_student_registration('Replace','NEW-123')$$,'P0001','PROFILE_ALREADY_EXISTS','existing profile cannot be overwritten');
select throws_ok($$select public.complete_student_registration('Name','ABC','admin')$$,'42883',null,'RPC has no role parameter');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true);
select throws_ok($$select public.complete_student_registration('Other','abc-123')$$,'23505',null,'normalized duplicate ID rejected');
select is((select count(*)::integer from public.profiles),0,'failed registration leaves no partial profile');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.complete_student_registration('Replace Admin','ADM-001')$$,'P0001','PROFILE_ALREADY_EXISTS','admin never overwritten');
select lives_ok($$select public.review_student('00000000-0000-4000-8000-000000000006','approved')$$,'admin approves pending');
select ok((select status='approved' and approved_by=auth.uid() and approved_at is not null from public.profiles where id='00000000-0000-4000-8000-000000000006'),'server approval metadata');
select throws_ok($$select public.review_student('00000000-0000-4000-8000-000000000006','rejected')$$,'P0001','REGISTRATION_NOT_PENDING','cannot re-review approved');
select throws_ok($$select public.review_student('00000000-0000-4000-8000-000000000001','approved')$$,'P0001','REGISTRATION_NOT_PENDING','cannot review admin');
select throws_ok($$select public.review_student('00000000-0000-4000-8000-000000000003','admin')$$,'22023','INVALID_REVIEW_DECISION','cannot promote role');
select lives_ok($$select public.review_student('00000000-0000-4000-8000-000000000003','rejected')$$,'admin rejects pending');
select ok((select status='rejected' and approved_at is null and approved_by is null from public.profiles where id='00000000-0000-4000-8000-000000000003'),'rejection metadata null');
select throws_ok($$select public.review_student('00000000-0000-4000-8000-000000000003','approved')$$,'P0001','REGISTRATION_NOT_PENDING','cannot re-review rejected');
select throws_ok($$update public.profiles set role='admin'$$,'42501',null,'admin direct update denied');
select throws_ok($$delete from public.activities$$,'42501',null,'admin direct delete denied');
select throws_ok($$insert into public.attendance_sessions(student_uid,time_in) values (auth.uid(),now())$$,'42501',null,'admin direct attendance write denied');
reset role;
select * from finish();
rollback;
