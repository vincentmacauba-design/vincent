-- DRAFT — NOT EXECUTED.  Rollback of 0002. Run after 0003's rollback (its policies use these helpers).
begin;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop function if exists private.can_write_key(text);
drop function if exists private.can_read_key(text);
drop function if exists private.is_admin();
drop function if exists private.has_role(text[]);
drop function if exists private.is_active();
drop function if exists private.current_profile();
drop schema if exists private;   -- fails (safely) if anything else still lives there
commit;
