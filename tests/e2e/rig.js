// Local E2E rig: sanitized copy of the WORKING index.html + HTTPS local backend (backend-mock.js: the real P2 SQL on PGlite +
// the real P2 Edge Function logic behind emulated PostgREST / Auth / Functions endpoints; synthetic data)
// + headless Edge over the DevTools protocol. Production is unreachable: the copy has no production URL/key,
// the app runs on 127.0.0.1 (never a production host), and every *.supabase.co except the fake staging ref is
// mapped to NOTFOUND. The guard is not modified: the app reaches the mock through its normal staging path
// (staging-config.js -> resolver -> __environment marker gate).
'use strict';
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http'), https = require('https'), crypto = require('crypto'), cp = require('child_process');
const D = path.join(os.tmpdir(), 'cmms-tests', 'e2e');   // generated site, cert, browser profiles: never in the repo
const { sanitizedIndex } = require('../lib/sanitize');
const FAKE_REF = 'bbbbbbbbbbbbbbbbbbbb', FAKE_HOST = FAKE_REF + '.supabase.co';
// Automated tests run the mock on 127.0.0.2:443 so they never collide with an open interactive preview (serve.js, 127.0.0.1:443).
const TEST_MOCK_IP = '127.0.0.2';
const SITE_PORT = 8770, CDP_PORT = 9400 + Math.floor(Math.random() * 500);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// ---------- build sanitized site ----------
function buildSite() {
  const san = sanitizedIndex(process.env.SRC);   // SRC: optional other build, e.g. a pre-change copy for a negative control
  if (/eyJ[A-Za-z0-9_-]{20,}/.test(san) || (san.match(/\.supabase\.co'/g) || []).length > 2) throw new Error('sanitize incomplete');
  fs.mkdirSync(path.join(D, 'site'), { recursive: true });
  fs.writeFileSync(path.join(D, 'site', 'index.html'), san);
  writeStagingConfig();
  return san;
}
// extra: additional staging-config.js fields for a test. signInDomain: the (synthetic) Supabase Auth sign-in domain.
function writeStagingConfig(extra = {}) {
  const cfg = Object.assign({ url: `https://${FAKE_HOST}`, anonKey: 'sb_publishable_E2Efake0123456789abcdef', signInDomain: SIGN_IN_DOMAIN }, extra);
  fs.writeFileSync(path.join(D, 'site', 'staging-config.js'), `window.CMMS_STAGING_CONFIG = ${JSON.stringify(cfg)};\n`);
}

// ---------- synthetic seed ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const PASS = { t_admin: 'Synthetic-Admin-1', t_ae: 'Synthetic-AE-1', t_se: 'Synthetic-SE-1',
               t_jce: 'Synthetic-JCE-1', t_du: 'Synthetic-DU-1', t_jce_el: 'Synthetic-JCE-EL-1', t_viewer: 'Synthetic-Viewer-1', t_jce_off: 'Synthetic-Unused-1' };
// Sign-in is by Employee ID (Supabase Auth). Synthetic IDs for the synthetic accounts.
const EMP = { t_admin: 'TA001', t_ae: 'TA002', t_se: 'TS003', t_jce: 'TJ005', t_du: 'TD006', t_jce_off: 'TJ007', t_jce_el: 'TJ009', t_viewer: 'VW001' };
// Extended seed: + Department User (Cement Plant, category plants[1]) and an INACTIVE Job Card Editor (not eligible for work
// assignment), + three Cement Plant JOs on asset 5003 (two raised by the DU, one by someone else).
function seed2(plants) {
  const d = seed(plants);
  d.users.push(
    { id: 6, username: 't_du', fullName: 'Test DU Cement', role: 'Department User', email: 'du@example.invalid', active: true, password: sha(PASS.t_du),
      department: 'Cement Plant', assignedCategories: [plants[1]] },
    { id: 7, username: 't_jce_off', fullName: 'Test JCE Inactive', role: 'Job Card Editor', email: 'jceoff@example.invalid', active: false, section: 'Electrical', password: sha('Synthetic-Unused-1') });
  // (A Job Card Editor WITHOUT a section cannot exist: the server refuses such an account, p2/sql 0001.)
  const J = (jobNo, status, extra) => ({ ...d.jobOrders[0], jobNo, status, assetNum: '5003', assetDesc: 'Test Mixer', assetCategory: plants[1], dept: 'Cement Plant',
    problem: 'Synthetic problem ' + jobNo, legacyField: 'keep-' + jobNo, ...extra });
  d.jobOrders.push(J('JO-9006', 'OPEN', { requesterId: 6, requester: 'Test DU Cement' }), J('JO-9007', 'OPEN', { requesterId: 99, requester: 'Someone Else' }),
                   J('JO-9008', 'IN PROGRESS', { requesterId: 6, requester: 'Test DU Cement' }));
  return d;
}
function seed(plants) {
  const A = (num, plant, desc, status) => ({ num, plant, desc, code: 'C' + num, model: 'M', cap: '', reg: '', eng: '', serial: 'S' + num, loc: 'Yard', status });
  const J = (jobNo, status, extra = {}) => ({ jobNo, date: '2026-10-01', assetNum: '5001', assetDesc: 'Test Pump', assetCategory: plants[0], location: 'Yard',
    eqcode: 'C5001', dept: 'Engineering', requester: 'Synthetic Requester', priority: 'High', repairType: 'Planned', problem: 'Synthetic problem ' + jobNo,
    status, target: '', section: '', parts: [], legacyField: 'keep-' + jobNo, ...extra });
  return {
    __environment: { env: 'staging' },
    users: [
      { id: 1, username: 't_admin', fullName: 'Test Admin', role: 'Admin', email: 'admin@example.invalid', active: true, password: sha(PASS.t_admin) },
      { id: 2, username: 't_ae', fullName: 'Test AE', role: 'Assistant Engineer', email: 'ae@example.invalid', active: true, password: sha(PASS.t_ae) },
      { id: 3, username: 't_se', fullName: 'Test SE', role: 'Senior Engineer', email: 'se@example.invalid', active: true, password: sha(PASS.t_se) },
      { id: 5, username: 't_jce', fullName: 'Test JCE', role: 'Job Card Editor', email: 'jce@example.invalid', active: true, section: 'Mechanical', password: sha(PASS.t_jce) },
    ],
    assets: [A('5001', plants[0], 'Test Pump', 'OPERATIONAL'), A('5002', plants[0], 'Test Valve', 'OPERATIONAL'), A('5003', plants[1], 'Test Mixer', 'BREAKDOWN'),
             A('5004', plants[2], 'Test Tank', 'OPERATIONAL'), A('5005', plants[3], 'Test Generator', 'UNDER MAINTENANCE'), A('5006', plants[4], 'Test Press', 'OPERATIONAL')],
    jobOrders: [J('JO-9001', 'OPEN'), J('JO-9002', 'IN PROGRESS'), J('JO-9003', 'COMPLETED'),
                J('JO-9004', 'CLOSED', { closedBy: 'Synthetic Closer', closerDesignation: 'X', closedDate: '2026-10-02' })],
    pm: [{ id: 'pm-001', assetNum: '5001', assetDesc: 'Test Pump', category: plants[0], location: 'Yard', frequency: 'Monthly', lastService: '2026-09-01', nextService: '2026-10-01', notes: '', serviceHistory: [] },
         { id: 'pm-002', assetNum: '5004', assetDesc: 'Test Tank', category: plants[2], location: 'Yard', frequency: 'Quarterly', lastService: '2026-08-01', nextService: '2026-11-01', notes: '', serviceHistory: [] }],
    employees: [{ empId: 'E901', name: 'Synthetic Person A', designation: 'Technician', section: 'Mech', nationality: 'X', siteStatus: 'ON DUTY' },
                { empId: 'E902', name: 'Synthetic Person B', designation: 'Electrician', section: 'Elec', nationality: 'X', siteStatus: 'ON DUTY' },
                { empId: 'E903', name: 'Synthetic Person C', designation: 'Helper', section: 'Mech', nationality: 'X', siteStatus: 'ON DUTY' }],
    customPlants: [...plants].sort(),
  };
}

// ---------- local backend (HTTPS): the real P2 SQL on PGlite + the real P2 Edge Function logic ----------
const { BackendMock, pgliteEntry, SIGN_IN_DOMAIN } = require('./backend-mock');
// Every account record gets its synthetic Employee ID and plain password (the fake Auth service needs the password; the
// stored record keeps only its SHA-256 for assertions).
function withAuth(data) {
  const d = JSON.parse(JSON.stringify(data || {}));
  if (Array.isArray(d.users)) d.users = d.users.map(u => ({ ...u, employeeId: u.employeeId || EMP[u.username], plainPassword: u.plainPassword || PASS[u.username] }));
  return d;
}
class Mock extends BackendMock {
  reset(data, opt) { return super.reset(withAuth(data), opt); }
  async start(ip = TEST_MOCK_IP) {
    await this.init();
    this.appUrl = `http://127.0.0.1:${SITE_PORT}/index.html`;
    const dir = path.join(D, 'cert');
    if (!fs.existsSync(path.join(dir, 'cert.pem'))) {
      fs.mkdirSync(dir, { recursive: true });
      cp.execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '2', '-subj', '/CN=' + FAKE_HOST], { stdio: 'ignore' });
    }
    this.srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (q, r) => this.handle(q, r));
    this.srv.on('upgrade', (q, s) => { this.requests.push({ m: 'UPGRADE', u: q.url }); s.destroy(); });   // realtime websocket: refused
    return new Promise((res, rej) => { this.srv.once('error', rej); this.srv.listen(443, ip, res); });
  }
}

