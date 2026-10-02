begin;
\ir ../helpers/legacy-attendance.inc
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users(id, email)
select ('30000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 's3-sql-' || n || '@example.invalid'
from generate_series(1,9) n;
insert into public.profiles(id, full_name, email, role, status, approved_at)
values ('30000000-0000-4000-8000-000000000001','S3 Admin','s3-sql-1@example.invalid','admin','approved',now());
insert into public.profiles(id, full_name, email, student_id, role, status, program, required_hours, approved_at, approved_by)
select id, 'S3 Student', email, 'S3-' || right(id::text,12), 'student',
  case right(id::text,1) when '4' then 'pending' when '5' then 'rejected' else 'approved' end,
  'BS Information Technology',486,
  case when right(id::text,1) in ('4','5') then null else now() end,
  case when right(id::text,1) in ('4','5') then null else '30000000-0000-4000-8000-000000000001'::uuid end
from auth.users where id::text like '30000000-%' and right(id::text,1) not in ('1','6');

select ok(prosecdef and 'search_path=""'=any(proconfig), proname || ' safe definer') from pg_proc
where oid in ('public.attendance_time_in()'::regprocedure,'public.attendance_time_out()'::regprocedure);
select ok(not prosecdef and 'search_path=""'=any(proconfig), 'summary preserves invoker RLS') from pg_proc where oid='public.attendance_summary()'::regprocedure;
select ok((has_function_privilege('authenticated',p,'EXECUTE') = (p='public.attendance_summary()')),'U4.2 browser grant: ' || p)
from unnest(array['public.attendance_time_in()','public.attendance_time_out()','public.attendance_summary()']) p;
select ok(not has_function_privilege('anon',p,'EXECUTE'),'anon cannot execute ' || p)
from unnest(array['public.attendance_time_in()','public.attendance_time_out()','public.attendance_summary()']) p;
select is((select count(*)::integer from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid in ('public.attendance_time_in()'::regprocedure,'public.attendance_time_out()'::regprocedure,'public.attendance_summary()'::regprocedure)
  and a.grantee=0),0,'PUBLIC has no function grants');

set local role anon;
select throws_ok($$select public.attendance_time_in()$$,'42501',null,'anonymous Time In denied');
select throws_ok($$select public.attendance_time_out()$$,'42501',null,'anonymous Time Out denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select pg_temp.legacy_time_in()$$,'42501','AUTHENTICATION_REQUIRED','missing UID denied');
select throws_ok($$select pg_temp.legacy_time_out()$$,'42501','AUTHENTICATION_REQUIRED','missing UID cannot close');
select throws_ok($$select public.attendance_summary()$$,'42501','AUTHENTICATION_REQUIRED','missing UID cannot summarize');

-- The same authorization boundary applies to all three entry points.
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000004',true);
select throws_ok('select ' || f || '()','42501','APPROVED_STUDENT_REQUIRED','pending denied: ' || f)
from unnest(array['pg_temp.legacy_time_in','pg_temp.legacy_time_out','public.attendance_summary']) f;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000005',true);
select throws_ok('select ' || f || '()','42501','APPROVED_STUDENT_REQUIRED','rejected denied: ' || f)
from unnest(array['pg_temp.legacy_time_in','pg_temp.legacy_time_out','public.attendance_summary']) f;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select throws_ok('select ' || f || '()','42501','APPROVED_STUDENT_REQUIRED','admin denied student RPC: ' || f)
from unnest(array['pg_temp.legacy_time_in','pg_temp.legacy_time_out','public.attendance_summary']) f;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000006',true);
select throws_ok('select ' || f || '()','42501','APPROVED_STUDENT_REQUIRED','missing profile denied: ' || f)
from unnest(array['pg_temp.legacy_time_in','pg_temp.legacy_time_out','public.attendance_summary']) f;

select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',true);
select ok((select open_session_id is null and not started_today and completed_seconds=0 and completed_sessions=0
  from public.attendance_summary()),'empty summary is OUT with zero completed work');
select throws_ok($$select pg_temp.legacy_time_out()$$,'P0001','NO_OPEN_ATTENDANCE','no session cannot close');
create temp table before_in as select clock_timestamp() as stamp;
create temp table opened as select * from pg_temp.legacy_time_in();
select is((select count(*)::integer from opened),1,'Time In returns one trusted session');
select ok((select id is not null and student_uid=auth.uid() and time_out is null from opened),'server session ID and own UID, open state');
select ok((select time_in >= (select stamp from before_in) and time_in <= clock_timestamp() from opened),'Time In uses database wall clock');
select is((select count(*)::integer from public.attendance_sessions where time_out is null),1,'exactly one open row');
select ok((select open_session_id=(select id from opened) and open_time_in=(select time_in from opened)
  and started_today and completed_seconds=0 from public.attendance_summary()),'summary detects open row and excludes live duration');
select throws_ok($$select pg_temp.legacy_time_in()$$,'P0001','ALREADY_TIMED_IN','second open rejected');
select throws_ok($$select public.attendance_time_in('30000000-0000-4000-8000-000000000003'::uuid)$$,'42883',null,'no UID argument');
select throws_ok($$select public.attendance_time_in(now())$$,'42883',null,'no timestamp argument');
select throws_ok($$select public.attendance_time_out('30000000-0000-4000-8000-000000000003'::uuid)$$,'42883',null,'cannot choose another session/student');

select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.attendance_sessions),0,'other student cannot read first student');
select throws_ok($$select pg_temp.legacy_time_out()$$,'P0001','NO_OPEN_ATTENDANCE','other student cannot close first student');
select lives_ok($$select pg_temp.legacy_time_in()$$,'other student can independently start');
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',true);
create temp table before_out as select clock_timestamp() as stamp;
create temp table closed as select * from pg_temp.legacy_time_out();
select ok((select c.id=o.id and c.student_uid=o.student_uid and c.time_in=o.time_in from closed c cross join opened o),'Time Out preserves correct session and Time In');
select ok((select time_out >= (select stamp from before_out) and time_out <= clock_timestamp() and time_out >= time_in from closed),'Time Out uses server timestamp');
select ok((select open_session_id is null and started_today and completed_sessions=1
  and completed_seconds=(select extract(epoch from time_out-time_in) from closed) from public.attendance_summary()),'closed duration is exact, not rounded');
