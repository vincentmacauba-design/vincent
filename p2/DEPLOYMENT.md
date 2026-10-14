# CMMS full implementation — deployment runbook

**Status (2026-10-15): nothing in this runbook has been executed.** No SQL has been applied to any Supabase project. No Edge Function is deployed, and no account has been created or migrated. The production app (`vincent-mauve.vercel.app`, branch `main`) is unchanged.

Everything below was tested **locally only**:

- **The SQL:** PostgreSQL 18 in WebAssembly (PGlite), with a small Supabase emulation.
- **The Edge Function logic:** run against that database.
- **The browser app:** run against both.

Some checks need a real Supabase project. They are labelled **[STAGING]** and listed in §8. None of them has been run, because no staging project exists yet.

Every production step needs the owner's explicit approval **for that step**. A failed check stops the sequence.

---

## 1. Components

| Part | Where | What it does |
|---|---|---|
| Browser app | `index.html` | Employee ID sign-in through Supabase Auth, forced first-login password change, recovery by email, notifications, the six roles. Reads data only after sign-in; changes job orders, employees and categories only through server functions |
| Database | `p2/sql/0001`–`0009` | Profiles linked to Supabase Auth, access helpers, `app_data` lock-down, audit log, rate limits, server functions for every checked change, notifications |
| Rollback | `p2/sql/rollback/*.down.sql` | One per migration, applied in reverse order |
| Edge Functions | `p2/functions/*` | `admin-users`, `complete-password-change`, `complete-recovery`, `request-recovery`, `verify-recovery-email` |
| Account migration | `p2/migration/map-accounts.mjs`, `provision.mjs` | Builds the account plan from owner-provided data, then creates the Auth users and profiles |
| Templates | `staging/staging-config.example.js`, `p2/functions/secrets.example.env` | Configuration names only; no values |

**Apply order** (single source: `tests/p2/apply-order.mjs`): `0001, 0002, 0004, 0005, 0006, 0007, 0008, 0003, 0009`. Rollback runs in the exact reverse order.

---

## 2. Decisions and inputs the owner must provide (blockers)

None of these may be invented. Each one blocks the step named.

| ID | Needed | Blocks |
|---|---|---|
| D1 | The **Employee ID** (exactly 5 letters or digits) for every existing account | Account plan (P4) |
| D2 | A real, deliverable, unique **recovery email** per account (optional per person; without one, that person has no self-service recovery), and who confirms it | Recovery for that person |
| D4 | The **internal sign-in domain**: company-controlled and receiving no mail. Also the **transactional mail provider** and sender domain for recovery and confirmation emails | Secrets (P3), client change (P6) |
| D5 | How temporary passwords reach staff: shown once to the Admin (implemented) or a set-password link (not implemented) | Provisioning (P5) |
| N-D4 | **Notification retention.** Proposed: **90 days**. No automatic purge runs until a period is approved; see §7 | Scheduled purge only |
| D9 | A **staging** Supabase project (a separate Free project is enough) | Every staging step |
| — | A verified **backup and restore** of production, on the day of every production step | Every production step |

---

## 3. Supabase project settings (staging first, then production)

**Authentication**

- *Providers → Email*: enabled. **Allow new users to sign up: OFF.** Accounts are created only by `admin-users` or the provisioning tool, already confirmed.
- *URL Configuration*: Site URL = the app URL. Add `CMMS_APP_URL` to **Redirect URLs**: recovery links return there.
- *Password*: minimum length 8. The server functions also enforce the full policy: 8–72 bytes, upper and lower case, a digit, and a symbol.
- *JWT expiry* and *rate limits*: choose them (D6); check what the Free plan allows **[STAGING]**.
- Supabase's own emails are not used for recovery. The functions send their own mail through the provider (D4).

**API**

- *Exposed schemas*: `public` only. The `private` schema must **never** be exposed.

**Realtime**

- `app_data` must be in the `supabase_realtime` publication, as today. Events must respect the SELECT policy **[STAGING R-RT]**.

**Edge Functions**