// ---------- static site ----------
function startSite(port = SITE_PORT, host = '127.0.0.1') {   // tests: 127.0.0.1:8770; preview (serve.js): localhost:5173
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
    const f = path.join(D, 'site', p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    if (!f.startsWith(path.join(D, 'site')) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, host, () => res(srv)); });
}

// ---------- headless Edge + CDP ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function launch(mockIp = TEST_MOCK_IP) {
  const prof = path.join(D, 'profile-' + Date.now());
  const proc = cp.spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + prof,
    '--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', '--ignore-certificate-errors', '--window-size=1440,900',
    `--host-resolver-rules=MAP ${FAKE_HOST} ${mockIp}, MAP *.supabase.co ~NOTFOUND, MAP vincent-mauve.vercel.app ~NOTFOUND`, 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.some(x => x.type === 'page')) break; } catch (e) {} await sleep(250); }
  const pg = list.find(x => x.type === 'page');
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  // Test doubles: alerts/confirms recorded; print windows (window.open) and CSV downloads (<a download>.click) captured, not executed.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    'window.__alerts=[]; window.alert=m=>window.__alerts.push(String(m)); window.confirm=()=>true;',
    "window.__prints=[]; window.open=function(){ const w={ document:{ _h:'', write(h){ this._h+=h; }, close(){}, readyState:'complete' }, print(){}, onload:null }; window.__prints.push(w); return w; };",
    'window.__blobs=[]; const __co=URL.createObjectURL; URL.createObjectURL=function(b){ window.__blobs.push(b); return __co.call(URL,b); };',
    'window.__downloads=[]; const __ac=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__downloads.push(this.download); return; } return __ac.apply(this, arguments); };',
  ].join('\n') });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('page eval: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const close = async () => { try { await send('Browser.close'); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} };
  return { send, evaluate, events, close };
}

module.exports = { pgliteEntry, buildSite, writeStagingConfig, seed, seed2, Mock, startSite, launch, sleep, PASS, EMP, FAKE_HOST, SITE_PORT, SIGN_IN_DOMAIN };
