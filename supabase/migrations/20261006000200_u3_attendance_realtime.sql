-- Separate publication gate. Refuse to alter another table's consumer behavior.
begin;
do $$
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'U3_REALTIME_PUBLICATION_MISSING';
 end if;
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables)
 or exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
 and (schemaname,tablename)<>('public','attendance_sessions')) then
  raise exception 'U3_REALTIME_REQUIRES_CONSUMER_REVIEW';
 end if;
end $$;
alter publication supabase_realtime set (publish='insert,update');
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
 and schemaname='public' and tablename='attendance_sessions') then
  alter publication supabase_realtime add table public.attendance_sessions;
 end if;
end $$;
commit;
