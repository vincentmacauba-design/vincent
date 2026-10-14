// Compiles the <script type="text/babel"> block with the SAME pinned @babel/standalone the app loads (7.29.7).
// A JSX syntax error blanks the whole app in production, so this must pass before any change is shared.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { sanitizedIndex } = require('./lib/sanitize');
const SRC = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.29.7/babel.min.js';
const SHA = '7f55bd5c3efadeaa83d4de97dc91da8bf0733789801cf28b9273c4284739798e';
const CACHE = path.join(os.tmpdir(), 'cmms-tests', 'babel-standalone-7.29.7.min.js');
(async () => {
  if (!fs.existsSync(CACHE)) {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    const r = await fetch(SRC); if (!r.ok) throw new Error('download failed: ' + r.status);
    fs.writeFileSync(CACHE, Buffer.from(await r.arrayBuffer()));
  }
  const h = crypto.createHash('sha256').update(fs.readFileSync(CACHE)).digest('hex');
  if (h !== SHA) throw new Error('babel checksum mismatch (expected pinned 7.29.7)');
  const Babel = require(CACHE);
  const html = sanitizedIndex(process.argv[2]);
  const open = '<script type="text/babel">';
  const i = html.indexOf(open), j = html.indexOf('</script>', i);
  try { Babel.transform(html.slice(i + open.length, j), { presets: ['react'] }); console.log('JSX compile: 1 passed, 0 failed'); }
  catch (e) { console.log('FAIL JSX compile: ' + e.message.split('\n')[0]); console.log('JSX compile: 0 passed, 1 failed'); process.exit(1); }
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
