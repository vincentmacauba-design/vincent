-- DRAFT — NOT EXECUTED.  Rollback of 0004.
-- The audit log is evidence: export it (owner, private storage outside the repo) BEFORE dropping it.
begin;
drop table if exists public.recovery_email_verifications;
drop function if exists public.revoke_user_sessions(uuid);
drop function if exists public.rate_limit_hit(text, text, integer, integer);
drop table if exists public.auth_rate_limits;
drop trigger if exists audit_log_append_only on public.audit_log;
drop function if exists public.audit_log_append_only();
drop table if exists public.audit_log;
commit;
