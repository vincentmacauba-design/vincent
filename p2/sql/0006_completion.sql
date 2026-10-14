-- =====================================================================================================================
-- CMMS P2b migration 0006: operations the app needs that 0005/0007/0008 did not cover
-- STATUS: NOT EXECUTED on any Supabase project. Executed and tested only locally (tests/p2/db.test.mjs).
-- Requires 0001, 0002, 0005 (private.active_me), 0008 (notifications). Rollback: rollback/0006_completion.down.sql
-- =====================================================================================================================
--   * user_list()               accounts for the Settings page (Admin) and the work-assignment list (everyone: active
--                               Job Card Editors only, display fields only). Never Employee IDs or emails of others.
--   * profile_update_self()     own name (Admin, Assistant Engineer, Senior Engineer; profile.edit). Recovery email,
--                               role, scope and status are NOT changed here (Admin, through admin-users).
--   * admin_reset_data()        Reset Data (Admin, typed confirmation): empties the five datasets in one step; accounts
--                               are never touched.
--   * notification_purge()      retention mechanism for old notifications/events. The PERIOD is an open owner decision
--                               (N-D4): nothing calls this automatically; it takes the period as an argument.
--   * jo_update()               the edit form in ONE step: Admin/AE request + work fields; Job Card Editor work fields of
--                               its section (not Section); Department User request fields of its own OPEN job. Same rules
--                               as jo_update_request / jo_update_work (0005), atomic for the Admin/AE form.
-- =====================================================================================================================
begin;

create function public.jo_update(p_job_no text, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record; jo jsonb;
        req text[] := array['date','requester','dept','assetNum','assetDesc','assetCategory','location','eqcode','problem','priority','repairType'];
        work text[] := array['recvName','section','target','manpower','parts','workDone','workStatus','eval','downtime','accept','completionDate'];
begin
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  if f.jo ->> 'status' = 'CLOSED' then raise exception 'not allowed' using errcode = '42501'; end if;
  if me.role in ('Admin', 'Assistant Engineer') then
    jo := f.jo || private.pick(p_fields, req || work);
  elsif me.role = 'Job Card Editor' then
    if not private.jce_allows(me, f.jo, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
    jo := f.jo || private.pick(p_fields, array_remove(work, 'section'));
  elsif me.role = 'Department User' then
    if f.jo ->> 'status' <> 'OPEN' or (f.jo -> 'requesterId') is distinct from to_jsonb(me.legacy_id) or f.jo ->> 'dept' is distinct from me.department
       or not private.du_asset_in_scope(me, coalesce(p_fields ->> 'assetNum', f.jo ->> 'assetNum')) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if coalesce(p_fields ->> 'repairType', f.jo ->> 'repairType', '') <> 'Unplanned' then raise exception 'Department Users raise Unplanned repairs only' using errcode = '22023'; end if;
    jo := f.jo || private.pick(p_fields, req) || jsonb_build_object('requester', f.jo -> 'requester', 'dept', f.jo -> 'dept');
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if f.jo ->> 'approvalStatus' = 'APPROVED' and private.work_changed(f.jo, jo) then   -- completion changed after approval
    jo := (jo - 'approvedBy' - 'approvedById' - 'approverDesignation' - 'approvedAt')
          || jsonb_build_object('approvalStatus', 'PENDING', 'approvalHistory', coalesce(f.jo -> 'approvalHistory', '[]'::jsonb)
                                || jsonb_build_array(private.approval_event(me, 'RESET', 'completion details changed', null)));
  end if;
  perform private.jo_store(arr, f.idx, jo, me.user_id, 'jo.update');
end $$;

create function public.user_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_strip_nulls(case when me.role = 'Admin' or p.user_id = me.user_id
           then jsonb_build_object('id', p.legacy_id, 'userId', case when me.role = 'Admin' then p.user_id end, 'employeeId', p.employee_id, 'username', p.username, 'fullName', p.full_name,
                                   'recoveryEmail', p.recovery_email, 'recoveryEmailVerified', p.recovery_email_verified_at is not null,
                                   'role', p.role, 'active', p.active, 'mustChangePassword', p.must_change_password,
                                   'department', p.department, 'assignedCategories', to_jsonb(p.assigned_categories), 'section', p.section)
           else jsonb_build_object('id', p.legacy_id, 'fullName', p.full_name, 'role', p.role, 'active', p.active, 'section', p.section) end)
         order by p.legacy_id), '[]'::jsonb) into out
    from public.profiles p
   where me.role = 'Admin' or p.user_id = me.user_id or (p.role = 'Job Card Editor' and p.active);
  return out;
end $$;

create function public.profile_update_self(p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me();
begin
  if me.role not in ('Admin', 'Assistant Engineer', 'Senior Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_full_name), '') = '' or length(btrim(p_full_name)) > 120 then raise exception 'Full name is required' using errcode = '22023'; end if;
  update public.profiles set full_name = btrim(p_full_name) where user_id = me.user_id;
  insert into public.audit_log (actor, action, target, details) values (me.user_id, 'account.profile', me.user_id, '{}'::jsonb);
end $$;

create function public.admin_reset_data(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me();
begin
  if me.role <> 'Admin' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_confirm is distinct from 'RESET ALL DATA' then raise exception 'confirmation required' using errcode = '22023'; end if;
  perform 1 from public.app_data where key in ('assets', 'customPlants', 'employees', 'jobOrders', 'pm') order by key for update;
  perform set_config('cmms.allow_empty', 'on', true);
  update public.app_data set value = '[]'::jsonb, updated_at = now() where key in ('assets', 'customPlants', 'employees', 'jobOrders', 'pm');
  perform set_config('cmms.allow_empty', '', true);
  insert into public.audit_log (actor, action, details) values (me.user_id, 'data.reset', '{}'::jsonb);
end $$;

-- Retention (N-D4 still open): deletes events older than p_days with all their notifications. Admin, or the service role
-- (a scheduled job, once the owner has chosen the period). Returns the number of events removed.
create function public.notification_purge(p_days integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if current_user <> 'service_role' and not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_days is null or p_days < 30 then raise exception 'the retention period must be at least 30 days' using errcode = '22023'; end if;
  delete from public.jo_events where at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  insert into public.audit_log (actor, action, details) values ((select auth.uid()), 'notifications.purge', jsonb_build_object('days', p_days, 'events', n));
  return n;
end $$;

revoke all on function public.user_list(), public.profile_update_self(text), public.admin_reset_data(text), public.notification_purge(integer), public.jo_update(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.user_list(), public.profile_update_self(text), public.admin_reset_data(text), public.notification_purge(integer), public.jo_update(text, jsonb) to authenticated;
grant execute on function public.notification_purge(integer) to service_role;

commit;
