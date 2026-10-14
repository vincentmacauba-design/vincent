// MOCKED tests of the P2 drafts. Synthetic data only; no network, no database.
//   [MOCK-API]   the reference model (p2/model/access-model.mjs) used as a stand-in for PostgREST + RLS + RPC
//   [EQUIV]      the model's job-order rules compared with the CURRENT app rules in index.html over a grid
//   [HANDLERS]   the Edge Function logic (p2/functions/_shared/handlers.mjs) with fake Auth/DB/mail/clock
//   [CLIENT]     the disabled-by-default browser adapter with a fake supabase client
//   [MIGRATION]  the account-migration planner (no passwords, no invented IDs, job orders untouched)
// A pass here does NOT prove Supabase behaviour: RLS, grants, GoTrue, Realtime and the SQL itself are tested only on an
// approved staging project (docs/P2A_MIGRATION.md §6.3).
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P2ROOT = process.env.P2_DIR ? path.resolve(process.env.P2_DIR) : path.join(ROOT, 'p2');   // P2_DIR: negative controls on a scratch copy
const imp = p => import(pathToFileURL(path.join(P2ROOT, p.replace(/^p2\//, ''))));
const { createMockDataApi, KEY_READ, KEY_WRITE_P2A, ROLES } = await imp('p2/model/access-model.mjs');
const { createHandlers, LIMITS } = await imp('p2/functions/_shared/handlers.mjs');
const policy = await imp('p2/functions/_shared/policy.mjs');
const { createSupabaseAuthAdapter, AUTH_CLIENT_OPTIONS } = await imp('p2/client/supabase-auth-adapter.mjs');
const { buildAccountPlan } = await imp('p2/migration/map-accounts.mjs');
let pass = 0, fail = 0;
const t = (g, n, c, info) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + `[${g}] ` + n + (!c && info !== undefined ? '  -> ' + JSON.stringify(info) : '')); };
const clone = v => JSON.parse(JSON.stringify(v));
const DOMAIN = 'signin.cmms.invalid';
const CATS = ['01 SYNTH CAT A', '02 SYNTH CAT B', '03 SYNTH CAT C'];

// ---------------- synthetic world ----------------
const P = (n, role, extra = {}) => ({ user_id: 'u' + n, legacy_id: n, employee_id: 'TS' + String(n).padStart(3, '0'), username: 't_' + n, full_name: 'Synthetic ' + role + ' ' + n,
  recovery_email: `user${n}@example.invalid`, recovery_email_verified_at: '2026-10-01T00:00:00Z', role, department: null, assigned_categories: null, section: null,
  active: true, must_change_password: false, ...extra });
const PROFILES = [P(1, 'Admin'), P(2, 'Assistant Engineer'), P(3, 'Senior Engineer'), P(4, 'Job Card Editor', { section: 'Electrical' }),
  P(5, 'Department User', { department: 'Cement Plant', assigned_categories: [CATS[1]] }), P(6, 'Viewer'), P(7, 'Job Card Editor', { section: 'Mechanical' }),
  P(8, 'Assistant Engineer', { active: false }), P(9, 'Viewer', { must_change_password: true }), P(10, 'Department User', { department: 'HR', assigned_categories: [CATS[2]] })];
const U = n => 'u' + n;
const J = (no, status, extra = {}) => ({ jobNo: no, date: '2026-10-01', assetNum: '9001', assetDesc: 'Synthetic pump', assetCategory: CATS[0], dept: 'Engineering', requester: 'Synthetic', requesterId: 2,
  priority: 'High', repairType: 'Planned', problem: 'p', status, section: '', recvName: '', manpower: [], parts: [], legacyField: 'keep', ...extra });
const APP = { assets: [{ num: '9001', plant: CATS[0], desc: 'Synthetic pump' }, { num: '9002', plant: CATS[1], desc: 'Synthetic mixer' }, { num: '9003', plant: CATS[2], desc: 'Synthetic desk' }],
  jobOrders: [J('JO-2001', 'OPEN'), J('JO-2002', 'IN PROGRESS', { section: 'Electrical' }), J('JO-2003', 'COMPLETED', { section: 'Mechanical' }),
              J('JO-2004', 'OPEN', { assetNum: '9002', assetCategory: CATS[1], dept: 'Cement Plant', requesterId: 5, repairType: 'Unplanned' }),
              J('JO-2005', 'OPEN', { assetNum: '9002', assetCategory: CATS[1], dept: 'Cement Plant', requesterId: 99, repairType: 'Unplanned' }),
              J('JO-2006', 'IN PROGRESS', { assetNum: '9002', assetCategory: CATS[1], dept: 'Cement Plant', requesterId: 5, repairType: 'Unplanned', section: 'Mechanical' }),
              J('JO-2007', 'CLOSED', { approvalStatus: 'APPROVED' }), J('JO-2008', 'OPEN', { assetNum: '9003', assetCategory: CATS[2], dept: 'HR', requesterId: 10, repairType: 'Unplanned' })],
  pm: [{ id: 'pm-1' }], employees: [{ empId: 'E1', name: 'Synthetic Person' }], customPlants: CATS, users: [{ id: 1, password: 'x'.repeat(64) }] };
const world = (stage = 'P2a') => createMockDataApi({ profiles: PROFILES, appData: APP }, stage);
const ok = r => r.status === 200 && !r.error;

// ======================= [MOCK-API] =======================
{
  const api = world();
  const anonCalls = [{ op: 'select', table: 'app_data' }, { op: 'select', table: 'app_data', key: 'users' }, { op: 'update', table: 'app_data', key: 'assets', value: [] },
    { op: 'insert', table: 'app_data', key: 'x', value: [] }, { op: 'delete', table: 'app_data', key: 'assets' }, { op: 'select', table: 'profiles' }, { op: 'update', table: 'profiles' },
    ...['jo_list', 'asset_list', 'jo_create', 'jo_approve', 'rate_limit_hit'].map(fn => ({ op: 'rpc', fn }))];
  t('MOCK-API', 'anonymous: every read, write and RPC is refused (401), nothing returned', anonCalls.every(c => { const r = api.request({ ...c, uid: null }); return r.status === 401 && !r.rows && r.data === undefined; }));
  t('MOCK-API', 'anonymous: stored data unchanged after the attempts', JSON.stringify(api.db.appData) === JSON.stringify(APP));
  for (const p of PROFILES.filter(p => p.active && !p.must_change_password)) {
    const got = api.request({ uid: p.user_id, op: 'select', table: 'app_data' }).rows.map(r => r.key).sort();
    const exp = Object.keys(KEY_READ).filter(k => KEY_READ[k].includes(p.role)).sort();
    t('MOCK-API', `${p.role} #${p.legacy_id} reads exactly its allowed datasets; never "users"`, JSON.stringify(got) === JSON.stringify(exp) && !got.includes('users'), { got, exp });
  }
  t('MOCK-API', 'every role: own role/status/flag cannot be changed through the API (profiles UPDATE refused, also for Admin)',
    PROFILES.every(p => api.request({ uid: p.user_id, op: 'update', table: 'profiles', value: { role: 'Admin', active: true, must_change_password: false } }).status === 403)
    && JSON.stringify(api.db.profiles) === JSON.stringify(PROFILES));
  t('MOCK-API', 'profiles: a non-admin sees only its own row; an active Admin sees all',
    api.request({ uid: U(3), op: 'select', table: 'profiles' }).rows.map(r => r.legacy_id).join() === '3' && api.request({ uid: U(1), op: 'select', table: 'profiles' }).rows.length === PROFILES.length);
  t('MOCK-API', 'nobody can INSERT or DELETE app_data rows (no missing-row creation, no dataset deletion)', PROFILES.every(p => ['insert', 'delete'].every(op => api.request({ uid: p.user_id, op, table: 'app_data', key: 'assets', value: [] }).status === 403)));
  t('MOCK-API', 'service-only functions (rate limit, session revocation) are refused for every signed-in user', PROFILES.every(p => ['rate_limit_hit', 'revoke_user_sessions'].every(fn => api.request({ uid: p.user_id, op: 'rpc', fn }).status === 403)));

  // Viewer
  const before = clone(api.db.appData);
  const vUpd = Object.keys(KEY_WRITE_P2A).map(k => api.request({ uid: U(6), op: 'update', table: 'app_data', key: k, value: [] }));
  const vRpc = [['jo_create', { p_jo: { assetNum: '9001' } }], ['jo_update_request', { p_job_no: 'JO-2001', p_fields: { problem: 'x' } }], ['jo_update_work', { p_job_no: 'JO-2002', p_fields: { workDone: 'x' } }],
    ['jo_set_status', { p_job_no: 'JO-2001', p_status: 'IN PROGRESS', p_assignee_legacy_id: 4 }], ['jo_approve', { p_job_no: 'JO-2003' }], ['jo_close', { p_job_no: 'JO-2003', p_closed_date: '2026-10-14' }]]
    .map(([fn, args]) => api.request({ uid: U(6), op: 'rpc', fn, args }));
  t('MOCK-API', 'Viewer: every dataset update affects 0 rows; every job-order function is refused (403); nothing changed',
    vUpd.every(r => r.status === 200 && r.rows.length === 0) && vRpc.every(r => r.status === 403) && JSON.stringify(api.db.appData) === JSON.stringify(before));
  t('MOCK-API', 'Viewer: can read job orders through jo_list (read-only role), cannot read users', ok(api.request({ uid: U(6), op: 'rpc', fn: 'jo_list' })) && !api.request({ uid: U(6), op: 'select', table: 'app_data', key: 'users' }).rows.length);

  // Inactive / forced change
  for (const [n, what] of [[8, 'inactive account'], [9, 'account with a pending forced password change']]) {
    const reads = api.request({ uid: U(n), op: 'select', table: 'app_data' }).rows.length;
    const rpcs = ['jo_list', 'asset_list'].map(fn => api.request({ uid: U(n), op: 'rpc', fn }).status);
    const upd = api.request({ uid: U(n), op: 'update', table: 'app_data', key: 'assets', value: [] }).rows.length;
    t('MOCK-API', `${what}: no data rows, no RPC, no write`, reads === 0 && rpcs.every(s => s === 403) && upd === 0, { reads, rpcs, upd });
  }
  t('MOCK-API', 'forced-change account can still read its OWN profile (to show the change-password screen)', api.request({ uid: U(9), op: 'select', table: 'profiles' }).rows.length === 1);
}
// Department User scope (P2b)
{
  const api = world('P2b');
  const DU = U(5);
  t('MOCK-API', 'DU: raw jobOrders/assets/pm/employees reads return nothing (RLS); only categories', api.request({ uid: DU, op: 'select', table: 'app_data' }).rows.map(r => r.key).join() === 'customPlants');
  t('MOCK-API', 'DU: jo_list returns only its department\'s job orders', api.request({ uid: DU, op: 'rpc', fn: 'jo_list' }).data.map(j => j.jobNo).join() === 'JO-2004,JO-2005,JO-2006');
  t('MOCK-API', 'DU: asset_list returns only its categories', api.request({ uid: DU, op: 'rpc', fn: 'asset_list' }).data.map(a => a.num).join() === '9002');
  const c1 = api.request({ uid: DU, op: 'rpc', fn: 'jo_create', args: { p_jo: { assetNum: '9001', repairType: 'Unplanned', problem: 'x', dept: 'HR', requester: 'Someone' } } });
  const c2 = api.request({ uid: DU, op: 'rpc', fn: 'jo_create', args: { p_jo: { assetNum: '9002', repairType: 'Planned', problem: 'x' } } });
  const c3 = api.request({ uid: DU, op: 'rpc', fn: 'jo_create', args: { p_jo: { assetNum: '9002', repairType: 'Unplanned', problem: 'x', dept: 'HR', requester: 'Someone', status: 'CLOSED', approvalStatus: 'APPROVED', jobNo: 'JO-1' } } });
  const made = c3.status === 200 && api.db.appData.jobOrders.find(j => j.jobNo === c3.data);
  t('MOCK-API', 'DU: creating for an asset outside its categories is refused; Planned repairs refused', c1.status === 403 && c2.status === 400);
  t('MOCK-API', 'DU: a created job order gets the DU\'s department, name and id; status/approval/jobNo in the payload are ignored',
    !!made && made.dept === 'Cement Plant' && made.requester === PROFILES[4].full_name && made.requesterId === 5 && made.status === 'OPEN' && !made.approvalStatus && made.jobNo === 'JO-2009', made);
  t('MOCK-API', 'DU: may edit its own OPEN job order (request fields only; department and requester kept)',
    ok(api.request({ uid: DU, op: 'rpc', fn: 'jo_update_request', args: { p_job_no: 'JO-2004', p_fields: { problem: 'changed', dept: 'HR', requester: 'X', workDone: 'hack', status: 'CLOSED' } } }))
    && (j => j.problem === 'changed' && j.dept === 'Cement Plant' && j.requester === 'Synthetic' && !j.workDone && j.status === 'OPEN')(api.db.appData.jobOrders.find(j => j.jobNo === 'JO-2004')));
  t('MOCK-API', 'DU: cannot edit someone else\'s JO, its own IN PROGRESS JO, or another department\'s JO',
    ['JO-2005', 'JO-2006', 'JO-2008'].every(no => api.request({ uid: DU, op: 'rpc', fn: 'jo_update_request', args: { p_job_no: no, p_fields: { problem: 'x' } } }).status === 403));
  t('MOCK-API', 'DU: cannot change work, status, approval or closure', [['jo_update_work', { p_job_no: 'JO-2004', p_fields: { workDone: 'x' } }], ['jo_set_status', { p_job_no: 'JO-2004', p_status: 'IN PROGRESS' }],
    ['jo_approve', { p_job_no: 'JO-2003' }], ['jo_close', { p_job_no: 'JO-2003', p_closed_date: '2026-10-14' }]].every(([fn, args]) => api.request({ uid: DU, op: 'rpc', fn, args }).status === 403));
  t('MOCK-API', 'DU: no raw write to any dataset (0 rows)', Object.keys(APP).every(k => (api.request({ uid: DU, op: 'update', table: 'app_data', key: k, value: [] }).rows || []).length === 0));
}
// Job Card Editor scope
{
  const api = world('P2b');
  const JCE = U(4);   // Electrical
  t('MOCK-API', 'JCE: may edit work of its own section; "section" in the payload is ignored', ok(api.request({ uid: JCE, op: 'rpc', fn: 'jo_update_work', args: { p_job_no: 'JO-2002', p_fields: { workDone: 'done', section: 'Mechanical' } } }))
    && (j => j.workDone === 'done' && j.section === 'Electrical')(api.db.appData.jobOrders.find(j => j.jobNo === 'JO-2002')));
  t('MOCK-API', 'JCE: cannot edit another section\'s work, or a job order without a section', ['JO-2003', 'JO-2001'].every(no => api.request({ uid: JCE, op: 'rpc', fn: 'jo_update_work', args: { p_job_no: no, p_fields: { workDone: 'x' } } }).status === 403));
  t('MOCK-API', 'JCE: cannot edit request fields, create, approve or close', [['jo_update_request', { p_job_no: 'JO-2002', p_fields: { problem: 'x' } }], ['jo_create', { p_jo: { assetNum: '9001' } }],
    ['jo_approve', { p_job_no: 'JO-2003' }], ['jo_close', { p_job_no: 'JO-2003', p_closed_date: '2026-10-14' }]].every(([fn, args]) => api.request({ uid: JCE, op: 'rpc', fn, args }).status === 403));
  t('MOCK-API', 'JCE: may start an OPEN job order without a section (it takes the editor\'s section and assignment)', ok(api.request({ uid: JCE, op: 'rpc', fn: 'jo_set_status', args: { p_job_no: 'JO-2001', p_status: 'IN PROGRESS' } }))
    && (j => j.status === 'IN PROGRESS' && j.section === 'Electrical' && j.assignedToId === 4)(api.db.appData.jobOrders.find(j => j.jobNo === 'JO-2001')));
  t('MOCK-API', 'JCE: cannot complete another section\'s job order', api.request({ uid: U(7), op: 'rpc', fn: 'jo_set_status', args: { p_job_no: 'JO-2002', p_status: 'COMPLETED' } }).status === 403);
  t('MOCK-API', 'P2b: no role can rewrite the whole jobOrders array directly (0 rows), so the scope rules cannot be bypassed', PROFILES.every(p => (api.request({ uid: p.user_id, op: 'update', table: 'app_data', key: 'jobOrders', value: [] }).rows || []).length === 0) && api.db.appData.jobOrders.length === 8);
  const p2a = world('P2a');
  t('MOCK-API', 'P2a (documented gap, P2_AUTH_PLAN O12): a JCE CAN still rewrite the whole jobOrders array — DU/JCE scope is not server-enforced until P2b',
    p2a.request({ uid: JCE, op: 'update', table: 'app_data', key: 'jobOrders', value: [] }).rows.length === 1);
}
// approval workflow
{
  const api = world('P2b');
  t('MOCK-API', 'approve needs COMPLETED; close needs APPROVED; SE may approve and close; approval history appended',
    api.request({ uid: U(3), op: 'rpc', fn: 'jo_close', args: { p_job_no: 'JO-2003', p_closed_date: '2026-10-14' } }).status === 400 && ok(api.request({ uid: U(3), op: 'rpc', fn: 'jo_approve', args: { p_job_no: 'JO-2003' } }))
    && api.request({ uid: U(3), op: 'rpc', fn: 'jo_approve', args: { p_job_no: 'JO-2003' } }).status === 400 && ok(api.request({ uid: U(3), op: 'rpc', fn: 'jo_close', args: { p_job_no: 'JO-2003', p_closed_date: '2026-10-14' } }))
    && (j => j.status === 'CLOSED' && j.approvalHistory.map(e => e.event).join() === 'APPROVED,CLOSED' && j.approvedById === 3 && j.legacyField === 'keep')(api.db.appData.jobOrders.find(j => j.jobNo === 'JO-2003')));
  const b = world('P2b'); b.request({ uid: U(2), op: 'rpc', fn: 'jo_approve', args: { p_job_no: 'JO-2003' } });
  b.request({ uid: U(7), op: 'rpc', fn: 'jo_update_work', args: { p_job_no: 'JO-2003', p_fields: { workDone: 'changed after approval' } } });
  t('MOCK-API', 'changing completion details after approval resets it to PENDING (approver cleared, RESET appended)', (j => j.approvalStatus === 'PENDING' && !j.approvedBy && j.approvalHistory.map(e => e.event).join() === 'APPROVED,RESET')(b.db.appData.jobOrders.find(j => j.jobNo === 'JO-2003')));
  t('MOCK-API', 'every job-order change writes an audit row with the actor', api.db.audit.length >= 2 && api.db.audit.every(a => a.actor && a.action));
}

// ======================= [OPS] remaining P2b operations (0007) =======================
const ACTIVE = PROFILES.filter(p => p.active && !p.must_change_password);
const OPS = [   // [function, args, app capability]
  ['jo_revert', () => ({ p_job_no: 'JO-2007' }), 'jo.revert'],
  ['jo_delete', () => ({ p_job_no: 'JO-2001' }), 'jo.delete'],
  ['jo_import', () => ({ p_rows: [{ jobNo: 'JO-5001', assetNum: '9001', status: 'OPEN' }] }), 'jo.import'],
  ['category_rename', () => ({ p_old: CATS[0], p_new: 'renamed cat' }), 'asset.category.manage'],
  ['asset_clear_all', () => ({ p_confirm: 'DELETE ALL ASSETS' }), 'asset.clearAll'],
  ['employee_set_status', () => ({ p_emp_id: 'E1', p_updates: { siteStatus: 'ON LEAVE' }, p_entry: { type: 'Annual' } }), 'emp.statusUpdate'],
  ['employee_save', () => ({ p_emp: { empId: 'E2', name: 'Synthetic Two' } }), 'emp.admin'],
  ['employee_delete', () => ({ p_emp_id: 'E1' }), 'emp.admin'],
  ['employee_import', () => ({ p_rows: [{ empId: 'E3', name: 'Synthetic Three' }] }), 'emp.admin'],
  ['employee_apply_date_rules', () => ({}), 'emp.statusUpdate'],
];
{
  const { sanitizedIndex } = require('../lib/sanitize.js');
  const ctx = {}; vm.createContext(ctx); vm.runInContext("var DESIGNATIONS = {};", ctx);
  const html = sanitizedIndex();
  vm.runInContext(html.slice(html.indexOf('// ─── PERMISSIONS'), html.indexOf('// ─── DATA LOAD (N1)')) + '\nthis.X = {can};', ctx);
  const can = ctx.X.can;
  const diffs = [];
  for (const p of ACTIVE) for (const [fn, args, cap] of OPS) {
    const r = world('P2b').request({ uid: p.user_id, op: 'rpc', fn, args: args() });
    const app = can({ role: p.role }, cap);
    if ((r.status === 200) !== app) diffs.push({ role: p.role, fn, status: r.status, app });
  }
  t('OPS', `server role checks = app capabilities for ${OPS.length} operations × ${ACTIVE.length} users (revert Admin; delete/import AE+Admin; rename AE+Admin; clear-all Admin; employee status AE+Admin; employee admin Admin)`, diffs.length === 0, diffs);
  for (const n of [8, 9]) t('OPS', `${n === 8 ? 'inactive' : 'forced-change'} account: every new operation refused`, OPS.every(([fn, args]) => world('P2b').request({ uid: U(n), op: 'rpc', fn, args: args() }).status === 403));
  t('OPS', 'anonymous: every new operation refused (401)', OPS.every(([fn, args]) => world('P2b').request({ uid: null, op: 'rpc', fn, args: args() }).status === 401));

  let api = world('P2b');
  t('OPS', 'revert: CLOSED → COMPLETED, closure cleared, approval and history kept, REVERTED appended; only CLOSED can be reverted',
    ok(api.request({ uid: U(1), op: 'rpc', fn: 'jo_revert', args: { p_job_no: 'JO-2007' } })) && (j => j.status === 'COMPLETED' && j.closedBy === '' && j.approvalStatus === 'APPROVED' && j.approvalHistory.at(-1).event === 'REVERTED')(api.db.appData.jobOrders.find(j => j.jobNo === 'JO-2007'))
    && api.request({ uid: U(1), op: 'rpc', fn: 'jo_revert', args: { p_job_no: 'JO-2001' } }).status === 400);
  api = world('P2b');
  const rows = [{ jobNo: 'JO-6001', assetNum: '9001', status: 'OPEN', approvalStatus: 'APPROVED', closedBy: 'X', requesterId: 1, assignedToId: 4 },
    { jobNo: 'JO-6002', assetNum: '9001', status: 'COMPLETED', approved: 'yes' }, { jobNo: 'JO-6003', assetNum: '9001', status: 'CLOSED' }, { jobNo: 'JO-6004', assetNum: '9001', status: 'WHATEVER' },
    { jobNo: 'JO-2001', assetNum: '9001', status: 'OPEN', problem: 'overwrite attempt' }, { jobNo: 'JO-6005', status: 'OPEN' }];
  const imp = api.request({ uid: U(2), op: 'rpc', fn: 'jo_import', args: { p_rows: rows } }).data;
  const j1 = api.db.appData.jobOrders.find(j => j.jobNo === 'JO-6001'), j2 = api.db.appData.jobOrders.find(j => j.jobNo === 'JO-6002');
  t('OPS', 'import: OPEN/COMPLETED added, CLOSED and unknown statuses rejected, existing job numbers skipped (not overwritten), rows without an asset ignored',
    imp.added.join() === 'JO-6001,JO-6002' && imp.rejected.map(r => r.status).join() === 'CLOSED,WHATEVER' && imp.skipped.join() === 'JO-2001' && api.db.appData.jobOrders.find(j => j.jobNo === 'JO-2001').problem === 'p');
  t('OPS', 'import: control fields are not importable (no approval, closure, requester or assignee from the file); COMPLETED arrives PENDING; "approved" text never approves',
    !j1.approvalStatus && !j1.closedBy && j1.requesterId === undefined && j1.assignedToId === undefined && j2.approvalStatus === 'PENDING');
  api = world('P2b');
  const ids0 = JSON.stringify(api.db.appData.jobOrders.map(j => [j.jobNo, j.requesterId, j.approvedById, j.assignedToId])), du0 = api.db.profiles.find(p => p.user_id === U(5));
  ok(api.request({ uid: U(2), op: 'rpc', fn: 'category_rename', args: { p_old: CATS[1], p_new: ' new cat b ' } }));
  t('OPS', 'category rename: categories, asset plants, job-order categories and DU assigned categories follow in one step; user ids and job-order references unchanged',
    api.db.appData.customPlants.includes('NEW CAT B') && !api.db.appData.customPlants.includes(CATS[1]) && api.db.appData.assets.find(a => a.num === '9002').plant === 'NEW CAT B'
    && api.db.appData.jobOrders.filter(j => j.assetCategory === 'NEW CAT B').length === 3 && api.db.profiles.find(p => p.user_id === U(5)).assigned_categories.join() === 'NEW CAT B'
    && JSON.stringify(api.db.appData.jobOrders.map(j => [j.jobNo, j.requesterId, j.approvedById, j.assignedToId])) === ids0 && du0.legacy_id === 5);
  t('OPS', 'category rename: duplicate (case-insensitive) → 409; unknown category → 404; nothing changed', api.request({ uid: U(2), op: 'rpc', fn: 'category_rename', args: { p_old: CATS[0], p_new: 'new cat b' } }).status === 409
    && api.request({ uid: U(2), op: 'rpc', fn: 'category_rename', args: { p_old: 'NO SUCH', p_new: 'X' } }).status === 404 && api.db.appData.customPlants.includes(CATS[0]));
  api = world('P2b');
  t('OPS', 'clear-all: wrong phrase refused (400); Admin with the phrase empties the asset list; a DIRECT empty write is refused by the guard (even for Admin)',
    api.request({ uid: U(1), op: 'update', table: 'app_data', key: 'assets', value: [] }).status === 403 && api.request({ uid: U(1), op: 'rpc', fn: 'asset_clear_all', args: { p_confirm: 'yes' } }).status === 400
    && api.db.appData.assets.length === 3 && ok(api.request({ uid: U(1), op: 'rpc', fn: 'asset_clear_all', args: { p_confirm: 'DELETE ALL ASSETS' } })) && api.db.appData.assets.length === 0);
  api = world('P2b');
  api.db.appData.employees = [{ empId: 'E1', name: 'Synthetic Person', siteStatus: 'ON DUTY', leaveHistory: [{ type: 'old' }] }];
  ok(api.request({ uid: U(2), op: 'rpc', fn: 'employee_set_status', args: { p_emp_id: 'E1', p_updates: { siteStatus: 'ON LEAVE', leaveStart: '2026-10-10', name: 'Hacked', leaveHistory: [] }, p_entry: { type: 'Annual', remarks: 'r', evil: 1 } } }));
  const e1 = api.db.appData.employees[0];
  t('OPS', 'employee status (AE): only status/leave fields change; the name cannot; one history entry is APPENDED (old entries kept, unknown keys dropped)',
    e1.siteStatus === 'ON LEAVE' && e1.name === 'Synthetic Person' && e1.leaveHistory.length === 2 && e1.leaveHistory[0].type === 'old' && !('evil' in e1.leaveHistory[1]));
  t('OPS', 'employee status: an invalid status is refused (400)', api.request({ uid: U(2), op: 'rpc', fn: 'employee_set_status', args: { p_emp_id: 'E1', p_updates: { siteStatus: 'FIRED' } } }).status === 400);
  t('OPS', 'employee administration is Admin only: AE cannot add, edit, delete or import (status updates only)', ['employee_save', 'employee_delete', 'employee_import'].every(fn => api.request({ uid: U(2), op: 'rpc', fn, args: { p_emp: { empId: 'E9', name: 'n' }, p_emp_id: 'E1', p_rows: [] } }).status === 403));
  t('OPS', 'employee edit (Admin) keeps the id and the leave history; adding a duplicate id → 409', ok(api.request({ uid: U(1), op: 'rpc', fn: 'employee_save', args: { p_emp: { empId: 'CHANGED', name: 'Renamed' }, p_edit_id: 'E1' } }))
    && api.db.appData.employees[0].empId === 'E1' && api.db.appData.employees[0].leaveHistory.length === 2 && api.request({ uid: U(1), op: 'rpc', fn: 'employee_save', args: { p_emp: { empId: 'E1', name: 'Dup' } } }).status === 409);
  t('OPS', 'P2b switch (0009): direct whole-row writes of employees and jobOrders affect 0 rows for every role', ACTIVE.every(p => ['employees', 'jobOrders'].every(k => (api.request({ uid: p.user_id, op: 'update', table: 'app_data', key: k, value: [{ x: 1 }] }).rows || []).length === 0)));
  api = world('P2b'); api.db.appData.employees = [{ empId: 'E1', siteStatus: 'ON DUTY', leaveStart: '2000-01-01', leaveEnd: '2999-01-01' }];
  t('OPS', 'date rules on the server (replaces the client write-back): AE corrects the status once; Viewer refused', api.request({ uid: U(2), op: 'rpc', fn: 'employee_apply_date_rules' }).data === 1
    && api.db.appData.employees[0].siteStatus === 'ON LEAVE' && api.request({ uid: U(2), op: 'rpc', fn: 'employee_apply_date_rules' }).data === 0 && api.request({ uid: U(6), op: 'rpc', fn: 'employee_apply_date_rules' }).status === 403);
}

// ======================= [NOTIFY] server-side notifications (0008 rules, model) =======================
{
  const { NOTIFY_RULES, isRecipient, createNotificationStore, joEventsFromDiff } = await imp('p2/model/notifications.mjs');
  const api = world('P2b');
  const list = n => api.request({ uid: U(n), op: 'rpc', fn: 'my_notifications' }).data;
  const keys = n => list(n).map(x => x.jobNo + ':' + x.event).sort().join();
  // DU raises a job order (no section) -> OPEN to Admin, AE, SE only
  const no = api.request({ uid: U(5), op: 'rpc', fn: 'jo_create', args: { p_jo: { assetNum: '9002', repairType: 'Unplanned', problem: 'n' } } }).data;
  t('NOTIFY', 'job order raised: OPEN goes to Admin, AE and SE; not to the DU who raised it, JCEs (no section yet), the Viewer, or inactive accounts',
    [1, 2, 3].every(n => keys(n) === no + ':OPEN') && [4, 5, 6, 7].every(n => list(n).length === 0) && api.notes._state().notes.every(x => x.recipient !== U(8)));
  // AE assigns to the Electrical JCE (start) -> IN_PROGRESS to Admin/AE/SE + the DU requester
  api.request({ uid: U(2), op: 'rpc', fn: 'jo_set_status', args: { p_job_no: no, p_status: 'IN PROGRESS', p_assignee_legacy_id: 4 } });
  t('NOTIFY', 'IN PROGRESS: Admin, AE, SE and the DU who raised it; no JCE (they get only created/closed)', [1, 2, 3, 5].every(n => list(n).some(x => x.jobNo === no && x.event === 'IN_PROGRESS')) && [4, 6, 7].every(n => !list(n).some(x => x.event === 'IN_PROGRESS')));
  api.request({ uid: U(4), op: 'rpc', fn: 'jo_set_status', args: { p_job_no: no, p_status: 'COMPLETED' } });
  api.request({ uid: U(3), op: 'rpc', fn: 'jo_approve', args: { p_job_no: no } });
  api.request({ uid: U(3), op: 'rpc', fn: 'jo_close', args: { p_job_no: no, p_closed_date: '2026-10-14' } });
  t('NOTIFY', 'COMPLETED: Admin, AE, SE and the DU requester', [1, 2, 3, 5].every(n => list(n).some(x => x.jobNo === no && x.event === 'COMPLETED')) && !list(4).some(x => x.event === 'COMPLETED'));
  t('NOTIFY', 'CLOSED: Admin, AE, SE, the DU requester and the Electrical JCE (its section); not the Mechanical JCE or the Viewer',
    [1, 2, 3, 4, 5].every(n => list(n).some(x => x.jobNo === no && x.event === 'CLOSED')) && !list(7).length && !list(6).length);
  t('NOTIFY', 'approval itself is not a lifecycle notification (only OPEN, IN PROGRESS, COMPLETED, CLOSED)', list(1).every(x => ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'].includes(x.event)) && list(1).filter(x => x.jobNo === no).length === 4);
  const n0 = api.notes._state().notes.length;
  const dupStart = api.request({ uid: U(2), op: 'rpc', fn: 'jo_set_status', args: { p_job_no: no, p_status: 'IN PROGRESS', p_assignee_legacy_id: 4 } });
  const dupClose = api.request({ uid: U(3), op: 'rpc', fn: 'jo_close', args: { p_job_no: no, p_closed_date: '2026-10-14' } });
  api.request({ uid: U(1), op: 'update', table: 'app_data', key: 'jobOrders', value: clone(api.db.appData.jobOrders) });
  t('NOTIFY', 'no duplicates: a repeated or invalid step and a direct write create no notification', dupStart.status !== 200 && dupClose.status !== 200 && api.notes._state().notes.length === n0);
  api.request({ uid: U(1), op: 'rpc', fn: 'jo_revert', args: { p_job_no: no } });
  api.request({ uid: U(3), op: 'rpc', fn: 'jo_close', args: { p_job_no: no, p_closed_date: '2026-10-15' } });
  t('NOTIFY', 'a real second closing (after a revert) is a new event (seq 2), delivered once per recipient', list(1).filter(x => x.jobNo === no && x.event === 'CLOSED').length === 2
    && new Set(api.notes._state().notes.map(x => x.eventId + '|' + x.recipient)).size === api.notes._state().notes.length);
  // Admin creates with a section -> the JCE of that section gets OPEN
  const no2 = api.request({ uid: U(1), op: 'rpc', fn: 'jo_create', args: { p_jo: { assetNum: '9001', problem: 'x', section: 'Mechanical' } } }).data;
  t('NOTIFY', 'job order created FOR a section: the JCE of that section gets OPEN; the other JCE does not', list(7).some(x => x.jobNo === no2 && x.event === 'OPEN') && !list(4).some(x => x.jobNo === no2));
  // read / unread
  const mine = list(5);
  t('NOTIFY', 'new notifications are unread and carry the job-order reference (jobNo, asset, department)', mine.length > 0 && mine.every(x => x.read === false && x.jobNo && x.assetNum === '9002' && x.dept === 'Cement Plant'));
  const otherIds = list(1).map(x => x.id);
  t('NOTIFY', 'a user cannot mark someone else\'s notifications as read (0 changed)', api.request({ uid: U(5), op: 'rpc', fn: 'notification_mark_read', args: { p_ids: otherIds } }).data === 0 && list(1).every(x => !x.read));
  api.request({ uid: U(5), op: 'rpc', fn: 'notification_mark_read', args: { p_ids: [mine[0].id] } });
  t('NOTIFY', 'marking one notification read changes only that one; marking all reads the rest; repeating changes nothing', list(5).filter(x => x.read).length === 1
    && api.request({ uid: U(5), op: 'rpc', fn: 'notification_mark_read', args: { p_ids: null } }).data === mine.length - 1 && list(5).every(x => x.read) && api.request({ uid: U(5), op: 'rpc', fn: 'notification_mark_read', args: {} }).data === 0);
  t('NOTIFY', 'anonymous, inactive and forced-change accounts cannot read notifications', api.request({ uid: null, op: 'rpc', fn: 'my_notifications' }).status === 401
    && api.request({ uid: U(8), op: 'rpc', fn: 'my_notifications' }).status === 403 && api.request({ uid: U(9), op: 'rpc', fn: 'my_notifications' }).status === 403);
  t('NOTIFY', 'P2a (before 0008): the notification functions do not exist yet', world('P2a').request({ uid: U(1), op: 'rpc', fn: 'my_notifications' }).status === 404);
  t('NOTIFY', 'the lifecycle hook cannot be called through the API', api.request({ uid: U(1), op: 'rpc', fn: 'on_jo_event' }).status === 403);
  // the rule table itself, against every role × event × job-order shape
  const shapes = [{ section: '', requesterId: 5 }, { section: 'Electrical', requesterId: 5 }, { section: 'Mechanical', requesterId: 10 }];
  const bad = [];
  for (const p of PROFILES) for (const ev of ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']) for (const sh of shapes) {
    const exp = p.active && (['Admin', 'Assistant Engineer', 'Senior Engineer'].includes(p.role) || (p.role === 'Job Card Editor' && ['OPEN', 'CLOSED'].includes(ev) && sh.section === p.section)
      || (p.role === 'Department User' && ev !== 'OPEN' && sh.requesterId === p.legacy_id));
    if (isRecipient(p, ev, sh) !== exp) bad.push([p.role, p.legacy_id, ev, sh]);
  }
  t('NOTIFY', 'recipient rules for 10 accounts × 4 events × 3 job-order shapes match the requirements exactly (Viewer: none)', bad.length === 0 && NOTIFY_RULES.Viewer.length === 0, bad.slice(0, 4));
  const st = createNotificationStore(), users = [{ id: 1, role: 'Admin', active: true }];
  const a = [J('JO-1', 'OPEN')], b = [J('JO-1', 'IN PROGRESS')];
  let stored = [];   // like the local mock: every write is compared with what is STORED, then stored
  for (const w of [a, a, b, b, clone(b)]) { st.recordWrite(stored, w, users); stored = w; }
  t('NOTIFY', 'diff-based events (local mock): repeated identical writes yield nothing; each real transition exactly one event', joEventsFromDiff(a, a).length === 0 && st.list(1).map(x => x.event).join() === 'IN_PROGRESS,OPEN');
}

// ======================= [EQUIV] model vs the current app rules (index.html) =======================
{
  const { sanitizedIndex } = require('../lib/sanitize.js');
  const html = sanitizedIndex();
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext("var DESIGNATIONS = {};", ctx);
  vm.runInContext(html.slice(html.indexOf('// ─── PERMISSIONS'), html.indexOf('// ─── DATA LOAD (N1)')) + '\nthis.X = {can, mayEditJO, canSeeJO, jceSectionAllows, canApproveJO, canCloseJO};', ctx);
  const A = ctx.X;
  const appUser = p => ({ id: p.legacy_id, role: p.role, department: p.department, assignedCategories: p.assigned_categories, section: p.section, active: p.active });
  const grid = [];
  for (const st of ['OPEN', 'IN PROGRESS', 'COMPLETED', 'CLOSED']) for (const sec of ['', 'Electrical', 'Mechanical']) for (const dept of ['Cement Plant', 'HR']) for (const req of [5, 10, 2]) for (const appr of [undefined, 'APPROVED'])
    grid.push({ ...J('JO-3000', st, { section: sec, dept, requesterId: req, approvalStatus: appr, assetNum: dept === 'HR' ? '9003' : '9002', repairType: 'Unplanned' }) });
  const diffs = [];
  for (const p of PROFILES.filter(p => p.active && !p.must_change_password)) for (const jo of grid) {
    const u = appUser(p);
    // a FRESH model per action: each action is judged on the same starting job order
    const call = (fn, args) => createMockDataApi({ profiles: PROFILES, appData: { ...APP, jobOrders: [jo] } }, 'P2b').request({ uid: p.user_id, op: 'rpc', fn, args: { p_job_no: 'JO-3000', ...args } }).status === 200;
    const rows = [
      ['update_request', call('jo_update_request', { p_fields: { problem: 'x' } }), A.can(u, 'jo.edit.request') && A.mayEditJO(u, jo)],
      ['update_work', call('jo_update_work', { p_fields: { workDone: 'x' } }), A.can(u, 'jo.edit.work') && A.mayEditJO(u, jo)],
      ['start', call('jo_set_status', { p_status: 'IN PROGRESS', p_assignee_legacy_id: 4 }), A.can(u, 'jo.start') && A.canSeeJO(u, jo) && jo.status === 'OPEN' && A.jceSectionAllows(u, jo, 'start')],
      ['complete', call('jo_set_status', { p_status: 'COMPLETED' }), A.can(u, 'jo.complete') && A.canSeeJO(u, jo) && jo.status === 'IN PROGRESS' && A.jceSectionAllows(u, jo, 'progress')],
      ['approve', call('jo_approve', {}), A.can(u, 'jo.approve') && A.canSeeJO(u, jo) && A.canApproveJO(jo)],
      ['close', call('jo_close', { p_closed_date: '2026-10-14' }), A.can(u, 'jo.close') && A.canSeeJO(u, jo) && A.canCloseJO(jo)],
    ];
    rows.forEach(([what, model, app]) => { if (model !== app) diffs.push({ role: p.role, id: p.legacy_id, what, status: jo.status, section: jo.section, dept: jo.dept, req: jo.requesterId, appr: jo.approvalStatus, model, app }); });
  }
  t('EQUIV', `server design = current app rules for 6 job-order actions × ${PROFILES.filter(p => p.active && !p.must_change_password).length} users × ${grid.length} job orders (DU department/own/OPEN, JCE section, approval, close)`, diffs.length === 0, diffs.slice(0, 5));
  const listDiffs = PROFILES.filter(p => p.active && !p.must_change_password).filter(p => {
    const api = world('P2b'); const got = api.request({ uid: p.user_id, op: 'rpc', fn: 'jo_list' }).data.map(j => j.jobNo).join();
    return got !== APP.jobOrders.filter(j => A.canSeeJO(appUser(p), j)).map(j => j.jobNo).join();
  }).map(p => p.role);
  t('EQUIV', 'jo_list returns exactly what the app shows each role (canSeeJO)', listDiffs.length === 0, listDiffs);
}

// ======================= [HANDLERS] Edge Function logic with fake dependencies =======================
function fakeDeps(extra = {}) {
  const st = { profiles: clone(PROFILES), users: {}, outbox: [], audit: [], limits: {}, verifications: {}, clock: Date.parse('2026-10-14T08:00:00Z'), slept: 0, sessionsRevoked: [], failNext: {}, links: [] };
  PROFILES.forEach(p => { st.users[p.user_id] = { email: policy.signInEmail(p.employee_id, DOMAIN), password: 'Synthetic-Pass-' + p.legacy_id, banned: !p.active }; });
  let seq = 100;
  const prof = uid => st.profiles.find(p => p.user_id === uid) || null;
  const deps = {
    config: { signInDomain: DOMAIN, appUrl: 'https://cmms.example.invalid/', verifyTtlMinutes: 60, recoveryMinMs: 600 },
    now: () => new Date(st.clock), sleep: async ms => { st.slept += ms; st.clock += ms; },
    randomUint32: n => new Uint32Array(crypto.randomBytes(4 * n).buffer.slice(0)), randomToken: () => crypto.randomBytes(32).toString('base64url'),
    hash: async s => crypto.createHmac('sha256', 'test-pepper').update(s).digest('hex'),
    auth: {
      createUser: async ({ email, password, email_confirm }) => { if (st.failNext.createUser) throw new Error('x'); const id = 'n' + (++seq); st.users[id] = { email, password, banned: false, confirmed: email_confirm }; return { id }; },
      updateUser: async (id, a) => { if (st.failNext.updateUser) throw new Error('x'); if (a.password) st.users[id].password = a.password; if (a.ban_duration) st.users[id].banned = a.ban_duration !== 'none'; },
      deleteUser: async id => { delete st.users[id]; },
      signOutAll: async id => { st.sessionsRevoked.push(id); },
      generateRecoveryLink: async email => { st.links.push(email); return 'https://auth.example.invalid/recover?t=synthetic'; },
      verifyPassword: async (email, pw) => Object.values(st.users).some(u => u.email === email && u.password === pw && !u.banned),
    },
    db: {
      profileByUser: async uid => clone(prof(uid)), profileByEmployeeId: async e => clone(st.profiles.find(p => p.employee_id === e) || null),
      profileByRecoveryEmail: async e => clone(st.profiles.find(p => p.recovery_email === e) || null), profileByLegacyId: async n => clone(st.profiles.find(p => p.legacy_id === n) || null),
      insertProfile: async row => { if (st.failNext.insertProfile) throw new Error('x'); st.profiles.push(clone(row)); },
      updateProfile: async (uid, patch) => { if (st.failNext.updateProfile) throw new Error('x'); Object.assign(prof(uid), clone(patch)); },
      nextLegacyId: async () => Math.max(...st.profiles.map(p => p.legacy_id)) + 1,
      activeAdminCount: async () => st.profiles.filter(p => p.role === 'Admin' && p.active).length,
      knownCategories: async () => CATS,
      rateLimitHit: async (bucket, subj, max) => { const k = bucket + '|' + subj; st.limits[k] = (st.limits[k] || 0) + 1; return st.limits[k] <= max; },
      insertAudit: async row => { st.audit.push(clone(row)); },
      saveVerification: async row => { st.verifications[row.token_hash] = clone(row); },
      takeVerification: async (h, now) => { const v = st.verifications[h]; if (!v || v.used_at || Date.parse(v.expires_at) <= now.getTime()) return null; v.used_at = now.toISOString(); return clone(v); },
    },
    mail: { send: async m => { st.outbox.push(clone(m)); } },
    log: () => {},
    ...extra,
  };
  return { deps, st, h: createHandlers(deps) };
}
const tokenFrom = mail => (mail.text.match(/#verify-email=([A-Za-z0-9_-]+)/) || [])[1];
{
  // ---- admin-users: create ----
  const NEW = { action: 'create', employeeId: ' ab12c ', fullName: 'Synthetic New Viewer', recoveryEmail: 'New.Viewer@Example.Invalid', role: 'Viewer' };
  let { h, st } = fakeDeps();
  const denied = await Promise.all([U(2), U(3), U(4), U(5), U(6), U(8), U(9), null].map(c => h.adminUsers({ caller: c, ip: '1', body: NEW })));
  t('HANDLERS', 'create: refused (403, same message) for every non-Admin, an inactive account, a forced-change account and anonymous', denied.every(r => r.status === 403 && r.body.error === policy.NOT_ALLOWED) && st.profiles.length === PROFILES.length);
  const cr = await h.adminUsers({ caller: U(1), ip: '1', body: NEW });
  const np = st.profiles.find(p => p.employee_id === 'AB12C');
  t('HANDLERS', 'create (Admin): Employee ID normalized; internal sign-in address; profile with must_change_password; next legacy id; email lower-cased and NOT yet verified',
    cr.status === 200 && !!np && np.must_change_password === true && np.legacy_id === 11 && np.recovery_email === 'new.viewer@example.invalid' && !np.recovery_email_verified_at && st.users[cr.body.userId].email === 'ab12c@' + DOMAIN, cr);
  t('HANDLERS', 'create: the temporary password satisfies the policy, is returned once with no-store, and is stored nowhere else',
    policy.validatePassword(cr.body.temporaryPassword) === null && cr.headers['Cache-Control'] === 'no-store' && !JSON.stringify(st.audit).includes(cr.body.temporaryPassword) && !JSON.stringify(st.profiles).includes(cr.body.temporaryPassword) && !JSON.stringify(st.outbox).includes(cr.body.temporaryPassword));
  t('HANDLERS', 'create: a verification email goes to the RECOVERY address (not the sign-in address); audit row written',
    st.outbox.length === 1 && st.outbox[0].to === 'new.viewer@example.invalid' && !!tokenFrom(st.outbox[0]) && st.audit.some(a => a.action === 'account.create' && a.actor === U(1) && a.target === cr.body.userId));
  const dup = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, recoveryEmail: 'other@example.invalid' } });
  const dupMail = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'ZZ999' } });
  const badId = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'AB-12' } });
  const synth = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'ZZ998', recoveryEmail: 'zz998@' + DOMAIN } });
  const badRole = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'ZZ997', recoveryEmail: null, role: 'Superuser' } });
  const duNoDept = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'ZZ996', recoveryEmail: null, role: 'Department User' } });
  const legacyTaken = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'ZZ995', recoveryEmail: null, legacyId: 3 } });
  t('HANDLERS', 'create: duplicate Employee ID / recovery email / legacy id refused (409); bad ID format, unknown role, incomplete DU refused (400)',
    dup.status === 409 && dupMail.status === 409 && legacyTaken.status === 409 && badId.status === 400 && badRole.status === 400 && duNoDept.status === 400);
  t('HANDLERS', 'create: an address at the internal sign-in domain is refused as a recovery email (no synthetic recovery)', synth.status === 400 && !st.profiles.some(p => p.employee_id === 'ZZ998'));
  ({ h, st } = fakeDeps()); st.failNext.insertProfile = true;
  const nUsers = Object.keys(st.users).length;
  const comp = await h.adminUsers({ caller: U(1), ip: '1', body: NEW });
  t('HANDLERS', 'create: if the profile cannot be written, the new Auth user is deleted again (no orphan login)', comp.status === 500 && Object.keys(st.users).length === nUsers);
  ({ h, st } = fakeDeps());
  const mig = await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'MG001', recoveryEmail: null, legacyId: 42 } });
  t('HANDLERS', 'create (migration): an explicit legacy id is kept exactly (job-order references stay valid)', mig.status === 200 && st.profiles.find(p => p.employee_id === 'MG001').legacy_id === 42);
  ({ h, st } = fakeDeps());
  const burst = [];
  for (let i = 0; i < LIMITS.admin.max + 1; i++) burst.push((await h.adminUsers({ caller: U(1), ip: '1', body: { ...NEW, employeeId: 'RL' + String(i).padStart(3, '0'), recoveryEmail: null } })).status);
  t('HANDLERS', `create: rate-limited per Admin (${LIMITS.admin.max}/hour, then 429)`, burst.slice(0, LIMITS.admin.max).every(s => s === 200) && burst[LIMITS.admin.max] === 429);

  // ---- reset / set_active / update ----
  ({ h, st } = fakeDeps());
  const selfReset = await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'reset_password', userId: U(1) } });
  const rs = await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'reset_password', userId: U(4) } });
  t('HANDLERS', 'reset_password: not on the own account; target gets a new policy-compliant temporary password, must change it, sessions revoked, audited',
    selfReset.status === 403 && rs.status === 200 && st.users[U(4)].password === rs.body.temporaryPassword && st.profiles.find(p => p.user_id === U(4)).must_change_password === true
    && st.sessionsRevoked.includes(U(4)) && st.audit.some(a => a.action === 'account.reset_password' && a.target === U(4)));
  t('HANDLERS', 'reset_password: refused for non-Admins', (await h.adminUsers({ caller: U(2), ip: '1', body: { action: 'reset_password', userId: U(4) } })).status === 403);
  const deact = await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'set_active', userId: U(3), active: false } });
  t('HANDLERS', 'deactivate: profile inactive, Auth user banned, sessions revoked, audited', deact.status === 200 && st.profiles.find(p => p.user_id === U(3)).active === false && st.users[U(3)].banned && st.sessionsRevoked.includes(U(3)) && st.audit.some(a => a.action === 'account.deactivate'));
  t('HANDLERS', 'deactivate / role change of the own account refused', (await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'set_active', userId: U(1), active: false } })).status === 403
    && (await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(1), role: 'Viewer' } })).status === 403);
  {   // last-Admin protection: an Admin can never change their own role/status (above); this backstop covers inconsistent
      // state (e.g. a stale count) — the database trigger profiles_keep_admin is the final line (staging test R-ADMIN)
    const f = fakeDeps(); f.st.profiles.push({ ...P(20, 'Admin') }); f.st.users.u20 = { email: 'x', password: 'y', banned: false };
    f.deps.db.activeAdminCount = async () => 1;
    const hh = createHandlers(f.deps);
    const d1 = await hh.adminUsers({ caller: U(1), ip: '1', body: { action: 'set_active', userId: 'u20', active: false } });
    const d2 = await hh.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: 'u20', role: 'Viewer' } });
    t('HANDLERS', 'the last active Admin cannot be deactivated or demoted (409); nothing changed', d1.status === 409 && d2.status === 409 && f.st.profiles.find(p => p.user_id === 'u20').active && f.st.profiles.find(p => p.user_id === 'u20').role === 'Admin');
  }
  const roleChg = await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(6), role: 'Job Card Editor', section: 'Maintenance' } });
  const badScope = await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(6), role: 'Department User', department: 'Cement Plant', assignedCategories: ['99 UNKNOWN'] } });
  t('HANDLERS', 'update: role change validated (JCE needs a section; DU categories must exist), audited', roleChg.status === 200 && st.profiles.find(p => p.user_id === U(6)).role === 'Job Card Editor' && badScope.status === 400);
  const em = await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(3), recoveryEmail: 'changed.se@example.invalid' } });
  t('HANDLERS', 'update: a changed recovery email is UNverified until the new address confirms it (verification mail sent there)',
    em.status === 200 && (p => p.recovery_email === 'changed.se@example.invalid' && p.recovery_email_verified_at === null)(st.profiles.find(p => p.user_id === U(3))) && st.outbox.at(-1).to === 'changed.se@example.invalid');

  // ---- complete-password-change ----
  ({ h, st } = fakeDeps());
  st.profiles.find(p => p.user_id === U(6)).must_change_password = true;
  const cpw = (caller, cur, nw) => h.completePasswordChange({ caller, ip: '1', body: { currentPassword: cur, newPassword: nw } });
  t('HANDLERS', 'password change: anonymous 401, inactive account 403', (await cpw(null, 'a', 'b')).status === 401 && (await cpw(U(8), 'Synthetic-Pass-8', 'New-Pass-123!')).status === 403);
  const weak = await cpw(U(6), 'Synthetic-Pass-6', 'weakpass');
  const wrong = await cpw(U(6), 'Wrong-Pass-1!', 'New-Pass-123!');
  const reuse = await cpw(U(6), 'Synthetic-Pass-6', 'Synthetic-Pass-6');
  t('HANDLERS', 'forced change: weak, reused or wrong-current passwords refused; the flag stays set and the password is unchanged',
    weak.status === 400 && wrong.status === 400 && reuse.status === 400 && st.profiles.find(p => p.user_id === U(6)).must_change_password === true && st.users[U(6)].password === 'Synthetic-Pass-6');
  st.failNext.updateUser = true;
  const authFail = await cpw(U(6), 'Synthetic-Pass-6', 'New-Pass-123!');
  t('HANDLERS', 'forced change: if Auth refuses the new password, the flag stays set (cleared only after success)', authFail.status === 500 && st.profiles.find(p => p.user_id === U(6)).must_change_password === true);
  st.failNext.updateUser = false;
  const good = await cpw(U(6), 'Synthetic-Pass-6', 'New-Pass-123!');
  t('HANDLERS', 'forced change succeeds: new password set, flag cleared, audited', good.status === 200 && st.users[U(6)].password === 'New-Pass-123!' && st.profiles.find(p => p.user_id === U(6)).must_change_password === false && st.audit.some(a => a.action === 'password.forced_change'));
  const flood = []; for (let i = 0; i < LIMITS.pwchange.max + 1; i++) flood.push((await cpw(U(3), 'Wrong-Pass-1!', 'New-Pass-123!')).status);
  t('HANDLERS', `password change: rate-limited per user (${LIMITS.pwchange.max} per 15 min, then 429)`, flood[LIMITS.pwchange.max] === 429);

  // ---- request-recovery (non-enumerating) ----
  ({ h, st } = fakeDeps());
  st.profiles.find(p => p.user_id === U(2)).recovery_email_verified_at = null;     // unverified
  st.profiles.find(p => p.user_id === U(4)).recovery_email = null;                 // no email
  const rec = async (id, ip) => { const t0 = st.clock; const r = await h.requestRecovery({ caller: null, ip: ip || 'ip-' + id, body: { employeeId: id } }); return { r, ms: st.clock - t0 }; };
  const cases = { verified: 'TS003', unknown: 'QQ999', malformed: 'x', inactive: 'TS008', unverified: 'TS002', noEmail: 'TS004', empty: '' };
  const out = {}; for (const [k, id] of Object.entries(cases)) out[k] = await rec(id);
  const shapes = new Set(Object.values(out).map(o => JSON.stringify([o.r.status, o.r.body, o.r.headers])));
  t('HANDLERS', 'recovery: identical status, body and headers for verified, unknown, malformed, inactive, unverified and email-less IDs', shapes.size === 1 && out.unknown.r.status === 202 && out.unknown.r.body.message === policy.RECOVERY_ACK, [...shapes]);
  t('HANDLERS', 'recovery: every response takes at least the minimum duration (timing does not reveal the outcome)', Object.values(out).every(o => o.ms >= 600));
  t('HANDLERS', 'recovery: exactly one email, only for the active account with a VERIFIED address, sent to that address; the link is made for the internal sign-in address',
    st.outbox.length === 1 && st.outbox[0].to === PROFILES[2].recovery_email && st.links.length === 1 && st.links[0] === policy.signInEmail('TS003', DOMAIN) && !st.outbox.some(m => m.to.endsWith('@' + DOMAIN)));
  const sent0 = st.outbox.length; const rl = [];
  for (let i = 0; i < 5; i++) rl.push(await rec('TS003', 'ip-other-' + i));
  t('HANDLERS', `recovery: rate-limited per Employee ID (${LIMITS.recoveryId.max}/hour); over the limit the response is still identical and nothing is sent`,
    st.outbox.length - sent0 === LIMITS.recoveryId.max - 1 && new Set(rl.map(o => JSON.stringify([o.r.status, o.r.body]))).size === 1);
  ({ h, st } = fakeDeps());
  for (let i = 0; i < LIMITS.recoveryIp.max; i++) await rec('QQ' + String(i).padStart(3, '0'), 'one-ip');
  await rec('TS003', 'one-ip');
  t('HANDLERS', `recovery: rate-limited per client IP (${LIMITS.recoveryIp.max}/hour)`, st.outbox.length === 0);
  t('HANDLERS', 'recovery: rate-limit subjects are HMAC hashes (no Employee ID or IP stored)', Object.keys(st.limits).every(k => /^recovery:(ip|id)\|[0-9a-f]{64}$/.test(k)) && !Object.keys(st.limits).join().includes('one-ip'));

  // ---- verify-recovery-email ----
  ({ h, st } = fakeDeps());
  await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(3), recoveryEmail: 'se.new@example.invalid' } });
  const tok = tokenFrom(st.outbox.at(-1));
  const bad = await h.verifyRecoveryEmail({ caller: null, ip: '1', body: { token: 'x'.repeat(43) } });
  const v1 = await h.verifyRecoveryEmail({ caller: null, ip: '1', body: { token: tok } });
  const verifiedAt = st.profiles.find(p => p.user_id === U(3)).recovery_email_verified_at;
  const v2 = await h.verifyRecoveryEmail({ caller: null, ip: '1', body: { token: tok } });
  t('HANDLERS', 'verify email: a valid token verifies the address; an invalid or reused token changes nothing; same response every time',
    !!verifiedAt && [bad, v1, v2].every(r => r.status === 200 && r.body.message === policy.VERIFY_ACK) && st.profiles.find(p => p.user_id === U(3)).recovery_email_verified_at === verifiedAt);
  ({ h, st } = fakeDeps());
  await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(3), recoveryEmail: 'first@example.invalid' } });
  const tA = tokenFrom(st.outbox.at(-1));
  await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(3), recoveryEmail: 'second@example.invalid' } });
  await h.verifyRecoveryEmail({ caller: null, ip: '1', body: { token: tA } });
  t('HANDLERS', 'verify email: a token for an address that was changed since does not verify the new address', st.profiles.find(p => p.user_id === U(3)).recovery_email_verified_at === null);
  ({ h, st } = fakeDeps());
  await h.adminUsers({ caller: U(1), ip: '1', body: { action: 'update', userId: U(3), recoveryEmail: 'late@example.invalid' } });
  st.clock += 61 * 60000;
  await h.verifyRecoveryEmail({ caller: null, ip: '1', body: { token: tokenFrom(st.outbox.at(-1)) } });
  t('HANDLERS', 'verify email: an expired token does nothing', st.profiles.find(p => p.user_id === U(3)).recovery_email_verified_at === null);
}

