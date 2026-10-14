// DRAFT TOOL — NOT RUN against any Supabase project. Creates the CMMS accounts from an account PLAN (map-accounts.mjs).
// It solves the bootstrap problem (admin-users needs an existing Admin): it runs once, with the SERVICE ROLE, on the
// owner's machine, against staging first.
//   * Every account gets a Supabase Auth user (sign-in address derived from the Employee ID; never a mail address) with a
//     NEW random temporary password and must_change_password = true. No old password or hash is used or migrated.
//   * legacy_id = the old numeric user id, exactly (job orders keep their references). Nothing in app_data changes.
//   * All-or-nothing per account: if the profile cannot be written, the Auth user is deleted again.
//   * Accounts that already exist (same legacy id or Employee ID) are skipped, so a rerun after a failure is safe.
//   * An account that is inactive in the old data is created inactive AND blocked in Supabase Auth (as admin-users does).
//   * Department User accounts are created inactive and blocked unless opts.activateDepartmentUsers === true: their
//     server-side scoping must be deployed and verified first (DEPLOYMENT.md, step 9). An Admin activates them later.
//   * The temporary passwords are RETURNED ONCE for the owner to deliver (decision D5). There is no command-line runner in
//     the repository: the owner-run script (staging first) must write them only to a path accepted by safeOutputPath()
//     (outside the repository) and never print or log them.
import { generateTempPassword, signInEmail } from '../functions/_shared/policy.mjs';

// deps = { config: {signInDomain}, randomUint32(n), auth: {createUser, updateUser, deleteUser}, db: {profileByLegacyId, profileByEmployeeId, insertProfile, insertAudit}, log }
export async function provisionAccounts(plan, deps, opts = {}) {
  const results = [];
  const accounts = plan && Array.isArray(plan.accounts) ? plan.accounts : [];
  if (!plan || (plan.errors && plan.errors.length)) return { ok: false, error: 'the plan has errors: fix them first (map-accounts.mjs)', results };
  if (!accounts.some(a => a.role === 'Admin' && a.active)) return { ok: false, error: 'the plan has no active Admin', results };
  for (const a of accounts) {
    const email = signInEmail(a.employee_id, deps.config.signInDomain);
    if (!email) { results.push({ legacyId: a.legacy_id, status: 'error', error: 'invalid Employee ID or sign-in domain' }); continue; }
    if (await deps.db.profileByLegacyId(a.legacy_id) || await deps.db.profileByEmployeeId(a.employee_id)) { results.push({ legacyId: a.legacy_id, status: 'exists' }); continue; }
    const active = a.active !== false && (a.role !== 'Department User' || opts.activateDepartmentUsers === true);
    const temp = generateTempPassword(deps.randomUint32);
    let user;
    try { user = await deps.auth.createUser({ email, password: temp, email_confirm: true }); }
    catch (e) { results.push({ legacyId: a.legacy_id, status: 'error', error: 'the Auth account could not be created' }); continue; }
    try {
      if (!active) await deps.auth.updateUser(user.id, { ban_duration: '876000h' });   // blocked before any profile exists
      await deps.db.insertProfile({ user_id: user.id, legacy_id: a.legacy_id, employee_id: a.employee_id, username: a.username || null, full_name: a.full_name,
        recovery_email: a.recovery_email || null, role: a.role, department: a.department, assigned_categories: a.assigned_categories, section: a.section,
        active, must_change_password: true });
    } catch (e) {
      await deps.auth.deleteUser(user.id).catch(() => (deps.log || (() => {}))('provision.compensate_failed'));
      results.push({ legacyId: a.legacy_id, status: 'error', error: 'the profile could not be written (Auth account removed again)' });
      continue;
    }
    await deps.db.insertAudit({ actor: null, action: 'account.provisioned', target: user.id, details: { legacyId: a.legacy_id, role: a.role } }).catch(() => {});
    results.push({ legacyId: a.legacy_id, employeeId: a.employee_id, status: 'created', active, temporaryPassword: temp });
  }
  return { ok: results.every(r => r.status !== 'error'), results };
}

// Where the temporary passwords may be written: never inside the repository folder.
export function safeOutputPath(outPath, repoRoot, pathMod) {
  const abs = pathMod.resolve(outPath), root = pathMod.resolve(repoRoot);
  const rel = pathMod.relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !pathMod.isAbsolute(rel)) ? null : abs;
}
