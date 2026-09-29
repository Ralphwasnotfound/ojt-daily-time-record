-- S1 local foundation. No Storage, Realtime publication, or attendance/activity write RPCs.
-- Table writes are intentionally unavailable to browser roles.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Match the frontend's whitespace trimming, including non-ASCII whitespace.
create function private.trim_text(value text)
returns text language sql immutable strict parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(value,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function private.trim_text(text) from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null,
  student_id text,
  email text not null,
  program text,
  role text not null default 'student',
  status text not null default 'pending',
  required_hours integer,
  department text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  constraint profiles_student_id_key unique (student_id),
  constraint profiles_full_name_check check (
    full_name = private.trim_text(full_name) and char_length(full_name) between 1 and 100),
  constraint profiles_email_check check (email = private.trim_text(email) and char_length(email) > 0),
  constraint profiles_role_check check (role in ('student', 'admin')),
  constraint profiles_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint profiles_role_fields_check check (
    (role = 'student' and student_id is not null
      and student_id ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'
      and program is not null and program = 'BS Information Technology'
      and required_hours is not null and required_hours = 486 and department is null)
    or (role = 'admin' and student_id is null and program is null
      and required_hours is null and status = 'approved')),
  constraint profiles_approval_check check (
    (role = 'student' and status in ('pending', 'rejected') and approved_at is null and approved_by is null)
    or (role = 'student' and status = 'approved' and approved_at is not null and approved_by is not null)
    or (role = 'admin' and status = 'approved' and approved_at is not null))
);
create index profiles_pending_students_idx on public.profiles (created_at, id)
  where role = 'student' and status = 'pending';
create index profiles_approved_by_idx on public.profiles (approved_by) where approved_by is not null;

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  student_uid uuid not null references public.profiles(id) on delete restrict,
  time_in timestamptz not null,
  time_out timestamptz,
  constraint attendance_sessions_interval_check check (time_out is null or time_out >= time_in),
  constraint attendance_sessions_id_student_key unique (id, student_uid)
);
create unique index attendance_one_open_per_student_idx on public.attendance_sessions (student_uid)
  where time_out is null;
-- Temporary V1 policy. A later migration may drop ONLY this index to permit AM/PM starts.
create unique index attendance_one_start_per_manila_day_idx
  on public.attendance_sessions (student_uid, ((time_in at time zone 'Asia/Manila')::date));
create index attendance_student_history_idx on public.attendance_sessions (student_uid, time_in desc, id desc);

create table public.activities (
  id uuid primary key,
  student_uid uuid not null references public.profiles(id) on delete restrict,
  attendance_session_id uuid not null,
  category text not null,
  description text not null,
  photo_path text not null,
  created_at timestamptz not null default now(),
  constraint activities_session_student_fkey foreign key (attendance_session_id, student_uid)
    references public.attendance_sessions(id, student_uid) on delete restrict,
  constraint activities_category_check check (category in (
    'Programming / Development', 'IT Support', 'Hardware / Maintenance', 'Documentation',
    'Training / Seminar', 'Meeting', 'Administrative Work', 'Other')),
  constraint activities_description_check check (
    description = private.trim_text(description) and char_length(description) between 1 and 500),
  constraint activities_photo_path_check check (photo_path = student_uid::text || '/' || id::text || '/proof'),
  constraint activities_photo_path_key unique (photo_path)
);
create index activities_student_history_idx on public.activities (student_uid, created_at desc, id desc);
create index activities_student_session_idx on public.activities (student_uid, attendance_session_id, created_at desc, id desc);
create index activities_student_category_idx on public.activities (student_uid, category, created_at desc, id desc);
-- FK maintenance needs session-first access as well as student-first query indexes.
create index activities_session_owner_idx on public.activities (attendance_session_id, student_uid);

alter table public.profiles enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.activities enable row level security;
revoke all on table public.profiles, public.attendance_sessions, public.activities from public, anon, authenticated;
grant select on table public.profiles, public.attendance_sessions, public.activities to authenticated;

