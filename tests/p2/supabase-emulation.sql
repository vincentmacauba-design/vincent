-- LOCAL TEST SUPPORT ONLY. Emulates the parts of a Supabase database that the CMMS backend SQL depends on, so the SQL can
-- be executed and its access rules tested on a local PostgreSQL engine (PGlite). It is NOT a copy of a real project.
-- What it reproduces:
--   * the API roles anon, authenticated, service_role (service_role bypasses RLS, as on Supabase);
--   * auth.users and auth.uid() (reads the `sub` claim the way Supabase's function does);
--   * Supabase's default privileges: new tables, functions and sequences in `public` are granted to anon, authenticated
--     and service_role automatically, so the migration's revokes are actually exercised;
--   * public.app_data as the app uses it (key text primary key, value jsonb, updated_at).
-- What it does NOT reproduce: PostgREST, GoTrue, Realtime, the Supabase `postgres` role's exact attributes, network
-- behaviour or concurrency between connections (PGlite is single-connection). Those are staging checks (README §6).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.app_data (key text primary key, value jsonb, updated_at timestamptz default now());
-- GoTrue's own sessions table (shape simplified; the P2 drafts delete a user's rows on deactivation / password reset).
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, created_at timestamptz default now());
