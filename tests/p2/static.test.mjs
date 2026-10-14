// STATIC tests of the P2 drafts (p2/). They READ files only: no database, no network, nothing executed.
// They check what the drafts SAY (deny-by-default grants, forced RLS, search_path, revoked EXECUTE, matrices and lists
// identical to index.html and to the reference model, rollback coverage, no secrets, no personal data). They do NOT
// prove the SQL is valid or that Supabase enforces it: that needs the approved staging project (P2A_MIGRATION §6.3).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P2 = process.env.P2_DIR ? path.resolve(process.env.P2_DIR) : path.join(ROOT, 'p2');   // P2_DIR: negative controls on a scratch copy
let pass = 0, fail = 0;
const t = (n, c, info) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + '[STATIC] ' + n + (!c && info !== undefined ? '  -> ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };
const read = f => fs.readFileSync(f, 'utf8');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(P2), sqlDir = path.join(P2, 'sql');
const fwd = fs.readdirSync(sqlDir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
const rb = fs.readdirSync(path.join(sqlDir, 'rollback')).sort();
const sql = Object.fromEntries(fwd.map(f => [f, read(path.join(sqlDir, f))]));
const allSql = Object.values(sql).join('\n');
const strip = s => s.replace(/--[^\n]*/g, '');   // comments removed for "statement" checks
const code = strip(allSql);

// ---- index.html (sanitized in memory) as the source of truth for lists ----
const { sanitizedIndex } = require('../lib/sanitize.js');
const html = sanitizedIndex();
const ctx = {}; vm.createContext(ctx);
vm.runInContext("var DESIGNATIONS = {};", ctx);
const a = html.indexOf('// ─── PERMISSIONS'), b = html.indexOf('// ─── DATA LOAD (N1)');
vm.runInContext(html.slice(a, b) + '\nthis.X = {ROLE_CAPS, DEPARTMENTS, JCE_SECTIONS, JO_REQUEST_FIELDS, JO_WORK_FIELDS, DU_REPAIR_TYPE};', ctx);
const X = ctx.X;
const same = (p, q) => JSON.stringify([...p].sort()) === JSON.stringify([...q].sort());
const listIn = (s, re) => { const m = s.match(re); return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null; };

// ---- 1. labels ----
t('every SQL file (forward and rollback) says in its first lines that it was NOT executed on Supabase',
  [...fwd.map(f => path.join(sqlDir, f)), ...rb.map(f => path.join(sqlDir, 'rollback', f))].every(f => /DRAFT — NOT EXECUTED|NOT EXECUTED on any Supabase project/.test(read(f).split('\n').slice(0, 4).join(' '))));
t('every source file is labelled DRAFT (or TEST SUPPORT) at the top', files.filter(f => /\.(mjs|ts)$/.test(f)).every(f => /DRAFT|TEST SUPPORT/.test(read(f).split('\n').slice(0, 2).join(' '))),
  files.filter(f => /\.(mjs|ts)$/.test(f) && !/DRAFT|TEST SUPPORT/.test(read(f).split('\n').slice(0, 2).join(' '))));
t('each forward migration has a rollback file', fwd.every(f => rb.includes(f.replace('.sql', '.down.sql'))), { fwd, rb });

// ---- 2. deny by default ----
const tables = [...code.matchAll(/create table (public\.\w+)/g)].map(m => m[1]);
t('every new table enables RLS, is NOT forced (the owner-run functions must keep working; API roles are never owners) and revokes everything from public and anon',
  tables.length === 6 && tables.every(tb => code.includes(`alter table ${tb} enable row level security`) && !new RegExp(`^\\s*alter table ${tb.replace('.', '\\.')} force row level security`, 'm').test(code) && new RegExp(`revoke all on ${tb.replace('.', '\\.')} from public, anon`).test(code)), tables);
t('app_data: RLS enabled (not forced); every column and table grant revoked from public, anon, authenticated before the narrow grants',
  /alter table public\.app_data enable row level security/.test(code) && !/^\s*alter table public\.app_data force row level security/m.test(code) && /revoke all on public\.app_data from public, anon, authenticated;/.test(code)
  && /revoke all \(%I\) on public\.app_data from public, anon, authenticated/.test(sql['0003_app_data_rls_p2a.sql']));
t('no GRANT to anon or PUBLIC anywhere, except EXECUTE on environment_marker() (returns only the staging marker)', [...code.matchAll(/grant [^;]* to [^;]*\b(anon|public)\b[^;]*;/gi)].map(m => m[0]).join('|') === 'grant execute on function public.environment_marker() to anon, authenticated;');
t('no policy for anon or PUBLIC; every policy is "to authenticated"', [...code.matchAll(/create policy[^;]*;/g)].every(m => /to authenticated/.test(m[0]) && !/\bto (anon|public)\b/.test(m[0])));
t('app_data: authenticated may only SELECT and UPDATE (no INSERT, no DELETE, no TRUNCATE)',
  /grant select \(key, value, updated_at\) on public\.app_data to authenticated;/.test(code) && /grant update \(value, updated_at\)\s+on public\.app_data to authenticated;/.test(code) && !/grant [^;]*(insert|delete|truncate)[^;]*on public\.app_data/i.test(code));
t('app_data update policy keeps a dataset an array (WITH CHECK jsonb_typeof = array)', /with check \(private\.can_write_key\(key\) and jsonb_typeof\(value\) = 'array'\)/.test(code));
t('profiles: authenticated has SELECT only; no INSERT/UPDATE/DELETE policy exists (server-controlled)',
  /grant select on public\.profiles to authenticated;/.test(code) && !/grant [^;]*(insert|update|delete)[^;]*on public\.profiles/i.test(code) && !/create policy \w+ on public\.profiles for (insert|update|delete|all)/.test(code));
t('profiles: own-row and Admin-only read policies', /create policy profiles_select_own\s+on public\.profiles for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\);/.test(code) && /create policy profiles_select_admin on public\.profiles for select to authenticated using \(private\.is_admin\(\)\);/.test(code));
t('profiles guard trigger refuses anon/authenticated writes and any legacy_id change; last-Admin trigger present',
  /if current_user in \('anon', 'authenticated'\) then\s+raise exception 'profiles are server-controlled'/.test(code) && /legacy_id never changes/.test(code) && /the last active Admin cannot be removed, demoted or deactivated/.test(code));
t('"active" requires active AND no pending forced password change (forced-change accounts get no data)', /p\.active and not p\.must_change_password/.test(sql['0002_access_helpers.sql']) && /if me\.user_id is null or not me\.active or me\.must_change_password then/.test(sql['0005_p2b_job_order_functions.sql']));
t('roles are read from public.profiles on each call (no JWT role claims used for authorization)', !/auth\.jwt\(\)\s*->>?\s*'(user_)?role'/.test(code) && /from public\.profiles p where p\.user_id = \(select auth\.uid\(\)\)/.test(code));

// ---- 3. functions ----
const fnDefs = [...code.matchAll(/create (?:or replace )?function ([\w.]+)\(([^)]*)\)[^$]*?\$\$/g)].map(m => ({ name: m[1], head: m[0] }));
t('every function sets search_path = \'\' (no search_path hijack)', fnDefs.length >= 20 && fnDefs.every(f => /set search_path = ''/.test(f.head)), fnDefs.filter(f => !/set search_path = ''/.test(f.head)).map(f => f.name));
const definers = fnDefs.filter(f => /security definer/.test(f.head)).map(f => f.name);
t('every SECURITY DEFINER function has EXECUTE revoked from public (and anon) explicitly', definers.every(n => new RegExp(`revoke all on function [^;]*${n.replace('.', '\\.')}\\([^;]*from public, anon`).test(code)), definers.filter(n => !new RegExp(`revoke all on function [^;]*${n.replace('.', '\\.')}\\([^;]*from public, anon`).test(code)));
t('service-only functions (rate limit, session revocation) are granted to service_role only', /grant execute on function public\.rate_limit_hit\(text, text, integer, integer\) to service_role;/.test(code) && /grant execute on function public\.revoke_user_sessions\(uuid\) to service_role;/.test(code) && !/grant execute on function public\.(rate_limit_hit|revoke_user_sessions)[^;]*authenticated/.test(code));
t('helpers live in schema private, which anon cannot use', /revoke all on schema private from public, anon;/.test(code) && /grant usage on schema private to authenticated;/.test(code));
t('every job-order mutation locks the jobOrders row (FOR UPDATE) and writes an audit row', /where a\.key = 'jobOrders' for update;/.test(code) && /insert into public\.audit_log \(actor, action, details\) values \(actor, action/.test(code) && (code.match(/private\.jo_lock\(\)/g) || []).length >= 6);
t('audit log is append-only and Admin-read-only', /audit_log is append-only/.test(code) && /create policy audit_log_admin_read on public\.audit_log for select to authenticated using \(private\.is_admin\(\)\);/.test(code));
t('rate-limit subjects and verification tokens are stored only as 64-hex hashes', /subject_hash text not null check \(subject_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(code) && /token_hash  text primary key check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(code));

// ---- 4. lists identical to index.html and the reference model ----
const { KEY_READ, KEY_WRITE_P2A, KEY_WRITE_P2B, JO_REQUEST_FIELDS, JO_WORK_FIELDS, ROLES: MROLES } = await import(pathToFileURL(path.join(P2, 'model', 'access-model.mjs')));
const policy = await import(pathToFileURL(path.join(P2, 'functions', '_shared', 'policy.mjs')));
t('roles: SQL check list = policy.mjs = model = ROLE_CAPS keys in index.html (six roles)',
  same(listIn(sql['0001_profiles.sql'], /role in \(([^)]*)\)/), Object.keys(X.ROLE_CAPS)) && same(policy.ROLES, Object.keys(X.ROLE_CAPS)) && same(MROLES, Object.keys(X.ROLE_CAPS)) && Object.keys(X.ROLE_CAPS).length === 6);
t('departments: SQL = policy.mjs = index.html DEPARTMENTS', same(listIn(sql['0001_profiles.sql'], /department in \(([^)]*)\)/), X.DEPARTMENTS) && same(policy.DEPARTMENTS, X.DEPARTMENTS));
t('JCE sections: SQL = policy.mjs = index.html JCE_SECTIONS', same(listIn(sql['0001_profiles.sql'], /section in \(([^)]*)\)/), X.JCE_SECTIONS) && same(policy.JCE_SECTIONS, X.JCE_SECTIONS));
t('Employee ID format: SQL ^[A-Z0-9]{5}$ (upper-cased by trigger); policy.mjs 5 letters/digits', /employee_id ~ '\^\[A-Z0-9\]\{5\}\$'/.test(sql['0001_profiles.sql']) && /new\.employee_id := upper\(btrim\(new\.employee_id\)\);/.test(sql['0001_profiles.sql']) && String(policy.EMPLOYEE_ID_RE) === '/^[A-Za-z0-9]{5}$/');
t('job-order request/work field lists: SQL (0005) = model = index.html', same(listIn(sql['0005_p2b_job_order_functions.sql'], /allowed := array\[([^\]]*)\]/), X.JO_REQUEST_FIELDS) && same(listIn(sql['0005_p2b_job_order_functions.sql'], /unnest\(array\[([^\]]*)\]\) k/), X.JO_WORK_FIELDS) && same(JO_REQUEST_FIELDS, X.JO_REQUEST_FIELDS) && same(JO_WORK_FIELDS, X.JO_WORK_FIELDS));
t('Department Users raise Unplanned only, in SQL as in index.html', X.DU_REPAIR_TYPE === 'Unplanned' && (sql['0005_p2b_job_order_functions.sql'].match(/<> 'Unplanned'/g) || []).length >= 2);
const parseMatrix = (s, fn) => { const body = s.slice(s.indexOf(`function private.${fn}(k text)`)); const end = body.indexOf('$$;'); return Object.fromEntries([...body.slice(0, end).matchAll(/when '(\w+)'\s+then private\.has_role\(array\[([^\]]*)\]\)/g)].map(m => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])])); };
const eqMatrix = (p, q) => same(Object.keys(p), Object.keys(q)) && Object.keys(p).every(k => same(p[k], q[k]));
t('can_read_key in SQL = the model\'s KEY_READ (users, unknown keys: nobody)', eqMatrix(parseMatrix(sql['0002_access_helpers.sql'], 'can_read_key'), KEY_READ), parseMatrix(sql['0002_access_helpers.sql'], 'can_read_key'));
t('can_write_key (P2a, 0002) = KEY_WRITE_P2A; (P2b, 0009 switch) = KEY_WRITE_P2B; rollback of 0009 = P2A',
  eqMatrix(parseMatrix(sql['0002_access_helpers.sql'], 'can_write_key'), KEY_WRITE_P2A) && eqMatrix(parseMatrix(sql['0009_p2b_switch.sql'], 'can_write_key'), KEY_WRITE_P2B)
  && eqMatrix(parseMatrix(read(path.join(sqlDir, 'rollback', '0009_p2b_switch.down.sql')), 'can_write_key'), KEY_WRITE_P2A));
