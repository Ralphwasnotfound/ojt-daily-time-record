-- Transaction-local fixture adapters for pre-cutover S3/U3/U4.1 contracts.
-- Never deployed. Browser grants on the real old RPCs remain revoked.
-- New U4.2 tests exercise the actual proof-required browser boundary.
create function pg_temp.legacy_time_in() returns public.attendance_sessions
language sql security definer set search_path='' as $$ select public.attendance_time_in(); $$;
create function pg_temp.legacy_time_out() returns public.attendance_sessions
language sql security definer set search_path='' as $$ select public.attendance_time_out(); $$;
revoke all on function pg_temp.legacy_time_in(),pg_temp.legacy_time_out() from public,anon,authenticated;
grant execute on function pg_temp.legacy_time_in(),pg_temp.legacy_time_out() to authenticated;
