-- =====================================================================================================================
-- CMMS P2a rollback of 0003: restore app_data access EXACTLY as recorded before 0003 ran.
-- STATUS: NOT EXECUTED on any Supabase project. Tested only locally (tests/p2/db.test.mjs, two starting states).
-- Run after rolling back 0009 (if applied). Data is not changed.
-- =====================================================================================================================
begin;

do $$
declare s private.pre_lockdown; p record; g record; col text; acl text[]; rl text;
begin
  select * into s from private.pre_lockdown where id = 1;
  if s.id is null then raise exception 'no recorded pre-lockdown state: rollback refused'; end if;

  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'app_data' loop
    execute format('drop policy %I on public.app_data', p.policyname);
  end loop;
  revoke all on public.app_data from public, anon, authenticated;
  for col in select attname from pg_attribute where attrelid = 'public.app_data'::regclass and attnum > 0 and not attisdropped loop
    execute format('revoke all (%I) on public.app_data from public, anon, authenticated', col);
  end loop;

  -- table grants of PUBLIC / anon / authenticated as recorded (the owner's and service_role's were never changed)
  for g in select x.grantee, x.privilege_type, x.is_grantable from aclexplode(s.table_acl::aclitem[]) x
            where x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole) loop
    execute format('grant %s on public.app_data to %s%s', g.privilege_type,
                   case when g.grantee = 0 then 'public' else quote_ident(g.grantee::regrole::text) end,
                   case when g.is_grantable then ' with grant option' else '' end);
  end loop;
  for col, acl in select k, array(select jsonb_array_elements_text(v)) from jsonb_each(s.column_acl) e(k, v) loop
    for g in select x.grantee, x.privilege_type, x.is_grantable from aclexplode(acl::aclitem[]) x
              where x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole) loop
      execute format('grant %s (%I) on public.app_data to %s%s', g.privilege_type, col,
                     case when g.grantee = 0 then 'public' else quote_ident(g.grantee::regrole::text) end,
                     case when g.is_grantable then ' with grant option' else '' end);
    end loop;
  end loop;

  for p in select * from jsonb_to_recordset(s.policies) as x(name text, permissive text, roles text[], cmd text, qual text, with_check text) loop
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into rl from unnest(p.roles) r;
    execute format('create policy %I on public.app_data as %s for %s to %s%s%s', p.name, p.permissive, p.cmd, rl,
                   case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
                   case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end);
  end loop;

  if s.rls_forced then execute 'alter table public.app_data force row level security';
  else execute 'alter table public.app_data no force row level security'; end if;
  if s.rls_enabled then execute 'alter table public.app_data enable row level security';
  else execute 'alter table public.app_data disable row level security'; end if;
end $$;

drop function if exists public.environment_marker();
drop table private.pre_lockdown;

commit;
