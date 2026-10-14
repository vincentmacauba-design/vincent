-- DRAFT — NOT EXECUTED.  Rollback of 0008: no notifications; the job-order hook becomes a no-op again.
begin;
create or replace function private.on_jo_event(jo jsonb, prev_status text, actor uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin return; end $$;
revoke all on function private.on_jo_event(jsonb, text, uuid) from public, anon, authenticated;
drop function if exists public.notification_mark_read(bigint[]);
drop function if exists public.my_notifications(integer);
drop table if exists public.notifications;
drop table if exists public.jo_events;
commit;