t('Viewer: read-only in every matrix; Department User reads only categories directly', Object.values(KEY_WRITE_P2A).every(r => !r.includes('Viewer')) && Object.entries(KEY_READ).every(([k, r]) => r.includes('Department User') === (k === 'customPlants')));
t('the users key is readable and writable by nobody', !('users' in KEY_READ) && !('users' in KEY_WRITE_P2A) && !/when 'users'/.test(sql['0002_access_helpers.sql']));

// ---- 4b. remaining P2b functions (0007) and notifications (0008) ----
const s7 = strip(sql['0007_p2b_more_functions.sql']), s8 = strip(sql['0008_notifications.sql']);
const fnBody = (src, name) => { const i = src.indexOf(`function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('end $$;', i)); };
const ROLE_GUARD = { 'public.jo_revert': "me.role <> 'Admin'", 'public.jo_delete': "me.role not in ('Admin', 'Assistant Engineer')", 'public.jo_import': "me.role not in ('Admin', 'Assistant Engineer')",
  'public.category_rename': "me.role not in ('Admin', 'Assistant Engineer')", 'public.asset_clear_all': "me.role <> 'Admin'", 'public.employee_set_status': "me.role not in ('Admin', 'Assistant Engineer')",
  'public.employee_save': "me.role <> 'Admin'", 'public.employee_delete': "me.role <> 'Admin'", 'public.employee_import': "me.role <> 'Admin'", 'public.employee_apply_date_rules': "me.role not in ('Admin', 'Assistant Engineer')" };
t('0007: every operation starts from an active profile (private.active_me) and checks the role on the server (same roles as ROLE_CAPS in index.html)',
  Object.entries(ROLE_GUARD).every(([f, g]) => { const b = fnBody(s7, f); return b.includes('private.active_me()') && b.includes(`if ${g} then raise exception 'not allowed'`); }), Object.keys(ROLE_GUARD).filter(f => !fnBody(s7, f).includes(`if ${ROLE_GUARD[f]} then`)));
const capRoles = cap => Object.keys(X.ROLE_CAPS).filter(r => X.ROLE_CAPS[r].includes(cap)).sort().join();
t('0007 role lists equal the app capabilities: jo.revert, jo.delete, jo.import, asset.category.manage, asset.clearAll, emp.statusUpdate, emp.admin',
  capRoles('jo.revert') === 'Admin' && capRoles('jo.delete') === 'Admin,Assistant Engineer' && capRoles('jo.import') === 'Admin,Assistant Engineer' && capRoles('asset.category.manage') === 'Admin,Assistant Engineer'
  && capRoles('asset.clearAll') === 'Admin' && capRoles('emp.statusUpdate') === 'Admin,Assistant Engineer' && capRoles('emp.admin') === 'Admin');
t('0007: employee ADMINISTRATION (save/delete/import: Admin) is separate from STATUS updates (Admin + AE); status takes allow-listed fields and APPENDS one history entry',
  /array\['siteStatus','leaveType','leaveStart','leaveEnd','offsiteStart','offsiteEnd','exitDate'\]/.test(fnBody(s7, 'public.employee_set_status')) && /coalesce\(e -> 'leaveHistory', '\[\]'::jsonb\)\s+\|\| jsonb_build_array/.test(fnBody(s7, 'public.employee_set_status')));
t('0007: import accepts only OPEN / IN PROGRESS / COMPLETED, COMPLETED arrives PENDING, existing job numbers are skipped, control fields are not importable',
  /if st not in \('OPEN', 'IN PROGRESS', 'COMPLETED'\) then/.test(s7) && /case when st = 'COMPLETED' then jsonb_build_object\('approvalStatus', 'PENDING'\)/.test(s7) && /skipped := skipped/.test(s7)
  && !/'approvalStatus'|'approvedBy'|'closedBy'|'requesterId'|'assignedToId'/.test((s7.match(/cols text\[\] := array\[([^\]]*)\]/) || [])[1] || 'x'));
t('0007: clear-all needs Admin + the typed phrase; a direct write can never empty a non-empty dataset (guard trigger)', /p_confirm is distinct from 'DELETE ALL ASSETS'/.test(s7) && /create trigger app_data_no_empty before update on public\.app_data/.test(s7) && /may not be emptied by a direct write/.test(s7));
t('0007: category rename locks the three datasets, refuses duplicates, renames category STRINGS only (assets, job orders, DU categories) — no user id rewritten',
  /order by key for update/.test(s7) && /category already exists/.test(s7) && /update public\.profiles set assigned_categories/.test(s7) && !/legacy_id|requesterId|approvedById|assignedToId/.test(fnBody(s7, 'public.category_rename')));
t('0005/0007: every job-order change calls the lifecycle hook (create, store, import) with the previous status', /perform private\.on_jo_event\(jo, arr -> idx ->> 'status', actor\);/.test(code) && /perform private\.on_jo_event\(jo, null, me\.user_id\);/.test(sql['0005_p2b_job_order_functions.sql']) && /perform private\.on_jo_event\(jo, null, me\.user_id\);/.test(s7));
const { NOTIFY_RULES, NOTIFY_EVENTS } = await import(pathToFileURL(path.join(P2, 'model', 'notifications.mjs')));
const sqlRule = role => { const m = s8.match(new RegExp(`p\\.role (?:in \\(([^)]*)\\)|= '${role}') and ev in \\(([^)]*)\\)`, 'g')) || []; for (const x of m) { const mm = x.match(/p\.role (?:in \(([^)]*)\)|= '([^']+)') and ev in \(([^)]*)\)/); const roles = mm[1] ? [...mm[1].matchAll(/'([^']+)'/g)].map(y => y[1]) : [mm[2]]; if (roles.includes(role)) return [...mm[3].matchAll(/'([^']+)'/g)].map(y => y[1]); } return []; };
t('0008 recipient rules = p2/model/notifications.mjs for all six roles (Viewer receives none)', Object.keys(X.ROLE_CAPS).every(r => same(sqlRule(r), NOTIFY_RULES[r] || [])) && NOTIFY_RULES.Viewer.length === 0, Object.fromEntries(Object.keys(X.ROLE_CAPS).map(r => [r, sqlRule(r)])));
t('0008 event list = model; events unique per (job_no, event, seq); notifications unique per (event, recipient)', same(listIn(s8, /event in \(([^)]*)\)\),/), NOTIFY_EVENTS) && /unique \(job_no, event, seq\)/.test(s8) && /unique \(event_id, recipient\)/.test(s8) && /on conflict \(event_id, recipient\) do nothing/.test(s8));
t('0008: recipients come from profiles (role, section, legacy_id, active), never from a parameter; JCE needs a section match; DU needs requesterId = legacy_id',
  /from public\.profiles p\s+where p\.active and/.test(s8) && /lower\(btrim\(jo ->> 'section'\)\) = lower\(btrim\(coalesce\(p\.section, ''\)\)\)/.test(s8) && /\(jo ->> 'requesterId'\)::integer = p\.legacy_id/.test(s8) && !/p_recipient/.test(s8));
t('0008: no direct table access; my_notifications returns only the caller\'s rows; mark-read changes only the caller\'s rows',
  /revoke all on public\.notifications from public, anon, authenticated;/.test(s8) && /revoke all on public\.jo_events from public, anon, authenticated;/.test(s8) && /where n\.recipient = me\.user_id/.test(s8) && /where recipient = me\.user_id and read_at is null/.test(s8));
t('the old 0006 switch is gone (renamed 0009, applied last) and 0009 closes direct jobOrders AND employees writes', !fwd.includes('0006_p2b_switch.sql') && /else false\s+-- jobOrders, employees: functions only/.test(sql['0009_p2b_switch.sql']));

// ---- 5. rollback coverage ----
const rbAll = rb.map(f => read(path.join(sqlDir, 'rollback', f))).join('\n');
const created = [...code.matchAll(/create function ([\w.]+)\(/g)].map(m => m[1]).filter(n => n !== 'private.can_write_key' || true);
t('every created function and table is dropped by a rollback file', created.every(n => rbAll.includes('drop function if exists ' + n + '(')) && tables.every(tb => rbAll.includes('drop table if exists ' + tb)),
  [...created.filter(n => !rbAll.includes('drop function if exists ' + n + '(')), ...tables.filter(tb => !rbAll.includes('drop table if exists ' + tb))]);
const rb3 = read(path.join(sqlDir, 'rollback', '0003_app_data_rls_p2a.down.sql'));
t('the app_data rollback restores exactly what 0003 RECORDED (policies, table and column grants, RLS flags) and refuses without a record',
  /select \* into s from private\.pre_lockdown where id = 1;/.test(rb3) && /no recorded pre-lockdown state: rollback refused/.test(rb3) && /create policy %I on public\.app_data as %s for %s to %s/.test(rb3)
  && /aclexplode\(s\.table_acl::aclitem\[\]\)/.test(rb3) && /jsonb_each\(s\.column_acl\)/.test(rb3) && /disable row level security/.test(rb3));
t('0003 assumes nothing about current policies: it RECORDS them (with grants and RLS flags) and then drops every one',
  /insert into private\.pre_lockdown \(rls_enabled, rls_forced, table_acl, column_acl, policies\)/.test(sql['0003_app_data_rls_p2a.sql'])
  && /for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'app_data' loop\s+execute format\('drop policy %I on public\.app_data', p\.policyname\);/.test(sql['0003_app_data_rls_p2a.sql']));

// ---- 6. secrets, personal data, isolation from the running app ----
const allFiles = [...files, ...walk(path.join(ROOT, 'tests', 'p2'))];
const txt = allFiles.map(f => [f, read(f)]);
t('no JWT-like value, no secret key value, no connection string in any draft or test', txt.every(([, s]) => !/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(s) && !/sb_secret_[A-Za-z0-9]{8,}/.test(s) && !/postgres(ql)?:\/\/[^\s'"]*:[^\s'"]*@/.test(s)),
  txt.filter(([, s]) => /eyJ[A-Za-z0-9_-]{20,}\./.test(s)).map(([f]) => f));
t('the service role key is read from the environment only, and only in server code (functions/_shared/deno.ts)',
  txt.filter(([, s]) => /SUPABASE_SERVICE_ROLE_KEY/.test(s)).every(([f, s]) => (f.endsWith('deno.ts') && /env\('SUPABASE_SERVICE_ROLE_KEY'\)/.test(s)) || f.endsWith('.test.mjs') || f.endsWith('README.md')));
const emails = txt.flatMap(([f, s]) => [...s.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map(m => [f, m[0]]));
t('no real email address in drafts or tests (only example.invalid / .test placeholders)', emails.every(([, e]) => /@(example\.(invalid|com|org)|[a-z0-9.-]*\.(invalid|test))$/i.test(e)), emails.filter(([, e]) => !/@(example\.(invalid|com|org)|[a-z0-9.-]*\.(invalid|test))$/i.test(e)).map(([f, e]) => path.basename(f) + ': ' + e.replace(/^[^@]*/, '***')));
// (comments in index.html may name the draft files as documentation; what must never happen is loading or calling them)
const htmlCode = html.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
// The app is WIRED to the P2 backend: it loads no file from p2/ (server code is never served), and every server function
// it calls exists in p2/sql with exactly those argument names (no required argument missing); every Edge Function exists.
t('index.html loads no file from p2/ (server code is never served to the browser)', !/<script[^>]*p2\/|import\([^)]*p2\/|from\s+['"][^'"]*p2\//.test(html));
{
  const allSql = fwd.map(f => sql[f]).join('\n');
  const sqlFns = {};
  for (const m of allSql.matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\)/g)) sqlFns[m[1]] = m[2].split(',').map(x => x.trim()).filter(Boolean).map(x => ({ n: x.split(/\s+/)[0], opt: /default/.test(x) }));
  const calls = [...htmlCode.matchAll(/server(?:Change|Call)\('(\w+)'(?:, (\{[^}]*\}))?/g)].map(m => ({ fn: m[1], args: m[2] ? [...m[2].matchAll(/(p_\w+):/g)].map(x => x[1]) : [] }));
  const bad = calls.filter(c => !sqlFns[c.fn] || c.args.some(x => !sqlFns[c.fn].some(p => p.n === x)) || sqlFns[c.fn].some(p => !p.opt && !c.args.includes(p.n)));
  t('every server function the app calls exists in p2/sql with exactly those argument names; no required argument is missing', calls.length >= 20 && bad.length === 0, bad);
  const direct = [...htmlCode.matchAll(/\brpc\(\s*['"]?([\w\[\]]+)/g)].map(m => m[1]);
  t('direct rpc() calls only for the staging marker and the Department User scoped lists; everything else through serverCall', direct.every(n => ['environment_marker', 'scoped[k]', 'fn'].includes(n)), direct);
  const efns = [...new Set([...htmlCode.matchAll(/serverFunction\('([\w-]+)'/g)].map(m => m[1]))].sort();
  t('every Edge Function the app calls exists in p2/functions', JSON.stringify(efns) === JSON.stringify(['admin-users', 'complete-password-change', 'complete-recovery', 'request-recovery', 'verify-recovery-email'])
    && efns.every(n => fs.existsSync(path.join(ROOT, 'p2', 'functions', n, 'index.ts'))), efns);
}
t('the browser adapter is disabled unless enabled === true, keeps sessions in memory, and refuses secret keys',
  /if \(opts\.enabled !== true\)/.test(read(path.join(P2, 'client', 'supabase-auth-adapter.mjs'))) && /persistSession: false/.test(read(path.join(P2, 'client', 'supabase-auth-adapter.mjs'))) && /a secret key must never be used in the browser/.test(read(path.join(P2, 'client', 'supabase-auth-adapter.mjs'))));
const vi = read(path.join(ROOT, '.vercelignore'));
t('.vercelignore is an allowlist (only index.html and vercel.json are deployed), so p2/ is never served', /^\/\*$/m.test(vi) && /^!index\.html$/m.test(vi) && /^!vercel\.json$/m.test(vi) && !/^!p2/m.test(vi));
t('the recovery mail is sent only to the verified recovery address, never to the internal sign-in address',
  /to: p\.recovery_email/.test(read(path.join(P2, 'functions', '_shared', 'handlers.mjs'))) && /p\.recovery_email_verified_at && isUsableRecoveryEmail/.test(read(path.join(P2, 'functions', '_shared', 'handlers.mjs'))));

console.log(`\nP2 static tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
