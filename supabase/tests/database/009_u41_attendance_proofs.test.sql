begin;
\ir ../helpers/legacy-attendance.inc
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,email) select ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'u41-'||n||'@example.invalid' from generate_series(1,5)n;
insert into profiles(id,full_name,email,role,status,approved_at) values('84000000-0000-4000-8000-000000000001','U41 Admin','u41-1@example.invalid','admin','approved',now());
insert into profiles(id,full_name,email,role,status,student_id,program,required_hours,approved_at,approved_by)
select id,'U41 Student',email,'student',case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,
 'U41-'||right(id::text,1),'BS Information Technology',486,
 case when right(id::text,1) in ('2','3') then now() end,
 case when right(id::text,1) in ('2','3') then '84000000-0000-4000-8000-000000000001'::uuid end
from auth.users where id::text like '84000000-%' and right(id::text,1)<>'1';

select ok(not has_table_privilege('authenticated','attendance_proofs','INSERT,UPDATE,DELETE'),'no browser proof mutations');
select ok(not has_table_privilege('authenticated','private.attendance_proof_uploads','SELECT,INSERT,UPDATE,DELETE'),'reservations private');
select ok(not has_function_privilege('anon','attendance_proof_prepare(uuid,text)','EXECUTE'),'anon no prepare grant');
select ok(not has_function_privilege('authenticated','private.attendance_proof_student()','EXECUTE'),'private helper unavailable');
select ok(not exists(select 1 from pg_publication_tables where tablename in ('attendance_proofs','attendance_proof_uploads')),'no proof/location realtime');
select ok((select not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp'] from storage.buckets where id='attendance-proofs'),'private restricted bucket');

set local role anon;
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'42501',null,'anonymous denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'42501','AUTHENTICATION_REQUIRED','missing identity denied');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'42501','APPROVED_STUDENT_REQUIRED','admin denied');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000004',true);
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'42501','APPROVED_STUDENT_REQUIRED','pending denied');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000005',true);
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'42501','APPROVED_STUDENT_REQUIRED','rejected denied');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000002',true);
select throws_ok($$select attendance_proof_prepare(null,'time_in')$$,'22023','REQUEST_ID_REQUIRED','request required');
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'other')$$,'22023','INVALID_ACTION','invalid action');
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),null)$$,'22023','INVALID_ACTION','null action');
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_out')$$,'P0001','NO_OPEN_ATTENDANCE','no open session');
create temp table first_ticket as select * from attendance_proof_prepare('84000000-1111-4000-8000-000000000002','time_in');
select is((select upload_id from attendance_proof_prepare('84000000-1111-4000-8000-000000000002','time_in')),(select upload_id from first_ticket),'idempotent preparation');
select is((select count(*) from attendance_sessions),0::bigint,'preparation never creates attendance');
select ok((select starts_today=0 and days_present=0 and open_session_id is null from attendance_summary()),'preparation has no attendance effect');
select throws_ok($$select attendance_proof_prepare('84000000-1111-4000-8000-000000000002','time_out')$$,'P0001','REQUEST_CONFLICT','request intent immutable');
select lives_ok('select pg_temp.legacy_time_in()','legacy first Time In unchanged');
select throws_ok($$select attendance_proof_prepare('84000000-1111-4000-8000-000000000002','time_in')$$,'P0001','ATTENDANCE_STATE_CHANGED','stale reservation rejected');
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'P0001','ALREADY_TIMED_IN','one open preserved');
create temp table close_ticket as select * from attendance_proof_prepare('84000000-2222-4000-8000-000000000002','time_out');
create temp table duplicate_close as select * from attendance_proof_prepare(gen_random_uuid(),'time_out');
select is((select attendance_session_id from close_ticket),(select open_session_id from attendance_summary()),'Time Out bound exactly');
select lives_ok('select pg_temp.legacy_time_out()','legacy first Time Out unchanged');
select throws_ok($$select attendance_proof_prepare('84000000-2222-4000-8000-000000000002','time_out')$$,'P0001','ATTENDANCE_STATE_CHANGED','closed timeout cannot retarget');
select lives_ok('select pg_temp.legacy_time_in()','legacy second Time In unchanged');
select lives_ok('select pg_temp.legacy_time_out()','legacy second Time Out unchanged');
select throws_ok($$select attendance_proof_prepare(gen_random_uuid(),'time_in')$$,'P0001','DAILY_ATTENDANCE_LIMIT_REACHED','prepare denies third start');
select throws_ok('select pg_temp.legacy_time_in()','P0001','DAILY_ATTENDANCE_LIMIT_REACHED','legacy denies third start');
select ok((select starts_today=2 and days_present=1 and completed_sessions=2 from attendance_summary()),'U3 summary unchanged');
select is(jsonb_array_length(attendance_days()->'days'->0->'sessions'),2,'U3 grouped day unchanged');