select throws_ok($$select pg_temp.legacy_time_out()$$,'P0001','NO_OPEN_ATTENDANCE','double Time Out rejected');
savepoint second_session;
select lives_ok($$select pg_temp.legacy_time_in()$$,'second same-day start allowed');
select lives_ok($$select pg_temp.legacy_time_out()$$,'second session closes');
select throws_ok($$select pg_temp.legacy_time_in()$$,'P0001','DAILY_ATTENDANCE_LIMIT_REACHED','third start rejected');
rollback to second_session;
select throws_ok($$insert into public.attendance_sessions(student_uid,time_in) values(auth.uid(),now())$$,'42501',null,'direct INSERT denied');
select throws_ok($$update public.attendance_sessions set time_out=now()$$,'42501',null,'direct UPDATE denied');
select throws_ok($$delete from public.attendance_sessions$$,'42501',null,'direct DELETE denied');
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.attendance_sessions),2,'approved admin reads both students');
select is((select count(*)::integer from public.attendance_sessions where time_out is null),1,'closing caller did not close other student');
select throws_ok($$update public.attendance_sessions set time_out=now()$$,'42501',null,'admin direct write still denied');

reset role;
-- Prior-day session remains open across midnight and must be closed first.
insert into public.attendance_sessions(student_uid,time_in) values
('30000000-0000-4000-8000-000000000007', ((clock_timestamp() at time zone 'Asia/Manila')::date - 1)::timestamp at time zone 'Asia/Manila');
set local timezone='America/Los_Angeles';
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000007',true);
select throws_ok($$select pg_temp.legacy_time_in()$$,'P0001','ALREADY_TIMED_IN','overnight open prevents new start');
select lives_ok($$select pg_temp.legacy_time_out()$$,'overnight session can close next day');
select lives_ok($$select pg_temp.legacy_time_in()$$,'previous-day closed session permits new Manila-day start');
select throws_ok($$select pg_temp.legacy_time_in()$$,'P0001','ALREADY_TIMED_IN','new overnight replacement stays unique');

reset role;
-- Boundary/index tests use fixed microsecond times without changing production clock logic.
insert into public.attendance_sessions(student_uid,time_in,time_out) values
('30000000-0000-4000-8000-000000000008','2026-12-31 15:59:59.999999Z','2026-12-31 16:00Z');
select lives_ok($$insert into public.attendance_sessions(student_uid,time_in,time_out) values
('30000000-0000-4000-8000-000000000008','2026-12-31 16:00Z','2026-12-31 16:01Z')$$,'Manila year boundary permits next day within same UTC date');
select lives_ok($$insert into public.attendance_sessions(student_uid,time_in,time_out) values
('30000000-0000-4000-8000-000000000008','2027-01-01 00:00Z','2027-01-01 00:01Z')$$,'second start on same Manila day allowed');
insert into public.attendance_sessions(student_uid,time_in,time_out) values
('30000000-0000-4000-8000-000000000009','2026-01-01 00:00Z','2026-01-01 00:00:01.25Z'),
('30000000-0000-4000-8000-000000000009','2026-01-02 00:00Z','2026-01-02 00:00:01.75Z'),
('30000000-0000-4000-8000-000000000009','2026-01-03 00:00Z',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000009',true);
select ok((select completed_seconds=3 and completed_sessions=2 and open_session_id is not null from public.attendance_summary()),'fractional seconds sum before rounding; open time excluded');
reset role;
update public.profiles set status='rejected',approved_at=null,approved_by=null where id='30000000-0000-4000-8000-000000000009';
set local role authenticated;
select throws_ok($$select pg_temp.legacy_time_out()$$,'42501','APPROVED_STUDENT_REQUIRED','revoked approval cannot close existing open row');
select is((select count(*)::integer from public.attendance_sessions),0,'revoked student loses attendance reads');
reset role;
select * from finish();
rollback;
