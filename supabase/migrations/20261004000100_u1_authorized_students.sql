-- U1: roster permits requesting registration, never account approval.
-- Hosted rollout requires draining old registration calls before this transaction.
begin;
lock table public.profiles in share row exclusive mode;
create table private.authorized_students (
  student_id text primary key check (student_id ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  expected_name text check (expected_name is null or
    (expected_name = private.trim_text(expected_name) and char_length(expected_name) between 1 and 100)),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references public.profiles(id) on delete restrict
);
alter table private.authorized_students enable row level security;
revoke all on table private.authorized_students from public, anon, authenticated;
comment on column private.authorized_students.created_by is 'NULL denotes migration backfill; RPC creation always records the approved Admin.';
comment on column private.authorized_students.expected_name is 'Reference for human review only; backfilled names are not independently verified.';
insert into private.authorized_students(student_id, expected_name)
  select student_id, full_name from public.profiles where role = 'student';

create or replace function public.complete_student_registration(full_name text, student_id text)
returns public.profiles language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  trusted_email text;
  result public.profiles;
  canonical_id text := upper(private.trim_text(student_id));
  eligible boolean;
  violated_constraint text;
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
  if full_name is null or char_length(private.trim_text(full_name)) not between 1 and 100
    or canonical_id is null or canonical_id !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' then
    raise exception using errcode='23514', message='INVALID_REGISTRATION_DETAILS';
  end if;
  select r.is_active into eligible from private.authorized_students r
    where r.student_id=canonical_id for update;
  if not found or not eligible then
    raise exception using errcode='P0001', message='STUDENT_ID_NOT_ELIGIBLE';
  end if;
  if exists(select 1 from public.profiles p where p.student_id=canonical_id) then
    raise exception using errcode='23505', message='STUDENT_ID_ALREADY_REGISTERED';
  end if;
  insert into public.profiles(id,full_name,student_id,email,role,status,program,required_hours)
    values(caller,private.trim_text(full_name),canonical_id,trusted_email,'student','pending','BS Information Technology',486)
    returning * into result;
  return result;
exception when unique_violation then
  get stacked diagnostics violated_constraint=CONSTRAINT_NAME;
  if violated_constraint='profiles_student_id_key' then
    raise exception using errcode='23505', message='STUDENT_ID_ALREADY_REGISTERED';
  end if;
  raise;
end;
$$;

create function public.admin_authorized_students(search_text text default null, page_size integer default 25, after_student_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if page_size is null or page_size not between 1 and 100 or char_length(search_text) > 100 then
    raise exception using errcode='22023', message='INVALID_ROSTER_QUERY';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(rows) order by rows.student_id) from (
    select r.student_id, r.expected_name, r.is_active, r.created_at, r.created_by,
      p.id as claimed_by, p.created_at as claimed_at, p.full_name as registered_name,
      coalesce(p.status, 'not_registered') as registration_state
    from private.authorized_students r left join public.profiles p on p.student_id = r.student_id
    where (after_student_id is null or r.student_id > upper(private.trim_text(after_student_id)))
      and (nullif(private.trim_text(search_text),'') is null
        or strpos(lower(r.student_id), lower(private.trim_text(search_text))) > 0
        or strpos(lower(coalesce(r.expected_name,'')), lower(private.trim_text(search_text))) > 0
        or strpos(lower(coalesce(p.full_name,'')), lower(private.trim_text(search_text))) > 0)
    order by r.student_id limit page_size
  ) rows), '[]'::jsonb);
end; $$;

create function public.admin_add_authorized_student(student_id text, expected_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  canonical_id text := upper(private.trim_text(student_id));
  reference_name text := nullif(private.trim_text(expected_name),'');
  violated_constraint text;
begin
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='approved' for share;
  if not found then raise exception using errcode='42501', message='APPROVED_ADMIN_REQUIRED'; end if;
  if canonical_id is null or canonical_id !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' or char_length(reference_name)>100 then
    raise exception using errcode='22023', message='INVALID_ROSTER_DETAILS';
  end if;
  insert into private.authorized_students(student_id, expected_name, created_by)
    values(canonical_id, reference_name, auth.uid());
exception when unique_violation then
  get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
  if violated_constraint='authorized_students_pkey' then
    raise exception using errcode='23505', message='STUDENT_ID_ALREADY_AUTHORIZED';
  end if;
  raise;
end; $$;

create function public.admin_set_authorized_student_active(student_id text, is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='approved' for share;
  if not found then raise exception using errcode='42501', message='APPROVED_ADMIN_REQUIRED'; end if;
  if is_active is null then raise exception using errcode='22023', message='INVALID_ROSTER_DETAILS'; end if;
  -- UPDATE takes the same row lock as registration's SELECT FOR UPDATE.
  update private.authorized_students r set is_active=admin_set_authorized_student_active.is_active
    where r.student_id=upper(private.trim_text(admin_set_authorized_student_active.student_id));
  if not found then raise exception using errcode='P0001', message='ROSTER_ENTRY_NOT_FOUND'; end if;
end; $$;

revoke all on function public.complete_student_registration(text,text), public.admin_authorized_students(text,integer,text),
  public.admin_add_authorized_student(text,text), public.admin_set_authorized_student_active(text,boolean) from public,anon,authenticated;
grant execute on function public.complete_student_registration(text,text), public.admin_authorized_students(text,integer,text),
  public.admin_add_authorized_student(text,text), public.admin_set_authorized_student_active(text,boolean) to authenticated;
commit;