- Set the secrets from `p2/functions/secrets.example.env` (copy kept outside the repository).
- A missing required secret stops the function: it fails closed.
- `CMMS_DEPARTMENT_USERS` stays **unset** until P9.
- Deploy the five functions. The wrapper verifies every bearer token itself with `auth.getUser`.
- `request-recovery` and `verify-recovery-email` are called before sign-in, so the gateway must accept the anon/publishable key for them (`--no-verify-jwt` if the gateway rejects it). Which gateway setting works with the key type in use: **[STAGING R-EF]**.

---

## 4. Staging rehearsal (no production access)

1. **Create** the staging project, then run `staging/staging_setup.sql`. It uses synthetic data, creates no accounts, and aborts if `app_data` already exists.
2. **Apply the migrations** in the apply order. Then roll everything back and apply again **[R-SQL]**.
3. **Configure the project:** settings and secrets (§3), then deploy the functions.
4. **Create synthetic accounts:**
   - write a synthetic account plan (`map-accounts.mjs`) with one account per role;
   - provision it with `provisionAccounts(plan, deps, { activateDepartmentUsers: true })`, which is allowed on staging only;
   - store the output only through `safeOutputPath()`, outside the repository.
5. **Run the app locally against staging:** copy `staging/staging-config.example.js` to `staging-config.js` and fill in the staging values.
6. **Run every check in §8.** Any failure stops the process.

---

## 5. Production order

| Step | What | Effect on the running (old) app |
|---|---|---|
| **P0** | Verified backup **and restore test**. Repeat on the day of every later step | none |
| **P1** | Read-only assessment of production: current RLS, policies and grants on `app_data`, the Realtime publication, Auth settings. Written queries only; owner-run | none |
| **P2** | Apply `0001, 0002, 0004, 0005, 0006`. These are new tables, functions and policies only; `app_data` is untouched | none |
| **P3** | Auth settings (§3), function secrets (without `CMMS_DEPARTMENT_USERS`), deploy the functions | none |
| **P4** | Account plan: `node p2/migration/map-accounts.mjs users.json jobOrders.json mapping.json <signInDomain>`. Inputs come from **that day's verified backup** plus the owner's mapping (D1, D2), kept outside the repository. It must report **zero errors**; it prints counts and messages only | none |
| **P5** | Provision the accounts (`provisionAccounts(plan, deps)`). Each gets a temporary password and a forced change. **Department User accounts are created inactive and blocked** (default). Deliver the temporary passwords (D5) | none; the old login still works |
| **P6** | Client configuration commit: set `PRODUCTION_SIGN_IN_DOMAIN` in `index.html` to the D4 domain. Until then, production sign-in is **off** (fails closed) | none |
| **P7** | **Maintenance window** (nobody edits data):<br>1. backup;<br>2. apply `0007` and `0008`;<br>3. merge to `main` (Vercel production deploy of the new client);<br>4. Admin sign-in smoke test;<br>5. apply `0003` (lock-down), then `0009`;<br>6. production read-only checks: anonymous REST and RPC refused, no `users` key readable | The old login is replaced. Everyone signs in with Employee ID and their temporary password |
| **P8** | Every Admin, AE and SE signs in and changes their password. Reconcile active-account counts with the plan | — |
| **P9** | **Department Users.** Only after the Department User checks (R-ROLE, R-P2B, R-NOTIFY) have passed on staging **and** the production read-only checks after P7: set `CMMS_DEPARTMENT_USERS=enabled`, then an Admin activates each Department User | — |
| **P10** | Later, separately approved: retire the old `users` key in `app_data`. It still holds the old password hashes; empty it, then delete it, after that day's backup | — |

**Why 0007 waits for P7:** its empty-dataset guard refuses a direct write of `[]`. The old client uses such writes for "Clear All Assets" and Reset Data.

**Why 0003 comes after the new client:** it closes `app_data` to anonymous users and the `users` key to everyone. The old client reads `users` before sign-in, so it stops working at that moment.

---

## 6. Rollback

