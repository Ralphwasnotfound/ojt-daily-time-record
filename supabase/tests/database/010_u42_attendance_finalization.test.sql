begin;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,email) select ('85000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'u42-'||n||'@example.invalid' from generate_series(1,8)n;
insert into profiles(id,full_name,email,role,status,approved_at) values('85000000-0000-4000-8000-000000000001','U42 Admin','u42-1@example.invalid','admin','approved',now());
insert into profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
select id,'U42 Student','u42-'||right(id::text,1)||'@example.invalid','U42-'||right(id::text,1),'student',
case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,'BS Information Technology',486,
case when right(id::text,1) not in ('4','5') then now() end,
case when right(id::text,1) not in ('4','5') then '85000000-0000-4000-8000-000000000001'::uuid end
from auth.users where id::text like '85000000-%' and right(id::text,1)<>'1';

-- Temporary trusted fixture writes ONLY Storage metadata, never attendance.
-- Real bytes and browser Storage authorization are covered by API tests.
create function pg_temp.ready(action text) returns uuid language plpgsql security definer set search_path='' as $$
declare draft record;
begin
 select * into draft from public.attendance_proof_prepare(gen_random_uuid(),action);
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('attendance-proofs',draft.photo_path,auth.uid()::text,'{"mimetype":"image/png","size":68}');
 return draft.upload_id;
end; $$;
revoke all on function pg_temp.ready(text) from public,anon;
grant execute on function pg_temp.ready(text) to authenticated;

select ok(not has_function_privilege('authenticated','attendance_time_in()','EXECUTE'),'proofless Time In revoked');
select ok(not has_function_privilege('authenticated','attendance_time_out()','EXECUTE'),'proofless Time Out revoked');
select ok(has_function_privilege('authenticated','attendance_proof_finalize(uuid,numeric,numeric,numeric)','EXECUTE'),'finalizer granted');
select ok(not has_function_privilege('anon','attendance_proof_finalize(uuid,numeric,numeric,numeric)','EXECUTE'),'anonymous finalizer revoked');
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='attendance_proof_finalize(uuid,numeric,numeric,numeric)'::regprocedure),'safe definer');
select ok(not exists(select 1 from pg_publication_tables where tablename in ('attendance_proofs','attendance_proof_uploads')),'sensitive tables not published');
set local role anon;
select throws_ok($$select attendance_proof_finalize(gen_random_uuid(),1,1,1)$$,'42501',null,'anonymous denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select attendance_proof_finalize(gen_random_uuid(),1,1,1)$$,'42501','AUTHENTICATION_REQUIRED','missing identity denied');
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000001',true);
select throws_ok($$select attendance_proof_finalize(gen_random_uuid(),1,1,1)$$,'42501','APPROVED_STUDENT_REQUIRED','Admin cannot punch');
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000004',true);
select throws_ok($$select attendance_proof_finalize(gen_random_uuid(),1,1,1)$$,'42501','APPROVED_STUDENT_REQUIRED','pending denied');
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000005',true);
select throws_ok($$select attendance_proof_finalize(gen_random_uuid(),1,1,1)$$,'42501','APPROVED_STUDENT_REQUIRED','rejected denied');
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000002',true);
select throws_ok('select attendance_time_in()','42501',null,'approved browser cannot bypass Time In proof');
select throws_ok('select attendance_time_out()','42501',null,'approved browser cannot bypass Time Out proof');
select throws_ok($$select attendance_proof_finalize(gen_random_uuid(),1,1,1)$$,'P0001','INVALID_UPLOAD','unknown reservation denied');
create temp table missing as select * from attendance_proof_prepare(gen_random_uuid(),'time_in');
select throws_ok($$select attendance_proof_finalize((select upload_id from missing),1,1,1)$$,'P0001','PROOF_REQUIRED','missing uploaded object');
select is((select count(*) from attendance_sessions),0::bigint,'missing object creates no session');
create temp table tickets(label text primary key,id uuid);
insert into tickets values('in',pg_temp.ready('time_in')),('stale_in',pg_temp.ready('time_in'));
select throws_ok(format('select attendance_proof_finalize(%L,%s,%s,%s)',(select id from tickets where label='in'),lat,lon,acc),'22023','INVALID_LOCATION','invalid location rejected: '||lat||'/'||lon||'/'||acc)
from (values('null','1','1'),('1','null','1'),('1','1','null'),('91','1','1'),('-91','1','1'),('1','181','1'),('1','-181','1'),
 ('1','1','-1'),('''NaN''','1','1'),('1','''Infinity''','1'),('1','1','''Infinity'''),('1','1','''NaN'''))v(lat,lon,acc);
select is((select count(*) from attendance_sessions),0::bigint,'invalid location has no attendance effect');
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000003',true);
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),1,1,1)$$,'P0001','INVALID_UPLOAD','cross-owner denied');
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000002',true);
reset role;
update storage.objects set owner_id='85000000-0000-4000-8000-000000000003' where name=(select photo_path from private.attendance_proof_uploads where id=(select id from tickets where label='in'));
set local role authenticated;
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),1,1,1)$$,'P0001','PROOF_REQUIRED','wrong Storage owner rejected');
reset role;
update storage.objects set owner_id='85000000-0000-4000-8000-000000000002' where name=(select photo_path from private.attendance_proof_uploads where id=(select id from tickets where label='in'));
update storage.objects set metadata='{"mimetype":"text/plain","size":68}' where name=(select photo_path from private.attendance_proof_uploads where id=(select id from tickets where label='in'));
set local role authenticated;
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),1,1,1)$$,'22023','INVALID_PROOF','invalid MIME no mutation');
reset role;
update storage.objects set metadata='{"mimetype":"image/png","size":5242881}' where name=(select photo_path from private.attendance_proof_uploads where id=(select id from tickets where label='in'));
set local role authenticated;
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),1,1,1)$$,'22023','INVALID_PROOF','oversized metadata no mutation');
select is((select count(*) from attendance_sessions),0::bigint,'invalid metadata leaves attendance empty');
reset role;
update storage.objects set metadata='{"mimetype":"image/png","size":68}' where name=(select photo_path from private.attendance_proof_uploads where id=(select id from tickets where label='in'));
-- Force failures AFTER attendance mutation, without modifying production functions.
create function pg_temp.fail_insert() returns trigger language plpgsql as $$ begin raise exception 'TEST_PROOF_INSERT_FAILURE'; end; $$;
create trigger aaa_test_failure before insert on attendance_proofs for each row execute function pg_temp.fail_insert();
set local role authenticated;
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),1,1,1)$$,'P0001','TEST_PROOF_INSERT_FAILURE','proof insert failure propagates');
select is((select count(*) from attendance_sessions),0::bigint,'proof insert failure rolls back Time In');
select is((select count(*) from attendance_proofs),0::bigint,'proof insert failure no proof');
reset role;
drop trigger aaa_test_failure on attendance_proofs;
create function pg_temp.fail_attach() returns trigger language plpgsql as $$ begin if new.state='attached' then raise exception 'TEST_ATTACH_FAILURE'; end if; return new; end; $$;
create trigger aaa_test_failure before update on private.attendance_proof_uploads for each row execute function pg_temp.fail_attach();
set local role authenticated;
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),1,1,1)$$,'P0001','TEST_ATTACH_FAILURE','attachment failure propagates');
select is((select count(*) from attendance_sessions),0::bigint,'attachment failure rolls back attendance');
select is((select count(*) from attendance_proofs),0::bigint,'attachment failure rolls back proof');
reset role;
select is((select state from private.attendance_proof_uploads where id=(select id from tickets where label='in')),'pending','failure retains pending reservation');
drop trigger aaa_test_failure on private.attendance_proof_uploads;
set local role authenticated;
create temp table receipt as select * from attendance_proof_finalize((select id from tickets where label='in'),14.6,121,10);
select is((select count(*) from attendance_sessions),1::bigint,'Time In exactly one session');
select is((select count(*) from attendance_proofs),1::bigint,'Time In exactly one proof');
select ok((select p.official_punch_at=s.time_in and p.action_type='time_in' from receipt p join attendance_sessions s on s.id=p.attendance_session_id),'Time In timestamps match');
select ok((select starts_today=1 and next_action='time_out' from attendance_summary()),'summary reports first open session');
select is((attendance_proof_finalize((select id from tickets where label='in'),14.6,121,10)).id,(select id from receipt),'lost response recovered by same upload');
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),14.7,121,10)$$,'P0001','REQUEST_CONFLICT','retry cannot change location');
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='stale_in'),1,1,1)$$,'P0001','ALREADY_TIMED_IN','different reservation cannot duplicate open');
insert into tickets values('out',pg_temp.ready('time_out')),('stale_out',pg_temp.ready('time_out'));
reset role;
create trigger aaa_test_failure before insert on attendance_proofs for each row execute function pg_temp.fail_insert();
set local role authenticated;
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='out'),1,1,1)$$,'P0001','TEST_PROOF_INSERT_FAILURE','Time Out proof failure propagates');
select ok((select time_out is null from attendance_sessions),'Time Out rolls back on proof failure');
reset role;
drop trigger aaa_test_failure on attendance_proofs;
set local role authenticated;
create temp table closed as select * from attendance_proof_finalize((select id from tickets where label='out'),1,1,1);
select ok((select p.official_punch_at=s.time_out and p.action_type='time_out' from closed p join attendance_sessions s on s.id=p.attendance_session_id),'Time Out exact timestamp');
select is((attendance_proof_finalize((select id from tickets where label='out'),1,1,1)).id,(select id from closed),'Time Out retry same receipt');
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='stale_in'),1,1,1)$$,'P0001','ATTENDANCE_STATE_CHANGED','OUT again does not validate old Time In intent');
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='stale_out'),1,1,1)$$,'P0001','ATTENDANCE_STATE_CHANGED','closed session cannot close twice');
insert into tickets values('second_in',pg_temp.ready('time_in'));
select lives_ok($$select attendance_proof_finalize((select id from tickets where label='second_in'),1,1,1)$$,'second proof-backed start');
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='stale_out'),1,1,1)$$,'P0001','ATTENDANCE_STATE_CHANGED','old Time Out cannot retarget session 2');
select is((attendance_proof_finalize((select id from tickets where label='in'),14.6,121,10)).id,(select id from receipt),'old successful Time In retry still returns first receipt');
insert into tickets values('second_out',pg_temp.ready('time_out'));
select lives_ok($$select attendance_proof_finalize((select id from tickets where label='second_out'),1,1,1)$$,'second proof-backed close');
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'P0001','DAILY_ATTENDANCE_LIMIT_REACHED','third prepare denied');
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='stale_in'),1,1,1)$$,'P0001','DAILY_ATTENDANCE_LIMIT_REACHED','third stale finalization denied');
select is((select count(*) from attendance_sessions),2::bigint,'only two sessions');
select is((select count(*) from attendance_proofs),4::bigint,'four punch proofs');
select ok((select days_present=1 and starts_today=2 and next_action='none' from attendance_summary()),'U3 completed state');
select is(attendance_days()->'days'->0->'sessions'->1->>'session_ordinal','2','derived second ordinal');
select ok((select completed_seconds=(select sum(extract(epoch from(time_out-time_in))) from attendance_sessions) from attendance_summary()),'completed seconds unchanged');
select throws_ok($$select attendance_proof_discard((select id from tickets where label='in'))$$,'P0001','PROOF_IN_USE','attached proof cannot discard');
reset role;
select is((select count(*) from private.attendance_proof_uploads where state='attached'),4::bigint,'exactly four attached reservations');

