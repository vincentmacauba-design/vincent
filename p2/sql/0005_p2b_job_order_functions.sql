-- =====================================================================================================================
-- DRAFT — NOT EXECUTED.  CMMS P2b migration 0005: scoped reads + job-order mutation functions
-- Spec: docs/P2_AUTH_PLAN.md §3.3, §3.5, §4.  Not run on any Supabase project; tested locally on PGlite (tests/p2/db.test.mjs).
-- Rollback: rollback/0005_p2b_job_order_functions.down.sql
-- =====================================================================================================================
-- Why functions: RLS cannot look INSIDE the jobOrders/assets arrays. These SECURITY DEFINER functions are the only way
-- a Department User (department + categories) or a Job Card Editor (section) can be held to their scope on the server.
-- Each mutating function:
--   * requires an active profile without a pending forced password change, then checks the ROLE and the SCOPE;
--   * locks the jobOrders row (SELECT ... FOR UPDATE), so concurrent calls are serialised (no lost update between them);
--   * changes ONE element, accepts only an allow-listed set of fields, and writes an audit row;
--   * mirrors the current app rules in index.html (mayEditJO, jceSectionAllows, canSeeJO, canApproveJO, canCloseJO,
--     resetApprovalIfChanged, updateJOStatus). tests/p2/mocked.test.mjs checks the reference model against those rules.
-- NOT drafted yet (required before P2b go-live, P2A_MIGRATION §5): jo_revert (Admin), jo_delete (Admin, AE),
-- jo_import (Admin, AE; no CLOSED/approved rows), category_rename, asset_clear_all, employee admin vs status (O13).
-- Applying this file changes nothing for existing clients; the switch that removes direct jobOrders writes is 0009 (applied last).
-- =====================================================================================================================
begin;

-- ---- internal helpers (schema private: not exposed as RPC) ---------------------------------------------------------
create function private.active_me() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  select p.* into me from public.profiles p where p.user_id = (select auth.uid());
  if me.user_id is null or not me.active or me.must_change_password then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return me;
end $$;

create function private.designation(r text) returns text language sql immutable set search_path = '' as $$
  select case r when 'Admin' then 'Technical Operations Supervisor'
                when 'Senior Engineer' then 'Senior Manager, Engineering & Maintenance' else r end
$$;

-- Same meaning as normWork() in index.html: empty rows/values are ignored when comparing completion details.
create function private.norm_work(v jsonb) returns text language sql immutable set search_path = '' as $$
  select case
    when v is null or v = 'null'::jsonb then ''
    when jsonb_typeof(v) = 'array' then coalesce((
      select jsonb_agg(x.e order by x.i)::text from jsonb_array_elements(v) with ordinality as x(e, i)
      where case when jsonb_typeof(x.e) = 'object'
                 then exists (select 1 from jsonb_each(x.e) kv where kv.value not in ('""'::jsonb, 'null'::jsonb))
                 else x.e not in ('""'::jsonb, 'null'::jsonb) end), '')
    when jsonb_typeof(v) = 'string' then v #>> '{}'
    else v::text
  end
$$;

create function private.work_changed(a jsonb, b jsonb) returns boolean language sql immutable set search_path = '' as $$
  select exists (select 1 from unnest(array['recvName','section','target','manpower','parts','workDone','workStatus',
                                            'eval','downtime','accept','completionDate']) k
                 where private.norm_work(a -> k) <> private.norm_work(b -> k))
$$;

create function private.approval_event(me public.profiles, ev text, reason text, extra jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('event', ev, 'by', me.full_name, 'byId', me.legacy_id, 'designation', private.designation(me.role),
                            'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
         || case when reason is null then '{}'::jsonb else jsonb_build_object('reason', reason) end
         || coalesce(extra, '{}'::jsonb)
$$;

create function private.pick(src jsonb, allowed text[]) returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, src -> k), '{}'::jsonb) from jsonb_object_keys(coalesce(src, '{}'::jsonb)) k where k = any(allowed)
$$;

-- JCE section rule (jceSectionAllows): 'start' allows an OPEN job order without a section.
create function private.jce_allows(me public.profiles, jo jsonb, mode text) returns boolean language sql immutable set search_path = '' as $$
  select case when me.role <> 'Job Card Editor' then true
              when mode = 'start' and jo ->> 'status' = 'OPEN' and coalesce(btrim(jo ->> 'section'), '') = '' then true
              else coalesce(btrim(jo ->> 'section'), '') <> '' and lower(btrim(jo ->> 'section')) = lower(btrim(coalesce(me.section, ''))) end
