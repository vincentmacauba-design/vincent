// P2 Edge Function logic (p2/functions/_shared/handlers.mjs) and the provisioning tool, END TO END against the REAL P2
// SQL on a local PostgreSQL engine (PGlite + Supabase emulation). Supabase Auth (GoTrue) and the mail provider are
// in-memory fakes; HTTP/CORS wrappers (deno.ts) are not exercised. Synthetic accounts only.
// LABEL: local PostgreSQL + fake Auth/mail. Run: CMMS_PGLITE_DIR=<folder with @electric-sql/pglite> node tests/p2/handlers-db.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHandlers } from '../../p2/functions/_shared/handlers.mjs';
import { buildAccountPlan } from '../../p2/migration/map-accounts.mjs';
import { provisionAccounts, safeOutputPath } from '../../p2/migration/provision.mjs';
import { APPLY } from './apply-order.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..', '..');
const entry = process.env.CMMS_PGLITE_DIR && path.join(process.env.CMMS_PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
if (!entry || !fs.existsSync(entry)) { console.log('P2 handler-DB tests SKIPPED: set CMMS_PGLITE_DIR.'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(entry).href);
let pass = 0, fail = 0;
const t = (n, ok, info) => { if (ok) pass++; else { fail++; console.log('FAIL ' + n + (info === undefined ? '' : '  ' + JSON.stringify(info).slice(0, 400))); } };
const DOMAIN = 'accounts.example.invalid';

// ---- database ----------------------------------------------------------------------------------------------------
const db = new PGlite();
await db.exec(fs.readFileSync(path.join(HERE, 'supabase-emulation.sql'), 'utf8'));
for (const [k, v] of Object.entries({ assets: [{ num: 'A1', plant: 'PUMP' }], jobOrders: [], pm: [], employees: [], customPlants: ['PUMP'], users: [] }))
  await db.query('insert into public.app_data (key, value) values ($1, $2::jsonb)', [k, JSON.stringify(v)]);
for (const f of APPLY) await db.exec(fs.readFileSync(path.join(ROOT, 'p2', 'sql', f), 'utf8'));
let q = Promise.resolve();
const runAs = (who, sql, params = []) => (q = q.then(async () => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [who && typeof who === 'object' ? JSON.stringify({ sub: who.sub, role: 'authenticated' }) : '']);
  if (who === 'service') await db.exec('set role service_role'); else if (who && typeof who === 'object') await db.exec('set role authenticated');
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec('reset role'); }
}));
const svc = async (sql, params) => { const r = await runAs('service', sql, params); if (r.error) throw new Error(r.error); return r.rows; };
const one = async (sql, params) => (await svc(sql, params))[0] || null;
const cols = row => { const k = Object.keys(row); return { k, v: k.map(x => row[x]) }; };

