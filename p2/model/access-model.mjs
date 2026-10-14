// TEST SUPPORT — reference model of the INTENDED server rules in p2/sql/0002, 0003, 0005, 0007, 0008, 0009.
// Used by tests/p2/mocked.test.mjs as a stand-in for PostgREST + RLS + the RPC functions.
// A passing mocked test shows the DESIGN is consistent (and matches index.html's rules); it does NOT prove that the
// SQL drafts, Supabase RLS, grants or PostgREST behave this way. That needs the staging tests (P2A_MIGRATION §6.3).
// tests/p2/static.test.mjs checks that the key matrices below are identical to the SQL text.

import { createNotificationStore } from './notifications.mjs';
export const ROLES = ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Department User', 'Viewer'];
const FULL = ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Viewer'];
export const KEY_READ = Object.freeze({ assets: FULL, jobOrders: FULL, pm: FULL, employees: FULL, customPlants: [...FULL.slice(0, 4), 'Department User', 'Viewer'] });
export const KEY_WRITE_P2A = Object.freeze({ assets: ['Admin', 'Assistant Engineer'], jobOrders: ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor'],
  pm: ['Admin', 'Assistant Engineer'], employees: ['Admin', 'Assistant Engineer'], customPlants: ['Admin', 'Assistant Engineer'] });
export const KEY_WRITE_P2B = Object.freeze({ assets: KEY_WRITE_P2A.assets, pm: KEY_WRITE_P2A.pm, customPlants: KEY_WRITE_P2A.customPlants });   // 0009: jobOrders and employees only through functions
export const JO_REQUEST_FIELDS = ['date', 'requester', 'dept', 'assetNum', 'assetDesc', 'assetCategory', 'location', 'eqcode', 'problem', 'priority', 'repairType'];
export const JO_WORK_FIELDS = ['recvName', 'section', 'target', 'manpower', 'parts', 'workDone', 'workStatus', 'eval', 'downtime', 'accept', 'completionDate'];
const APPROVER = ['approvedBy', 'approvedById', 'approverDesignation', 'approvedAt'];
const DESIGNATION = { 'Admin': 'Technical Operations Supervisor', 'Senior Engineer': 'Senior Manager, Engineering & Maintenance' };