select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000003',true);
select throws_ok($$select attendance_proof_discard((select upload_id from first_ticket))$$,'P0001','INVALID_UPLOAD','cross-owner discard denied');
create temp table discarded as select * from attendance_proof_prepare('84000000-3333-4000-8000-000000000003','time_in');
select is(attendance_proof_discard((select upload_id from discarded)),(select photo_path from discarded),'pending discard');
select is(attendance_proof_discard((select upload_id from discarded)),(select photo_path from discarded),'repeat discard safe');
select throws_ok($$select attendance_proof_prepare('84000000-3333-4000-8000-000000000003','time_in')$$,'P0001','UPLOAD_EXPIRED_OR_DISCARDED','discard cannot revive');
reset role;
select throws_ok($$update private.attendance_proof_uploads set state='pending' where id=(select upload_id from discarded)$$,'P0001','IMMUTABLE_UPLOAD','terminal state immutable');
select throws_ok($$update private.attendance_proof_uploads set state='attached' where id=(select upload_id from first_ticket)$$,'P0001','PROOF_REQUIRED','cannot attach without proof');
select throws_ok($$update private.attendance_proof_uploads set action_type='invalid' where id=(select upload_id from first_ticket)$$,'P0001','IMMUTABLE_UPLOAD','reservation intent immutable');

-- Trusted LOCAL fixtures exercise insertion invariants; no public finalizer exists.
-- Metadata-only objects are rolled back; actual bytes are tested through Storage API.
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'attendance-proofs',photo_path,'84000000-0000-4000-8000-000000000002',jsonb_build_object('mimetype','image/png','size',68) from close_ticket
union all select 'attendance-proofs',photo_path,'84000000-0000-4000-8000-000000000002',jsonb_build_object('mimetype','image/png','size',68) from duplicate_close;
create function pg_temp.insert_proof(ticket_id uuid,lat numeric default 14.6,lon numeric default 121,acc numeric default 10)
returns void language sql as $$
insert into public.attendance_proofs(attendance_session_id,student_uid,action_type,photo_path,upload_id,official_punch_at,latitude,longitude,accuracy)
select p.attendance_session_id,p.student_uid,p.action_type,p.photo_path,p.id,
 case p.action_type when 'time_in' then s.time_in else s.time_out end,lat,lon,acc
