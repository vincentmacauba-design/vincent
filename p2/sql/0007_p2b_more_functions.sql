-- =====================================================================================================================
-- DRAFT — NOT EXECUTED.  CMMS P2b migration 0007: remaining server-side operations + empty-dataset guard
-- Spec: docs/P2_AUTH_PLAN.md §3.5, docs/P2A_MIGRATION.md §2.  Not run on any Supabase project; tested locally on PGlite (tests/p2/db.test.mjs).
-- Requires 0005 (helpers private.active_me, jo_lock, jo_find, jo_store, approval_event, on_jo_event).
-- Rollback: rollback/0007_p2b_more_functions.down.sql
-- =====================================================================================================================
-- Mirrors the current app handlers in index.html (revertJO, deleteJO, importJOsFromCSV, renameCustomPlant, clearAllAssets,
-- updateEmployeeStatus, saveEmployee, deleteEmployee, importEmployeesFromData, applyStatusFromDates). Each function
-- checks role and scope on the server, locks the rows it changes, validates input against an allow-list, and audits.
-- Numeric user ids and job-order references are never rewritten (category rename changes only category STRINGS).
-- =====================================================================================================================
begin;

-- ---- guard: a non-empty dataset can only be emptied by a function that says so explicitly ----------------------------
-- (asset_clear_all, or a delete that removes the last element). A direct whole-row write of [] is refused, so a
-- broken or malicious client cannot wipe a dataset (S6/S7). The setting is transaction-local and cannot be set
-- through the Data API.
create function private.app_data_no_empty() returns trigger language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(old.value) = 'array' and jsonb_array_length(old.value) > 0
     and jsonb_typeof(new.value) = 'array' and jsonb_array_length(new.value) = 0
     and coalesce(current_setting('cmms.allow_empty', true), '') <> 'on' then
    raise exception 'dataset % may not be emptied by a direct write', old.key using errcode = '42501';
  end if;
  return new;
end $$;
create trigger app_data_no_empty before update on public.app_data for each row execute function private.app_data_no_empty();

