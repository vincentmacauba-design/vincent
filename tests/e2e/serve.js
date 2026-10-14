// Interactive local preview of the CMMS on synthetic data. LOCAL ONLY — reuses the E2E rig (rig.js):
//  - serves a sanitized copy of the working index.html (production URL/key replaced in memory; written to the OS temp folder)
//  - runs the HTTPS mock of the Supabase REST API on 127.0.0.1:443 with the synthetic seed (5 roles + SE with editor bundle)
//  - opens a separate, visible Edge window (throwaway profile) that maps the fake staging host to 127.0.0.1 and every other
//    *.supabase.co and the production hostname to NOTFOUND. The app's environment guard is unchanged: it reaches the mock
//    through its normal staging path (staging-config.js → resolver → __environment marker).
// Usage:  node tests/e2e/serve.js              start on http://localhost:5173 + open Edge; Ctrl+C stops everything (data resets on every start)
//         node tests/e2e/serve.js --no-browser start servers only (open the printed command yourself)
//         node tests/e2e/serve.js --selfcheck  start, sign in as every role in headless Edge, print what each sees, exit
'use strict';
const os = require('os'), fs = require('fs'), path = require('path'), cp = require('child_process'), net = require('net'), http = require('http'), https = require('https');
const { buildSite, seed2, Mock, startSite, launch, sleep, PASS, FAKE_HOST, SITE_PORT } = require('./rig');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// Preview address: http://localhost:5173 (PREVIEW_PORT overrides). The automated tests keep 127.0.0.1:8770, so both can run at once.
// `localhost` is one of the loopback hosts the app's environment guard accepts for staging-config.js; any other host stays blocked.
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT) || 5173;
const URL0 = `http://localhost:${PREVIEW_PORT}/`;
void SITE_PORT;
async function startPreviewSite() {
  // Listen on IPv4 and (if available) IPv6 loopback, so "localhost" works whichever address the browser tries first.
  const servers = [];
  try { servers.push(await startSite(PREVIEW_PORT, '127.0.0.1')); }
  catch (e) { throw new Error(e.code === 'EADDRINUSE' ? `port ${PREVIEW_PORT} is in use — stop the other program, or run: set PREVIEW_PORT=5174 && node tests/e2e/serve.js` : e.message); }
  try { servers.push(await startSite(PREVIEW_PORT, '::1')); } catch (e) { /* no IPv6 loopback: IPv4 is enough */ }
  return { close: () => servers.forEach(s => s.close()) };
}
const RULES = `MAP ${FAKE_HOST} 127.0.0.1, MAP *.supabase.co ~NOTFOUND, MAP vincent-mauve.vercel.app ~NOTFOUND`;
const ACCOUNTS = [
  ['Admin', 't_admin'], ['Assistant Engineer', 't_ae'], ['Senior Engineer', 't_se'], ['Job Card Editor (section Mechanical)', 't_jce'],
  ['Department User (Cement Plant; category 02 CEMENT PLANT)', 't_du'],
];

// Which program holds a port (read-only: netstat + tasklist). Nothing is ever terminated.
function portOwner(port) {
  try {
    const line = cp.execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).split(/\r?\n/)
      .find(l => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l));
    const pid = line && line.trim().split(/\s+/).pop();
    if (!pid) return 'unknown program';
    const name = (cp.execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).split(',')[0] || '').replace(/"/g, '');
    return `${name || 'process'} (PID ${pid})`;
  } catch (e) { return 'unknown program'; }
}
function portFree(port, host) {
  return new Promise(res => { const t = net.createServer(); t.once('error', e => res(e.code)); t.listen(port, host, () => t.close(() => res(null))); });
}
// Readiness: the page AND the mock database must answer before the browser is opened.
function get(url, opts = {}) {
  return new Promise(res => { const lib = url.startsWith('https') ? https : http;
    const rq = lib.get(url, { timeout: 4000, agent: false, ...opts }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, body: b })); });
    rq.on('timeout', () => rq.destroy(new Error('timeout'))); rq.on('error', e => res({ status: 0, body: e.message })); });
}
async function ready() {
  const page = await get(URL0);
  const mockRes = await get(`https://127.0.0.1:443/rest/v1/app_data?select=value&key=eq.__environment`, { headers: { host: FAKE_HOST }, servername: FAKE_HOST, rejectUnauthorized: false });
  return { page: page.status === 200 && page.body.includes('ENVIRONMENT GUARD'), mock: mockRes.status === 200 && mockRes.body.includes('"staging"') };
}

