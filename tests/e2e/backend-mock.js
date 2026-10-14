// LOCAL TEST BACKEND for the browser tests (full P2 design). It runs the REAL P2 SQL (p2/sql, in the documented order) on
// PGlite (PostgreSQL compiled to WebAssembly) with the Supabase emulation, and the REAL P2 Edge Function logic
// (p2/functions/_shared/handlers.mjs). Only these are emulated: PostgREST (/rest/v1: app_data, profiles, rpc), Supabase
// Auth (/auth/v1: password grant, user, refresh, logout; recovery links), the Edge Function HTTP layer (/functions/v1)
// and the mail provider (captured in mock.mails). Synthetic data only. It is NOT Supabase: docs/P2A_MIGRATION.md §6.3 R-*
// checks still need a staging project.
//
// Compatibility with the browser tests:
//   mock.reset(data)  data = {users: [account records: id, employeeId, fullName, role, scope, active, must_change_password?,
//                     recoveryEmail?, recoveryEmailVerified?, plainPassword], assets, jobOrders, ...}. The accounts are
//                     provisioned as p2/migration/provision.mjs does (Supabase Auth user + profile, numeric id kept).
//   mock.store        synchronous mirror of every dataset; `users` = the server accounts in the app's record shape with
//                     `password` = SHA-256 of the account's current password (for assertions only).
//   mock.writes       one entry per server change: {key, value (the dataset afterwards), len, prevLen, fn?, failed?, rejected?}
//   mock.requests / failKeys / failLoad / loadDelay / failFunctions as before; notifyOff (my_notifications fails);
//   mock.mails = emails the server sent; mock.notesFor(legacyId) / mock.noteCount() read the server notifications.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..', '..');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v);
// An unchanged record keeps the previous object (and its key order); a changed one keeps the previous key order.
function reorderLike(prev, next) {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object' || Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) return next.map((x, i) => i < prev.length ? reorderLike(prev[i], x) : x);
  const out = {}; Object.keys(prev).forEach(k => { if (k in next) out[k] = reorderLike(prev[k], next[k]); }); Object.keys(next).forEach(k => { if (!(k in out)) out[k] = next[k]; });
  return out;
}
function keepUnchanged(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return stable(prev) === stable(next) && prev !== undefined ? prev : next;
  const pool = new Map(); prev.forEach(p => { const k = stable(p); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(p); });
  const idOf = e => e && typeof e === 'object' ? (e.id !== undefined ? 'id:' + e.id : e.jobNo !== undefined ? 'jo:' + e.jobNo : e.num !== undefined ? 'num:' + e.num : e.empId !== undefined ? 'emp:' + e.empId : null) : null;
  const byId = new Map(prev.filter(p => idOf(p) !== null).map(p => [idOf(p), p]));
  return next.map(n => { const l = pool.get(stable(n)); if (l && l.length) return l.shift(); const p = byId.get(idOf(n)); return p ? reorderLike(p, n) : n; });
}
function pgliteEntry() {
  const dir = process.env.CMMS_PGLITE_DIR;
  const entry = dir && path.join(dir, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
  return entry && fs.existsSync(entry) ? entry : null;
}
const FN_KEYS = {
  jo_create: ['jobOrders'], jo_update: ['jobOrders'], jo_update_request: ['jobOrders'], jo_update_work: ['jobOrders'], jo_set_status: ['jobOrders'], jo_approve: ['jobOrders'],
  jo_close: ['jobOrders'], jo_revert: ['jobOrders'], jo_delete: ['jobOrders'], jo_import: ['jobOrders'], category_rename: ['customPlants', 'assets', 'jobOrders', 'users'],
  asset_clear_all: ['assets'], admin_reset_data: ['assets', 'jobOrders', 'pm', 'employees', 'customPlants'], employee_set_status: ['employees'], employee_save: ['employees'],
  employee_delete: ['employees'], employee_import: ['employees'], employee_apply_date_rules: ['employees'], profile_update_self: ['users'],
};
const SIGN_IN_DOMAIN = 'accounts.example.invalid';

class BackendMock {
  constructor() {
    this.requests = []; this.writes = []; this._store = {}; this.mails = []; this.failKeys = new Set(); this.failLoad = false; this.loadDelay = 0; this.failFunctions = false;
    this.secret = crypto.randomBytes(32); this.accounts = new Map(); this.refresh = new Map(); this.revoked = new Set();
    this.queue = Promise.resolve(); this.ready = Promise.resolve(); this.appUrl = 'http://127.0.0.1:8770/index.html';
  }
  get store() { return this._store; }
  set store(v) { this.reset(v, { keepWrites: true }); }

  async init() {
    const entry = pgliteEntry();
    if (!entry) throw new Error('CMMS_PGLITE_DIR not set: the browser tests need PGlite');
    const { PGlite } = await import(pathToFileURL(entry).href);
    const { APPLY } = await import(pathToFileURL(path.join(ROOT, 'tests', 'p2', 'apply-order.mjs')).href);
    this.db = new PGlite();
    await this.db.exec(fs.readFileSync(path.join(ROOT, 'tests', 'p2', 'supabase-emulation.sql'), 'utf8'));
    await this.db.exec("insert into public.app_data (key, value) values ('users', '[]')");
    for (const f of APPLY) await this.db.exec(fs.readFileSync(path.join(ROOT, 'p2', 'sql', f), 'utf8'));
    const fns = (await this.db.query(`select p.proname, p.proargnames, p.proargtypes::regtype[]::text[] types, p.prorettype::regtype::text ret
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows;
    this.fns = Object.fromEntries(fns.map(f => [f.proname, { args: (f.proargnames || []).map((n, i) => ({ n, t: f.types[i] })), ret: f.ret }]));
    const { createHandlers } = await import(pathToFileURL(path.join(ROOT, 'p2', 'functions', '_shared', 'handlers.mjs')).href);
    this.policy = await import(pathToFileURL(path.join(ROOT, 'p2', 'functions', '_shared', 'policy.mjs')).href);
    this.h = createHandlers(this.deps());
  }
  exclusive(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }
  runAs(who, sql, params = []) {
    return this.exclusive(async () => {
      const db = this.db;
      await db.exec('reset role');
      const user = who !== null && typeof who === 'object' && typeof who.sub === 'string';   // (a string has a .sub method: check the type)
      await db.query("select set_config('request.jwt.claims', $1, false)", [user ? JSON.stringify({ sub: who.sub, role: 'authenticated' }) : '']);
      if (who === 'anon') await db.exec('set role anon'); else if (who === 'service') await db.exec('set role service_role'); else if (user) await db.exec('set role authenticated');
      try { const r = await db.query(sql, params); return { rows: r.rows }; }
      catch (e) { return { error: { code: e.code || 'XX000', message: e.message } }; }
      finally { await db.exec('reset role'); }
    });
  }
  async callFn(who, name, args) {
    const f = this.fns[name];
    if (!f) return { error: { code: 'PGRST202', message: 'function not found' }, status: 404 };
    const given = Object.keys(args || {});
    if (given.some(k => !f.args.some(a => a.n === k))) return { error: { code: 'PGRST202', message: 'unknown argument' }, status: 404 };
    const vals = given.map(k => { const v = args[k]; return v === null ? null : Array.isArray(v) && /\[\]$/.test(f.args.find(a => a.n === k).t) ? '{' + v.join(',') + '}' : typeof v === 'object' ? JSON.stringify(v) : v; });
    const call = `public.${name}(${given.map((k, i) => `${k} => $${i + 1}::${f.args.find(a => a.n === k).t}`).join(', ')})`;
    const r = await this.runAs(who, f.ret === 'void' ? `select ${call}` : `select to_jsonb(${call}) as r`, vals);
    return r.error ? r : { data: f.ret === 'void' ? null : r.rows[0].r };
  }

  // ---- data reset (provisioning as p2/migration/provision.mjs) + mirror ----
  reset(data, opt = {}) {
    const copy = JSON.parse(JSON.stringify(data || {}));
    this._store = copy;
    if (!opt.keepWrites) this.writes = [];
    this.failKeys = new Set(); this.failLoad = false; this.loadDelay = 0; this.failFunctions = false; this.mails = []; this.notifyOff = false;
    this.ready = this.ready.then(() => this._reset(copy)).catch(e => { console.log('mock reset failed: ' + e.message); });
    return this.ready;
  }
  async _reset(data) {
    this.accounts = new Map(); this.refresh = new Map(); this.revoked = new Set();
    await this.exclusive(async () => {
      const db = this.db;
      await db.exec(`reset role; set session_replication_role = replica;
        delete from public.notifications; delete from public.jo_events; delete from public.recovery_email_verifications; delete from public.auth_rate_limits;
        delete from public.profiles; delete from public.audit_log; delete from auth.sessions; delete from auth.users; delete from public.app_data where key <> 'users';
        set session_replication_role = origin;`);
      for (const [k, v] of Object.entries(data)) if (k !== 'users') await db.query('insert into public.app_data (key, value) values ($1, $2::jsonb)', [k, JSON.stringify(v)]);
      for (const u of Array.isArray(data.users) ? data.users : []) {
        const eid = String(u.employeeId || '').toUpperCase();
        if (!/^[A-Z0-9]{5}$/.test(eid)) continue;
        const id = crypto.randomUUID(), email = eid.toLowerCase() + '@' + SIGN_IN_DOMAIN;
        await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
        try {
          await db.query(`insert into public.profiles (user_id, legacy_id, employee_id, username, full_name, recovery_email, recovery_email_verified_at, role, department, assigned_categories, section, active, must_change_password)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [id, u.id, eid, u.username || null, u.fullName || '', u.recoveryEmail || null, u.recoveryEmail && u.recoveryEmailVerified ? new Date().toISOString() : null,
            u.role, u.role === 'Department User' ? u.department : null, u.role === 'Department User' ? u.assignedCategories : null, u.role === 'Job Card Editor' ? u.section : null,
            u.active !== false, u.must_change_password === true]);
          this.accounts.set(email, { id, email, password: u.plainPassword || crypto.randomBytes(12).toString('hex'), banned: u.active === false });
        } catch (e) { await db.query('delete from auth.users where id = $1', [id]); }   // an account the server refuses (e.g. invalid role) does not exist
      }
    });
    await this.mirror();
  }
  async mirror() {
    const rows = (await this.runAs('super', 'select key, value from public.app_data order by key')).rows;
    const store = {};
    for (const r of rows) if (r.key !== 'users') store[r.key] = r.value;
    const prof = (await this.runAs('super', 'select * from public.profiles order by legacy_id')).rows;
    store.users = prof.map(p => {
      const acct = [...this.accounts.values()].find(a => a.id === p.user_id);
      const u = { id: p.legacy_id, employeeId: p.employee_id, username: p.username, fullName: p.full_name, role: p.role, active: p.active,
                  must_change_password: p.must_change_password, password: acct ? sha(acct.password) : '' };
      if (p.recovery_email) { u.recoveryEmail = p.recovery_email; u.recoveryEmailVerified = !!p.recovery_email_verified_at; }
      if (p.department != null) u.department = p.department;
      if (p.assigned_categories != null) u.assignedCategories = p.assigned_categories;
      if (p.section != null) u.section = p.section;
      return u;
    });
    for (const k of Object.keys(store)) store[k] = keepUnchanged(this._store[k], store[k]);
    this._store = store;
  }
  async updateAccount(id, fields) {   // test helper: an Admin elsewhere changes an account ON THE SERVER
    await this.ready;
    const COL = { role: 'role', active: 'active', fullName: 'full_name', section: 'section', department: 'department', assignedCategories: 'assigned_categories', must_change_password: 'must_change_password' };
    const keys = Object.keys(fields).filter(k => COL[k]);
    const r = await this.runAs('super', 'update public.profiles set ' + keys.map((k, i) => COL[k] + ' = $' + (i + 1)).join(', ') + ' where legacy_id = $' + (keys.length + 1), [...keys.map(k => fields[k]), id]);
    if (r.error) throw new Error('updateAccount: ' + r.error.message);
    await this.mirror();
  }
  // test helpers: the notifications the SERVER stored (p2/sql 0008), by recipient legacy id
  async notesFor(id) {
    const r = await this.runAs('super', `select e.job_no "jobNo", e.event, n.read_at is not null "read" from public.notifications n join public.jo_events e on e.id = n.event_id
      join public.profiles p on p.user_id = n.recipient where p.legacy_id = $1 order by n.id desc`, [id]);
    if (r.error) throw new Error('notesFor: ' + r.error.message);
    return r.rows;
  }
  async noteCount() { return Number((await this.runAs('super', 'select count(*) c from public.notifications')).rows[0].c); }
  logWrite(keys, extra, before) {
    const now = Date.now();
    for (const k of keys) { const prev = before[k], value = this._store[k];
      this.writes.push({ key: k, prevLen: Array.isArray(prev) ? prev.length : null, len: Array.isArray(value) ? value.length : null, value, t: now, ...extra }); }
  }

  // ---- fake Supabase Auth ----
  jwt(sub, email, method) {
    const now = Math.floor(Date.now() / 1000);
    const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600,
      amr: [{ method: method || 'password', timestamp: now }], session_id: crypto.randomUUID() }));
    return h + '.' + p + '.' + b64u(crypto.createHmac('sha256', this.secret).update(h + '.' + p).digest());
  }
  verify(token) {
    const p = String(token || '').split('.');
    if (p.length !== 3 || b64u(crypto.createHmac('sha256', this.secret).update(p[0] + '.' + p[1]).digest()) !== p[2] || this.revoked.has(token)) return null;
    const c = JSON.parse(Buffer.from(p[1], 'base64').toString());
    const acct = [...this.accounts.values()].find(a => a.id === c.sub);
    return c.exp > Date.now() / 1000 && acct && !acct.banned ? c : null;
  }
  session(acct, method) {
    const access_token = this.jwt(acct.id, acct.email, method), refresh_token = crypto.randomBytes(16).toString('hex');
    this.refresh.set(refresh_token, acct.id);
    return { access_token, refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: acct.id, aud: 'authenticated', role: 'authenticated', email: acct.email } };
  }
  deps() {
    const self = this;
    const svc = async (sql, params) => { const r = await self.runAs('service', sql, params); if (r.error) throw new Error(r.error.message); return r.rows; };
    const one = async (sql, params) => (await svc(sql, params))[0] || null;
    const cols = row => { const k = Object.keys(row); return { k, v: k.map(x => row[x]) }; };
    return {
      config: { signInDomain: SIGN_IN_DOMAIN, get appUrl() { return self.appUrl; }, verifyTtlMinutes: 60, recoveryMinMs: 5, departmentUsersEnabled: true },   // the browser tests exercise Department Users (a staging-like setup)
      now: () => new Date(), sleep: ms => new Promise(r => setTimeout(r, ms)), randomUint32: n => crypto.getRandomValues(new Uint32Array(n)),
      randomToken: () => crypto.randomBytes(32).toString('base64url'), hash: async s => crypto.createHmac('sha256', self.secret).update(s).digest('hex'),
      mail: { send: async m => { self.mails.push(m); } }, log: () => {},
      auth: {
        async createUser({ email, password }) { if (self.accounts.has(email)) throw new Error('exists'); const id = crypto.randomUUID();
          const r = await self.runAs('super', 'insert into auth.users (id, email) values ($1, $2)', [id, email]); if (r.error) throw new Error(r.error.message);
          self.accounts.set(email, { id, email, password, banned: false }); return { id }; },
        async updateUser(id, a) { for (const u of self.accounts.values()) if (u.id === id) { if (a.password !== undefined) u.password = a.password; if (a.ban_duration !== undefined) u.banned = a.ban_duration !== 'none'; return; } throw new Error('no user'); },
        async deleteUser(id) { for (const [k, u] of self.accounts) if (u.id === id) self.accounts.delete(k); await self.runAs('super', 'delete from auth.users where id = $1', [id]); },
        async signOutAll(id) { for (const [rt, uid] of self.refresh) if (uid === id) self.refresh.delete(rt); self.revokedUsers = (self.revokedUsers || new Set()).add(id); },
        async generateRecoveryLink(email) { const a = self.accounts.get(email); if (!a) throw new Error('no user'); const s = self.session(a, 'recovery');
          return `${self.appUrl}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`; },
        async verifyPassword(email, pw) { const a = self.accounts.get(email); return !!a && !a.banned && a.password === pw; },
      },
      db: {
        profileByUser: uid => one('select * from public.profiles where user_id = $1', [uid]),
        profileByEmployeeId: eid => one('select * from public.profiles where employee_id = $1', [eid]),
        profileByRecoveryEmail: e => one('select * from public.profiles where recovery_email = $1', [e]),
        profileByLegacyId: n => one('select * from public.profiles where legacy_id = $1', [n]),
        insertProfile: async row => { const { k, v } = cols(row); await svc(`insert into public.profiles (${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')})`, v); },
        updateProfile: async (uid, patch) => { const { k, v } = cols(patch); await svc(`update public.profiles set ${k.map((x, i) => x + ' = $' + (i + 1)).join(', ')} where user_id = $${k.length + 1}`, [...v, uid]); },
        nextLegacyId: async () => (await one('select coalesce(max(legacy_id), 0) + 1 n from public.profiles')).n,
        activeAdminCount: async () => Number((await one("select count(*) c from public.profiles where role = 'Admin' and active")).c),
        knownCategories: async () => ((await one("select value from public.app_data where key = 'customPlants'")) || { value: [] }).value,
        rateLimitHit: async (b, s, m, w) => (await one('select public.rate_limit_hit($1, $2, $3, $4) r', [b, s, m, w])).r,
        insertAudit: async row => { await svc('insert into public.audit_log (actor, action, target, details) values ($1, $2, $3, $4::jsonb)', [row.actor, row.action, row.target, JSON.stringify(row.details || {})]); },
        saveVerification: async row => { await svc('insert into public.recovery_email_verifications (token_hash, user_id, email, expires_at) values ($1, $2, $3, $4)', [row.token_hash, row.user_id, row.email, row.expires_at]); },
        takeVerification: (h, now) => one('update public.recovery_email_verifications set used_at = $2 where token_hash = $1 and used_at is null and expires_at > $2 returning *', [h, now.toISOString()]),
      },
    };
  }

  // ---- HTTP ----
  async handle(q, r) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': q.headers['access-control-request-headers'] || '*', 'Access-Control-Expose-Headers': 'Content-Range' };
    this.requests.push({ m: q.method, u: q.url });
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const send = (code, obj) => { r.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); r.end(obj === undefined ? '' : JSON.stringify(obj)); };
    let body = ''; for await (const c of q) body += c;
    let json = null; try { json = body ? JSON.parse(body) : null; } catch (e) { return send(400, { message: 'bad json' }); }
    await this.ready;
    const u = new URL(q.url, 'https://mock.invalid');
    const token = (q.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const claims = this.verify(token);
    const who = claims ? { sub: claims.sub } : 'anon';
    const pgError = e => send(e.code === '42501' ? (who === 'anon' ? 401 : 403) : e.code === 'PGRST202' ? 404 : 400, { code: e.code, message: e.message, details: null, hint: null });
    try {
      // ---- Supabase Auth ----
      if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
        const a = json && this.accounts.get(String(json.email || '').toLowerCase());
        if (!a || a.banned || a.password !== json.password) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' });
        return send(200, this.session(a, 'password'));
      }
      if (u.pathname === '/auth/v1/user' && q.method === 'GET') {
        if (!claims) return send(401, { code: 401, msg: 'invalid JWT' });
        return send(200, { id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email });
      }
      if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
        const id = this.refresh.get(json && json.refresh_token); const acct = [...this.accounts.values()].find(a => a.id === id && !a.banned);
        if (!acct) return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        this.refresh.delete(json.refresh_token);
        return send(200, this.session(acct, 'password'));
      }
      if (u.pathname === '/auth/v1/logout') { if (claims) { this.revoked.add(token); for (const [rt, id] of this.refresh) if (id === claims.sub) this.refresh.delete(rt); } r.writeHead(204, cors); return r.end(); }
      // ---- Edge Functions ----
      if (u.pathname.startsWith('/functions/v1/') && q.method === 'POST') {
        const name = u.pathname.slice('/functions/v1/'.length);
        const H = { 'admin-users': 'adminUsers', 'complete-password-change': 'completePasswordChange', 'complete-recovery': 'completeRecovery', 'request-recovery': 'requestRecovery', 'verify-recovery-email': 'verifyRecoveryEmail' }[name];
        if (!H) return send(404, { error: 'not found' });
        if (this.failFunctions) return send(503, { error: 'The service is temporarily unavailable. Please try again.' });
        if (['admin-users', 'complete-password-change', 'complete-recovery'].includes(name) && this.failKeys.has('users')) { this.writes.push({ key: 'users', fn: name, failed: true }); return send(503, { error: 'The service is temporarily unavailable. Please try again.' }); }
        const before = { users: this._store.users };
        const recovery = !!claims && Array.isArray(claims.amr) && claims.amr.some(m => m && m.method === 'recovery');
        const out = await this.h[H]({ caller: claims ? claims.sub : null, ip: '127.0.0.9', body: json || {}, recovery });
        await this.mirror();
        if (out.status === 200 && ['admin-users', 'complete-password-change', 'complete-recovery'].includes(name)) this.logWrite(['users'], { fn: name }, before);
        return send(out.status, out.body);
      }
      // ---- PostgREST: functions ----
      if (u.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = u.pathname.slice('/rest/v1/rpc/'.length);
        const keys = FN_KEYS[fn] || [];
        if (this.failLoad && (fn === 'jo_list' || fn === 'asset_list')) return send(500, { message: 'mock: load failure' });
        if (this.notifyOff && fn === 'my_notifications') return send(500, { message: 'mock: notifications unavailable' });
        if (keys.some(k => this.failKeys.has(k))) { keys.forEach(k => this.writes.push({ key: k, fn, failed: true })); return send(500, { code: 'XX000', message: 'mock: injected failure' }); }
        if (this.loadDelay && (fn === 'jo_list' || fn === 'asset_list')) await new Promise(res => setTimeout(res, this.loadDelay));
        const before = { ...this._store };
        const res = await this.callFn(who, fn, json || {});
        if (res.error) { if (keys.length) keys.forEach(k => this.writes.push({ key: k, fn, rejected: true, code: res.error.code })); return res.status ? send(res.status, res.error) : pgError(res.error); }
        if (keys.length) { await this.mirror(); this.logWrite(keys, { fn }, before); }
        return send(200, res.data);
      }
      // ---- PostgREST: own profile row (RLS) ----
      if (u.pathname === '/rest/v1/profiles' && q.method === 'GET') {
        const uid = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const res = await this.runAs(who, 'select * from public.profiles' + (uid ? ' where user_id = $1' : ''), uid ? [uid] : []);
        if (res.error) return pgError(res.error);
        return send(200, res.rows);
      }
      // ---- PostgREST: app_data ----
      if (u.pathname !== '/rest/v1/app_data') return send(404, { message: 'mock: not found' });
      const keyF = u.searchParams.get('key') || '';
      const keyList = keyF.startsWith('eq.') ? [keyF.slice(3)] : keyF.startsWith('in.(') ? keyF.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')) : null;
      if (q.method === 'GET') {
        if (this.failLoad) return send(500, { message: 'mock: load failure' });
        if (this.loadDelay) await new Promise(res => setTimeout(res, this.loadDelay));
        const res = await this.runAs(who, keyList ? 'select key, value, updated_at from public.app_data where key = any($1::text[]) order by key' : 'select key, value, updated_at from public.app_data order by key', keyList ? [keyList] : []);
        if (res.error) return pgError(res.error);
        const cols = (u.searchParams.get('select') || '*').split(',');
        return send(200, res.rows.map(x => cols.includes('*') ? x : Object.fromEntries(cols.filter(c => c in x).map(c => [c, x[c]]))));
      }
      if (q.method === 'PATCH') {
        const key = keyList && keyList.length === 1 ? keyList[0] : null;
        if (!key || !json || !('value' in json)) return send(400, { message: 'mock: PATCH needs key=eq. and a value' });
        if (this.failKeys.has(key)) { this.writes.push({ key, failed: true }); return send(500, { message: 'mock: injected failure' }); }
        const before = { ...this._store };
        const res = await this.runAs(who, 'update public.app_data set value = $1::jsonb, updated_at = coalesce($2::timestamptz, now()) where key = $3 returning key', [JSON.stringify(json.value), json.updated_at || null, key]);
        if (res.error) { this.writes.push({ key, rejected: true, code: res.error.code }); return pgError(res.error); }
        if (!res.rows.length) { this.writes.push({ key, rejected: true, code: 'RLS' }); return send(200, []); }
        await this.mirror(); this.logWrite([key], {}, before);
        return send(200, res.rows.map(x => ({ key: x.key })));
      }
      if (q.method === 'POST' || q.method === 'DELETE') {
        const items = [].concat(json || []);
        const res = q.method === 'POST'
          ? await this.runAs(who, 'insert into public.app_data (key, value) select x.key, x.value from jsonb_to_recordset($1::jsonb) x(key text, value jsonb) on conflict (key) do update set value = excluded.value', [JSON.stringify(items)])
          : await this.runAs(who, 'delete from public.app_data where key = any($1::text[])', [keyList || []]);
        (q.method === 'POST' ? items.map(i => i.key) : keyList || []).forEach(k => this.writes.push({ key: k, rejected: !!res.error, method: q.method }));
        if (res.error) return pgError(res.error);
        await this.mirror();
        return send(201);
      }
      return send(405, { message: 'mock: method' });
    } catch (e) {
      return send(500, { message: 'mock error: ' + e.message });
    }
  }
}

module.exports = { BackendMock, pgliteEntry, SIGN_IN_DOMAIN };
