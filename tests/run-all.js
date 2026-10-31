// Runs every local test. Nothing here contacts production: all suites use a sanitized in-memory copy of
// index.html, and the E2E suite runs it on 127.0.0.1 against a local mock with synthetic data.
// Usage:  node tests/run-all.js          (all suites)
//         node tests/run-all.js --no-e2e (fast suites only)
'use strict';
const { spawnSync } = require('child_process'), path = require('path');
const suites = ['jsx-compile.test.js', 'staging-isolation.test.js', 'permissions.test.js', 'branding.test.js', 'settings-users-numbering.test.js'];
if (!process.argv.includes('--no-e2e')) suites.push(path.join('e2e', 'run.js'), path.join('e2e', 'role-check.js'));   // role-check: test accounts per role, local mock only
let bad = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8', timeout: 1500000 });   // E2E alone takes ~15 min (2026-10-13)
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = out.trim().split('\n').filter(l => /passed, \d+ failed|ERROR/.test(l)).pop() || (r.error && r.error.code === 'ETIMEDOUT' ? 'TIMEOUT after 25 min (no summary)' : '(no summary)');
  console.log(`${r.status === 0 ? 'OK  ' : 'FAIL'} ${s.padEnd(28)} ${summary}`);
  if (r.status !== 0) { bad++; console.log(out.split('\n').filter(l => /^FAIL|ERROR/.test(l)).slice(0, 20).join('\n')); }
}
process.exit(bad ? 1 : 0);
