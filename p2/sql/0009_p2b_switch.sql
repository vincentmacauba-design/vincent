-- =====================================================================================================================
-- DRAFT — NOT EXECUTED.  CMMS P2b migration 0009 (was 0006): remove direct whole-row writes to jobOrders and employees
-- Spec: docs/P2_AUTH_PLAN.md §3.3 (P2b), docs/P2A_MIGRATION.md §5 gate P2b.  Not run on any Supabase project; tested locally on PGlite (tests/p2/db.test.mjs).
-- Rollback: rollback/0009_p2b_switch.down.sql (restores the 0002 version of can_write_key).
-- =====================================================================================================================
-- Apply LAST, only when the deployed client uses the 0005/0007 functions for every job-order and employee change
-- (including the deferred employee status correction -> employee_apply_date_rules) and 0008 is in place.
-- After this, nobody (except the table owner) can rewrite the whole jobOrders or employees array; every change is
-- one checked, audited step. Assets, PM and categories keep whole-row writes for Admin/AE (coarse; empty-guard 0007).
-- =====================================================================================================================
begin;
create or replace function private.can_write_key(k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case k
    when 'assets'       then private.has_role(array['Admin','Assistant Engineer'])
    when 'pm'           then private.has_role(array['Admin','Assistant Engineer'])
    when 'customPlants' then private.has_role(array['Admin','Assistant Engineer'])
    else false            -- jobOrders, employees: functions only (0005, 0007); users: nobody
  end
$$;
commit;
