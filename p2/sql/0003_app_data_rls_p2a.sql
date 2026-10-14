-- =====================================================================================================================
-- CMMS P2a migration 0003: app_data row-level security (coarse, per key) — THE SWITCH
-- STATUS: NOT EXECUTED on any Supabase project. Executed and tested only on a local PostgreSQL engine (PGlite) with a
-- Supabase emulation: tests/p2/db.test.mjs. Rollback: rollback/0003_app_data_rls_p2a.down.sql restores the RECORDED state.
-- =====================================================================================================================
-- PRECONDITIONS (all mandatory; see docs/P2A_MIGRATION.md, kept in the local archive):
--   1. A verified backup + restore drill from the same day (D11, D12).
--   2. G2-A results reviewed (they are recorded again here automatically, and compared before/after on staging).
--   3. The deployed client loads data only after sign-in, saves with UPDATE (never upsert/INSERT, never creating a
--      row: N1), and refuses to seed. The current production client upserts and must NOT be live when this applies.
--   4. All accounts provisioned (p2/migration) and the staging checks passed.
-- Whatever policies and grants exist on app_data today are RECORDED first (private.pre_lockdown) and then removed, so a
-- forgotten permissive policy cannot keep access open, and the rollback can restore exactly what was there.
-- LIMITS (stated plainly): RLS here decides per KEY (one row = one whole dataset). Department, section and own-job rules
-- are enforced by the P2b functions (0005, 0007); 0009 then removes direct writes to jobOrders and employees.
-- Department Users must stay disabled in production until P2b is applied and tested.
-- =====================================================================================================================
begin;

create table private.pre_lockdown (
  id            integer primary key default 1 check (id = 1),
  recorded_at   timestamptz not null default now(),
  rls_enabled   boolean not null,
  rls_forced    boolean not null,
  table_acl     text[],          -- pg_class.relacl as text (null = default privileges)
  column_acl    jsonb not null,  -- {column: acl text[]} for columns with their own grants
  policies      jsonb not null   -- one object per policy: name, permissive, roles, cmd, qual, with_check
);
revoke all on private.pre_lockdown from public, anon, authenticated, service_role;

insert into private.pre_lockdown (rls_enabled, rls_forced, table_acl, column_acl, policies)
select c.relrowsecurity, c.relforcerowsecurity, c.relacl::text[],
       coalesce((select jsonb_object_agg(a.attname, a.attacl::text[]) from pg_attribute a
                  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null), '{}'::jsonb),
       coalesce((select jsonb_agg(jsonb_build_object('name', p.policyname, 'permissive', p.permissive, 'roles', p.roles, 'cmd', p.cmd,
                                                     'qual', p.qual, 'with_check', p.with_check) order by p.policyname)
                   from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_data'), '[]'::jsonb)
  from pg_class c where c.oid = 'public.app_data'::regclass;

do $$
declare p record; col text;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'app_data' loop
    execute format('drop policy %I on public.app_data', p.policyname);
  end loop;
  for col in select attname from pg_attribute where attrelid = 'public.app_data'::regclass and attnum > 0 and not attisdropped loop
    execute format('revoke all (%I) on public.app_data from public, anon, authenticated', col);
  end loop;
end $$;

alter table public.app_data enable row level security;
-- (no FORCE row level security: it only affects the table owner, whose SECURITY DEFINER functions must keep working; API roles are never owners)

-- Deny by default: nothing for PUBLIC/anon (including through Realtime), only what RLS allows for authenticated.
revoke all on public.app_data from public, anon, authenticated;
grant select (key, value, updated_at) on public.app_data to authenticated;
grant update (value, updated_at)      on public.app_data to authenticated;   -- the key itself never changes; no INSERT, no DELETE

create policy app_data_select on public.app_data for select to authenticated
  using (private.can_read_key(key));
create policy app_data_update on public.app_data for update to authenticated
  using (private.can_write_key(key))
  with check (private.can_write_key(key) and jsonb_typeof(value) = 'array');   -- a dataset is always an array

-- Environment guard (index.html, staging only): before anyone signs in, the app checks that the project carries the
-- staging marker. Returns ONLY the value of the `__environment` row ({"env":"staging"}), or null (production has none).
-- The one function callable anonymously; it exposes nothing else.
create function public.environment_marker() returns jsonb language sql stable security definer set search_path = '' as $$
  select a.value from public.app_data a where a.key = '__environment'
$$;
revoke all on function public.environment_marker() from public, anon, authenticated, service_role;
grant execute on function public.environment_marker() to anon, authenticated;

-- Realtime: postgres_changes respects the subscriber's SELECT policy (verify on staging, P2A_MIGRATION §6.3 R-RT).
-- The `users` key is readable by nobody, so its changes are delivered to nobody.

commit;
