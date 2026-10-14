-- CMMS P2b rollback of 0006. NOT EXECUTED on any Supabase project. Tested locally (tests/p2/db.test.mjs).
begin;
drop function if exists public.jo_update(text, jsonb);
drop function if exists public.notification_purge(integer);
drop function if exists public.admin_reset_data(text);
drop function if exists public.profile_update_self(text);
drop function if exists public.user_list();
commit;
