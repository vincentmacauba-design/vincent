// DRAFT — NOT DEPLOYED. P2 Edge Function logic (docs/P2_AUTH_PLAN.md §2.3-§2.8; docs/P2A_MIGRATION.md §4).
// Pure logic with INJECTED dependencies, so the same code runs in the Deno wrappers (functions/*/index.ts) and in the
// mocked Node tests (tests/p2/mocked.test.mjs). Nothing here holds or reads a secret.
//
// deps = {
//   config: { signInDomain, appUrl, verifyTtlMinutes, recoveryMinMs, departmentUsersEnabled },
//   now(): Date,  sleep(ms): Promise,  randomUint32(n): Uint32Array (CSPRNG),  randomToken(): string (>= 32 random bytes),
//   hash(s): Promise<64-hex>          HMAC-SHA-256 with a server-side pepper (rate-limit subjects, verification tokens)
//   auth: { createUser({email, password, email_confirm}) -> {id},  updateUser(id, {password?, ban_duration?}),
//           deleteUser(id),  signOutAll(id),  generateRecoveryLink(signInEmail) -> url,  verifyPassword(signInEmail, pw) -> bool },
//   db:   { profileByUser(uid), profileByEmployeeId(eid), profileByRecoveryEmail(email), profileByLegacyId(n),
//           insertProfile(row), updateProfile(uid, patch), nextLegacyId(), activeAdminCount(), knownCategories(),
//           rateLimitHit(bucket, subjectHash, max, windowSeconds) -> bool (true = allowed),
//           insertAudit({actor, action, target, details}), saveVerification(row), takeVerification(tokenHash, now) -> row|null },
//   mail: { send({to, subject, text}) },
//   log(event, info)   operational log WITHOUT personal data, tokens or passwords
// }
// request  = { caller: auth user id from a VERIFIED JWT, or null;  ip: string;  body: object }
// response = { status, body, headers }
import { ROLES, NOT_ALLOWED, RECOVERY_ACK, VERIFY_ACK, normalizeEmployeeId, normalizeEmail, isUsableRecoveryEmail, signInEmail,
         validateNewPassword, validatePassword, generateTempPassword, validateAccountFields } from './policy.mjs';

export const LIMITS = Object.freeze({
  admin:    { max: 30, window: 3600 },   // per Admin, per action type
  pwchange: { max: 10, window: 900 },    // per signed-in user
  recoveryIp: { max: 10, window: 3600 }, // per client IP
  recoveryId: { max: 3, window: 3600 },  // per Employee ID (hashed)
  verifyIp: { max: 20, window: 3600 },   // per client IP
});
const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const res = (status, body) => ({ status, body, headers: NO_STORE });
const deny = () => res(403, { error: NOT_ALLOWED });
const tooMany = () => res(429, { error: 'Too many requests. Try again later.' });
// Department User access stays OFF until its server-side scoping is deployed and verified (DEPLOYMENT.md step 9):
// config.departmentUsersEnabled must be exactly true (secret CMMS_DEPARTMENT_USERS=enabled). Missing = off (fail closed).
const DU_OFF = 'Department User accounts are not enabled yet: their access scoping must be verified on the server first. Create the account as inactive.';

