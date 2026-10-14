// Reads index.html and replaces the production Supabase URL/key lines IN MEMORY with fake values.
// Tests and the local E2E site only ever see this sanitized copy. Never print or write the real values.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.html');
function sanitizedIndex(file) {
  const real = fs.readFileSync(file || INDEX, 'utf8');
  let n = 0;
  const san = real
    .replace(/const SUPABASE_URL = '[^']*';/, () => { n++; return "const SUPABASE_URL = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co';"; })
    .replace(/const SUPABASE_ANON_KEY = '[^']*';/, () => { n++; return "const SUPABASE_ANON_KEY = 'REDACTED-PRODUCTION-KEY';"; });
  if (n !== 2) throw new Error('sanitize: expected exactly one SUPABASE_URL and one SUPABASE_ANON_KEY line');
  if (/eyJ[A-Za-z0-9_-]{20,}/.test(san)) throw new Error('sanitize: a JWT-like value remains');
  return san;
}
module.exports = { sanitizedIndex, INDEX, ROOT };
