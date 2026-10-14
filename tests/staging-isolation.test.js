// Offline isolation tests for the PROPOSED config switch. Fake URLs/keys only. No network.
// Runs the real guard script from the working index.html (sanitized in memory).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { sanitizedIndex, ROOT } = require('./lib/sanitize');
const html = sanitizedIndex(process.argv[2]).replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else fail++; if (!cond || process.env.V) console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  -> ' + info : '')); }

// ---------- extract guard script ----------
const gStart = html.indexOf('<!-- ENVIRONMENT GUARD');
const sOpen = html.indexOf('<script>', gStart) + '<script>'.length;
const sClose = html.indexOf('</script>', sOpen);
const guardJs = html.slice(sOpen, sClose);

function loadGuard(loc) {
  const writes = [];
  const win = {};
  const ctx = {
    window: win, document: { write: s => writes.push(s) },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    Promise, JSON, Array, Object,
  };
  win.location = loc;
  vm.createContext(ctx);
  vm.runInContext(guardJs, ctx);
  return { win, writes, ctx };
}

// ---------- fixtures (FAKE) ----------
const PROD_REF = 'aaaaaaaaaaaaaaaaaaaa', STG_REF = 'bbbbbbbbbbbbbbbbbbbb', OTHER_REF = 'cccccccccccccccccccc';
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = p => enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc(p) + '.fakesig';
const PROD = { url: `https://${PROD_REF}.supabase.co`, anonKey: jwt({ role: 'anon', ref: PROD_REF }) };
const STG = { url: `https://${STG_REF}.supabase.co`, anonKey: jwt({ role: 'anon', ref: STG_REF }) };
const PROD_HOSTS = ['vincent-mauve.vercel.app'];
const L = (protocol, hostname) => ({ protocol, hostname });