-- Legacy prior-day session: no fabricated Time In proof, only future Time Out.
insert into attendance_sessions(student_uid,time_in) values('85000000-0000-4000-8000-000000000006',(((clock_timestamp() at time zone 'Asia/Manila')::date-1)::timestamp at time zone 'Asia/Manila'));
set local role authenticated;
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000006',true);
create temp table legacy_before as select * from attendance_sessions;
select lives_ok($$select attendance_proof_finalize(pg_temp.ready('time_out'),-90,180,1000000)$$,'legacy open closes with proof, no accuracy cutoff');
select is((select count(*) from attendance_proofs),1::bigint,'only legacy Time Out proof');
select is((select action_type from attendance_proofs),'time_out','no fabricated Time In');
select is((select time_in from attendance_sessions),(select time_in from legacy_before),'historical timestamp preserved');
select ok((select starts_today=0 and days_present=1 and today_completed_seconds=0 from attendance_summary()),'overnight remains prior Manila day');
select is(jsonb_array_length(attendance_days()->'days'),1,'legacy history preserved');

select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000007',true);
create temp table cancelled as select * from attendance_proof_prepare(gen_random_uuid(),'time_in');
select attendance_proof_discard((select upload_id from cancelled));
select throws_ok($$select attendance_proof_finalize((select upload_id from cancelled),1,1,1)$$,'P0001','UPLOAD_EXPIRED_OR_DISCARDED','discarded finalization denied');
reset role;
insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,expected_starts_today,prepared_manila_day,photo_path,created_at,expires_at)
values('85000000-9999-4000-8000-000000000007',gen_random_uuid(),'85000000-0000-4000-8000-000000000007','time_in','85000000-8888-4000-8000-000000000007',0,current_date,
'85000000-0000-4000-8000-000000000007/85000000-8888-4000-8000-000000000007/85000000-9999-4000-8000-000000000007/proof',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour');
set local role authenticated;
select throws_ok($$select attendance_proof_finalize('85000000-9999-4000-8000-000000000007',1,1,1)$$,'P0001','UPLOAD_EXPIRED_OR_DISCARDED','expired finalization denied');
select is((select count(*) from attendance_sessions),0::bigint,'discard/expiry no attendance');
reset role;
-- A still-unexpired reservation prepared on a different Manila day must not start
-- a session today. Fixed intent fixture; never change the database clock.
insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,expected_starts_today,prepared_manila_day,photo_path,created_at,expires_at)
values('85000000-7777-4000-8000-000000000007',gen_random_uuid(),'85000000-0000-4000-8000-000000000007','time_in','85000000-6666-4000-8000-000000000007',0,(clock_timestamp() at time zone 'Asia/Manila')::date-1,
'85000000-0000-4000-8000-000000000007/85000000-6666-4000-8000-000000000007/85000000-7777-4000-8000-000000000007/proof',clock_timestamp(),clock_timestamp()+interval '1 hour');
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'attendance-proofs',photo_path,student_uid::text,'{"mimetype":"image/png","size":68}'::jsonb from private.attendance_proof_uploads where id='85000000-7777-4000-8000-000000000007';
set local role authenticated;
select throws_ok($$select attendance_proof_finalize('85000000-7777-4000-8000-000000000007',1,1,1)$$,'P0001','ATTENDANCE_STATE_CHANGED','Manila day change invalidates Time In intent');
reset role;
update profiles set status='rejected',approved_at=null,approved_by=null where id='85000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','85000000-0000-4000-8000-000000000002',true);
select throws_ok($$select attendance_proof_finalize((select id from tickets where label='in'),14.6,121,10)$$,'42501','APPROVED_STUDENT_REQUIRED','receipt replay still requires current approval');
reset role;
select * from finish();
rollback;