-- ---- job orders ------------------------------------------------------------------------------------------------------
create function public.jo_revert(p_job_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record;
begin
  if me.role <> 'Admin' then raise exception 'not allowed' using errcode = '42501'; end if;   -- jo.revert: Admin only
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  if f.jo ->> 'status' <> 'CLOSED' then raise exception 'only a CLOSED job order can be reverted' using errcode = '22023'; end if;
  -- closure cleared; approval and approval history KEPT (FEATURE_PLAN §4.3)
  perform private.jo_store(arr, f.idx, f.jo || jsonb_build_object('status', 'COMPLETED', 'closedBy', '', 'closerDesignation', '', 'closedDate', '',
                                   'approvalHistory', coalesce(f.jo -> 'approvalHistory', '[]'::jsonb)
                                                      || jsonb_build_array(private.approval_event(me, 'REVERTED', 'reverted to COMPLETED', null))),
                           me.user_id, 'jo.revert');
end $$;

create function public.jo_delete(p_job_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record;
begin
  if me.role not in ('Admin', 'Assistant Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;   -- jo.delete
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  perform set_config('cmms.allow_empty', 'on', true);   -- deleting the last job order is a deliberate empty list
  update public.app_data set value = arr - f.idx, updated_at = now() where key = 'jobOrders';
  insert into public.audit_log (actor, action, details) values (me.user_id, 'jo.delete', jsonb_build_object('jobNo', p_job_no, 'status', f.jo ->> 'status'));
end $$;

-- CSV import (D16/D20): only OPEN, IN PROGRESS, COMPLETED; COMPLETED arrives PENDING approval; the free-text "approved"
-- column never approves; CLOSED and unknown statuses are rejected; existing job numbers are skipped (never overwritten).
create function public.jo_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; r jsonb; jo jsonb; st text;
        added jsonb := '[]'::jsonb; rejected jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
        cols text[] := array['jobNo','date','assetNum','assetDesc','assetCategory','location','eqcode','dept','requester','priority','repairType',
                             'problem','status','target','section','tech1','tech1h','tech2','tech2h','workDone','workStatus','eval','downtime',
                             'accept','completionDate','recvName','approved'];
begin
  if me.role not in ('Admin', 'Assistant Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;   -- jo.import
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'rows must be an array (max 5000)' using errcode = '22023'; end if;
  arr := private.jo_lock();
  for r in select x.e from jsonb_array_elements(p_rows) x(e) loop
    jo := private.pick(r, cols);
    if coalesce(jo ->> 'jobNo', '') = '' or coalesce(jo ->> 'assetNum', '') = '' then continue; end if;   -- same filter as the app
    st := coalesce(nullif(jo ->> 'status', ''), 'OPEN');
    if st not in ('OPEN', 'IN PROGRESS', 'COMPLETED') then
      rejected := rejected || jsonb_build_array(jsonb_build_object('jobNo', jo ->> 'jobNo', 'status', st)); continue;
    end if;
    if exists (select 1 from jsonb_array_elements(arr) x(e) where x.e ->> 'jobNo' = jo ->> 'jobNo') then
      skipped := skipped || to_jsonb(jo ->> 'jobNo'); continue;
    end if;
    jo := jo || jsonb_build_object('status', st, 'priority', coalesce(nullif(jo ->> 'priority', ''), 'High'),
                                   'repairType', coalesce(nullif(jo ->> 'repairType', ''), 'Planned'),
                                   'accept', coalesce(nullif(jo ->> 'accept', ''), 'Accepted'), 'parts', '[]'::jsonb)
              || case when st = 'COMPLETED' then jsonb_build_object('approvalStatus', 'PENDING') else '{}'::jsonb end;
    arr := arr || jsonb_build_array(jo);
    added := added || to_jsonb(jo ->> 'jobNo');
    perform private.on_jo_event(jo, null, me.user_id);
  end loop;
  update public.app_data set value = arr, updated_at = now() where key = 'jobOrders';
  insert into public.audit_log (actor, action, details) values (me.user_id, 'jo.import',
    jsonb_build_object('added', jsonb_array_length(added), 'rejected', jsonb_array_length(rejected), 'skipped', jsonb_array_length(skipped)));
  return jsonb_build_object('added', added, 'rejected', rejected, 'skipped', skipped);
end $$;

-- ---- categories and assets -------------------------------------------------------------------------------------------
-- One transaction: categories list, asset plants, job-order assetCategory and Department User assigned categories.
create function public.category_rename(p_old text, p_new text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); cats jsonb; nw text := upper(btrim(coalesce(p_new, '')));
begin
  if me.role not in ('Admin', 'Assistant Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;   -- asset.category.manage
  if nw = '' or nw = p_old then return; end if;
  perform 1 from public.app_data where key in ('assets', 'customPlants', 'jobOrders') order by key for update;   -- fixed lock order
  select value into cats from public.app_data where key = 'customPlants';
  if cats is null or not (cats ? p_old) then raise exception 'category not found' using errcode = 'P0002'; end if;
  if exists (select 1 from jsonb_array_elements_text(cats) c where c <> p_old and upper(c) = nw) then
    raise exception 'category already exists' using errcode = '23505';
  end if;
  update public.app_data set value = (select jsonb_agg(case when c = p_old then nw else c end order by i) from jsonb_array_elements_text(cats) with ordinality t(c, i)),
         updated_at = now() where key = 'customPlants';
  update public.app_data set value = (select coalesce(jsonb_agg(case when e ->> 'plant' = p_old then e || jsonb_build_object('plant', nw) else e end order by i), '[]'::jsonb)
                                        from jsonb_array_elements(value) with ordinality t(e, i)), updated_at = now() where key = 'assets';
  update public.app_data set value = (select coalesce(jsonb_agg(case when e ->> 'assetCategory' = p_old then e || jsonb_build_object('assetCategory', nw) else e end order by i), '[]'::jsonb)
                                        from jsonb_array_elements(value) with ordinality t(e, i)), updated_at = now() where key = 'jobOrders';
  update public.profiles set assigned_categories = (select array_agg(distinct case when upper(c) = upper(p_old) then nw else c end) from unnest(assigned_categories) c)
   where role = 'Department User' and exists (select 1 from unnest(assigned_categories) c where upper(c) = upper(p_old));
  insert into public.audit_log (actor, action, details) values (me.user_id, 'category.rename', jsonb_build_object('from', p_old, 'to', nw));
end $$;

-- Admin only (asset.clearAll), with a typed confirmation. The only way to empty the asset list (see guard above).
create function public.asset_clear_all(p_confirm text) returns integer
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); n integer;
begin
  if me.role <> 'Admin' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_confirm is distinct from 'DELETE ALL ASSETS' then raise exception 'type DELETE ALL ASSETS to confirm' using errcode = '22023'; end if;
  select jsonb_array_length(value) into n from public.app_data where key = 'assets' for update;
  perform set_config('cmms.allow_empty', 'on', true);
  update public.app_data set value = '[]'::jsonb, updated_at = now() where key = 'assets';
  insert into public.audit_log (actor, action, details) values (me.user_id, 'asset.clear_all', jsonb_build_object('removed', n));
  return n;
end $$;

-- ---- employees: account ADMINISTRATION (Admin, emp.admin) is separate from STATUS updates (Admin + AE, emp.statusUpdate) --
create function private.emp_lock() returns jsonb language plpgsql security definer set search_path = '' as $$
declare arr jsonb;
begin
  select value into arr from public.app_data where key = 'employees' for update;
  if arr is null or jsonb_typeof(arr) <> 'array' then raise exception 'employees unavailable' using errcode = 'P0002'; end if;
  return arr;
end $$;

-- status/leave/off-site/exit fields only, plus ONE appended leave-history entry (history is append-only)
create function public.employee_set_status(p_emp_id text, p_updates jsonb, p_entry jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; idx integer; e jsonb; u jsonb;
begin
  if me.role not in ('Admin', 'Assistant Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;
  u := private.pick(p_updates, array['siteStatus','leaveType','leaveStart','leaveEnd','offsiteStart','offsiteEnd','exitDate']);
  if u ? 'siteStatus' and u ->> 'siteStatus' not in ('ON DUTY', 'ON LEAVE', 'OFF SITE') then raise exception 'invalid status' using errcode = '22023'; end if;
  arr := private.emp_lock();
  select (x.i - 1)::integer, x.e into idx, e from jsonb_array_elements(arr) with ordinality x(e, i) where x.e ->> 'empId' = p_emp_id order by x.i limit 1;
  if idx is null then raise exception 'employee not found' using errcode = 'P0002'; end if;
  e := e || u;
  if p_entry is not null then
    e := e || jsonb_build_object('leaveHistory', coalesce(e -> 'leaveHistory', '[]'::jsonb)
                                 || jsonb_build_array(private.pick(p_entry, array['savedOn','remarks','type','start','end','exitDate'])));
  end if;
  update public.app_data set value = jsonb_set(arr, array[idx::text], e), updated_at = now() where key = 'employees';
  insert into public.audit_log (actor, action, details) values (me.user_id, 'employee.status', jsonb_build_object('empId', p_emp_id));
end $$;

create function public.employee_save(p_emp jsonb, p_edit_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; idx integer; e jsonb;
        cols text[] := array['empId','name','designation','section','nationality','siteStatus','leaveType','leaveStart','leaveEnd','exitDate','offsiteStart','offsiteEnd'];
begin
  if me.role <> 'Admin' then raise exception 'not allowed' using errcode = '42501'; end if;   -- emp.admin
  e := private.pick(p_emp, cols);
  arr := private.emp_lock();
  if p_edit_id is not null then
    select (x.i - 1)::integer into idx from jsonb_array_elements(arr) with ordinality x(e, i) where x.e ->> 'empId' = p_edit_id order by x.i limit 1;
    if idx is null then raise exception 'employee not found' using errcode = 'P0002'; end if;
    -- the id never changes; the leave history is kept (only employee_set_status appends to it)
    e := (arr -> idx) || e || jsonb_build_object('empId', p_edit_id);
    update public.app_data set value = jsonb_set(arr, array[idx::text], e), updated_at = now() where key = 'employees';
  else
    if coalesce(btrim(e ->> 'empId'), '') = '' or coalesce(btrim(e ->> 'name'), '') = '' then raise exception 'employee id and name are required' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(arr) x(el) where x.el ->> 'empId' = e ->> 'empId') then raise exception 'employee id already exists' using errcode = '23505'; end if;
    update public.app_data set value = arr || jsonb_build_array(e), updated_at = now() where key = 'employees';
  end if;
  insert into public.audit_log (actor, action, details) values (me.user_id, case when p_edit_id is null then 'employee.add' else 'employee.edit' end,
                                                               jsonb_build_object('empId', coalesce(p_edit_id, e ->> 'empId')));
end $$;

create function public.employee_delete(p_emp_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; idx integer;
begin
  if me.role <> 'Admin' then raise exception 'not allowed' using errcode = '42501'; end if;
  arr := private.emp_lock();
  select (x.i - 1)::integer into idx from jsonb_array_elements(arr) with ordinality x(e, i) where x.e ->> 'empId' = p_emp_id order by x.i limit 1;
  if idx is null then raise exception 'employee not found' using errcode = 'P0002'; end if;
  perform set_config('cmms.allow_empty', 'on', true);
  update public.app_data set value = arr - idx, updated_at = now() where key = 'employees';
  insert into public.audit_log (actor, action, details) values (me.user_id, 'employee.delete', jsonb_build_object('empId', p_emp_id));
end $$;

-- Same merge rules as importEmployeesFromData (index.html): existing ids updated field by field (blank keeps the old
-- value; OD/OL/OS codes; an ON DUTY row does not end an active leave/off-site); new ids added.
create function public.employee_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; r jsonb; idx integer; e jsonb; st text; today text := to_char(current_date, 'YYYY-MM-DD');
        added integer := 0; updated integer := 0;
begin
  if me.role <> 'Admin' then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'rows must be an array (max 5000)' using errcode = '22023'; end if;
  arr := private.emp_lock();
  for r in select x.e from jsonb_array_elements(p_rows) x(e) where coalesce(btrim(x.e ->> 'empId'), '') <> '' loop
    idx := null;   -- reset per row: a new id must never reuse the previous row's index
    st := case r ->> 'siteStatus' when 'OD' then 'ON DUTY' when 'OL' then 'ON LEAVE' when 'OS' then 'OFF SITE' else nullif(r ->> 'siteStatus', '') end;
    select (x.i - 1)::integer, x.e into idx, e from jsonb_array_elements(arr) with ordinality x(e, i) where x.e ->> 'empId' = r ->> 'empId' order by x.i limit 1;
    if idx is null then
      arr := arr || jsonb_build_array(private.pick(r, array['empId','name','designation','section','nationality','leaveType','leaveStart','leaveEnd','exitDate'])
                                      || jsonb_build_object('siteStatus', coalesce(st, 'ON DUTY')));
      added := added + 1;
    else
      e := e || (select coalesce(jsonb_object_agg(k, r -> k), '{}'::jsonb) from unnest(array['name','designation','section','nationality','leaveType','leaveStart','leaveEnd','exitDate']) k
                 where coalesce(r ->> k, '') <> '');
      if st is not null and not (st = 'ON DUTY' and (
           (coalesce(e ->> 'leaveStart', '') <> '' and e ->> 'leaveStart' <= today and (coalesce(e ->> 'leaveEnd', '') = '' or e ->> 'leaveEnd' >= today))
        or (coalesce(e ->> 'offsiteStart', '') <> '' and (coalesce(e ->> 'offsiteEnd', '') = '' or e ->> 'offsiteEnd' >= today)))) then
        e := e || jsonb_build_object('siteStatus', st);
      end if;
      arr := jsonb_set(arr, array[idx::text], e);
      updated := updated + 1;
    end if;
  end loop;
  update public.app_data set value = arr, updated_at = now() where key = 'employees';
  insert into public.audit_log (actor, action, details) values (me.user_id, 'employee.import', jsonb_build_object('added', added, 'updated', updated));
  return jsonb_build_object('added', added, 'updated', updated);
end $$;

-- applyStatusFromDates on the server: replaces the client's whole-row write-back of corrected statuses (N2 deferral).
create function public.employee_apply_date_rules() returns integer
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; nxt jsonb; today text := to_char(current_date, 'YYYY-MM-DD'); changed integer;
begin
  if me.role not in ('Admin', 'Assistant Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;
  arr := private.emp_lock();
  select coalesce(jsonb_agg(case
           when coalesce(e ->> 'offsiteStart', '') <> '' and (coalesce(e ->> 'offsiteEnd', '') = '' or e ->> 'offsiteEnd' >= today) then e || '{"siteStatus":"OFF SITE"}'::jsonb
           when coalesce(e ->> 'leaveStart', '') <> '' and e ->> 'leaveStart' <= today and (coalesce(e ->> 'leaveEnd', '') = '' or e ->> 'leaveEnd' >= today) then e || '{"siteStatus":"ON LEAVE"}'::jsonb
           else e || jsonb_build_object('siteStatus', coalesce(nullif(e ->> 'siteStatus', ''), 'ON DUTY')) end order by i), '[]'::jsonb)
    into nxt from jsonb_array_elements(arr) with ordinality t(e, i);
  select count(*) into changed from jsonb_array_elements(arr) with ordinality a(e, i) join jsonb_array_elements(nxt) with ordinality b(e, i) using (i) where a.e <> b.e;
  if changed > 0 then
    update public.app_data set value = nxt, updated_at = now() where key = 'employees';
    insert into public.audit_log (actor, action, details) values (me.user_id, 'employee.date_rules', jsonb_build_object('changed', changed));
  end if;
  return changed;
end $$;

-- ---- privileges --------------------------------------------------------------------------------------------------------
revoke all on function private.app_data_no_empty(), private.emp_lock() from public, anon, authenticated;
revoke all on function public.jo_revert(text), public.jo_delete(text), public.jo_import(jsonb), public.category_rename(text, text),
                       public.asset_clear_all(text), public.employee_set_status(text, jsonb, jsonb), public.employee_save(jsonb, text),
                       public.employee_delete(text), public.employee_import(jsonb), public.employee_apply_date_rules()
  from public, anon;
grant execute on function public.jo_revert(text), public.jo_delete(text), public.jo_import(jsonb), public.category_rename(text, text),
                          public.asset_clear_all(text), public.employee_set_status(text, jsonb, jsonb), public.employee_save(jsonb, text),
                          public.employee_delete(text), public.employee_import(jsonb), public.employee_apply_date_rules()
  to authenticated;

commit;
