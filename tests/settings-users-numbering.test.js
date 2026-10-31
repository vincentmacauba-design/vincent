// Settings → Users: the # column is the position in the displayed list (1, 2, 3 ...), never the stored account id.
// The stored id (profiles.legacy_id) is permanent, has gaps, and job orders reference it, so it must stay unchanged.
// Renders the REAL SettingsPage from index.html with the same pinned React the app loads, on synthetic accounts only.
// Nothing here contacts a backend. Usage: node tests/settings-users-numbering.test.js [other-index.html]
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), crypto = require('crypto');
const FILES = [
  ['react.production.min.js', 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js', 'REACT_SHA'],
  ['react-dom-server-legacy.browser.production.min.js', 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom-server-legacy.browser.production.min.js', 'SERVER_SHA'],
];
const SHA = {
  REACT_SHA: 'd949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd',
  SERVER_SHA: '829b2f17da148d9bc5b635c329b67068e67e4bf7d6a5bb64e49e9e92483deee5',
};
const BABEL = { src: 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.29.7/babel.min.js', sha: '7f55bd5c3efadeaa83d4de97dc91da8bf0733789801cf28b9273c4284739798e' };
const CACHE = path.join(os.tmpdir(), 'cmms-tests');
async function cached(name, url, sha) {
  const f = path.join(CACHE, name);
  if (!fs.existsSync(f)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const r = await fetch(url); if (!r.ok) throw new Error('download failed: ' + url + ' ' + r.status);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const src = fs.readFileSync(f), h = crypto.createHash('sha256').update(src).digest('hex');
  if (h !== sha) throw new Error('checksum mismatch: ' + name + ' ' + h);
  return { file: f, code: src.toString('utf8') };
}

let pass = 0, fail = 0;
const t = (n, c, info) => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && info !== undefined ? ' -> ' + info : '')); };
const seq = n => Array.from({ length: n }, (_, i) => i + 1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Synthetic: the same id shape as a list where ids 4-17 were never given to an account (1, 2, 3, 18, 19 ...).
const ROLES = ['Admin', 'Senior Engineer', 'Assistant Engineer', 'Job Card Editor', 'Viewer', 'Department User'];
const ids = [1, 2, 3, ...Array.from({ length: 25 }, (_, i) => 18 + i)];
const makeUsers = () => ids.map((id, i) => ({
  id, employeeId: 'T-' + String(9000 + id), username: 'synthetic' + id, fullName: 'Synthetic Person ' + id, role: i < 3 ? ROLES[i] : ROLES[3 + (i % 3)],
  active: i % 5 !== 4, section: 'Electrical', department: ['Fuel Farm'], assignedCategories: ['01 FUEL FARM'],
}));

(async () => {
  const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const [react, server, babel] = [
    await cached(FILES[0][0], FILES[0][1], SHA.REACT_SHA),
    await cached(FILES[1][0], FILES[1][1], SHA.SERVER_SHA),
    await cached('babel-standalone-7.29.7.min.js', BABEL.src, BABEL.sha),
  ];
  const Babel = require(babel.file);
  const block = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('block not found: ' + from); return html.slice(a, b); };

  // the real permission rules, the real status helpers' normSection, the real Settings page; the page's dialogs are closed in this test
  const ctx = { TextEncoder, URLSearchParams, console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(react.code, ctx); vm.runInContext(server.code, ctx);
  vm.runInContext("var { useState } = React; var EMAIL_FEATURES = false; var DESIGNATIONS = {};", ctx);
  vm.runInContext((html.match(/^const DATA_KEYS = .*$/m) || [''])[0], ctx);
  vm.runInContext(block('// ─── PERMISSIONS', '// ─── ASSET IMPORT PLAN'), ctx);
  const page = Babel.transform(block('// ─── SETTINGS PAGE', '// ─── ASSET VIEW MODAL'), { presets: ['react'] }).code;
  vm.runInContext(page + '\nthis.SettingsPage = SettingsPage;', ctx);

  const render = users => ctx.ReactDOMServer.renderToStaticMarkup(ctx.React.createElement(ctx.SettingsPage, { users, currentUser: makeUsers()[0], customPlants: [] }));
  const text = s => s.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
  const rows = out => [...out.slice(out.indexOf('<tbody>'), out.indexOf('</tbody>')).matchAll(/<tr[ >][\s\S]*?<\/tr>/g)].map(m => [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => text(c[1])));
  const numbers = r => r.map(c => Number(c[0]));

  const users = makeUsers(), before = JSON.stringify(users);
  const all = rows(render(users));
  t('28 users render 28 rows', all.length === 28, all.length);
  t('28 users are numbered 1-28 with no gap', same(numbers(all), seq(28)), numbers(all));
  t('order, names, Employee IDs and roles stay with their account', all.every((c, i) => c[1].startsWith(users[i].fullName) && c[2] === users[i].employeeId && c[3] === users[i].role.toUpperCase()));
  t('status stays with its account', all.every((c, i) => c[5] === (users[i].active ? 'ACTIVE' : 'INACTIVE')));
  t('rendering does not change the user records (ids, roles, assignments)', JSON.stringify(users) === before);

  const filtered = users.filter(u => u.role !== 'Viewer'), fr = rows(render(filtered));
  t('a filtered list is numbered consecutively', fr.length === filtered.length && same(numbers(fr), seq(filtered.length)), numbers(fr));
  t('a filtered list keeps the right people', fr.every((c, i) => c[2] === filtered[i].employeeId));

  const removed = users.filter(u => u.id % 2), rr = rows(render(removed));
  t('entries removed from the list leave no gap', same(numbers(rr), seq(removed.length)), numbers(rr));

  const sorted = [...users].sort((a, b) => b.id - a.id), sr = rows(render(sorted));
  t('a sorted list is numbered by displayed position', same(numbers(sr), seq(28)), numbers(sr));
  t('a sorted list keeps the right people', sr.every((c, i) => c[2] === sorted[i].employeeId));

  t('the stored id is still used for the row key and every action', /<tr key=\{u\.id\}>/.test(page) || /key: u\.id/.test(page));
  t('the stored id is no longer displayed in the # column', !/\}, u\.id\), /.test(page));

  console.log(`Users numbering: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