| From | How |
|---|---|
| Before P7 | Ban and delete the provisioned Auth users. Then `0006.down`, `0005.down`, `0004.down`, `0002.down`, `0001.down`. Remove the functions and secrets. The old app was never affected |
| During or after P7 | 1. Redeploy the previous production client: revert the merge on `main`, or Vercel Instant Rollback to the previous production deployment.<br>2. Then `0009.down`, `0003.down` (restores the exact earlier policies and grants recorded in `private.pre_lockdown`), `0008.down`, `0007.down`.<br>3. The `users` key was never changed, so the old login works again.<br>Whether the old client handles job orders written by the new functions: **[STAGING R-ROLLBACK]** |
| Department Users (P9) | Unset `CMMS_DEPARTMENT_USERS`, then deactivate the Department User accounts (`admin-users` `set_active` false) |

Accounts are never deleted in normal operation. Job orders reference them by `legacy_id`.

---

## 7. Notification retention (N-D4)

- `notification_purge(p_days)` exists. Admin or service role only; it refuses fewer than **30** days and writes an audit entry.
- **Nothing calls it automatically.** No cron job or schedule exists, and a static test enforces that.
- **Proposal: 90 days.** Once approved, schedule `select public.notification_purge(90);` with a reviewed migration, or run it manually.

---

## 8. Checks that need a real Supabase project [STAGING] (not run)

| ID | Check |
|---|---|
| R-SQL | Every migration applies on a fresh project; every rollback restores the previous state (catalog diff) |
| R-ANON | With the anon key only: every table and every RPC refused, except `environment_marker()` |
| R-RT | Realtime: anon gets no `app_data` events; each role only readable keys; a Department User none for job orders or assets |
| R-ROLE | One synthetic account per role reads, writes and calls exactly what the local suites assert |
| R-SELF, R-ADMIN | Nobody changes their own profile; the last active Admin cannot be demoted, deactivated or deleted |
| R-INACTIVE, R-FORCED | Banned accounts cannot sign in or refresh; a forced-change account sees nothing until the change |
| R-SESS | `revoke_user_sessions` ends refresh for that user on the deployed Auth version (it touches `auth.sessions`) |
| R-AMR | A recovery link's session token carries `amr` method `recovery` (`complete-recovery` relies on it) |
| R-LINK | The recovery redirect arrives as `#access_token=…&refresh_token=…&type=recovery` (implicit flow), as the app parses it |
| R-OWNER | The owner of the tables used by the SECURITY DEFINER functions behaves as the local tests assume (RLS not forced on the owner) |
| R-GOTRUE | Sign-ups off; admin-created confirmed users with the internal domain sign in; identical errors for unknown IDs and wrong passwords; rate limits |
| R-RECOVERY | Mail only to verified addresses through the real provider; links single-use and expiring |
| R-EF | Gateway JWT setting per function, CORS for the single origin, the client-IP header used for rate limits |
| R-MIG | Provisioning rehearsal on a synthetic copy: legacy ids kept, job-order checksum unchanged |
| R-P2B, R-GUARD, R-NOTIFY | Concurrency of the job-order functions, the empty-dataset guard, notification recipients, de-duplication and read state |
| R-ROLLBACK | Rolling back after use: the previous client still reads and saves job orders written by the new functions |

---

## 9. Fail-closed behaviour (incomplete configuration)

| Missing or incomplete | Result |
|---|---|
| `PRODUCTION_SIGN_IN_DOMAIN` (null today) | Production sign-in shows "not configured"; password recovery off; nothing sent |
| `staging-config.js` missing or invalid on localhost | The app does not start ("blocked"); never falls back to production |
| Any non-production host (e.g. Vercel previews) | Blocked: no Supabase request is made |
| A required Edge Function secret | The function stops with "missing configuration"; the app shows an error |
| `CMMS_DEPARTMENT_USERS` not exactly `enabled` | No active Department User can be created or activated |
| No profile, inactive profile, or a pending forced change | No data and no operations (database policies); the app signs the user out or shows the change screen |
| Retention not approved | No automatic purge |

---

## 10. Git and Vercel

- **Branch:** this work lives on `recovery/full-implementation`, based on `release/light-mode-roles` (`883b85b`).
- **Previews:** Vercel deploys **Production only from `main`**, according to the repository's deployment history. Other branches get **Preview** deployments, which the app blocks (§9).
- **Deployed files:** `.vercelignore` deploys only `index.html` and `vercel.json`.
- **Merging to `main` is step P7.** Do not merge before P0–P6 are complete.