async function main() {
  // 1. Ports: report the owner of a busy port and stop; never kill anything.
  for (const [port, what] of [[443, 'mock database (HTTPS)'], [PREVIEW_PORT, 'preview page']]) {
    const err = await portFree(port, '127.0.0.1');
    if (err === 'EADDRINUSE') {
      console.error(`\nCannot start: port ${port} (${what}) is already in use by ${portOwner(port)}.`);
      console.error(port === 443
        ? '  Close that program (or stop its service), then run the command again. Port 443 is required: the app only talks to https://<project>.supabase.co.'
        : `  If it is an earlier preview, press Ctrl+C in that terminal. Otherwise run on another port:  set PREVIEW_PORT=5174 && node tests/e2e/serve.js`);
      process.exit(3);
    }
    if (err) { console.error(`\nCannot start: port ${port} (${what}) is not usable (${err}).`); process.exit(3); }
  }
  const san = buildSite();
  const plants = eval(san.match(/const PLANTS = (\[[^\]]*\]);/)[1]);
  const mock = new Mock(); await mock.start('127.0.0.1'); mock.reset(seed2(plants));   // the preview keeps 127.0.0.1:443
  const site = await startPreviewSite();
  const origHandle = mock.handle.bind(mock);
  mock.handle = (q, r) => { if (q.method === 'POST') q.on('end', () => { const w = mock.writes[mock.writes.length - 1]; if (w) console.log(`  [mock] saved "${w.key}"${w.len != null ? ` (${w.len} records)` : ''}${w.failed ? ' FAILED' : ''}`); }); origHandle(q, r); };

  if (process.argv.includes('--selfcheck')) return selfcheck(mock, site);

  console.log('\nCMMS local preview — synthetic data only, production unreachable');
  console.log(`  URL:   ${URL0}   (open it in the Edge window this script starts)`);
  console.log('  Accounts (synthetic, local mock only):');
  for (const [role, u] of ACCOUNTS) console.log(`    ${role.padEnd(55)} ${u.padEnd(8)} ${PASS[u]}`);
  // 2. Readiness: do not open the browser until the page and the mock database both answer.
  const rd = await ready();
  if (!rd.page || !rd.mock) { console.error(`\nCannot start: ${!rd.page ? 'the preview page' : 'the mock database'} did not answer. Nothing was opened.`); site.close(); mock.srv.close(); process.exit(4); }
  console.log(`\n  READY — server running at ${URL0} (mock database answering). Keep this terminal open while you use the preview.`);

  // 3. Browser: a FRESH profile per run, so an old preview window can never take over this launch.
  const prof = path.join(os.tmpdir(), 'cmms-tests', `preview-profile-${process.pid}`);
  const args = ['--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--ignore-certificate-errors', `--host-resolver-rules=${RULES}`, '--new-window', URL0];
  let edge = null, edgeAlive = false;
  if (process.argv.includes('--no-browser')) {
    console.log('\n  Open this browser yourself (a separate profile; your normal Edge is not affected):');
    console.log(`    "${EDGE}" ${args.map(a => a.includes(' ') || a.includes(',') ? `"${a}"` : a).join(' ')}`);
  } else {
    edge = cp.spawn(EDGE, args, { stdio: 'ignore', detached: false }); edgeAlive = true;
    edge.on('error', e => { edgeAlive = false; console.error(`  Could not open Edge (${e.message}). Run again with --no-browser and use the printed command.`); });
    edge.on('exit', () => { if (edgeAlive) { edgeAlive = false; console.log(`  Preview window closed. The server is still running at ${URL0} — press Ctrl+C here to stop it.`); } });
    console.log('  A separate Edge window (own profile) is opening.');
  }
  console.log('  Saves go only to the in-memory mock and are shown below. Restarting resets all data.');
  console.log('  Stop: press Ctrl+C here, type q + Enter, or close this terminal. That also closes the preview window.\n');

  // 4. Shutdown: the preview window never outlives the server. Only the Edge process tree this script started is closed.
  let stopped = false;
  const closeEdge = () => { if (edge && edgeAlive) { edgeAlive = false; try { cp.execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} } };
  const stop = sig => { if (stopped) return; stopped = true; console.log(`\nStopping (${sig})… closing the preview window and the server.`); closeEdge(); site.close(); mock.srv.close();
    setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} process.exit(0); }, 800); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => stop(sig));
  process.stdin.on('data', d => { if (/^\s*(q|quit|stop)\s*$/i.test(String(d))) stop('q'); });   // typing q + Enter also stops
  process.on('exit', closeEdge);   // last resort (synchronous)
}

// Headless check: sign in as each account and print the visible pages and key permissions.
async function selfcheck(mock, site) {
  const B = await launch('127.0.0.1');
  const ev = async e => B.evaluate(e);
  const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  let ok = true;
  try {
    for (const [role, u] of ACCOUNTS) {
      await B.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
      await B.send('Storage.clearDataForOrigin', { origin: `http://localhost:${PREVIEW_PORT}`, storageTypes: 'local_storage' });
      mock.requests = [];
      await B.send('Page.navigate', { url: URL0 });
      await waitFor(`!!document.querySelector('input[type=password]')`);
      for (let i = 0; i < 100 && !mock.requests.some(r => r.m === 'GET' && /select=(\*|%2A)/.test(r.u)); i++) await sleep(100);
      await sleep(500);
      await ev(`(()=>{ const s=(el,v)=>{ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); };
        const [a,b]=document.querySelectorAll('form input'); s(a,${JSON.stringify(u)}); s(b,${JSON.stringify(PASS[u])}); document.querySelector('form button[type=submit]').click(); return true; })()`);
      const signedIn = await waitFor(`!!document.querySelector('.sidebar')`);
      const pages = signedIn ? await ev(`[...document.querySelectorAll('.nav-item')].map(e=>e.title).join(', ')`) : '(sign-in failed)';
      if (!signedIn) ok = false;
      console.log(`  ${signedIn ? 'OK  ' : 'FAIL'} ${role.padEnd(55)} ${u.padEnd(8)} pages: ${pages}`);
    }
    const hosts = [...new Set(B.events.filter(e => e.method === 'Network.requestWillBeSent').map(e => { try { return new URL(e.params.request.url).host; } catch (x) { return ''; } }))];
    const bad = hosts.filter(h => /supabase\.co$/.test(h) && h !== FAKE_HOST || /vincent-mauve/.test(h));
    console.log(`  hosts contacted: ${hosts.join(', ')}`);
    console.log(`  ${bad.length ? 'FAIL production/other Supabase host requested: ' + bad.join(', ') : 'OK   no production or other Supabase host requested'}`);
    if (bad.length) ok = false;
  } finally { await B.close(); site.close(); mock.srv.close(); }
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('ERROR', e.message); process.exit(2); });
