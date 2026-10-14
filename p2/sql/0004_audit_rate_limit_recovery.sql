-- =====================================================================================================================
-- DRAFT — NOT EXECUTED.  CMMS P2a migration 0004: audit log, rate limits, recovery-email verification
-- Spec: docs/P2_AUTH_PLAN.md §2.4, §2.5, §3.6.  Not run on any Supabase project; tested locally on PGlite (tests/p2/db.test.mjs).
-- Rollback: rollback/0004_audit_rate_limit_recovery.down.sql
-- =====================================================================================================================
-- None of these tables is readable or writable by anon/authenticated, except that an active Admin may READ the audit
-- log. Rows are written by the Edge Functions (service role) and by the P2b SECURITY DEFINER functions.
-- No plaintext Employee IDs, emails, IP addresses, passwords or tokens are stored here: rate-limit subjects and tokens
-- are SHA-256 hashes computed by the caller (with a server-side pepper, see P2A_MIGRATION §4.4).
-- =====================================================================================================================
begin;

create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,                         -- auth user id of the caller (null = unauthenticated request, e.g. recovery)
  action      text not null,                -- e.g. account.create, account.reset_password, account.deactivate, jo.approve
  target      uuid,                         -- affected account, if any
  details     jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
alter table public.audit_log enable row level security;
-- (no FORCE row level security on public.audit_log: it only affects the table owner, whose SECURITY DEFINER functions must keep working; API roles are never owners)
revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
create policy audit_log_admin_read on public.audit_log for select to authenticated using (private.is_admin());
-- Append-only, also for the service role: no UPDATE/DELETE except by the table owner during an approved retention job.
create function public.audit_log_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
revoke all on function public.audit_log_append_only() from public, anon, authenticated;

create table public.auth_rate_limits (
  bucket       text not null,               -- e.g. recovery:id, recovery:ip, admin:create, pwchange:user
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, subject_hash, window_start)
);
alter table public.auth_rate_limits enable row level security;
-- (no FORCE row level security on public.auth_rate_limits: it only affects the table owner, whose SECURITY DEFINER functions must keep working; API roles are never owners)
revoke all on public.auth_rate_limits from public, anon, authenticated;

-- Fixed-window counter. Returns true when the hit is ALLOWED (count after this hit <= max_hits).
create function public.rate_limit_hit(p_bucket text, p_subject_hash text, p_max_hits integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
        n integer;
begin
  insert into public.auth_rate_limits as r (bucket, subject_hash, window_start, hits)
       values (p_bucket, p_subject_hash, w, 1)
  on conflict (bucket, subject_hash, window_start) do update set hits = r.hits + 1
  returning hits into n;
  delete from public.auth_rate_limits where window_start < now() - interval '2 days';   -- bounded size
  return n <= p_max_hits;
end $$;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;

-- Revoke every session (and with it every refresh token) of one user: used on deactivation and on admin password reset.
-- Touches GoTrue's own table auth.sessions; its shape is version-dependent -> VERIFY ON STAGING (P2A_MIGRATION §6.3 R-SESS)
-- before relying on it. Access tokens already issued stay valid until expiry; RLS still refuses them (is_active()).
create function public.revoke_user_sessions(p_user_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from auth.sessions where user_id = p_user_id
$$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

create table public.recovery_email_verifications (
  token_hash  text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  email       text not null,                -- the address being verified (must still equal profiles.recovery_email)
  expires_at  timestamptz not null,
  used_at     timestamptz
);
alter table public.recovery_email_verifications enable row level security;
-- (no FORCE row level security on public.recovery_email_verifications: it only affects the table owner, whose SECURITY DEFINER functions must keep working; API roles are never owners)
revoke all on public.recovery_email_verifications from public, anon, authenticated;

commit;
