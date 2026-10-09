-- LOCAL synthetic fixtures only; no bytes, hosted calls, or retained data.
begin;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('attendance-proofs','attendance-proofs',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
insert into auth.users(id,email) select ('87300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'u73e-'||n||'@example.invalid' from generate_series(1,5)n;
insert into profiles(id,full_name,email,role,status,approved_at)
 values('87300000-0000-4000-8000-000000000001','Synthetic admin','u73e-1@example.invalid','admin','approved',now());
insert into profiles(id,full_name,email,role,status,student_id,program,required_hours,approved_at,approved_by)
select id,'Synthetic student',email,'student',case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,
 'U73E-'||right(id::text,1),'BS Information Technology',486,
 case when right(id::text,1) in ('2','3') then now() end,
 case when right(id::text,1) in ('2','3') then '87300000-0000-4000-8000-000000000001'::uuid end
from auth.users where id::text like '87300000-%' and right(id::text,1)<>'1';
-- Same request UUID owned independently by A and B. No prepare invocation.
insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,
 expected_starts_today,prepared_manila_day,photo_path,expires_at)
select ('87300000-1000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '87300000-2000-4000-8000-000000000000'::uuid,
 ('87300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'time_in',
 ('87300000-3000-4000-8000-'||lpad(n::text,12,'0'))::uuid,0,(now() at time zone 'Asia/Manila')::date,
 '87300000-0000-4000-8000-'||lpad(n::text,12,'0')||'/87300000-3000-4000-8000-'||lpad(n::text,12,'0')||'/87300000-1000-4000-8000-'||lpad(n::text,12,'0')||'/proof',now()+interval '1 hour'
from generate_series(2,3)n;
create temp table before_counts as select (select count(*) from attendance_sessions) attendance,
 (select count(*) from public.attendance_proofs) proofs,(select count(*) from private.attendance_proof_uploads) reservations,
 (select count(*) from storage.objects) objects;
grant select on before_counts to authenticated;
select ok(not has_function_privilege('anon','public.attendance_proof_recovery_lookup(uuid)','EXECUTE'),'anon no lookup');
select ok(has_function_privilege('authenticated','public.attendance_proof_recovery_lookup(uuid)','EXECUTE'),'authenticated lookup grant');
select ok(has_function_privilege('authenticated','public.attendance_proof_recovery_upload_status(uuid,uuid)','EXECUTE'),'authenticated status grant');
select ok(not has_function_privilege('authenticated','private.attendance_recovery_snapshot(uuid,uuid,boolean)','EXECUTE'),'helper private');
select ok(not has_table_privilege('authenticated','private.attendance_proof_uploads','SELECT'),'no new private table grant');
select ok(not has_table_privilege('attendance_recovery_reader','storage.objects','INSERT,UPDATE,DELETE'),'reader no Storage writes');
select ok(not has_table_privilege('attendance_recovery_reader','public.attendance_sessions','INSERT,UPDATE,DELETE'),'reader no attendance writes');
select ok(not has_function_privilege('attendance_recovery_reader','public.attendance_proof_prepare(uuid,text)','EXECUTE'),'reader cannot prepare');
select ok(not has_function_privilege('attendance_recovery_reader','public.attendance_proof_finalize(uuid,numeric,numeric,numeric)','EXECUTE'),'reader cannot finalize');
select ok(not has_function_privilege('attendance_recovery_reader','public.attendance_proof_discard(uuid)','EXECUTE'),'reader cannot discard');
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls from pg_roles where rolname='attendance_recovery_reader'),'dedicated nonlogin nonbypass role');
select ok(not pg_has_role('authenticated','attendance_recovery_reader','MEMBER'),'client cannot assume reader');
select ok(not pg_has_role('postgres','attendance_recovery_reader','MEMBER'),'migration membership removed');
select ok((select bool_and(provolatile='s' and proconfig=array['search_path=pg_catalog, pg_temp']) from pg_proc where oid in
 ('public.attendance_proof_recovery_lookup(uuid)'::regprocedure,'public.attendance_proof_recovery_upload_status(uuid,uuid)'::regprocedure,
 'private.attendance_recovery_snapshot(uuid,uuid,boolean)'::regprocedure)),'stable catalog-first temp-last search path');
select ok(not exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='public.attendance_proof_recovery_lookup(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'no PUBLIC execution');
select ok(not has_schema_privilege('attendance_recovery_reader','public','CREATE'),'reader no CREATE');
select ok(not (select public from storage.buckets where id='attendance-proofs'),'bucket still private');
-- Authenticated callers have TEMP but cannot inject a type into definer execution.
set local role authenticated;
create temporary table recovery_shadow_init(x integer);
create function pg_temp.recovery_domain_probe(v pg_catalog.uuid) returns boolean language plpgsql as $$
begin raise exception using errcode='P0001',message='UNTRUSTED_DOMAIN_EXECUTED'; end; $$;
create domain pg_temp.uuid as pg_catalog.uuid check(pg_temp.recovery_domain_probe(value));
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000'::pg_catalog.uuid)$$,
 '42501','APPROVED_STUDENT_REQUIRED','temp type cannot execute before pending denial');
select throws_ok($$select public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000'::pg_catalog.uuid,'87300000-1000-4000-8000-000000000002'::pg_catalog.uuid)$$,
 '42501','APPROVED_STUDENT_REQUIRED','temp type cannot execute inside upload-status helper');
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000'::pg_catalog.uuid)$$,'approved lookup ignores malicious temp type');
drop domain pg_temp.uuid;
drop function pg_temp.recovery_domain_probe(pg_catalog.uuid);
reset role;
set local role anon;
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')$$,'42501',null,'anon denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')$$,'42501','AUTHENTICATION_REQUIRED','missing user denied');
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')$$,'42501','APPROVED_STUDENT_REQUIRED','admin denied');
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')$$,'42501','APPROVED_STUDENT_REQUIRED','pending denied');
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')$$,'42501','APPROVED_STUDENT_REQUIRED','rejected denied');
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.attendance_proof_recovery_lookup(null)$$,'22023','RECOVERY_ID_REQUIRED','null request denied');
select throws_ok($$select public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000',null)$$,'22023','RECOVERY_ID_REQUIRED','null upload denied');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->>'lookup_status','found','approved owner found');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->'reservation'->>'upload_id','87300000-1000-4000-8000-000000000002','preserves original A upload');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->>'object_status','not_checked','lookup no object probe');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->>'receipt_status','missing','no fabricated receipt');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000099')->>'lookup_status','not_found','missing request observation');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000099')->'reservation','null'::jsonb,'missing no identity');
select throws_ok($$select public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000003')$$,'22023','RECOVERY_IDENTITY_MISMATCH','foreign upload cannot replace A');
select is(public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')->>'object_status','missing','missing exact reserved object');
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000003',true);
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->'reservation'->>'upload_id','87300000-1000-4000-8000-000000000003','same request across B resolves only B');
reset role;
-- A-only request verifies uniform not-found behavior for B.
insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,
 expected_starts_today,prepared_manila_day,photo_path,expires_at)