from private.attendance_proof_uploads p join public.attendance_sessions s on s.id=p.attendance_session_id where p.id=ticket_id;
$$;
select throws_ok($$select pg_temp.insert_proof((select upload_id from close_ticket),91)$$,'23514',null,'latitude bounded');
select throws_ok($$select pg_temp.insert_proof((select upload_id from close_ticket),14,181)$$,'23514',null,'longitude bounded');
select throws_ok($$select pg_temp.insert_proof((select upload_id from close_ticket),14,121,-1)$$,'23514',null,'negative accuracy rejected');
select throws_ok($$select pg_temp.insert_proof((select upload_id from close_ticket),14,121,'NaN')$$,'23514',null,'NaN rejected');
select throws_ok($$select pg_temp.insert_proof((select upload_id from close_ticket),14,121,'Infinity')$$,'23514',null,'infinite accuracy rejected');
select lives_ok($$select pg_temp.insert_proof((select upload_id from close_ticket))$$,'trusted proof fixture accepted');
select is((select state from private.attendance_proof_uploads where id=(select upload_id from close_ticket)),'attached','insert attaches reservation atomically');
select throws_ok($$select pg_temp.insert_proof((select upload_id from duplicate_close))$$,'23505',null,'one proof per session and action');
select throws_ok($$update attendance_proofs set latitude=0$$,'P0001','IMMUTABLE_ATTENDANCE_PROOF','coordinates immutable even in trusted SQL');
select throws_ok($$update attendance_proofs set action_type='time_in'$$,'P0001','IMMUTABLE_ATTENDANCE_PROOF','action immutable');
select throws_ok($$delete from attendance_proofs$$,'P0001','IMMUTABLE_ATTENDANCE_PROOF','attached proof cannot delete');
select throws_ok($$update private.attendance_proof_uploads set state='discarded' where id=(select upload_id from close_ticket)$$,'P0001','IMMUTABLE_UPLOAD','attached reservation cannot discard');
select throws_ok($$insert into attendance_proofs(attendance_session_id,student_uid,action_type,photo_path,upload_id,official_punch_at,latitude,longitude,accuracy)
select attendance_session_id,'84000000-0000-4000-8000-000000000003','time_out',photo_path,upload_id,now(),0,0,0 from duplicate_close$$,'P0001','INVALID_UPLOAD','cross-student proof rejected');
select throws_ok($$insert into attendance_proofs(attendance_session_id,student_uid,action_type,photo_path,upload_id,official_punch_at,latitude,longitude,accuracy)
select attendance_session_id,'84000000-0000-4000-8000-000000000002','invalid',photo_path,upload_id,now(),0,0,0 from duplicate_close$$,'P0001','INVALID_UPLOAD','invalid proof action rejected');
select throws_ok($$insert into attendance_proofs(attendance_session_id,student_uid,action_type,photo_path,upload_id,official_punch_at,latitude,longitude,accuracy)
select attendance_session_id,'84000000-0000-4000-8000-000000000002','time_out',photo_path,upload_id,now()-interval '1 day',0,0,0 from duplicate_close$$,'P0001','INVALID_OFFICIAL_PUNCH','client timestamp cannot become official');

set local role authenticated;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000002',true);
select is((select count(*) from attendance_proofs),1::bigint,'owner reads attached metadata');
select throws_ok($$select attendance_proof_discard((select upload_id from close_ticket))$$,'P0001','PROOF_IN_USE','student cleanup cannot discard attached');
select ok(not private.attendance_proof_storage_allowed((select photo_path from close_ticket),'delete'),'attached bytes not deletable');
select ok(not private.attendance_proof_storage_allowed((select photo_path from close_ticket),'upload'),'attached bytes not overwritable');
select throws_ok('delete from attendance_proofs','42501',null,'browser proof delete denied');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000003',true);
select is((select count(*) from attendance_proofs),0::bigint,'other student metadata hidden');
select ok(not private.attendance_proof_storage_allowed((select photo_path from close_ticket),'read'),'other student bytes hidden');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
select is((select count(*) from attendance_proofs),1::bigint,'approved admin reads metadata');
select ok(private.attendance_proof_storage_allowed((select photo_path from close_ticket),'read'),'admin attached bytes permitted');
select ok(not private.attendance_proof_storage_allowed((select photo_path from duplicate_close),'read'),'admin uncommitted bytes hidden');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000004',true);
select is((select count(*) from attendance_proofs),0::bigint,'pending metadata hidden');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000005',true);
select is((select count(*) from attendance_proofs),0::bigint,'rejected metadata hidden');
reset role;

