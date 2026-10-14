-- DRAFT — NOT EXECUTED.  Rollback of 0001. Last step of a full rollback.
-- Auth accounts (auth.users) created during the migration are NOT removed by this file: delete them with the Auth
-- admin API (owner, approved) BEFORE this step, because profiles.user_id references auth.users with ON DELETE RESTRICT.
-- Export public.profiles first (owner, private storage): it is the only record of the Employee ID / legacy_id mapping.
begin;
drop table if exists public.profiles;
drop function if exists public.profiles_keep_admin();
drop function if exists public.profiles_guard();
drop function if exists public.profiles_normalize();
commit;
