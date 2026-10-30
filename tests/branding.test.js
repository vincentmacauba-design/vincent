// Branding checks (static, offline): the web logo file, every reference to it, its deployment allowlist entry and its
// cache rule. The logo is the approved artwork (Branding/cmms-logo.png, outside the repository) with the black surround
// made transparent, made by Operations/branding-tools/make-web-logo.mjs.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, info) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || info === undefined ? '' : '  -> ' + JSON.stringify(info)}`); };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const app = read('index.html'), vi = read('.vercelignore'), vercel = JSON.parse(read('vercel.json'));

// 1. the logo file: exactly one, named after its own content hash
const logos = fs.readdirSync(ROOT).filter(f => /^cmms-logo/.test(f));
t('exactly one logo file at the site root, named cmms-logo.<8 hex>.png', logos.length === 1 && /^cmms-logo\.[0-9a-f]{8}\.png$/.test(logos[0]), logos);
const LOGO = logos[0], buf = fs.readFileSync(path.join(ROOT, LOGO));
t('the name carries the first 8 hex digits of the file\'s SHA-256 (a changed file gets a new name, so caching it for good is safe)',
  crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8) === LOGO.slice(10, 18));

// 2. the PNG itself: 256 x 256 RGBA, transparent corners, opaque centre, small
function rgbaPixels(b) {   // minimal decoder for 8-bit RGBA non-interlaced PNGs
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20); let o = 8; const idat = [];
  while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8); if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), s = w * 4, px = new Uint8Array(s * h);
  const pa = (a, b2, c) => { const p = a + b2 - c, x = Math.abs(p - a), y = Math.abs(p - b2), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b2 : c; };
  for (let y = 0; y < h; y++) { const f = raw[y * (s + 1)];
    for (let x = 0; x < s; x++) { const a = x >= 4 ? px[y * s + x - 4] : 0, up = y ? px[(y - 1) * s + x] : 0, c = x >= 4 && y ? px[(y - 1) * s + x - 4] : 0, v = raw[y * (s + 1) + 1 + x];
      px[y * s + x] = f === 0 ? v : f === 1 ? v + a : f === 2 ? v + up : f === 3 ? v + ((a + up) >> 1) : v + pa(a, up, c); } }
  return { w, h, px };
}
const ok8rgba = buf.slice(1, 4).toString() === 'PNG' && buf[24] === 8 && buf[25] === 6 && buf[28] === 0;
t('PNG, 8-bit RGBA (alpha channel), non-interlaced', ok8rgba);
const { w, h, px } = ok8rgba ? rgbaPixels(buf) : { w: 0, h: 0, px: [] };
const alpha = (x, y) => px[(y * w + x) * 4 + 3];
t('256 x 256 (square: never stretched; enough for the 60px login logo at 3x and a print header)', w === 256 && h === 256, [w, h]);
t('transparent outside the rounded tile (all four corners alpha 0: no black square corners)', [alpha(0, 0), alpha(w - 1, 0), alpha(0, h - 1), alpha(w - 1, h - 1), alpha(4, 4), alpha(w - 5, h - 5)].every(a => a === 0));
t('opaque inside (centre and the middle of each side of the tile, alpha 255)', [alpha(w >> 1, h >> 1), alpha(w >> 1, 20), alpha(20, h >> 1), alpha(w - 21, h >> 1), alpha(w >> 1, h - 21)].every(a => a === 255));
t('optimised for the web: at most 150 KB (the 1254px original is 1.34 MB)', buf.length <= 150 * 1024, buf.length);

// 3. every reference points to that file
t('index.html: preload, favicon and LOGO_SRC all name this file',
  app.includes(`<link rel="preload" as="image" href="${LOGO}"`) && app.includes(`<link rel="icon" type="image/png" href="${LOGO}"/>`) && app.includes(`const LOGO_SRC = '${LOGO}';`));
t('index.html: top bar, login screen and the report/print header use LOGO_SRC',
  /<img className="logo-icon" src=\{LOGO_SRC\}/.test(app) && /<img className="login-logo-icon" src=\{LOGO_SRC\}/.test(app) && /<img class="hdr-logo" src="\$\{escHtml\(new URL\(LOGO_SRC, location\.href\)\.href\)\}"/.test(app));
const others = (app.match(/(?<!Branding\/)cmms-logo[^"'\s)]*\.png/g) || []).filter(m => m !== LOGO);   // the comment naming the approved source (Branding/...) is not a reference
t('no other logo file is referenced anywhere (the old cmms-logo.png is gone)', others.length === 0, others);
t('the old orange "CMM" report mark and the inline SVG favicon are gone', !/hdr-icon/.test(app) && !/>CMM</.test(app) && !/image\/svg\+xml/.test(app));
t('the print window waits for the header logo before printing (load or error, at most 3 s)',
  /querySelector\('\.hdr-logo'\)/.test(app) && /addEventListener\('load', printNow\)/.test(app) && /addEventListener\('error', printNow\)/.test(app) && /setTimeout\(printNow, 3000\)/.test(app));

// 4. deployment: allowlisted, and only this file is cached
const allowed = vi.split(/\r?\n/).filter(l => l.startsWith('!')).sort();
t('.vercelignore re-includes exactly index.html, vercel.json and the logo', JSON.stringify(allowed) === JSON.stringify([`!${LOGO}`, '!index.html', '!vercel.json'].sort()), allowed);
// path-to-regexp turns these sources (groups + literal slashes only) into ^<source>[/#?]?$, case-insensitive; checked
// against path-to-regexp 6.1.0 (the version Vercel uses) when this was written.
const rules = vercel.headers.map(r => ({ re: new RegExp('^' + r.source + '[\\/#\\?]?$', 'i'), cc: r.headers.find(x => x.key === 'Cache-Control').value }));
const cc = p => rules.filter(r => r.re.test(p)).map(r => r.cc);
const NOSTORE = 'no-store, no-cache, must-revalidate';
t('cache: the logo is cached for a year (immutable), by exactly one rule', JSON.stringify(cc('/' + LOGO)) === JSON.stringify(['public, max-age=31536000, immutable']), cc('/' + LOGO));
t('cache: "/", "/index.html" and every other path stay no-store, as before', ['/', '/index.html', '/cmms-logo.png', '/staging-config.js', '/other', `/x/${LOGO}`, `/${LOGO}.bak`]
  .every(p => cc(p).length >= 1 && cc(p).every(v => v === NOSTORE)), ['/', '/index.html', '/cmms-logo.png'].map(cc));
console.log(`\nBranding: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
