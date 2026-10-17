// Controlled test-user creation + role verification. LOCAL ONLY.
// Runs the app (sanitized copy, 127.0.0.1) against the in-memory local mock with the synthetic seed; the browser maps
// every *.supabase.co host and the production hostname to NOTFOUND, so nothing can reach production.
// 1. Signs in as the synthetic Admin and creates ONE test account per role through the app's own save-user handler
//    (the same validation and hashing as Settings → Add User). Passwords are random, held in memory, never printed.
// 2. Signs in as each test account and checks that the navigation and key actions shown match the app's role model.
// The test accounts exist only in the in-memory mock and disappear when the script ends.
// Never use this against production. In production, test accounts need the owner's explicit approval.
// Usage: node tests/e2e/role-check.js        exit 0 = every role matches, 1 = a mismatch or an error
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { buildSite, writeStagingConfig, seed, Mock, startSite, launch, sleep, PASS } = require('./rig');
const HELPERS = fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8').match(/const HELPERS = `([\s\S]*?)`;/)[1];
const NAV = [['Dashboard', 'nav.dashboard'], ['Asset Registry', 'nav.assets'], ['Job Orders', 'nav.jobOrders'], ['PM Schedule', 'nav.pm'],
             ['Employees', 'nav.employees'], ['Reports', 'nav.reports'], ['Settings', 'settings.profile']];
const strongPw = () => 'Rc-' + crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, 'x') + '9a!';

(async () => {
  const san = buildSite(); writeStagingConfig();
  const plants = eval(san.match(/const PLANTS = (\[[^\]]*\]);/)[1]);
  const mock = new Mock(); await mock.start(); mock.reset(seed(plants));
  const site = await startSite();
  const B = await launch();
  const ev = async e => { await B.evaluate(HELPERS); return B.evaluate(e); };
  const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const login = async (u, p) => {
    await waitFor(`!!document.getElementById('login-username')`);
    for (let i = 0; i < 60 && !mock.requests.some(r => r.m === 'GET'); i++) await sleep(100); await sleep(400);
    await ev(`(()=>{ T.setVal(document.getElementById('login-username'), ${JSON.stringify(u)}); T.setVal(document.getElementById('login-password'), ${JSON.stringify(p)}); document.querySelector('form button[type=submit]').click(); return true; })()`);
    return waitFor(`!!document.querySelector('.sidebar') && !T.body().includes('Loading')`);
  };
  const logout = async () => { await ev(`(document.querySelector('.btn-logout')||{click(){}}).click(); true`); await waitFor(`!!document.getElementById('login-username')`, 10000); };
  const nav = async label => { await ev(`(()=>{ const n = T.all('.nav-item').find(e => T.txt(e).endsWith(${JSON.stringify(label)})); n && n.click(); return true; })()`); await sleep(500); };
  let fail = 0; const rows = [];
  try {
    await B.send('Page.navigate', { url: `http://127.0.0.1:8770/index.html` });
    if (!(await login('t_admin', PASS.t_admin))) throw new Error('synthetic Admin could not sign in');
    const cat = plants.slice().sort()[1];
    const specs = [
      { role: 'Assistant Engineer' }, { role: 'Senior Engineer' }, { role: 'Job Card Editor', section: 'Mechanical' },
      { role: 'Department User', department: 'Cement Plant', assignedCategories: [cat] }, { role: 'Viewer' },
    ].map((s, i) => ({ ...s, username: 'rc_test_' + (i + 1), email: 'rc_test_' + (i + 1) + '@example.invalid', fullName: 'Role Check ' + s.role, employeeId: 'RC' + String(i + 1).padStart(3, '0'), password: strongPw(), active: true }));
    await nav('Settings');
    for (const s of specs) {
      await ev(`(async()=>{ await T.prop('onSaveUser')(${JSON.stringify(s)}, null); return true; })()`); await sleep(900);
      const stored = mock.store.users.find(u => u.username === s.username);
      const ok = !!stored && stored.role === s.role && stored.password === crypto.createHash('sha256').update(s.password).digest('hex');
      console.log((ok ? 'PASS ' : 'FAIL ') + `created test account for ${s.role} (stored with a SHA-256 hash, password not printed)`); if (!ok) fail++;
    }
    await logout();
    for (const s of specs) {
      const signed = await login(s.username, s.password);
      if (!signed) { console.log(`FAIL ${s.role}: test account could not sign in`); fail++; rows.push([s.role, 'sign-in failed']); continue; }
      const labels = await ev(`T.all('.nav-item').map(e => (e.title || T.txt(e)).trim())`);
      const expected = await ev(`(()=>{ const u = {role: ${JSON.stringify(s.role)}}; return { nav: ${JSON.stringify(NAV)}.filter(([l, c]) => can(u, c)).map(([l]) => l), addAsset: can(u, 'asset.create'), raise: can(u, 'jo.create'), users: can(u, 'users.admin') }; })()`);
      await nav('Asset Registry'); const addAsset = labels.includes('Asset Registry') ? await ev(`!!T.find('Add Asset','button')`) : false;
      await nav('Job Orders'); const raise = await ev(`!!T.find('Raise Job Order','button')`);
      await nav('Settings'); const users = await ev(`T.all('.settings-tab').some(e => T.txt(e).includes('Users'))`);
      const navOk = JSON.stringify(labels) === JSON.stringify(expected.nav);
      const ok = navOk && addAsset === expected.addAsset && raise === expected.raise && users === expected.users;
      console.log((ok ? 'PASS ' : 'FAIL ') + `${s.role}: pages [${labels.join(', ')}]; Add Asset ${addAsset ? 'yes' : 'no'}; Raise JO ${raise ? 'yes' : 'no'}; Users admin ${users ? 'yes' : 'no'}`
        + (ok ? '' : `  -> expected pages [${expected.nav.join(', ')}], Add Asset ${expected.addAsset}, Raise JO ${expected.raise}, Users ${expected.users}`));
      if (!ok) fail++;
      await logout();
    }
  } catch (e) { console.log('ERROR ' + e.message); fail++; }
  finally { await B.close(); site.close(); mock.srv.close(); }
  console.log(fail ? `ROLE CHECK: ${fail} problem(s)` : 'ROLE CHECK: every role matches the role model (local mock only; test accounts discarded)');
  process.exit(fail ? 1 : 0);
})();