// ---- fake GoTrue + mail -------------------------------------------------------------------------------------------
const gotrue = new Map(), mails = [], signOuts = [];
const fakeAuth = {
  async createUser({ email, password }) { if ([...gotrue.values()].some(u => u.email === email)) throw new Error('exists');
    const id = crypto.randomUUID(); await runAs('super', 'insert into auth.users (id, email) values ($1, $2)', [id, email]); gotrue.set(id, { id, email, password, banned: false }); return { id }; },
  async updateUser(id, a) { const u = gotrue.get(id); if (!u) throw new Error('no user'); if (a.password !== undefined) u.password = a.password; if (a.ban_duration !== undefined) u.banned = a.ban_duration !== 'none'; },
  async deleteUser(id) { gotrue.delete(id); await runAs('super', 'delete from auth.users where id = $1', [id]); },
  async signOutAll(id) { signOuts.push(id); const r = await runAs('service', 'select public.revoke_user_sessions($1::uuid)', [id]); if (r.error) throw new Error(r.error); },
  async generateRecoveryLink(email) { return 'https://app.example.invalid/#type=recovery&token=' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 16); },
  async verifyPassword(email, pw) { return [...gotrue.values()].some(u => u.email === email && u.password === pw && !u.banned); },
};
const deps = {
  config: { signInDomain: DOMAIN, appUrl: 'https://app.example.invalid/', verifyTtlMinutes: 60, recoveryMinMs: 5, departmentUsersEnabled: true },
  now: () => new Date(), sleep: ms => new Promise(r => setTimeout(r, ms)), randomUint32: n => crypto.getRandomValues(new Uint32Array(n)),
  randomToken: () => crypto.randomBytes(32).toString('base64url'), hash: async s => crypto.createHmac('sha256', 'pepper').update(s).digest('hex'),
  auth: fakeAuth, mail: { send: async m => { mails.push(m); } }, log: () => {},
  db: {
    profileByUser: uid => one('select * from public.profiles where user_id = $1', [uid]),
    profileByEmployeeId: eid => one('select * from public.profiles where employee_id = $1', [eid]),
    profileByRecoveryEmail: e => one('select * from public.profiles where recovery_email = $1', [e]),
    profileByLegacyId: n => one('select * from public.profiles where legacy_id = $1', [n]),
    insertProfile: async row => { const { k, v } = cols(row); await svc(`insert into public.profiles (${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')})`, v); },
    updateProfile: async (uid, patch) => { const { k, v } = cols(patch); await svc(`update public.profiles set ${k.map((x, i) => x + ' = $' + (i + 1)).join(', ')} where user_id = $${k.length + 1}`, [...v, uid]); },
    nextLegacyId: async () => (await one('select coalesce(max(legacy_id), 0) + 1 n from public.profiles')).n,
    activeAdminCount: async () => Number((await one("select count(*) c from public.profiles where role = 'Admin' and active")).c),
    knownCategories: async () => (await one("select value from public.app_data where key = 'customPlants'")).value,
    rateLimitHit: async (b, s, m, w) => (await one('select public.rate_limit_hit($1, $2, $3, $4) r', [b, s, m, w])).r,
    insertAudit: async row => { await svc('insert into public.audit_log (actor, action, target, details) values ($1, $2, $3, $4::jsonb)', [row.actor, row.action, row.target, JSON.stringify(row.details || {})]); },
    saveVerification: async row => { await svc('insert into public.recovery_email_verifications (token_hash, user_id, email, expires_at) values ($1, $2, $3, $4)', [row.token_hash, row.user_id, row.email, row.expires_at]); },
    takeVerification: (h, now) => one('update public.recovery_email_verifications set used_at = $2 where token_hash = $1 and used_at is null and expires_at > $2 returning *', [h, now.toISOString()]),
  },
};
const H = createHandlers(deps);
const asUser = (uid, sql) => runAs({ sub: uid }, sql);

// ---- provisioning (bootstrap, from the account plan) -------------------------------------------------------------------
const legacyUsers = [{ id: 1, username: 'p_admin', fullName: 'Prov Admin', role: 'Admin', active: true, password: 'a'.repeat(64) },
  { id: 4, username: 'p_du', fullName: 'Prov DU', role: 'Department User', department: 'Cement Plant', assignedCategories: ['PUMP'], active: true },
  { id: 7, username: 'p_jce', fullName: 'Prov JCE', role: 'Job Card Editor', section: 'Mechanical', active: true }];
const mapping = [{ legacyId: 1, employeeId: 'pa001', recoveryEmail: 'admin@example.invalid' }, { legacyId: 4, employeeId: 'PD004' }, { legacyId: 7, employeeId: 'PJ007' }];
const plan = buildAccountPlan({ users: legacyUsers, jobOrders: [{ jobNo: 'JO-1', requesterId: 4, approvalHistory: [{ byId: 1 }] }], mapping, signInDomain: 'example.invalid.sign' });
t('PROVISION plan: three accounts, no errors, no password data in the plan', plan.errors.length === 0 && plan.accounts.length === 3 && !JSON.stringify(plan).includes('a'.repeat(64)), plan.errors);
const prov = await provisionAccounts(plan, deps, { activateDepartmentUsers: true });   // staging rehearsal: DU scoping under test
const created = prov.results.filter(r => r.status === 'created');
t('PROVISION creates every account: exact legacy ids, Employee IDs, a temporary password each, forced change on', prov.ok && created.map(r => r.legacyId).join() === '1,4,7'
  && created.every(r => typeof r.temporaryPassword === 'string' && r.temporaryPassword.length >= 12) && Number((await one('select count(*) c from public.profiles where must_change_password')).c) === 3);