-- Definer ownership intentionally bypasses profiles RLS only inside these fixed queries,
-- preventing recursive profile policies. No UID parameter, SQL interpolation or metadata roles.
create function private.is_approved_student()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'student' and p.status = 'approved');
$$;
create function private.is_approved_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'approved');
$$;
revoke all on function private.is_approved_student(), private.is_approved_admin() from public, anon, authenticated;
grant execute on function private.is_approved_student(), private.is_approved_admin() to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (role = 'student' and (select private.is_approved_admin())));
create policy attendance_read on public.attendance_sessions for select to authenticated
  using ((student_uid = (select auth.uid()) and (select private.is_approved_student()))
    or (select private.is_approved_admin()));
create policy activities_read on public.activities for select to authenticated
  using ((student_uid = (select auth.uid()) and (select private.is_approved_student()))
    or (select private.is_approved_admin()));

-- Both RPCs run with the migration owner's privileges. Their explicit checks are
-- the write authorization boundary; client RLS cannot constrain a privileged owner.
create function public.complete_student_registration(full_name text, student_id text)
returns public.profiles language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  trusted_email text;
  result public.profiles;
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  -- Auth-owned identity data, NOT raw_user_meta_data. Lock the auth row to serialize
  -- duplicate registration for the same user even before a profile exists.
  select u.email into trusted_email from auth.users u
    where u.id = caller and u.email_confirmed_at is not null
      and u.email is not null and u.email <> ''
      and exists (select 1 from auth.identities i
        where i.user_id = u.id and i.provider = 'google'
          and i.identity_data ->> 'email_verified' = 'true'
          and lower(i.identity_data ->> 'email') = lower(u.email))
    for update of u;
  if trusted_email is null then
    raise exception using errcode = '42501', message = 'VERIFIED_GOOGLE_IDENTITY_REQUIRED';
  end if;
  if exists (select 1 from public.profiles p where p.id = caller) then
    raise exception using errcode = 'P0001', message = 'PROFILE_ALREADY_EXISTS';
  end if;
  insert into public.profiles (id, full_name, student_id, email, role, status, program, required_hours)
    values (caller, private.trim_text(full_name), upper(private.trim_text(student_id)), trusted_email,
      'student', 'pending', 'BS Information Technology', 486)
    returning * into result;
  -- Unique violation 23505 + profiles_student_id_key lets a later client map a friendly error.
  return result;
end;
$$;

create function public.review_student(student_uid uuid, decision text)
returns public.profiles language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target public.profiles;
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  -- Hold authorization stable during the review; future account changes must honor row locks.
  perform 1 from public.profiles p where p.id = caller and p.role = 'admin' and p.status = 'approved' for share;
  if not found then raise exception using errcode = '42501', message = 'APPROVED_ADMIN_REQUIRED'; end if;
  if decision is null or decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'INVALID_REVIEW_DECISION';
  end if;
  select * into target from public.profiles p where p.id = student_uid for update;
  if not found or target.role <> 'student' or target.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_PENDING';
  end if;
  update public.profiles p set status = decision,
    approved_at = case when decision = 'approved' then clock_timestamp() else null end,
    approved_by = case when decision = 'approved' then caller else null end
    where p.id = target.id returning * into target;
  return target;
end;
$$;
revoke all on function public.complete_student_registration(text, text), public.review_student(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_student_registration(text, text), public.review_student(uuid, text)
  to authenticated;

comment on table public.attendance_sessions is 'S1 schema only: browser writes denied; locked Time In/Out RPCs are deferred.';
comment on table public.activities is 'Immutable to application roles. Submission RPC and Storage are deferred; path is not evidence of an uploaded object.';
comment on function public.complete_student_registration(text, text) is 'Requires confirmed Auth email and a matching Auth-managed verified Google identity; never authorizes from editable user metadata.';
commit;
