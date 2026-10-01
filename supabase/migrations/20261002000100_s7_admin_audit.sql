begin;
-- Close the backfill/trigger-install gap: concurrent S5 writes wait until commit.
lock table public.activities in share row exclusive mode;
-- S7: audit snapshots are transactional with the unchanged S5 RPC writes.
create table public.activity_revisions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete restrict,
  student_uid uuid not null references public.profiles(id) on delete restrict,
  revision integer not null check (revision >= 0),
  category text not null, description text not null, photo_path text not null,
  version_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  migration_baseline boolean not null default false,
  unique(activity_id,revision)
);
create index activity_revisions_photo_idx on public.activity_revisions(photo_path);
alter table public.activity_revisions enable row level security;
revoke all on public.activity_revisions from public,anon,authenticated;
grant select on public.activity_revisions to authenticated;
create policy audit_read on public.activity_revisions for select to authenticated
using(private.is_approved_admin());
-- Existing data has no recoverable earlier versions. Mark current known state.
insert into public.activity_revisions(activity_id,student_uid,revision,category,description,photo_path,version_at,migration_baseline)
select id,student_uid,revision,category,description,photo_path,coalesce(updated_at,created_at),true from public.activities;
create function private.audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='AUDIT_IMMUTABLE'; end; $$;
create trigger audit_immutable before update or delete on public.activity_revisions
for each row execute function private.audit_immutable();
create function private.activity_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' and (new.id<>old.id or new.student_uid<>old.student_uid
    or new.attendance_session_id<>old.attendance_session_id or new.created_at<>old.created_at
    or new.revision<>old.revision+1) then raise exception 'INVALID_ACTIVITY_REVISION'; end if;
  insert into public.activity_revisions(activity_id,student_uid,revision,category,description,photo_path,version_at)
  values(new.id,new.student_uid,new.revision,new.category,new.description,new.photo_path,coalesce(new.updated_at,new.created_at));
  return new;
end; $$;
create trigger activity_snapshot after insert or update on public.activities
for each row execute function private.activity_snapshot();