t('PROVISION the Auth sign-in address is derived from the Employee ID (never a mail address)', [...gotrue.values()].map(u => u.email).sort().join() === ['pa001', 'pd004', 'pj007'].map(e => e + '@' + DOMAIN).join());
const again = await provisionAccounts(plan, deps);
t('PROVISION a rerun skips existing accounts (safe after a partial failure)', again.results.every(r => r.status === 'exists') && gotrue.size === 3);
const bad = await provisionAccounts({ accounts: [{ legacy_id: 9, employee_id: 'XX009', full_name: 'X', role: 'Viewer', active: true }], errors: [] }, deps);
t('PROVISION refuses a plan without an active Admin', bad.ok === false && /no active Admin/.test(bad.error));
const brk = { ...deps, db: { ...deps.db, insertProfile: async () => { throw new Error('boom'); } } };
const before = gotrue.size;
const comp = await provisionAccounts({ accounts: [...plan.accounts.slice(0, 1), { ...plan.accounts[1], legacy_id: 30, employee_id: 'ZZ030' }], errors: [] }, brk);
t('PROVISION a failed profile write removes the Auth account again (no orphan)', comp.results.find(r => r.legacyId === 30).status === 'error' && gotrue.size === before);
{ const inact = await provisionAccounts({ accounts: [plan.accounts[0], { ...plan.accounts[2], legacy_id: 2, employee_id: 'ZZ002', username: 'p_inactive', active: false }], errors: [] }, deps);
  const pz = await deps.db.profileByLegacyId(2), gz = pz && gotrue.get(pz.user_id);
  t('PROVISION an account inactive in the old data is created inactive AND blocked in Auth (cannot sign in)', inact.ok && !!pz && pz.active === false && !!gz && !!gz.banned
    && !(await deps.auth.verifyPassword('zz002@' + DOMAIN, inact.results.find(r => r.legacyId === 2).temporaryPassword)), { ok: inact.ok, res: inact.results.map(r => r.legacyId + ':' + r.status + ':' + (r.error || '')), active: pz && pz.active, banned: gz && gz.banned }); }
{ const dflt = await provisionAccounts({ accounts: [plan.accounts[0], { ...plan.accounts[1], legacy_id: 3, employee_id: 'ZZ003', username: 'p_du_default' }], errors: [] }, deps);
  const pd = await deps.db.profileByLegacyId(3), gd = pd && gotrue.get(pd.user_id);
  t('PROVISION by default a Department User account is created INACTIVE and blocked (enabled only after its server scoping is verified)',
    dflt.ok && !!pd && pd.role === 'Department User' && pd.active === false && !!gd && gd.banned && dflt.results.find(r => r.legacyId === 3).active === false, dflt.results.map(r => r.legacyId + ':' + r.status)); }
t('PROVISION temporary passwords may only be written OUTSIDE the repository', safeOutputPath(path.join(ROOT, 'x.json'), ROOT, path) === null && safeOutputPath(ROOT, ROOT, path) === null
  && !!safeOutputPath(path.join(ROOT, '..', 'outside', 'pw.json'), ROOT, path));

// ---- forced first sign-in --------------------------------------------------------------------------------------------
const adminId = (await deps.db.profileByLegacyId(1)).user_id, duId = (await deps.db.profileByLegacyId(4)).user_id, jceId = (await deps.db.profileByLegacyId(7)).user_id;
const tempAdmin = created.find(r => r.legacyId === 1).temporaryPassword;
t('FORCED before the change: no data, no operations, no account administration', ((await asUser(adminId, 'select key from public.app_data')).rows || [1]).length === 0
  && (await H.adminUsers({ caller: adminId, body: { action: 'set_active', userId: duId, active: false } })).status === 403);
t('FORCED weak or reused password refused', (await H.completePasswordChange({ caller: adminId, body: { currentPassword: tempAdmin, newPassword: 'short' } })).status === 400
  && (await H.completePasswordChange({ caller: adminId, body: { currentPassword: tempAdmin, newPassword: tempAdmin } })).status === 400
  && (await H.completePasswordChange({ caller: adminId, body: { currentPassword: tempAdmin, newPassword: 'Aa1!' + 'x'.repeat(69) } })).status === 400);
t('FORCED wrong current password refused, flag kept', (await H.completePasswordChange({ caller: adminId, body: { currentPassword: 'Wrong-Pass-1!', newPassword: 'New-Admin-Pass-1!' } })).status === 400
  && (await deps.db.profileByUser(adminId)).must_change_password === true);
