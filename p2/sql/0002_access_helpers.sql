-- =====================================================================================================================
-- DRAFT — NOT EXECUTED.  CMMS P2a migration 0002: access helpers + profiles policies
-- Spec: docs/P2_AUTH_PLAN.md §2.1, §3.4.  Not run on any Supabase project; tested locally on PGlite (tests/p2/db.test.mjs).
-- Rollback: rollback/0002_access_helpers.down.sql
-- =====================================================================================================================
-- The helpers live in schema `private`, which must NOT be in the Data API's exposed schemas (check X1 / D17): they are
-- callable from RLS policies and SECURITY DEFINER functions, not as RPC endpoints.
-- Every rule reads public.profiles on EVERY request (never JWT claims), so a role change or deactivation applies to the
-- next request, not at token expiry.
-- "Active" means: a profile exists, active = true AND must_change_password = false. An account with a pending forced
-- password change therefore gets NO application data (P2_AUTH_PLAN §2.5 step 3).
-- =====================================================================================================================
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.current_profile() returns public.profiles
language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p where p.user_id = (select auth.uid())
$$;

create function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.active and not p.must_change_password from public.profiles p where p.user_id = (select auth.uid())), false)
$$;

create function private.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.active and not p.must_change_password and p.role = any(roles)
                   from public.profiles p where p.user_id = (select auth.uid())), false)
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['Admin'])
$$;

-- P2a per-key access matrix (P2_AUTH_PLAN §3.4 / §4). Department User reads only categories directly; its assets and
-- job orders come from the P2b scoped functions (0005). `users` is closed for everyone. Unknown keys: denied.
create function private.can_read_key(k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case k
    when 'assets'       then private.has_role(array['Admin','Assistant Engineer','Senior Engineer','Job Card Editor','Viewer'])
    when 'jobOrders'    then private.has_role(array['Admin','Assistant Engineer','Senior Engineer','Job Card Editor','Viewer'])
    when 'pm'           then private.has_role(array['Admin','Assistant Engineer','Senior Engineer','Job Card Editor','Viewer'])
    when 'employees'    then private.has_role(array['Admin','Assistant Engineer','Senior Engineer','Job Card Editor','Viewer'])
    when 'customPlants' then private.has_role(array['Admin','Assistant Engineer','Senior Engineer','Job Card Editor','Department User','Viewer'])
    else false
  end
$$;

-- P2a whole-row writes (coarse; P2b removes jobOrders from this list and routes it through 0005's functions).
create function private.can_write_key(k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case k
    when 'assets'       then private.has_role(array['Admin','Assistant Engineer'])
    when 'jobOrders'    then private.has_role(array['Admin','Assistant Engineer','Senior Engineer','Job Card Editor'])
    when 'pm'           then private.has_role(array['Admin','Assistant Engineer'])
    when 'employees'    then private.has_role(array['Admin','Assistant Engineer'])
    when 'customPlants' then private.has_role(array['Admin','Assistant Engineer'])
    else false
  end
$$;

revoke all on function private.current_profile(), private.is_active(), private.has_role(text[]), private.is_admin(),
                       private.can_read_key(text), private.can_write_key(text) from public, anon;
grant execute on function private.current_profile(), private.is_active(), private.has_role(text[]), private.is_admin(),
                          private.can_read_key(text), private.can_write_key(text) to authenticated;

-- profiles: a user reads their OWN row (also while inactive or in a forced change, so the app can show the right
-- screen); an active Admin reads all rows. No INSERT/UPDATE/DELETE policy exists: only the service role writes.
create policy profiles_select_own   on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_select_admin on public.profiles for select to authenticated using (private.is_admin());

commit;