// ======================= [CLIENT] browser adapter (disabled by default) =======================
{
  let created = 0;
  const fakeCreate = (behaviour) => (url, key, opts) => { created++; const calls = [];
    return { opts, calls, auth: {
      signInWithPassword: async a => { calls.push(a.email); return behaviour(a); },
      signOut: async () => { calls.push('signOut'); }, getUser: async () => ({ data: { user: { id: 'u6' } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: behaviour.profile || { active: true, must_change_password: false } }) }) }) }) }; };
  const off = createSupabaseAuthAdapter({ createClient: fakeCreate(() => ({})), url: 'https://x.example.invalid', anonKey: 'anon', signInDomain: DOMAIN });
  t('CLIENT', 'disabled by default: no client is created, sign-in returns "disabled"', !off.enabled && created === 0 && (await off.signIn('TS006', 'x')).reason === 'disabled');
  const mk = (beh, prof) => { if (prof) beh.profile = prof; return createSupabaseAuthAdapter({ enabled: true, createClient: fakeCreate(beh), url: 'https://x.example.invalid', anonKey: 'anon-public', signInDomain: DOMAIN }); };
  const invalid = { error: { status: 400, message: 'Invalid login credentials' }, data: {} };
  const aBad = mk(() => invalid);
  const r1 = await aBad.signIn('x', 'Some-Pass-1!'), r2 = await aBad.signIn('QQ999', 'Some-Pass-1!'), r3 = await aBad.signIn('TS006', 'wrong');
  const aBanned = mk(() => ({ error: { status: 400, message: 'User is banned' }, data: {} }));
  const r4 = await aBanned.signIn('TS008', 'Synthetic-Pass-8');
  const aInactive = mk(() => ({ data: { session: { access_token: 't' } } }), { active: false });
  const r5 = await aInactive.signIn('TS008', 'Synthetic-Pass-8');
  t('CLIENT', 'every failed sign-in (bad format, unknown ID, wrong password, banned, inactive profile) gives the SAME message', [r1, r2, r3, r4, r5].every(r => !r.ok && r.message === policy.SIGN_IN_FAILED));
  t('CLIENT', 'a malformed Employee ID is rejected without any request; others sign in with the derived address only', aBad.client.calls[0] === 'qq999@' + DOMAIN && aBad.client.calls.length === 2 && aInactive.client.calls.includes('signOut'));
  const aNet = mk(() => { throw new Error('network'); });
  t('CLIENT', 'a network failure is reported as "unavailable", not as wrong credentials', (await aNet.signIn('TS006', 'x')).reason === 'unavailable');
  const aForced = mk(() => ({ data: { session: { access_token: 't' } } }), { active: true, must_change_password: true });
  t('CLIENT', 'a forced-change account signs in with mustChangePassword = true (the app shows only the change screen)', (await aForced.signIn('TS009', 'x')).mustChangePassword === true);
  t('CLIENT', 'session kept in memory only (persistSession false)', AUTH_CLIENT_OPTIONS.persistSession === false && aForced.client.opts.auth.persistSession === false);
  const svc = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.sig';
  let refused = false; try { createSupabaseAuthAdapter({ enabled: true, createClient: fakeCreate(() => ({})), url: 'u', anonKey: svc, signInDomain: DOMAIN }); } catch (e) { refused = /secret key/.test(e.message); }
  t('CLIENT', 'refuses a service-role key (the browser must only ever hold the public anon key)', refused);
}

