-- =====================================================================================================================
-- DRAFT — NOT EXECUTED.  CMMS P2a migration 0001: profiles
-- Spec: docs/P2_AUTH_PLAN.md §2.2, §2.8, §2.10.  Runbook: docs/P2A_MIGRATION.md.
-- Not run on any Supabase project; tested locally on PGlite (tests/p2/db.test.mjs). Apply ONLY on an approved staging project first (gate S2), and on
-- production only after the P0-P6 gates, a backup taken the same day, and the owner's written approval.
-- Rollback: rollback/0001_profiles.down.sql
-- =====================================================================================================================
-- Design:
--   * one row per auth.users row; identity, role and status are SERVER-CONTROLLED: API roles have no INSERT, UPDATE or
--     DELETE on this table. Changes go through the Edge Functions (service role) only.
--   * legacy_id = the existing numeric users[].id. Job orders reference users by that number (requesterId,
--     approvedById, approvalHistory[].byId, assignedToId); it is copied exactly and never reused, so no job order is
--     rewritten.
--   * employee_id = 5 letters/digits, stored upper-case, unique. No Employee ID is invented: migration fails for an
--     account the owner has not mapped (docs/P2A_MIGRATION.md, decision D1).
--   * recovery_email = a real, deliverable, VERIFIED address (recovery_email_verified_at). The internal sign-in address
--     in auth.users.email is never used for recovery.
-- =====================================================================================================================
begin;

create table public.profiles (
  user_id               uuid primary key references auth.users(id) on delete restrict,
  legacy_id             integer not null unique check (legacy_id > 0),
  employee_id           text not null unique check (employee_id ~ '^[A-Z0-9]{5}$'),
  username              text unique,                                   -- legacy, display/audit only; never used to sign in
  full_name             text not null check (length(btrim(full_name)) between 1 and 120),
  recovery_email        text unique check (recovery_email is null or (recovery_email = lower(recovery_email)
                                                                      and recovery_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  recovery_email_verified_at timestamptz,
  role                  text not null check (role in ('Admin','Assistant Engineer','Senior Engineer','Job Card Editor','Department User','Viewer')),
  department            text check (department in ('Cement Plant','LPG / Oxygen Plant','Fuel Plant','Roofing Plant','General Store','Accounts','HR','Housekeeping','F&B')),
  assigned_categories   text[],
  section               text check (section in ('Electrical','Mechanical','Maintenance')),
  active                boolean not null default true,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- role-specific fields exist only for their role (same rules as validateUserRecord / normalizeUserRecord in index.html)
  constraint profiles_du_fields  check ((role = 'Department User') = (department is not null)
                                        and (role = 'Department User') = (coalesce(cardinality(assigned_categories), 0) > 0)),
  constraint profiles_jce_fields check ((role = 'Job Card Editor') = (section is not null)),
  constraint profiles_verified_needs_email check (recovery_email_verified_at is null or recovery_email is not null)
);
comment on table public.profiles is 'CMMS accounts (P2). Server-controlled: written only by Edge Functions with the service role.';

-- Employee ID normalisation (trim + upper) before the check constraint runs.
create function public.profiles_normalize() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.employee_id := upper(btrim(new.employee_id));
  new.recovery_email := nullif(lower(btrim(new.recovery_email)), '');
  if tg_op = 'UPDATE' and new.recovery_email is distinct from old.recovery_email then
    new.recovery_email_verified_at := null;          -- a changed address must be verified again
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_normalize before insert or update on public.profiles
  for each row execute function public.profiles_normalize();

-- Defence in depth: even if a grant were added by mistake, API roles cannot change identity, role or status.
-- current_user is the role EXECUTING the statement: a direct Data API request runs as anon/authenticated and is
-- refused; the Edge Functions (service_role) and the SECURITY DEFINER functions (run as their owner, e.g. the
-- category rename updating Department User categories) pass. VERIFY ON STAGING (R-SELF).
create function public.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'profiles are server-controlled' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.legacy_id <> old.legacy_id then
    raise exception 'legacy_id never changes (job orders reference it)' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger profiles_guard before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard();

-- At least one active Admin must always remain.
create function public.profiles_keep_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'Admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'Admin' or not new.active)
     and not exists (select 1 from public.profiles p where p.role = 'Admin' and p.active and p.user_id <> old.user_id) then
    raise exception 'the last active Admin cannot be removed, demoted or deactivated' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger profiles_keep_admin before update or delete on public.profiles
  for each row execute function public.profiles_keep_admin();

-- Deny by default: no table privilege for anon/authenticated/PUBLIC except SELECT for authenticated (filtered by RLS).
alter table public.profiles enable row level security;
-- (no FORCE row level security on public.profiles: it only affects the table owner, whose SECURITY DEFINER functions must keep working; API roles are never owners)
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on function public.profiles_normalize() from public, anon, authenticated;
revoke all on function public.profiles_guard() from public, anon, authenticated;
revoke all on function public.profiles_keep_admin() from public, anon, authenticated;

-- Policies are created in 0002 (they use the private helpers). Until then RLS denies every row to API roles.
commit;