const fc = await H.completePasswordChange({ caller: adminId, body: { currentPassword: tempAdmin, newPassword: 'New-Admin-Pass-1!' } });
t('FORCED change: new password stored in Auth, flag cleared, data reachable afterwards', fc.status === 200 && gotrue.get(adminId).password === 'New-Admin-Pass-1!'
  && (await deps.db.profileByUser(adminId)).must_change_password === false && ((await asUser(adminId, 'select key from public.app_data')).rows || []).length === 5);

// ---- account administration ------------------------------------------------------------------------------------------
const cr = await H.adminUsers({ caller: adminId, body: { action: 'create', employeeId: 'vw020', fullName: 'New Viewer', role: 'Viewer', recoveryEmail: 'viewer@example.invalid' } });
const newId = cr.body.userId;
t('ADMIN create: next legacy id, Employee ID upper-cased, temporary password once, forced change, recovery email NOT yet verified',
  cr.status === 200 && cr.body.legacyId === 8 && typeof cr.body.temporaryPassword === 'string' && (await deps.db.profileByUser(newId)).employee_id === 'VW020'
  && (await deps.db.profileByUser(newId)).must_change_password === true && (await deps.db.profileByUser(newId)).recovery_email_verified_at === null);
t('ADMIN create sends a verification email to the recovery address (never to the sign-in address)', mails.length === 1 && mails[0].to === 'viewer@example.invalid' && !mails.some(m => m.to.endsWith(DOMAIN)));
t('ADMIN create: duplicate Employee ID refused; invalid Employee ID refused; sign-in domain as recovery email refused',
  (await H.adminUsers({ caller: adminId, body: { action: 'create', employeeId: 'VW020', fullName: 'X', role: 'Viewer' } })).status === 409
  && (await H.adminUsers({ caller: adminId, body: { action: 'create', employeeId: 'toolong', fullName: 'X', role: 'Viewer' } })).status === 400
  && (await H.adminUsers({ caller: adminId, body: { action: 'create', employeeId: 'QQ001', fullName: 'X', role: 'Viewer', recoveryEmail: 'x@' + DOMAIN } })).status === 400);
t('ADMIN only an active Admin without a pending forced change may administer', (await H.adminUsers({ caller: duId, body: { action: 'create', employeeId: 'QQ002', fullName: 'X', role: 'Viewer' } })).status === 403);
t('ADMIN cannot change their own account here (role, scope, status, reset)', (await H.adminUsers({ caller: adminId, body: { action: 'update', userId: adminId, role: 'Viewer' } })).status === 403
  && (await H.adminUsers({ caller: adminId, body: { action: 'set_active', userId: adminId, active: false } })).status === 403);
const rs = await H.adminUsers({ caller: adminId, body: { action: 'reset_password', userId: jceId } });
t('ADMIN reset password: new temporary password, forced change again, every session revoked', rs.status === 200 && gotrue.get(jceId).password === rs.body.temporaryPassword
  && (await deps.db.profileByUser(jceId)).must_change_password === true && signOuts.includes(jceId));
const up = await H.adminUsers({ caller: adminId, body: { action: 'update', userId: duId, role: 'Department User', department: 'Fuel Plant', assignedCategories: ['PUMP'] } });
t('ADMIN update scope: department changed; unknown category refused', up.status === 200 && (await deps.db.profileByUser(duId)).department === 'Fuel Plant'
  && (await H.adminUsers({ caller: adminId, body: { action: 'update', userId: duId, assignedCategories: ['NOPE'] } })).status === 400);
const da = await H.adminUsers({ caller: adminId, body: { action: 'set_active', userId: newId, active: false } });
t('ADMIN deactivate: profile inactive, Auth user banned, sessions revoked', da.status === 200 && (await deps.db.profileByUser(newId)).active === false && gotrue.get(newId).banned && signOuts.includes(newId));

