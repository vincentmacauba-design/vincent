-- DRAFT — NOT EXECUTED.  Rollback of 0007. Run after 0009's and 0008's rollbacks, before 0005's.
-- Data is not touched. Without these functions, the 0009 switch must be rolled back first (it removes direct writes).
begin;
drop function if exists public.employee_apply_date_rules();
drop function if exists public.employee_import(jsonb);
drop function if exists public.employee_delete(text);
drop function if exists public.employee_save(jsonb, text);
drop function if exists public.employee_set_status(text, jsonb, jsonb);
drop function if exists private.emp_lock();
drop function if exists public.asset_clear_all(text);
drop function if exists public.category_rename(text, text);
drop function if exists public.jo_import(jsonb);
drop function if exists public.jo_delete(text);
drop function if exists public.jo_revert(text);
drop trigger if exists app_data_no_empty on public.app_data;
drop function if exists private.app_data_no_empty();
commit;
