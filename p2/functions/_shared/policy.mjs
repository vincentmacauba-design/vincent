// DRAFT — NOT DEPLOYED. Shared rules for the P2 Edge Functions (docs/P2_AUTH_PLAN.md §2.3-§2.6).
// Mirrors the browser rules in index.html (PASSWORD_RULES, validateNewPassword, generateTempPassword, EMPLOYEE_ID_RE,
// DEPARTMENTS, JCE_SECTIONS, ROLE_CAPS keys); tests/p2/static.test.mjs checks that the lists are identical.
// No secrets here: everything secret is injected at runtime (functions/*/index.ts reads Deno.env).

export const ROLES = Object.freeze(['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Department User', 'Viewer']);
export const DEPARTMENTS = Object.freeze(['Cement Plant', 'LPG / Oxygen Plant', 'Fuel Plant', 'Roofing Plant', 'General Store', 'Accounts', 'HR', 'Housekeeping', 'F&B']);
export const JCE_SECTIONS = Object.freeze(['Electrical', 'Mechanical', 'Maintenance']);
export const EMPLOYEE_ID_RE = /^[A-Za-z0-9]{5}$/;
// Supabase Auth (bcrypt) uses at most 72 BYTES of a password and refuses longer ones: the limit is in bytes, and a longer
// password is refused with a message, never silently shortened.
export const PASSWORD_MIN = 8, PASSWORD_MAX_BYTES = 72;
const utf8Length = s => new TextEncoder().encode(s).length;

// One message for every failed sign-in / recovery outcome, so responses never reveal whether an account exists.
export const SIGN_IN_FAILED = 'Invalid Employee ID or password.';
export const RECOVERY_ACK = 'If an account with a verified recovery email exists for this Employee ID, a recovery email has been sent.';
export const VERIFY_ACK = 'If the link is valid, the recovery email address is now verified.';
export const NOT_ALLOWED = 'Not allowed.';

export function normalizeEmployeeId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return EMPLOYEE_ID_RE.test(s) ? s.toUpperCase() : null;
}
// Option B (P2_AUTH_PLAN §2.3): the Auth login address is DERIVED from the Employee ID, so the browser never needs a
// lookup. The domain is an owner decision (O5) and is configuration, not code. It is a SIGN-IN identifier only:
// nothing is ever sent to it, and it can never be a recovery address (isUsableRecoveryEmail refuses it).
export function signInEmail(employeeId, domain) {
  const id = normalizeEmployeeId(employeeId);
  if (!id || !isDomain(domain)) return null;
  return id.toLowerCase() + '@' + domain.toLowerCase();
}
function isDomain(d) { return typeof d === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d); }
export function normalizeEmail(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 254 ? s : null;
}
export function isUsableRecoveryEmail(email, signInDomain) {
  const e = normalizeEmail(email);
  return !!e && !!signInDomain && !e.endsWith('@' + String(signInDomain).toLowerCase());
}

const RULES = [
  ['length', 'at least 8 characters', p => p.length >= PASSWORD_MIN], ['upper', 'an uppercase letter', p => /[A-Z]/.test(p)],
  ['lower', 'a lowercase letter', p => /[a-z]/.test(p)], ['digit', 'a number', p => /[0-9]/.test(p)],
  ['special', 'a special character', p => /[^A-Za-z0-9\s]/.test(p)],
];
export function passwordProblems(pw) {
  if (typeof pw !== 'string' || pw === '') return ['empty'];
  if (utf8Length(pw) > PASSWORD_MAX_BYTES) return ['tooLong'];
  return RULES.filter(r => !r[2](pw)).map(r => r[0]);
}
export function validatePassword(pw) {
  const bad = passwordProblems(pw);
  if (!bad.length) return null;
  if (bad[0] === 'empty') return 'A password is required.';
  if (bad[0] === 'tooLong') return 'The password is too long (maximum 72 characters).';
  return 'The password needs ' + RULES.filter(r => bad.includes(r[0])).map(r => r[1]).join(', ') + '.';
}
export function validateNewPassword(pw, current) {
  const err = validatePassword(pw);
  if (err) return err;
  if (/^[0-9a-f]{64}$/i.test(pw)) return 'Choose a different password.';
  if (pw === current) return 'The new password must differ from the current one.';
  return null;
}
const SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_=+?'];
// randomUint32(n) must be a CSPRNG (crypto.getRandomValues). Rejection sampling; one character of each class.
export function generateTempPassword(randomUint32, length = 16) {
  const below = max => { const limit = Math.floor(0x100000000 / max) * max; for (;;) { const v = randomUint32(1)[0] >>> 0; if (v < limit) return v % max; } };
  const all = SETS.join('');
  const chars = SETS.map(s => s[below(s.length)]);
  while (chars.length < Math.max(length, PASSWORD_MIN)) chars.push(all[below(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = below(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

// Account fields per role (same rules as validateUserRecord in index.html). Returns an error message or null.
export function validateAccountFields(a, knownCategories) {
  if (!a || !ROLES.includes(a.role)) return 'Choose a valid role.';
  if (typeof a.fullName !== 'string' || !a.fullName.trim() || a.fullName.trim().length > 120) return 'A full name is required.';
  if (a.role === 'Department User') {
    if (!DEPARTMENTS.includes(a.department)) return 'A Department User needs a department from the list.';
    const cats = Array.isArray(a.assignedCategories) ? a.assignedCategories.map(c => String(c).toUpperCase()) : [];
    if (!cats.length) return 'A Department User needs at least one asset category.';
    const known = (knownCategories || []).map(c => String(c).toUpperCase());
    if (cats.some(c => !known.includes(c))) return 'Unknown asset category.';
    if (new Set(cats).size !== cats.length) return 'Duplicate asset category.';
  } else if (a.department != null || (a.assignedCategories != null && a.assignedCategories.length)) return 'Department and categories are only for Department Users.';
  if (a.role === 'Job Card Editor') { if (!JCE_SECTIONS.includes(a.section)) return 'A Job Card Editor needs one section: Electrical, Mechanical or Maintenance.'; }
  else if (a.section != null && a.section !== '') return 'A section is only for Job Card Editors.';
  return null;
}
