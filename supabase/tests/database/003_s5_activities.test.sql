begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,email)
select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'s5-'||n||'@example.invalid' from generate_series(1,5)n;
insert into public.profiles(id,full_name,email,role,status,approved_at)
values('50000000-0000-4000-8000-000000000001','S5 Admin','s5-1@example.invalid','admin','approved',now());
insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
select id,'S5 Student',email,'S5-'||right(id::text,12),'student',
 case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,
 'BS Information Technology',486,case when right(id::text,1) in ('4','5') then null else now() end,
 case when right(id::text,1) in ('4','5') then null else '50000000-0000-4000-8000-000000000001'::uuid end
from auth.users where id::text like '50000000-%' and right(id::text,1)<>'1';

select ok(not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp'],
 'private bucket enforces 5MiB and image MIME allowlist') from storage.buckets where id='activity-proofs';
select ok(prosecdef and 'search_path=""'=any(proconfig),proname||' hardened definer') from pg_proc where oid in (
 'public.activity_prepare(uuid,uuid)'::regprocedure,'public.activity_create(uuid,text,text)'::regprocedure,
 'public.activity_edit(uuid,integer,text,text,uuid)'::regprocedure,'public.activity_discard_proof(uuid)'::regprocedure);
select ok(not prosecdef,'history retains invoker RLS') from pg_proc where oid='public.activity_history(integer,timestamptz,uuid)'::regprocedure;
select ok(not has_function_privilege('anon',oid,'execute'),proname||' denies anon') from pg_proc where pronamespace='public'::regnamespace and proname like 'activity_%';
select is((select count(*)::integer from pg_proc p,lateral aclexplode(p.proacl)a where p.pronamespace='public'::regnamespace
 and p.proname like 'activity_%' and a.grantee=0),0,'PUBLIC has no RPC grants');
select ok(not has_table_privilege('authenticated','private.activity_proof_uploads','SELECT'),'reservations not browser readable');
select ok(not has_function_privilege('authenticated','private.activity_student()','EXECUTE'),'lock helper is internal');

set local role anon;
select throws_ok($$select public.activity_prepare(gen_random_uuid())$$,'42501',null,'anonymous prepare denied');
select is((select count(*)::integer from storage.objects where bucket_id='activity-proofs'),0,'anonymous sees no proofs');
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.activity_prepare(gen_random_uuid())$$,'42501','AUTHENTICATION_REQUIRED','no UID denied');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.activity_prepare(gen_random_uuid())$$,'42501','APPROVED_STUDENT_REQUIRED','pending denied');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.activity_prepare(gen_random_uuid())$$,'42501','APPROVED_STUDENT_REQUIRED','rejected denied');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.activity_prepare(gen_random_uuid())$$,'42501','APPROVED_STUDENT_REQUIRED','admin prepare denied');
select throws_ok($$select public.activity_create(gen_random_uuid(),'Other','text')$$,'42501','APPROVED_STUDENT_REQUIRED','admin create denied');
select throws_ok($$select public.activity_edit(gen_random_uuid(),0,'Other','text')$$,'42501','APPROVED_STUDENT_REQUIRED','admin edit denied');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.activity_prepare(gen_random_uuid())$$,'P0001','NO_OPEN_ATTENDANCE','OUT student cannot prepare creation');
select public.attendance_time_in();
create temp table draft as select * from public.activity_prepare('51000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from draft),1,'approved student prepares one upload');
select ok((select photo_path=auth.uid()::text||'/'||activity_id::text||'/proof' from draft),'server canonical path and ID');
select is((select upload_id from public.activity_prepare('51000000-0000-4000-8000-000000000001')),
 (select upload_id from draft),'prepare retry returns same reservation');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other','text')$$,'P0001','PROOF_REQUIRED','no object cannot create activity');
select throws_ok($$select public.activity_create((select upload_id from draft),'Forged','text')$$,'22023','INVALID_CATEGORY','category whitelist');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other',null)$$,'22023','INVALID_DESCRIPTION','null description');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other',U&'\2003\00A0')$$,'22023','INVALID_DESCRIPTION','Unicode whitespace required');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other',repeat('😀',501))$$,'22023','INVALID_DESCRIPTION','501 Unicode characters rejected');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other','text',now())$$,'42883',null,'no client timestamp argument');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other','text',auth.uid())$$,'42883',null,'no client student UID argument');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other','text',gen_random_uuid())$$,'42883',null,'no arbitrary session reassignment argument');

-- SQL fixtures only: metadata simulates Storage service ingestion and rolls back.
-- Real bytes/MIME/size/private URL behavior is covered by the HTTP Storage suite.
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'activity-proofs',photo_path,'50000000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":100}'::jsonb from draft;
set local role authenticated;
create temp table created as select * from public.activity_create((select upload_id from draft),'Other',repeat('😀',500));
select is((select char_length(description) from created),500,'500 Unicode characters accepted, not UTF8 bytes');
select ok((select student_uid=auth.uid() and attendance_session_id=(select attendance_session_id from draft) from created),'server owner and reserved own session');
select ok((select created_at between (select transaction_timestamp()) and clock_timestamp() and updated_at is null and revision=0 from created),'server created_at, no initial edit');
select is((select id from public.activity_create((select upload_id from draft),'Other',repeat('😀',500))),
 (select id from created),'identical create retry idempotent');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other','different')$$,'P0001','ACTIVITY_ALREADY_EXISTS','conflicting retry cannot overwrite');
