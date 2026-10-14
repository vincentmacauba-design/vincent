// E2E regression + F1/F2 browser tests (FEATURE_PLAN §12.4 T5, T6, T7, T9; §12.6-§12.7) on synthetic data via the local rig.
'use strict';
const { pgliteEntry, buildSite, writeStagingConfig, seed, seed2, Mock, startSite, launch, sleep, PASS, EMP, FAKE_HOST, SITE_PORT, SIGN_IN_DOMAIN } = require('./rig');
// The local backend runs the real P2 SQL on PGlite; without it the browser suite cannot run (reported as SKIP, exit 2).
if (!pgliteEntry()) { console.log('E2E SKIPPED: set CMMS_PGLITE_DIR (PGlite runs the P2 SQL for the browser tests).'); process.exit(2); }
// Sign-in is by Employee ID: a test account name is typed as its synthetic Employee ID; any other text is typed as given.
const idOf = u => EMP[u] || u;
const acct = u => u && JSON.stringify({ id: u.id, username: u.username, fullName: u.fullName, role: u.role, active: u.active !== false, department: u.department,
  assignedCategories: u.assignedCategories, section: u.section, password: u.password });
const sameAccounts = (stored, seedUsers) => stored.length === seedUsers.length && seedUsers.every(s => acct(stored.find(u => u.id === s.id)) === acct(s));
let pass = 0, fail = 0; const fails = [];
const t = (n, c, info) => { c ? pass++ : (fail++, fails.push(n)); console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined && (!c || process.env.V) ? '  -> ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };

const HELPERS = `(() => { if (window.T) return; const T = window.T = {}; T.EMP = ${JSON.stringify(EMP)};
  T.txt = el => ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim();
  T.all = (sel, root) => [...(root || document).querySelectorAll(sel)];
  T.find = (text, sel, root) => { const c = T.all(sel || 'button,label,div,span,a,td,th', root).filter(e => T.txt(e).includes(text)); c.sort((a, b) => T.txt(a).length - T.txt(b).length); return c[0] || null; };
  T.click = (text, sel, root) => { const e = T.find(text, sel, root); if (!e) throw new Error('not found: ' + text); e.click(); return true; };
  T.byTitle = (title, root) => T.all('[title="' + title + '"]', root);
  T.setVal = (el, v) => { if (!el) return false; const P = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(P, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  // (P2) the users table shows the Employee ID, not the username: a test account name finds its row by its synthetic Employee ID
  T.row = text => { const k = (T.EMP || {})[text] || text; return T.all('tr').find(tr => T.txt(tr).includes(k)) || null; };
  T.prop = name => { for (const el of T.all('*')) { const k = Object.keys(el).find(k => k.startsWith('__reactFiber$')); if (!k) continue; let f = el[k];
      while (f) { const p = f.memoizedProps; if (p && typeof p[name] === 'function') return p[name]; f = f.return; } } return null; };
  T.body = () => (document.body ? document.body.innerText : '');
  T.field = label => { const g = T.all('.modal .form-group').find(g => g.querySelector('label') && T.txt(g.querySelector('label')) === label); return g ? g.querySelector('input,textarea,select') : null; };
  T.propFrom = (sel, name) => { const el = document.querySelector(sel); if (!el) return null; const k = Object.keys(el).find(k => k.startsWith('__reactFiber$')); let f = el[k];
    while (f) { const p = f.memoizedProps; if (p && typeof p[name] === 'function') return p[name]; f = f.return; } return null; };
  T.modalText = () => T.txt(document.querySelector('.modal') || document.body).toLowerCase();   // textContent: not affected by CSS uppercase
  T.navLabels = () => T.txt(document.querySelector('.sidebar') || document.body);
})()`;

async function main() {
  const san = buildSite();
  const plants = eval(san.match(/const PLANTS = (\[[^\]]*\]);/)[1]);
  const SEED = seed(plants), SEED2 = seed2(plants);
  const mock = new Mock(); await mock.start();
  const site = await startSite();
  const B = await launch(); BROWSER = B;
  const ev = async e => { await B.evaluate(HELPERS); return B.evaluate(e); };
  const waitFor = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch (e) { if (process.env.DBG && !waitFor.seen) { waitFor.seen = 1; console.log("waitFor error:", e.message.slice(0, 300)); } } await sleep(150); } return false; };
  const URL0 = `http://127.0.0.1:${SITE_PORT}/index.html`;
  const writesSince = n => mock.writes.slice(n);

  async function fresh(user, data = SEED, opt = {}) {   // opt.keep: keep the mock data; opt.password; opt.expectFail
    if (!opt.keep) mock.reset(data);
    await B.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
    // clear the site storage (session) BEFORE the app loads, so a running app cannot re-write it
    await B.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${SITE_PORT}`, storageTypes: 'local_storage' });
    mock.requests = [];
    const nv = await B.send('Page.navigate', { url: URL0 });
    if (nv.result && nv.result.errorText) console.log('  navigate error:', nv.result.errorText);
    if (!(await waitFor(`location.href===${JSON.stringify(URL0)} && document.readyState==="complete" && !!document.getElementById('root')`, 20000)))
      throw new Error('app page did not load: ' + JSON.stringify(nv.result || nv.error || {}));
    let ok = await waitFor(`!!document.querySelector('input[type=password]')`, 20000);
    if (!ok) { mock.requests = []; await B.send('Page.navigate', { url: URL0 }); ok = await waitFor(`!!document.querySelector('input[type=password]')`, 20000); }
    if (!ok) throw new Error('login form not shown: ' + (await ev(`JSON.stringify({ body: T.body().slice(0,200), session: !!localStorage.getItem('cmms_vg_session'), root: (document.getElementById('root')||{}).innerHTML.slice(0,300) })`)) +
      ' | mock requests: ' + mock.requests.map(r => r.m + ' ' + r.u.slice(0, 50)).join(', '));
    // Nothing is read before sign-in; the staging marker check (environment_marker) precedes the login form.
    for (let i = 0; i < 100 && !mock.requests.some(r => r.u.includes('/rpc/environment_marker')); i++) await sleep(100);
    await sleep(300);
    await ev(`(()=>{ const [u,p]=T.all('form input'); T.setVal(u, ${JSON.stringify(idOf(user))}); T.setVal(p, ${JSON.stringify(opt.password || PASS[user])}); document.querySelector('form button[type=submit]').click(); return true; })()`);
    const in_ = await waitFor(`!!document.querySelector('.sidebar') && !T.body().includes('Loading')`, 20000);
    if (!in_ && opt.expectFail) return false;
    if (in_ && opt.expectFail) return true;
    if (!in_) throw new Error('login failed for ' + user + ': ' + (await ev('T.body().slice(0,200)')));
    await sleep(1200);   // let load-time writes (employee status write-back) settle
    return mock.writes.length;
  }
  // Click the sidebar link itself (.nav-item), never the section header with the same text; fail loudly if it is missing.
  const nav = async label => {
    const ok = await ev(`(()=>{ const n = T.all('.nav-item').find(e => T.txt(e).endsWith(${JSON.stringify(label)})); if (!n) return false; n.click(); return true; })()`);
    if (!ok) throw new Error('nav item not found: ' + label);
    await sleep(400);
    if (!(await ev(`T.all('.nav-item.active').some(e => T.txt(e).endsWith(${JSON.stringify(label)}))`))) throw new Error('page did not become active: ' + label);
  };
  const settle = () => sleep(1500);   // persist() debounce is 800 ms
  // Phase 2B-1: a reload always signs out (nothing is restored from browser storage). Sign in again on the current page,
  // keeping the mock data. Retries cover a click that lands before the users finished loading ("unavailable").
  const relogin = async (user, opt = {}) => {
    if (!(await waitFor(`!!document.querySelector('.login-card input[type=password]')`, 20000))) throw new Error('login form not shown after reload');
    await sleep(1500);
    for (let i = 0; i < (opt.expectFail ? 1 : 5); i++) {
      await ev(`(()=>{ T.setVal(document.getElementById('login-username'), ${JSON.stringify(idOf(user))}); T.setVal(document.getElementById('login-password'), ${JSON.stringify(opt.password || PASS[user])}); document.querySelector('form button[type=submit]').click(); return true; })()`);
      if (await waitFor(`!!document.querySelector('.sidebar') && !T.body().includes('Loading')`, opt.expectFail ? 3000 : 4000)) { await sleep(800); return true; }
      if (opt.expectFail) return false;
      await sleep(1000);
    }
    throw new Error('relogin failed for ' + user);
  };

  // ============ 0. Boot / isolation ============
  console.log('--- 0. boot & isolation');
  const loadW = await fresh('t_admin');
  t('I5 staging banner shown; app started behind marker gate', await ev(`T.body().includes('STAGING · SYNTHETIC DATA · NOT PRODUCTION')`));
  t('I5b only one marker read before the full load', mock.requests.filter(r => r.u.includes('/rpc/environment_marker')).length >= 1);
  t('I7 (N1) nothing is written while loading and signing in when no stored employee status is out of date', mock.writes.length === 0, mock.writes.map(w => w.key));
  void loadW;

  // ============ T5: role UI checklist ============
  console.log('--- T5. UI per role (present/absent exactly as before F1)');
  const EXP = {   // [Admin, AE, SE]
    assets: { 'Add Asset': [1, 1, 0], 'Import': [1, 1, 0], 'Template': [1, 1, 0], 'Clear All Assets': [1, 0, 0], 'rowEdit': [1, 1, 0], 'rowRaise': [1, 1, 0], 'rowDelete': [1, 1, 0], 'statusEnabled': [1, 1, 0] },
    jos: { 'Raise Job Order': [1, 1, 0], 'Import': [1, 1, 0], 'Template': [1, 1, 0], 'OPEN ›': [1, 1, 0], 'rowEdit': [1, 1, 0], 'rowDelete': [1, 1, 0] },
    jos2: { 'IN PROGRESS ›': [1, 1, 0], 'COMPLETED ›': [1, 1, 1], 'revert': [1, 0, 0] },
    pm: { 'Add PM Schedule': [1, 1, 0], 'Import': [1, 1, 0], 'Template': [1, 1, 0], 'Record Service': [1, 1, 0], 'Raise Job Order': [1, 1, 0], 'Edit': [1, 1, 0] },
    emp: { 'Add Employee': [1, 0, 0], 'Import': [1, 0, 0], 'Template': [1, 0, 0], 'Fix Status': [1, 0, 0], 'Actions': [1, 1, 0], 'Edit Employee': [1, 0, 0], 'Delete Employee': [1, 0, 0] },
    settings: { 'Users': [1, 0, 0], 'Reset Data': [1, 0, 0], 'Edit My Profile': [1, 1, 1] },
    views: { 'assetView Edit Asset': [1, 1, 0], 'assetView Raise JO': [1, 1, 0], 'joView Edit': [1, 1, 0] },
  };
  const ROLEU = ['t_admin', 't_ae', 't_se'];
  for (let i = 0; i < 3; i++) {
    const u = ROLEU[i]; if (i) await fresh(u);
    const got = {};
    await nav('Asset Registry');
    Object.assign(got, await ev(`(()=>{ const r=T.row('5001'); const sel=r&&r.querySelector('select');
      return { 'Add Asset':!!T.find('Add Asset','button'), 'Import':!!T.find('↑ Import','label'), 'Template':!!T.find('Template','button'),
        'Clear All Assets':!!T.find('Clear All Assets','button'), rowEdit:T.byTitle('Edit Asset',r).length>0, rowRaise:T.byTitle('Raise Job Order',r).length>0,
        rowDelete:T.byTitle('Delete Asset',r).length>0, statusEnabled: !!sel && !sel.disabled }; })()`));
    for (const [k, v] of Object.entries(EXP.assets)) t(`T5 ${u} Assets ${k}`, got[k] === !!v[i], got[k]);
    // asset view modal
    await ev(`T.byTitle('View Asset', T.row('5001'))[0].click(); true`); await sleep(300);
    const av = await ev(`({ e: !!T.find('Edit Asset','.modal button,button'), j: !!T.find('Raise JO','button') })`);
    t(`T5 ${u} AssetView Edit Asset`, av.e === !!EXP.views['assetView Edit Asset'][i], av); t(`T5 ${u} AssetView Raise JO`, av.j === !!EXP.views['assetView Raise JO'][i], av);
    await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);

    await nav('Job Orders');
    const jo = await ev(`(()=>{ const r=T.row('JO-9001'); return { 'Raise Job Order':!!T.find('Raise Job Order','button'), 'Import':!!T.find('↑ Import','label'),
      'Template':!!T.find('Template','button'), 'OPEN ›':!!(r&&T.find('OPEN ›','button',r)), rowEdit:T.byTitle('Edit',r).length>0, rowDelete:T.byTitle('Delete',r).length>0 }; })()`);
    for (const [k, v] of Object.entries(EXP.jos)) t(`T5 ${u} JO ${k}`, jo[k] === !!v[i], jo[k]);
    await ev(`T.click('In Progress','button'); true`); await sleep(250);
    const ip = await ev(`!!(T.row('JO-9002') && T.find('IN PROGRESS ›','button',T.row('JO-9002')))`);
    await ev(`T.click('Completed','button'); true`); await sleep(250);
    const cp = await ev(`!!(T.row('JO-9003') && T.find('COMPLETED ›','button',T.row('JO-9003')))`);
    await ev(`T.click('Closed','button'); true`); await sleep(250);
    const rv = await ev(`T.byTitle('Revert to Completed', T.row('JO-9004')).length>0`);
    t(`T5 ${u} JO IN PROGRESS ›`, ip === !!EXP.jos2['IN PROGRESS ›'][i]); t(`T5 ${u} JO COMPLETED › (approve&close)`, cp === !!EXP.jos2['COMPLETED ›'][i]); t(`T5 ${u} JO revert`, rv === !!EXP.jos2.revert[i]);
    // JO view modal (open JO)
    await ev(`T.click('Open','button'); true`); await sleep(250);
    const vb = await ev(`(()=>{ const r=T.row('JO-9001'); const v=T.all('button',r).find(b=>/view/i.test(b.title||'')); if(v){v.click(); return true;} r.click(); return true; })()`); void vb;
    await sleep(300);
    const jv = await ev(`!!T.all('.modal button,button').find(b=>T.txt(b)==='✏ Edit')`);
    t(`T5 ${u} JOView Edit`, jv === !!EXP.views['joView Edit'][i], jv);
    await ev(`(T.all('.modal-close')[0]||{click(){}}).click(); true`); await sleep(200);

    await nav('PM Schedule');
    const pm = await ev(`(()=>{ const r=T.row('Test Pump'); return { 'Add PM Schedule':!!T.find('Add PM Schedule','button'), 'Import':!!T.find('↑ Import','label'), 'Template':!!T.find('Template','button'),
      'Record Service':T.byTitle('Record Service',r).length>0, 'Raise Job Order':T.byTitle('Raise Job Order',r).length>0, 'Edit':T.byTitle('Edit',r).length>0 }; })()`);
    for (const [k, v] of Object.entries(EXP.pm)) t(`T5 ${u} PM ${k}`, pm[k] === !!v[i], pm[k]);

    await nav('Employees');
    const em = await ev(`(()=>{ const r=T.row('E901'); return { 'Add Employee':!!T.find('Add Employee','button'), 'Import':!!T.find('↑ Import','label'), 'Template':!!T.find('Template','button'),
      'Fix Status':!!T.find('Fix Status','button'), 'Actions':T.all('th').some(th=>T.txt(th)==='Actions'), 'Edit Employee':T.byTitle('Edit Employee',r).length>0, 'Delete Employee':T.byTitle('Delete Employee',r).length>0 }; })()`);
    for (const [k, v] of Object.entries(EXP.emp)) t(`T5 ${u} Employees ${k}`, em[k] === !!v[i], em[k]);

    await nav('Settings');
    const st = await ev(`({ 'Users': T.all('.settings-tab').some(e=>T.txt(e)==='Users'), 'Reset Data': T.all('.settings-tab').some(e=>T.txt(e)==='Reset Data'),
      'Edit My Profile': (T.all('.settings-tab').find(e=>T.txt(e).includes('Profile'))||{click(){}}).click() || true })`);
    await sleep(250); st['Edit My Profile'] = await ev(`!!T.find('Edit My Profile','button')`);
    for (const [k, v] of Object.entries(EXP.settings)) t(`T5 ${u} Settings ${k}`, st[k] === !!v[i], st[k]);
    for (const p of ['Dashboard', 'Reports']) { await nav(p); t(`T9 ${u} ${p} renders`, await ev(`T.body().length > 200 && !T.body().includes('Something went wrong') && (${JSON.stringify(p)} !== 'Reports' || !!document.querySelector('.report-grid'))`)); }
  }

  // ============ JO lifecycle + save payloads (regression + T7) ============
  console.log('--- Workflow: raise → start → complete (AE), approve & close (SE), revert (Admin), edit/delete (Admin)');
  const jos = () => mock.store.jobOrders;
  const findJO = no => jos().find(j => j.jobNo === no);
  let n = await fresh('t_ae');
  await nav('Asset Registry');
  await ev(`T.byTitle('Raise Job Order', T.row('5002'))[0].click(); true`); await sleep(400);
  await ev(`(()=>{ const ta=T.all('.modal textarea')[0]; if(ta) T.setVal(ta,'E2E synthetic problem'); return true; })()`);
  await ev(`T.click('Save Job Order','button'); true`); await settle();
  let w = writesSince(n).filter(x => x.key === 'jobOrders').pop();
  const alerts = await ev('window.__alerts.slice()');
  t('W1 AE raises JO: jobOrders upsert has +1 row', !!w && w.len === w.prevLen + 1, { w: w && [w.prevLen, w.len], alerts });
  const newJO = w && w.value.find(j => !SEED.jobOrders.some(s => s.jobNo === j.jobNo));
  t('W1b new JO is OPEN, on asset 5002, numbered after the highest existing', !!newJO && newJO.status === 'OPEN' && newJO.assetNum === '5002' && newJO.jobNo === 'JO-9005', newJO && [newJO.jobNo, newJO.status, newJO.assetNum]);
  t('W1c existing JOs untouched (incl. unknown legacy fields)', SEED.jobOrders.every(s => JSON.stringify(findJO(s.jobNo)) === JSON.stringify(s)));
  t('W1d (N1) a job-order save writes no assets row at all; stored assets unchanged', !writesSince(n).some(x => x.key === 'assets') && JSON.stringify(mock.store.assets) === JSON.stringify(SEED.assets));
  await nav('Job Orders');
  n = mock.writes.length;
  await ev(`T.click('OPEN ›','button',T.row('JO-9005')); true`); await sleep(300); await ev(`T.setVal(T.all('.modal select')[0], '5'); true`); await ev(`T.click('Move to In Progress','button'); true`); await settle();
  t('W2a AE start: assigned to the chosen Job Card Editor; Received By = AE; Section = editor section', findJO('JO-9005').assignedTo === 'Test JCE' && findJO('JO-9005').assignedToId === 5 && findJO('JO-9005').recvName === 'Test AE' && findJO('JO-9005').section === 'Mechanical');
  t('W2 AE: OPEN → IN PROGRESS saved', findJO('JO-9005').status === 'IN PROGRESS' && jos().length === 5);
  await ev(`T.click('In Progress','button'); true`); await sleep(250);
  await ev(`T.click('IN PROGRESS ›','button',T.row('JO-9005')); true`); await sleep(300); await ev(`T.click('Mark Completed','button'); true`); await settle();
  t('W3 AE: IN PROGRESS → COMPLETED saved', findJO('JO-9005').status === 'COMPLETED');
  t('W3c F5: completing opens a PENDING approval and does not approve or close', findJO('JO-9005').approvalStatus === 'PENDING' && !findJO('JO-9005').approvedBy && !findJO('JO-9005').closedBy);
  t('W3b every jobOrders write kept all rows', writesSince(n).filter(x => x.key === 'jobOrders').every(x => x.len === 5));
  const afterAE = JSON.parse(JSON.stringify(mock.store));

  // SE approves & closes (store carried over, as if same database)
  await (async () => { const keep = afterAE; await fresh('t_se'); mock.store = JSON.parse(JSON.stringify(keep)); await B.send('Page.reload', {}); await relogin('t_se'); })();
  await nav('Job Orders'); await ev(`T.click('Completed','button'); true`); await sleep(300);
  n = mock.writes.length;
  t('W4a Completed tab shows "Awaiting approval" for the pending JO', await ev(`T.txt(T.row('JO-9005')).includes('Awaiting approval')`));
  await ev(`T.click('COMPLETED ›','button',T.row('JO-9005')); true`); await sleep(300); await ev(`T.click('Approve Completion','button.btn-success'); true`); await settle();
  let c = findJO('JO-9005');
  const SE_DES = 'Senior Manager, Engineering & Maintenance';
  t('W4 SE approves: APPROVED with approver name/id/designation/time; status stays COMPLETED; not closed', c.status === 'COMPLETED' && c.approvalStatus === 'APPROVED' && c.approvedBy === 'Test SE' && c.approvedById === 3 && c.approverDesignation === SE_DES && /^\d{4}-\d{2}-\d{2}T/.test(c.approvedAt) && !c.closedBy, [c.status, c.approvalStatus, c.approvedBy]);
  t('W4c approval history: one APPROVED event', Array.isArray(c.approvalHistory) && c.approvalHistory?.length === 1 && c.approvalHistory?.[0]?.event === 'APPROVED' && c.approvalHistory?.[0]?.byId === 3);
  await sleep(300);
  t('W4d row now shows "✓ Approved" and offers Close', await ev(`T.txt(T.row('JO-9005')).includes('✓ Approved') && T.find('COMPLETED ›','button',T.row('JO-9005')).title === 'Close job order'`));
  await ev(`T.click('COMPLETED ›','button',T.row('JO-9005')); true`); await sleep(300); await ev(`T.click('Close Job Order','button.btn-success'); true`); await settle();
  c = findJO('JO-9005');
  t('W4e SE closes as a separate action: CLOSED with closer name, SE designation and date; approval kept', c.status === 'CLOSED' && c.closedBy === 'Test SE' && c.closerDesignation === SE_DES && /^\d{4}-\d{2}-\d{2}$/.test(c.closedDate) && c.approvalStatus === 'APPROVED' && c.approvalHistory?.length === 2, [c.status, c.closedBy, c.closerDesignation, c.closedDate]);
  t('W4f history: APPROVED then CLOSED (with the selected closedDate; approval time unchanged)', c.approvalHistory?.[0]?.event === 'APPROVED' && c.approvalHistory?.[1]?.event === 'CLOSED' && c.approvalHistory?.[1]?.closedDate === c.closedDate && c.approvalHistory?.[1]?.byId === 3 && c.approvedAt === c.approvalHistory?.[0]?.at);
  t('W4b SE approve + close kept all 5 JOs and other fields', jos().length === 5 && c.problem && c.assetNum === '5002');
  const afterSE = JSON.parse(JSON.stringify(mock.store));

  // Admin reverts, edits, deletes
  await fresh('t_admin'); mock.store = JSON.parse(JSON.stringify(afterSE)); await B.send('Page.reload', {}); await relogin('t_admin');
  await nav('Job Orders'); await ev(`T.click('Closed','button'); true`); await sleep(300);
  await ev(`T.byTitle('Revert to Completed', T.row('JO-9005'))[0].click(); true`); await settle();
  c = findJO('JO-9005');
  t('W5 Admin revert: CLOSED → COMPLETED, closure cleared, approval and its history KEPT (§4.3)', c.status === 'COMPLETED' && c.closedBy === '' && c.closedDate === '' && c.closerDesignation === '' && c.approvalStatus === 'APPROVED' && c.approvedBy === 'Test SE' && c.approvalHistory?.length === 3 && c.approvalHistory?.[2]?.event === 'REVERTED' && c.approvalHistory?.[2]?.reason === 'reverted to COMPLETED' && c.approvalHistory?.[2]?.byId === 1);
  await ev(`T.click('Open','button'); true`); await sleep(250);
  await ev(`T.byTitle('Edit', T.row('JO-9001'))[0].click(); true`); await sleep(400);
  await ev(`T.click('Update Job Order','button'); true`); await settle();
  t('W6 Admin edit+save JO-9001: legacy field preserved, status unchanged', findJO('JO-9001').legacyField === 'keep-JO-9001' && findJO('JO-9001').status === 'OPEN');
  n = mock.writes.length;
  await ev(`T.byTitle('Delete', T.row('JO-9001'))[0].click(); true`); await settle();
  t('W7 Admin delete JO-9001: exactly one row removed', !findJO('JO-9001') && jos().length === 4 && writesSince(n).filter(x => x.key === 'jobOrders').every(x => x.len === x.prevLen - 1));
  // asset status change + PM record service + employee status (Admin)
  await nav('Asset Registry'); n = mock.writes.length;
  await ev(`(()=>{ const s=T.row('5006').querySelector('select'); T.setVal(s, 'BREAKDOWN'); return true; })()`); await settle();
  t('W8 asset status change saved; asset count unchanged', mock.store.assets.find(a => a.num === '5006').status === 'BREAKDOWN' && mock.store.assets.length === 6);
  await nav('PM Schedule'); n = mock.writes.length;
  await ev(`T.byTitle('Record Service', T.row('Test Pump'))[0].click(); true`); await sleep(300);
  await ev(`(()=>{ const b=T.all('.modal button,button').filter(b=>/Record|Save|Confirm/.test(T.txt(b)) && !/Record Service/.test(b.title||'')).pop(); b.click(); return true; })()`); await settle();
  const pmw = writesSince(n).filter(x => x.key === 'pm').pop();
  t('W9 PM record service: pm saved with 2 items, history +1', !!pmw && pmw.len === 2 && (mock.store.pm.find(p => p.id === 'pm-001').serviceHistory || []).length === 1, pmw && [pmw.len]);

  // ============ T6: mutation guards (direct calls bypassing the UI) ============
  console.log('--- T6. mutation guards: forbidden calls show a toast and send NO write');
  async function denied(user, pageLabel, prop, args, label) {
    await fresh(user); await nav(pageLabel);
    const before = mock.writes.length, storeBefore = JSON.stringify(mock.store);
    const r = await ev(`(()=>{ const f=T.prop(${JSON.stringify(prop)}); if(!f) return 'noprop'; f(...${JSON.stringify(args)}); return 'called'; })()`);
    await settle();
    const toast = await ev(`T.body().includes('You do not have permission for this action.')`);
    t(`T6 ${user} ${label}: denied, toast, no write`, r === 'called' && toast && mock.writes.length === before && JSON.stringify(mock.store) === storeBefore, { r, toast, writes: mock.writes.length - before });
  }
  await denied('t_se', 'Job Orders', 'onDeleteJO', ['JO-9001'], 'deleteJO');
  await denied('t_se', 'Job Orders', 'onStatusChange', ['JO-9001', 'IN PROGRESS'], 'start JO');
  await denied('t_se', 'Job Orders', 'onRevertJO', ['JO-9004'], 'revertJO');
  await denied('t_ae', 'Job Orders', 'onRevertJO', ['JO-9004'], 'revertJO');
  await denied('t_se', 'Asset Registry', 'onDeleteAsset', ['5001'], 'deleteAsset');
  await denied('t_ae', 'Asset Registry', 'onClearAssets', [], 'clearAllAssets');
  await denied('t_se', 'Asset Registry', 'onStatusChange', ['5001', 'BREAKDOWN'], 'asset status');
  await denied('t_ae', 'Employees', 'onDeleteEmployee', ['E901'], 'deleteEmployee');
  await denied('t_se', 'Employees', 'onUpdateStatus', ['E901', { siteStatus: 'ON LEAVE' }], 'employee status');
  await denied('t_se', 'PM Schedule', 'onSavePM', [{ assetNum: '5001', assetDesc: 'x', frequency: 'Monthly' }, null], 'savePM');
  await denied('t_ae', 'Settings', 'onResetData', [], 'resetData');
  await denied('t_ae', 'Settings', 'onDeleteUser', [1], 'deleteUser');
  await denied('t_ae', 'Settings', 'onSaveUser', [{ username: 'x', fullName: 'X', role: 'Admin' }, null], 'add user');
  await denied('t_ae', 'Settings', 'onSaveUser', [{ ...SEED.users[0], role: 'Admin' }, 1], 'edit another user');
  // unknown role: the SERVER refuses such an account (P2 profiles role check), so it cannot exist or sign in. The client-side
  // guard for a malformed role is still tested in permissions.test.js T6g.
  { const ODD = JSON.parse(JSON.stringify(SEED)); ODD.users.push({ id: 4, username: 't_odd', employeeId: 'TO004', fullName: 'Test Odd', role: 'admin', active: true, plainPassword: 'Synthetic-Odd-1' });
    await mock.reset(ODD);
    t('T6 unknown role "admin": the server refuses the account (no profile is created)', !mock.store.users.some(u => u.id === 4) && mock.store.users.length === SEED.users.length);
    t('T6 unknown role "admin": the refused account cannot sign in', (await fresh('TO004', ODD, { keep: true, expectFail: true, password: 'Synthetic-Odd-1' })) === false); }
  // allowed counterpart: own profile edit still works for AE (S4 unchanged in F1)
  await fresh('t_ae'); await nav('Settings'); n = mock.writes.length;
  await ev(`T.prop('onSaveUser')({...${JSON.stringify({ ...SEED.users[1], password: '' })}, fullName:'Test AE Renamed'}, 2); true`); await settle();
  t('T6 t_ae own-profile save still allowed (F1 keeps S4 behaviour)', (mock.store.users.find(u => u.id === 2) || {}).fullName === 'Test AE Renamed' && mock.store.users.length === SEED.users.length);

  // ============ F2a: S4 self-edit restriction + session re-derivation ============
  console.log('--- F2a. self-edit restriction (S4) and session re-derivation');
  await fresh('t_ae'); await nav('Settings');
  await ev(`T.prop('onSaveUser')({...${JSON.stringify({ ...SEED.users[1], password: '' })}, fullName:'AE Self Edit', email:'ae2@example.invalid', role:'Admin', active:false, username:'hijack'}, 2); true`); await settle();
  let me = mock.store.users.find(u => u.id === 2);
  t('S4 AE self-edit: name saved; role, status, username and recovery email NOT changed (P2: name only)', me.fullName === 'AE Self Edit' && !me.recoveryEmail && me.role === 'Assistant Engineer' && me.active === true && me.username === 't_ae', me && [me.role, me.active, me.username]);
  t('S4 AE self-edit: password hash unchanged when left blank', me.password === SEED.users[1].password);
  await fresh('t_admin'); await nav('Settings');
  await ev(`T.prop('onSaveUser')({...${JSON.stringify({ ...SEED.users[2], password: '' })}, role:'Assistant Engineer'}, 3); true`); await settle();
  t('S4 Admin can still change another user\'s role', mock.store.users.find(u => u.id === 3).role === 'Assistant Engineer');
  // self-profile form (UI): non-admin sees username/role/status read-only; name/email editable; save via the real form
  await fresh('t_se'); await nav('Settings');
  await ev(`(T.all('.settings-tab').find(e=>T.txt(e).includes('Profile'))||{click(){}}).click(); true`); await sleep(250);
  await ev(`T.click('Edit My Profile','button'); true`); await sleep(300);
  const sf = await ev(`(()=>{ const nm=T.field('Full Name'), un=T.field('Employee ID');
    return { nameEditable: !nm.disabled && !nm.readOnly, idLocked: !!un && (un.disabled || un.readOnly), noPassword: T.all('.modal input[type=password]').length === 0,
             noRecoveryEmail: !T.field('Recovery email (for password reset)'), roleLocked: T.field('Role').disabled, statusLocked: T.field('Account Status').disabled }; })()`);
  t('UI self-profile (SE): only the name is editable; NO password field (Change Password only); Employee ID, role, status read-only; no recovery email field',
    sf.nameEditable && sf.noPassword && sf.noRecoveryEmail && sf.idLocked && sf.roleLocked && sf.statusLocked, sf);
  n = mock.writes.length;
  await ev(`(()=>{ const m=T.all('.modal')[0]; const ins=T.all('input',m); T.setVal(T.field('Full Name'),'SE Via Form'); T.click('Update User','button',m); return true; })()`); await settle();
  me = mock.store.users.find(u => u.id === 3);
  t('UI self-profile save via the form: name stored; role/status/username/password unchanged',
    me.fullName === 'SE Via Form' && me.role === 'Senior Engineer' && me.active === true && me.username === 't_se' && me.password === SEED.users[2].password, me && [me.fullName, me.role]);
  t('UI self-profile save wrote only the users key, all users kept', writesSince(n).every(x => x.key === 'users' && x.len === SEED.users.length) && writesSince(n).length >= 1);
  await fresh('t_admin'); await nav('Settings');
  await ev(`T.all('button').filter(b=>T.txt(b).includes('Edit')).find(b=>T.row('t_ae') && T.row('t_ae').contains(b)).click(); true`); await sleep(300);
  const af = await ev(`(()=>{ const m=T.all('.modal')[0]; const id=T.field('Employee ID'); return { idLocked: !!id && id.disabled, recovery: !!T.field('Recovery email (for password reset)'), role: !T.field('Role').disabled, status: !T.field('Account Status').disabled }; })()`);
  t('UI Admin editing another user: role, status and recovery email editable; the Employee ID (sign-in identifier) is fixed after creation', af.idLocked && af.recovery && af.role && af.status, af);
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
  await ev(`(T.all('.settings-tab').find(e=>T.txt(e).includes('Profile'))||{click(){}}).click(); true`); await sleep(250);
  await ev(`T.click('Edit My Profile','button'); true`); await sleep(300);
  const ao = await ev(`(()=>{ return { roleLocked: T.field('Role').disabled, statusLocked: T.field('Account Status').disabled, banner: T.txt(document.querySelector('.edit-mode-banner')) }; })()`);
  t('UI Admin own profile (P2): role and status read-only (only another Admin may change them; the server refuses self-changes), and the form says so',
    ao.roleLocked && ao.statusLocked && ao.banner.includes('another Admin'), ao);
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);

  // Phase 2B-1: no browser session; a reload signs out; the role always comes from the stored record
  await fresh('t_ae'); await nav('Asset Registry');
  t('SESSION baseline: AE sees Add Asset', await ev(`!!T.find('Add Asset','button')`));
  await mock.updateAccount(2, { role: 'Senior Engineer' });
  await B.send('Page.reload', {});
  t('SESSION a reload signs out: no session is restored from browser storage', await waitFor(`!!document.querySelector('.login-card input[type=password]') && !document.querySelector('.sidebar')`, 20000));
  await relogin('t_ae'); await nav('Asset Registry');
  t('SESSION role read from the stored record at sign-in: AE demoted to SE loses Add Asset', await ev(`!T.find('Add Asset','button')`));
  t('SESSION nothing about the sign-in is written to browser storage', await ev(`localStorage.getItem('cmms_vg_session') === null`));
  await mock.updateAccount(2, { active: false });
  await B.send('Page.reload', {});
  const out = !(await relogin('t_ae', { expectFail: true })) && (await ev(`T.txt(document.querySelector('.login-error')) === 'Invalid Employee ID or password. Please try again.' && !document.querySelector('.sidebar')`));
  t('SESSION deactivated account cannot sign in', out);
  await mock.updateAccount(2, { role: 'Assistant Engineer', active: true });   // restore for later tests

  // ============ F2: Job Card Editor, Department User, SE + editor bundle (extended seed) ============
  console.log('--- F2. new roles: UI, scope, form modes, guards');
  const jo2 = no => mock.store.jobOrders.find(j => j.jobNo === no);
  const navHas = async lbl => ev(`T.navLabels().includes(${JSON.stringify(lbl)})`);
  const denyCall = async (sel, prop, args) => { const before = mock.writes.length, sb = JSON.stringify(mock.store);
    const r = await ev(`(()=>{ const f=T.propFrom(${JSON.stringify(sel)}, ${JSON.stringify(prop)}) || T.prop(${JSON.stringify(prop)}); if(!f) return 'noprop'; f(...${JSON.stringify(args)}); return 'called'; })()`);
    await settle(); return { r, toast: await ev(`T.body().includes('You do not have permission for this action.')`), writes: mock.writes.length - before, same: JSON.stringify(mock.store) === sb }; };
  const isDenied = x => x.r === 'called' && x.toast && x.writes === 0 && x.same;

  // ---- Job Card Editor ----
  // Job Card Editor (section Mechanical): JO-9002 is Mechanical work in this block (sections: R3)
  { const sdJ = JSON.parse(JSON.stringify(SEED2)); sdJ.jobOrders = sdJ.jobOrders.map(j => j.jobNo === 'JO-9002' ? { ...j, section: 'Mechanical' } : j); await fresh('t_jce', sdJ); }
  t('JCE nav: all seven pages', (await Promise.all(['Dashboard', 'Asset Registry', 'Job Orders', 'PM Schedule', 'Employees', 'Reports', 'Settings'].map(navHas))).every(Boolean));
  await nav('Asset Registry');
  t('JCE Assets view-only: no add/import/template/clear/edit/raise/delete; status locked; Export allowed', await ev(`(()=>{ const r=T.row('5001'), s=r.querySelector('select');
    return !T.find('Add Asset','button') && !T.find('↑ Import','label') && !T.find('Template','button') && !T.find('Clear All Assets','button') && !T.byTitle('Edit Asset',r).length && !T.byTitle('Raise Job Order',r).length && !T.byTitle('Delete Asset',r).length && s.disabled && !!T.find('↓ Export','button'); })()`));
  await nav('PM Schedule');
  t('JCE PM view-only (export allowed)', await ev(`(()=>{ const r=T.row('Test Pump'); return !T.find('Add PM Schedule','button') && !T.byTitle('Record Service',r).length && !T.byTitle('Edit',r).length && !T.byTitle('Raise Job Order',r).length && !!T.find('↓ Export','button'); })()`));
  await nav('Employees');
  t('JCE Employees view-only (no Actions column, export allowed)', await ev(`!T.all('th').some(th=>T.txt(th)==='Actions') && !T.find('Add Employee','button') && !!T.find('↓ Export','button')`));
  await nav('Settings');
  t('JCE Settings: own profile only', await ev(`!T.all('.settings-tab').some(e=>['Users','Reset Data'].includes(T.txt(e)))`));
  await nav('Job Orders');
  t('JCE Job Orders: sees all departments; no Raise/Import/Template; Export allowed', await ev(`!!T.row('JO-9001') && !!T.row('JO-9006') && !T.find('Raise Job Order','button') && !T.find('↑ Import','label') && !T.find('Template','button') && !!T.find('↓ Export','button')`));
  t('JCE JO row (OPEN, no section yet): may start it; no edit before it is theirs; no delete', await ev(`(()=>{ const r=T.row('JO-9001'); return !!T.find('OPEN ›','button',r) && !T.byTitle('Edit',r).length && !T.byTitle('Delete',r).length; })()`));
  let n2 = mock.writes.length;
  await ev(`T.click('OPEN ›','button',T.row('JO-9001')); true`); await sleep(300); await ev(`T.click('Move to In Progress','button'); true`); await settle();
  t('JCE start: OPEN → IN PROGRESS saved, all 7 JOs kept', jo2('JO-9001').status === 'IN PROGRESS' && mock.store.jobOrders.length === 7);
  t('JCE start: work assigned to themselves automatically (Assigned To, Received By, Section from their account)', jo2('JO-9001').assignedTo === 'Test JCE' && jo2('JO-9001').assignedToId === 5 && jo2('JO-9001').recvName === 'Test JCE' && jo2('JO-9001').section === 'Mechanical' && jo2('JO-9001').legacyField === 'keep-JO-9001');
  await ev(`T.click('Completed','button'); true`); await sleep(250);
  t('JCE cannot approve & close (no button on COMPLETED)', await ev(`!(T.row('JO-9003') && T.find('COMPLETED ›','button',T.row('JO-9003')))`));
  await ev(`T.click('In Progress','button'); true`); await sleep(250);
  await ev(`T.byTitle('Edit', T.row('JO-9002'))[0].click(); true`); await sleep(400);
  const jf = await ev(`({ problemRO: T.field('Details of the Problem').readOnly, reqRO: T.field('Requested By').readOnly, deptRO: T.field('Department').readOnly,
    searchOff: T.field('Search').disabled, prioOff: T.all('.modal input[name=prio]').every(x=>x.disabled), work: T.modalText().includes('work assigned to') && T.modalText().includes('service report') })`);
  t('JCE form: request/problem sections read-only, work sections shown', jf.problemRO && jf.reqRO && jf.deptRO && jf.searchOff && jf.prioOff && jf.work, jf);
  await ev(`(()=>{ T.setVal(T.field('Details of the Problem'), 'TAMPERED BY JCE'); T.setVal(T.field('Details of Work Done'), 'JCE work notes'); T.click('Update Job Order','button'); return true; })()`); await settle();
  let s2 = jo2('JO-9002');
  t('JCE save: work fields stored; problem/requester unchanged even if the form state was altered; legacy field kept', s2.workDone === 'JCE work notes' && s2.problem === 'Synthetic problem JO-9002' && s2.requester === 'Synthetic Requester' && s2.legacyField === 'keep-JO-9002' && s2.status === 'IN PROGRESS', [s2.problem, s2.workDone]);
  await ev(`T.byTitle('Edit', T.row('JO-9002'))[0].click(); true`); await sleep(400);
  let d = await denyCall('.modal', 'onSave', [{ ...SEED2.jobOrders[0], jobNo: undefined, problem: 'JCE create' }, null]);
  t('JCE direct create via saveJO: denied, no write', isDenied(d), d);
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
  d = await denyCall('.main', 'onApproveJO', ['JO-9003', { closedBy: 'x', closerDesignation: 'x', closedDate: '2026-10-10' }]); t('JCE direct approve&close: denied, no write', isDenied(d), d);
  d = await denyCall('.main', 'onDeleteJO', ['JO-9001']); t('JCE direct delete JO: denied, no write', isDenied(d), d);

  // ---- Senior Engineer stays its own role: a stored (legacy/tampered) bundle grants nothing ----
  { const sd = JSON.parse(JSON.stringify(SEED2)); sd.users = sd.users.map(u => u.id === 3 ? { ...u, extraBundles: ['JOB_CARD_EDITOR'] } : u); await fresh('t_se', sd); }
  await nav('Job Orders');
  t('SE with a stored editor bundle: NO start, NO edit, no Raise/Delete (five roles only)', await ev(`(()=>{ const r=T.row('JO-9001'); return !T.find('OPEN ›','button',r) && !T.byTitle('Edit',r).length && !T.byTitle('Delete',r).length && !T.find('Raise Job Order','button'); })()`));
  await ev(`T.click('Completed','button'); true`); await sleep(250);
  t('SE keeps approve & close (role-based)', await ev(`!!(T.row('JO-9003') && T.find('COMPLETED ›','button',T.row('JO-9003')))`));

  // ---- Department User (Cement Plant, category = plants[1]) ----
  await fresh('t_du', SEED2);
  const duNav = await Promise.all(['Dashboard', 'Asset Registry', 'Job Orders', 'Reports', 'Settings', 'PM Schedule', 'Employees'].map(navHas));
  t('DU nav: Dashboard, Assets, Job Orders, Reports, Settings; no PM, no Employees', duNav.slice(0, 5).every(Boolean) && !duNav[5] && !duNav[6], duNav);
  t('DU dashboard shows no other-department JO and no employee data', await ev(`!T.body().includes('JO-9001') && !T.body().includes('Synthetic Person')`));
  await nav('Asset Registry');
  const duA = await ev(`({ rows: ['5001','5002','5003','5004','5005','5006'].filter(n => !!T.row(n)),
    add: !!T.find('Add Asset','button'), exp: !!T.find('↓ Export','button'), raise: T.byTitle('Raise Job Order',T.row('5003')).length>0, edit: T.byTitle('Edit Asset').length, del: T.byTitle('Delete Asset').length })`);
  t('DU assets: only its category (5003); raise JO allowed; no add/edit/delete/export', JSON.stringify(duA.rows) === '["5003"]' && duA.raise && !duA.add && !duA.exp && !duA.edit && !duA.del, duA);
  await nav('Job Orders');
  const seenJ = new Set();
  for (const tab of ['Open', 'In Progress', 'Completed', 'Closed']) {          // one tab at a time: wait for each re-render
    await ev(`T.click(${JSON.stringify(tab)},'button'); true`); await sleep(300);
    (await ev(`T.all('tr').map(tr=>(T.txt(tr).match(/JO-9[0-9]{3}/)||[])[0]).filter(Boolean)`)).forEach(x => seenJ.add(x));
  }
  const duJ = [...seenJ].sort();
  t('DU JOs: only Cement Plant JOs across all tabs', JSON.stringify(duJ) === '["JO-9006","JO-9007","JO-9008"]', duJ);
  await ev(`T.click('Open','button'); true`); await sleep(250);
  const duRow = await ev(`({ ownEdit: T.byTitle('Edit',T.row('JO-9006')).length>0, otherEdit: T.byTitle('Edit',T.row('JO-9007')).length>0, del: T.byTitle('Delete').length,
    start: !!T.find('OPEN ›','button',T.row('JO-9006')), raise: !!T.find('Raise Job Order','button'), imp: !!T.find('↑ Import','label'), exp: !!T.find('↓ Export','button') })`);
  t('DU JO list: edit only own OPEN JO; no delete/start/import/export; can raise', duRow.ownEdit && !duRow.otherEdit && !duRow.del && !duRow.start && duRow.raise && !duRow.imp && !duRow.exp, duRow);
  await ev(`T.click('In Progress','button'); true`); await sleep(250);
  t('DU own JO from IN PROGRESS: read-only (no edit)', await ev(`!T.byTitle('Edit',T.row('JO-9008')).length`));
  // raise via the asset row
  await nav('Asset Registry'); n2 = mock.writes.length;
  await ev(`T.byTitle('Raise Job Order', T.row('5003'))[0].click(); true`); await sleep(400);
  const df = await ev(`({ req: T.field('Requested By').value, reqRO: T.field('Requested By').readOnly, dept: T.field('Department').value, deptRO: T.field('Department').readOnly,
    hidden: !T.modalText().includes('work assigned to') && !T.modalText().includes('service report') && !T.modalText().includes('manpower utilisation') && T.modalText().includes('problem details') })`);
  t('DU form: requester and department from profile, locked; work sections hidden', df.req === 'Test DU Cement' && df.reqRO && df.dept === 'Cement Plant' && df.deptRO && df.hidden, df);
  t('DU form: Type of Repair offers only Unplanned (selected); Planned not selectable', await ev("(()=>{ const r=T.all('.modal input[name=rtype]'); return r.length === 1 && r[0].checked && T.txt(r[0].parentElement) === 'Unplanned'; })()"));
  await ev(`(()=>{ T.setVal(T.field('Details of the Problem'), 'DU raised problem'); T.setVal(T.field('Department'), 'HR'); T.click('Save Job Order','button'); return true; })()`); await settle();
  const nj = mock.store.jobOrders.find(j => j.problem === 'DU raised problem');
  t('DU raise: saved OPEN, department forced to own, requester/requesterId from profile, work fields blank', !!nj && nj.status === 'OPEN' && nj.dept === 'Cement Plant' && nj.requester === 'Test DU Cement' && nj.requesterId === 6 && nj.workDone === '' && nj.assetNum === '5003' && nj.repairType === 'Unplanned' && mock.store.jobOrders.length === 8, nj && [nj.jobNo, nj.dept, nj.requesterId, nj.repairType]);
  t('DU raise: every other JO unchanged', SEED2.jobOrders.every(s => JSON.stringify(jo2(s.jobNo)) === JSON.stringify(s)));
  // edit own OPEN JO
  await nav('Job Orders'); await ev(`T.click('Open','button'); true`); await sleep(250);
  await ev(`T.byTitle('Edit', T.row('JO-9006'))[0].click(); true`); await sleep(400);
  t('DU edit form: problem editable, requester locked, work sections hidden', await ev(`!T.field('Details of the Problem').readOnly && T.field('Requested By').readOnly && !T.modalText().includes('service report') && T.modalText().includes('problem details')`));
  await ev(`(()=>{ T.setVal(T.field('Details of the Problem'), 'DU edited problem'); T.click('Update Job Order','button'); return true; })()`); await settle();
  s2 = jo2('JO-9006');
  t('DU edit own OPEN JO: saved as Unplanned (Department Users cannot keep Planned)', jo2('JO-9006').repairType === 'Unplanned');
  t('DU edit own OPEN JO: problem saved; requesterId, dept, status and legacy field kept', s2.problem === 'DU edited problem' && s2.requesterId === 6 && s2.dept === 'Cement Plant' && s2.status === 'OPEN' && s2.legacyField === 'keep-JO-9006');
  // boundary: direct calls outside scope
  await ev(`T.byTitle('Edit', T.row('JO-9006'))[0].click(); true`); await sleep(400);
  d = await denyCall('.modal', 'onSave', [{ ...SEED2.jobOrders[5], problem: 'x' }, 'JO-9007']); t('DU direct edit of another user\'s JO: denied, no write', isDenied(d), d);
  d = await denyCall('.modal', 'onSave', [{ ...SEED2.jobOrders[0], problem: 'x' }, 'JO-9001']); t('DU direct edit of another department\'s JO: denied, no write', isDenied(d), d);
  d = await denyCall('.modal', 'onSave', [{ ...SEED2.jobOrders[7], problem: 'x' }, 'JO-9008']); t('DU direct edit of own IN PROGRESS JO: denied, no write', isDenied(d), d);
  d = await denyCall('.modal', 'onSave', [{ ...SEED2.jobOrders[0], jobNo: undefined, assetNum: '5001', problem: 'out of scope' }, null]); t('DU direct create on an asset outside its categories: denied, no write', isDenied(d), d);
  { const b0 = mock.writes.length, s0 = JSON.stringify(mock.store); await ev(`T.propFrom('.modal','onSave')({...${JSON.stringify(SEED2.jobOrders[4])}, jobNo: undefined, repairType: 'Planned', problem: 'planned by DU'}, null); true`); await settle();
    t('DU direct create with Planned repair type: rejected in the save layer, no write', (await ev("T.body().includes('Department Users can only raise Unplanned repairs')")) && mock.writes.length === b0 && JSON.stringify(mock.store) === s0); }
  d = await denyCall('.modal', 'onSave', [{ ...jo2('JO-9006'), assetNum: '5001', problem: 'move asset' }, 'JO-9006']); t('DU edit moving own JO to an out-of-scope asset: denied, no write', isDenied(d), d);
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
  d = await denyCall('.main', 'onDeleteJO', ['JO-9006']); t('DU direct delete own JO: denied, no write', isDenied(d), d);
  d = await denyCall('.main', 'onStatusChange', ['JO-9006', 'IN PROGRESS']); t('DU direct start JO: denied, no write', isDenied(d), d);
  await nav('Settings');
  t('DU Settings: own profile only', await ev(`!T.all('.settings-tab').some(e=>['Users','Reset Data'].includes(T.txt(e)))`));
  d = await denyCall('.main', 'onSaveUser', [{ ...SEED2.users.find(u => u.id === 6), role: 'Admin' }, 1]); t('DU direct edit of another user: denied, no write', isDenied(d), d);
  n2 = mock.writes.length;
  await ev(`T.prop('onSaveUser')({...${JSON.stringify({ ...SEED2.users.find(u => u.id === 6), password: '' })}, role:'Admin', department:'HR', assignedCategories:['01 FUEL FARM'], extraBundles:['JOB_CARD_EDITOR']}, 6); true`); await settle();
  s2 = mock.store.users.find(u => u.id === 6);
  t('DU own-profile save cannot change role, department, categories or bundles', s2.role === 'Department User' && s2.department === 'Cement Plant' && JSON.stringify(s2.assignedCategories) === JSON.stringify(SEED2.users.find(u => u.id === 6).assignedCategories) && !s2.extraBundles, s2 && [s2.role, s2.department]);
  for (const p of ['Dashboard', 'Reports']) { await nav(p); t(`DU ${p} renders (scoped)`, await ev(`T.body().length > 100 && !T.body().includes('Something went wrong') && !T.body().includes('JO-9001') && (${JSON.stringify(p)} !== 'Reports' || !!document.querySelector('.report-grid'))`)); }

  // ---- Admin: user form (department, categories, bundle, validation) ----
  console.log('--- F2. admin user form');
  await fresh('t_admin', SEED2); await nav('Settings');
  await ev(`T.click('Add User','button'); true`); await sleep(300);
  await ev(`(()=>{ const m=T.all('.modal')[0]; const ins=T.all('input',m); T.setVal(ins[0],'New DU Person'); T.setVal(T.field('Employee ID *'),'TN001'); T.setVal(T.all('select',m)[0],'Department User'); return true; })()`); await sleep(250);
  const uf = await ev(`({ dept: !!T.field('Department'), cats: T.all('.modal input[type=checkbox]').length, bundle: T.body().includes('Job Card Editor capability') })`);
  t('Admin form: choosing Department User shows Department + category checkboxes, hides the editor bundle', uf.dept && uf.cats === plants.length && !uf.bundle, uf);
  const cp = await ev("(()=>{ const l=document.querySelector('.modal .cat-picker-list'); const cs=getComputedStyle(l); return { maxH: cs.maxHeight, oy: cs.overflowY, search: !!document.querySelector('.modal .cat-search'), count: T.txt(document.querySelector('.modal .cat-count')) }; })()");
  t('Admin form: categories in a compact fixed-height scrolling list with search and a selected count', cp.maxH === '180px' && cp.oy === 'auto' && cp.search && cp.count === '0 selected', cp);
  await ev("T.setVal(document.querySelector('.modal .cat-search'), 'cement'); true"); await sleep(150);
  t('Admin form: category search filters the list', await ev("T.all('.modal .cat-picker-list input[type=checkbox]').length === 1 && T.txt(T.all('.modal .cat-picker-list label')[0]).includes('CEMENT')"));
  await ev("(()=>{ T.all('.modal .cat-picker-list input[type=checkbox]')[0].click(); return true; })()"); await sleep(150);
  t('Admin form: selected categories are shown as chips and counted', await ev("T.all('.modal .cat-chip').length === 1 && T.txt(T.all('.modal .cat-chip')[0]).includes('CEMENT') && T.txt(document.querySelector('.modal .cat-count')) === '1 selected'"));
  await ev("(()=>{ T.all('.modal .cat-chip button')[0].click(); T.setVal(document.querySelector('.modal .cat-search'), ''); return true; })()"); await sleep(150);
  t('Admin form: removing a chip unselects it; clearing the search shows all categories again', await ev("T.all('.modal .cat-chip').length === 0 && T.all('.modal .cat-picker-list input[type=checkbox]').length === " + plants.length));
  n2 = mock.writes.length;
  await ev(`(()=>{ window.__alerts=[]; T.click('Add User','.modal button'); return true; })()`); await settle();
  t('Admin form: DU without department/category is rejected before saving (alert, no write)', (await ev('window.__alerts.join("|")')).includes('department') && writesSince(n2).length === 0);
  await ev(`(()=>{ T.setVal(T.field('Department'),'Cement Plant'); T.all('.modal input[type=checkbox]')[1].click(); window.__alerts=[]; T.click('Add User','.modal button'); return true; })()`); await settle();
  const ndu = mock.store.users.find(u => u.employeeId === 'TN001');
  t('Admin form: after creation the temporary password is shown once (notice)', await ev("!!document.querySelector('.temp-pw-notice input.temp-pw') && document.querySelector('.temp-pw-notice input.temp-pw').value.length >= 12"));
  await ev("(()=>{ const d = T.find('Done','.temp-pw-notice button'); if (d) d.click(); return true; })()"); await sleep(300);
  t('Admin form: valid DU created on the server with department, one category, forced password change; existing users untouched',
    !!ndu && ndu.role === 'Department User' && ndu.department === 'Cement Plant' && JSON.stringify(ndu.assignedCategories) === JSON.stringify([[...plants].sort()[1]]) && ndu.must_change_password === true && SEED2.users.every(s => acct(mock.store.users.find(u => u.id === s.id)) === acct(s)), ndu && [ndu.department, ndu.assignedCategories]);
  await ev("T.all('button').filter(b=>T.txt(b).includes('Edit')).find(b=>T.row('t_se') && T.row('t_se').contains(b)).click(); true"); await sleep(300);
  t('Admin form: six roles offered (five + Viewer, Phase 2B-3), no capability/bundle checkbox (SE edit)', await ev("JSON.stringify(T.all('.modal select')[0].options ? [...T.all('.modal select')[0].options].map(o=>o.value) : []) === JSON.stringify(['Admin','Assistant Engineer','Senior Engineer','Job Card Editor','Department User','Viewer']) && !T.modalText().includes('capability') && T.all('.modal input[type=checkbox]').length === 0"));
  await ev("T.all('.modal-close')[0].click(); true"); await sleep(200);
  await ev("T.click('Add User','button'); true"); await sleep(300);
  await ev("(()=>{ const m=T.all('.modal')[0]; const ins=T.all('input',m); T.setVal(ins[0],'New Editor'); T.setVal(T.field('Employee ID *'),'TN002'); T.setVal(T.all('select',m)[0],'Job Card Editor'); return true; })()"); await sleep(250);
  n2 = mock.writes.length;
  await ev("(()=>{ window.__alerts=[]; T.click('Add User','.modal button'); return true; })()"); await settle();
  t('Admin form: Job Card Editor without a section is rejected (alert, no write)', (await ev('window.__alerts.join("|")')).includes('section') && writesSince(n2).length === 0);
  t('Admin form: Section is a dropdown of exactly Electrical, Mechanical, Maintenance', await ev("(()=>{ const f=T.field('Section (copied to job orders when work is assigned) *'); return !!f && f.tagName === 'SELECT' && JSON.stringify([...f.options].map(o=>o.value)) === JSON.stringify(['','Electrical','Mechanical','Maintenance']); })()"));
  await ev("(()=>{ T.setVal(T.field('Section (copied to job orders when work is assigned) *'), 'Electrical'); window.__alerts=[]; T.click('Add User','.modal button'); return true; })()"); await settle();
  const njce = mock.store.users.find(u => u.employeeId === 'TN002');
  await ev("(()=>{ const d = T.find('Done','.temp-pw-notice button'); if (d) d.click(); return true; })()"); await sleep(300);
  t('Admin form: Job Card Editor saved with its section and no bundle', !!njce && njce.role === 'Job Card Editor' && njce.section === 'Electrical' && !('extraBundles' in njce), njce && [njce.role, njce.section]);
  await ev(`T.all('button').filter(b=>T.txt(b).includes('Edit')).find(b=>T.row('t_du') && T.row('t_du').contains(b)).click(); true`); await sleep(300);
  await ev(`(()=>{ T.setVal(T.all('.modal select')[0],'Assistant Engineer'); T.click('Update User','.modal button'); return true; })()`); await settle();
  s2 = mock.store.users.find(u => u.id === 6);
  t('Admin form: DU changed to AE drops department/categories, keeps id/username/password (server update)', s2.role === 'Assistant Engineer' && !('department' in s2) && !('assignedCategories' in s2) && s2.username === 't_du' && s2.password === SEED2.users.find(u => u.id === 6).password);
  n2 = mock.writes.length;
  d = await (async () => { await ev(`T.prop('onSaveUser')({ employeeId:'BD001', fullName:'Bad', role:'Department User', department:'Cement Plant', assignedCategories:['${plants[1]}'], extraBundles:['JOB_CARD_EDITOR'] }, null); true`); await settle(); return { toast: await ev(`T.body().includes('Additional capabilities are not supported')`), writes: writesSince(n2).length }; })();
  t('saveUser (mutation layer) rejects any capability bundle even without the form: toast, no write', d.toast && d.writes === 0, d);
  n2 = mock.writes.length;
  await ev(`T.prop('onSaveUser')({ employeeId:'BD002', fullName:'Bad', role:'Department User', department:'Nowhere', assignedCategories:['${plants[1]}'] }, null); true`); await settle();
  t('saveUser rejects a department outside the fixed list: no write', writesSince(n2).length === 0 && !mock.store.users.some(u => u.employeeId === 'BD002'));

  // ---- Category rename propagation (§7 gate 8) ----
  console.log('--- F2. category rename propagation');
  await fresh('t_admin', SEED2); await nav('Asset Registry');
  await ev(`T.click('Add Asset','button'); true`); await sleep(300);
  const OLD = plants[1], NEW = OLD + ' WORKS';
  n2 = mock.writes.length;
  await ev(`T.propFrom('.modal','onRenameCategory')(${JSON.stringify(OLD)}, ${JSON.stringify(NEW.toLowerCase())}); true`); await settle();
  const st = mock.store;
  t('RENAME: category list updated in place, same count', st.customPlants.includes(NEW) && !st.customPlants.includes(OLD) && st.customPlants.length === plants.length);
  t('RENAME: assets of that category moved, others untouched', st.assets.find(a => a.num === '5003').plant === NEW && st.assets.filter(a => a.num !== '5003').every(a => JSON.stringify(a) === JSON.stringify(SEED2.assets.find(s => s.num === a.num))));
  t('RENAME: JOs of that category moved; unknown fields kept; others untouched', ['JO-9006', 'JO-9007', 'JO-9008'].every(no => jo2(no).assetCategory === NEW && jo2(no).legacyField === 'keep-' + no) && ['JO-9001', 'JO-9002', 'JO-9003', 'JO-9004'].every(no => JSON.stringify(jo2(no)) === JSON.stringify(SEED2.jobOrders.find(j => j.jobNo === no))),
    { moved: ['JO-9006', 'JO-9007', 'JO-9008'].map(no => jo2(no) && jo2(no).assetCategory), others: ['JO-9001', 'JO-9002', 'JO-9003', 'JO-9004'].filter(no => JSON.stringify(jo2(no)) !== JSON.stringify(SEED2.jobOrders.find(j => j.jobNo === no))),
      jobWrites: writesSince(n2).filter(w => w.key === 'jobOrders').map(w => w.len) });
  t('RENAME: the DU\'s assigned category follows; other users untouched', JSON.stringify(st.users.find(u => u.id === 6).assignedCategories) === JSON.stringify([NEW]) && st.users.filter(u => u.id !== 6).every(u => acct(u) === acct(SEED2.users.find(s => s.id === u.id))));
  n2 = mock.writes.length;
  await ev(`T.propFrom('.modal','onRenameCategory')(${JSON.stringify(plants[0])}, ${JSON.stringify(plants[2].toLowerCase())}); true`); await settle();
  t('RENAME to an existing name (case-insensitive): refused with a toast, nothing written', writesSince(n2).length === 0 && (await ev(`T.body().includes('already exists — rename cancelled')`)) && mock.store.customPlants.includes(plants[0]));
  n2 = mock.writes.length;
  await ev(`T.propFrom('.modal','onRenameCategory')(${JSON.stringify(plants[0])}, '   '); true`); await settle();
  t('RENAME to a blank name: ignored, nothing written', writesSince(n2).length === 0);
  await ev(`T.propFrom('.modal','onRenameCategory')('99 NO SUCH CATEGORY', 'ANYTHING'); true`); await settle();
  t('RENAME of an unknown category: refused, nothing written', writesSince(n2).length === 0 && (await ev(`T.body().includes('not found — rename cancelled')`)));
  mock.failKeys.add('customPlants'); n2 = mock.writes.length;
  await ev(`T.propFrom('.modal','onRenameCategory')(${JSON.stringify(plants[3])}, ${JSON.stringify(plants[3] + ' X')}); true`); await settle();
  t('RENAME save failure (server error): user warned "Not saved" naming categories; nothing stored (one server transaction)', (await ev(`T.body().includes('Not saved:') && T.body().includes('categories')`)) && !mock.store.customPlants.includes(plants[3] + ' X') && writesSince(n2).some(w => w.failed));
  mock.failKeys.clear();
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);

  // ============ F5: approval separate from closing (§4) ============
  console.log('--- F5. approval separate from closing');
  const deny5 = async (prop, args, toastText) => { const before = mock.writes.length, sb = JSON.stringify(mock.store);
    await ev(`window.__t0 = T.body().length; (T.prop(${JSON.stringify(prop)}))(...${JSON.stringify(args)}); true`); await settle();
    return { toast: await ev(`T.body().includes(${JSON.stringify(toastText)})`), writes: mock.writes.length - before, same: JSON.stringify(mock.store) === sb }; };
  const ok5 = x => x.toast && x.writes === 0 && x.same;
  await fresh('t_admin'); await nav('Job Orders'); await ev(`T.click('Completed','button'); true`); await sleep(300);
  t('F5 legacy COMPLETED JO-9003: shown "Awaiting approval", button offers Approve (not Close); no field written', await ev(`T.txt(T.row('JO-9003')).includes('Awaiting approval') && T.find('COMPLETED ›','button',T.row('JO-9003')).title === 'Approve completion'`) && !('approvalStatus' in jo2('JO-9003')));
  let x5 = await deny5('onCloseJO', ['JO-9003', { closedDate: '2026-10-10' }], 'approve the completion before closing');
  t('F5 close without approval (direct call): rejected in the save layer, no write', ok5(x5), x5);
  x5 = await deny5('onStatusChange', ['JO-9003', 'CLOSED'], 'You do not have permission'); t('F5 closing through a status change is impossible, no write', ok5(x5), x5);
  x5 = await deny5('onApproveJO', ['JO-9001'], 'only a COMPLETED job order'); t('F5 approve an OPEN JO: rejected, no write', ok5(x5), x5);
  x5 = await deny5('onStatusChange', ['JO-9001', 'COMPLETED'], 'is not a valid step'); t('F5 OPEN → COMPLETED (skipping a step): rejected, no write', ok5(x5), x5);
  x5 = await deny5('onRevertJO', ['JO-9003'], 'only a CLOSED job order can be reverted'); t('F5 revert a non-closed JO: rejected, no write', ok5(x5), x5);
  await ev(`T.click('COMPLETED ›','button',T.row('JO-9003')); true`); await sleep(300); await ev(`T.click('Approve Completion','button.btn-success'); true`); await settle();
  let a5 = jo2('JO-9003');
  t('F5 Admin approves legacy JO-9003: APPROVED, status COMPLETED, unknown field kept, other JOs untouched', a5.approvalStatus === 'APPROVED' && a5.status === 'COMPLETED' && a5.approvedBy === 'Test Admin' && a5.legacyField === 'keep-JO-9003' && ['JO-9001', 'JO-9002', 'JO-9004'].every(no => JSON.stringify(jo2(no)) === JSON.stringify(SEED.jobOrders.find(j => j.jobNo === no))));
  x5 = await deny5('onApproveJO', ['JO-9003'], 'only a COMPLETED job order that is not yet approved'); t('F5 approve twice: rejected, no write', ok5(x5), x5);
  await ev(`T.byTitle('Edit', T.row('JO-9003'))[0].click(); true`); await sleep(400); await ev(`T.click('Update Job Order','button'); true`); await settle();
  t('F5 open + save the edit form without changes: approval kept (no spurious reset from blank form rows)', jo2('JO-9003').approvalStatus === 'APPROVED' && jo2('JO-9003').approvalHistory?.length === 1);
  await ev(`T.byTitle('Edit', T.row('JO-9003'))[0].click(); true`); await sleep(400);
  await ev(`(()=>{ T.setVal(T.field('Details of the Problem'), 'Problem text edited after approval'); T.click('Update Job Order','button'); return true; })()`); await settle();
  a5 = jo2('JO-9003');
  t('F5 editing sections 1-3 after approval keeps the approval', a5.problem === 'Problem text edited after approval' && a5.approvalStatus === 'APPROVED' && a5.approvedBy === 'Test Admin' && a5.approvalHistory?.length === 1);
  await ev(`T.byTitle('Edit', T.row('JO-9003'))[0].click(); true`); await sleep(400);
  await ev(`(()=>{ T.setVal(T.field('Details of Work Done'), 'Work redone after approval'); T.click('Update Job Order','button'); return true; })()`); await settle();
  a5 = jo2('JO-9003');
  t('F5 editing completion details after approval → PENDING, approver fields cleared, RESET appended, history kept', a5.workDone === 'Work redone after approval' && a5.approvalStatus === 'PENDING' && !('approvedBy' in a5) && !('approvedAt' in a5) && a5.approvalHistory?.length === 2 && a5.approvalHistory?.[0]?.event === 'APPROVED' && a5.approvalHistory?.[1]?.event === 'RESET' && a5.approvalHistory?.[1]?.reason === 'completion details changed' && a5.status === 'COMPLETED', a5.approvalHistory);
  t('F5 reset is announced to the user', await ev(`T.body().includes('approval reset to pending')`));
  await ev(`T.byTitle('Edit', T.row('JO-9003'))[0].click(); true`); await sleep(400);
  const nf5 = mock.writes.length;
  await ev(`T.propFrom('.modal','onSave')({...${JSON.stringify(SEED.jobOrders[2])}, approvalStatus:'APPROVED', approvedBy:'Forged', status:'CLOSED', closedBy:'Forged', closedDate:'2026-01-01', approvalHistory:[] }, 'JO-9003'); true`); await settle();
  a5 = jo2('JO-9003');
  t('F5 forged approval/closure/status in an edit save are ignored (taken from the stored record); history not erased', a5.status === 'COMPLETED' && a5.approvalStatus === 'PENDING' && !a5.closedBy && a5.approvedBy !== 'Forged' && a5.approvalHistory?.length >= 2 && writesSince(nf5).length >= 1, [a5.status, a5.approvalStatus, a5.closedBy, (a5.approvalHistory || []).length]);
  await ev(`T.all('.modal-close').forEach(b=>b.click()); true`); await sleep(200);
  await ev(`T.click('COMPLETED ›','button',T.row('JO-9003')); true`); await sleep(300); await ev(`T.click('Approve Completion','button.btn-success'); true`); await settle();
  const approvedAt5 = jo2('JO-9003').approvedAt;
  await ev(`T.click('COMPLETED ›','button',T.row('JO-9003')); true`); await sleep(300);
  t('F5b close dialog shows the automatic approval time separately from the date to select', await ev(`T.modalText().includes('approved at (automatic)') && !!T.field('Closed Date * (selected)')`));
  await ev(`(()=>{ T.setVal(T.field('Closed Date * (selected)'), '2026-01-15'); T.click('Close Job Order','button.btn-success'); return true; })()`); await settle();
  a5 = jo2('JO-9003');
  t('F5 re-approve then close: CLOSED; full history kept in order (APPROVED, RESET…, APPROVED, CLOSED)', a5.status === 'CLOSED' && a5.approvalStatus === 'APPROVED' && a5.approvalHistory?.[0]?.event === 'APPROVED' && a5.approvalHistory?.some(e => e.event === 'RESET') && a5.approvalHistory?.[a5.approvalHistory?.length - 2]?.event === 'APPROVED' && a5.approvalHistory?.[a5.approvalHistory?.length - 1]?.event === 'CLOSED', (a5.approvalHistory || []).map(e => e.event));
  t('F5b closedDate = the selected date; approvedAt untouched by closing; CLOSED event records both', a5.closedDate === '2026-01-15' && a5.approvedAt === approvedAt5 && a5.approvalHistory?.[a5.approvalHistory?.length - 1]?.closedDate === '2026-01-15' && a5.approvalHistory?.[a5.approvalHistory?.length - 1]?.at.slice(0, 10) !== '2026-01-15', [a5.closedDate, a5.approvedAt]);
  await ev(`T.click('Closed','button'); true`); await sleep(300);
  await ev(`T.byTitle('View', T.row('JO-9003'))[0].click(); true`); await sleep(300);
  t('F5 view modal of a new closed JO: separate "Completion Approval" and "Closure" blocks', await ev(`T.modalText().includes('completion approval — approved') && T.modalText().includes('closure') && T.modalText().includes('closed by')`));
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
  await ev(`T.byTitle('View', T.row('JO-9004'))[0].click(); true`); await sleep(300);
  t('F5 view modal of a legacy closed JO: unchanged single "Approval" block', await ev(`!T.modalText().includes('completion approval') && T.modalText().includes('approved by') && T.modalText().includes('synthetic closer')`));
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
  const p0 = await ev('window.__prints.length');
  await ev(`T.byTitle('Download PDF', T.row('JO-9003'))[0].click(); true`); await sleep(300);
  t('F5 JO PDF of a new closed JO has both approval and closure blocks', await ev(`window.__prints.length === ${p0 + 1} && window.__prints[${p0}].document._h.includes('COMPLETION APPROVAL — APPROVED') && window.__prints[${p0}].document._h.includes('CLOSURE')`));
  await ev(`T.byTitle('Revert to Completed', T.row('JO-9004'))[0].click(); true`); await settle();
  await ev(`T.click('Completed','button'); true`); await sleep(300);
  t('F5 legacy CLOSED reverted → COMPLETED without approval (REVERTED recorded); must be approved before it can be closed again', jo2('JO-9004').status === 'COMPLETED' && !('approvalStatus' in jo2('JO-9004')) && JSON.stringify((jo2('JO-9004').approvalHistory || []).map(e => e.event)) === '["REVERTED"]' && (await ev(`T.find('COMPLETED ›','button',T.row('JO-9004')).title === 'Approve completion'`)));
  // CSV import validation (§8, D16, D20)
  const cols = (jobNo, status, approved = '') => { const v = Array(27).fill(''); v[0] = jobNo; v[1] = '2026-10-05'; v[2] = '5001'; v[3] = 'Test Pump'; v[7] = 'Engineering'; v[12] = status; v[26] = approved; return v.map(x => '"' + x + '"').join(','); };
  const csv5 = ['header', cols('JO-9101', 'OPEN'), cols('JO-9102', 'COMPLETED', 'Boss'), cols('JO-9103', 'CLOSED', 'Boss'), cols('JO-9104', 'DONE'), cols('JO-9105', ''), cols('JO-9106', 'IN PROGRESS'), cols('JO-9001', 'CLOSED')].join('\n');
  const beforeImport = JSON.parse(JSON.stringify(mock.store.jobOrders));
  await nav('Job Orders');
  await ev(`window.__alerts=[]; T.prop('onImportCSV')(new File([${JSON.stringify(csv5)}], 'jo.csv', {type:'text/csv'})); true`); await settle();
  const im = no => mock.store.jobOrders.find(j => j.jobNo === no);
  const alerts5 = await ev('window.__alerts.join("|")');
  t('IMPORT (confirmed 2026-10-11): an IN PROGRESS row is imported without an assignment (assignment is required only when work is started in the app)', !!im('JO-9106') && im('JO-9106').status === 'IN PROGRESS' && !('assignedTo' in im('JO-9106')) && !('assignedToId' in im('JO-9106')));
  t('IMPORT: OPEN and blank-status rows imported as OPEN', im('JO-9101') && im('JO-9101').status === 'OPEN' && im('JO-9105') && im('JO-9105').status === 'OPEN');
  t('IMPORT: COMPLETED imported as PENDING approval; free-text "approved" kept but never approves', im('JO-9102') && im('JO-9102').status === 'COMPLETED' && im('JO-9102').approvalStatus === 'PENDING' && im('JO-9102').approved === 'Boss' && !im('JO-9102').approvedBy);
  t('IMPORT: CLOSED and unknown statuses rejected and listed', !im('JO-9103') && !im('JO-9104') && alerts5.includes('JO-9103: CLOSED') && alerts5.includes('JO-9104: DONE'), alerts5);
  t('IMPORT: existing JOs untouched (incl. a CSV row reusing an existing number)', beforeImport.every(b => JSON.stringify(im(b.jobNo)) === JSON.stringify(b)) && mock.store.jobOrders.length === beforeImport.length + 4);
  x5 = await deny5('onCloseJO', ['JO-9102', { closedDate: '2026-10-10' }], 'approve the completion before closing'); t('IMPORT: an imported COMPLETED JO cannot be closed without approval', ok5(x5), x5);
  const b5 = await ev('window.__blobs.length');
  await ev("T.click('↓ Export','button'); true"); await sleep(400);
  const csvText = await ev('window.__blobs[' + b5 + '] ? window.__blobs[' + b5 + '].text() : ""');
  const csvRows = csvText.split('\n'), abI = csvRows[0].split(',').indexOf('Approved By');
  const abOf = no => { const r = csvRows.find(l => l.startsWith('"' + no + '"')); return r ? JSON.parse('[' + r + ']')[abI] : undefined; };
  t('F5b CSV export (real download): "Approved By" = approver for JO-9003; empty for legacy-reverted JO-9004 and imported JO-9102 (free text "Boss")', abOf('JO-9003') === 'Test Admin' && abOf('JO-9004') === '' && abOf('JO-9102') === '' && abI === 22, [abOf('JO-9003'), abOf('JO-9004'), abOf('JO-9102')]);
  await ev("T.click('Raise Job Order','button'); true"); await sleep(400);
  t('TYPE OF REPAIR (confirmed): Admin keeps both options, Planned and Unplanned', await ev("JSON.stringify(T.all('.modal input[name=rtype]').map(r => T.txt(r.parentElement))) === JSON.stringify(['Planned','Unplanned'])"));
  await ev('T.propFrom(".modal","onSave")({...' + JSON.stringify(SEED.jobOrders[0]) + ', jobNo:"X", status:"CLOSED", approvalStatus:"APPROVED", approvedBy:"Forged", closedBy:"Forged", closedDate:"2026-01-01", approvalHistory:[{event:"APPROVED"}]}, null); true'); await settle();
  const forged = mock.store.jobOrders.find(j => j.problem === 'Synthetic problem JO-9001' && j.jobNo !== 'JO-9001');   // the new JO (number assigned by the app)
  t('F5b create cannot set status/approval/closure/history: new JO is OPEN with none of them', !!forged && forged.status === 'OPEN' && !('approvalStatus' in forged) && !('approvedBy' in forged) && !('approvalHistory' in forged) && !forged.closedBy, forged && [forged.jobNo, forged.status]);
  await ev("T.click('In Progress','button'); true"); await sleep(250);
  await ev("T.byTitle('Edit', T.row('JO-9002'))[0].click(); true"); await sleep(400);
  await ev('T.propFrom(".modal","onSave")({...' + JSON.stringify(SEED.jobOrders[1]) + ', status:"OPEN", approvalStatus:"APPROVED"}, "JO-9002"); true'); await settle();
  t('F5b edit cannot change status or approval (only the dedicated actions can)', jo2('JO-9002').status === 'IN PROGRESS' && !('approvalStatus' in jo2('JO-9002')));
  await ev("T.all('.modal-close').forEach(b=>b.click()); true"); await sleep(200);
  // who may approve / close (role-based only)
  await fresh('t_ae'); await nav('Job Orders'); await ev(`T.click('Completed','button'); true`); await sleep(300);
  await ev(`T.click('COMPLETED ›','button',T.row('JO-9003')); true`); await sleep(300); await ev(`T.click('Approve Completion','button.btn-success'); true`); await settle();
  t('F5 AE may approve', jo2('JO-9003').approvalStatus === 'APPROVED' && jo2('JO-9003').approvedBy === 'Test AE');
  await fresh('t_se', SEED2); await nav('Job Orders');
  await ev(`T.prop('onApproveJO')('JO-9003'); true`); await settle();
  t('F5 Senior Engineer may approve (role), approver recorded', jo2('JO-9003').approvalStatus === 'APPROVED' && jo2('JO-9003').approvedById === 3);
  await fresh('t_jce', SEED2); await nav('Job Orders');
  x5 = await deny5('onApproveJO', ['JO-9003'], 'You do not have permission'); t('F5 Job Card Editor cannot approve, no write', ok5(x5), x5);
  x5 = await deny5('onCloseJO', ['JO-9003', { closedDate: '2026-10-10' }], 'You do not have permission'); t('F5 Job Card Editor cannot close, no write', ok5(x5), x5);
  await fresh('t_du', SEED2); await nav('Job Orders');
  x5 = await deny5('onApproveJO', ['JO-9006'], 'You do not have permission'); t('F5 Department User cannot approve, no write', ok5(x5), x5);

  // ============ D19: downloads (Department Users: Job Order PDFs only) ============
  console.log('--- D19. downloads');
  const me19 = JSON.stringify(SEED2.users.find(u => u.id === 6));   // the signed-in Department User's stored record (synthetic)
  const prints = () => ev('window.__prints.length'), dls = () => ev('window.__downloads.slice()');
  await fresh('t_du', SEED2); await nav('Job Orders');
  let p19 = await prints();
  await ev(`T.byTitle('Download PDF', T.row('JO-9006'))[0].click(); true`); await sleep(300);
  t('D19 DU: Job Order PDF of an in-scope JO is allowed', (await prints()) === p19 + 1 && (await ev(`window.__prints[${p19}].document._h.includes('JO-9006')`)));
  p19 = await prints();
  await ev(`window.__alerts=[]; printJOPDF(${JSON.stringify(SEED2.jobOrders[0])}, ${me19}); true`); await sleep(200);
  t('D19 DU: JO PDF of another department refused by the handler (direct call)', (await prints()) === p19 && (await ev(`window.__alerts.join('|').includes('not available')`)));
  await nav('Asset Registry'); await ev(`T.byTitle('View Asset', T.row('5003'))[0].click(); true`); await sleep(300);
  t('D19 DU: no asset-sheet download button in the asset view', await ev(`!T.all('.modal button').some(b=>T.txt(b).includes('Download PDF'))`));
  await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
  p19 = await prints();
  await ev(`window.__alerts=[]; printAssetPDF(${JSON.stringify(SEED2.assets.find(a => a.num === '5003'))}, [], ${me19}); true`); await sleep(200);
  t('D19 DU: asset sheet refused by the handler even for an in-scope asset (direct call)', (await prints()) === p19 && (await ev(`window.__alerts.length === 1`)));
  await nav('Reports');
  t('D19 DU: Reports page still renders (scoped counts), no download buttons, explanatory note', await ev(`!T.all('button').some(b=>T.txt(b).includes('Download PDF')) && T.body().includes('Report downloads are not available for your role') && T.txt(document.querySelector('.report-grid')||document.body).includes('Asset Master List') && T.txt(document.querySelector('.report-grid')||document.body).includes('1 assets')`));
  p19 = await prints();
  await ev(`window.__alerts=[]; ['assetMaster','allJobOrders','breakdown','openJobOrders'].forEach(k => printReport(k, [], [], ${me19})); true`); await sleep(200);
  t('D19 DU: all four report handlers refuse (direct calls)', (await prints()) === p19 && (await ev(`window.__alerts.length === 4`)));
  const d0 = (await dls()).length;
  await ev(`window.__alerts=[]; exportAssetsCSV(${JSON.stringify(SEED2.assets)}, ${me19}); exportJobOrdersCSV(${JSON.stringify(SEED2.jobOrders)}, ${me19}); exportPMCSV([], ${me19}); true`); await sleep(200);
  t('D19 DU: CSV export handlers refuse (direct calls), no file produced', (await dls()).length === d0 && (await ev(`window.__alerts.length === 3`)));
  // unchanged for the other roles
  for (const u of ['t_admin', 't_ae', 't_se', 't_jce']) {
    await fresh(u, SEED2); await nav('Reports');
    p19 = await prints();
    const nb = await ev(`T.all('button').filter(b=>T.txt(b).includes('Download PDF')).length`);
    await ev(`T.all('button').filter(b=>T.txt(b).includes('Download PDF')).forEach(b=>b.click()); true`); await sleep(400);
    t(`D19 ${u}: four report downloads available and produced`, nb === 4 && (await prints()) === p19 + 4, [nb]);
    await nav('Asset Registry'); await ev(`T.byTitle('View Asset', T.row('5001'))[0].click(); true`); await sleep(300);
    p19 = await prints();
    await ev(`(T.all('.modal button').find(b=>T.txt(b).includes('Download PDF'))||{click(){}}).click(); true`); await sleep(300);
    t(`D19 ${u}: asset sheet download available`, (await prints()) === p19 + 1);
    await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
    const dd = (await dls()).length;
    await ev(`T.click('↓ Export','button'); true`); await sleep(300);
    t(`D19 ${u}: asset CSV export available`, (await dls()).slice(dd).includes('assets_export.csv'));
  }

  // ============ 2026-10-11: My Profile + Change Password (Department User, Job Card Editor) ============
  console.log('--- R2. My Profile and Change Password');
  const shaHex = x => require('crypto').createHash('sha256').update(x).digest('hex');
  for (const [u, id, details] of [['t_du', 6, ['Department', 'Cement Plant', 'Asset Categories', plants[1]]], ['t_jce', 5, ['Section', 'Mechanical']]]) {
    await fresh(u, SEED2); await nav('Settings');
    await ev("(T.all('.settings-tab').find(e=>T.txt(e).includes('Profile'))||{click(){}}).click(); true"); await sleep(250);
    const pv = await ev("({ text: T.txt(document.querySelector('.main')), edit: !!T.find('Edit My Profile','button'), pw: !!T.find('Change Password','button') })");
    t('PROFILE ' + u + ': details shown read-only (role, ' + details.filter((_, i) => i % 2 === 0).join(', ') + ', role summary); no Edit My Profile; Change Password offered',
      !pv.edit && pv.pw && details.every(x => pv.text.includes(x)) && pv.text.includes('What this role can do') && pv.text.includes(SEED2.users.find(x => x.id === id).role), [pv.edit, pv.pw]);
    const b0 = mock.writes.length, s0 = JSON.stringify(mock.store.users);
    await ev("T.prop('onSaveUser')({..." + JSON.stringify({ ...SEED2.users.find(x => x.id === id), password: '' }) + ", fullName:'Renamed By Self', role:'Admin'}, " + id + "); true"); await settle();
    t('PROFILE ' + u + ': direct profile save (name/role) refused, no write', (await ev("T.body().includes('You do not have permission for this action.')")) && mock.writes.length === b0 && JSON.stringify(mock.store.users) === s0);
    // change password through the dialog
    await ev("T.click('Change Password','button'); true"); await sleep(300);
    const pwSet = (c, n, f) => ev("(()=>{ const ins=T.all('.modal input[type=password]'); T.setVal(ins[0]," + JSON.stringify(c) + "); T.setVal(ins[1]," + JSON.stringify(n) + "); T.setVal(ins[2]," + JSON.stringify(f) + "); window.__alerts=[]; T.click('Change Password','.modal button'); return true; })()");
    let w0 = mock.writes.length;
    await pwSet(PASS[u], 'NewSecret-123', 'Different-123'); await settle();
    t('PASSWORD ' + u + ': confirmation mismatch refused (alert, no write)', (await ev('window.__alerts.join("|")')).includes('do not match') && mock.writes.length === w0);
    await pwSet(PASS[u], 'short', 'short'); await settle();
    t('PASSWORD ' + u + ': too short refused (alert, no write)', (await ev('window.__alerts.join("|")')).includes('at least 8') && mock.writes.length === w0);
    await pwSet('Wrong-Password-1', 'NewSecret-123', 'NewSecret-123'); await settle();
    t('PASSWORD ' + u + ': wrong current password refused (toast, no write)', (await ev("T.body().includes('The current password is incorrect.')")) && mock.writes.length === w0);
    await pwSet(PASS[u], 'NewSecret-123', 'NewSecret-123'); await settle();
    const after = mock.store.users.find(x => x.id === id), before = SEED2.users.find(x => x.id === id);
    t('PASSWORD ' + u + ': changed — only the password hash differs; all users kept', after.password === shaHex('NewSecret-123') && acct({ ...after, password: '' }) === acct({ ...before, password: '' }) && mock.store.users.length === SEED2.users.length);
    t('PASSWORD ' + u + ': old password no longer signs in', (await fresh(u, SEED2, { keep: true, expectFail: true })) === false);
    t('PASSWORD ' + u + ': new password signs in', (await fresh(u, SEED2, { keep: true, password: 'NewSecret-123', expectFail: true })) === true);
  }

  // ============ 2026-10-11: work assignment when a job order is started ============
  console.log('--- R2. work assignment');
  const sel = async id => ev("T.setVal(T.all('.modal select')[0], " + JSON.stringify(String(id)) + "); true");
  await fresh('t_ae', SEED2); await nav('Job Orders');
  await ev("T.click('OPEN ›','button',T.row('JO-9001')); true"); await sleep(300);
  const opts = await ev("[...T.all('.modal select')[0].options].map(o => o.textContent)");
  t('ASSIGN AE dialog lists only active Job Card Editors with a section', JSON.stringify(opts) === JSON.stringify(['— Select an active Job Card Editor —', 'Test JCE — Mechanical']), opts);
  let a0 = mock.writes.length;
  await ev("window.__alerts=[]; T.click('Move to In Progress','button'); true"); await settle();
  t('ASSIGN AE without choosing an editor: refused with an explanation, no write, still OPEN', (await ev('window.__alerts.join("|")')).includes('Select the Job Card Editor') && mock.writes.length === a0 && jo2('JO-9001').status === 'OPEN');
  await ev("T.all('.modal-close').forEach(b=>b.click()); true"); await sleep(200);
  for (const [label, arg] of [['no assignee', undefined], ['inactive editor', { assigneeId: 7 }], ['editor without section', { assigneeId: 8 }], ['non-editor (AE)', { assigneeId: 2 }], ['Senior Engineer', { assigneeId: 3 }], ['deleted/unknown user', { assigneeId: 99 }]]) {
    const w = mock.writes.length, st = JSON.stringify(mock.store.jobOrders);
    await ev("T.prop('onStatusChange')('JO-9001', 'IN PROGRESS'" + (arg ? ', ' + JSON.stringify(arg) : '') + "); true"); await settle();
    t('ASSIGN save layer refuses start with ' + label + ' (toast, no write)', (await ev("T.body().includes('select an active Job Card Editor')")) && mock.writes.length === w && JSON.stringify(mock.store.jobOrders) === st);
  }
  a0 = mock.writes.length;
  await ev("T.click('OPEN ›','button',T.row('JO-9001')); true"); await sleep(300); await sel(5); await ev("T.click('Move to In Progress','button'); true"); await settle();
  let aj = jo2('JO-9001');
  t('ASSIGN AE start with editor: IN PROGRESS + Assigned To/ID = editor, Received By = AE, Section = editor section; unknown fields kept', aj.status === 'IN PROGRESS' && aj.assignedTo === 'Test JCE' && aj.assignedToId === 5 && aj.recvName === 'Test AE' && aj.section === 'Mechanical' && aj.legacyField === 'keep-JO-9001');
  t('ASSIGN status and assignment saved together in ONE jobOrders write', writesSince(a0).filter(w => w.key === 'jobOrders').length === 1 && writesSince(a0).filter(w => w.key === 'jobOrders')[0].value.find(j => j.jobNo === 'JO-9001').assignedTo === 'Test JCE');
  t('ASSIGN other job orders untouched (historical JO-9002 gets no assignment)', !('assignedTo' in jo2('JO-9002')) && ['JO-9002', 'JO-9003', 'JO-9004', 'JO-9006', 'JO-9007', 'JO-9008'].every(no => JSON.stringify(jo2(no)) === JSON.stringify(SEED2.jobOrders.find(j => j.jobNo === no))));
  await ev("T.click('In Progress','button'); true"); await sleep(250);
  await ev("T.byTitle('Edit', T.row('JO-9001'))[0].click(); true"); await sleep(400);
  t('ASSIGN edit form shows Work Assigned To read-only', await ev("(()=>{ const f=T.field('Work Assigned To'); return !!f && f.readOnly && f.value === 'Test JCE'; })()"));
  await ev("T.propFrom('.modal','onSave')({..." + JSON.stringify(SEED2.jobOrders[0]) + ", status:'IN PROGRESS', assignedTo:'Forged Person', assignedToId:1}, 'JO-9001'); true"); await settle();
  t('ASSIGN the edit save cannot change the assignment (workflow-only field)', jo2('JO-9001').assignedTo === 'Test JCE' && jo2('JO-9001').assignedToId === 5);
  await ev("T.all('.modal-close').forEach(b=>b.click()); true"); await sleep(200);
  await ev("T.byTitle('View', T.row('JO-9001'))[0].click(); true"); await sleep(300);
  t('ASSIGN view modal shows Work Assigned To', await ev("T.modalText().includes('work assigned to') && T.modalText().includes('test jce')"));
  await ev("T.all('.modal-close')[0].click(); true"); await sleep(200);
  await fresh('t_admin', SEED2); await nav('Job Orders');
  await ev("T.click('OPEN ›','button',T.row('JO-9006')); true"); await sleep(300); await sel(5); await ev("T.click('Move to In Progress','button'); true"); await settle();
  t('ASSIGN Admin start: Received By = Admin, assigned to the chosen editor', jo2('JO-9006').status === 'IN PROGRESS' && jo2('JO-9006').recvName === 'Test Admin' && jo2('JO-9006').assignedTo === 'Test JCE' && jo2('JO-9006').section === 'Mechanical');
  await fresh('t_jce', SEED2); await nav('Job Orders');
  await ev("T.click('OPEN ›','button',T.row('JO-9007')); true"); await sleep(300);
  t('ASSIGN JCE dialog: no editor choice, states the work is assigned to them', await ev("T.all('.modal select').length === 0 && T.modalText().includes('work will be assigned to you') && T.modalText().includes('mechanical')"));
  await ev("T.click('Move to In Progress','button'); true"); await settle();
  t('ASSIGN JCE start: Assigned To / Received By = the JCE, Section = their section', jo2('JO-9007').assignedTo === 'Test JCE' && jo2('JO-9007').assignedToId === 5 && jo2('JO-9007').recvName === 'Test JCE' && jo2('JO-9007').section === 'Mechanical');
  { const w = mock.writes.length; await ev("T.prop('onStatusChange')('JO-9007', 'IN PROGRESS', {assigneeId: 8}); true"); await settle();
    t('ASSIGN JCE cannot re-start an IN PROGRESS JO (not a valid step), no write', (await ev("T.body().includes('is not a valid step')")) && mock.writes.length === w); }
  { const NS = JSON.parse(JSON.stringify(SEED2)); NS.users.push({ id: 8, username: 't_jce_ns', employeeId: 'TJ008', fullName: 'Test JCE NoSection', role: 'Job Card Editor', active: true, plainPassword: 'Synthetic-JCE-NS-1' });
    await mock.reset(NS);
    t('ASSIGN a Job Card Editor without a section cannot exist (the server refuses the account)', !mock.store.users.some(u => u.id === 8)); }
  await fresh('t_se', SEED2); await nav('Job Orders');
  t('ASSIGN Senior Engineer workflow unchanged: no start action, no assignment dialog', await ev("!T.find('OPEN ›','button',T.row('JO-9001'))"));

  // ============ R3 (2026-10-11): sidebar, profile, close dialog, safe import, Job Card Editor sections ============
  // R4 (2026-10-11): the toggle moved out of the top bar to the top of the content area (owner request)
  console.log('--- R3/R4. sidebar toggle at the top of the content area');
  await fresh('t_admin');
  const lay = await ev("(()=>{ const sb=document.querySelector('.sidebar'), first=sb.firstElementChild, ni=document.querySelector('.nav-item'), cs=getComputedStyle(ni), tg=document.querySelector('.sidebar-toggle');"
    + " return { count: T.all('.sidebar-toggle').length, inTopbar: !!document.querySelector('.topbar .sidebar-toggle'), inSidebar: !!document.querySelector('.sidebar .sidebar-toggle'),"
    + " inMainTop: !!tg && tg.parentElement.classList.contains('main-toolbar') && tg.parentElement.parentElement === document.querySelector('.main') && document.querySelector('.main').firstElementChild === tg.parentElement,"
    + " firstIsSection: first.classList.contains('nav-section') && T.txt(first) === 'Main',"
    + " padTop: getComputedStyle(sb).paddingTop, itemPad: cs.paddingTop + ' ' + cs.paddingLeft, gap: cs.columnGap, label: T.txt(ni.querySelector('.nav-label')) }; })()");
  t('R4 sidebar: exactly one toggle, first in the content area; not in the top bar, not in the sidebar', lay.count === 1 && lay.inMainTop && !lay.inTopbar && !lay.inSidebar, lay);
  t('R5 sidebar: toggle is the smaller 26px size (was 30px)', await ev("(()=>{ const b=document.querySelector('.sidebar-toggle').getBoundingClientRect(); return Math.round(b.width)===26 && Math.round(b.height)===26; })()"));
  t('R3 sidebar: navigation restored to its original layout (Main header first, 20px top padding, items 10px/20px, 10px gap)', lay.firstIsSection && lay.padTop === '20px' && lay.itemPad === '10px 20px' && lay.gap === '10px' && lay.label === 'Dashboard', lay);
  // geometry on each page, expanded and collapsed: below the top bar, next to the sidebar edge, above the page header, no overlap, no horizontal overflow
  const geo = () => ev("(()=>{ const r=e=>e.getBoundingClientRect(), tb=r(document.querySelector('.topbar')), sb=r(document.querySelector('.sidebar')), tg=r(document.querySelector('.sidebar-toggle')), ph=document.querySelector('.main .page-header'), p=ph&&r(ph), ni=r(document.querySelector('.nav-item'));"
    + " return { belowTopbar: tg.top >= tb.bottom - 0.5, nearSidebar: tg.left >= sb.right - 0.5 && tg.left - sb.right <= 24, abovePage: !!p && tg.bottom <= p.top + 0.5, headerLeft: p ? Math.round(p.left - sb.right) : null,"
    + " navTop: Math.round(ni.top), w: Math.round(sb.width), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, label: document.querySelector('.sidebar-toggle').getAttribute('aria-label') }; })()");
  // nav baseline per state (collapsed hides section headers, so items sit higher there by design)
  const navTop0 = { expanded: (await geo()).navTop };
  await ev("document.querySelector('.sidebar-toggle').click(); true"); await sleep(300);
  navTop0.collapsed = (await geo()).navTop;
  await ev("document.querySelector('.sidebar-toggle').click(); true"); await sleep(300);
  t('R4 sidebar: first nav item directly under the sidebar padding (collapsed 78px = 58px top bar + 20px), lower when expanded ("Main" header shown)', navTop0.collapsed === 78 && navTop0.expanded > navTop0.collapsed, navTop0);
  for (const pg of ['Dashboard', 'Asset Registry', 'Job Orders', 'Reports', 'Settings']) {
    await nav(pg);
    for (const state of ['expanded', 'collapsed']) {
      const g = await geo();
      t('R4 sidebar ' + pg + ' ' + state + ': toggle below top bar, beside the sidebar, above the page header; nav items not shifted; no overflow',
        g.belowTopbar && g.nearSidebar && g.abovePage && g.navTop === navTop0[state] && !g.overflow && g.w === (state === 'expanded' ? 210 : 60) && g.label === (state === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'), g);
      await ev("document.querySelector('.sidebar-toggle').click(); true"); await sleep(300);
    }
  }
  await nav('Dashboard');
  await ev("document.querySelector('.sidebar-toggle').click(); true"); await sleep(300);
  t('R3 sidebar: control still collapses (60px) and remembers the state', await ev("Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 60 && localStorage.getItem('cmms_vg_sidebar') === '1' && document.querySelector('.layout').classList.contains('sidebar-collapsed')"));
  await ev("document.querySelector('.sidebar-toggle').click(); true"); await sleep(300);
  t('R3 sidebar: control expands again (210px, labels visible)', await ev("Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 210 && getComputedStyle(document.querySelector('.nav-label')).display !== 'none' && localStorage.getItem('cmms_vg_sidebar') === '0'"));
  await B.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  t('R4 sidebar 860px: sidebar hidden, toggle row hidden too (takes no space), no overflow', await ev("getComputedStyle(document.querySelector('.main-toolbar')).display === 'none' && getComputedStyle(document.querySelector('.sidebar')).display === 'none' && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"));
  await B.send('Emulation.clearDeviceMetricsOverride', {}); await sleep(300);

  console.log('--- R4. Settings → Users: compact assignment summary + details on demand');
  {
    const cats8 = [...plants].sort().slice(0, 8);
    const sdA = JSON.parse(JSON.stringify(SEED2)); sdA.users.find(u => u.id === 6).assignedCategories = cats8;
    sdA.users.push({ id: 10, username: 't_du_one', employeeId: 'TD010', plainPassword: PASS.t_du, fullName: 'Test DU One', role: 'Department User', email: 'du1@example.invalid', active: true, password: SEED2.users.find(u => u.id === 6).password, department: 'Fuel Plant', assignedCategories: [plants[1]] },
      { id: 11, username: 't_du_mix', employeeId: 'TD011', plainPassword: PASS.t_du, fullName: 'Test DU Mixed', role: 'Department User', email: 'du2@example.invalid', active: true, password: SEED2.users.find(u => u.id === 6).password, department: 'HR', assignedCategories: ['GENERATORS', plants[3]] });
    await fresh('t_admin', sdA); await nav('Settings');
    const w0 = mock.writes.length;
    const a = await ev(`(()=>{ const c = r => r.querySelector('.assign-cell'), du = c(T.row('t_du')), je = c(T.row('t_jce')), ad = c(T.row('t_admin')), one = c(T.row('TD010')), mix = c(T.row('TD011'));
      const eye = cell => { const b = cell && cell.querySelector('button.assign-btn'); return b ? { title: b.title, aria: b.getAttribute('aria-label'), svg: !!b.querySelector('svg'), text: T.txt(b), w: Math.round(b.getBoundingClientRect().width) } : null; };
      const mid = e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
      return { badges: T.all('.assign-badge', du).map(T.txt), deptTip: du.querySelector('.assign-badge.abbr').title, duText: T.txt(du), one: T.all('.assign-badge', one).map(T.txt), mix: T.all('.assign-badge', mix).map(T.txt),
        eyeDu: eye(du), eyeJe: eye(je), eyeAd: eye(ad), badgeFont: getComputedStyle(du.querySelector('.assign-badge')).fontSize,
        alignDiff: Math.abs(mid(du.querySelector('.assign-badge')) - mid(T.row('t_du').querySelector('td:nth-child(3)'))),
        duH: Math.round(T.row('t_du').getBoundingClientRect().height), adminRowH: Math.round(T.row('t_admin').getBoundingClientRect().height), duW: Math.round(du.getBoundingClientRect().width),
        listsCats: ${JSON.stringify(cats8.map(c => c.replace(/^\d+\s+/, '')))}.some(x => T.txt(du).includes(x)),
        je: T.all('.assign-badge', je).map(T.txt), jeTip: je.querySelector('.assign-badge').title, ad: T.txt(ad) }; })()`);
    t('R6 assignment: Department User row = dept abbreviation + "Cat: 01, 02 +6" (codes only, no names)', JSON.stringify(a.badges) === JSON.stringify(['CEM', 'Cat: 01, 02 +6']) && a.deptTip === 'Cement Plant' && !a.listsCats && !a.duText.includes('View') && !a.duText.includes('cats'), a);
    t('R6 assignment: one category shows "Cat: 02"; a custom category without a stored code is only counted ("Cat: 04 +1"), never given an invented code', JSON.stringify(a.one) === JSON.stringify(['FUEL', 'Cat: 02']) && JSON.stringify(a.mix) === JSON.stringify(['HR', 'Cat: 04 +1']), { one: a.one, mix: a.mix });
    t('R6 assignment: eye icon button (no "View" text), tooltip "View assignments", per-user aria-label; DU and Job Card Editors only', !!a.eyeDu && a.eyeDu.svg && a.eyeDu.text === '' && a.eyeDu.title === 'View assignments' && a.eyeDu.aria === 'View assignments for Test DU Cement' && a.eyeDu.w <= 22 && !!a.eyeJe && a.eyeAd === null, { du: a.eyeDu, je: a.eyeJe, ad: a.eyeAd });
    t('R6 assignment: compact badges (10px), vertically aligned with the row (≤ 2px), row no taller than an Admin row, column narrower than the previous design (237px)', a.badgeFont === '10px' && a.alignDiff <= 2 && a.duH <= a.adminRowH && a.duW < 237, { font: a.badgeFont, align: a.alignDiff, h: [a.duH, a.adminRowH], w: a.duW });
    t('R6 assignment: Job Card Editor shows MEC (tooltip with full section); Admin "—"', JSON.stringify(a.je) === JSON.stringify(['MEC']) && a.jeTip === 'Section: Mechanical' && a.ad === '—', a);
    const dlg = `(()=>{ const m = document.querySelector('.modal.assign-detail'); if (!m) return null; const rows = sel => T.all(sel + ' li', m).map(li => T.all('span', li).map(T.txt));
      return { title: T.txt(m.querySelector('.modal-title')), heads: T.all('h4', m).map(T.txt), depts: rows('.dept-list'), cats: rows('.cat-list'), secs: rows('.sec-list'), inputs: m.querySelectorAll('input,select,textarea').length }; })()`;
    await ev("T.row('t_du').querySelector('.assign-cell button.assign-btn').click(); true"); await sleep(300);
    const d = await ev(dlg);
    t('R6 details (DU): department abbreviation + full name; all 8 categories as code + name; read-only; no Section', !!d && d.title.includes('Test DU Cement') && JSON.stringify(d.heads) === JSON.stringify(['Department (1)', 'Asset Categories (8)'])
      && JSON.stringify(d.depts) === JSON.stringify([['CEM', 'Cement Plant']]) && JSON.stringify(d.cats) === JSON.stringify(cats8.map(c => [c.slice(0, 2), c.slice(3)])) && d.secs.length === 0 && d.inputs === 0, d);
    await ev("T.click('Close','.modal.assign-detail button'); true"); await sleep(300);
    await ev("T.row('TD011').querySelector('.assign-cell button.assign-btn').click(); true"); await sleep(300);
    const dm = await ev(dlg);
    t('R6 details: a category without a stored code is listed with "—" and its full name (no invented code); list sorted by stored name', !!dm && JSON.stringify(dm.cats) === JSON.stringify([[plants[3].slice(0, 2), plants[3].slice(3)], ['—', 'GENERATORS']]), dm && dm.cats);
    await ev("T.click('Close','.modal.assign-detail button'); true"); await sleep(300);
    await ev("T.row('t_jce').querySelector('.assign-cell button.assign-btn').click(); true"); await sleep(300);
    const dj = await ev(dlg);
    t('R6 details (Job Card Editor): full section with abbreviation; no department or category lists', !!dj && JSON.stringify(dj.heads) === JSON.stringify(['Section']) && JSON.stringify(dj.secs) === JSON.stringify([['MEC', 'Mechanical']]) && dj.depts.length === 0 && dj.cats.length === 0, dj);
    await ev("T.click('Close','.modal.assign-detail button'); true"); await sleep(300);
    await settle();
    t('R4 assignment: viewing details closes cleanly and writes nothing; stored users unchanged', !(await ev("!!document.querySelector('.modal.assign-detail')")) && mock.writes.length === w0
      && sameAccounts(mock.store.users, sdA.users), { writes: mock.writes.length - w0 });
  }

  console.log('--- R3. My Profile + Change Password for every role');
  for (const [u, id, editable] of [['t_admin', 1, true], ['t_ae', 2, true], ['t_se', 3, true], ['t_jce', 5, false], ['t_du', 6, false]]) {
    await fresh(u, SEED2); await nav('Settings');
    await ev("(T.all('.settings-tab').find(e=>T.txt(e).includes('Profile'))||{click(){}}).click(); true"); await sleep(250);
    const pr = await ev("({ edit: !!T.find('Edit My Profile','button'), pw: !!T.find('Change Password','button'), role: T.txt(document.querySelector('.main')).includes('What this role can do') })");
    t('R3 profile ' + u + ': Change Password for everyone; Edit My Profile only for Admin/AE/SE; role shown', pr.pw && pr.edit === editable && pr.role, pr);
  }
  await fresh('t_ae', SEED2); await nav('Settings');
  await ev("(T.all('.settings-tab').find(e=>T.txt(e).includes('Profile'))||{click(){}}).click(); true"); await sleep(250);
  await ev("T.click('Change Password','button'); true"); await sleep(300);
  await ev("(()=>{ const ins=T.all('.modal input[type=password]'); T.setVal(ins[0],'Synthetic-AE-1'); T.setVal(ins[1],'AE-NewSecret-9'); T.setVal(ins[2],'AE-NewSecret-9'); T.click('Change Password','.modal button'); return true; })()"); await settle();
  { const a = mock.store.users.find(x => x.id === 2), b = SEED2.users.find(x => x.id === 2);
    t('R3 AE changes own password through Change Password: only the hash changes', a.password === shaHex('AE-NewSecret-9') && acct({ ...a, password: '' }) === acct({ ...b, password: '' })); }

  console.log('--- R3. Close dialog');
  await fresh('t_ae'); await nav('Job Orders'); await ev("T.click('Completed','button'); true"); await sleep(300);
  await ev("T.click('COMPLETED ›','button',T.row('JO-9003')); true"); await sleep(300); await ev("T.click('Approve Completion','button.btn-success'); true"); await settle();
  await ev("T.click('COMPLETED ›','button',T.row('JO-9003')); true"); await sleep(300);
  const cd = await ev("({ t: T.modalText(), date: !!T.field('Closed Date * (selected)') && T.field('Closed Date * (selected)').type === 'date', closedBy: T.field('Closed By') && T.field('Closed By').value, cancel: !!T.all('.modal button').find(b=>T.txt(b)==='Cancel'), confirm: !!T.all('.modal button.btn-success').find(b=>T.txt(b).includes('Close Job Order')) })");
  t('R3 close dialog: job order, recorded approval (by + automatic time) and this closure step are separate, labelled sections', ['close job order jo-9003', 'completion approval (already recorded)', 'approved by', 'test ae', 'approved at (automatic)', 'closure (this step)', 'separate from the approval time'].every(x => cd.t.includes(x)) && cd.date && cd.closedBy === 'Test AE' && cd.cancel && cd.confirm, cd.t.slice(0, 200));
  { const w = mock.writes.length; await ev("T.all('.modal button').find(b=>T.txt(b)==='Cancel').click(); true"); await settle();
    t('R3 close dialog Cancel: nothing saved, still COMPLETED + APPROVED', mock.writes.length === w && jo2('JO-9003').status === 'COMPLETED' && jo2('JO-9003').approvalStatus === 'APPROVED'); }
  await ev("T.click('COMPLETED ›','button',T.row('JO-9003')); true"); await sleep(300);
  await ev("(()=>{ T.setVal(T.field('Closed Date * (selected)'), '2026-02-03'); T.click('Close Job Order','.modal button.btn-success'); return true; })()"); await settle();
  t('R3 close dialog confirm: CLOSED with the selected date; approval time unchanged', jo2('JO-9003').status === 'CLOSED' && jo2('JO-9003').closedDate === '2026-02-03' && jo2('JO-9003').approvedAt.slice(0, 10) !== '2026-02-03');

  console.log('--- R3. safe asset import (preview → confirm)');
  const ROW = a => [a.num, a.plant, a.desc, a.code || '', a.model || '', a.cap || '', a.reg || '', a.eng || '', a.serial || '', a.loc || '', a.status || ''].map(x => '"' + x + '"').join(',');
  const csvOf = rows => ['Asset No.,Asset Category,Description,Eq. Code,Model/Make,Capacity,Register No.,Engine No.,Serial/Chassis No.,Location,Status', ...rows.map(ROW)].join('\n');
  const S5 = n => SEED.assets.find(a => a.num === n);
  const good = csvOf([S5('5001'), { num: '05002', plant: plants[0], desc: 'Test Valve v2' }, { num: '5004', plant: plants[2], desc: 'Test Tank', loc: 'Bay 2' }, { num: '5101', plant: plants[0], desc: 'New Hose' }, { num: '6101', plant: plants[5], desc: 'New Press' }]);
  const sdI = JSON.parse(JSON.stringify(SEED)); sdI.assets = sdI.assets.map(a => a.num === '5002' ? { ...a, legacyAsset: 'keep-5002' } : a);
  const importFile = async (csv, name) => { await ev("T.prop('onImportCSV')(new File([" + JSON.stringify(csv) + "], " + JSON.stringify(name) + ", {type:'text/csv'})); true"); await sleep(700); };
  const pv = () => ev("(()=>{ const m=document.querySelector('.modal.asset-import'); if(!m) return null; const btn=[...m.querySelectorAll('button')].find(b=>T.txt(b).includes('Confirm import'));"
    + " return { pills: [...m.querySelectorAll('.import-pill')].map(T.txt), upd: [...m.querySelectorAll('.import-update')].map(T.txt), nw: [...m.querySelectorAll('.import-new')].map(T.txt), bad: [...m.querySelectorAll('.import-invalid')].map(T.txt), disabled: btn ? btn.disabled : null }; })()");
  await fresh('t_admin', sdI); await nav('Asset Registry');
  let w0 = mock.writes.length, st0 = JSON.stringify(mock.store.assets);
  await importFile(csvOf([{ num: '5101', plant: plants[0], desc: 'New Hose' }, { num: '5102', plant: plants[0], desc: '' }, { num: '5103', plant: '99 NOPE', desc: 'x' }, { num: '5104', plant: plants[0], desc: 'a' }, { num: '5104', plant: plants[0], desc: 'b' }]), 'bad.csv');
  let p3 = await pv();
  t('IMPORT invalid file: preview lists the invalid rows (missing description, unknown category, number twice) and the confirm button is disabled', !!p3 && p3.disabled === true && p3.bad.length === 4 && p3.bad.some(x => x.includes('missing description')) && p3.bad.some(x => x.includes('unknown category')) && p3.bad.filter(x => x.includes('more than once')).length === 2, p3);
  t('IMPORT reading the file saved nothing', mock.writes.length === w0 && JSON.stringify(mock.store.assets) === st0);
  await ev("T.all('.modal.asset-import button').find(b=>T.txt(b).includes('Cancel')).click(); true"); await settle();
  t('IMPORT cancel on the invalid file: nothing saved', mock.writes.length === w0 && JSON.stringify(mock.store.assets) === st0 && (await ev("T.body().includes('Import cancelled. Nothing was saved.')")));
  await importFile(good, 'good.csv');
  p3 = await pv();
  t('IMPORT preview distinguishes new (2), unchanged (1), existing with changes (2), invalid (0)', !!p3 && JSON.stringify(p3.pills) === JSON.stringify(['New: 2', 'Unchanged: 1', 'Existing with changes: 2', 'Invalid rows: 0']) && p3.nw.length === 2 && p3.upd.length === 2, p3);
  t('IMPORT preview shows the proposed field changes (5002 description, 5004 location); blank cells propose nothing', p3.upd.some(x => x.includes('5002') && x.includes('desc:') && x.includes('Test Valve v2') && !x.includes('model:')) && p3.upd.some(x => x.includes('5004') && x.includes('loc:') && x.includes('Bay 2')), p3.upd);
  t('IMPORT no update is pre-selected', await ev("[...document.querySelectorAll('.modal.asset-import .import-update input[type=checkbox]')].every(c=>!c.checked)"));
  await ev("T.all('.modal.asset-import button').find(b=>T.txt(b).includes('Cancel')).click(); true"); await settle();
  t('IMPORT cancel on a valid file: nothing saved', mock.writes.length === w0 && JSON.stringify(mock.store.assets) === st0);
  await importFile(good, 'good.csv');
  await ev("T.all('.modal.asset-import input[aria-label=\"Update 5002\"]')[0].click(); true"); await sleep(200);
  await ev("T.all('.modal.asset-import button').find(b=>T.txt(b).includes('Confirm import')).click(); true"); await settle();
  const as = mock.store.assets, A = n => as.find(a => a.num === n);
  t('IMPORT confirm: new assets appended (5101 in its category, 6101 in another category)', as.length === SEED.assets.length + 2 && A('5101').desc === 'New Hose' && A('6101').plant === plants[5] && A('5101').status === 'OPERATIONAL');
  t('IMPORT confirm: only the selected duplicate (5002) updated — description only; unknown field and other fields kept', A('5002').desc === 'Test Valve v2' && A('5002').legacyAsset === 'keep-5002' && A('5002').model === 'M' && A('5002').code === 'C5002');
  t('IMPORT confirm: the unselected duplicate (5004) and every other asset, in every category, unchanged', ['5001', '5003', '5004', '5005', '5006'].every(n => JSON.stringify(A(n)) === JSON.stringify(S5(n))));
  t('IMPORT confirm: one complete save of the asset list; summary shown', mock.writes.filter((x, i) => i >= w0 && x.key === 'assets').length === 1 && (await ev("T.body().includes('Assets: 2 added, 1 updated, 1 unchanged.')")));
  await fresh('t_se'); await nav('Asset Registry');
  { const w = mock.writes.length; await ev("T.prop('onStatusChange') && true"); await ev("(()=>{ const f=T.prop('onImportCSV'); if (f) f(new File(['a'], 'x.csv')); return true; })()"); await settle();
    t('IMPORT Senior Engineer cannot import (save layer refuses, no preview, no write)', mock.writes.length === w && !(await ev("!!document.querySelector('.modal.asset-import')")) && (await ev("T.body().includes('You do not have permission for this action.')"))); }

  console.log('--- R3. Job Card Editor section restrictions');
  const sdS = JSON.parse(JSON.stringify(SEED2));
  sdS.users.push({ id: 9, username: 't_jce_el', fullName: 'Test JCE Electrical', role: 'Job Card Editor', email: 'jceel@example.invalid', active: true, section: 'Electrical', password: shaHex(PASS.t_jce_el) });
  const setJ = (no, patch) => { sdS.jobOrders = sdS.jobOrders.map(j => j.jobNo === no ? { ...j, ...patch } : j); };
  setJ('JO-9002', { section: 'Electrical' }); setJ('JO-9008', { section: 'Mechanical' }); setJ('JO-9007', { section: 'Electrical' });
  sdS.jobOrders.push({ ...sdS.jobOrders.find(j => j.jobNo === 'JO-9002'), jobNo: 'JO-9009', section: '', problem: 'Synthetic problem JO-9009', legacyField: 'keep-JO-9009' });   // own problem text: row lookups by job number must not match JO-9002
  const SJ = no => sdS.jobOrders.find(j => j.jobNo === no);
  const refuse = async (call, txt) => { const w = mock.writes.length, s0 = JSON.stringify(mock.store.jobOrders); await ev(call); await settle(); return (await ev("T.body().includes(" + JSON.stringify(txt) + ")")) && mock.writes.length === w && JSON.stringify(mock.store.jobOrders) === s0; };
  await fresh('t_jce', sdS); await nav('Job Orders'); await ev("T.click('In Progress','button'); true"); await sleep(300);
  const rowsM = await ev("({ e: !!(T.row('JO-9002') && T.find('IN PROGRESS ›','button',T.row('JO-9002'))), eEdit: T.byTitle('Edit',T.row('JO-9002')).length, m: !!(T.row('JO-9008') && T.find('IN PROGRESS ›','button',T.row('JO-9008'))), mEdit: T.byTitle('Edit',T.row('JO-9008')).length, none: !!(T.row('JO-9009') && T.find('IN PROGRESS ›','button',T.row('JO-9009'))), noneEdit: T.byTitle('Edit',T.row('JO-9009')).length })");
  t('SECTION UI (Mechanical editor): Electrical JO and section-less JO show no complete/edit; own Mechanical JO does', !rowsM.e && !rowsM.eEdit && rowsM.m && rowsM.mEdit && !rowsM.none && !rowsM.noneEdit, rowsM);
  t('SECTION save layer: Mechanical editor completing an Electrical JO is refused, no write', await refuse("T.prop('onStatusChange')('JO-9002','COMPLETED'); true", 'belongs to the Electrical section'));
  t('SECTION save layer: Mechanical editor completing a JO without section is refused, no write', await refuse("T.prop('onStatusChange')('JO-9009','COMPLETED'); true", 'belongs to the unassigned section'));
  await ev("T.byTitle('Edit', T.row('JO-9008'))[0].click(); true"); await sleep(400);
  t('SECTION JCE form: Section Assigned is read-only', await ev("T.field('Section Assigned').readOnly && T.field('Work Assigned To').readOnly"));
  t('SECTION save layer: crafted edit of an Electrical JO by a Mechanical editor is refused, no write', await refuse("T.propFrom('.modal','onSave')({..." + JSON.stringify(SJ('JO-9002')) + ", workDone:'hijack'}, 'JO-9002'); true", 'You do not have permission for this action.'));
  { const w = mock.writes.length; await ev("T.propFrom('.modal','onSave')({..." + JSON.stringify(SJ('JO-9008')) + ", section:'Electrical', workDone:'mech work'}, 'JO-9008'); true"); await settle();
    t('SECTION editor saves own-section work; cannot move the JO to another section', jo2('JO-9008').workDone === 'mech work' && jo2('JO-9008').section === 'Mechanical' && jo2('JO-9008').legacyField === 'keep-JO-9008' && mock.writes.length > w); }
  await ev("T.all('.modal-close').forEach(b=>b.click()); true"); await sleep(200);
  await ev("T.click('IN PROGRESS ›','button',T.row('JO-9008')); true"); await sleep(300); await ev("T.click('Mark Completed','button'); true"); await settle();
  t('SECTION Mechanical editor completes own Mechanical JO; history/unrelated fields kept', jo2('JO-9008').status === 'COMPLETED' && jo2('JO-9008').approvalStatus === 'PENDING' && jo2('JO-9008').legacyField === 'keep-JO-9008' && jo2('JO-9008').requesterId === 6);
  await ev("T.click('Open','button'); true"); await sleep(300);
  t('SECTION UI: OPEN Electrical JO offers no start to a Mechanical editor; OPEN JO without section does', await ev("!T.find('OPEN ›','button',T.row('JO-9007')) && !!T.find('OPEN ›','button',T.row('JO-9001'))"));
  t('SECTION save layer: starting an OPEN Electrical JO as a Mechanical editor is refused, no write', await refuse("T.prop('onStatusChange')('JO-9007','IN PROGRESS'); true", 'belongs to the Electrical section'));
  await ev("T.click('OPEN ›','button',T.row('JO-9001')); true"); await sleep(300); await ev("T.click('Move to In Progress','button'); true"); await settle();
  t('SECTION an OPEN JO without section, started by a Mechanical editor, becomes Mechanical work', jo2('JO-9001').status === 'IN PROGRESS' && jo2('JO-9001').section === 'Mechanical' && jo2('JO-9001').assignedTo === 'Test JCE');
  await fresh('t_jce_el', sdS); await nav('Job Orders'); await ev("T.click('In Progress','button'); true"); await sleep(300);
  t('SECTION Electrical editor sees complete/edit on the Electrical JO, not on the Mechanical one', await ev("!!T.find('IN PROGRESS ›','button',T.row('JO-9002')) && T.byTitle('Edit',T.row('JO-9002')).length>0 && !T.find('IN PROGRESS ›','button',T.row('JO-9008')) && !T.byTitle('Edit',T.row('JO-9008')).length"));
  t('SECTION save layer: Electrical editor completing a Mechanical JO is refused, no write', await refuse("T.prop('onStatusChange')('JO-9008','COMPLETED'); true", 'belongs to the Mechanical section'));
  await ev("T.click('IN PROGRESS ›','button',T.row('JO-9002')); true"); await sleep(300); await ev("T.click('Mark Completed','button'); true"); await settle();
  t('SECTION Electrical editor completes the Electrical JO', jo2('JO-9002').status === 'COMPLETED');
  await fresh('t_ae', sdS); await nav('Job Orders'); await ev("T.click('In Progress','button'); true"); await sleep(300);
  t('SECTION Assistant Engineer unaffected: may complete and edit JOs of any section or none', await ev("!!T.find('IN PROGRESS ›','button',T.row('JO-9002')) && !!T.find('IN PROGRESS ›','button',T.row('JO-9009')) && T.byTitle('Edit',T.row('JO-9008')).length>0"));
  await ev("T.click('IN PROGRESS ›','button',T.row('JO-9009')); true"); await sleep(300); await ev("T.click('Mark Completed','button'); true"); await settle();
  t('SECTION AE completes a JO without section', jo2('JO-9009').status === 'COMPLETED' && jo2('JO-9009').legacyField === 'keep-JO-9009');

  // ============ U1: collapsible sidebar (FEATURE_PLAN §10) ============
  console.log('--- U1. collapsible sidebar');
  const sb = () => ev("(()=>{ const s=document.querySelector('.sidebar'), m=document.querySelector('.main'), l=document.querySelector('.layout'), tg=document.querySelector('.sidebar-toggle'); const vis = e => e && getComputedStyle(e).display !== 'none';"
    + " return { w: Math.round(s.getBoundingClientRect().width), ml: getComputedStyle(m).marginLeft, collapsed: l.classList.contains('sidebar-collapsed'), labels: T.all('.nav-label').filter(vis).length, sections: T.all('.nav-section').filter(vis).length,"
    + " icons: T.all('.nav-icon').filter(vis).length, items: T.all('.nav-item').length, expanded: tg ? tg.getAttribute('aria-expanded') : null, title: tg ? tg.title : null, stored: localStorage.getItem('cmms_vg_sidebar'),"
    + " overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }; })()");
  const toggle = async () => { await ev("(document.querySelector('.sidebar-toggle')||{click(){}}).click(); true"); await sleep(300); };
  await fresh('t_admin');
  let u1 = await sb();
  t('U1 default: expanded at 1440px (210px), labels and section headers visible, no horizontal overflow', !u1.collapsed && u1.w === 210 && u1.ml === '210px' && u1.labels === u1.items && u1.sections > 0 && u1.expanded === 'true' && u1.title === 'Collapse sidebar' && !u1.overflow, u1);
  t('U1 every nav item has title and aria-label equal to its label', await ev("T.all('.nav-item').every(e => { const lbl = T.txt(e.querySelector('.nav-label')); return lbl && e.title === lbl && e.getAttribute('aria-label') === lbl; })"));
  await toggle(); u1 = await sb();
  t('U1 collapse: 60px, main shifts, labels and sections hidden, icons kept, state stored "1"', u1.collapsed && u1.w === 60 && u1.ml === '60px' && u1.labels === 0 && u1.sections === 0 && u1.icons === u1.items && u1.expanded === 'false' && u1.title === 'Expand sidebar' && u1.stored === '1' && !u1.overflow, u1);
  await nav('Job Orders');
  t('U1 navigation still works while collapsed (icons clickable, page opens)', await ev("!!T.row('JO-9001')"));
  await B.send('Page.reload', {}); await relogin('t_admin');
  u1 = await sb();
  t('U1 collapsed state remembered across a reload (per browser)', u1.collapsed && u1.w === 60 && u1.stored === '1', u1);
  for (const [w, exp] of [[1200, 190], [1050, 165]]) {
    await B.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);
    u1 = await sb(); t('U1 ' + w + 'px collapsed: 60px, no horizontal overflow', u1.collapsed && u1.w === 60 && u1.ml === '60px' && !u1.overflow, u1);
    await toggle(); u1 = await sb(); t('U1 ' + w + 'px expanded: ' + exp + 'px via the same variable, no horizontal overflow', !u1.collapsed && u1.w === exp && u1.ml === exp + 'px' && !u1.overflow, u1);
    await toggle();
  }
  await B.send('Emulation.clearDeviceMetricsOverride', {}); await sleep(300);
  await toggle(); u1 = await sb();
  t('U1 expand again: 210px, labels visible, state stored "0"', !u1.collapsed && u1.w === 210 && u1.labels === u1.items && u1.stored === '0', u1);
  await fresh('t_du', SEED2);
  await toggle();
  t('U1 Department User collapsed: still only its permitted pages (5 items)', await ev("T.all('.nav-item').length === 5 && !T.all('.nav-item').some(e => ['PM Schedule','Employees'].includes(e.title))"));

  // unknown-role user (Q-D): cannot exist on the server (see T6 above); client guard: permissions.test.js T6g

  // ============ U3 (2026-10-12): light/dark theme + login page redesign ============
  console.log('--- U3. theme toggle + login page');
  {
  const CONTRAST = `window.__contrast = el => {
      const parse = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const mix = (c, under) => ({ r: c.r * c.a + under.r * (1 - c.a), g: c.g * c.a + under.g * (1 - c.a), b: c.b * c.a + under.b * (1 - c.a) });
      const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
      let bg = parse(getComputedStyle(document.documentElement).getPropertyValue('--navy').trim().replace(/^#(..)(..)(..)$/, (_, r, g, b) => 'rgb(' + [r, g, b].map(h => parseInt(h, 16)).join(',') + ')')) || { r: 255, g: 255, b: 255 };
      for (let i = layers.length - 1; i >= 0; i--) bg = mix(layers[i], bg);
      const fg = mix(parse(getComputedStyle(el).color), bg); const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    window.__minContrast = sels => { const out = {}; for (const s of sels) { const els = [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null && ((e.textContent || '').trim() || (e.matches('input,select') && e.value))).slice(0, 25);
      if (els.length) out[s] = Math.round(Math.min(...els.map(window.__contrast)) * 100) / 100; } return out; }; true`;
  const toLogin = async () => {
    mock.reset(SEED);
    await B.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
    await B.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${SITE_PORT}`, storageTypes: 'local_storage' });
    mock.requests = [];
    await B.send('Page.navigate', { url: URL0 });
    await waitFor(`!!document.querySelector('.login-card input[type=password]')`, 20000);
    await sleep(300);
  };
  const login = async (user, pw) => { await ev(`(()=>{ T.setVal(document.getElementById('login-username'), ${JSON.stringify(idOf(user))}); T.setVal(document.getElementById('login-password'), ${JSON.stringify(pw)}); document.querySelector('form button[type=submit]').click(); return true; })()`); };
  const themeState = () => ev(`({ attr: document.documentElement.getAttribute('data-theme'), stored: (()=>{ try { return localStorage.getItem('cmms_vg_theme'); } catch(e) { return 'ERR'; } })(),
      bodyBg: getComputedStyle(document.body).backgroundColor, toggle: (()=>{ const b = document.querySelector('.theme-toggle'); return b ? { label: b.getAttribute('aria-label'), title: b.title, svg: !!b.querySelector('svg') } : null; })() })`);

  await toLogin();
  let th = await themeState();
  t('U3 login: dark is the default (no stored preference), toggle offers light mode', th.attr === 'dark' && th.stored === null && th.bodyBg === 'rgb(10, 22, 40)' && !!th.toggle && th.toggle.label === 'Switch to light mode' && th.toggle.svg, th);
  const lay3 = await ev(`(()=>{ const r = e => e.getBoundingClientRect(), tg = r(document.querySelector('.login-theme')), intro = document.querySelector('.login-intro'), card = document.querySelector('.login-card');
      return { tgTopRight: tg.top <= 24 && innerWidth - tg.right <= 24, w: Math.round(tg.width), split: r(intro).right <= r(card).left && Math.abs(r(intro).top - 0) < 1, introW: Math.round(r(intro).width), cardW: Math.round(r(card).width),
        feats: [...document.querySelectorAll('.login-features strong')].map(T.txt), welcome: T.txt(document.querySelector('.login-welcome')), instr: T.txt(document.querySelector('.login-instr')),
        brand: T.txt(document.querySelector('.login-intro')).includes('ENGINEERING SOLUTIONS DEPARTMENT'), desc: T.txt(document.querySelector('.login-desc')).length > 40, visual: !!document.querySelector('.login-page > svg.login-visual[aria-hidden=true]') && !document.querySelector('.login-intro svg.login-visual'),
        visualBehind: getComputedStyle(document.querySelector('.login-visual')).pointerEvents === 'none' && getComputedStyle(document.querySelector('.login-visual')).zIndex === '0' && getComputedStyle(document.querySelector('.login-intro')).zIndex === '2' && getComputedStyle(document.querySelector('.login-main')).zIndex === '1' && getComputedStyle(document.querySelector('.login-visual.lc-anim')).zIndex === '2' && document.querySelector('.login-visual.lc-anim').compareDocumentPosition(document.querySelector('.login-intro')) === Node.DOCUMENT_POSITION_FOLLOWING,
        labels: [...document.querySelectorAll('.login-field label')].map(l => l.htmlFor), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }; })()`);
  t('U3 login desktop: split screen (intro left, card right), toggle compact in the top-right corner, no overflow', lay3.tgTopRight && lay3.w <= 34 && lay3.split && lay3.introW > 500 && lay3.cardW <= 420 && !lay3.overflow, lay3);
  t('U3 login intro: branding, ESD context, description, the three feature highlights, decorative visual behind the content', lay3.brand && lay3.desc && JSON.stringify(lay3.feats) === JSON.stringify(['Job Card Management', 'Asset Management', 'Maintenance Tracking']) && lay3.visual && lay3.visualBehind, lay3);
  t('U3 login card: welcome heading, short instruction, labelled username/password fields', lay3.welcome === 'Welcome back' && lay3.instr.length > 10 && JSON.stringify(lay3.labels) === JSON.stringify(['login-username', 'login-password']), lay3);
  await ev(CONTRAST);
  const cDark = await ev(`window.__minContrast(['.login-welcome','.login-instr','.login-field label','.login-field input','.login-btn','.login-footer','.login-title','.login-desc','.login-features strong','.login-features span'])`);
  // switch to light on the login page: live, no reload
  await ev(`window.__noReload = 1; document.querySelector('.login-theme').click(); true`); await sleep(300);
  th = await themeState();
  t('U3 login: toggle switches to light live (no reload), stores only "light", label flips to dark mode', th.attr === 'light' && th.stored === 'light' && th.bodyBg === 'rgb(238, 242, 247)' && th.toggle.label === 'Switch to dark mode' && (await ev('window.__noReload === 1')), th);
  await ev(CONTRAST);
  const cLight = await ev(`window.__minContrast(['.login-welcome','.login-instr','.login-field label','.login-field input','.login-btn','.login-footer','.login-title','.login-desc','.login-features strong','.login-features span'])`);
  const cardBg = await ev(`getComputedStyle(document.querySelector('.login-card')).backgroundColor`);
  t('U3 login light: light translucent card (R8 glass), readable text (every login text ≥ 4.5:1, footer ≥ 3:1)', /^rgba\(255, 255, 255, 0\.[5-8]/.test(cardBg) && Object.entries(cLight).every(([k, v]) => v >= (k === '.login-footer' ? 3 : 4.5)) && Object.keys(cLight).length >= 9, cLight);
  t('U3 login dark: readable text (every login text ≥ 4.5:1, footer ≥ 3:1)', Object.entries(cDark).every(([k, v]) => v >= (k === '.login-footer' ? 3 : 4.5)) && Object.keys(cDark).length >= 9, cDark);
  await B.send('Page.reload', {}); await waitFor(`!!document.querySelector('.login-card')`, 20000); await sleep(300);
  th = await themeState();
  t('U3 login: light preference persists across a reload (applied before render)', th.attr === 'light' && th.stored === 'light' && th.bodyBg === 'rgb(238, 242, 247)', th);
  // show / hide password
  await ev(`T.setVal(document.getElementById('login-password'), 'Synthetic-Typed-1'); true`);
  const pw0 = await ev(`(()=>{ const i = document.getElementById('login-password'), b = document.querySelector('.pw-toggle'); return { type: i.type, label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), submitFirst: document.querySelector('form button[type=submit]') !== document.querySelector('form button') }; })()`);
  await ev(`document.querySelector('.pw-toggle').click(); true`); await sleep(150);
  const pw1 = await ev(`(()=>{ const i = document.getElementById('login-password'), b = document.querySelector('.pw-toggle'); return { type: i.type, value: i.value, label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') }; })()`);
  await ev(`document.querySelector('.pw-toggle').click(); true`); await sleep(150);
  const pw2 = await ev(`document.getElementById('login-password').type`);
  t('U3 login: show/hide password toggles the field (value kept), with accessible label and pressed state; it never submits', pw0.type === 'password' && pw0.label === 'Show password' && pw0.pressed === 'false' && pw0.submitFirst && pw1.type === 'text' && pw1.value === 'Synthetic-Typed-1' && pw1.label === 'Hide password' && pw1.pressed === 'true' && pw2 === 'password' && !(await ev(`!!document.querySelector('.sidebar')`)), { pw0, pw1, pw2 });
  // failure: loading feedback, then a readable error; no session stored
  await login('t_admin', 'Wrong-Password-1');
  const busy = await ev(`(()=>{ const b = document.querySelector('form button[type=submit]'); return { disabled: b.disabled, busy: b.getAttribute('aria-busy'), text: T.txt(b), spinner: !!b.querySelector('.login-spinner') }; })()`);
  await waitFor(`!!document.querySelector('.login-error')`, 5000);
  await ev(CONTRAST);
  const fail1 = await ev(`(()=>{ const e = document.querySelector('.login-error'), b = document.querySelector('form button[type=submit]'); return { role: e.getAttribute('role'), text: T.txt(e), btn: !b.disabled && T.txt(b) === 'Sign In', session: localStorage.getItem('cmms_vg_session'), contrast: window.__contrast(e) }; })()`);
  t('U3 login: loading feedback while signing in (disabled, aria-busy, spinner, "Signing in…")', busy.disabled && busy.busy === 'true' && busy.spinner && busy.text === 'Signing in…', busy);
  t('U3 login failure: readable error (role=alert, unchanged message, ≥ 4.5:1), button re-enabled, no session stored', fail1.role === 'alert' && fail1.text === 'Invalid Employee ID or password. Please try again.' && fail1.btn && fail1.session === null && fail1.contrast >= 4.5, fail1);
  await login('', '');
  t('U3 login: empty fields show the validation message (Employee ID wording)', await ev(`T.txt(document.querySelector('.login-error')) === 'Please enter your Employee ID and password.'`));
  // success in light mode
  await login('t_admin', PASS.t_admin);
  await waitFor(`!!document.querySelector('.sidebar') && !T.body().includes('Loading')`, 20000); await sleep(800);
  th = await themeState();
  const sess = await ev(`T.txt(document.querySelector('.sidebar-user-role'))`);   // signed-in profile (no browser session since Phase 2B-1)
  const stored = await ev(`({ keys: Object.keys(localStorage).sort(), theme: localStorage.getItem('cmms_vg_theme'), pwAnywhere: Object.values(localStorage).some(v => v.includes(${JSON.stringify(PASS.t_admin)})) })`);
  t('U3 login success (unchanged flow): admin signed in, light theme carried into the app, top bar toggle present', sess === 'Admin' && (await ev(`localStorage.getItem('cmms_vg_session') === null`)) && th.attr === 'light' && th.toggle && th.toggle.label === 'Switch to dark mode' && (await ev(`!!document.querySelector('.topbar .theme-toggle')`)), { sess, th });
  t('U3 storage: the theme key holds only "light"/"dark" (no credentials); the typed password is stored nowhere', stored.keys.includes('cmms_vg_theme') && stored.theme === 'light' && !stored.pwAnywhere, stored);
  // pages in both themes: readable text, themed surfaces, dialogs and forms
  const SELS = ['.page-title', '.page-sub', 'th', 'td', '.nav-item', '.panel-title', '.btn-accent', '.btn-ghost', '.btn-logout', '.badge', '.sb-base', '.user-role-badge', '.stat-label', '.stat-num', '.logo-text', '.sidebar-user-name', '.settings-tab', '.stat-card div', '.main button', '.main input', '.main select'];
  const results = {};
  for (const theme of ['light', 'dark']) {
    if ((await ev(`document.documentElement.getAttribute('data-theme')`)) !== theme) { await ev(`document.querySelector('.topbar .theme-toggle').click(); true`); await sleep(400); }
    for (const pg of ['Dashboard', 'Asset Registry', 'Job Orders', 'Reports', 'Settings']) {
      await nav(pg); await ev(CONTRAST);
      const c = await ev(`window.__minContrast(${JSON.stringify(SELS)})`);
      const surf = await ev(`({ topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor, sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor, panel: (()=>{ const p = document.querySelector('.panel'); return p ? getComputedStyle(p).backgroundColor : null; })(), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 })`);
      const low = Object.entries(c).filter(([k, v]) => v < 3);
      results[theme + ' ' + pg] = c;
      const okSurf = theme === 'light' ? surf.topbar === 'rgb(255, 255, 255)' && surf.sidebar === 'rgb(255, 255, 255)' : surf.topbar === 'rgb(15, 32, 68)' && surf.sidebar === 'rgb(15, 32, 68)';
      t(`U3 ${theme} ${pg}: themed top bar/sidebar, all sampled text ≥ 3:1 contrast, no overflow`, okSurf && low.length === 0 && !surf.overflow && Object.keys(c).length >= 5, { low, surf });
    }
    // dialog + form in this theme
    await ev(`T.click('Add User','button'); true`); await sleep(300);
    await ev(CONTRAST);
    const m = await ev(`(()=>{ const m = document.querySelector('.modal'); if (!m) return null; const inp = m.querySelector('input:not([type]),input[type=text]'), ov = document.querySelector('.modal-overlay');
        return { bg: getComputedStyle(m).backgroundColor, inputBg: getComputedStyle(inp).backgroundColor, overlay: getComputedStyle(ov).backgroundColor, c: window.__minContrast(['.modal .modal-title', '.modal label', '.modal input', '.modal select', '.modal .btn-ghost', '.modal .btn-accent', '.modal input:not([type])', '.modal button']) }; })()`);
    const mLow = m ? Object.entries(m.c).filter(([k, v]) => v < 3) : ['no modal'];
    t(`U3 ${theme} dialog/form (Add User): themed modal and inputs, labels/inputs/buttons ≥ 3:1`, !!m && mLow.length === 0 && (theme === 'light' ? m.bg === 'rgb(255, 255, 255)' && m.inputBg === 'rgb(255, 255, 255)' : m.bg === 'rgb(15, 32, 68)'), m);
    await ev(`(document.querySelector('.modal-close')||{click(){}}).click(); true`); await sleep(250);
  }
  // live switch keeps the session and page; chart follows the theme
  await nav('Dashboard');
  await ev(`window.__noReload2 = 1; document.querySelector('.topbar .theme-toggle').click(); true`); await sleep(500);
  const after = await ev(`({ attr: document.documentElement.getAttribute('data-theme'), sameSession: !!document.querySelector('.sidebar') && !document.querySelector('.login-card'), noReload: window.__noReload2 === 1, active: T.txt(document.querySelector('.nav-item.active .nav-label')),
      legend: (()=>{ const cv = document.querySelector('canvas'); const ch = cv && window.Chart && Chart.getChart(cv); return ch ? ch.options.plugins.legend.labels.color : null; })() })`);
  t('U3 app: top bar toggle switches theme live — same session, same page, no reload; chart text follows the theme', after.attr === 'light' && after.sameSession && after.noReload && after.active === 'Dashboard' && after.legend === '#0f2044', after);
  await ev(`document.querySelector('.topbar .theme-toggle').click(); true`); await sleep(500);
  t('U3 app: back to dark — chart legend uses the dark text colour again', (await ev(`(()=>{ const ch = Chart.getChart(document.querySelector('canvas')); return ch && ch.options.plugins.legend.labels.color; })()`)) === '#f8fafc');
  // mobile and reduced motion
  await toLogin();
  await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(400);
  const mob = await ev(`(()=>{ const r = e => e.getBoundingClientRect(), card = r(document.querySelector('.login-card')), intro = r(document.querySelector('.login-intro')), btn = r(document.querySelector('form button[type=submit]')), tg = r(document.querySelector('.login-theme'));
      return { stacked: intro.bottom <= card.top + 1, cardW: Math.round(card.width), formVisible: btn.bottom <= innerHeight, features: getComputedStyle(document.querySelector('.login-features')).display, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        tgOverlap: !(tg.right <= r(document.querySelector('.login-title')).left || tg.left >= r(document.querySelector('.login-title')).right || tg.bottom <= r(document.querySelector('.login-title')).top || tg.top >= r(document.querySelector('.login-title')).bottom) }; })()`);
  t('U3 login 390px: stacked (brand above the card), form and Sign In fully visible without scrolling, features hidden, toggle not over the title, no overflow', mob.stacked && mob.formVisible && mob.features === 'none' && !mob.overflow && !mob.tgOverlap && mob.cardW <= 358, mob);
  await B.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  t('U3 login 820px (tablet): stacked, no overflow', await ev(`(()=>{ const r = e => e.getBoundingClientRect(); return r(document.querySelector('.login-intro')).bottom <= r(document.querySelector('.login-card')).top + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1; })()`));
  await B.send('Emulation.clearDeviceMetricsOverride', {}); await sleep(300);
  const anim = () => ev(`(()=>{ const of = c => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.classList.contains(c)).length; return { signal: of('lc-signal'), glow: of('lc-glow') }; })()`);
  // 2026-10-14: circuit board converging on the card (replaces the R8-R12 gears and line art). Same layout checks as before.
  for (const [w, h, mobile] of [[1440, 900, false], [1920, 1080, false], [1280, 720, false], [1024, 768, false], [820, 1000, false], [390, 844, true]]) {
    await B.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); await sleep(700);
    const g = await ev(`(()=>{ const page = document.querySelector('.login-page'), pr = page.getBoundingClientRect(), svg = document.querySelector('.login-visual'), sr = svg.getBoundingClientRect();
    const vis = e => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
    const card = document.querySelector('.login-card').getBoundingClientRect();
    const scr = (el, p) => { const m = el.getScreenCTM(); return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; };
    const traces = [...document.querySelectorAll('.lc-traces path')];
    const crosses = traces.filter(el => { const L = el.getTotalLength(); for (let k = 0; k <= 80; k++) { const p = scr(el, el.getPointAtLength(L * k / 80)); if (p.x > card.left + 1 && p.x < card.right - 1 && p.y > card.top + 1 && p.y < card.bottom - 1) return true; } return false; }).length;
    const ends = traces.map(el => scr(el, el.getPointAtLength(el.getTotalLength())));
    const gap = p => Math.hypot(Math.max(card.left - p.x, 0, p.x - card.right), Math.max(card.top - p.y, 0, p.y - card.bottom));
    const starts = traces.map(el => scr(el, el.getPointAtLength(0)));
    const side = p => Math.abs(p.x - pr.left) < 2 ? 'left' : Math.abs(p.x - pr.right) < 2 ? 'right' : Math.abs(p.y - pr.top) < 2 ? 'top' : Math.abs(p.y - pr.bottom) < 2 ? 'bottom' : 'none';
    const boxes = [...document.querySelectorAll('.login-brand, .login-headline, .login-desc, .login-features li, .login-card, .login-theme')].filter(vis).map(e => e.getBoundingClientRect()).filter(b => b.width && b.height);
    const parts = [...document.querySelectorAll('.lc-parts g')].map(e => e.getBoundingClientRect());
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return { traces: traces.length, crosses, endsOnSocket: ends.every(p => gap(p) >= 12 && gap(p) <= 20), sides: [...new Set(starts.map(side))].sort(), fromEdge: starts.every(p => side(p) !== 'none'),
      partsOnText: parts.filter(p => boxes.some(b => hit(p, b))).length, signals: document.querySelectorAll('.lc-signal').length,
      timings: new Set([...document.querySelectorAll('.lc-signal')].map(e => getComputedStyle(e).animationDuration)).size,
      covers: Math.abs(sr.left - pr.left) < 1 && Math.abs(sr.top - pr.top) < 1 && Math.abs(sr.width - pr.width) < 1 && Math.abs(sr.height - pr.height) < 1 && pr.height >= innerHeight - 1 && pr.width >= innerWidth - 1,
      mainBg: getComputedStyle(document.querySelector('.login-main')).backgroundImage, introBorder: getComputedStyle(document.querySelector('.login-intro')).borderRightWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      rs: (()=>{ const m = document.querySelector('.login-main'), c = getComputedStyle(m, '::before'), card = getComputedStyle(document.querySelector('.login-card')), mr = m.getBoundingClientRect(), ir = document.querySelector('.login-intro').getBoundingClientRect();
        const alphas = (c.backgroundImage.match(/rgba\\([^)]*\\)/g) || []).map(x => parseFloat(x.split(',')[3]));
        return { img: c.backgroundImage, mask: c.maskImage || c.webkitMaskImage || 'none', z: c.zIndex, left: c.left, edge: c.borderLeftWidth, shade: c.boxShadow, introShare: ir.width / innerWidth, mainW: mr.width, cardW: document.querySelector('.login-card').getBoundingClientRect().width,
          cardCentred: (()=>{ const cr = document.querySelector('.login-card').getBoundingClientRect(); return Math.abs((cr.left + cr.right) / 2 - (mr.left + mr.right) / 2) < 2; })(), opaque: alphas.length ? Math.max(...alphas) : 0, panelFromDivide: Math.abs(mr.left - ir.right) < 1,
          cardShadow: card.boxShadow, cardBorder: card.borderTopWidth, cardBlur: /blur/.test(card.backdropFilter || card.webkitBackdropFilter || '') }; })() }; })()`);
    t('LOGIN2 circuit ' + w + 'x' + h + ': board covers the whole page; every trace starts at a page edge and ends on a pad 12-20px from the card; no trace crosses the card; no component over text; no overflow',
      g.covers && g.traces >= (mobile ? 4 : 8) && g.fromEdge && g.endsOnSocket && g.crosses === 0 && g.partsOnText === 0 && !g.overflow && g.signals === g.traces, g);
    if (w >= 1024) t('LOGIN2 circuit ' + w + 'x' + h + ': traces converge on the card from at least three sides (incl. across the divide from the left); no blurred blotches, no hard divider', g.sides.length >= 3 && g.sides.includes('left') && g.mainBg === 'none' && g.introBorder === '0px', g.sides);
    if (w >= 1024) t('R11 login ' + w + 'x' + h + ': distinct right colour zone (65-90% opaque since R12) blended into the left over a 160px fade at the divide (no edge line, no dividing shadow); glass card floats (shadow, border, blur)', /linear-gradient/.test(g.rs.img) && g.rs.opaque >= 0.65 && g.rs.opaque <= 0.9 && /transparent|rgba\(0, 0, 0, 0\)/.test(g.rs.mask) && /160px/.test(g.rs.mask) && g.rs.left === '-80px' && g.rs.edge === '0px' && g.rs.shade === 'none' && g.rs.z === '-1' && g.rs.panelFromDivide && g.rs.cardShadow !== 'none' && (g.rs.cardShadow.match(/rgba/g) || []).length >= 2 && g.rs.cardBorder === '1px' && g.rs.cardBlur, g.rs);
    if (w >= 1024) t('R11 login ' + w + 'x' + h + ': left introduction dominant (54% where it fits; right panel ≥ 500px), card keeps its 392px width (R12) and is centred in the right panel', (w >= 1100 ? Math.abs(g.rs.introShare - 0.54) < 0.01 : g.rs.mainW >= 499 && g.rs.introShare > 0.5) && Math.round(g.rs.cardW) === 392 && g.rs.cardCentred, { share: g.rs.introShare, mainW: g.rs.mainW, cardW: g.rs.cardW, centred: g.rs.cardCentred });
    if (w === 1440) t('LOGIN2 circuit 1440: at least 12 traces, every one with a signal', g.traces >= 12 && g.signals === g.traces, g);
    // light flow (2026-10-14): in on the left, hidden behind the card, out on the right along the same pad row
    const fl = await ev(`(()=>{ const card = document.querySelector('.login-card').getBoundingClientRect();
      const sig = [...document.querySelectorAll('.lc-signal')], rights = sig.filter(e => e.dataset.side === 'right');
      const scr = (el, p) => { const m = el.getScreenCTM(); return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; };
      const lit = el => { const d = parseFloat(getComputedStyle(el).strokeDashoffset), L = el.getTotalLength(), a = Math.max(0, -d), b = Math.min(L, 26 - d); const out = [];
        if (b - a > 0.5) for (let k = 0; k <= 6; k++) out.push(scr(el, el.getPointAtLength(a + (b - a) * k / 6))); return out; };
      const inCard = p => p.x > card.left && p.x < card.right && p.y > card.top && p.y < card.bottom;
      let pairs = 0, aligned = 0, beyond = 0, ordered = 0, overCard = 0, running = 0;
      for (const r of rights) {
        const l = sig.find(e => e.dataset.side === 'left' && e.dataset.row === r.dataset.row); if (!l) continue; pairs++;
        const la = l.getAnimations()[0], ra = r.getAnimations()[0]; if (!la || !ra) continue; running++;
        const lp = scr(l, l.getPointAtLength(l.getTotalLength())), rp = scr(r, r.getPointAtLength(r.getTotalLength()));
        if (Math.abs(lp.y - rp.y) < 1 && lp.x < card.left && rp.x > card.right) aligned++;
        const T = la.effect.getComputedTiming().duration; let firstL = null, firstR = null, far = false;
        [la, ra].forEach(a => a.pause());
        for (let k = 0; k < 160; k++) { const t = T * k / 160 + la.effect.getTiming().delay + T; la.currentTime = t; ra.currentTime = t;   /* currentTime must be >= 0: one cycle later = the same position k/160 of the cycle */
          const pl = lit(l), pr = lit(r);
          if (pl.length && firstL === null) firstL = k; if (pr.length && firstR === null) firstR = k;
          if (pr.some(p => p.x > card.right + 40)) far = true;
          if ([...pl, ...pr].some(inCard)) overCard++; }
        [la, ra].forEach(a => a.play());
        if (far) beyond++; if (firstL !== null && firstR !== null && firstL < firstR) ordered++;
      }
      return { rights: rights.length, pairs, running, aligned, beyond, ordered, overCard }; })()`);
    if (g.sides.includes('right')) t('LOGIN2 flow ' + w + 'x' + h + ': every right trace continues a left trace on the same pad row; the light reaches the right side beyond the card after the left part, and is never lit over the card',
      fl.rights > 0 && fl.pairs === fl.rights && fl.running === fl.pairs && fl.aligned === fl.pairs && fl.beyond === fl.pairs && fl.ordered === fl.pairs && fl.overCard === 0, fl);
    else t('LOGIN2 flow ' + w + 'x' + h + ': no room beside the card, so no right-side trail; signals still run (bottom traces)', fl.rights === 0 && (await ev(`document.getAnimations().some(a => a.effect && a.effect.target && a.effect.target.classList.contains('lc-signal'))`)), fl);
  }
  await B.send('Emulation.clearDeviceMetricsOverride', {}); await sleep(300);
  for (const theme of ['dark', 'light']) {
    if ((await ev("document.documentElement.getAttribute('data-theme')")) !== theme) { await ev("document.querySelector('.login-theme').click(); true"); await sleep(300); }
    await ev(CONTRAST);
    const gl = await ev(`(()=>{ const c = getComputedStyle(document.querySelector('.login-card')), a = /rgba\\([^)]*,\\s*([0-9.]+)\\)/.exec(c.backgroundColor);
      return { blur: /blur\\((\\d+)/.exec(c.backdropFilter || c.webkitBackdropFilter || '') ? +/blur\\((\\d+)/.exec(c.backdropFilter || c.webkitBackdropFilter)[1] : 0, alpha: a ? +a[1] : 1, border: c.borderTopWidth,
        c: window.__minContrast(['.login-welcome', '.login-instr', '.login-field label', '.login-btn', '.login-footer']), pw: !!document.querySelector('.pw-toggle'), submit: !!document.querySelector('form button[type=submit]') }; })()`);
    t('R8/R12 ' + theme + ' card: glossy glass (translucent 40-80%, 10-20px backdrop blur, subtle border); card text stays readable (≥ 4.5:1, footer ≥ 3:1); controls present',
      gl.alpha >= 0.4 && gl.alpha < 0.8 && gl.blur >= 10 && gl.blur <= 20 && gl.border === '1px' && Object.entries(gl.c).every(([k, v]) => v >= (k === '.login-footer' ? 3 : 4.5)) && gl.pw && gl.submit, gl);
  }
  await ev("document.querySelector('.login-theme').click(); true"); await sleep(300);   // back to dark
  const a0 = await anim();
  await B.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(300);
  const a1 = await anim();
  const rmPackets = await ev("[...document.querySelectorAll('.lc-signal')].every(e => getComputedStyle(e).display === 'none') && [...document.querySelectorAll('.login-visual *')].every(e => getComputedStyle(e).animationName === 'none')");
  await B.send('Emulation.setEmulatedMedia', { features: [] }); await sleep(400);
  const a2 = await anim();
  t('U3/LOGIN2 login visuals animate normally (signals and pad glows) and stop entirely with prefers-reduced-motion (no animation at all, signals hidden, static board kept); motion resumes when the preference is cleared',
    a0.signal >= 8 && a0.glow === a0.signal && a1.signal === 0 && a1.glow === 0 && rmPackets && a2.signal === a0.signal, { a0, a1, a2, rmPackets });
  await ev(`try { localStorage.removeItem('cmms_vg_theme'); } catch(e) {} true`);

  }
  // ============ VIEWER (Phase 2B-3): read-only role, enforced in the UI AND in every handler ============
  console.log('--- VIEWER. read-only role');
  {
    const shaV = s => require('crypto').createHash('sha256').update(s).digest('hex');
    const SEEDV = JSON.parse(JSON.stringify(SEED2));
    SEEDV.users.push({ id: 20, username: 't_viewer', employeeId: 'VW001', fullName: 'Test Viewer', role: 'Viewer', email: 'viewer@example.invalid', active: true, password: shaV(PASS.t_viewer) });

    // account management: an Admin creates and edits a Viewer account
    await fresh('t_admin', SEEDV); await nav('Settings');
    await ev(`T.click('Add User','button'); true`); await sleep(300);
    t('VIEWER role offered in the account form', await ev(`[...T.all('.modal select')[0].options].map(o => o.value).includes('Viewer')`));
    await ev(`(()=>{ const m=T.all('.modal')[0]; const ins=T.all('input',m); T.setVal(ins[0],'New Viewer'); T.setVal(T.field('Employee ID *'),'VW002'); T.setVal(T.all('select',m)[0],'Viewer'); window.__alerts=[]; T.click('Add User','.modal button'); return true; })()`); await settle();
    const nv = mock.store.users.find(u => u.employeeId === 'VW002');
    await ev("(()=>{ const d = T.find('Done','.temp-pw-notice button'); if (d) d.click(); return true; })()"); await sleep(300);
    t('VIEWER account created by Admin: role Viewer, Employee ID, no department/categories/section', !!nv && nv.role === 'Viewer' && nv.employeeId === 'VW002' && !('department' in nv) && !('assignedCategories' in nv) && !('section' in nv), nv && nv.role);
    await ev(`T.prop('onSaveUser')({...${JSON.stringify({ ...SEEDV.users.find(u => u.id === 20), password: '' })}, fullName: 'Test Viewer Renamed'}, 20); true`); await settle();
    const ev20 = mock.store.users.find(u => u.id === 20);
    t('VIEWER account edited by Admin: name changed; id, role, Employee ID and password kept', ev20.fullName === 'Test Viewer Renamed' && ev20.role === 'Viewer' && ev20.employeeId === 'VW001' && ev20.password === shaV(PASS.t_viewer));
    t('VIEWER role badge shown in the users table', await ev(`!!T.row('t_viewer') && !!T.row('t_viewer').querySelector('.role-viewer')`));

    // the Viewer: every intended page, read-only
    await fresh('t_viewer', SEEDV);
    const w0 = mock.writes.length, d0 = await ev('window.__downloads.length'), p0 = await ev('window.__prints.length');
    t('VIEWER signs in; navigation shows every page (7)', await ev(`JSON.stringify(T.all('.nav-item').map(e => e.title)) === JSON.stringify(['Dashboard','Asset Registry','Job Orders','PM Schedule','Employees','Reports','Settings'])`));
    t('VIEWER dashboard shows data', await ev(`T.body().includes('SYSTEM') && T.all('.stat-num').length > 0`));
    await nav('Asset Registry');
    t('VIEWER assets: all rows visible (no scope)', await ev(`['5001','5002','5003','5004','5005','5006'].every(n => !!T.row(n))`));
    t('VIEWER assets: no add/export/import/template/clear buttons, no edit/delete/raise-JO icons; status selects disabled',
      await ev(`!T.find('Add Asset','button') && !T.find('Export','button') && !T.find('Import','label') && !T.find('Template','button') && !T.find('Clear All','button')
        && T.byTitle('Edit Asset').length === 0 && T.byTitle('Delete Asset').length === 0 && T.byTitle('Raise Job Order').length === 0 && T.all('td select').every(s => s.disabled)`));
    await ev(`(()=>{ const i = T.all('input').find(x => /Search/i.test(x.placeholder||'')); T.setVal(i, '5003'); return true; })()`); await sleep(400);
    t('VIEWER assets: search still works (read-only filter)', await ev(`!!T.row('5003') && !T.row('5001')`));
    await ev(`(()=>{ const i = T.all('input').find(x => /Search/i.test(x.placeholder||'')); T.setVal(i, ''); return true; })()`); await sleep(300);
    await ev(`T.byTitle('View Asset', T.row('5001'))[0].click(); true`); await sleep(300);
    t('VIEWER asset detail view opens without Download PDF, Edit or Raise JO', await ev(`!!document.querySelector('.modal') && T.modalText().includes('test pump') && !T.all('.modal button').some(b => /Download PDF|Edit Asset|Raise JO/.test(T.txt(b)))`));
    await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
    await nav('Job Orders');
    t('VIEWER job orders: rows visible; no raise/export/import; no edit/delete/PDF icons; status is shown, not actionable',
      await ev(`!!T.row('JO-9001') && !T.find('Raise Job Order','button') && !T.find('Export','button') && !T.find('Import','label') && T.byTitle('Edit').length === 0
        && T.byTitle('Delete').length === 0 && T.byTitle('Download PDF').length === 0 && !T.all('td button').some(b => / ›$/.test(T.txt(b)))`));
    await ev(`T.click('In Progress','button'); true`); await sleep(300);
    t('VIEWER job orders: status tabs still filter (In Progress shows JO-9002)', await ev(`!!T.row('JO-9002') && !T.row('JO-9001')`));
    await ev(`T.byTitle('View', T.row('JO-9002'))[0].click(); true`); await sleep(300);
    t('VIEWER job-order detail view opens without Download PDF or Edit', await ev(`T.modalText().includes('jo-9002') && !T.all('.modal button').some(b => /Download PDF|Edit/.test(T.txt(b)))`));
    await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
    await nav('PM Schedule');
    t('VIEWER PM schedule: rows visible; no add/export/import/record/edit actions; service history viewable',
      await ev(`T.body().includes('Test Pump') && !T.find('Add PM Schedule','button') && !T.find('Export','button') && !T.find('Import','label') && !T.find('Record','button')
        && T.byTitle('Edit').length === 0 && T.byTitle('Service History').length > 0`));
    await nav('Employees');
    t('VIEWER employees: rows visible; no add/export/import; no update/edit/delete actions',
      await ev(`T.body().includes('Synthetic Person A') && !T.find('Add Employee','button') && !T.find('Export','button') && !T.find('Import','label')
        && T.byTitle('Update Leave / Resignation').length === 0 && T.byTitle('Edit Employee').length === 0 && T.byTitle('Delete Employee').length === 0`));
    await nav('Reports');
    t('VIEWER reports: page shows; no Download PDF; the note does not offer job-order PDFs', await ev(`T.body().includes('Report downloads are not available for your role.') && !T.find('Download PDF','button') && !T.body().includes('Job order PDFs can be downloaded')`));
    await nav('Settings');
    t('VIEWER settings: only My Profile (no Users, no Reset Data); no Edit My Profile; Change Password available; Viewer description shown',
      await ev(`JSON.stringify(T.all('.settings-tab').map(T.txt)) === JSON.stringify(['My Profile']) && !T.find('Edit My Profile','button') && !!T.find('Change Password','button') && T.body().includes('No editing, approvals, status changes, downloads, exports or administration')`));

    // direct handler invocation (bypassing the hidden UI): every protected action refuses, nothing is written or downloaded
    await ev(`(()=>{ window.__permToasts = 0; if (window.__ptObs) window.__ptObs.disconnect(); window.__ptObs = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && (n.textContent || '').includes('You do not have permission')) window.__permToasts++; }))); window.__ptObs.observe(document.body, { childList: true, subtree: true }); return true; })()`);
    const newRefusal = async (c0) => (await ev('window.__permToasts')) > c0 || (await ev(`window.__alerts.some(a => /not available/.test(a))`));
    const refuse = async (page, calls) => {
      await nav(page);
      for (const [name, expr] of calls) {
        await ev(`window.__alerts = []; true`);
        const before = mock.writes.length, c0 = await ev('window.__permToasts');
        await ev(`(async () => { try { await (${expr}); } catch (e) { window.__err = String(e); } return true; })()`); await sleep(350);
        t('VIEWER direct call refused: ' + page + ' → ' + name, (await newRefusal(c0)) && mock.writes.length === before);
      }
    };
    await refuse('Asset Registry', [
      ['asset status change', `T.prop('onStatusChange')('5001','BREAKDOWN')`], ['delete asset', `T.prop('onDeleteAsset')('5001')`], ['clear all assets', `T.prop('onClearAssets')()`],
      ['import asset CSV', `T.prop('onImportCSV')(new File(['num'], 'a.csv'))`], ['export asset CSV', `T.prop('onExportCSV')()`],
    ]);
    await ev(`T.prop('setAssetModal')({ mode: 'add' }); true`); await sleep(300);
    for (const [name, expr] of [['save asset (add form opened programmatically)', `T.prop('onSave')({ num: '7777', plant: '01 FUEL FARM', desc: 'X', status: 'OPERATIONAL' })`],
                                ['add category', `T.prop('onAddPlant')('VIEWER CAT')`], ['rename category', `T.prop('onRenameCategory')('01 FUEL FARM', 'RENAMED')`]]) {
      await ev(`window.__alerts = []; true`);
      const before = mock.writes.length, c0 = await ev('window.__permToasts'); await ev(`(async () => { try { await (${expr}); } catch (e) {} return true; })()`); await sleep(350);
      t('VIEWER direct call refused: asset form → ' + name, (await newRefusal(c0)) && mock.writes.length === before);
    }
    await ev(`(document.querySelector('.modal-close')||{click(){}}).click(); true`); await sleep(200);
    await ev(`T.prop('setJoModal')({ mode: 'add' }); true`); await sleep(400);
    { await ev(`window.__alerts = []; true`); const before = mock.writes.length, c0 = await ev('window.__permToasts'); await ev(`(async () => { try { await T.prop('onSave')({ ...${JSON.stringify(SEEDV.jobOrders[0])}, jobNo: '' }); } catch (e) {} return true; })()`); await sleep(400);
      t('VIEWER direct call refused: job-order form (opened programmatically) → save', (await newRefusal(c0)) && mock.writes.length === before); }
    await ev(`(document.querySelector('.modal-close')||{click(){}}).click(); true`); await sleep(200);
    await refuse('Job Orders', [
      ['start work', `T.prop('onStatusChange')('JO-9001','IN PROGRESS',{assigneeId:5})`], ['complete', `T.prop('onStatusChange')('JO-9002','COMPLETED')`], ['delete JO', `T.prop('onDeleteJO')('JO-9001')`],
      ['approve', `T.prop('onApproveJO')('JO-9003')`], ['close', `T.prop('onCloseJO')('JO-9003', { closedDate: '2026-10-13' })`], ['revert', `T.prop('onRevertJO')('JO-9004')`],
      ['import JO CSV', `T.prop('onImportCSV')(new File(['jobNo'], 'j.csv'))`], ['export JO CSV', `T.prop('onExportCSV')()`],
    ]);
    await refuse('PM Schedule', [
      ['save PM', `T.prop('onSavePM')({ id: 'pm-x', assetNum: '5001', frequency: 'Monthly' }, null)`], ['record service', `T.prop('onRecordService')('pm-001', { date: '2026-10-13', by: 'x' })`],
      ['import PM', `T.prop('onImportPM')(new File(['x'], 'p.csv'))`], ['export PM CSV', `T.prop('onExportPM')()`],
    ]);
    await refuse('Employees', [
      ['save employee', `T.prop('onSaveEmployee')({ empId: 'E999', name: 'X' }, null)`], ['update status', `T.prop('onUpdateStatus')('E901', { siteStatus: 'ON LEAVE' })`],
      ['import employees', `T.prop('onImportEmployees')([{ empId: 'E998', name: 'Y' }])`], ['delete employee', `T.prop('onDeleteEmployee')('E901')`], ['fix statuses', `T.prop('onFixStatus')()`],
    ]);
    await refuse('Settings', [
      ['create user', `T.prop('onSaveUser')({ username: 'v_hack', fullName: 'X', role: 'Admin', employeeId: 'VH001', password: 'Valid-Pass1!' }, null)`],
      ['edit own role', `T.prop('onSaveUser')({ ...${JSON.stringify({ ...SEEDV.users.find(u => u.id === 20), password: '' })}, role: 'Admin' }, 20)`],
      ['delete user', `T.prop('onDeleteUser')(1)`], ['reset all data', `T.prop('onResetData')()`], ["reset another user's password", `T.prop('onResetPassword')(1)`],
    ]);
    // global download/export functions called with the Viewer's own record
    const meV = JSON.stringify(SEEDV.users.find(u => u.id === 20));
    for (const [name, expr] of [['job-order PDF', `printJOPDF(${JSON.stringify(SEEDV.jobOrders[0])}, ${meV})`], ['asset PDF', `printAssetPDF(${JSON.stringify(SEEDV.assets[0])}, [], ${meV})`],
                                ['report PDF', `printReport('assetMaster', [], [], ${meV})`], ['asset CSV', `exportAssetsCSV(${JSON.stringify(SEEDV.assets)}, ${meV})`],
                                ['job-order CSV', `exportJobOrdersCSV(${JSON.stringify(SEEDV.jobOrders)}, ${meV})`], ['PM CSV', `exportPMCSV(${JSON.stringify(SEEDV.pm)}, ${meV})`]]) {
      await ev(`window.__alerts = []; ${expr}; true`); await sleep(200);
      t('VIEWER direct download refused: ' + name, await ev(`window.__alerts.some(a => /not available/.test(a))`));
    }
    t('VIEWER: after all attempts, no database write, no file download and no print window', mock.writes.length === w0 && (await ev('window.__downloads.length')) === d0 && (await ev('window.__prints.length')) === p0,
      { writes: mock.writes.length - w0 });
    t('VIEWER: stored data unchanged', JSON.stringify(mock.store.assets) === JSON.stringify(SEEDV.assets) && JSON.stringify(mock.store.jobOrders) === JSON.stringify(SEEDV.jobOrders)
      && JSON.stringify(mock.store.pm) === JSON.stringify(SEEDV.pm) && sameAccounts(mock.store.users, SEEDV.users));
  }

  // ============ ACCT (Phase 2B-2): local account management, password policy, forced first-login change ============
  console.log('--- ACCT. account management, password policy, forced change');
  {
    const loginNow = (id, pw) => ev(`(()=>{ T.setVal(document.getElementById('login-username'), ${JSON.stringify(idOf(id))}); T.setVal(document.getElementById('login-password'), ${JSON.stringify(pw)}); document.querySelector('form button[type=submit]').click(); return true; })()`);
    const storeUser = id => mock.store.users.find(u => u.id === id);
    const plainNowhere = async pw => !JSON.stringify(mock.store).includes(pw) && (await ev(`!Object.values(localStorage).some(v => v.includes(${JSON.stringify(pw)}))`));
    const meetsPolicy = p => typeof p === 'string' && p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9\s]/.test(p);
    const fc = async (cur, nw, cf) => { await ev(`(()=>{ T.setVal(document.getElementById('fc-current'), ${JSON.stringify(cur)}); T.setVal(document.getElementById('fc-new'), ${JSON.stringify(nw)}); T.setVal(document.getElementById('fc-confirm'), ${JSON.stringify(cf === undefined ? nw : cf)}); document.querySelector('.force-change button[type=submit]').click(); return true; })()`); await sleep(1500); };
    const fcErr = () => ev(`T.txt(document.querySelector('.force-change .login-error'))`);

    await fresh('t_admin', SEED2); await nav('Settings');
    // (P2) nobody types a password for another account: the server generates the temporary password and shows it once
    const base = { fullName: 'Policy Test', role: 'Assistant Engineer', active: true, employeeId: 'PT001' };
    let w0 = mock.writes.length;
    // profile Change Password: the policy applies there
    await ev(`(T.all('.settings-tab').find(e=>T.txt(e).includes('Profile'))||{click(){}}).click(); true`); await sleep(250);
    await ev(`T.click('Change Password','button'); true`); await sleep(250);
    await ev(`(()=>{ const m=T.all('.modal')[0]; const ins=T.all('input',m); T.setVal(ins[0], ${JSON.stringify(PASS.t_admin)}); T.setVal(ins[1],'Abcdefg1'); T.setVal(ins[2],'Abcdefg1'); window.__alerts=[]; T.click('Change Password','.modal button'); return true; })()`); await sleep(500);
    t('ACCT Change Password (profile) refuses a password without a special character (no write)', (await ev(`window.__alerts.join('|').includes('a special character')`)) && mock.writes.length === w0);
    await ev(`T.all('.modal-close')[0].click(); true`); await sleep(200);
    await ev(`(T.all('.settings-tab').find(e=>T.txt(e).includes('Users'))||{click(){}}).click(); true`); await sleep(250);

    // UI: new account with an Employee ID; the server creates it and returns a temporary password once
    await ev(`T.click('Add User','button'); true`); await sleep(300);
    await ev(`(()=>{ const m=T.all('.modal')[0]; const ins=T.all('input',m); T.setVal(ins[0],'Acct Test JCE'); T.setVal(T.field('Employee ID *'),'ac123'); T.setVal(T.all('select',m)[0],'Job Card Editor'); return true; })()`); await sleep(250);
    await ev(`T.setVal(T.field('Section (copied to job orders when work is assigned) *'),'Electrical'); true`); await sleep(150);
    t('ACCT the account form has no password field and no password generator (the server generates the temporary password)',
      await ev(`T.all('.modal input[type=password]').length === 0 && !T.find('Generate temporary password','.modal button') && !T.all('.modal input').some(x => x.autocomplete === 'new-password')`));
    w0 = mock.writes.length;
    await ev(`(()=>{ window.__alerts=[]; T.click('Add User','.modal button'); return true; })()`); await settle();
    const gen = await ev(`(()=>{ const m = document.querySelector('.temp-pw-notice'); return m ? { value: m.querySelector('input.temp-pw').value, once: T.txt(m).includes('Shown only once') } : { value: null }; })()`);
    const nu = mock.store.users.find(u => u.employeeId === 'AC123');
    t('ACCT new account created by the server: Employee ID upper-cased, forced change set, section kept; existing accounts unchanged',
      !!nu && nu.must_change_password === true && nu.section === 'Electrical' && SEED2.users.every(s => acct(storeUser(s.id)) === acct(s)), nu && { id: nu.id, emp: nu.employeeId, flag: nu.must_change_password });
    t('ACCT the temporary password is shown once, satisfies the policy, and is the account\'s password', !!gen.value && gen.once && meetsPolicy(gen.value) && nu.password === shaHex(gen.value));
    t('ACCT the temporary password is stored nowhere in plaintext (server data, browser storage)', await plainNowhere(gen.value));
    await ev(`T.click('Done','.temp-pw-notice button'); true`); await sleep(300);
    t('ACCT after closing, the temporary password is gone from the page', await ev(`!document.querySelector('.temp-pw-notice') && !document.body.innerHTML.includes(${JSON.stringify(gen.value)})`));
    // uniqueness: the form refuses it, and so does the server when the form is bypassed
    w0 = mock.writes.length;
    await ev(`T.prop('onSaveUser')({...${JSON.stringify(base)}, employeeId: 'ac123'}, null); true`); await settle();
    t('ACCT duplicate Employee ID (case-insensitive) refused (no write)', (await ev(`T.body().includes('This Employee ID is already used by another account.')`)) && mock.writes.length === w0);
    const dup = await ev(`(async () => { const r = await serverFunction('admin-users', { action: 'create', employeeId: 'AC123', fullName: 'Dup', role: 'Assistant Engineer', active: true }); return r.status; })()`);
    t('ACCT (API) the server refuses a duplicate Employee ID too (409), no account created', dup === 409 && mock.store.users.filter(u => u.employeeId === 'AC123').length === 1, dup);

    // first sign-in with the temporary password: everything is blocked until a valid change succeeds
    await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(500);
    await loginNow('AC123', gen.value);
    const gate = await waitFor(`!!document.getElementById('fc-new')`, 15000);
    t('ACCT first sign-in with the temporary password shows only the forced change (no navigation, no pages, no top bar)',
      gate && (await ev(`!document.querySelector('.sidebar') && !document.querySelector('.nav-item') && !document.querySelector('.main') && !document.querySelector('.topbar')`)));
    w0 = mock.writes.length;
    await fc(gen.value, 'abcdefg1');
    t('ACCT forced change: weak new password refused; still blocked; flag kept; no write', (await fcErr()).includes('uppercase') && (await ev(`!document.querySelector('.sidebar')`)) && storeUser(nu.id).must_change_password === true && mock.writes.length === w0);
    await fc(gen.value, 'Acct-New-Pass1', 'Acct-New-Pass2');
    t('ACCT forced change: mismatched confirmation refused', (await fcErr()).includes('do not match') && mock.writes.length === w0);
    await fc('Wrong-Temp-1', 'Acct-New-Pass1');
    t('ACCT forced change: wrong temporary password refused; flag kept', (await fcErr()).length > 0 && (await ev(`!document.querySelector('.sidebar')`)) && storeUser(nu.id).must_change_password === true);
    await fc(gen.value, gen.value);
    t('ACCT forced change: reusing the temporary password refused', (await fcErr()).includes('differ') && storeUser(nu.id).must_change_password === true);
    const beforeU = JSON.parse(JSON.stringify(storeUser(nu.id)));
    await fc(gen.value, 'Acct-New-Pass1'); await settle();
    const afterU = storeUser(nu.id);
    t('ACCT forced change succeeds: flag removed, hash changed, role/section/Employee ID kept; the application opens',
      afterU.must_change_password === false && afterU.password !== beforeU.password && afterU.role === 'Job Card Editor' && afterU.section === 'Electrical' && afterU.employeeId === 'AC123'
      && (await waitFor(`!!document.querySelector('.sidebar')`, 10000)));

    // admin reset (local development tool): Job Card Editor t_jce (Mechanical)
    await fresh('t_admin', SEED2); await nav('Settings');
    const josBefore = JSON.stringify(mock.store.jobOrders), u5 = JSON.parse(JSON.stringify(storeUser(5)));
    await ev(`(()=>{ T.click('Reset','button',T.row('t_jce')); return true; })()`); await settle();
    const shown = await ev(`(()=>{ const m = document.querySelector('.temp-pw-notice'); return m ? { pw: m.querySelector('input.temp-pw').value, local: T.txt(m).includes('Shown only once') } : null; })()`);
    const r5 = storeUser(5);
    t('ACCT admin reset shows a policy-compliant temporary password once ("Shown only once")', !!shown && shown.local && meetsPolicy(shown.pw));
    t('ACCT admin reset changes only the password hash and sets must_change_password (role, section, status, email kept)',
      r5.must_change_password === true && r5.password !== u5.password && JSON.stringify({ ...r5, password: '', must_change_password: undefined }) === JSON.stringify({ ...u5, password: '', must_change_password: undefined }));
    t('ACCT admin reset leaves all job orders (and their user references) untouched', JSON.stringify(mock.store.jobOrders) === josBefore);
    t('ACCT the reset temporary password is stored nowhere in plaintext', await plainNowhere(shown.pw));
    await ev(`T.click('Done','.temp-pw-notice button'); true`); await sleep(300);
    t('ACCT after closing, the temporary password is gone from the page', await ev(`!document.querySelector('.temp-pw-notice') && !document.body.innerHTML.includes(${JSON.stringify(shown.pw)})`));
    const ws = mock.writes.length; await ev(`T.prop('onResetPassword')(1); true`); await settle();
    t('ACCT no reset button on the admin\'s own row, and the handler refuses a self-reset (no write)', (await ev(`!T.find('Reset','button',T.row('t_admin'))`)) && mock.writes.length === ws);
    await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(500);
    await loginNow('t_jce', shown.pw);
    t('ACCT the reset account must change the password at the next sign-in', (await waitFor(`!!document.getElementById('fc-new')`, 15000)) && (await ev(`!document.querySelector('.sidebar')`)));
    await fc(shown.pw, 'Jce-New-Pass9'); await settle();
    t('ACCT after the change the Job Card Editor gets the normal application with the same role', (await waitFor(`!!document.querySelector('.sidebar')`, 10000)) && (await ev(`T.txt(document.querySelector('.sidebar-user-role')) === 'Job Card Editor'`)));
    await nav('Settings'); const wj = mock.writes.length; await ev(`T.prop('onResetPassword')(6); true`); await settle();
    t('ACCT a non-admin cannot reset passwords (refused, no write)', mock.writes.length === wj && (await ev(`T.body().includes('You do not have permission')`)));
  }

  // ============ N1 (P2 preparation): safe initialization, per-dataset saves, no browser copies, print escaping ============
  console.log('--- N1. safe initialization, per-dataset saves, browser storage, print escaping');
  {
    const open = async (data, opt = {}) => {   // load the app on `data` (no sign-in); opt.failLoad; returns after the load settled
      mock.reset(data); mock.failLoad = !!opt.failLoad;
      await B.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
      await B.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${SITE_PORT}`, storageTypes: 'local_storage' });
      if (opt.storage) { await B.send('Page.navigate', { url: URL0 }); await sleep(300); await ev(`(()=>{ const o = ${JSON.stringify(opt.storage)}; Object.keys(o).forEach(k => localStorage.setItem(k, o[k])); return true; })()`); }
      mock.requests = [];
      await B.send('Page.navigate', { url: URL0 });
      await waitFor(`!!document.querySelector('.login-card input[type=password]') || !!document.querySelector('.data-unavailable')`, 20000);
      await sleep(2500);   // any (wrong) write after the load would happen within this time
    };
    const expectErr = start => B.events.slice(start).forEach(e => { if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' && JSON.stringify(e.params.args || []).includes('Supabase load error')) e.__expected = true; });
    const failScreen = () => ev(`!!document.querySelector('.data-unavailable') && !document.querySelector('.login-card') && !document.querySelector('.sidebar')`);
    const signInLoad = async (user = 't_admin') => {
      await relogin(user, { expectFail: true });
      await waitFor(`!!document.querySelector('.data-unavailable') || (!!document.querySelector('.sidebar') && !T.body().includes('Loading'))`, 15000);
      await sleep(2500);   // any (wrong) write after the load would happen within this time
    };
    const without = (d, ...keys) => { const c = JSON.parse(JSON.stringify(d)); keys.forEach(k => delete c[k]); return c; };
    const writtenKeys = n => [...new Set(writesSince(n).map(w => w.key))].sort().join(',');

    // 1. failed read: failure screen, no seeding, no write of any kind
    let ev0 = B.events.length;
    await open(SEED, { failLoad: true });
    t('N1 (P2) nothing is read before sign-in: the only request before the login form is the staging marker',
      mock.requests.filter(r => r.m !== 'OPTIONS').every(r => r.u.includes('/rpc/environment_marker')), mock.requests.map(r => r.m + ' ' + r.u.slice(0, 40)));
    await signInLoad(); expectErr(ev0);
    t('N1 failed read after sign-in: the failure screen is shown (no login page, no application) and NOTHING is written (no seeding)', (await failScreen()) && mock.writes.length === 0, mock.writes.map(w => w.key));
    t('N1 failed read: the screen says nothing was changed and offers a reload', await ev(`T.txt(document.querySelector('.data-unavailable')).includes('Nothing has been changed') && !!T.find('Reload','button')`));
    mock.failLoad = false;

    // 2. empty read (only the staging marker) WITHOUT the explicit seed opt-in: failure screen, nothing written
    await open({ __environment: { env: 'staging' }, users: SEED.users }); await signInLoad();
    t('N1 empty read: failure screen "returned no CMMS data", nothing written, nothing created',
      (await failScreen()) && (await ev(`T.txt(document.querySelector('.data-unavailable')).includes('returned no CMMS data')`)) && mock.writes.length === 0 && Object.keys(mock.store).sort().join() === '__environment,users');

    // 3. (P2) the client never initializes a database: the old local-mock seed opt-in has no effect (no seed code exists)
    writeStagingConfig({ seedEmptyDatabase: true });
    try {
      await open({ __environment: { env: 'staging' }, users: SEED.users }); await signInLoad();
      t('N1 (P2) the old seed opt-in has no effect: empty database → failure screen, NOTHING written, no dataset created',
        (await failScreen()) && mock.writes.length === 0 && Object.keys(mock.store).sort().join() === '__environment,users', mock.writes.map(w => w.key));
      await open(SEED); await signInLoad();
      t('N1 (P2) with data present the old opt-in changes nothing: loads normally, writes nothing', mock.writes.length === 0 && (await ev(`!!document.querySelector('.sidebar')`)), mock.writes.map(w => w.key));
    } finally { writeStagingConfig(); }

    // 4. partial read: missing datasets stay read-only; the rest works and saves only what changed
    await open(without(SEED, 'pm', 'customPlants')); await signInLoad();
    t('N1 partial read: sign-in works and the application opens', await ev(`!!document.querySelector('.sidebar')`));
    t('N1 partial read: a banner names the datasets that could not be loaded', await ev(`(()=>{ const b = document.querySelector('.load-issue'); return !!b && T.txt(b).includes('PM schedule') && T.txt(b).includes('categories') && !T.txt(b).includes('assets'); })()`));
    let n = mock.writes.length;
    await nav('PM Schedule');
    await ev(`T.prop('onSavePM') ? T.prop('onSavePM')({assetNum:'5001',assetDesc:'Test Pump',category:'X',location:'Yard',frequency:'Monthly',lastService:'2026-10-01',nextService:'2026-11-01',notes:''}, null) : null; true`); await settle();
    t('N1 partial read: a PM change is NOT written (dataset not loaded) and the user is told it was not saved', !writesSince(n).some(w => w.key === 'pm') && !('pm' in mock.store) && (await ev(`T.body().includes('Not saved: PM schedule')`)));
    await nav('Asset Registry'); n = mock.writes.length;
    await ev(`T.prop('onStatusChange') ? T.prop('onStatusChange')('5002','BREAKDOWN') : null; true`); await settle();
    t('N1 partial read: an asset change writes ONLY assets', writtenKeys(n) === 'assets' && mock.store.assets.find(a => a.num === '5002').status === 'BREAKDOWN', writesSince(n).map(w => w.key));

    // 5. malformed dataset: shown empty, never overwritten; never replaced by built-in data
    const MAL = JSON.parse(JSON.stringify(SEED)); MAL.assets = null;
    await open(MAL); await signInLoad(); await nav('Asset Registry');
    t('N1 malformed assets row: assets shown EMPTY (no built-in asset list), banner shown', await ev(`!T.body().includes('5001') && !T.row('7001') && !!document.querySelector('.load-issue')`));
    await ev(`T.prop('setAssetModal')({ mode: 'add' }); true`); await sleep(300);
    n = mock.writes.length;
    await ev(`T.prop('onSave') ? T.prop('onSave')({num:'5999',plant:'X',desc:'Synthetic',status:'OPERATIONAL'}, null) : null; true`); await settle();
    t('N1 malformed assets row: an asset save is refused and the stored value is untouched', !writesSince(n).some(w => w.key === 'assets') && mock.store.assets === null && (await ev(`T.body().includes('Not saved: assets')`)));

    // 6. (N2) employee status corrections are no longer written while loading: see the N2 block below

    // 7. per-dataset saves and failures (signed in, full data)
    await fresh('t_admin'); await nav('Asset Registry');
    n = mock.writes.length;
    await ev(`T.prop('onStatusChange')('5001','UNDER MAINTENANCE'); true`); await settle();
    t('N1 asset status change writes only assets (job orders untouched)', writtenKeys(n) === 'assets' && JSON.stringify(mock.store.jobOrders) === JSON.stringify(SEED.jobOrders));
    await nav('Job Orders'); n = mock.writes.length;
    await ev(`T.prop('onApproveJO')('JO-9003'); true`); await settle();
    t('N1 job-order approval writes only job orders (assets untouched)', writtenKeys(n) === 'jobOrders' && mock.store.jobOrders.find(j => j.jobNo === 'JO-9003').approvalStatus === 'APPROVED' && mock.store.assets.find(a => a.num === '5001').status === 'UNDER MAINTENANCE');
    await sleep(3500);   // let earlier toasts expire, so only this save's messages are on screen
    mock.failKeys.add('jobOrders'); n = mock.writes.length;
    await ev(`T.prop('onDeleteJO')('JO-9001'); true`); await settle();
    const toastsNow = await ev(`T.all('.toast-msg').map(e => ({ err: e.classList.contains('err'), text: T.txt(e) }))`);
    t('N1 failed job-order save: an error toast names job orders, no "✓ Saved" is shown; the stored list is unchanged',
      toastsNow.some(x => x.err && x.text.includes('Not saved: job orders')) && !toastsNow.some(x => x.text.includes('✓ Saved')) && mock.store.jobOrders.some(j => j.jobNo === 'JO-9001') && writesSince(n).every(w => w.key === 'jobOrders'), toastsNow);
    mock.failKeys.clear();
    await nav('Asset Registry');
    await ev(`T.click('Add Asset','button'); true`); await sleep(300);
    const ren = await ev(`typeof T.propFrom('.modal','onRenameCategory') === 'function'`);
    if (ren) {
      mock.failKeys.add('assets'); n = mock.writes.length;
      await ev(`T.propFrom('.modal','onRenameCategory')(${JSON.stringify(SEED.customPlants[0])}, 'N1 RENAMED'); true`); await settle();
      await ev(`(document.querySelector('.modal-close')||{click(){}}).click(); true`); await sleep(200);
      // (P2) the rename is ONE server transaction (category_rename): a failure stores nothing at all, so there is no partial state
      t('N1 category rename failing on the server: NOTHING renamed in categories, assets or job orders, and the user is told it was not saved',
        !writesSince(n).some(w => !w.failed && !w.rejected) && !mock.store.jobOrders.some(j => j.assetCategory === 'N1 RENAMED') && !mock.store.assets.some(a => a.plant === 'N1 RENAMED')
        && !mock.store.customPlants.includes('N1 RENAMED') && (await ev(`T.body().includes('Not saved:') && T.body().includes('categories')`)), writesSince(n).map(w => w.key + (w.failed ? ':failed' : '')));
      mock.failKeys.clear();
    } else t('N1 category rename handler reachable for the partial-failure check', false);

    // 8. browser storage: old copies deleted on load and never read back; no dataset copy is ever written
    const OLD = { cmms_vg_state: JSON.stringify({ assets: [{ num: '8888', plant: 'X', desc: 'N1 OLD COPY', status: 'OPERATIONAL' }], jobOrders: [{ jobNo: 'JO-77777', status: 'OPEN' }], joCounter: 99999 }),
                  cmms_vg_pm: JSON.stringify([{ id: 'pm-999', assetDesc: 'N1 OLD PM' }]), cmms_vg_employees: JSON.stringify([{ empId: 'E-OLD', name: 'N1 OLD PERSON' }]),
                  cmms_vg_plants: JSON.stringify(['N1 OLD CATEGORY']), cmms_vg_users: JSON.stringify([{ id: 1, username: 't_admin' }]), cmms_vg_theme: 'light', cmms_vg_sidebar: '1' };
    await open(SEED, { storage: OLD }); await signInLoad();
    t('N1 every old dataset copy is deleted on load; theme and sidebar preferences are kept',
      await ev(`['cmms_vg_state','cmms_vg_pm','cmms_vg_employees','cmms_vg_plants','cmms_vg_users'].every(k => localStorage.getItem(k) === null) && localStorage.getItem('cmms_vg_theme') === 'light' && localStorage.getItem('cmms_vg_sidebar') === '1'`));
    const seen = [];
    for (const p of ['Asset Registry', 'Job Orders', 'PM Schedule', 'Employees', 'Settings']) { await nav(p); seen.push(await ev(`['N1 OLD COPY','8888','JO-77777','N1 OLD PM','N1 OLD PERSON','N1 OLD CATEGORY'].some(x => T.body().includes(x))`)); }
    t('N1 old copies are never read back (no page shows them)', seen.every(x => !x));
    await nav('Job Orders');
    await ev(`T.prop('setJoModal')({ mode: 'add' }); true`); await sleep(400);
    await ev(`T.prop('onSave')({...${JSON.stringify(SEED.jobOrders[0])}, jobNo: '', problem: 'N1 new JO'}, null); true`); await settle();
    t('N1 the JO counter comes from the stored job orders, not an old browser copy', (mock.store.jobOrders.find(j => j.problem === 'N1 new JO') || {}).jobNo === 'JO-9005');
    t('N1 after loading, signing in and saving, browser storage holds only the theme and sidebar preferences',
      await ev(`Object.keys(localStorage).sort().join() === 'cmms_vg_sidebar,cmms_vg_theme' && sessionStorage.length === 0`), await ev('Object.keys(localStorage).join()'));
    await ev(`localStorage.removeItem('cmms_vg_theme'); localStorage.removeItem('cmms_vg_sidebar'); true`);

    // 9. print escaping: markup in record values is printed as text, never executed
    const X = '<img src=x onerror="window.__xss=1">', Y = '<script>window.__xss=2</script>', Q = '"quoted" & \'single\' <b>bold</b>';
    const XS = JSON.parse(JSON.stringify(SEED));
    XS.assets[0] = { ...XS.assets[0], desc: X, loc: Y, model: Q, status: 'BREAKDOWN' };   // BREAKDOWN: also listed in the breakdown report
    XS.jobOrders[0] = { ...XS.jobOrders[0], problem: X, requester: Y, dept: Q, workDone: X, assetDesc: Y, parts: [{ itemCode: X, desc: Y, qty: '1', unit: Q }], manpower: [{ empId: 'E1', name: X, designation: Y, hours: 2 }] };
    await fresh('t_admin', XS);
    await ev(`window.__xss = 0; window.__prints = []; true`);
    await ev(`printJOPDF(${JSON.stringify(XS.jobOrders[0])}, ${JSON.stringify(XS.users[0])}); printAssetPDF(${JSON.stringify(XS.assets[0])}, [${JSON.stringify(XS.jobOrders[0])}], ${JSON.stringify(XS.users[0])});
      ['assetMaster','allJobOrders','breakdown','openJobOrders'].forEach(k => printReport(k, ${JSON.stringify(XS.assets)}, ${JSON.stringify(XS.jobOrders)}, ${JSON.stringify(XS.users[0])})); true`); await sleep(300);
    const pr = await ev(`(()=>{ const out = window.__prints.map(w => { const d = new DOMParser().parseFromString(w.document._h, 'text/html');
        return { imgs: d.querySelectorAll('img').length, scripts: d.querySelectorAll('script').length,
                 handlers: [...d.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name))), text: d.body.textContent }; });
      return { n: out.length, imgs: out.reduce((s, o) => s + o.imgs, 0), scripts: out.reduce((s, o) => s + o.scripts, 0), handlers: out.some(o => o.handlers),
               jo: out[0] && out[0].text.includes('<img src=x onerror="window.__xss=1">') && out[0].text.includes('<script>window.__xss=2</script>') && out[0].text.includes('"quoted" & \\'single\\' <b>bold</b>'),
               asset: out[1] && out[1].text.includes('<img src=x onerror="window.__xss=1">'), reports: out.slice(2).every(o => o.text.includes('<img src=x') || o.text.includes('<script>')) }; })()`);
    t('N1 print: 6 documents generated (JO PDF, asset sheet, 4 reports)', pr.n === 6, pr);
    t('N1 print: no injected element or event handler exists in any generated document (no img, no script, no on* attribute)', pr.imgs === 0 && pr.scripts === 0 && !pr.handlers, pr);
    t('N1 print: the markup-like values appear as literal text (JO PDF, asset sheet, reports)', pr.jo && pr.asset && pr.reports, pr);
    t('N1 print: nothing was executed in the app window', (await ev('window.__xss')) === 0);
    t('N1 print: normal formatting kept (section headings, tables, status badges)',
      await ev(`window.__prints[0].document._h.includes('Request Information') && window.__prints[0].document._h.includes('<table') && window.__prints[2].document._h.includes('class="badge')`));

    // ================= N2: no writes before sign-in, no default accounts, save queue on sign-out =================
    console.log('--- N2. no writes before sign-in; no default accounts; sign-out and the save queue');
    const loginTry = async (id, pw) => { await ev(`(()=>{ T.setVal(document.getElementById('login-username'), ${JSON.stringify(idOf(id))}); T.setVal(document.getElementById('login-password'), ${JSON.stringify(pw)}); document.querySelector('form button[type=submit]').click(); return true; })()`); await sleep(1200); };
    const signedOut = () => ev(`!!document.querySelector('.login-card') && !document.querySelector('.sidebar')`);
    const logoutNow = async () => { await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(600); };

    // A. startup, the login page and failed sign-ins write nothing, even with a correction waiting
    const EMP = JSON.parse(JSON.stringify(SEED)); EMP.employees[0] = { ...EMP.employees[0], leaveStart: '2000-01-01', leaveEnd: '2999-12-31', siteStatus: 'ON DUTY' };
    await open(EMP);
    t('N2 startup + login page with an out-of-date employee status: NOTHING read or written (no anonymous correction)', mock.writes.length === 0 && mock.store.employees[0].siteStatus === 'ON DUTY', mock.writes.map(w => w.key));
    await loginTry('t_admin', 'Wrong-Password-1'); await loginTry('nobody', 'Whatever-1'); await loginTry('t_admin', EMP.users[0].password); await sleep(1500);
    t('N2 failed sign-ins (wrong password, unknown user, stored hash typed as password) write nothing', mock.writes.length === 0 && (await signedOut()), mock.writes.map(w => w.key));

    // B. a signed-in user WITHOUT emp.statusUpdate does not trigger the write; the correction is shown
    await relogin('t_se'); await sleep(1500);
    t('N2 Senior Engineer (no emp.statusUpdate) signed in: still nothing written', mock.writes.length === 0, mock.writes.map(w => w.key));
    await nav('Employees');
    t('N2 the corrected status is shown before it is stored', await ev(`(()=>{ const r = T.row('E901'); const b = r && r.querySelector('.sb-base'); return !!b && T.txt(b).trim() === 'OL'; })()`));   // OL = the page's short code for ON LEAVE
    await logoutNow();
    t('N2 after sign-out: still nothing written', mock.writes.length === 0);

    // C. an authorized user (AE) signs in: exactly one employees write with the correction
    await relogin('t_ae'); await sleep(1800);
    t('N2 Assistant Engineer (emp.statusUpdate) signed in: the deferred correction is written once (employees only), with the right status',
      writtenKeys(0) === 'employees' && mock.writes.length === 1 && mock.store.employees[0].siteStatus === 'ON LEAVE' && mock.store.employees.slice(1).every((e, i) => JSON.stringify(e) === JSON.stringify(EMP.employees[i + 1])), mock.writes.map(w => w.key));
    await logoutNow(); await relogin('t_ae'); await sleep(1500);
    t('N2 the correction is not repeated on the next sign-in (nothing left to correct)', mock.writes.length === 1);

    // D. (P2) direct API use with the signed-in session (as an attacker would, bypassing the UI): the server enforces it.
    //    Passwords live only in Supabase Auth; no password, hash or other account's record is readable.
    await fresh('t_ae');
    const api = await ev(`(async () => {
      const a = await sb.from('app_data').select('key, value'), p = await sb.from('profiles').select('*'), u = await sb.rpc('user_list');
      const w = await sb.from('app_data').update({ value: [] }).eq('key', 'jobOrders').select('key');
      const ins = await sb.from('app_data').insert({ key: 'users', value: [] }).select('key');
      const del = await sb.from('app_data').delete().eq('key', 'assets').select('key');
      const txt = JSON.stringify([a.data, p.data, u.data]);
      return { keys: (a.data || []).map(r => r.key).sort().join(), prof: (p.data || []).map(r => r.employee_id).join(), hash: /[0-9a-f]{64}/i.test(txt), pwKey: /"(password|password_hash|encrypted_password)"/.test(txt),
               wRows: (w.data || []).length, insOk: !ins.error, delRows: (del.data || []).length }; })()`);
    t('N2 (P2 API) AE session: the users key and the environment marker row are not readable through the API', !!api.keys && !api.keys.split(',').includes('users') && !api.keys.split(',').includes('__environment'), api);
    t('N2 (P2 API) AE session: profiles returns only the own record', api.prof === 'TA002', api);
    t('N2 (P2 API) AE session: no password, hash or password field in anything readable (app_data, profiles, user_list)', !api.hash && !api.pwKey, api);
    t('N2 (P2 API) AE session: a direct job-order overwrite, a users insert and an assets delete are all refused',
      api.wRows === 0 && !api.insOk && api.delRows === 0 && mock.store.jobOrders.length === SEED.jobOrders.length && mock.store.assets.length === SEED.assets.length, api);
    await logoutNow();
    const anon = await ev(`(async () => { const a = await sb.from('app_data').select('key'), p = await sb.from('profiles').select('*'), u = await sb.rpc('user_list'), j = await sb.rpc('jo_list');
      const w = await sb.from('app_data').update({ value: [] }).eq('key', 'assets').select('key');
      return { rows: [a, p, u, j].map(r => Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1), w: (w.data || []).length }; })()`);
    t('N2 (P2 API) signed out (anonymous): app_data, profiles, user_list and jo_list return nothing; a write changes nothing',
      anon.rows.every(n => n === 0) && anon.w === 0 && mock.store.assets.length === SEED.assets.length, anon);

    // E. sign-out writes what is still waiting in the save queue (no lost change, no write after sign-out)
    await fresh('t_admin'); await nav('Asset Registry');
    let n2 = mock.writes.length;
    await ev(`T.prop('onStatusChange')('5004','BREAKDOWN'); true`); await sleep(150);   // two separate user events, well inside the 800 ms save delay
    await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(2000);
    t('N2 sign-out right after a change: the waiting change is written before the sign-out (assets only)', writtenKeys(n2) === 'assets' && mock.store.assets.find(a => a.num === '5004').status === 'BREAKDOWN' && (await signedOut()));
    n2 = mock.writes.length; await sleep(1500);
    t('N2 nothing is written after the sign-out', mock.writes.length === n2);

    // F. a forced sign-out (own account deactivated) discards the waiting change and says so
    await fresh('t_ae'); await nav('Asset Registry');
    n2 = mock.writes.length;
    await ev(`T.prop('onStatusChange')('5006','BREAKDOWN'); true`); await mock.updateAccount(2, { active: false }); await sleep(3000);
    t('N2 account deactivated while a change was waiting: signed out, the waiting asset change is NOT written, the user is told',
      (await signedOut()) && !writesSince(n2).some(w => w.key === 'assets' && !w.rejected && !w.failed) && mock.store.assets.find(a => a.num === '5006').status === 'OPERATIONAL' && (await ev(`T.body().includes('Not saved: assets') && T.body().includes('no longer active')`)), writesSince(n2).map(w => w.key));
    await mock.updateAccount(2, { active: true });

    // G. default accounts can never come back
    t('N2 the served app contains no built-in accounts and none of the local test fixtures (usernames or passwords)',
      !/DEFAULT_USERS/.test(san) && !Object.keys(PASS).some(u => san.includes("'" + u + "'") || san.includes('"' + u + '"')) && !Object.values(PASS).some(p => san.includes(p)));
    const NOU = JSON.parse(JSON.stringify(SEED)); NOU.users = [];
    await open(NOU); await loginTry('t_admin', PASS.t_admin);
    t('N2 no accounts on the server: nothing written, nobody can sign in, none is created', mock.writes.length === 0 && mock.store.users.length === 0 && (await signedOut())
      && (await ev(`T.txt(document.querySelector('.login-error')) === 'Invalid Employee ID or password. Please try again.'`)));
    const NOA = JSON.parse(JSON.stringify(SEED)); NOA.users = NOA.users.filter(u => u.username !== 't_admin');
    const ids = () => mock.store.users.map(u => u.id + ':' + u.role).join();
    await open(NOA); const idsNoa = ids(); await loginTry('t_admin', PASS.t_admin); await loginTry('admin', PASS.t_admin);
    t('N2 an Admin account removed: it is not recreated, the remaining accounts are unchanged, nothing written', mock.writes.length === 0 && ids() === idsNoa && !mock.store.users.some(u => u.id === 1) && (await signedOut()));
    await relogin('t_ae'); await sleep(1500);
    t('N2 after another user signs in, the removed Admin is still not recreated', ids() === idsNoa);

    // H. Reset Data (Admin): datasets emptied, user accounts untouched, no default accounts
    await fresh('t_admin', SEED2); await nav('Settings');
    const usersBefore = JSON.stringify(mock.store.users); n2 = mock.writes.length;
    await ev(`T.prop('onResetData')(); true`); await sleep(2500);
    t('N2 Reset Data empties assets, job orders, PM, employees and categories and does NOT write users',
      writtenKeys(n2) === 'assets,customPlants,employees,jobOrders,pm' && ['assets', 'jobOrders', 'pm', 'employees', 'customPlants'].every(k => mock.store[k].length === 0) && JSON.stringify(mock.store.users) === usersBefore, writesSince(n2).map(w => w.key));
    t('N2 after Reset Data the same accounts can still sign in; no other account exists', (await (async () => { await logoutNow(); return relogin('t_se'); })()) && JSON.parse(usersBefore).length === mock.store.users.length);
    await fresh('t_admin', SEED2); await nav('Settings');
    mock.failKeys.add('pm'); n2 = mock.writes.length;
    await ev(`T.prop('onResetData')(); true`); await sleep(2500);
    t('N2 Reset Data failing on the server: the user is told it was not saved; it is one transaction, so NOTHING was reset',
      (await ev(`T.body().includes('Not saved:') && T.body().includes('PM schedule')`)) && ['assets', 'jobOrders', 'pm', 'employees'].every(k => mock.store[k].length === SEED2[k].length));
    mock.failKeys.clear();
  }

  // ============ SESS (Phase 2B-4): session lifecycle, logout, authorization changes, save failures, browser storage ============
  console.log('--- SESS. session lifecycle and authentication-state hardening');
  {
    const loginNow = (id, pw) => ev(`(()=>{ T.setVal(document.getElementById('login-username'), ${JSON.stringify(idOf(id))}); T.setVal(document.getElementById('login-password'), ${JSON.stringify(pw)}); document.querySelector('form button[type=submit]').click(); return true; })()`);
    const atLogin = () => ev(`!!document.querySelector('.login-card input[type=password]') && !document.querySelector('.sidebar') && !document.querySelector('.main') && !document.querySelector('.modal')`);
    const logout = async () => { await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(600); };
    const storeUser = id => mock.store.users.find(u => u.id === id);
    const role = () => ev(`T.txt(document.querySelector('.sidebar-user-role'))`);
    const usersTab = () => ev(`T.all('.settings-tab').some(e => T.txt(e).includes('Users'))`);
    const activePage = () => ev(`T.txt(document.querySelector('.nav-item.active') || {textContent:''})`);
    // Browser storage after this phase: no session, no password hash (64-hex) and no "password" field anywhere; no sessionStorage, no cookies.
    const storageClean = () => ev(`(()=>{ const vals = Object.keys(localStorage).map(k => localStorage.getItem(k));
      return localStorage.getItem('cmms_vg_session') === null && !vals.some(v => /[0-9a-f]{64}/i.test(v) || /"password"/.test(v)) && sessionStorage.length === 0 && document.cookie === ''; })()`);
    // (P2) An account change made ELSEWHERE while the user is signed in (another Admin, on the server). The app re-reads its
    // own account when the window regains focus, every 60 s and after a refused action; the test uses the focus path.
    const stashSave = async () => { await nav('Settings'); };
    const changeSelf = async patch => { await mock.updateAccount(1, patch); await ev(`window.dispatchEvent(new Event('focus')); true`); await settle(); };

    // 1. logout clears everything opened in the session
    await fresh('t_admin'); await nav('Asset Registry');
    await ev(`T.click('Add Asset','button'); true`); await sleep(300);
    const modalOpen = await ev(`!!document.querySelector('.modal')`);
    await logout();
    t('SESS logout with a form open: back to the login page, nothing of the session left on screen', modalOpen && (await atLogin()));
    await relogin('t_se');
    t('SESS the next user starts clean: no form from the previous session, Dashboard, own role', (await ev(`!document.querySelector('.modal')`)) && (await activePage()).endsWith('Dashboard') && (await role()) === 'Senior Engineer');
    await nav('Settings');
    t('SESS the next user (SE) gets the Profile tab, not the previous Admin\'s Users tab', !(await usersTab()) && (await ev(`!T.row('t_admin')`)));
    t('SESS nothing about the session or any password is in browser storage (localStorage, sessionStorage, cookies)', await storageClean());

    // 2. authorization changes while signed in take effect at once. A second (synthetic) Admin exists, because the server
    //    never lets the LAST active Admin be demoted or deactivated (tested separately in tests/p2/db.test.mjs).
    const SEEDA = JSON.parse(JSON.stringify(SEED2));
    SEEDA.users.push({ id: 12, username: 't_admin2', employeeId: 'TA012', plainPassword: PASS.t_admin, fullName: 'Test Admin Two', role: 'Admin', active: true });
    await fresh('t_admin', SEEDA); await stashSave();
    await ev(`(T.all('.settings-tab').find(e=>T.txt(e).includes('Users'))||{click(){}}).click(); true`); await sleep(250);
    await ev(`T.click('Add User','button'); true`); await sleep(300);
    const before = { tab: await usersTab(), modal: await ev(`!!document.querySelector('.modal')`) };
    await changeSelf({ role: 'Viewer' });
    t('SESS Admin demoted to Viewer while on Users: Users tab, user list and the open Add User form disappear at once',
      before.tab && before.modal && storeUser(1).role === 'Viewer' && !(await usersTab()) && (await ev(`!document.querySelector('.modal') && !T.row('t_se')`)) && (await role()) === 'Viewer');
    let w0 = mock.writes.length;
    await ev(`T.prop('onResetPassword') ? T.prop('onResetPassword')(5) : null; true`); await settle();
    t('SESS the demoted account\'s handlers refuse admin actions (no write)', mock.writes.length === w0 && storeUser(5).password === SEED2.users.find(u => u.id === 5).password);

    await fresh('t_admin', SEEDA); await stashSave(); await nav('Asset Registry');
    await ev(`T.click('Add Asset','button'); true`); await sleep(300);
    const addOpen = await ev(`!!document.querySelector('.modal')`);
    await changeSelf({ role: 'Senior Engineer' });
    t('SESS Admin demoted to SE with the Add Asset form open: the form closes and Add Asset disappears', addOpen && (await ev(`!document.querySelector('.modal') && !T.find('Add Asset','button')`)) && (await role()) === 'Senior Engineer');

    await fresh('t_admin', SEEDA); await stashSave(); await nav('PM Schedule');
    await changeSelf({ role: 'Department User', department: 'Cement Plant', assignedCategories: SEED2.users.find(u => u.id === 6).assignedCategories });
    t('SESS changed to Department User while on PM Schedule (not allowed): moved to Dashboard, PM no longer in the navigation',
      storeUser(1).role === 'Department User' && (await activePage()).endsWith('Dashboard') && (await ev(`!T.all('.nav-item').some(e => T.txt(e).endsWith('PM Schedule'))`)));

    await fresh('t_admin', SEEDA); await stashSave();
    await changeSelf({ active: false });
    t('SESS account deactivated while signed in: signed out at once', storeUser(1).active === false && (await waitFor(`!!document.querySelector('.login-card input[type=password]') && !document.querySelector('.sidebar')`, 5000)));
    t('SESS the deactivated account cannot sign in again', !(await relogin('t_admin', { expectFail: true })));

    // 3. a reset whose save fails shows no temporary password and changes nothing
    await fresh('t_admin', SEED2); await nav('Settings');
    const u5 = JSON.stringify(storeUser(5));
    mock.failKeys.add('users');
    await ev(`(()=>{ T.click('Reset','button',T.row('t_jce')); return true; })()`); await settle();
    t('SESS reset with a failed save: no temporary password shown, an error is shown, the stored account is unchanged',
      (await ev(`!document.querySelector('.temp-pw-notice') && T.body().includes('The password was not reset')`)) && JSON.stringify(storeUser(5)) === u5);
    mock.failKeys.clear();
    await ev(`(()=>{ T.click('Reset','button',T.row('t_jce')); return true; })()`); await settle();
    const tmp = await ev(`(()=>{ const m = document.querySelector('.temp-pw-notice'); return m ? m.querySelector('input.temp-pw').value : null; })()`);
    t('SESS reset after the store recovers succeeds (flag set, hash changed)', !!tmp && storeUser(5).must_change_password === true && JSON.stringify(storeUser(5)) !== u5);
    await ev(`T.click('Done','.temp-pw-notice button'); true`); await sleep(300);
    t('SESS after a reset the browser storage still holds no password or hash', await storageClean());
    await logout();
    t('SESS after a reset the old password no longer signs in', !(await relogin('t_jce', { expectFail: true })));

    // 4. forced change: a failed save keeps the restriction and the old (temporary) password
    await loginNow('t_jce', tmp);
    const gated = await waitFor(`!!document.getElementById('fc-new')`, 15000);
    mock.failKeys.add('users'); const h5 = storeUser(5).password;
    await ev(`(()=>{ T.setVal(document.getElementById('fc-current'), ${JSON.stringify(tmp)}); T.setVal(document.getElementById('fc-new'), 'Jce-Fail-Pass9'); T.setVal(document.getElementById('fc-confirm'), 'Jce-Fail-Pass9'); document.querySelector('.force-change button[type=submit]').click(); return true; })()`);
    await sleep(1500);
    t('SESS forced change with a failed save: still restricted (no navigation, no pages), flag and hash unchanged, error shown',
      gated && (await ev(`!!document.getElementById('fc-new') && !document.querySelector('.sidebar') && !document.querySelector('.main')`)) && storeUser(5).must_change_password === true && storeUser(5).password === h5
      && (await ev(`T.txt(document.querySelector('.force-change .login-error')).length > 0`)));
    mock.failKeys.clear();
    await ev(`(T.all('.force-change button').find(b => T.txt(b) === 'Sign out')||{click(){}}).click(); true`); await sleep(600);
    t('SESS the new password from the failed change does not sign in', !(await relogin('t_jce', { password: 'Jce-Fail-Pass9', expectFail: true })));
    await loginNow('t_jce', tmp);
    t('SESS the temporary password still leads to the forced change after the failure', (await waitFor(`!!document.getElementById('fc-new')`, 15000)) && (await ev(`!document.querySelector('.sidebar')`)));
    await ev(`(()=>{ T.setVal(document.getElementById('fc-current'), ${JSON.stringify(tmp)}); T.setVal(document.getElementById('fc-new'), 'Jce-Good-Pass9'); T.setVal(document.getElementById('fc-confirm'), 'Jce-Good-Pass9'); document.querySelector('.force-change button[type=submit]').click(); return true; })()`);
    t('SESS forced change after recovery succeeds: flag cleared only now, application opens', (await waitFor(`!!document.querySelector('.sidebar')`, 10000)) && storeUser(5).must_change_password === false && (await role()) === 'Job Card Editor');
    await logout();
    t('SESS after the change the temporary password no longer signs in', !(await relogin('t_jce', { password: tmp, expectFail: true })));

    // 5. an old browser copy of the users list (with hashes) is removed on load and never used
    await ev(`localStorage.setItem('cmms_vg_users', JSON.stringify([{ id: 1, username: 't_admin', role: 'Admin', active: true, password: ${JSON.stringify('a'.repeat(64))} }])); true`);
    await B.send('Page.reload', {}); await waitFor(`!!document.querySelector('.login-card')`, 20000); await sleep(1500);
    t('SESS an old users copy in browser storage is deleted on load; the app starts signed out', (await ev(`localStorage.getItem('cmms_vg_users') === null`)) && (await atLogin()));
    await relogin('t_admin'); await nav('Settings'); await ev(`window.__save = T.prop('onSaveUser'); true`);
    await ev(`window.__save(${JSON.stringify({ ...SEED2.users.find(u => u.id === 3), password: '' })}, 3); true`); await settle();
    t('SESS (N1) a users save leaves no copy of the users list in browser storage', (await ev(`localStorage.getItem('cmms_vg_users') === null`)) && mock.store.users.find(u => u.id === 3).username === 't_se' && (await storageClean()));
  }

  // ============ AUTH (Phase 2B-1): local authentication foundation ============
  console.log('--- AUTH. local authentication foundation');
  {
    const toLoginPage = async (data, opt = {}) => {
      mock.reset(data); mock.failLoad = !!opt.failLoad;
      await B.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
      await B.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${SITE_PORT}`, storageTypes: 'local_storage' });
      mock.requests = [];
      await B.send('Page.navigate', { url: URL0 });
      await waitFor(`!!document.querySelector('.login-card input[type=password]')`, 20000);
      await sleep(800);
    };
    const loginNow = (id, pw) => ev(`(()=>{ T.setVal(document.getElementById('login-username'), ${JSON.stringify(idOf(id))}); T.setVal(document.getElementById('login-password'), ${JSON.stringify(pw)}); document.querySelector('form button[type=submit]').click(); return true; })()`);
    const atLogin = () => ev(`!!document.querySelector('.login-card input[type=password]') && !document.querySelector('.sidebar') && !document.querySelector('.nav-item') && !document.querySelector('.main')`);
    const errText = () => ev(`T.txt(document.querySelector('.login-error'))`);

    await toLoginPage(SEED);
    t('AUTH initial state: a fresh load is signed out and shows only the login page (no navigation, no protected page)', await atLogin());
    await ev(`localStorage.setItem('cmms_vg_session', JSON.stringify({ id: 1, username: 't_admin', fullName: 'Test Admin', role: 'Admin', active: true })); true`);
    await B.send('Page.reload', {}); await waitFor(`!!document.querySelector('.login-card')`, 20000); await sleep(1500);
    t('AUTH forged browser session (Admin id, username and role) is not accepted: still only the login page', await atLogin());
    t('AUTH the old session key is deleted on load (never read)', await ev(`localStorage.getItem('cmms_vg_session') === null`));
    await loginNow('t_admin', SEED.users[0].password); await sleep(1500);
    t('AUTH the stored password hash typed as the password is refused (no passthrough)', (await atLogin()) && (await errText()) === 'Invalid Employee ID or password. Please try again.');

    const SEEDE = JSON.parse(JSON.stringify(SEED)); SEEDE.users = SEEDE.users.map(u => u.id === 2 ? { ...u, employeeId: 'TA123' } : u);
    await toLoginPage(SEEDE);
    await loginNow('ta123', PASS.t_ae);
    const empOk = await waitFor(`!!document.querySelector('.sidebar') && !T.body().includes('Loading')`, 15000); await sleep(800);
    t('AUTH 5-character Employee ID signs in (case-insensitive); the profile shows the stored role', empOk && (await ev(`T.txt(document.querySelector('.sidebar-user-role')) === 'Assistant Engineer'`)));
    t('AUTH signing in writes no session to browser storage', await ev(`localStorage.getItem('cmms_vg_session') === null`));
    await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(600);
    t('AUTH logout returns to the login page and clears the signed-in state', (await atLogin()) && (await ev(`localStorage.getItem('cmms_vg_session') === null`)));
    await B.send('Page.reload', {}); await waitFor(`!!document.querySelector('.login-card')`, 20000); await sleep(1200);
    t('AUTH after logout and a reload: still signed out', await atLogin());

    const evStart = B.events.length;
    await toLoginPage(SEED, { failLoad: true });
    B.events.slice(evStart).forEach(e => { if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' && JSON.stringify(e.params.args || []).includes('Supabase load error')) e.__expected = true; });
    await loginNow('t_admin', PASS.t_admin); await waitFor(`!!document.querySelector('.data-unavailable') || !!document.querySelector('.sidebar')`, 15000); await sleep(1000);
    t('AUTH (N1) data failed to load after sign-in: no application (no fallback to built-in or other data); the failure screen is shown; nothing written',
      (await ev(`!!document.querySelector('.data-unavailable') && !document.querySelector('.login-card') && !document.querySelector('.sidebar')`)) && mock.writes.length === 0);
    mock.failLoad = false;
  }

  // ============ LOGIN2 (P2): login states, password recovery by email (server), recovery links, email verification, forced change ============
  console.log('--- LOGIN2. login states, password recovery, recovery links, verification, forced change');
  {
    const goLogin = async (data, opt = {}) => {
      if (!opt.keep) mock.reset(data); mock.loadDelay = opt.loadDelay || 0;
      await B.send('Page.navigate', { url: 'about:blank' }); await sleep(200);
      await B.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${SITE_PORT}`, storageTypes: 'local_storage' });
      mock.requests = [];
      await B.send('Page.navigate', { url: URL0 + (opt.hash || '') });
      await waitFor(`!!document.querySelector('.login-card')`, 20000);
    };
    // (P2) nothing is read before sign-in, so there is no "connecting" state: the form is usable at once even when the data
    // service is slow
    await goLogin(SEED, { loadDelay: 2500 });
    t('LOGIN2 (P2) the sign-in form is usable at once: no data read before sign-in, no "connecting" state',
      await ev(`!document.querySelector('.login-connecting') && !!document.querySelector('form button[type=submit]') && !document.querySelector('form button[type=submit]').disabled`));
    mock.loadDelay = 0;
    // field-level validation
    await ev(`(()=>{ T.setVal(document.getElementById('login-username'), ''); T.setVal(document.getElementById('login-password'), ''); document.querySelector('form button[type=submit]').click(); return true; })()`); await sleep(300);
    const v1 = await ev(`({ id: document.getElementById('login-username').getAttribute('aria-invalid'), pw: document.getElementById('login-password').getAttribute('aria-invalid'), marked: document.querySelectorAll('.login-input.invalid').length, msg: T.txt(document.querySelector('.login-error')) })`);
    await ev(`T.setVal(document.getElementById('login-username'), 'TA001'); true`); await sleep(150);
    const v2 = await ev(`({ id: document.getElementById('login-username').getAttribute('aria-invalid'), pw: document.getElementById('login-password').getAttribute('aria-invalid'), marked: document.querySelectorAll('.login-input.invalid').length })`);
    t('LOGIN2 validation: both empty fields are marked (aria-invalid, red outline) with the Employee ID message; typing clears that field only',
      v1.id === 'true' && v1.pw === 'true' && v1.marked === 2 && v1.msg === 'Please enter your Employee ID and password.' && v2.id === 'false' && v2.pw === 'true' && v2.marked === 1, { v1, v2 });
    t('LOGIN2 temporary-password guidance is on the sign-in card', await ev(`T.txt(document.querySelector('.login-temp-note')).includes('temporary password')`));
    // forgot password: validation, then a real request that never reveals whether an account exists
    await ev(`T.setVal(document.getElementById('login-username'), 'ab12c'); true`);
    await ev(`T.click('Forgot password?', 'button'); true`); await sleep(300);
    const r0 = await ev(`({ head: T.txt(document.querySelector('.login-welcome')), field: !!document.getElementById('recover-id'), prefill: document.getElementById('recover-id').value, pw: !!document.getElementById('login-password') })`);
    t('LOGIN2 forgot password: the card switches to "Reset password" with an Employee ID field (prefilled from a 5-character ID); no password field', r0.head === 'Reset password' && r0.field && r0.prefill === 'ab12c' && !r0.pw, r0);
    const rsub = async id => { await ev(`(()=>{ T.setVal(document.getElementById('recover-id'), ${JSON.stringify(id)}); document.querySelector('.recover-form button[type=submit]').click(); return true; })()`); await sleep(300); };
    const req0 = mock.requests.length;
    await rsub('');
    const e1 = await ev(`T.txt(document.querySelector('.recover-form .login-error'))`);
    await rsub('AB1');
    const e2 = await ev(`T.txt(document.querySelector('.recover-form .login-error'))`);
    await rsub('t_admin');
    const e3 = await ev(`(()=>{ const e = document.querySelector('.recover-form .login-error'); return e ? T.txt(e) : ''; })()`);
    t('LOGIN2 recovery validation: empty and malformed IDs refused with a clear message (marked invalid)', e1 === 'Enter your Employee ID.' && e2 === 'An Employee ID has exactly 5 letters or digits.' && e3 === e2 && (await ev(`document.getElementById('recover-id').getAttribute('aria-invalid') === 'true'`)));
    t('LOGIN2 recovery validation: an invalid ID sends nothing', !mock.requests.slice(req0).some(r => r.u.includes('request-recovery')));
    await ev(`T.click('← Back to sign in', 'button'); true`); await sleep(300);
    t('LOGIN2 back to sign in: the sign-in form is back', await ev(`!!document.getElementById('login-username') && !!document.getElementById('login-password') && T.txt(document.querySelector('.login-welcome')) === 'Welcome back'`));
    // the same answer for an unknown ID, an account without a verified recovery email, and a real one; mail only for the last
    const SEEDR = JSON.parse(JSON.stringify(SEED));
    SEEDR.users = SEEDR.users.map(u => u.id === 2 ? { ...u, recoveryEmail: 'ae-recovery@example.invalid', recoveryEmailVerified: true } : u.id === 3 ? { ...u, recoveryEmail: 'se-unverified@example.invalid', recoveryEmailVerified: false } : u);
    await goLogin(SEEDR);
    const askReset = async id => {
      await ev(`T.click('Forgot password?', 'button'); true`); await sleep(300); await rsub(id);
      await waitFor(`!!document.querySelector('.recover-form .login-success, .recover-form .login-error')`, 8000);
      const m = await ev(`T.txt(document.querySelector('.recover-form .login-success, .recover-form .login-error'))`);
      await ev(`T.click('← Back to sign in', 'button'); true`); await sleep(300); return m;
    };
    const mUnknown = await askReset('ZZ999'), mUnverified = await askReset('TS003'), mReal = await askReset('TA002');
    t('LOGIN2 recovery request: the same neutral answer for an unknown ID, an unverified address and a real account (no account enumeration)',
      mUnknown === mReal && mUnverified === mReal && /If an account with a verified recovery email exists/.test(mReal), { mUnknown, mUnverified, mReal });
    t('LOGIN2 recovery request: exactly one email, to the VERIFIED recovery address only (never the internal sign-in address)',
      mock.mails.length === 1 && mock.mails[0].to === 'ae-recovery@example.invalid' && !mock.mails.some(m => String(m.to).endsWith('@' + SIGN_IN_DOMAIN)), mock.mails.map(m => m.to));
    const link = ((mock.mails[0] || {}).text || '').match(/https?:\/\/\S+/);
    // the link from the email: landing with a new-password form; the token never stays in the address or storage
    const hashOf = l => l.slice(l.indexOf('#'));
    await goLogin(SEEDR, { keep: true, hash: link ? hashOf(link[0]) : '#none' }); await sleep(800);
    const land = await ev(`({ head: T.txt(document.querySelector('.login-welcome')), hash: location.hash, href: location.href, form: !!document.getElementById('rl-new'),
      stored: JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)), login: !!document.getElementById('login-password') })`);
    t('LOGIN2 reset link: landing "Choose a new password" with a new-password form; no sign-in form', !!link && land.head === 'Choose a new password' && land.form && !land.login, land.head);
    t('LOGIN2 reset link: the token fragment is removed from the address at once and stored nowhere', land.hash === '' && !/access_token|refresh_token/.test(land.href) && !/access_token|refresh_token|eyJ/.test(land.stored));
    const setNew = async (a, b) => { await ev(`(()=>{ T.setVal(document.getElementById('rl-new'), ${JSON.stringify(a)}); T.setVal(document.getElementById('rl-confirm'), ${JSON.stringify(b)}); document.querySelector('.recovery-landing form button[type=submit]').click(); return true; })()`); await sleep(1500); };
    await setNew('short', 'short');
    t('LOGIN2 reset link: a password that breaks the rules is refused with the rule (nothing changed)', (await ev(`!!document.querySelector('.recovery-landing .login-error') && !!document.getElementById('rl-new')`)) && mock.store.users.find(u => u.id === 2).password === SEED.users[1].password);
    await setNew('Ae-Recovered-Pass9', 'Ae-Recovered-Pass9');
    t('LOGIN2 reset link: the new password is set (confirmation shown; stored in Supabase Auth only)', (await ev(`T.txt(document.querySelector('.recovery-landing .login-success')).includes('Your password was changed')`))
      && mock.store.users.find(u => u.id === 2).password === require('crypto').createHash('sha256').update('Ae-Recovered-Pass9').digest('hex'));
    t('LOGIN2 reset link: the browser keeps no session after the reset (the user signs in normally)', await ev(`!Object.keys(localStorage).some(k => /auth|token|sb-/.test(k)) && sessionStorage.length === 0`));
    await ev(`T.click('Back to sign in', 'button'); true`); await sleep(400);
    t('LOGIN2 after the reset the old password no longer signs in', !(await relogin('t_ae', { expectFail: true })));
    t('LOGIN2 after the reset the new password signs in', await relogin('t_ae', { password: 'Ae-Recovered-Pass9' }));
    await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(600);
    // broken or expired links
    await goLogin(SEEDR, { keep: true, hash: '#error=access_denied&error_code=otp_expired&error_description=expired' }); await sleep(600);
    t('LOGIN2 expired link: "invalid or has expired" with the way to request a new one; no form', (await ev(`T.txt(document.querySelector('.recovery-landing .login-error')).includes('invalid or has expired') && !document.getElementById('rl-new')`)) && (await ev(`location.hash === ''`)));
    await goLogin(SEEDR, { keep: true, hash: '#access_token=forged-token&refresh_token=forged-refresh&expires_in=3600&type=recovery' }); await sleep(600);
    const pwBefore = mock.store.users.find(u => u.id === 2).password;
    await setNew('Forged-Reset-Pass9', 'Forged-Reset-Pass9');
    t('LOGIN2 forged link: refused ("not valid any more"), no password changed', (await ev(`T.txt(document.querySelector('.recovery-landing .login-error')).includes('not valid')`)) && mock.store.users.find(u => u.id === 2).password === pwBefore);
    // recovery email verification: an Admin sets an address, the server mails a confirmation link, the link confirms it
    await fresh('t_admin', SEEDR, { keep: true }); await nav('Settings'); mock.mails = [];
    { const u = { ...mock.store.users.find(x => x.id === 3) }; delete u.password; delete u.recoveryEmail; delete u.recoveryEmailVerified;
      await ev(`T.prop('onSaveUser')({ ...${JSON.stringify(u)}, recoveryEmail: 'se-new@example.invalid' }, 3); true`); await settle(); }
    const vm = mock.mails.find(m => m.to === 'se-new@example.invalid');
    t('LOGIN2 an Admin sets a recovery email: stored unverified, and a confirmation email goes to that address only',
      !!vm && mock.mails.length === 1 && mock.store.users.find(u => u.id === 3).recoveryEmail === 'se-new@example.invalid' && mock.store.users.find(u => u.id === 3).recoveryEmailVerified === false, mock.mails.map(m => m.to));
    const vlink = vm && (vm.text || '').match(/https?:\/\/\S+/);
    await ev(`document.querySelector('.btn-logout').click(); true`); await sleep(600);
    await goLogin(SEEDR, { keep: true, hash: vlink ? hashOf(vlink[0]) : '#verify-email=none' });
    await waitFor(`/now confirmed|could not/.test(T.txt(document.querySelector('.recovery-landing')))`, 8000);
    t('LOGIN2 verification link: its own landing ("Email confirmation"); fragment removed; the address is now verified on the server',
      !!vlink && (await ev(`T.txt(document.querySelector('.login-welcome'))`)) === 'Email confirmation' && (await ev(`location.hash === ''`)) && mock.store.users.find(u => u.id === 3).recoveryEmailVerified === true);
    // forced change screen: circuit board + live requirement checklist; the restriction is unchanged (tested in ACCT/SESS)
    const FC = JSON.parse(JSON.stringify(SEED2)); FC.users = FC.users.map(u => u.id === 5 ? { ...u, must_change_password: true } : u);
    await goLogin(FC); await sleep(1500);
    await ev(`(()=>{ T.setVal(document.getElementById('login-username'), 'TJ005'); T.setVal(document.getElementById('login-password'), ${JSON.stringify(PASS.t_jce)}); document.querySelector('form button[type=submit]').click(); return true; })()`);
    await waitFor(`!!document.getElementById('fc-new')`, 15000); await sleep(800);
    const ck = () => ev(`[...document.querySelectorAll('.pw-checklist li')].map(li => li.classList.contains('ok'))`);
    const c0 = await ck();
    await ev(`T.setVal(document.getElementById('fc-new'), 'Abcdef1!'); true`); await sleep(150);
    const c1 = await ck();
    await ev(`T.setVal(document.getElementById('fc-confirm'), 'Abcdef1!'); true`); await sleep(150);
    const c2 = await ck();
    t('LOGIN2 forced change: live checklist of the password rules (5) plus "both match"; ticks follow the input', c0.length === 6 && c0.every(x => !x) && c1.slice(0, 5).every(Boolean) && !c1[5] && c2.every(Boolean), { c0, c1, c2 });
    t('LOGIN2 forced change: same circuit board around its card; still no navigation or application', (await ev(`!!document.querySelector('.force-change > svg.login-visual') && document.querySelectorAll('.force-change .lc-traces path').length >= 4 && !document.querySelector('.sidebar')`)));
    await ev(`(T.all('.force-change button').find(b => T.txt(b) === 'Sign out')||{click(){}}).click(); true`); await sleep(500);
  }

  // ============ NOTIF (P2): server notifications (p2/sql 0008: recipients, de-duplication, read state on the server) ============
  console.log('--- NOTIF. server notifications (recipients computed by the database; local PGlite backend)');
  {
    const SEEDN = JSON.parse(JSON.stringify(SEED2));
    SEEDN.users.push({ id: 9, username: 't_jce_el', fullName: 'Test JCE Electrical', role: 'Job Card Editor', active: true, section: 'Electrical' }, { id: 21, username: 't_viewer', fullName: 'Test Viewer', role: 'Viewer', active: true });
    const bell = () => ev(`(()=>{ const b = document.querySelector('.notif-bell'); if (!b) return null; const badge = b.querySelector('.notif-badge'); return { label: b.getAttribute('aria-label'), badge: badge ? T.txt(badge) : '' }; })()`);
    const openPanel = async () => { await ev(`document.querySelector('.notif-bell').click(); true`); await sleep(900); return ev(`[...document.querySelectorAll('.notif-item')].map(e => ({ jo: e.dataset.jo, ev: e.dataset.event, unread: e.classList.contains('unread'), text: T.txt(e) }))`); };
    const closePanel = async () => { await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`); await sleep(200); };
    const as = async (user) => { await ev(`(document.querySelector('.btn-logout')||{click(){}}).click(); true`); await sleep(500); await relogin(user); await sleep(1800); };
    await fresh('t_ae', SEEDN); await sleep(1800);
    const b0 = await bell();
    t('NOTIF bell in the top bar for a signed-in user, 0 unread, accessible label; read from the server (my_notifications)',
      !!b0 && b0.label === 'Notifications, 0 unread' && b0.badge === '' && mock.requests.some(r => r.u.includes('/rpc/my_notifications')), b0);
    const p0 = await openPanel();
    t('NOTIF empty panel: "No notifications."', p0.length === 0 && (await ev(`T.txt(document.querySelector('.notif-panel')).includes('No notifications.')`)));
    await closePanel();
    // lifecycle of JO-9006 (raised by the DU t_du, id 6): AE starts it (assigning the Mechanical JCE), completes it; SE approves and closes
    await nav('Job Orders');
    await ev(`T.prop('onStatusChange')('JO-9006', 'IN PROGRESS', { assigneeId: 5 }); true`); await settle();
    await ev(`T.prop('onStatusChange')('JO-9006', 'COMPLETED'); true`); await settle();
    await sleep(2000);
    const b1 = await bell();
    t('NOTIF AE (acting user included, N-D2): badge shows 2 unread (In progress, Completed)', !!b1 && b1.badge === '2' && b1.label === 'Notifications, 2 unread', b1);
    const p1 = await openPanel();
    t('NOTIF AE panel: newest first, unread, with the job-order reference (number, asset)', p1.length === 2 && p1[0].jo === 'JO-9006' && p1[0].ev === 'COMPLETED' && p1[1].ev === 'IN_PROGRESS' && p1.every(x => x.unread) && p1[0].text.includes('Test Mixer'), p1);
    await ev(`document.querySelector('.notif-item[data-event="COMPLETED"]').click(); true`); await sleep(1500);
    t('NOTIF clicking an item marks it read ON THE SERVER and opens that job order', (await ev(`!!document.querySelector('.modal') && T.modalText().includes('jo-9006')`)) && ((await bell()) || {}).badge === '1'
      && (await mock.notesFor(2)).filter(n => n.jobNo === 'JO-9006' && n.read).map(n => n.event).join() === 'COMPLETED');
    await ev(`(document.querySelector('.modal-close')||{click(){}}).click(); true`); await sleep(300);
    await as('t_se'); await nav('Job Orders');
    await ev(`T.prop('onApproveJO')('JO-9006'); true`); await settle();
    await ev(`T.prop('onCloseJO')('JO-9006', { closedDate: '2026-10-14' }); true`); await settle(); await sleep(2000);
    const se = await openPanel();
    t('NOTIF SE: In progress, Completed and Closed of JO-9006 (approval is not a lifecycle notification)', se.map(x => x.ev).join() === 'CLOSED,COMPLETED,IN_PROGRESS', se.map(x => x.ev));
    await ev(`T.click('Mark all as read', '.notif-panel button'); true`); await sleep(1200);
    t('NOTIF "Mark all as read": every item read (on the server too), badge gone', (await ev(`[...document.querySelectorAll('.notif-item')].every(e => !e.classList.contains('unread'))`)) && ((await bell()) || {}).badge === ''
      && (await mock.notesFor(3)).every(n => n.read));
    await closePanel();
    // recipients by role (computed by the database)
    await as('t_du');
    const du = await openPanel();
    t('NOTIF Department User: only their own job order, In progress / Completed / Closed (no Raised)', du.length === 3 && du.every(x => x.jo === 'JO-9006') && du.map(x => x.ev).join() === 'CLOSED,COMPLETED,IN_PROGRESS', du.map(x => x.jo + ':' + x.ev));
    await closePanel();
    await as('t_jce');
    const jce = await openPanel();
    t('NOTIF Job Card Editor (Mechanical): only Closed of the Mechanical job order (no In progress / Completed)', jce.length === 1 && jce[0].jo === 'JO-9006' && jce[0].ev === 'CLOSED', jce);
    await closePanel();
    await as('t_jce_el');
    t('NOTIF Job Card Editor of another section (Electrical): nothing', (await openPanel()).length === 0);
    await closePanel();
    await as('t_admin');
    const ad = await openPanel();
    t('NOTIF Admin: all three lifecycle events, unread (read state is per user: the SE marking their own read changed nothing here)', ad.length === 3 && ad.every(x => x.unread), ad);
    await closePanel();
    // a new job order raised by the DU: Raised goes to Admin/AE/SE, not to the DU or the JCEs
    await as('t_du'); await nav('Job Orders');
    await ev(`T.prop('setJoModal')({ mode: 'add' }); true`); await sleep(400);
    await ev(`T.prop('onSave')({ ...${JSON.stringify(SEED2.jobOrders.find(j => j.jobNo === 'JO-9006'))}, jobNo: '', problem: 'NOTIF new job', repairType: 'Unplanned' }, null); true`); await settle(); await sleep(1600);
    const newNo = (mock.store.jobOrders.find(j => j.problem === 'NOTIF new job') || {}).jobNo;
    const has = async (id, e) => (await mock.notesFor(id)).some(n => n.jobNo === newNo && n.event === e);
    const raised = {}; for (const id of [1, 2, 3, 5, 6, 7, 9, 21]) raised[id] = await has(id, 'OPEN');
    t('NOTIF new job order raised: Raised for Admin, AE, SE; not for the DU who raised it, the JCEs, the inactive JCE or the Viewer',
      !!newNo && [1, 2, 3].every(id => raised[id]) && ![5, 6, 7, 9, 21].some(id => raised[id]), { newNo, raised });
    // no duplicates: an unrelated change to the job-order list creates nothing for unchanged statuses
    const before = await mock.noteCount();
    await as('t_ae'); await nav('Job Orders');
    await ev(`T.prop('onDeleteJO')('JO-9007'); true`); await settle(); await sleep(1500);
    t('NOTIF no duplicates: a job-order change without a status change (here a delete) creates no notification', (await mock.noteCount()) === before);
    await as('t_viewer');
    t('NOTIF Viewer: no bell and nothing stored for the Viewer', (await ev(`!document.querySelector('.notif-bell')`)) && (await mock.notesFor(21)).length === 0);
    // direct API: a user can read and mark only their own notifications
    await as('t_du');
    const api = await ev(`(async () => { const a = await sb.rpc('my_notifications', { p_limit: 50 }); const t1 = await sb.from('notifications').select('*'); const t2 = await sb.from('jo_events').select('*');
      return { own: (a.data || []).length, tbl: (t1.data || []).length + (t2.data || []).length }; })()`);
    const adminUnread0 = (await mock.notesFor(1)).filter(n => !n.read).length;
    await ev(`(async () => { for (let i = 1; i < 200; i++) await sb.rpc('notification_mark_read', { p_ids: [i] }); return true; })()`);
    t('NOTIF (API) the notification tables are not readable directly; my_notifications returns only the caller\'s own; marking others\' ids changes nothing for them',
      api.tbl === 0 && api.own === (await mock.notesFor(6)).length && (await mock.notesFor(1)).filter(n => !n.read).length === adminUnread0, { api, adminUnread0 });
    // failures are visible, not silent
    mock.notifyOff = true;
    await ev(`document.querySelector('.notif-bell').click(); true`); await sleep(1200);
    t('NOTIF if notifications cannot be loaded, the panel says so', await ev(`T.txt(document.querySelector('.notif-panel')).includes('could not be loaded')`));
    mock.notifyOff = false; await closePanel();
  }

  // ============ T9 + network ============
  console.log('--- T9 / network');
  const exc = B.events.filter(e => e.method === 'Runtime.exceptionThrown');
  const cerr = B.events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' && !e.__expected);
  t('T9 no uncaught exceptions', exc.length === 0, exc.slice(0, 3).map(e => e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || e.params.exceptionDetails.text));
  t('T9 no console errors', cerr.length === 0, cerr.slice(0, 3).map(e => e.params.args.map(a => a.value || a.description).join(' ')));
  const hosts = [...new Set(B.events.filter(e => e.method === 'Network.requestWillBeSent').map(e => { try { return new URL(e.params.request.url).host; } catch (x) { return e.params.request.url.slice(0, 30); } }))];
  t('NET only localhost site, jsDelivr/fonts and the fake staging host were requested', hosts.every(h => h === `127.0.0.1:${SITE_PORT}` || h === FAKE_HOST || /(^|\.)jsdelivr\.net$|fonts\.(googleapis|gstatic)\.com$/.test(h) || h === ''), hosts);
  t('NET no production host requested', !hosts.some(h => /aaaaaaaaaaaaaaaaaaaa|vincent-mauve/.test(h)));
  t('MOCK __environment marker never overwritten', !mock.writes.some(x => x.key === '__environment'));

  await B.close(); site.close(); mock.srv.close();
  console.log(`\nE2E: ${pass} passed, ${fail} failed` + (fail ? '\nFAILED: ' + fails.join(' | ') : ''));
  process.exit(fail ? 1 : 0);
}
let BROWSER = null;
main().catch(async e => {
  console.error('HARNESS ERROR', e);
  try { if (BROWSER) for (const x of BROWSER.events.filter(v => v.method === 'Runtime.exceptionThrown').slice(-3))
    console.error('  page exception:', ((x.params.exceptionDetails.exception || {}).description || x.params.exceptionDetails.text || '').slice(0, 400)); } catch (x) {}
  try { if (BROWSER) await BROWSER.close(); } catch (x) {} process.exit(1); });   // a harness error is a FAILURE (exit 2 = skipped)