-- Additional Time In/expiry fixtures, all rolled back with this test transaction.
insert into attendance_sessions(id,student_uid,time_in,time_out)
select attendance_session_id,'84000000-0000-4000-8000-000000000003',clock_timestamp(),clock_timestamp() from discarded;
select throws_ok($$select pg_temp.insert_proof((select upload_id from discarded))$$,'P0001','UPLOAD_EXPIRED_OR_DISCARDED','discarded upload cannot attach even if matching session later exists');
set local role authenticated;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000003',true);
create temp table valid_in as select * from attendance_proof_prepare('84000000-4444-4000-8000-000000000003','time_in');
reset role;
insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,expected_latest_session_id,expected_starts_today,prepared_manila_day,photo_path,created_at,expires_at)
select '84000000-5555-4000-8000-000000000003','84000000-5555-4000-8000-000000000003',student_uid,action_type,attendance_session_id,expected_latest_session_id,expected_starts_today,prepared_manila_day,
 student_uid::text||'/'||attendance_session_id::text||'/84000000-5555-4000-8000-000000000003/proof',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour'
from private.attendance_proof_uploads where id=(select upload_id from valid_in);
set local role authenticated;
select throws_ok($$select attendance_proof_prepare('84000000-5555-4000-8000-000000000003','time_in')$$,'P0001','UPLOAD_EXPIRED_OR_DISCARDED','expired retry rejected');
select ok(not private.attendance_proof_storage_allowed((select replace(photo_path,upload_id::text,'84000000-5555-4000-8000-000000000003') from valid_in),'upload'),'expired upload rejected');
select lives_ok($$select attendance_proof_discard('84000000-5555-4000-8000-000000000003')$$,'expired reservation can be tombstoned for cleanup');
reset role;
insert into attendance_sessions(id,student_uid,time_in)
select attendance_session_id,'84000000-0000-4000-8000-000000000003',clock_timestamp() from valid_in;
select throws_ok($$select pg_temp.insert_proof((select upload_id from valid_in))$$,'P0001','PROOF_REQUIRED','missing object cannot attach');
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'attendance-proofs',photo_path,'84000000-0000-4000-8000-000000000003',jsonb_build_object('mimetype','text/plain','size',68) from valid_in;
select throws_ok($$select pg_temp.insert_proof((select upload_id from valid_in))$$,'22023','INVALID_PROOF','metadata MIME checked before attachment');
update storage.objects set metadata=jsonb_build_object('mimetype','image/png','size',5242881) where name=(select photo_path from valid_in);
select throws_ok($$select pg_temp.insert_proof((select upload_id from valid_in))$$,'22023','INVALID_PROOF','metadata size checked before attachment');
update storage.objects set metadata=jsonb_build_object('mimetype','image/png','size',68) where name=(select photo_path from valid_in);
select lives_ok($$select pg_temp.insert_proof((select upload_id from valid_in),-90,-180,1000000)$$,'Time In proof accepted; no invented accuracy cutoff');
select throws_ok($$select pg_temp.insert_proof((select upload_id from valid_in))$$,'P0001','UPLOAD_EXPIRED_OR_DISCARDED','reservation single-use');
set local role authenticated;
create temp table valid_out as select * from attendance_proof_prepare(gen_random_uuid(),'time_out');
select lives_ok('select pg_temp.legacy_time_out()','Time In proof does not obstruct legacy Time Out');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'attendance-proofs',photo_path,'84000000-0000-4000-8000-000000000003',jsonb_build_object('mimetype','image/png','size',68) from valid_out;
select lives_ok($$select pg_temp.insert_proof((select upload_id from valid_out))$$,'same session may hold separate Time In and Time Out proofs');
select is((select count(*) from attendance_proofs where attendance_session_id=(select attendance_session_id from valid_in)),2::bigint,'exactly two distinct punch proofs');
select throws_ok($$insert into private.attendance_proof_uploads select * from private.attendance_proof_uploads where id=(select upload_id from valid_out)$$,'23505',null,'reservation identity cannot duplicate');
select ok(exists(select 1 from pg_constraint where conrelid='attendance_proofs'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (photo_path)'),'attached object path uniqueness');
select ok(exists(select 1 from pg_constraint where conrelid='attendance_proofs'::regclass and contype='f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (attendance_session_id, student_uid)%'),'composite session ownership FK enforced');
select * from finish();
rollback;