create or replace function public.activity_discard_proof(upload_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare caller uuid := private.activity_student(); ticket private.activity_proof_uploads;
begin
  select * into ticket from private.activity_proof_uploads where id=upload_id and student_uid=caller for update;
  if not found then raise exception using errcode='P0001',message='INVALID_UPLOAD'; end if;
  if ticket.state='attached' or exists(select 1 from public.activities where photo_path=ticket.photo_path)
    or exists(select 1 from public.activity_revisions where photo_path=ticket.photo_path) then
    raise exception using errcode='P0001',message='PROOF_IN_USE';
  end if;
  update private.activity_proof_uploads set state='discarded' where id=ticket.id;
  return ticket.photo_path;
end; $$;
create or replace function private.activity_storage_allowed(object_name text,operation text)
returns boolean language sql stable security definer set search_path='' as $$
select private.is_approved_student() and exists(select 1 from private.activity_proof_uploads p
 where p.student_uid=auth.uid() and p.photo_path=object_name and
 case operation when 'upload' then p.state='pending' and p.expires_at>statement_timestamp()
 when 'delete' then p.state='discarded' and not exists(select 1 from public.activity_revisions r where r.photo_path=object_name)
   and not exists(select 1 from public.activities a where a.photo_path=object_name)
 else false end);
$$;
drop policy activity_proof_read on storage.objects;
create policy activity_proof_read on storage.objects for select to authenticated using(
 bucket_id='activity-proofs' and ((private.is_approved_student() and owner_id=auth.uid()::text and split_part(name,'/',1)=auth.uid()::text)
 or (private.is_approved_admin() and (exists(select 1 from public.activities a where a.photo_path=name)
 or exists(select 1 from public.activity_revisions r where r.photo_path=name)))));

create function private.require_admin() returns void language plpgsql stable security definer set search_path='' as $$
begin if not private.is_approved_admin() then raise exception using errcode='42501',message='APPROVED_ADMIN_REQUIRED'; end if; end; $$;
-- One definition of completed duration; includes fractional seconds, excludes open rows.
create view private.admin_students as
select p.id,p.full_name,p.student_id,p.email,p.program,p.status,p.required_hours,p.created_at,
 coalesce(t.completed_seconds,0) completed_seconds,coalesce(t.completed_sessions,0) completed_sessions,t.open_time_in,
 latest.category latest_category
from public.profiles p
left join lateral(select sum(extract(epoch from(time_out-time_in))) filter(where time_out is not null) completed_seconds,
 count(*) filter(where time_out is not null) completed_sessions,max(time_in) filter(where time_out is null) open_time_in
 from public.attendance_sessions where student_uid=p.id)t on true
left join lateral(select category from public.activities where student_uid=p.id order by created_at desc,id desc limit 1)latest on true
where p.role='student';
revoke all on private.admin_students from public,anon,authenticated;
create index activities_admin_history_idx on public.activities(created_at desc,id desc);

create function public.admin_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 return (select jsonb_build_object('total',count(*),'approved',count(*) filter(where status='approved'),
 'pending',count(*) filter(where status='pending'),'rejected',count(*) filter(where status='rejected'),
 'timed_in',count(*) filter(where open_time_in is not null),'completed_seconds',coalesce(sum(completed_seconds),0),
 'completed_sessions',coalesce(sum(completed_sessions),0)) from private.admin_students);
end; $$;
create function public.admin_students(page_size integer default 25,after_id uuid default null,search text default '',
 account_status text default '',attendance_status text default '',category_filter text default '',target_uid uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if page_size is null or page_size not between 1 and 100 or length(search)>100
 or account_status not in ('','pending','approved','rejected') or attendance_status not in ('','IN','OUT') then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from (
 select * from private.admin_students p where (after_id is null or p.id>after_id) and (target_uid is null or p.id=target_uid)
 and (coalesce(search,'')='' or strpos(lower(p.full_name),lower(search))>0 or strpos(lower(p.student_id),lower(search))>0)
 and (account_status='' or p.status=account_status)
 and (attendance_status='' or (p.open_time_in is not null)=(attendance_status='IN'))
 and (category_filter='' or p.latest_category=category_filter) order by p.id limit page_size)s);
end; $$;
create function public.admin_activities(page_size integer default 25,before_created_at timestamptz default null,before_id uuid default null,
 target_uid uuid default null,search text default '',category_filter text default '',attendance_status text default '',on_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if page_size is null or page_size not between 1 and 100 or (before_created_at is null)<>(before_id is null)
 or length(search)>100 or attendance_status not in ('','IN','OUT') then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc),'[]') from (
 select a.*,p.full_name,p.student_id,exists(select 1 from public.attendance_sessions t where t.student_uid=a.student_uid and t.time_out is null) is_in
 from public.activities a join public.profiles p on p.id=a.student_uid
 where (before_id is null or (a.created_at,a.id)<(before_created_at,before_id)) and (target_uid is null or a.student_uid=target_uid)
 and (coalesce(search,'')='' or strpos(lower(p.full_name),lower(search))>0 or strpos(lower(p.student_id),lower(search))>0)
 and (category_filter='' or a.category=category_filter)
 and (attendance_status='' or exists(select 1 from public.attendance_sessions t where t.student_uid=a.student_uid and t.time_out is null)=(attendance_status='IN'))
 and (on_day is null or (a.created_at >= (on_day::timestamp at time zone 'Asia/Manila') and a.created_at < ((on_day+1)::timestamp at time zone 'Asia/Manila')))
 order by a.created_at desc,a.id desc limit page_size)s);
end; $$;
create function public.admin_attendance(target_uid uuid,page_size integer default 25,before_time_in timestamptz default null,before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if target_uid is null or page_size is null or page_size not between 1 and 100 or (before_time_in is null)<>(before_id is null) then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.time_in desc,s.id desc),'[]') from (
 select * from public.attendance_sessions a where a.student_uid=target_uid and (before_id is null or (a.time_in,a.id)<(before_time_in,before_id))
 order by a.time_in desc,a.id desc limit page_size)s);
end; $$;
create function public.admin_activity_revisions(target_activity uuid,page_size integer default 25,after_revision integer default -1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if target_activity is null or page_size is null or page_size not between 1 and 100 or after_revision is null or after_revision < -1 then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.revision),'[]') from (
 select r.*,a.revision current_revision from public.activity_revisions r join public.activities a on a.id=r.activity_id
 where r.activity_id=target_activity and r.revision>after_revision order by r.revision limit page_size)s);
end; $$;
revoke all on function private.audit_immutable(),private.activity_snapshot(),private.require_admin() from public,anon,authenticated;
revoke all on function public.admin_dashboard(),public.admin_students(integer,uuid,text,text,text,text,uuid),
 public.admin_activities(integer,timestamptz,uuid,uuid,text,text,text,date),public.admin_attendance(uuid,integer,timestamptz,uuid),
 public.admin_activity_revisions(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_dashboard(),public.admin_students(integer,uuid,text,text,text,text,uuid),
 public.admin_activities(integer,timestamptz,uuid,uuid,text,text,text,date),public.admin_attendance(uuid,integer,timestamptz,uuid),
 public.admin_activity_revisions(uuid,integer,integer) to authenticated;
comment on table public.activity_revisions is 'S7 immutable server snapshots; pre-S7 history unavailable. Proof paths retained indefinitely; no browser mutation.';
commit;
