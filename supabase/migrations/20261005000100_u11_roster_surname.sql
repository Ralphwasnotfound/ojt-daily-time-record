-- U1.1: drain old registration/review requests before hosted rollout.
begin;
lock table private.authorized_students in share row exclusive mode;
create function private.normalize_last_name(value text) returns text
language sql immutable strict set search_path='' as $$
  select nullif(lower(pg_catalog.normalize(private.trim_text(regexp_replace(value,
    '[[:space:]' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF' || ']+', ' ', 'g')), 'NFC')), '');
$$;
create function private.roster_last_name(value text) returns text
language sql immutable strict set search_path='' as $$
  select case when char_length(private.trim_text(value)) between 1 and 100
    and char_length(value)-char_length(replace(value,',',''))=1
    and private.normalize_last_name(split_part(value,',',2)) is not null
    then private.normalize_last_name(split_part(value,',',1)) end;
$$;
revoke all on function private.normalize_last_name(text),private.roster_last_name(text) from public,anon,authenticated;
alter table private.authorized_students add column normalized_last_name text;
update private.authorized_students set normalized_last_name=private.roster_last_name(expected_name);
alter table private.authorized_students add constraint roster_surname_consistent check
  (normalized_last_name is null or (private.roster_last_name(expected_name) is not null and normalized_last_name=private.roster_last_name(expected_name)));
comment on column private.authorized_students.normalized_last_name is 'NFC, lowercase, collapsed whitespace; punctuation/accents preserved. NULL requires Admin correction. No profile changes.';
-- No legacy overload/default argument can bypass surname verification.
drop function public.complete_student_registration(text,text);
create or replace function public.complete_student_registration(full_name text, student_id text, last_name text)
returns public.profiles language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  trusted_email text;
  result public.profiles;
  canonical_id text := upper(private.trim_text(student_id));
  eligible boolean;
  roster_surname text;
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
  select r.is_active, r.normalized_last_name into eligible, roster_surname from private.authorized_students r
    where r.student_id=canonical_id for update;
  if not found or not eligible or roster_surname is null or private.normalize_last_name(last_name) is null
    or roster_surname <> private.normalize_last_name(last_name) then
    raise exception using errcode='P0001', message='STUDENT_IDENTITY_NOT_ELIGIBLE';
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


create or replace function public.admin_add_authorized_student(student_id text, expected_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  canonical_id text := upper(private.trim_text(student_id));
  reference_name text := nullif(private.trim_text(expected_name),'');
  violated_constraint text;
begin
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='approved' for share;
  if not found then raise exception using errcode='42501', message='APPROVED_ADMIN_REQUIRED'; end if;
  if canonical_id is null or canonical_id !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' or private.roster_last_name(reference_name) is null then
    raise exception using errcode='22023', message='INVALID_ROSTER_DETAILS';
  end if;
  insert into private.authorized_students(student_id, expected_name, normalized_last_name, created_by)
    values(canonical_id, reference_name, private.roster_last_name(reference_name), auth.uid());
exception when unique_violation then
  get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
  if violated_constraint='authorized_students_pkey' then
    raise exception using errcode='23505', message='STUDENT_ID_ALREADY_AUTHORIZED';
  end if;
  raise;
end; $$;


create function public.admin_update_authorized_student_name(student_id text, expected_name text)
returns void language plpgsql security definer set search_path='' as $$
declare cleaned text := private.trim_text(expected_name); surname text := private.roster_last_name(expected_name);
begin
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='approved' for share;
  if not found then raise exception using errcode='42501',message='APPROVED_ADMIN_REQUIRED'; end if;
  if surname is null then raise exception using errcode='22023',message='INVALID_ROSTER_DETAILS'; end if;
  update private.authorized_students r set expected_name=cleaned, normalized_last_name=surname
    where r.student_id=upper(private.trim_text(admin_update_authorized_student_name.student_id));
  if not found then raise exception using errcode='P0001',message='ROSTER_ENTRY_NOT_FOUND'; end if;
end; $$;
create or replace function public.admin_authorized_students(search_text text default null, page_size integer default 25, after_student_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if page_size is null or page_size not between 1 and 100 or char_length(search_text) > 100 then
    raise exception using errcode='22023', message='INVALID_ROSTER_QUERY';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(rows) order by rows.student_id) from (
    select r.student_id, r.expected_name, r.is_active, r.created_at, r.created_by,
      (r.normalized_last_name is not null) as verification_ready,
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


create or replace function public.review_student(student_uid uuid, decision text)
returns public.profiles language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target public.profiles;
  roster_eligible boolean;
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
  if decision='approved' then
    select r.is_active and r.normalized_last_name is not null into roster_eligible
      from private.authorized_students r where r.student_id=target.student_id for update;
    if not found or not roster_eligible then
      raise exception using errcode='P0001', message='ROSTER_APPROVAL_NOT_ELIGIBLE';
    end if;
  end if;
  update public.profiles p set status = decision,
    approved_at = case when decision = 'approved' then clock_timestamp() else null end,
    approved_by = case when decision = 'approved' then caller else null end
    where p.id = target.id returning * into target;
  return target;
end;
$$;

create or replace function public.admin_students(page_size integer default 25,after_id uuid default null,search text default '',
 account_status text default '',attendance_status text default '',category_filter text default '',target_uid uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if page_size is null or page_size not between 1 and 100 or length(search)>100
 or account_status not in ('','pending','approved','rejected') or attendance_status not in ('','IN','OUT') then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from (
 select p.*, exists(select 1 from private.authorized_students r where r.student_id=p.student_id
   and r.is_active and r.normalized_last_name is not null) as roster_eligible
 from private.admin_students p where (after_id is null or p.id>after_id) and (target_uid is null or p.id=target_uid)
 and (coalesce(search,'')='' or strpos(lower(p.full_name),lower(search))>0 or strpos(lower(p.student_id),lower(search))>0)
 and (account_status='' or p.status=account_status)
 and (attendance_status='' or (p.open_time_in is not null)=(attendance_status='IN'))
 and (category_filter='' or p.latest_category=category_filter) order by p.id limit page_size)s);
end; $$;

revoke all on function public.complete_student_registration(text,text,text),public.admin_update_authorized_student_name(text,text) from public,anon,authenticated;
grant execute on function public.complete_student_registration(text,text,text),public.admin_update_authorized_student_name(text,text) to authenticated;
commit;