if (process.env.V) console.log('--- A. guard script structure ---');
const g = loadGuard(L('https:', 'vincent-mauve.vercel.app'));
t('A1 CMMS_resolveEnv defined', typeof g.win.CMMS_resolveEnv === 'function');
t('A2 CMMS_envGate defined', typeof g.win.CMMS_envGate === 'function');
const orig = g.win.CMMS_resolveEnv;
try { vm.runInContext('window.CMMS_resolveEnv = function(){ return {name:"production"}; };', g.ctx); } catch (e) { /* strict-mode TypeError is fine */ }
t('A3 later script (e.g. staging-config.js) cannot overwrite resolver', g.win.CMMS_resolveEnv === orig);
try { vm.runInContext('delete window.CMMS_envGate;', g.ctx); } catch (e) {}
t('A4 gate cannot be deleted', typeof g.win.CMMS_envGate === 'function');
t('A5 guard has no network calls (fetch/XMLHttpRequest/createClient)', !/fetch\(|XMLHttpRequest|createClient/.test(guardJs));

if (process.env.V) console.log('--- B. staging-config.js loader (which hosts request the local file) ---');
const loaderCases = [
  ['B1 production https', L('https:', 'vincent-mauve.vercel.app'), false],
  ['B2 production http', L('http:', 'vincent-mauve.vercel.app'), false],
  ['B3 vercel preview', L('https:', 'vincent-git-feature-x.vercel.app'), false],
  ['B4 look-alike', L('https:', 'vincent-mauve.vercel.app.evil.example'), false],
  ['B5 unknown host', L('https:', 'example.com'), false],
  ['B6 localhost', L('http:', 'localhost'), true],
  ['B7 127.0.0.1', L('http:', '127.0.0.1'), true],
  ['B8 [::1]', L('http:', '[::1]'), true],
  ['B9 file://', L('file:', ''), true],
  ['B10 LAN IP (not loopback)', L('http:', '192.168.1.10'), false],
];
for (const [n, loc, expect] of loaderCases) {
  const w = loadGuard(loc).writes;
  t(n + (expect ? ' -> loads staging-config.js' : ' -> does NOT load it'), (w.length === 1 && w[0] === '<script src="staging-config.js"></script>') === expect && (expect || w.length === 0));
}

if (process.env.V) console.log('--- C. resolver truth table ---');
const R = g.win.CMMS_resolveEnv;
const cases = [
  ['C1 exact prod host over https', L('https:', 'vincent-mauve.vercel.app'), STG, 'production'],
  ['C2 exact prod host, no staging cfg', L('https:', 'vincent-mauve.vercel.app'), undefined, 'production'],
  ['C3 prod host over http, no cfg', L('http:', 'vincent-mauve.vercel.app'), undefined, 'blocked'],
  ['C4 prod host over http + staging cfg', L('http:', 'vincent-mauve.vercel.app'), STG, 'staging'],
  ['C5 uppercase host (not exact)', L('https:', 'VINCENT-MAUVE.VERCEL.APP'), undefined, 'blocked'],
  ['C6 trailing-dot host', L('https:', 'vincent-mauve.vercel.app.'), undefined, 'blocked'],
  ['C7 look-alike suffix', L('https:', 'vincent-mauve.vercel.app.evil.example'), undefined, 'blocked'],
  ['C8 look-alike prefix', L('https:', 'x-vincent-mauve.vercel.app'), undefined, 'blocked'],
  ['C9 subdomain of prod', L('https:', 'www.vincent-mauve.vercel.app'), undefined, 'blocked'],
  ['C10 vercel preview, no cfg', L('https:', 'vincent-git-feature-x.vercel.app'), undefined, 'blocked'],
  ['C11 unknown host, no cfg', L('https:', 'example.com'), undefined, 'blocked'],
  ['C12 localhost, no cfg', L('http:', 'localhost'), undefined, 'blocked'],
  ['C13 file://, no cfg', L('file:', ''), undefined, 'blocked'],
  ['C14 localhost + valid staging', L('http:', 'localhost'), STG, 'staging'],
  ['C15 file:// + valid staging', L('file:', ''), STG, 'staging'],
  ['C16 [::1] + valid staging', L('http:', '[::1]'), STG, 'staging'],
  ['C17 staging url = prod url', L('http:', 'localhost'), { url: PROD.url, anonKey: STG.anonKey }, 'blocked'],
  ['C18 staging url = prod url + "/"', L('http:', 'localhost'), { url: PROD.url + '/', anonKey: STG.anonKey }, 'blocked'],
  ['C19 staging key = prod key', L('http:', 'localhost'), { url: STG.url, anonKey: PROD.anonKey }, 'blocked'],
  ['C20 prod key with other url', L('http:', 'localhost'), { url: `https://${OTHER_REF}.supabase.co`, anonKey: PROD.anonKey }, 'blocked'],
  ['C21 key ref mismatch', L('http:', 'localhost'), { url: STG.url, anonKey: jwt({ role: 'anon', ref: OTHER_REF }) }, 'blocked'],
  ['C22 key without ref claim', L('http:', 'localhost'), { url: STG.url, anonKey: jwt({ role: 'anon' }) }, 'blocked'],
  ['C23 service_role JWT', L('http:', 'localhost'), { url: STG.url, anonKey: jwt({ role: 'service_role', ref: STG_REF }) }, 'blocked'],
  ['C24 sb_secret_ key', L('http:', 'localhost'), { url: STG.url, anonKey: 'sb_secret_fake' }, 'blocked'],
  ['C25 malformed sb_publishable_ key', L('http:', 'localhost'), { url: STG.url, anonKey: 'sb_publishable_fake' }, 'blocked'],
  ['C25b well-formed sb_publishable_ key + staging url', L('http:', 'localhost'), { url: STG.url, anonKey: 'sb_publishable_AbCdEf0123456789_xyz' }, 'staging'],
  ['C25c publishable key + PROD url', L('http:', 'localhost'), { url: PROD.url, anonKey: 'sb_publishable_AbCdEf0123456789_xyz' }, 'blocked'],
  ['C25d publishable key on prod host over https -> production (key ignored)', L('https:', 'vincent-mauve.vercel.app'), { url: STG.url, anonKey: 'sb_publishable_AbCdEf0123456789_xyz' }, 'production'],
  ['C25e sb_secret_ disguised with publishable chars', L('http:', 'localhost'), { url: STG.url, anonKey: 'sb_secret_AbCdEf0123456789_xyz' }, 'blocked'],
  ['C26 template placeholders', L('http:', 'localhost'), { url: 'https://YOUR_STAGING_PROJECT_REF.supabase.co', anonKey: 'YOUR_STAGING_ANON_KEY' }, 'blocked'],
  ['C27 http staging url', L('http:', 'localhost'), { url: `http://${STG_REF}.supabase.co`, anonKey: STG.anonKey }, 'blocked'],
  ['C28 staging url with path', L('http:', 'localhost'), { url: `https://${STG_REF}.supabase.co/rest/v1`, anonKey: STG.anonKey }, 'blocked'],
  ['C29 staging url with port', L('http:', 'localhost'), { url: `https://${STG_REF}.supabase.co:443`, anonKey: STG.anonKey }, 'blocked'],
  ['C30 look-alike supabase domain', L('http:', 'localhost'), { url: `https://${STG_REF}.supabase.co.evil.example`, anonKey: STG.anonKey }, 'blocked'],
  ['C31 uppercase ref', L('http:', 'localhost'), { url: `https://${STG_REF.toUpperCase()}.supabase.co`, anonKey: STG.anonKey }, 'blocked'],
  ['C32 empty key', L('http:', 'localhost'), { url: STG.url, anonKey: '' }, 'blocked'],
  ['C33 garbage key', L('http:', 'localhost'), { url: STG.url, anonKey: 'abc' }, 'blocked'],
  ['C34 config is a string', L('http:', 'localhost'), 'https://' + STG_REF + '.supabase.co', 'blocked'],
  ['C35 config is null', L('http:', 'localhost'), null, 'blocked'],
  ['C36 location missing', undefined, STG, 'staging'],
  ['C37 empty PROD_HOSTS on prod host', L('https:', 'vincent-mauve.vercel.app'), undefined, 'blocked', []],
];
for (const [n, loc, cfg, expect, hosts] of cases) {
  const r = R(loc, PROD, cfg, hosts || PROD_HOSTS);
  const isExactProd = loc && loc.protocol === 'https:' && (hosts || PROD_HOSTS).includes(loc.hostname);
  const leak = (r.url === PROD.url || r.anonKey === PROD.anonKey) && !isExactProd;
  t(n, r.name === expect && !leak, r.name + (r.reason ? ' (' + r.reason + ')' : '') + (leak ? ' !!PRODUCTION LEAK' : ''));
}

if (process.env.V) console.log('--- D. environment gate (marker check) with spy clients ---');
function spyClient(result, opts = {}) {
  const calls = [];
  const q = {
    select(c) { calls.push(['select', c]); return q; },
    eq(c, v) { calls.push(['eq', c, v]); return q; },
    maybeSingle() { calls.push(['maybeSingle']); return opts.reject ? Promise.reject(new Error('net')) : Promise.resolve(result); },
    in() { calls.push(['in']); return q; },
    upsert() { calls.push(['upsert']); return Promise.resolve({}); },
    insert() { calls.push(['insert']); return Promise.resolve({}); },
    update() { calls.push(['update']); return Promise.resolve({}); },
    delete() { calls.push(['delete']); return Promise.resolve({}); },
  };
  return { calls, from(tb) { calls.push(['from', tb]); return q; }, channel() { calls.push(['channel']); return {}; },
           rpc(fn, args) { calls.push(['rpc', fn].concat(args === undefined ? [] : [args])); return opts.reject ? Promise.reject(new Error('net')) : Promise.resolve(result); } };
}
const GATE = g.win.CMMS_envGate;
const stagingEnv = { name: 'staging', url: STG.url, anonKey: STG.anonKey };
const writesIn = c => c.calls.some(x => ['upsert', 'insert', 'update', 'delete', 'channel'].includes(x[0]) || (x[0] === 'rpc' && x[1] !== 'environment_marker'));
(async () => {
  let c, r;
  c = spyClient({ data: { env: 'staging' }, error: null }); r = await GATE(stagingEnv, c);
  t('D1 marker ok -> start', r.ok === true);
  t('D2 marker check is exactly one call of the server function environment_marker (no table read, no arguments)', JSON.stringify(c.calls) === JSON.stringify([['rpc', 'environment_marker']]));
  t('D3 gate performs no write/subscription', !writesIn(c));
  c = spyClient({ data: null, error: null }); r = await GATE(stagingEnv, c);
  t('D4 marker row missing -> blocked', r.ok === false, r.reason);
  c = spyClient({ data: { env: 'production' }, error: null }); r = await GATE(stagingEnv, c);
  t('D5 marker says production -> blocked', r.ok === false, r.reason);
  c = spyClient({ data: 'staging', error: null }); r = await GATE(stagingEnv, c);
  t('D6 marker wrong shape -> blocked', r.ok === false, r.reason);
  c = spyClient({ data: null, error: { message: 'permission denied' } }); r = await GATE(stagingEnv, c);
  t('D7 marker read error -> blocked', r.ok === false, r.reason);
  c = spyClient(null, { reject: true }); r = await GATE(stagingEnv, c);
  t('D8 network failure -> blocked', r.ok === false, r.reason);
  c = spyClient({}); r = await GATE({ name: 'blocked', reason: 'x' }, c);
  t('D9 blocked env -> no client call at all', r.ok === false && c.calls.length === 0);
  r = await GATE(stagingEnv, null);
  t('D10 no client -> blocked', r.ok === false);
  c = spyClient({}); r = await GATE({ name: 'production', url: PROD.url, anonKey: PROD.anonKey }, c);
  t('D11 production -> ok with no marker query (behavior unchanged)', r.ok === true && c.calls.length === 0);
  r = await GATE(undefined, null);
  t('D12 undefined env -> blocked', r.ok === false);

  if (process.env.V) console.log('--- E. static checks on the patched app script (JSX; cannot run without Babel) ---');
  const bStart = html.indexOf('<script type="text/babel">');
  const app = html.slice(bStart);
  const lines = app.split('\n');
  const idx = re => lines.map((l, i) => re.test(l) ? i : -1).filter(i => i >= 0);
  t('E1 guard script precedes the app script', gStart > 0 && gStart < bStart);
  const cc = idx(/createClient\(/);
  t('E2 exactly one createClient, only when not blocked; the session is kept in memory only (never in browser storage)', cc.length === 1 && /ENV\.name === 'blocked' \? null : window\.supabase\.createClient\(ENV\.url, ENV\.anonKey,$/.test(lines[cc[0]].replace(/\r$/, ''))
    && /\{auth: \{persistSession: false, autoRefreshToken: true, detectSessionInUrl: false\}\}\);/.test(lines[cc[0] + 1]));
  t('E3 no createClient with SUPABASE_URL directly', !/createClient\(SUPABASE_URL/.test(app));
  const dbs = idx(/^async function dbSave/);
  t('E4 dbSave first statement refuses when !sb || !envReady', dbs.length === 1 && /if \(!sb \|\| !envReady\)[^]*return new Error/.test(lines[dbs[0] + 1]));
  const appStart = idx(/^function App\(\)/)[0], appEnd = idx(/^function NavItem/)[0];
  // Backend integration: the client reaches Supabase only from App() (mounted after the gate) or from four helpers that refuse
  // before the gate passed and (except the sign-in function call) before a sign-in.
  const sbUses = idx(/\bsb\.(from|channel|removeChannel|rpc|auth|functions)\b/);
  const body = name => { const s0 = idx(new RegExp('^async function ' + name + '\\('))[0]; return s0 === undefined ? null : [s0, s0 + lines.slice(s0).findIndex(l => /^\}/.test(l))]; };
  const helpers = ['dbSave', 'serverCall', 'serverFunction', 'readDatasets'].map(body);
  const outside = sbUses.filter(i => !(i > appStart && i < appEnd) && !helpers.some(h => h && i > h[0] && i < h[1]));
  t('E5 every Supabase use is inside App() or the four backend helpers (App mounts only after the gate)', helpers.every(Boolean) && outside.length === 0 && sbUses.length >= 8, 'uses=' + sbUses.length + ' outside=' + outside.map(i => i + 1));
  t('E5b the helpers refuse before the gate passed; reads/changes also before sign-in', helpers.every(Boolean)
    && /if \(!sb \|\| !envReady\) return \{status: 0/.test(lines[helpers[2][0] + 1])
    && /if \(!sb \|\| !envReady \|\| !writeGate\.signedIn\) return \{error/.test(lines[helpers[1][0] + 1])
    && /if \(!sb \|\| !writeGate\.signedIn\) return \{error/.test(lines[helpers[3][0] + 1]));
  t('E6 the browser never seeds, inserts or upserts: no seed action, no insert/upsert/delete call anywhere, an empty read is a failure',
    !/plan\.action === 'seed'|action: 'seed'|\.upsert\(|\.insert\(|\.delete\(\)/.test(app) && /if \(rows\.length === 0\) return \{action: 'fail', reason: 'empty'\};/.test(app));
  // N2: there are no built-in accounts at all, and no code path writes the users list except account management
  const resetBody = app.slice(app.indexOf('function resetData()'), app.indexOf('function addCustomPlant('));
  t('E7 (N2) no built-in default accounts; the browser never writes the users dataset (accounts are server-side); Reset Data names no accounts',
    !/DEFAULT_USERS/.test(html) && !/dbSave\('users'|saveNow\('users'|persistUsers\(/.test(app) && !/'users'/.test(resetBody)
    && /const DIRECT_WRITE_KEYS = Object\.freeze\(\['assets','pm','customPlants'\]\);/.test(app));
  // N2: production-host refusal of the seed path. A staging config carrying the seed opt-in does not change the production
  // resolution, the app reads the opt-in only when ENV is staging, and dbSave honours {seed:true} only in staging.
  const seedCfg = Object.assign({}, STG, { seedEmptyDatabase: true });
  t('E7b (N2) production host + a staging config with seedEmptyDatabase → still "production"; the app ignores the old seed opt-in; dbSave has no bypass',
    R(L('https:', 'vincent-mauve.vercel.app'), PROD, seedCfg, PROD_HOSTS).name === 'production'
    && !/seedEmptyDatabase|seedOptIn|seedAllowed/.test(app)
    && /if \(!writeGate\.signedIn\) \{[^}]*return new Error\('not signed in'\); \}/.test(app));  const renders = idx(/render\(.*<App \/>/);
  t('E8 App is rendered in exactly two places', renders.length === 2, 'found ' + renders.length);
  t('E9 each App render is directly preceded by envReady = true', renders.every(i => /^\s*envReady = true;\s*$/.test(lines[i - 1])));
  const prodBranch = idx(/^if \(ENV\.name === 'production'\) \{$/);
  t('E10 production branch renders App synchronously (no marker query)', prodBranch.length === 1 && renders[0] === prodBranch[0] + 2);
  const gateBranch = idx(/CMMS_envGate\(ENV, sb\)\.then/);
  t('E11 non-production App render happens only inside the gate callback when r.ok', gateBranch.length === 1 && renders[1] > gateBranch[0] && /if \(r\.ok\)/.test(lines[renders[1] - 2]));
  t('E12 STAGING banner + [STAGING] title in non-production branch', /document\.title = '\[STAGING\] ' \+ document\.title/.test(app) && (app.match(/<StagingBanner\/>/g) || []).length === 3);
  t('E13 PROD_HOSTS is a frozen literal in app scope (not read from window)', /const PROD_HOSTS = Object\.freeze\(\[/.test(app) && !/window\.CMMS_PROD_HOSTS|window\.PROD_HOSTS/.test(html));
  t('E14 resolver receives production values from app constants, not from window', /CMMS_resolveEnv\(window\.location, \{url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY\}, window\.CMMS_STAGING_CONFIG, PROD_HOSTS\)/.test(app));
  t('E15 no service_role/secret key text in the patch', !/service_role'|sb_secret_[A-Za-z0-9]{8,}/.test(html.replace(guardJs, '')));
  t('E16 patched file still contains exactly one SUPABASE_URL and one SUPABASE_ANON_KEY definition', (app.match(/const SUPABASE_URL =/g) || []).length === 1 && (app.match(/const SUPABASE_ANON_KEY =/g) || []).length === 1);

  if (process.env.V) console.log('--- F. template file ---');
  const tmpl = fs.readFileSync(path.join(ROOT, 'staging', 'staging-config.example.js'), 'utf8');
  const tw = { };
  vm.runInNewContext(tmpl, { window: tw });
  const tr = R(L('http:', 'localhost'), PROD, tw.CMMS_STAGING_CONFIG, PROD_HOSTS);
  t('F1 unedited template keeps the app blocked', tr.name === 'blocked', tr.reason);
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  t('F2 .gitignore excludes staging-config.js', /^staging-config\.js$/m.test(gi));

  // ---- AUTH adapter selection (Phase 2B-1) ----
  {
    const aS = html.indexOf('// ─── AUTH (P2: Supabase Auth'), aE = html.indexOf('function sortByAssetNum(arr){');
    t('AUTH block present', aS > 0 && aE > aS);
    const actx = {}; vm.createContext(actx);
    vm.runInContext(html.slice(aS, aE) + '\nthis.A = { authAdapterFor };', actx);
    const { authAdapterFor } = actx.A;
    // Realistic: a staging config can only exist where the guard's loader requests staging-config.js (loopback hosts / file://).
    // fileExists = whether a local staging-config.js would be found if requested.
    const cases = [
      ['AUTH1 production host -> production adapter (loader never requests the local mock config)', L('https:', 'vincent-mauve.vercel.app'), true, 'production'],
      ['AUTH2 production host over http -> no adapter', L('http:', 'vincent-mauve.vercel.app'), true, null],
      ['AUTH3 other *.vercel.app (preview) -> no adapter', L('https:', 'vincent-git-x.vercel.app'), true, null],
      ['AUTH4 localhost with a local staging config -> staging (mock) adapter', L('http:', 'localhost'), true, 'staging'],
      ['AUTH5 localhost without a staging config -> no adapter', L('http:', 'localhost'), false, null],
      ['AUTH6 unknown https host -> no adapter', L('https:', 'example.com'), true, null],
    ];
    for (const [name, loc, fileExists, exp] of cases) {
      const requested = loadGuard(loc).writes.some(w => w.includes('staging-config.js'));
      const env = R(loc, PROD, requested && fileExists ? STG : undefined, PROD_HOSTS); const ad = authAdapterFor(env && env.name);
      t(name, exp === null ? ad === null : !!ad && ad.env === exp && ad.name === 'supabase-auth', JSON.stringify({ requested, env: env && env.name, ad }));
    }
    const prodEnv = R(L('https:', 'vincent-mauve.vercel.app'), PROD, STG, PROD_HOSTS);
    t('AUTH7 production adapter talks to the production project only (never the staging/mock URL)', prodEnv.name === 'production' && prodEnv.url === PROD.url && prodEnv.url !== STG.url);
  }

  console.log(`\nStaging isolation: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