class ApiError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
const NOT_ALLOWED = () => new ApiError(403, '42501', 'not allowed');
const pick = (src, keys) => Object.fromEntries(Object.keys(src || {}).filter(k => keys.includes(k)).map(k => [k, src[k]]));
const clone = v => JSON.parse(JSON.stringify(v));
// same meaning as normWork() in index.html / private.norm_work in 0005
function normWork(v) {
  if (Array.isArray(v)) { const rows = v.filter(r => r && typeof r === 'object' ? Object.values(r).some(x => x !== '' && x != null) : (r !== '' && r != null)); return rows.length ? JSON.stringify(rows) : ''; }
  if (v == null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
const workChanged = (a, b) => JO_WORK_FIELDS.some(k => normWork(a[k]) !== normWork(b[k]));
const normSection = v => String(v || '').trim().toLowerCase();
export function jceAllows(me, jo, mode) {
  if (me.role !== 'Job Card Editor') return true;
  if (!jo) return false;
  if (mode === 'start' && jo.status === 'OPEN' && !normSection(jo.section)) return true;
  return !!normSection(jo.section) && normSection(jo.section) === normSection(me.section);
}

export function createMockDataApi(seed, stage = 'P2a') {
  const db = clone(seed);   // {profiles: [...], appData: {key: array}, audit: []}
  db.audit = db.audit || [];
  const write = stage === 'P2b' ? KEY_WRITE_P2B : KEY_WRITE_P2A;
  const prof = uid => db.profiles.find(p => p.user_id === uid) || null;
  const activeMe = uid => { const me = prof(uid); if (!me || !me.active || me.must_change_password) throw NOT_ALLOWED(); return me; };
  const isActive = uid => { const me = prof(uid); return !!me && me.active && !me.must_change_password; };
  const hasRole = (uid, roles) => isActive(uid) && roles.includes(prof(uid).role);
  const duAssetInScope = (me, num) => (db.appData.assets || []).some(a => a.num === num && (me.assigned_categories || []).map(c => c.toUpperCase()).includes(String(a.plant || '').toUpperCase()));
  const jos = () => { const a = db.appData.jobOrders; if (!Array.isArray(a)) throw new ApiError(404, 'P0002', 'job orders unavailable'); return a; };
  const find = jobNo => { const i = jos().findIndex(j => j.jobNo === jobNo); if (i < 0) throw new ApiError(404, 'P0002', 'job order not found'); return i; };
  const event = (me, ev, reason, extra) => ({ event: ev, by: me.full_name, byId: me.legacy_id, designation: DESIGNATION[me.role] || me.role, at: '2026-10-14T00:00:00.000Z', ...(reason ? { reason } : {}), ...(extra || {}) });
  // notifications (0008): only in stage P2b, produced by the job-order functions (the hook), recipients from profiles
  const notes = createNotificationStore();
  const recipients = () => db.profiles.map(p => ({ id: p.user_id, legacy_id: p.legacy_id, role: p.role, active: p.active, section: p.section }));
  const hook = (prevJo, jo) => { if (stage === 'P2b') notes.recordWrite(prevJo ? [prevJo] : [], [jo], recipients(), '2026-10-14T00:00:00.000Z'); };
  const store = (i, jo, me, action) => { const prev = db.appData.jobOrders[i]; db.appData.jobOrders[i] = jo; db.audit.push({ actor: me.user_id, action, jobNo: jo.jobNo }); hook(prev, jo); };
  const role = (me, roles) => { if (!roles.includes(me.role)) throw NOT_ALLOWED(); };
  const emps = () => { const a = db.appData.employees; if (!Array.isArray(a)) throw new ApiError(404, 'P0002', 'employees unavailable'); return a; };
  const empIdx = id => { const i = emps().findIndex(e => e.empId === id); if (i < 0) throw new ApiError(404, 'P0002', 'employee not found'); return i; };
  const EMP_STATUS = ['siteStatus', 'leaveType', 'leaveStart', 'leaveEnd', 'offsiteStart', 'offsiteEnd', 'exitDate'];
  const EMP_FIELDS = ['empId', 'name', 'designation', 'section', 'nationality', 'siteStatus', 'leaveType', 'leaveStart', 'leaveEnd', 'exitDate', 'offsiteStart', 'offsiteEnd'];
  const IMPORT_COLS = ['jobNo', 'date', 'assetNum', 'assetDesc', 'assetCategory', 'location', 'eqcode', 'dept', 'requester', 'priority', 'repairType', 'problem', 'status', 'target', 'section',
    'tech1', 'tech1h', 'tech2', 'tech2h', 'workDone', 'workStatus', 'eval', 'downtime', 'accept', 'completionDate', 'recvName', 'approved'];
  const TODAY = '2026-10-14';
  const dateRule = e => { const off = e.offsiteStart && (!e.offsiteEnd || e.offsiteEnd >= TODAY); const lv = e.leaveStart && e.leaveStart <= TODAY && (!e.leaveEnd || e.leaveEnd >= TODAY);
    return { ...e, siteStatus: off ? 'OFF SITE' : lv ? 'ON LEAVE' : (e.siteStatus || 'ON DUTY') }; };
  const stripApprover = jo => { const o = { ...jo }; APPROVER.forEach(k => delete o[k]); return o; };

  const rpc = {
    jo_list(uid) { const me = activeMe(uid); if (me.role === 'Department User') return jos().filter(j => j.dept === me.department); if (!hasRole(uid, KEY_READ.jobOrders)) throw NOT_ALLOWED(); return jos(); },
    asset_list(uid) { const me = activeMe(uid); const a = db.appData.assets || [];
      if (me.role === 'Department User') return a.filter(x => (me.assigned_categories || []).map(c => c.toUpperCase()).includes(String(x.plant || '').toUpperCase()));
      if (!hasRole(uid, KEY_READ.assets)) throw NOT_ALLOWED(); return a; },
    jo_create(uid, { p_jo }) {
      const me = activeMe(uid);
      if (!['Admin', 'Assistant Engineer', 'Department User'].includes(me.role)) throw NOT_ALLOWED();
      let jo = pick(p_jo, JO_REQUEST_FIELDS);
      if (me.role === 'Department User') {
        if (!duAssetInScope(me, p_jo.assetNum)) throw NOT_ALLOWED();
        if (p_jo.repairType !== 'Unplanned') throw new ApiError(400, '22023', 'Unplanned only');
        jo = { ...jo, requester: me.full_name, dept: me.department, recvName: '', section: '', target: '', manpower: [], parts: [], workDone: '', workStatus: '', eval: '', downtime: '', accept: 'Accepted', completionDate: '' };
      } else jo = { ...jo, ...pick(p_jo, JO_WORK_FIELDS) };   // Admin, AE: as the app's create form (incl. section)
      const n = Math.max(1000, ...jos().map(j => parseInt(String(j.jobNo || '').replace(/\D/g, ''), 10) || 0)) + 1;
      jo = { ...jo, jobNo: 'JO-' + n, status: 'OPEN', requesterId: me.legacy_id };
      db.appData.jobOrders.push(jo); db.audit.push({ actor: me.user_id, action: 'jo.create', jobNo: jo.jobNo }); hook(null, jo);
      return jo.jobNo;
    },
    jo_update_request(uid, { p_job_no, p_fields }) {
      const me = activeMe(uid); const i = find(p_job_no); const cur = jos()[i];
      if (cur.status === 'CLOSED') throw NOT_ALLOWED();
      let jo;
      if (['Admin', 'Assistant Engineer'].includes(me.role)) jo = { ...cur, ...pick(p_fields, JO_REQUEST_FIELDS) };
      else if (me.role === 'Department User') {
        if (cur.status !== 'OPEN' || cur.requesterId !== me.legacy_id || cur.dept !== me.department || !duAssetInScope(me, (p_fields || {}).assetNum ?? cur.assetNum)) throw NOT_ALLOWED();
        if (((p_fields || {}).repairType ?? cur.repairType) !== 'Unplanned') throw new ApiError(400, '22023', 'Unplanned only');
        jo = { ...cur, ...pick(p_fields, JO_REQUEST_FIELDS), requester: cur.requester, dept: cur.dept };
      } else throw NOT_ALLOWED();
      store(i, jo, me, 'jo.update_request');
    },
    jo_update_work(uid, { p_job_no, p_fields }) {
      const me = activeMe(uid); const i = find(p_job_no); const cur = jos()[i];
      if (cur.status === 'CLOSED') throw NOT_ALLOWED();
      let jo;
      if (['Admin', 'Assistant Engineer'].includes(me.role)) jo = { ...cur, ...pick(p_fields, JO_WORK_FIELDS) };
      else if (me.role === 'Job Card Editor' && jceAllows(me, cur, 'edit')) jo = { ...cur, ...pick(p_fields, JO_WORK_FIELDS.filter(k => k !== 'section')) };
      else throw NOT_ALLOWED();
      if (cur.approvalStatus === 'APPROVED' && workChanged(cur, jo))
        jo = { ...stripApprover(jo), approvalStatus: 'PENDING', approvalHistory: [...(cur.approvalHistory || []), event(me, 'RESET', 'completion details changed')] };
      store(i, jo, me, 'jo.update_work');
    },
    jo_set_status(uid, { p_job_no, p_status, p_assignee_legacy_id }) {
      const me = activeMe(uid);
      if (!['Admin', 'Assistant Engineer', 'Job Card Editor'].includes(me.role) || !['IN PROGRESS', 'COMPLETED'].includes(p_status)) throw NOT_ALLOWED();
      const i = find(p_job_no); const cur = jos()[i];
      if (cur.status !== (p_status === 'IN PROGRESS' ? 'OPEN' : 'IN PROGRESS')) throw new ApiError(400, '22023', 'not a valid step');
      if (!jceAllows(me, cur, p_status === 'IN PROGRESS' ? 'start' : 'progress')) throw NOT_ALLOWED();
      let jo;
      if (p_status === 'IN PROGRESS') {
        const ed = me.role === 'Job Card Editor' ? me : db.profiles.find(p => p.legacy_id === p_assignee_legacy_id);
        if (!ed || ed.role !== 'Job Card Editor' || !ed.active || !ed.section) throw new ApiError(400, '22023', 'eligible editor required');
        jo = { ...cur, status: 'IN PROGRESS', assignedTo: ed.full_name, assignedToId: ed.legacy_id, recvName: me.role === 'Job Card Editor' ? ed.full_name : me.full_name, section: ed.section };
      } else jo = { ...stripApprover(cur), status: 'COMPLETED', approvalStatus: 'PENDING' };
      store(i, jo, me, 'jo.status:' + p_status);
    },
    jo_approve(uid, { p_job_no }) {
      const me = activeMe(uid);
      if (!['Admin', 'Assistant Engineer', 'Senior Engineer'].includes(me.role)) throw NOT_ALLOWED();
      const i = find(p_job_no); const cur = jos()[i];
      if (cur.status !== 'COMPLETED' || cur.approvalStatus === 'APPROVED') throw new ApiError(400, '22023', 'not a valid step');
      const ev = event(me, 'APPROVED');
      store(i, { ...cur, approvalStatus: 'APPROVED', approvedBy: ev.by, approvedById: ev.byId, approverDesignation: ev.designation, approvedAt: ev.at, approvalHistory: [...(cur.approvalHistory || []), ev] }, me, 'jo.approve');
    },
    jo_close(uid, { p_job_no, p_closed_date }) {
      const me = activeMe(uid);
      if (!['Admin', 'Assistant Engineer', 'Senior Engineer'].includes(me.role)) throw NOT_ALLOWED();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p_closed_date || '')) throw new ApiError(400, '22023', 'closed date required');
      const i = find(p_job_no); const cur = jos()[i];
      if (cur.status !== 'COMPLETED' || cur.approvalStatus !== 'APPROVED') throw new ApiError(400, '22023', 'approve first');
      store(i, { ...cur, status: 'CLOSED', closedBy: me.full_name, closerDesignation: DESIGNATION[me.role] || me.role, closedDate: p_closed_date,
                 approvalHistory: [...(cur.approvalHistory || []), event(me, 'CLOSED', null, { closedDate: p_closed_date })] }, me, 'jo.close');
    },
    // ---- 0007 ----
    jo_revert(uid, { p_job_no }) {
      const me = activeMe(uid); role(me, ['Admin']);
      const i = find(p_job_no); const cur = jos()[i];
      if (cur.status !== 'CLOSED') throw new ApiError(400, '22023', 'only CLOSED');
      store(i, { ...cur, status: 'COMPLETED', closedBy: '', closerDesignation: '', closedDate: '', approvalHistory: [...(cur.approvalHistory || []), event(me, 'REVERTED', 'reverted to COMPLETED')] }, me, 'jo.revert');
    },
    jo_delete(uid, { p_job_no }) {
      const me = activeMe(uid); role(me, ['Admin', 'Assistant Engineer']);
      const i = find(p_job_no); db.appData.jobOrders.splice(i, 1); db.audit.push({ actor: me.user_id, action: 'jo.delete', jobNo: p_job_no });
    },
    jo_import(uid, { p_rows }) {
      const me = activeMe(uid); role(me, ['Admin', 'Assistant Engineer']);
      if (!Array.isArray(p_rows) || p_rows.length > 5000) throw new ApiError(400, '22023', 'rows');
      const out = { added: [], rejected: [], skipped: [] };
      for (const r of p_rows) {
        let jo = pick(r, IMPORT_COLS);
        if (!jo.jobNo || !jo.assetNum) continue;
        const st = jo.status || 'OPEN';
        if (!['OPEN', 'IN PROGRESS', 'COMPLETED'].includes(st)) { out.rejected.push({ jobNo: jo.jobNo, status: st }); continue; }
        if (jos().some(j => j.jobNo === jo.jobNo)) { out.skipped.push(jo.jobNo); continue; }
        jo = { ...jo, status: st, priority: jo.priority || 'High', repairType: jo.repairType || 'Planned', accept: jo.accept || 'Accepted', parts: [], ...(st === 'COMPLETED' ? { approvalStatus: 'PENDING' } : {}) };
        db.appData.jobOrders.push(jo); out.added.push(jo.jobNo); hook(null, jo);
      }
      db.audit.push({ actor: me.user_id, action: 'jo.import' });
      return out;
    },
    category_rename(uid, { p_old, p_new }) {
      const me = activeMe(uid); role(me, ['Admin', 'Assistant Engineer']);
      const nw = String(p_new || '').trim().toUpperCase();
      if (!nw || nw === p_old) return;
      const cats = db.appData.customPlants;
      if (!Array.isArray(cats) || !cats.includes(p_old)) throw new ApiError(404, 'P0002', 'category not found');
      if (cats.some(c => c !== p_old && c.toUpperCase() === nw)) throw new ApiError(409, '23505', 'category already exists');
      db.appData.customPlants = cats.map(c => c === p_old ? nw : c);
      db.appData.assets = (db.appData.assets || []).map(a => a.plant === p_old ? { ...a, plant: nw } : a);
      db.appData.jobOrders = jos().map(j => j.assetCategory === p_old ? { ...j, assetCategory: nw } : j);
      db.profiles.forEach(p => { if (p.role === 'Department User' && (p.assigned_categories || []).some(c => c.toUpperCase() === p_old.toUpperCase()))
        p.assigned_categories = [...new Set(p.assigned_categories.map(c => c.toUpperCase() === p_old.toUpperCase() ? nw : c))]; });
      db.audit.push({ actor: me.user_id, action: 'category.rename' });
    },
    asset_clear_all(uid, { p_confirm }) {
      const me = activeMe(uid); role(me, ['Admin']);
      if (p_confirm !== 'DELETE ALL ASSETS') throw new ApiError(400, '22023', 'confirm');
      const n = (db.appData.assets || []).length; db.appData.assets = []; db.audit.push({ actor: me.user_id, action: 'asset.clear_all', removed: n }); return n;
    },
    employee_set_status(uid, { p_emp_id, p_updates, p_entry }) {
      const me = activeMe(uid); role(me, ['Admin', 'Assistant Engineer']);
      const u = pick(p_updates, EMP_STATUS);
      if ('siteStatus' in u && !['ON DUTY', 'ON LEAVE', 'OFF SITE'].includes(u.siteStatus)) throw new ApiError(400, '22023', 'invalid status');
      const i = empIdx(p_emp_id); let e = { ...emps()[i], ...u };
      if (p_entry) e = { ...e, leaveHistory: [...(e.leaveHistory || []), pick(p_entry, ['savedOn', 'remarks', 'type', 'start', 'end', 'exitDate'])] };
      db.appData.employees[i] = e; db.audit.push({ actor: me.user_id, action: 'employee.status' });
    },
    employee_save(uid, { p_emp, p_edit_id }) {
      const me = activeMe(uid); role(me, ['Admin']);
      const e = pick(p_emp, EMP_FIELDS);
      if (p_edit_id != null) { const i = empIdx(p_edit_id); db.appData.employees[i] = { ...emps()[i], ...e, empId: p_edit_id }; }
      else {
        if (!String(e.empId || '').trim() || !String(e.name || '').trim()) throw new ApiError(400, '22023', 'id and name required');
        if (emps().some(x => x.empId === e.empId)) throw new ApiError(409, '23505', 'employee id exists');
        db.appData.employees.push(e);
      }
      db.audit.push({ actor: me.user_id, action: p_edit_id != null ? 'employee.edit' : 'employee.add' });
    },
    employee_delete(uid, { p_emp_id }) { const me = activeMe(uid); role(me, ['Admin']); db.appData.employees.splice(empIdx(p_emp_id), 1); db.audit.push({ actor: me.user_id, action: 'employee.delete' }); },
    employee_import(uid, { p_rows }) {
      const me = activeMe(uid); role(me, ['Admin']);
      let added = 0, updated = 0;
      for (const r of (Array.isArray(p_rows) ? p_rows : []).filter(x => x && String(x.empId || '').trim())) {
        const st = { OD: 'ON DUTY', OL: 'ON LEAVE', OS: 'OFF SITE' }[r.siteStatus] || r.siteStatus || null;
        const i = emps().findIndex(e => e.empId === r.empId);
        if (i < 0) { emps().push({ ...pick(r, ['empId', 'name', 'designation', 'section', 'nationality', 'leaveType', 'leaveStart', 'leaveEnd', 'exitDate']), siteStatus: st || 'ON DUTY' }); added++; continue; }
        let e = { ...emps()[i] };
        ['name', 'designation', 'section', 'nationality', 'leaveType', 'leaveStart', 'leaveEnd', 'exitDate'].forEach(k => { if (r[k]) e[k] = r[k]; });
        const lv = e.leaveStart && e.leaveStart <= TODAY && (!e.leaveEnd || e.leaveEnd >= TODAY), off = e.offsiteStart && (!e.offsiteEnd || e.offsiteEnd >= TODAY);
        if (st && !(st === 'ON DUTY' && (lv || off))) e.siteStatus = st;
        emps()[i] = e; updated++;
      }
      db.audit.push({ actor: me.user_id, action: 'employee.import' });
      return { added, updated };
    },
    employee_apply_date_rules(uid) {
      const me = activeMe(uid); role(me, ['Admin', 'Assistant Engineer']);
      const next = emps().map(dateRule); const changed = next.filter((e, i) => JSON.stringify(e) !== JSON.stringify(emps()[i])).length;
      if (changed) db.appData.employees = next; return changed;
    },
    // ---- 0008 (P2b only) ----
    my_notifications(uid) { activeMe(uid); if (stage !== 'P2b') throw new ApiError(404, 'PGRST202', 'function not found'); return notes.list(uid); },
    notification_mark_read(uid, { p_ids }) { activeMe(uid); if (stage !== 'P2b') throw new ApiError(404, 'PGRST202', 'function not found'); return notes.markRead(uid, p_ids == null ? null : p_ids); },
  };
  const SERVICE_ONLY = ['rate_limit_hit', 'revoke_user_sessions', 'on_jo_event'];

  // request({uid, op: 'select'|'update'|'insert'|'delete'|'rpc', table, key, value, fn, args}) -> {status, rows?, data?, error?}
  function request(r) {
    const uid = r.uid || null;
    try {
      if (r.op === 'rpc') {
        if (!uid || SERVICE_ONLY.includes(r.fn) || !rpc[r.fn]) return { status: uid ? 403 : 401, error: 'permission denied for function' };
        return { status: 200, data: clone(rpc[r.fn](uid, r.args || {}) ?? null) };
      }
      if (!uid) return { status: 401, error: 'permission denied' };                    // anon: no grant on any table
      if (r.table === 'profiles') {
        if (r.op !== 'select') return { status: 403, error: 'permission denied' };     // no INSERT/UPDATE/DELETE grant
        const me = prof(uid);
        const rows = db.profiles.filter(p => p.user_id === uid || hasRole(uid, ['Admin']));
        return { status: 200, rows: clone(me ? rows : []) };
      }
      if (r.table === 'app_data') {
        if (r.op === 'insert' || r.op === 'delete') return { status: 403, error: 'permission denied' };
        if (r.op === 'select') {
          const keys = r.key ? [r.key] : Object.keys(db.appData);
          return { status: 200, rows: keys.filter(k => k in db.appData && hasRole(uid, KEY_READ[k] || [])).map(k => ({ key: k, value: clone(db.appData[k]) })) };   // RLS filters silently
        }
        if (r.op === 'update') {
          if (!(r.key in db.appData) || !hasRole(uid, write[r.key] || [])) return { status: 200, rows: [] };   // USING false: 0 rows
          if (!Array.isArray(r.value)) return { status: 403, error: 'new row violates row-level security policy' };   // WITH CHECK
          if (stage === 'P2b' && Array.isArray(db.appData[r.key]) && db.appData[r.key].length > 0 && r.value.length === 0) return { status: 403, error: 'dataset may not be emptied by a direct write' };   // 0007 guard
          db.appData[r.key] = clone(r.value); return { status: 200, rows: [{ key: r.key }] };
        }
      }
      return { status: 404, error: 'unknown' };
    } catch (e) { return { status: e.status || 500, error: e.message, code: e.code }; }
  }
  return { request, db, notes };
}