$$;

create function private.du_asset_in_scope(me public.profiles, asset_num text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_data a, jsonb_array_elements(a.value) x(e)
                 where a.key = 'assets' and x.e ->> 'num' = asset_num
                   and upper(coalesce(x.e ->> 'plant', '')) in (select upper(c) from unnest(me.assigned_categories) c))
$$;

-- ---- scoped reads (RPC) ----------------------------------------------------------------------------------------------
create function public.jo_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); out jsonb;
begin
  if me.role = 'Department User' then
    select coalesce(jsonb_agg(x.e order by x.i), '[]'::jsonb) into out
      from public.app_data a, jsonb_array_elements(a.value) with ordinality x(e, i)
     where a.key = 'jobOrders' and x.e ->> 'dept' = me.department;
  elsif private.can_read_key('jobOrders') then
    select a.value into out from public.app_data a where a.key = 'jobOrders';
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce(out, '[]'::jsonb);
end $$;

create function public.asset_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); out jsonb;
begin
  if me.role = 'Department User' then
    select coalesce(jsonb_agg(x.e order by x.i), '[]'::jsonb) into out
      from public.app_data a, jsonb_array_elements(a.value) with ordinality x(e, i)
     where a.key = 'assets' and upper(coalesce(x.e ->> 'plant', '')) in (select upper(c) from unnest(me.assigned_categories) c);
  elsif private.can_read_key('assets') then
    select a.value into out from public.app_data a where a.key = 'assets';
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce(out, '[]'::jsonb);
end $$;

-- ---- mutations (RPC) -------------------------------------------------------------------------------------------------
-- Shared pattern: lock, find, check, change one element, save, audit.
create function private.jo_lock() returns jsonb language plpgsql security definer set search_path = '' as $$
declare arr jsonb;
begin
  select a.value into arr from public.app_data a where a.key = 'jobOrders' for update;
  if arr is null or jsonb_typeof(arr) <> 'array' then raise exception 'job orders unavailable' using errcode = 'P0002'; end if;
  return arr;
end $$;

create function private.jo_find(arr jsonb, job_no text, out idx integer, out jo jsonb) language sql immutable set search_path = '' as $$
  select (x.i - 1)::integer, x.e from jsonb_array_elements(arr) with ordinality x(e, i) where x.e ->> 'jobNo' = job_no order by x.i limit 1
$$;