// ======================= [MIGRATION] account plan =======================
{
  const users = [{ id: 1, username: 't_a', fullName: 'Synthetic Admin', role: 'Admin', active: true, password: 'a'.repeat(64), email: 'old1@example.invalid' },
    { id: 2, username: 't_b', fullName: 'Synthetic AE', role: 'Assistant Engineer', active: true, password: 'plain-text-pw' },
    { id: 5, username: 't_c', fullName: 'Synthetic DU', role: 'Department User', department: 'Cement Plant', assignedCategories: [CATS[1]], active: true, password: 'b'.repeat(64), must_change_password: true },
    { id: 7, username: 't_d', fullName: 'Synthetic Old', role: 'Senior Engineer', active: false, password: 'c'.repeat(64) }];
  const jobOrders = [J('JO-1', 'CLOSED', { requesterId: 2, approvedById: 1, assignedToId: 4, approvalHistory: [{ event: 'APPROVED', byId: 1 }, { event: 'CLOSED', byId: 7 }] }), J('JO-2', 'OPEN', { requesterId: 5 })];
  const mapping = [{ legacyId: 1, employeeId: 'ad001', recoveryEmail: 'admin.one@example.invalid' }, { legacyId: 2, employeeId: 'AE002', recoveryEmail: 'ae.two@example.invalid' },
    { legacyId: 5, employeeId: 'DU005' }, { legacyId: 7, employeeId: 'SE007', recoveryEmail: 'se.seven@example.invalid' }];
  const joBefore = JSON.stringify(jobOrders), usersBefore = JSON.stringify(users);
  const plan = buildAccountPlan({ users, jobOrders, mapping, signInDomain: DOMAIN });
  t('MIGRATION', 'plan built without errors; legacy ids preserved exactly; Employee IDs upper-cased; every account must change its password',
    plan.errors.length === 0 && plan.accounts.map(a => a.legacy_id).join() === '1,2,5,7' && plan.accounts[0].employee_id === 'AD001' && plan.accounts.every(a => a.must_change_password === true), plan.errors);
  t('MIGRATION', 'no password, hash or old flag is carried into the plan', !/password"\s*:\s*"|[0-9a-f]{64}|plain-text-pw/.test(JSON.stringify(plan.accounts.map(a => { const { must_change_password, ...rest } = a; return rest; }))));
  t('MIGRATION', 'inactive accounts are migrated inactive (their id stays valid for history)', plan.accounts.find(a => a.legacy_id === 7).active === false);
  t('MIGRATION', 'job-order references checked (requester, approver, assignee, approval history): one dangling id reported, nothing changed',
    plan.references.checked === 6 && plan.references.dangling.length === 1 && plan.references.dangling[0].ref === 4 && JSON.stringify(jobOrders) === joBefore && JSON.stringify(users) === usersBefore);
  t('MIGRATION', 'an account without an Employee ID from the owner is an ERROR — nothing is invented', buildAccountPlan({ users, jobOrders, mapping: mapping.slice(1), signInDomain: DOMAIN }).errors.some(e => /no owner-provided mapping/.test(e)));
  t('MIGRATION', 'duplicate Employee IDs / recovery emails, malformed IDs and sign-in-domain recovery addresses are errors',
    buildAccountPlan({ users, jobOrders, mapping: mapping.map(m => m.legacyId === 2 ? { ...m, employeeId: 'AD001' } : m), signInDomain: DOMAIN }).errors.some(e => /used twice/.test(e))
    && buildAccountPlan({ users, jobOrders, mapping: mapping.map(m => m.legacyId === 2 ? { ...m, employeeId: 'AE-02' } : m), signInDomain: DOMAIN }).errors.some(e => /5 letters/.test(e))
    && buildAccountPlan({ users, jobOrders, mapping: mapping.map(m => m.legacyId === 2 ? { ...m, recoveryEmail: 'ae002@' + DOMAIN } : m), signInDomain: DOMAIN }).errors.some(e => /deliverable/.test(e)));
  t('MIGRATION', 'a mapping file with password/secret fields is refused', buildAccountPlan({ users, jobOrders, mapping: [...mapping, { legacyId: 99, employeeId: 'XX001', password: 'x' }], signInDomain: DOMAIN }).errors.some(e => /must not contain password/.test(e)));
  t('MIGRATION', 'at least one active Admin is required', buildAccountPlan({ users: users.filter(u => u.role !== 'Admin'), jobOrders, mapping, signInDomain: DOMAIN }).errors.some(e => /active Admin/.test(e)));
  t('MIGRATION', 'a missing recovery email is a warning (recovery unavailable), not an invented address', plan.warnings.some(w => /no recovery email/.test(w)) && plan.accounts.find(a => a.legacy_id === 5).recovery_email === null);
}

console.log(`\nP2 mocked tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