export function createHandlers(deps) {
  const { config, db, auth, mail } = deps;
  const log = deps.log || (() => {});
  const audit = (actor, action, target, details = {}) => db.insertAudit({ actor: actor || null, action, target: target || null, details });
  const limited = async (bucket, subject, lim) => !(await db.rateLimitHit(bucket, await deps.hash(bucket + ':' + subject), lim.max, lim.window));
  const activeProfile = async uid => { if (!uid) return null; const p = await db.profileByUser(uid); return p && p.active && !p.must_change_password ? p : null; };

  async function sendVerification(userId, email) {
    const token = deps.randomToken();
    const expires = new Date(deps.now().getTime() + (config.verifyTtlMinutes || 1440) * 60000);
    await db.saveVerification({ token_hash: await deps.hash('verify:' + token), user_id: userId, email, expires_at: expires.toISOString() });
    await mail.send({ to: email, subject: 'CMMS: confirm your recovery email address',
      text: `Confirm this address for CMMS password recovery: ${config.appUrl}#verify-email=${token}\nIf you did not expect this, ignore it.` });
  }

  // ---------------- admin-users (Admin only) ----------------
  async function adminUsers(req) {
    const me = await activeProfile(req.caller);
    if (!me || me.role !== 'Admin') return deny();
    const b = req.body || {};
    const action = b.action;
    if (!['create', 'reset_password', 'set_active', 'update'].includes(action)) return res(400, { error: 'Unknown action.' });
    if (await limited('admin:' + action, me.user_id, LIMITS.admin)) return tooMany();

    if (action === 'create') {
      const employeeId = normalizeEmployeeId(b.employeeId);
      if (!employeeId) return res(400, { error: 'The Employee ID must be exactly 5 letters or digits.' });
      const fieldErr = validateAccountFields(b, await db.knownCategories());
      if (fieldErr) return res(400, { error: fieldErr });
      if (b.role === 'Department User' && b.active !== false && config.departmentUsersEnabled !== true) return res(409, { error: DU_OFF });
      const email = b.recoveryEmail == null || b.recoveryEmail === '' ? null : normalizeEmail(b.recoveryEmail);
      if (b.recoveryEmail && (!email || !isUsableRecoveryEmail(email, config.signInDomain))) return res(400, { error: 'Enter a real, deliverable recovery email address.' });
      if (await db.profileByEmployeeId(employeeId)) return res(409, { error: 'This Employee ID is already used.' });
      if (email && await db.profileByRecoveryEmail(email)) return res(409, { error: 'This recovery email is already used.' });
      let legacyId;
      if (b.legacyId != null) {   // migration only: keep the existing numeric id that job orders reference
        if (!Number.isInteger(b.legacyId) || b.legacyId <= 0) return res(400, { error: 'Invalid legacy id.' });
        if (await db.profileByLegacyId(b.legacyId)) return res(409, { error: 'This legacy id is already used.' });
        legacyId = b.legacyId;
      } else legacyId = await db.nextLegacyId();
      const temp = generateTempPassword(deps.randomUint32);
      const loginEmail = signInEmail(employeeId, config.signInDomain);
      if (!loginEmail) return res(500, { error: 'Sign-in domain is not configured.' });
      let user;
      try { user = await auth.createUser({ email: loginEmail, password: temp, email_confirm: true }); }
      catch (e) { log('admin.create.auth_failed', {}); return res(500, { error: 'The account could not be created.' }); }
      try {
        await db.insertProfile({ user_id: user.id, legacy_id: legacyId, employee_id: employeeId, username: b.username || null,
          full_name: b.fullName.trim(), recovery_email: email, role: b.role,
          department: b.role === 'Department User' ? b.department : null,
          assigned_categories: b.role === 'Department User' ? b.assignedCategories.map(c => String(c).toUpperCase()) : null,
          section: b.role === 'Job Card Editor' ? b.section : null, active: b.active !== false, must_change_password: true });
      } catch (e) {
        await auth.deleteUser(user.id).catch(() => log('admin.create.compensate_failed', {}));   // no orphan auth account
        return res(500, { error: 'The account could not be created.' });
      }
      if (b.active === false) await auth.updateUser(user.id, { ban_duration: '876000h' });
      if (email) await sendVerification(user.id, email).catch(() => log('admin.create.verify_mail_failed', {}));
      await audit(me.user_id, 'account.create', user.id, { role: b.role, legacyId });
      // The temporary password is returned ONCE, to the Admin, over TLS, never logged or stored (O6: or send a set-password link).
      return res(200, { userId: user.id, legacyId, temporaryPassword: temp });
    }

    const target = b.userId ? await db.profileByUser(b.userId) : null;
    if (!target) return res(404, { error: 'Account not found.' });
    if (target.user_id === me.user_id) return res(403, { error: 'You cannot change your own account here. Use Change Password.' });

    if (action === 'reset_password') {
      const temp = generateTempPassword(deps.randomUint32);
      try { await auth.updateUser(target.user_id, { password: temp }); }
      catch (e) { return res(500, { error: 'The password was not reset.' }); }
      await db.updateProfile(target.user_id, { must_change_password: true });
      await auth.signOutAll(target.user_id);
      await audit(me.user_id, 'account.reset_password', target.user_id);
      return res(200, { temporaryPassword: temp });
    }

    if (action === 'set_active') {
      const active = b.active === true;
      if (active && target.role === 'Department User' && config.departmentUsersEnabled !== true) return res(409, { error: DU_OFF });
      if (!active && target.role === 'Admin' && target.active && (await db.activeAdminCount()) <= 1) return res(409, { error: 'The last active Admin cannot be deactivated.' });
      await db.updateProfile(target.user_id, { active });
      await auth.updateUser(target.user_id, { ban_duration: active ? 'none' : '876000h' });
      if (!active) await auth.signOutAll(target.user_id);
      await audit(me.user_id, active ? 'account.activate' : 'account.deactivate', target.user_id);
      return res(200, { ok: true });
    }

    // update: role / scope / name / recovery email (never employee_id, legacy_id, active, must_change_password)
    const merged = {
      role: b.role !== undefined ? b.role : target.role, fullName: b.fullName !== undefined ? b.fullName : target.full_name,
      department: b.department !== undefined ? b.department : target.department,
      assignedCategories: b.assignedCategories !== undefined ? b.assignedCategories : target.assigned_categories,
      section: b.section !== undefined ? b.section : target.section,
    };
    if (merged.role !== 'Department User') { merged.department = null; merged.assignedCategories = null; }
    if (merged.role !== 'Job Card Editor') merged.section = null;
    const fieldErr = validateAccountFields(merged, await db.knownCategories());
    if (fieldErr) return res(400, { error: fieldErr });
    if (target.role === 'Admin' && merged.role !== 'Admin' && target.active && (await db.activeAdminCount()) <= 1) return res(409, { error: 'The last active Admin cannot be demoted.' });
    if (merged.role === 'Department User' && target.role !== 'Department User' && target.active && config.departmentUsersEnabled !== true) return res(409, { error: DU_OFF });
    const patch = { role: merged.role, full_name: merged.fullName.trim(), department: merged.department,
                    assigned_categories: merged.assignedCategories ? merged.assignedCategories.map(c => String(c).toUpperCase()) : null, section: merged.section };
    let newEmail = null;
    if (b.recoveryEmail !== undefined) {
      const e = normalizeEmail(b.recoveryEmail);
      if (!e || !isUsableRecoveryEmail(e, config.signInDomain)) return res(400, { error: 'Enter a real, deliverable recovery email address.' });
      const other = await db.profileByRecoveryEmail(e);
      if (other && other.user_id !== target.user_id) return res(409, { error: 'This recovery email is already used.' });
      if (e !== target.recovery_email) { patch.recovery_email = e; patch.recovery_email_verified_at = null; newEmail = e; }
    }
    await db.updateProfile(target.user_id, patch);
    if (newEmail) await sendVerification(target.user_id, newEmail).catch(() => log('admin.update.verify_mail_failed', {}));
    await audit(me.user_id, 'account.update', target.user_id, { fields: Object.keys(patch) });
    return res(200, { ok: true });
  }

  // ---------------- complete-password-change (forced first sign-in, and self-service) ----------------
  async function completePasswordChange(req) {
    if (!req.caller) return res(401, { error: NOT_ALLOWED });
    const me = await db.profileByUser(req.caller);
    if (!me || !me.active) return deny();                                    // a deactivated account cannot change anything
    if (await limited('pwchange', me.user_id, LIMITS.pwchange)) return tooMany();
    const b = req.body || {};
    const err = validateNewPassword(b.newPassword, b.currentPassword);
    if (err) return res(400, { error: err });
    const loginEmail = signInEmail(me.employee_id, config.signInDomain);
    if (!(await auth.verifyPassword(loginEmail, b.currentPassword))) return res(400, { error: 'The current password is incorrect.' });
    try { await auth.updateUser(me.user_id, { password: b.newPassword }); }
    catch (e) { return res(500, { error: 'Your password was not changed. Please try again.' }); }   // flag stays set
    try { if (me.must_change_password) await db.updateProfile(me.user_id, { must_change_password: false }); }   // cleared ONLY after success
    catch (e) { return res(500, { error: 'Your password was changed, but the account is still locked. Sign in with the new password and try again.' }); }
    await audit(me.user_id, me.must_change_password ? 'password.forced_change' : 'password.change', me.user_id);
    return res(200, { ok: true });
  }

  // ---------------- complete-recovery (signed in through a recovery link) ----------------
  // req.recovery is set by the wrapper ONLY when the caller's VERIFIED token was issued by a recovery link (token method
  // "recovery"; deno.ts, staging check R-AMR). Sets the new password without the old one, clears a pending forced change
  // (the user has just chosen their own password) and ends every other session of the account.
  async function completeRecovery(req) {
    if (!req.caller || req.recovery !== true) return res(401, { error: NOT_ALLOWED });
    const me = await db.profileByUser(req.caller);
    if (!me || !me.active) return deny();
    if (await limited('pwchange', me.user_id, LIMITS.pwchange)) return tooMany();
    const pw = (req.body || {}).newPassword;
    const err = validatePassword(pw);
    if (err) return res(400, { error: err });
    if (/^[0-9a-f]{64}$/i.test(pw)) return res(400, { error: 'Choose a different password.' });
    try { await auth.updateUser(me.user_id, { password: pw }); }
    catch (e) { return res(500, { error: 'Your password was not changed. Please try again.' }); }
    try { if (me.must_change_password) await db.updateProfile(me.user_id, { must_change_password: false }); }
    catch (e) { return res(500, { error: 'Your password was changed, but the account is still locked. Sign in with the new password and try again.' }); }
    await auth.signOutAll(me.user_id).catch(() => log('recovery.signout_failed', {}));
    await audit(me.user_id, 'password.recovered', me.user_id);
    return res(200, { ok: true });
  }

  // ---------------- request-recovery (unauthenticated; non-enumerating) ----------------
  async function requestRecovery(req) {
    const started = deps.now().getTime();
    const ack = async () => { const wait = (config.recoveryMinMs || 600) - (deps.now().getTime() - started); if (wait > 0) await deps.sleep(wait); return res(202, { message: RECOVERY_ACK }); };
    try {
      if (await limited('recovery:ip', req.ip || 'unknown', LIMITS.recoveryIp)) return await ack();
      const eid = normalizeEmployeeId((req.body || {}).employeeId);
      if (!eid) return await ack();
      if (await limited('recovery:id', eid, LIMITS.recoveryId)) return await ack();
      const p = await db.profileByEmployeeId(eid);
      // Only an ACTIVE account with a VERIFIED, real recovery address gets an email. The internal sign-in address is
      // used to create the Auth recovery link, never as a destination.
      if (p && p.active && p.recovery_email && p.recovery_email_verified_at && isUsableRecoveryEmail(p.recovery_email, config.signInDomain)) {
        const link = await auth.generateRecoveryLink(signInEmail(p.employee_id, config.signInDomain));
        await mail.send({ to: p.recovery_email, subject: 'CMMS password recovery',
          text: `A password reset was requested for your CMMS account. Use this link (it expires soon and works once): ${link}\nIf you did not ask for this, ignore this email.` });
        await audit(null, 'recovery.sent', p.user_id);
      }
    } catch (e) { log('recovery.error', {}); }
    return await ack();   // same status, body and minimum duration in every case
  }

  // ---------------- verify-recovery-email (unauthenticated; link from the verification email) ----------------
  async function verifyRecoveryEmail(req) {
    try {
      if (await limited('verify:ip', req.ip || 'unknown', LIMITS.verifyIp)) return res(200, { message: VERIFY_ACK });
      const token = String((req.body || {}).token || '');
      if (token.length < 32) return res(200, { message: VERIFY_ACK });
      const row = await db.takeVerification(await deps.hash('verify:' + token), deps.now());   // single use, unexpired
      if (row) {
        const p = await db.profileByUser(row.user_id);
        if (p && p.recovery_email === row.email) {
          await db.updateProfile(p.user_id, { recovery_email_verified_at: deps.now().toISOString() });
          await audit(null, 'recovery_email.verified', p.user_id);
        }
      }
    } catch (e) { log('verify.error', {}); }
    return res(200, { message: VERIFY_ACK });
  }

  return { adminUsers, completePasswordChange, completeRecovery, requestRecovery, verifyRecoveryEmail };
}
export { ROLES, validatePassword };
