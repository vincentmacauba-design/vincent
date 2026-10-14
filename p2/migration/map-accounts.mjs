// DRAFT TOOL — builds the account-migration PLAN (docs/P2A_MIGRATION.md §5). It changes nothing and contacts nothing.
// Input (owner-provided, kept OUTSIDE the repository): the `users` array from a verified backup, the `jobOrders` array,
// and the owner's mapping [{legacyId, employeeId, recoveryEmail}]. Output: profile rows to create + errors/warnings.
//   * NO passwords: password / hash fields are never read into the plan; every account gets a temporary password
//     from admin-users at creation (must_change_password = true).
//   * NO invented data: an account without an owner-provided Employee ID is an ERROR, never a generated value.
//   * NO job-order rewrite: legacy_id = users[].id exactly; job orders are only READ to report dangling references.
// CLI (prints counts and error messages only, never names, emails or ids):
//   node p2/migration/map-accounts.mjs <users.json> <jobOrders.json> <mapping.json> <signInDomain>
import { ROLES, DEPARTMENTS, JCE_SECTIONS, normalizeEmployeeId, normalizeEmail, isUsableRecoveryEmail } from '../functions/_shared/policy.mjs';

export const JO_USER_REFS = Object.freeze(['requesterId', 'approvedById', 'assignedToId']);   // + approvalHistory[].byId

export function buildAccountPlan({ users, jobOrders, mapping, signInDomain }) {
  const errors = [], warnings = [], accounts = [];
  if (!Array.isArray(users) || !Array.isArray(mapping)) return { accounts, errors: ['users and mapping must be arrays'], warnings, references: null };
  if (mapping.some(m => m && Object.keys(m).some(k => /pass|hash|secret|token/i.test(k)))) errors.push('the mapping must not contain password, hash, secret or token fields');
  const byLegacy = new Map();
  for (const m of mapping) { if (!m || !Number.isInteger(m.legacyId)) { errors.push('mapping entry without an integer legacyId'); continue; }
    if (byLegacy.has(m.legacyId)) errors.push(`mapping lists legacyId ${m.legacyId} twice`); byLegacy.set(m.legacyId, m); }
  const seenEid = new Set(), seenEmail = new Set();
  users.forEach((u, i) => {
    const where = `users[${i}]`;
    if (!u || !Number.isInteger(u.id) || u.id <= 0) { errors.push(`${where}: no positive integer id`); return; }
    const m = byLegacy.get(u.id);
    if (!m) { errors.push(`${where}: no owner-provided mapping (Employee ID) for this account`); return; }
    const eid = normalizeEmployeeId(m.employeeId);
    if (!eid) errors.push(`${where}: Employee ID must be exactly 5 letters or digits`);
    else if (seenEid.has(eid)) errors.push(`${where}: Employee ID used twice`); else seenEid.add(eid);
    let email = null;
    if (m.recoveryEmail != null && m.recoveryEmail !== '') {
      email = normalizeEmail(m.recoveryEmail);
      if (!email || !isUsableRecoveryEmail(email, signInDomain)) errors.push(`${where}: recovery email is not a real, deliverable address`);
      else if (seenEmail.has(email)) errors.push(`${where}: recovery email used twice`); else seenEmail.add(email);
    } else warnings.push(`${where}: no recovery email (password recovery unavailable until one is set and verified)`);
    if (!ROLES.includes(u.role)) errors.push(`${where}: unknown role`);
    if (u.role === 'Department User' && (!DEPARTMENTS.includes(u.department) || !Array.isArray(u.assignedCategories) || !u.assignedCategories.length)) errors.push(`${where}: Department User needs a department and categories`);
    if (u.role === 'Job Card Editor' && !JCE_SECTIONS.includes(u.section)) errors.push(`${where}: Job Card Editor needs a section`);
    if (typeof u.fullName !== 'string' || !u.fullName.trim()) errors.push(`${where}: no full name`);
    accounts.push({ legacy_id: u.id, employee_id: eid, username: typeof u.username === 'string' ? u.username : null, full_name: String(u.fullName || '').trim(),
      recovery_email: email, role: u.role, department: u.role === 'Department User' ? u.department : null,
      assigned_categories: u.role === 'Department User' ? (u.assignedCategories || []).map(c => String(c).toUpperCase()) : null,
      section: u.role === 'Job Card Editor' ? u.section : null, active: u.active !== false, must_change_password: true });
  });
  for (const k of byLegacy.keys()) if (!users.some(u => u && u.id === k)) warnings.push(`mapping has legacyId ${k} that is not in users`);
  if (!accounts.some(a => a.role === 'Admin' && a.active)) errors.push('at least one active Admin is required');
  // Job-order references: read only. Every referenced id must be an account in the plan (active or not).
  const ids = new Set(accounts.map(a => a.legacy_id)); const dangling = []; let checked = 0;
  (Array.isArray(jobOrders) ? jobOrders : []).forEach(j => {
    const refs = [...JO_USER_REFS.map(k => j && j[k]), ...((j && Array.isArray(j.approvalHistory)) ? j.approvalHistory.map(e => e && e.byId) : [])].filter(v => v != null && v !== '');
    refs.forEach(v => { checked++; if (!ids.has(Number(v))) dangling.push({ jobNo: j.jobNo, ref: v }); });
  });
  if (dangling.length) warnings.push(`${dangling.length} job-order user reference(s) point to no account (reported, NOT changed)`);
  return { accounts, errors, warnings, references: { checked, dangling } };
}

// CLI: counts and messages only
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('map-accounts.mjs')) {
  const fs = await import('node:fs');
  const [u, j, m, d] = process.argv.slice(2);
  if (!u || !j || !m || !d) { console.log('usage: node p2/migration/map-accounts.mjs <users.json> <jobOrders.json> <mapping.json> <signInDomain>'); process.exit(2); }
  const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const plan = buildAccountPlan({ users: read(u), jobOrders: read(j), mapping: read(m), signInDomain: d });
  console.log(`accounts: ${plan.accounts.length}  errors: ${plan.errors.length}  warnings: ${plan.warnings.length}  job-order refs checked: ${plan.references ? plan.references.checked : 0}`);
  plan.errors.forEach(e => console.log('ERROR ' + e)); plan.warnings.forEach(w => console.log('WARN  ' + w));
  process.exit(plan.errors.length ? 1 : 0);
}