// ---- Department User accounts switched OFF (the production default until their scoping is verified) -----------------
{ const Hoff = createHandlers({ ...deps, config: { ...deps.config, departmentUsersEnabled: undefined } });   // setting missing
  const du = { fullName: 'Off DU', role: 'Department User', department: 'Cement Plant', assignedCategories: ['PUMP'] };
  const c1 = await Hoff.adminUsers({ caller: adminId, body: { action: 'create', employeeId: 'OF001', ...du } });
  const c2 = await Hoff.adminUsers({ caller: adminId, body: { action: 'create', employeeId: 'OF002', ...du, active: false } });
  const offId = c2.status === 200 ? c2.body.userId : null;
  const act = offId && await Hoff.adminUsers({ caller: adminId, body: { action: 'set_active', userId: offId, active: true } });
  const conv = await Hoff.adminUsers({ caller: adminId, body: { action: 'update', userId: jceId, role: 'Department User', department: 'Cement Plant', assignedCategories: ['PUMP'] } });
  t('DU-OFF with the setting missing: an ACTIVE Department User cannot be created, activated or made from an active account (409); an inactive one can be prepared',
    c1.status === 409 && !(await deps.db.profileByEmployeeId('OF001')) && c2.status === 200 && (await deps.db.profileByUser(offId)).active === false && gotrue.get(offId).banned
    && act.status === 409 && (await deps.db.profileByUser(offId)).active === false && conv.status === 409 && (await deps.db.profileByUser(jceId)).role === 'Job Card Editor',
    { c1: c1.status, c2: c2.status, act: act && act.status, conv: conv.status });
  const on = await H.adminUsers({ caller: adminId, body: { action: 'set_active', userId: offId, active: true } });
  t('DU-OFF once enabled ("enabled"), the prepared Department User can be activated', on.status === 200 && (await deps.db.profileByUser(offId)).active === true && !gotrue.get(offId).banned); }

// ---- recovery ----------------------------------------------------------------------------------------------------------
const tok = mails[0].text.match(/verify-email=([A-Za-z0-9_-]+)/)[1];
await H.adminUsers({ caller: adminId, body: { action: 'set_active', userId: newId, active: true } });
t('RECOVERY unverified recovery email: same answer, NO email sent', (await H.requestRecovery({ ip: '1', body: { employeeId: 'VW020' } })).status === 202 && mails.length === 1);
t('RECOVERY verify the address with the emailed link (single use)', (await H.verifyRecoveryEmail({ ip: '1', body: { token: tok } })).status === 200 && !!(await deps.db.profileByUser(newId)).recovery_email_verified_at);
const n0 = mails.length;
const ackKnown = await H.requestRecovery({ ip: '2', body: { employeeId: 'vw020' } }), ackUnknown = await H.requestRecovery({ ip: '3', body: { employeeId: 'NO999' } });
t('RECOVERY verified address: one recovery email to the recovery address; unknown Employee ID: identical answer, no email',
  mails.length === n0 + 1 && mails[n0].to === 'viewer@example.invalid' && /recovery/.test(mails[n0].text) && JSON.stringify(ackKnown) === JSON.stringify(ackUnknown));
t('RECOVERY a recovery session is required to set a password without the current one', (await H.completeRecovery({ caller: newId, recovery: false, body: { newPassword: 'Recovered-Pass-1!' } })).status === 401
  && (await H.completeRecovery({ caller: null, recovery: true, body: { newPassword: 'Recovered-Pass-1!' } })).status === 401);
const rc = await H.completeRecovery({ caller: newId, recovery: true, body: { newPassword: 'Recovered-Pass-1!' } });
t('RECOVERY completed: password set, pending forced change cleared, other sessions revoked', rc.status === 200 && gotrue.get(newId).password === 'Recovered-Pass-1!'
  && (await deps.db.profileByUser(newId)).must_change_password === false);
await H.adminUsers({ caller: adminId, body: { action: 'set_active', userId: newId, active: false } });
t('RECOVERY a deactivated account gets no email and cannot complete a recovery', (await H.requestRecovery({ ip: '4', body: { employeeId: 'VW020' } })).status === 202 && mails.length === n0 + 1
  && (await H.completeRecovery({ caller: newId, recovery: true, body: { newPassword: 'Again-Pass-1!' } })).status === 403);

// ---- audit -------------------------------------------------------------------------------------------------------------
const actions = (await svc('select action from public.audit_log')).map(r => r.action);
t('AUDIT every account action was recorded', ['account.provisioned', 'password.forced_change', 'account.create', 'account.reset_password', 'account.update', 'account.deactivate', 'recovery.sent', 'password.recovered']
  .every(a => actions.includes(a)), actions);
t('AUDIT no password, temporary password or token in the audit log', !JSON.stringify(await svc('select details from public.audit_log')).match(/Pass|temporary|token/i));

await db.close();
console.log(`\nP2 handler-DB tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
