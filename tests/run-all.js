// Runs every local test. Nothing here contacts production or any Supabase project: the client suites use a sanitized
// in-memory copy of index.html; the P2 database suites and the E2E suite run the real P2 SQL on PGlite (local PostgreSQL in
// WebAssembly, set CMMS_PGLITE_DIR) with synthetic data. These are LOCAL results; they do not replace the staging checks
// (docs/P2A_MIGRATION.md §6.3 R-*), which need a real Supabase staging project.
// Usage:  node tests/run-all.js          (all suites)
//         node tests/run-all.js --no-e2e (fast suites only)
// Exit codes: 0 all passed; 1 a suite failed; 2 nothing failed but at least one suite was SKIPPED (never reported as passed).
'use strict';
const { spawnSync } = require('child_process'), path = require('path');
const suites = ['jsx-compile.test.js', 'staging-isolation.test.js', 'permissions.test.js',
  path.join('p2', 'static.test.mjs'), path.join('p2', 'mocked.test.mjs'),
  path.join('p2', 'db.test.mjs'), path.join('p2', 'handlers-db.test.mjs')];   // the last two need PGlite (exit 2 = skipped)
if (!process.argv.includes('--no-e2e')) suites.push(path.join('e2e', 'run.js'));
let bad = 0, skipped = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8', timeout: 1500000 });   // E2E alone takes ~15 min (2026-10-13)
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = out.trim().split('\n').filter(l => /passed, \d+ failed|ERROR|SKIPPED/.test(l)).pop() || (r.error && r.error.code === 'ETIMEDOUT' ? 'TIMEOUT after 25 min (no summary)' : '(no summary)');
  const tag = r.status === 0 ? 'OK  ' : r.status === 2 ? 'SKIP' : 'FAIL';
  console.log(`${tag} ${s.padEnd(28)} ${summary}`);
  if (r.status === 2) skipped++;
  else if (r.status !== 0) { bad++; console.log(out.split('\n').filter(l => /^FAIL|ERROR/.test(l)).slice(0, 20).join('\n')); }
}
process.exit(bad ? 1 : skipped ? 2 : 0);