select throws_ok($$select public.activity_discard_proof((select upload_id from draft))$$,'P0001','PROOF_IN_USE','attached proof cannot be discarded');
select is((select count(*)::integer from public.activity_history()),1,'own paginated history');
select throws_ok($$select public.activity_history(101)$$,'22023','INVALID_PAGE','page size bounded');
select throws_ok($$select public.activity_history(25,now(),null)$$,'22023','INVALID_PAGE','cursor pair required');
select is((select count(*)::integer from public.activity_history(1,(select created_at from created),(select id from created))),0,'keyset excludes cursor itself');
select throws_ok($$insert into public.activities select * from created$$,'42501',null,'direct activity insert blocked');
select throws_ok($$update public.activities set description='forged'$$,'42501',null,'direct activity update blocked');
select throws_ok($$delete from public.activities$$,'42501',null,'direct activity delete blocked');
select is((select count(*)::integer from storage.objects where bucket_id='activity-proofs'),1,'owner reads own proof');

select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.activities),0,'other student sees no activities');
select is((select count(*)::integer from storage.objects where bucket_id='activity-proofs'),0,'other student sees no proofs');
select throws_ok($$select public.activity_create((select upload_id from draft),'Other','text')$$,'P0001','INVALID_UPLOAD','other owner reservation denied');
select throws_ok($$select public.activity_edit((select id from created),0,'Other','text')$$,'P0001','ACTIVITY_NOT_FOUND','other activity edit denied');
select throws_ok($$select public.activity_prepare(gen_random_uuid(),(select id from created))$$,'P0001','ACTIVITY_NOT_FOUND','other activity replacement denied');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.activities),1,'approved admin activity read retained');
select is((select count(*)::integer from storage.objects where bucket_id='activity-proofs'),1,'admin reads attached proof');

select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000002',true);
create temp table unfinished as select * from public.activity_prepare(gen_random_uuid());
select public.attendance_time_out();
select throws_ok($$select public.activity_create((select upload_id from unfinished),'Other','late')$$,'P0001','NO_OPEN_ATTENDANCE','Time Out during upload prevents late creation');
create temp table edited as select * from public.activity_edit((select id from created),0,'Documentation','  Updated résumé 日本語  ');
select ok((select e.created_at=c.created_at and e.student_uid=c.student_uid and e.attendance_session_id=c.attendance_session_id from edited e cross join created c),'edit preserves original identity/session/created_at');
select ok((select updated_at>=created_at and updated_at<=clock_timestamp() and revision=1 from edited),'updated_at and revision server controlled');
select is((select description from edited),'Updated résumé 日本語','trimmed Unicode edit after Time Out');
select throws_ok($$select public.activity_edit((select id from created),0,'Other','stale')$$,'P0001','ACTIVITY_CHANGED','stale edit cannot overwrite');
create temp table replacement as select * from public.activity_prepare(gen_random_uuid(),(select id from created));
select ok((select photo_path<> (select photo_path from draft) and base_revision=1 from replacement),'replacement uses immutable version path');
select throws_ok($$select public.activity_edit((select id from created),1,'Other','new',(select upload_id from replacement))$$,'P0001','PROOF_REQUIRED','failed replacement leaves old proof');
select is((select photo_path from public.activities),(select photo_path from created),'original proof stays attached after failed replacement');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'activity-proofs',photo_path,'50000000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":101}'::jsonb from replacement;
set local role authenticated;
select lives_ok($$select public.activity_edit((select id from created),1,'IT Support','Replaced',(select upload_id from replacement))$$,'replacement commits');
select is((select photo_path from public.activities),(select photo_path from replacement),'new proof attached');
select is((select count(*)::integer from storage.objects where bucket_id='activity-proofs'),2,'old bytes retained until safe cleanup');
select is(public.activity_discard_proof((select upload_id from draft)),(select photo_path from draft),'retired path tombstoned before deletion');
select throws_ok($$select public.activity_discard_proof((select upload_id from replacement))$$,'P0001','PROOF_IN_USE','replacement cannot be deleted while active');
select is(public.activity_discard_proof((select upload_id from unfinished)),(select photo_path from unfinished),'abandoned pending proof can be discarded');
select throws_ok($$select public.activity_create((select upload_id from unfinished),'Other','late')$$,'P0001','UPLOAD_EXPIRED_OR_DISCARDED','discard cannot race into finalization');
select ok(not private.activity_storage_allowed((select photo_path from draft),'upload'),'retired discarded path cannot be uploaded again');
select ok(private.activity_storage_allowed((select photo_path from draft),'delete'),'only discarded own path eligible for delete');
select ok(not private.activity_storage_allowed((select photo_path from replacement),'delete'),'active path denies delete');

reset role;
select throws_ok($$update public.activities set revision=10,updated_at=null$$,'23514',null,'edited revision requires a nonnull timestamp');
select throws_ok($$update public.activities set updated_at=created_at-interval '1 second'$$,'23514',null,'edit timestamp cannot precede creation');
select * from finish();
rollback;
