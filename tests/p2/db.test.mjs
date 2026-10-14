// CMMS P2 SQL on a REAL PostgreSQL engine (PGlite) with a Supabase emulation (supabase-emulation.sql). Synthetic data only.
// LABEL: local PostgreSQL. Not a Supabase project (PostgREST, GoTrue, Realtime and the real project's configuration are
// staging checks: docs/P2A_MIGRATION.md §6.3, kept in the local archive).
// Run: CMMS_PGLITE_DIR=<folder with @electric-sql/pglite installed> node tests/p2/db.test.mjs   (exit 2 = skipped)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SQLD = path.join(HERE, '..', '..', 'p2', 'sql');
const SQL = f => fs.readFileSync(path.join(SQLD, f), 'utf8');
const entry = process.env.CMMS_PGLITE_DIR && path.join(process.env.CMMS_PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
if (!entry || !fs.existsSync(entry)) { console.log('P2 DB tests SKIPPED: set CMMS_PGLITE_DIR (PGlite runs the SQL locally).'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(entry).href);
import { APPLY } from './apply-order.mjs';

let pass = 0, fail = 0;
const t = (n, ok, info) => { if (ok) pass++; else { fail++; console.log('FAIL ' + n + (info === undefined ? '' : '  ' + JSON.stringify(info).slice(0, 500))); } };

// ---- synthetic fixture ----------------------------------------------------------------------------------------------
const ACC = [   // legacy_id, employee_id, role, extra
  [1, 'AD001', 'Admin'], [2, 'AE002', 'Assistant Engineer'], [3, 'SE003', 'Senior Engineer'],
  [5, 'JE005', 'Job Card Editor', { section: 'Electrical' }], [6, 'JM006', 'Job Card Editor', { section: 'Mechanical' }],
  [8, 'DC008', 'Department User', { department: 'Cement Plant', assigned_categories: ['GENERATOR', 'PUMP'] }],
  [9, 'DF009', 'Department User', { department: 'Fuel Plant', assigned_categories: ['TRUCK'] }],
  [11, 'VW011', 'Viewer'], [12, 'OF012', 'Assistant Engineer', { active: false }], [14, 'FC014', 'Viewer', { must_change_password: true }],
];
const ASSETS = [{ num: 'A1', plant: 'GENERATOR' }, { num: 'A2', plant: 'PUMP' }, { num: 'A3', plant: 'TRUCK' }, { num: 'A4', plant: 'CRANE' }];
const JO = (jobNo, dept, assetNum, status, more = {}) => ({ jobNo, date: '2026-10-01', dept, assetNum, requester: 'Test requester', problem: 'synthetic', priority: 'High',
  repairType: 'Unplanned', status, section: '', workDone: '', manpower: [], parts: [], legacyField: 'keep-' + jobNo, ...more });
const DATA = {
  users: [{ id: 1, username: 'legacy', password: 'a'.repeat(64) }],   // the OLD account list: must be unreadable after 0003
  assets: ASSETS, customPlants: ['CRANE', 'GENERATOR', 'PUMP', 'TRUCK'], pm: [{ id: 'pm-001', serviceHistory: [] }],
  employees: [{ empId: 'E1', name: 'Synthetic One', siteStatus: 'ON DUTY', leaveHistory: [] }],
  jobOrders: [JO('JO-1001', 'Cement Plant', 'A1', 'OPEN', { requesterId: 8 }), JO('JO-1002', 'Fuel Plant', 'A3', 'OPEN', { requesterId: 9 }),
    JO('JO-1003', 'Cement Plant', 'A2', 'IN PROGRESS', { requesterId: 2, section: 'Electrical', assignedToId: 5 }),
    JO('JO-1004', 'Fuel Plant', 'A3', 'COMPLETED', { requesterId: 2, section: 'Mechanical', assignedToId: 6, approvalStatus: 'PENDING' }),
    JO('JO-1005', 'Cement Plant', 'A1', 'CLOSED', { requesterId: 1, closedBy: 'x', closedDate: '2026-09-01' })],
};

async function newDb(variant) {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(HERE, 'supabase-emulation.sql'), 'utf8'));
  for (const [k, v] of Object.entries(DATA)) await db.query('insert into public.app_data (key, value) values ($1, $2::jsonb)', [k, JSON.stringify(v)]);
  if (variant === 'B') await db.exec(`alter table public.app_data enable row level security;
    create policy "Allow all access" on public.app_data for all to anon, authenticated using (true) with check (true);`);
  return db;
}
function harness(db) {
  const UID = {};
  const raw = async (sql, p = []) => { try { const r = await db.query(sql, p); return { rows: r.rows }; } catch (e) { return { error: e.message, code: e.code }; } };
  const as = async who => {
    await db.exec('reset role');
    const claims = typeof who === 'number' ? JSON.stringify({ sub: UID[who], role: 'authenticated' }) : who === 'nobody' ? JSON.stringify({ sub: crypto.randomUUID(), role: 'authenticated' }) : '';
    await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
    if (who === 'anon') await db.exec('set role anon'); else if (who === 'service') await db.exec('set role service_role'); else if (who !== 'super') await db.exec('set role authenticated');
  };
  const run = async (who, sql, p) => { await as(who); const r = await raw(sql, p); await as('super'); return r; };
  const call = async (who, expr, p = []) => { const r = await run(who, `select public.${expr} as r`, p.map(x => x !== null && typeof x === 'object' ? JSON.stringify(x) : x)); return r.error ? r : { r: r.rows[0].r }; };
  const data = async k => (await raw('select value from public.app_data where key = $1', [k])).rows[0]?.value;
  const jo = async n => (await data('jobOrders')).find(j => j.jobNo === n);
  // provisioning as the service role (what p2/migration/provision.mjs and admin-users do)
  const provision = async () => {
    for (const [id, eid, role, extra = {}] of ACC) {
      const u = (await raw(`insert into auth.users (email) values ($1) returning id`, [eid.toLowerCase() + '@accounts.example.invalid'])).rows[0].id;
      UID[id] = u;
      const r = await run('service', `insert into public.profiles (user_id, legacy_id, employee_id, full_name, role, department, assigned_categories, section, active, must_change_password)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [u, id, eid, 'Test ' + eid, role, extra.department || null, extra.assigned_categories || null, extra.section || null,
        extra.active !== false, extra.must_change_password === true]);
      if (r.error) throw new Error('provision ' + id + ': ' + r.error);
    }
  };
  return { raw, run, call, data, jo, provision, UID };
}
const denied = r => !!r.error && r.code === '42501';
const invalid = r => !!r.error && r.code === '22023';
async function aclSnapshot(h) {
  return (await h.raw(`select json_build_object(
    'rls', (select relrowsecurity::text || '/' || relforcerowsecurity::text from pg_class where oid = 'public.app_data'::regclass),
    'tbl', (select json_agg(x order by x) from (select r || ':' || p || ':' || has_table_privilege(r, 'public.app_data', p) x
             from unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) s),
    'col', (select json_agg(x order by x) from (select r || ':' || c || ':' || p || ':' || has_column_privilege(r, 'public.app_data', c, p) x
             from unnest(array['anon','authenticated']) r, unnest(array['key','value','updated_at']) c, unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p) s),
    'pol', (select coalesce(json_agg(json_build_object('n', policyname, 'p', permissive, 'r', roles, 'c', cmd, 'q', qual, 'w', with_check) order by policyname), '[]')
             from pg_policies where schemaname = 'public' and tablename = 'app_data')) as s`)).rows[0].s;
}
const allData = async h => JSON.stringify((await h.raw('select key, value from public.app_data order by key')).rows);

async function scenario(variant) {
  const P = `[${variant}] `;
  const db = await newDb(variant); const h = harness(db);
  const { raw, run, call, data, jo } = h;
  const pre = await aclSnapshot(h), before = await allData(h);
  t(P + 'BEFORE anonymous request can read the old users list (the risk being fixed)', ((await run('anon', "select 1 from public.app_data where key = 'users'")).rows || []).length === 1);
  for (const f of APPLY) { try { await db.exec(SQL(f)); t(P + 'APPLY ' + f, true); } catch (e) { t(P + 'APPLY ' + f, false, e.message); return; } }
  t(P + 'DATA app_data byte-identical after all migrations', (await allData(h)) === before);
  await h.provision();

  // ---- anonymous -------------------------------------------------------------------------------------------------
  t(P + 'ANON app_data: no select / insert / update / delete', denied(await run('anon', 'select key from public.app_data')) && denied(await run('anon', "insert into public.app_data values ('x','[]')"))
    && denied(await run('anon', "update public.app_data set value = '[]' where key = 'assets'")) && denied(await run('anon', "delete from public.app_data where key = 'pm'")));
  t(P + 'ANON profiles / audit / notifications / events / verification tokens: no access', (await Promise.all(['public.profiles', 'public.audit_log', 'public.notifications', 'public.jo_events', 'public.recovery_email_verifications', 'public.auth_rate_limits'].map(tb => run('anon', 'select * from ' + tb)))).every(denied));
  const fns = (await raw(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth,
      has_function_privilege('service_role', p.oid, 'execute') svc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')`)).rows;
  t(P + 'ANON can execute exactly one function: environment_marker()', fns.filter(f => f.anon).map(f => f.proname).join() === 'environment_marker', fns.filter(f => f.anon).map(f => f.proname));
  t(P + 'SERVICE-only functions (rate limit, session revocation) are not callable with a user token', fns.filter(f => ['rate_limit_hit', 'revoke_user_sessions'].includes(f.proname)).every(f => f.svc && !f.auth));
  t(P + 'ANON environment_marker(): null without a marker', (await call('anon', 'environment_marker()')).r === null);
  t(P + 'ANON every operation → permission denied', (await Promise.all(['jo_list()', "jo_approve('JO-1004')", "admin_reset_data('RESET ALL DATA')", 'my_notifications()', 'user_list()'].map(e => call('anon', e)))).every(denied));

  // ---- forced change / inactive / no profile --------------------------------------------------------------------
  t(P + 'FORCED-CHANGE account (first sign-in): no data and no operations until the password is changed', ((await run(14, 'select key from public.app_data')).rows || [1]).length === 0
    && denied(await call(14, 'jo_list()')) && denied(await call(14, 'my_notifications()')));
  t(P + 'FORCED-CHANGE account can read only its own profile row (so the app can show the change screen)', ((await run(14, 'select legacy_id, must_change_password from public.profiles')).rows || []).map(r => r.legacy_id + ':' + r.must_change_password).join() === '14:true');
  t(P + 'INACTIVE account: no data, no operations', ((await run(12, 'select key from public.app_data')).rows || [1]).length === 0 && denied(await call(12, 'jo_list()')));
  { const r = await run(12, "update public.app_data set value = '[]'::jsonb where key = 'assets' returning key"), r14 = await run(14, "update public.app_data set value = '[]'::jsonb where key = 'assets' returning key");
    t(P + 'INACTIVE and FORCED-CHANGE accounts: a direct dataset write changes nothing (0 rows or refused)', (!!r.error || r.rows.length === 0) && (!!r14.error || r14.rows.length === 0)
      && ((await raw("select jsonb_array_length(value) n from public.app_data where key = 'assets'")).rows[0].n > 0)); }
  t(P + 'A token without a CMMS profile: nothing', ((await run('nobody', 'select key from public.app_data')).rows || [1]).length === 0 && denied(await call('nobody', 'jo_list()')));

  // ---- reads ------------------------------------------------------------------------------------------------------
  const keysOf = async id => ((await run(id, 'select key from public.app_data order by key')).rows || []).map(r => r.key).join();
  t(P + 'READ Admin, AE, SE, JCE, Viewer: every dataset, never the old users list', (await Promise.all([1, 2, 3, 5, 11].map(keysOf))).every(k => k === 'assets,customPlants,employees,jobOrders,pm'));
  t(P + 'READ Department User: categories only directly', (await keysOf(8)) === 'customPlants');
  t(P + 'SCOPE DU job orders = own department; DU assets = own categories', (await call(8, 'jo_list()')).r.map(j => j.jobNo).join() === 'JO-1001,JO-1003,JO-1005'
    && (await call(9, 'jo_list()')).r.map(j => j.jobNo).join() === 'JO-1002,JO-1004' && (await call(8, 'asset_list()')).r.map(a => a.num).join() === 'A1,A2' && (await call(9, 'asset_list()')).r.map(a => a.num).join() === 'A3');
  t(P + 'PROFILES own row only; Admin all; no password data in the table', ((await run(8, 'select legacy_id from public.profiles')).rows || []).map(r => r.legacy_id).join() === '8'
    && ((await run(1, 'select legacy_id from public.profiles')).rows || []).length === ACC.length && !(await raw(`select 1 from information_schema.columns where table_name = 'profiles' and column_name ~ '(^password$|hash)'`)).rows.length);
  const ul2 = (await call(2, 'user_list()')).r, ul1 = (await call(1, 'user_list()')).r;
  t(P + 'USERS AE: itself + active Job Card Editors, display fields only (no Employee ID / email of others); Admin: all', ul2.map(u => u.id).join() === '2,5,6' && !ul2.find(u => u.id === 5).employeeId && ul1.length === ACC.length && ul1.find(u => u.id === 14).mustChangePassword === true);

  // ---- direct writes (after 0009) -----------------------------------------------------------------------------------
  const upd = (who, key, v) => run(who, 'update public.app_data set value = $2::jsonb where key = $1 returning key', [key, JSON.stringify(v)]);
  t(P + 'WRITE AE whole-list PM save works', ((await upd(2, 'pm', [...DATA.pm, { id: 'pm-002' }])).rows || []).length === 1);
  t(P + 'WRITE SE / JCE / DU / Viewer cannot write PM / assets / categories', (await Promise.all([3, 5, 8, 11].flatMap(w => ['pm', 'assets', 'customPlants'].map(k => upd(w, k, [{ x: 1 }]))))).every(r => (r.rows || [1]).length === 0));
  t(P + 'WRITE nobody writes jobOrders / employees / users directly (0009), not even Admin', (await Promise.all(['jobOrders', 'employees', 'users'].map(k => upd(1, k, [{}])))).every(r => (r.rows || [1]).length === 0));
  t(P + 'WRITE a non-empty dataset cannot be emptied directly (guard), even by Admin', !!(await upd(1, 'assets', [])).error && (await data('assets')).length === 4);
  t(P + 'WRITE no INSERT / DELETE; profiles not writable by any user', denied(await run(1, "insert into public.app_data values ('n','[]')")) && denied(await run(1, "delete from public.app_data where key = 'pm'"))
    && denied(await run(8, "update public.profiles set role = 'Admin' where legacy_id = 8")) && denied(await run(1, "update public.profiles set must_change_password = false where legacy_id = 14")));

  // ---- job-order lifecycle --------------------------------------------------------------------------------------
  const n1 = (await call(8, 'jo_create($1::jsonb)', [{ assetNum: 'A1', problem: 'p', repairType: 'Unplanned', dept: 'HR', requester: 'X', status: 'CLOSED', requesterId: 1 }])).r;
  const j1 = await jo(n1);
  t(P + 'JO DU creates in scope: next number, OPEN, own numeric id and department (injected fields ignored)', n1 === 'JO-1006' && j1.status === 'OPEN' && j1.requesterId === 8 && j1.dept === 'Cement Plant', j1);
  t(P + 'JO DU: out-of-scope asset refused; Planned refused', denied(await call(8, 'jo_create($1::jsonb)', [{ assetNum: 'A3', repairType: 'Unplanned' }])) && invalid(await call(8, 'jo_create($1::jsonb)', [{ assetNum: 'A1', repairType: 'Planned' }])));
  t(P + 'JO SE / JCE / Viewer cannot create', (await Promise.all([3, 5, 11].map(w => call(w, 'jo_create($1::jsonb)', [{ assetNum: 'A1', repairType: 'Unplanned' }])))).every(denied));
  await call(8, 'jo_update_request($1, $2::jsonb)', [n1, { problem: 'changed', dept: 'Fuel Plant', status: 'CLOSED' }]);
  t(P + 'JO DU edits own OPEN job: request fields only', (await jo(n1)).problem === 'changed' && (await jo(n1)).dept === 'Cement Plant' && (await jo(n1)).status === 'OPEN');
  t(P + 'JO DU cannot edit another DU\'s job or a non-OPEN job', denied(await call(9, 'jo_update_request($1, $2::jsonb)', [n1, { problem: 'x' }])) && denied(await call(8, 'jo_update_request($1, $2::jsonb)', ['JO-1003', { problem: 'x' }])));
  t(P + 'JO SE / Viewer cannot edit request or work', denied(await call(3, 'jo_update_request($1, $2::jsonb)', [n1, { problem: 'x' }])) && denied(await call(11, 'jo_update_work($1, $2::jsonb)', ['JO-1003', { workDone: 'x' }])));
  await call(6, 'jo_set_status($1, $2)', [n1, 'IN PROGRESS']);
  t(P + 'JO JCE starts an unassigned OPEN job: assigned to itself, takes its section', (await jo(n1)).status === 'IN PROGRESS' && (await jo(n1)).assignedToId === 6 && (await jo(n1)).section === 'Mechanical');
  t(P + 'JO JCE of another section cannot edit or complete', denied(await call(5, 'jo_update_work($1, $2::jsonb)', [n1, { workDone: 'x' }])) && denied(await call(5, 'jo_set_status($1, $2)', [n1, 'COMPLETED'])));
  await call(6, 'jo_update_work($1, $2::jsonb)', [n1, { workDone: 'fixed', section: 'Electrical' }]);
  t(P + 'JO JCE edits work fields but not the section', (await jo(n1)).workDone === 'fixed' && (await jo(n1)).section === 'Mechanical');
  t(P + 'JO a step out of order is refused', invalid(await call(6, 'jo_set_status($1, $2)', [n1, 'IN PROGRESS'])));
  await call(6, 'jo_set_status($1, $2)', [n1, 'COMPLETED']);
  t(P + 'JO completing: COMPLETED + PENDING approval', (await jo(n1)).approvalStatus === 'PENDING');
  t(P + 'JO JCE / DU / Viewer cannot approve', (await Promise.all([6, 8, 11].map(w => call(w, 'jo_approve($1)', [n1])))).every(denied));
  t(P + 'JO closing needs an approval', invalid(await call(3, 'jo_close($1, $2::date)', [n1, '2026-10-14'])));
  await call(3, 'jo_approve($1)', [n1]);
  t(P + 'JO SE approves: numeric approver id in record and history', (await jo(n1)).approvedById === 3 && (await jo(n1)).approvalHistory[0].byId === 3);
  await call(2, 'jo_update_work($1, $2::jsonb)', [n1, { workDone: 'fixed again' }]);
  t(P + 'JO completion changed after approval → PENDING, RESET appended', (await jo(n1)).approvalStatus === 'PENDING' && (await jo(n1)).approvalHistory.map(e => e.event).join() === 'APPROVED,RESET');
  await call(2, 'jo_approve($1)', [n1]);
  t(P + 'JO only Admin / AE / SE close: JCE, DU, Viewer refused', (await Promise.all([6, 8, 11].map(w => call(w, 'jo_close($1, $2::date)', [n1, '2026-10-14'])))).every(denied));
  await call(3, 'jo_close($1, $2::date)', [n1, '2026-10-14']);
  t(P + 'JO SE closes with the selected date', (await jo(n1)).status === 'CLOSED' && (await jo(n1)).closedDate === '2026-10-14');
  t(P + 'JO revert: Admin only; history kept', denied(await call(2, 'jo_revert($1)', [n1])) && !(await call(1, 'jo_revert($1)', [n1])).error && (await jo(n1)).approvalHistory.slice(-1)[0].event === 'REVERTED');
  t(P + 'JO AE must assign an active JCE with a section', invalid(await call(2, 'jo_set_status($1, $2, $3)', ['JO-1001', 'IN PROGRESS', 11])));
  await call(2, 'jo_set_status($1, $2, $3)', ['JO-1001', 'IN PROGRESS', 5]);
  t(P + 'JO AE start assigns JCE 5 (numeric id), section from the editor', (await jo('JO-1001')).assignedToId === 5 && (await jo('JO-1001')).section === 'Electrical');
  const nA = (await call(1, 'jo_create($1::jsonb)', [{ assetNum: 'A4', repairType: 'Planned' }])).r, nB = (await call(2, 'jo_create($1::jsonb)', [{ assetNum: 'A4', repairType: 'Planned' }])).r;
  t(P + 'JO numbers unique and sequential', nA === 'JO-1007' && nB === 'JO-1008');
  t(P + 'JO delete: AE yes; SE / JCE / DU / Viewer no', (await Promise.all([3, 6, 8, 11].map(w => call(w, 'jo_delete($1)', [nB])))).every(denied) && !(await call(2, 'jo_delete($1)', [nB])).error && !(await jo(nB)));
  const imp = (await call(2, 'jo_import($1::jsonb)', [[{ jobNo: 'JO-2001', assetNum: 'A1', status: 'COMPLETED', approved: 'yes' }, { jobNo: 'JO-2002', assetNum: 'A1', status: 'CLOSED' }, { jobNo: 'JO-1001', assetNum: 'A1' }]])).r;
  t(P + 'JO import: CLOSED rejected, existing skipped, COMPLETED PENDING', imp.added.join() === 'JO-2001' && imp.rejected.length === 1 && imp.skipped.join() === 'JO-1001' && (await jo('JO-2001')).approvalStatus === 'PENDING');
  t(P + 'IDS job orders reference numeric user ids only', (await data('jobOrders')).every(j => (j.requesterId === undefined || typeof j.requesterId === 'number') && (j.approvalHistory || []).every(e => typeof e.byId === 'number')));

  // ---- jo_update (the edit form in one step) ----------------------------------------------------------------------
  const nU = (await call(8, 'jo_create($1::jsonb)', [{ assetNum: 'A2', repairType: 'Unplanned', problem: 'u' }])).r;
  await call(8, 'jo_update($1, $2::jsonb)', [nU, { problem: 'du edit', workDone: 'sneaky', status: 'CLOSED' }]);
  t(P + 'JO_UPDATE DU: request fields of its own OPEN job only', (await jo(nU)).problem === 'du edit' && !(await jo(nU)).workDone && (await jo(nU)).status === 'OPEN');
  t(P + 'JO_UPDATE SE / Viewer / another DU refused', (await Promise.all([3, 11, 9].map(w => call(w, 'jo_update($1, $2::jsonb)', [nU, { problem: 'x' }])))).every(denied));
  await call(1, 'jo_update($1, $2::jsonb)', [nU, { problem: 'admin edit', target: '2026-11-01', section: 'Electrical', status: 'CLOSED', approvalStatus: 'APPROVED' }]);
  t(P + 'JO_UPDATE Admin: request + work fields in one step; status / approval never from the form', (await jo(nU)).problem === 'admin edit' && (await jo(nU)).target === '2026-11-01' && (await jo(nU)).status === 'OPEN' && !(await jo(nU)).approvalStatus);
  t(P + 'JO_UPDATE JCE: only its section, never the section field or the request', denied(await call(6, 'jo_update($1, $2::jsonb)', [nU, { workDone: 'x' }]))
    && !(await call(5, 'jo_update($1, $2::jsonb)', [nU, { workDone: 'jce', section: 'Mechanical', problem: 'p2' }])).error && (await jo(nU)).workDone === 'jce' && (await jo(nU)).section === 'Electrical' && (await jo(nU)).problem === 'admin edit');
  t(P + 'JO_UPDATE a CLOSED job: nobody', denied(await call(1, 'jo_update($1, $2::jsonb)', ['JO-1005', { problem: 'x' }])));

  // ---- notifications ------------------------------------------------------------------------------------------------
  const mine = async id => (await call(id, 'my_notifications()')).r || [];
  const evts = async (id, no) => (await mine(id)).filter(x => x.jobNo === no).map(x => x.event).sort().join();
  t(P + 'NOTIFY Admin/AE/SE: every event of a job order (raised, in progress, completed, closed)', (await evts(1, n1)) === 'CLOSED,COMPLETED,COMPLETED,IN_PROGRESS,OPEN'
    && (await evts(3, n1)) === (await evts(1, n1)));
  t(P + 'NOTIFY Department User: in progress, completed, closed of the jobs THEY raised; nothing of others', (await evts(8, n1)) === 'CLOSED,COMPLETED,COMPLETED,IN_PROGRESS' && (await evts(9, n1)) === '');
  t(P + 'NOTIFY Job Card Editor: closed for its section (raised only if the section was set when raised); other section nothing', (await evts(6, n1)) === 'CLOSED' && (await evts(5, n1)) === '');
  t(P + 'NOTIFY Viewer, inactive and forced-change accounts: nothing', (await mine(11)).length === 0 && denied(await call(12, 'my_notifications()')) && denied(await call(14, 'my_notifications()')));
  const cnt = async () => Number((await raw('select count(*) c from public.notifications')).rows[0].c);
  const c0 = await cnt(); await call(6, 'jo_set_status($1, $2)', [n1, 'COMPLETED']); await call(3, 'jo_approve($1)', ['JO-9999']);
  t(P + 'NOTIFY de-duplication: a refused or repeated step creates nothing', (await cnt()) === c0);
  const first = (await mine(2))[0];
  t(P + 'NOTIFY mark read: own rows only; another user\'s ids are ignored', (await call(3, 'notification_mark_read($1::bigint[])', [`{${first.id}}`])).r === 0
    && (await call(2, 'notification_mark_read($1::bigint[])', [`{${first.id}}`])).r === 1 && (await mine(2))[0].read === true && (await mine(2)).filter(x => x.read).length === 1);
  t(P + 'NOTIFY no direct table access for signed-in users', denied(await run(1, 'select * from public.notifications')) && denied(await run(1, 'select * from public.jo_events')));
  t(P + 'NOTIFY retention purge: Admin only, at least 30 days; recent events kept', denied(await call(2, 'notification_purge(90)')) && invalid(await call(1, 'notification_purge(7)')) && (await call(1, 'notification_purge(90)')).r === 0 && (await cnt()) > 0);
  await raw(`update public.jo_events set at = now() - interval '200 days' where job_no = 'JO-1001'`);
  const before180 = await cnt();
  t(P + 'NOTIFY retention purge removes old events with their notifications only', (await call(1, 'notification_purge(180)')).r > 0 && (await cnt()) < before180 && (await evts(1, n1)) !== '');

  // ---- employees / categories / accounts / reset ------------------------------------------------------------------
  await call(2, 'employee_set_status($1, $2::jsonb, $3::jsonb)', ['E1', { siteStatus: 'ON LEAVE', name: 'renamed' }, { savedOn: '2026-10-14', type: 'Annual' }]);
  t(P + 'EMP AE status update: status only, one history entry', (await data('employees'))[0].siteStatus === 'ON LEAVE' && (await data('employees'))[0].name === 'Synthetic One' && (await data('employees'))[0].leaveHistory.length === 1);
  t(P + 'EMP add/delete: Admin only; AE refused', denied(await call(2, 'employee_save($1::jsonb)', [{ empId: 'E2', name: 'n' }])) && !(await call(1, 'employee_save($1::jsonb)', [{ empId: 'E2', name: 'n' }])).error
    && invalid(await call(1, 'employee_save($1::jsonb)', [{ empId: '', name: 'n' }])) && (await call(1, 'employee_save($1::jsonb)', [{ empId: 'E2', name: 'dup' }])).code === '23505');
  const ei = (await call(1, 'employee_import($1::jsonb)', [[{ empId: 'E1', name: 'E1 new' }, { empId: 'E7', name: 'Seven' }, { empId: 'E8', name: 'Eight' }]])).r;
  t(P + 'EMP import: existing updated, new ids added (each new row on its own)', ei.added === 2 && ei.updated === 1 && (await data('employees')).filter(e => ['E7', 'E8'].includes(e.empId)).length === 2);
  await call(2, 'category_rename($1, $2)', ['PUMP', 'water pump']);
  t(P + 'CAT rename updates assets, job orders and DU categories together', (await data('assets')).find(a => a.num === 'A2').plant === 'WATER PUMP'
    && JSON.stringify((await raw('select assigned_categories from public.profiles where legacy_id = 8')).rows[0].assigned_categories).includes('WATER PUMP'));
  t(P + 'ACCT own name: Admin/AE/SE yes; JCE / DU / Viewer no', !(await call(3, 'profile_update_self($1)', ['SE renamed'])).error && (await Promise.all([6, 8, 11].map(w => call(w, 'profile_update_self($1)', ['x'])))).every(denied));
  await raw('update public.profiles set active = false where legacy_id = 6');
  t(P + 'ACCT a deactivated account loses access on its next request', ((await run(6, 'select key from public.app_data')).rows || [1]).length === 0 && denied(await call(6, 'jo_list()')));
  await raw("update public.profiles set role = 'Viewer', section = null where legacy_id = 5");
  t(P + 'ACCT a role change applies to the next request (JCE → Viewer: no work edits)', denied(await call(5, 'jo_update_work($1, $2::jsonb)', ['JO-1001', { workDone: 'x' }])));
  t(P + 'ACCT the last active Admin cannot be demoted or deactivated (trigger)', !!(await raw("update public.profiles set role = 'Viewer' where legacy_id = 1")).error && !!(await raw('update public.profiles set active = false where legacy_id = 1')).error);
  t(P + 'ACCT Employee ID normalised (upper case) and unique; legacy id never changes', (await raw("update public.profiles set employee_id = 'ab123' where legacy_id = 3 returning employee_id")).rows[0].employee_id === 'AB123'
    && !!(await raw("update public.profiles set employee_id = 'AD001' where legacy_id = 3")).error && !!(await run('service', 'update public.profiles set legacy_id = 99 where legacy_id = 3')).error);
  t(P + 'RESET Admin only, typed confirmation; accounts untouched', denied(await call(2, "admin_reset_data('RESET ALL DATA')")) && invalid(await call(1, "admin_reset_data('x')"))
    && !(await call(1, "admin_reset_data('RESET ALL DATA')")).error && (await data('jobOrders')).length === 0 && Number((await raw('select count(*) c from public.profiles')).rows[0].c) === ACC.length);
  t(P + 'AUDIT append-only; readable by Admin only', !!(await raw('delete from public.audit_log')).error && ((await run(1, 'select id from public.audit_log')).rows || []).length > 0 && ((await run(2, 'select id from public.audit_log')).rows || [1]).length === 0);

  // ---- rollback (reverse order) -------------------------------------------------------------------------------------
  const afterData = await allData(h);
  for (const f of [...APPLY].reverse()) {
    try { await db.exec(SQL('rollback/' + f.replace('.sql', '.down.sql'))); } catch (e) { t(P + 'ROLLBACK ' + f, false, e.message); return; }
  }
  t(P + 'ROLLBACK every file runs in reverse order', true);
  t(P + 'ROLLBACK app_data access restored exactly (RLS flags, table/column privileges, policies)', JSON.stringify(await aclSnapshot(h)) === JSON.stringify(pre), { pre, post: await aclSnapshot(h) });
  t(P + 'ROLLBACK the old client works again (anonymous read), data unchanged by the rollback', ((await run('anon', "select 1 from public.app_data where key = 'jobOrders'")).rows || []).length === 1 && (await allData(h)) === afterData);
  const left = (await raw(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')`)).rows[0].n
    + (await raw(`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname <> 'app_data' and c.relkind in ('r', 'S')`)).rows[0].n;
  t(P + 'ROLLBACK no CMMS function or table remains', left === 0, left);
  await db.close();
}

await scenario('A');
await scenario('B');
console.log(`\nP2 DB tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
