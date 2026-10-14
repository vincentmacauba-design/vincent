-- DRAFT — NOT EXECUTED.  Rollback of 0005: drop the P2b functions. Data (app_data rows, audit_log) is NOT touched.
-- Department User accounts must be deactivated first: without jo_list/asset_list they have no data access at all.
begin;
drop function if exists public.jo_close(text, date);
drop function if exists public.jo_approve(text);
drop function if exists public.jo_set_status(text, text, integer);
drop function if exists public.jo_update_work(text, jsonb);
drop function if exists public.jo_update_request(text, jsonb);
drop function if exists public.jo_create(jsonb);
drop function if exists public.asset_list();
drop function if exists public.jo_list();
drop function if exists private.jo_store(jsonb, integer, jsonb, uuid, text);
drop function if exists private.on_jo_event(jsonb, text, uuid);
drop function if exists private.jo_find(jsonb, text);
drop function if exists private.jo_lock();
drop function if exists private.du_asset_in_scope(public.profiles, text);
drop function if exists private.jce_allows(public.profiles, jsonb, text);
drop function if exists private.pick(jsonb, text[]);
drop function if exists private.approval_event(public.profiles, text, text, jsonb);
drop function if exists private.work_changed(jsonb, jsonb);
drop function if exists private.norm_work(jsonb);
drop function if exists private.designation(text);
drop function if exists private.active_me();
commit;