-- Lifecycle hook, called after every job-order change with the previous status (NULL = new job order). A no-op here;
-- 0008_notifications.sql replaces it with the server-side notification logic.
create function private.on_jo_event(jo jsonb, prev_status text, actor uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin return; end $$;

create function private.jo_store(arr jsonb, idx integer, jo jsonb, actor uuid, action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.app_data set value = jsonb_set(arr, array[idx::text], jo), updated_at = now() where key = 'jobOrders';
  perform private.on_jo_event(jo, arr -> idx ->> 'status', actor);
  insert into public.audit_log (actor, action, details) values (actor, action, jsonb_build_object('jobNo', jo ->> 'jobNo'));
end $$;

create function public.jo_create(p_jo jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; n integer; jo jsonb;
begin
  if me.role not in ('Admin', 'Assistant Engineer', 'Department User') then raise exception 'not allowed' using errcode = '42501'; end if;
  arr := private.jo_lock();
  jo := private.pick(p_jo, array['date','requester','dept','assetNum','assetDesc','assetCategory','location','eqcode','problem','priority','repairType']);
  if me.role = 'Department User' then
    if not private.du_asset_in_scope(me, p_jo ->> 'assetNum') then raise exception 'not allowed' using errcode = '42501'; end if;
    if coalesce(p_jo ->> 'repairType', '') <> 'Unplanned' then raise exception 'Department Users raise Unplanned repairs only' using errcode = '22023'; end if;
    jo := jo || jsonb_build_object('requester', me.full_name, 'dept', me.department, 'recvName', '', 'section', '', 'target', '',
                                   'manpower', '[]'::jsonb, 'parts', '[]'::jsonb, 'workDone', '', 'workStatus', '', 'eval', '',
                                   'downtime', '', 'accept', 'Accepted', 'completionDate', '');
  else
    jo := jo || private.pick(p_jo, array['recvName','section','target','manpower','parts','workDone','workStatus','eval','downtime','accept','completionDate']);   -- as the app's create form (Admin, AE)
  end if;
  -- next number under the lock (fixes duplicate jobNo from concurrent clients, S10)
  select coalesce(max(nullif(regexp_replace(x.e ->> 'jobNo', '\D', '', 'g'), '')::bigint), 1000) + 1 into n
    from jsonb_array_elements(arr) x(e);
  jo := jo || jsonb_build_object('jobNo', 'JO-' || n, 'status', 'OPEN', 'requesterId', me.legacy_id);
  update public.app_data set value = arr || jsonb_build_array(jo), updated_at = now() where key = 'jobOrders';
  insert into public.audit_log (actor, action, details) values (me.user_id, 'jo.create', jsonb_build_object('jobNo', jo ->> 'jobNo'));
  perform private.on_jo_event(jo, null, me.user_id);
  return jo ->> 'jobNo';
end $$;

create function public.jo_update_request(p_job_no text, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record; jo jsonb; allowed text[];
begin
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  if f.jo ->> 'status' = 'CLOSED' then raise exception 'not allowed' using errcode = '42501'; end if;
  allowed := array['date','requester','dept','assetNum','assetDesc','assetCategory','location','eqcode','problem','priority','repairType'];
  if me.role in ('Admin', 'Assistant Engineer') then
    jo := f.jo || private.pick(p_fields, allowed);
  elsif me.role = 'Department User' then
    if f.jo ->> 'status' <> 'OPEN' or (f.jo ->> 'requesterId')::integer is distinct from me.legacy_id or f.jo ->> 'dept' is distinct from me.department
       or not private.du_asset_in_scope(me, coalesce(p_fields ->> 'assetNum', f.jo ->> 'assetNum')) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if coalesce(p_fields ->> 'repairType', f.jo ->> 'repairType') <> 'Unplanned' then raise exception 'Department Users raise Unplanned repairs only' using errcode = '22023'; end if;
    jo := f.jo || private.pick(p_fields, allowed) || jsonb_build_object('requester', f.jo -> 'requester', 'dept', f.jo -> 'dept');
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.jo_store(arr, f.idx, jo, me.user_id, 'jo.update_request');
end $$;

create function public.jo_update_work(p_job_no text, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record; jo jsonb;
begin
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  if f.jo ->> 'status' = 'CLOSED' then raise exception 'not allowed' using errcode = '42501'; end if;
  if me.role in ('Admin', 'Assistant Engineer') then
    jo := f.jo || private.pick(p_fields, array['recvName','section','target','manpower','parts','workDone','workStatus','eval','downtime','accept','completionDate']);
  elsif me.role = 'Job Card Editor' and private.jce_allows(me, f.jo, 'edit') then
    jo := f.jo || private.pick(p_fields, array['recvName','target','manpower','parts','workDone','workStatus','eval','downtime','accept','completionDate']);   -- not 'section'
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if f.jo ->> 'approvalStatus' = 'APPROVED' and private.work_changed(f.jo, jo) then   -- §4.3: changed completion resets approval
    jo := (jo - 'approvedBy' - 'approvedById' - 'approverDesignation' - 'approvedAt')
          || jsonb_build_object('approvalStatus', 'PENDING',
                                'approvalHistory', coalesce(f.jo -> 'approvalHistory', '[]'::jsonb)
                                                   || jsonb_build_array(private.approval_event(me, 'RESET', 'completion details changed', null)));
  end if;
  perform private.jo_store(arr, f.idx, jo, me.user_id, 'jo.update_work');
end $$;

create function public.jo_set_status(p_job_no text, p_status text, p_assignee_legacy_id integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record; jo jsonb; ed public.profiles;
begin
  if me.role not in ('Admin', 'Assistant Engineer', 'Job Card Editor') or p_status not in ('IN PROGRESS', 'COMPLETED') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  if f.jo ->> 'status' is distinct from (case p_status when 'IN PROGRESS' then 'OPEN' else 'IN PROGRESS' end) then   -- (CASE in parentheses: PL/pgSQL would end the IF condition at its THEN)
    raise exception 'not a valid step' using errcode = '22023';
  end if;
  if not private.jce_allows(me, f.jo, case p_status when 'IN PROGRESS' then 'start' else 'progress' end) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status = 'IN PROGRESS' then
    -- assignment (owner decision 2026-10-11): a JCE takes it; Admin/AE assign an ACTIVE JCE that has a section
    if me.role = 'Job Card Editor' then ed := me;
    else select p.* into ed from public.profiles p where p.legacy_id = p_assignee_legacy_id; end if;
    if ed.user_id is null or ed.role <> 'Job Card Editor' or not ed.active or ed.section is null then
      raise exception 'an active Job Card Editor with a section is required' using errcode = '22023';
    end if;
    jo := f.jo || jsonb_build_object('status', 'IN PROGRESS', 'assignedTo', ed.full_name, 'assignedToId', ed.legacy_id,
                                     'recvName', case when me.role = 'Job Card Editor' then ed.full_name else me.full_name end,
                                     'section', ed.section);
  else
    jo := (f.jo - 'approvedBy' - 'approvedById' - 'approverDesignation' - 'approvedAt')
          || jsonb_build_object('status', 'COMPLETED', 'approvalStatus', 'PENDING');   -- completing never approves
  end if;
  perform private.jo_store(arr, f.idx, jo, me.user_id, 'jo.status:' || p_status);
end $$;

create function public.jo_approve(p_job_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record; ev jsonb;
begin
  if me.role not in ('Admin', 'Assistant Engineer', 'Senior Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  if f.jo ->> 'status' <> 'COMPLETED' or f.jo ->> 'approvalStatus' = 'APPROVED' then raise exception 'not a valid step' using errcode = '22023'; end if;
  ev := private.approval_event(me, 'APPROVED', null, null);
  perform private.jo_store(arr, f.idx, f.jo || jsonb_build_object('approvalStatus', 'APPROVED', 'approvedBy', ev -> 'by', 'approvedById', ev -> 'byId',
                                       'approverDesignation', ev -> 'designation', 'approvedAt', ev -> 'at',
                                       'approvalHistory', coalesce(f.jo -> 'approvalHistory', '[]'::jsonb) || jsonb_build_array(ev)),
                           me.user_id, 'jo.approve');
end $$;

create function public.jo_close(p_job_no text, p_closed_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); arr jsonb; f record; ev jsonb;
begin
  if me.role not in ('Admin', 'Assistant Engineer', 'Senior Engineer') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_closed_date is null then raise exception 'closed date required' using errcode = '22023'; end if;
  arr := private.jo_lock(); select * into f from private.jo_find(arr, p_job_no);
  if f.idx is null then raise exception 'job order not found' using errcode = 'P0002'; end if;
  if f.jo ->> 'status' <> 'COMPLETED' or f.jo ->> 'approvalStatus' is distinct from 'APPROVED' then raise exception 'approve the completion before closing' using errcode = '22023'; end if;
  ev := private.approval_event(me, 'CLOSED', null, jsonb_build_object('closedDate', to_char(p_closed_date, 'YYYY-MM-DD')));
  perform private.jo_store(arr, f.idx, f.jo || jsonb_build_object('status', 'CLOSED', 'closedBy', me.full_name,
                                       'closerDesignation', private.designation(me.role), 'closedDate', to_char(p_closed_date, 'YYYY-MM-DD'),
                                       'approvalHistory', coalesce(f.jo -> 'approvalHistory', '[]'::jsonb) || jsonb_build_array(ev)),
                           me.user_id, 'jo.close');
end $$;

-- ---- privileges: helpers private; RPCs only for signed-in users (each checks role + scope itself) -------------------
revoke all on function private.active_me(), private.designation(text), private.norm_work(jsonb), private.work_changed(jsonb, jsonb),
                       private.approval_event(public.profiles, text, text, jsonb), private.pick(jsonb, text[]),
                       private.jce_allows(public.profiles, jsonb, text), private.du_asset_in_scope(public.profiles, text),
                       private.jo_lock(), private.jo_find(jsonb, text), private.jo_store(jsonb, integer, jsonb, uuid, text),
                       private.on_jo_event(jsonb, text, uuid)
  from public, anon, authenticated;
revoke all on function public.jo_list(), public.asset_list(), public.jo_create(jsonb), public.jo_update_request(text, jsonb),
                       public.jo_update_work(text, jsonb), public.jo_set_status(text, text, integer), public.jo_approve(text),
                       public.jo_close(text, date)
  from public, anon;
grant execute on function public.jo_list(), public.asset_list(), public.jo_create(jsonb), public.jo_update_request(text, jsonb),
                          public.jo_update_work(text, jsonb), public.jo_set_status(text, text, integer), public.jo_approve(text),
                          public.jo_close(text, date)
  to authenticated;

commit;