select '87300000-1000-4000-8000-000000000099','87300000-2000-4000-8000-000000000099',student_uid,action_type,
 attendance_session_id,0,prepared_manila_day,student_uid::text||'/'||attendance_session_id::text||'/87300000-1000-4000-8000-000000000099/proof',expires_at
from private.attendance_proof_uploads where id='87300000-1000-4000-8000-000000000002';
set local role authenticated;
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000099')->>'lookup_status','not_found','B cannot see A-only request');
select is(public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000099','87300000-1000-4000-8000-000000000099')->>'lookup_status','not_found','B foreign upload also no oracle');
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000002',true);
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'attendance-proofs',photo_path,student_uid::text,'{"mimetype":"image/jpeg","size":123}'::jsonb
from private.attendance_proof_uploads where id='87300000-1000-4000-8000-000000000002';
set local role authenticated;
select is(public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')->>'object_status','present','valid metadata observed');
select is(public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')->>'receipt_status','missing','present does not punch');
select ok(not (public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')::text ~ 'photo_path|latitude|longitude|mimetype|metadata|https://'),'minimal response no sensitive metadata');
reset role;
create function pg_temp.check_metadata(meta jsonb,expected text) returns boolean language plpgsql as $$
begin
 update storage.objects set metadata=meta where bucket_id='attendance-proofs' and name like '87300000-0000-4000-8000-000000000002/%';
 return public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')->>'object_status'=expected;
end; $$;
select ok(pg_temp.check_metadata('{"mimetype":"text/plain","size":123}','invalid'),'wrong MIME invalid');
select ok(pg_temp.check_metadata('{"mimetype":"image/jpeg","size":0}','invalid'),'zero invalid');
select ok(pg_temp.check_metadata('{"mimetype":"image/jpeg","size":5242881}','invalid'),'overlimit invalid');
select ok(pg_temp.check_metadata('{"mimetype":"image/jpeg","size":"NaN"}','invalid'),'NaN invalid');
select ok(pg_temp.check_metadata('{"mimetype":"image/jpeg"}','invalid'),'missing size invalid');
select ok(pg_temp.check_metadata('null','invalid'),'null metadata invalid');
select ok(pg_temp.check_metadata(jsonb_build_object('mimetype','image/jpeg','size',repeat('9',10000)),'invalid'),'large numeric rejected before cast');
select ok(pg_temp.check_metadata('{"mimetype":"image/jpeg","size":5242880}','present'),'exact limit valid');
update storage.objects set owner_id='87300000-0000-4000-8000-000000000003'
 where name like '87300000-0000-4000-8000-000000000002/%';
select is(public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')->>'object_status','invalid','wrong Storage owner invalid');
select is((select count(*) from attendance_sessions),(select attendance from before_counts),'no attendance mutation by reads');
select is((select count(*) from attendance_proofs),(select proofs from before_counts),'no proof insertion by reads');
select is((select count(*) from private.attendance_proof_uploads),(select reservations+1 from before_counts),'reads add no reservations beyond explicit fixture');
select is((select count(*) from storage.objects),(select objects+1 from before_counts),'reads add no objects beyond explicit fixture');
-- Full receipt confirmation uses synthetic session/object fixture only.
update storage.objects set owner_id='87300000-0000-4000-8000-000000000002',
 metadata='{"mimetype":"image/jpeg","size":123}'::jsonb
 where name like '87300000-0000-4000-8000-000000000002/%';
insert into attendance_sessions(id,student_uid,time_in)
 values('87300000-3000-4000-8000-000000000002','87300000-0000-4000-8000-000000000002',clock_timestamp());
insert into attendance_proofs(attendance_session_id,student_uid,action_type,photo_path,upload_id,official_punch_at,latitude,longitude,accuracy)
select p.attendance_session_id,p.student_uid,p.action_type,p.photo_path,p.id,s.time_in,0,0,1
from private.attendance_proof_uploads p join attendance_sessions s on s.id=p.attendance_session_id
where p.id='87300000-1000-4000-8000-000000000002';
set local role authenticated;
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->>'receipt_status','confirmed','valid immutable receipt confirms');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->'receipt'->>'attendance_session_id','87300000-3000-4000-8000-000000000002','exact confirmed session');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->'reservation'->>'state','attached','server state attached');
select ok(not (public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')->'receipt' ? 'latitude'),'receipt projection no coordinates');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000'),public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000'),'duplicate read same snapshot idempotent');
select throws_ok('select id from private.attendance_proof_uploads','42501',null,'authenticated cannot inspect reservations directly');
reset role;
set local role attendance_recovery_reader;
select count(*) as recovery_owned_count from private.attendance_proof_uploads
\gset
reset role;
select is(:recovery_owned_count::bigint,2::bigint,'reader RLS sees only A reservations');
select ok(not has_column_privilege('attendance_recovery_reader','public.attendance_proofs','latitude','SELECT'),'reader cannot fetch GPS');
select ok(not has_column_privilege('attendance_recovery_reader','public.profiles','full_name','SELECT'),'reader cannot fetch unrelated profile fields');
-- Infinite expiry is schema-valid but not a valid wire timestamp; uncertainty retained.
insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,
 expected_starts_today,prepared_manila_day,photo_path,expires_at)
values('87300000-1000-4000-8000-000000000088','87300000-2000-4000-8000-000000000088',
 '87300000-0000-4000-8000-000000000002','time_in','87300000-3000-4000-8000-000000000088',0,
 (now() at time zone 'Asia/Manila')::date,
 '87300000-0000-4000-8000-000000000002/87300000-3000-4000-8000-000000000088/87300000-1000-4000-8000-000000000088/proof','infinity');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000088')->>'lookup_status','unknown','inconsistent timestamp unknown, not missing');
select is(public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000088')->'reservation','null'::jsonb,'unknown no partial identity');
-- Missing profile and post-read authority changes must fail closed.
set local role authenticated;
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000077',true);
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')$$,'42501','APPROVED_STUDENT_REQUIRED','missing profile denied');
reset role;
update public.profiles set status='rejected',approved_at=null,approved_by=null where id='87300000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')$$,'42501','APPROVED_STUDENT_REQUIRED','revocation denies receipt previously confirmed');
select throws_ok($$select public.attendance_proof_recovery_upload_status('87300000-2000-4000-8000-000000000000','87300000-1000-4000-8000-000000000002')$$,'42501','APPROVED_STUDENT_REQUIRED','revocation denies metadata previously present');
reset role;
update public.profiles set role='admin',student_id=null,program=null,required_hours=null where id='87300000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.attendance_proof_recovery_lookup('87300000-2000-4000-8000-000000000000')$$,'42501','APPROVED_STUDENT_REQUIRED','role change within transaction denies former student');
reset role;
select * from finish();
rollback;
