# P2 backend (Supabase Auth, server-enforced permissions, notifications) — NOT EXECUTED ON ANY SUPABASE PROJECT

This folder holds the server side of the full CMMS design: the SQL migrations, the Edge Function logic and the account-provisioning tool. `index.html` on this branch is **integrated** with it (Employee ID sign-in through Supabase Auth, forced first-login change, recovery by email, server notifications, account administration through `admin-users`).

**Status (2026-10-15):**

- **Local only.** Nothing here has been applied to a Supabase project, deployed as an Edge Function, or connected to production. There is no staging project yet.
- **Tested locally on real PostgreSQL.** The SQL runs on PGlite (PostgreSQL 18 in WebAssembly) with a small Supabase emulation (`tests/p2/supabase-emulation.sql`: `auth.uid()`, `auth.jwt()`, roles `anon` / `authenticated` / `service_role`). These are **local results**. They do not prove Supabase behaviour (GoTrue, PostgREST, Realtime, JWT claims, rate limits). The staging checks in [DEPLOYMENT.md §8](DEPLOYMENT.md) still apply.
- **Not served:** the allowlist `.vercelignore` publishes only `index.html` and `vercel.json`.
- **Department User accounts stay disabled in production** until the server-side scoping (`jo_list` / `asset_list`, `private.can_read_key`) has been deployed and verified ([DEPLOYMENT.md](DEPLOYMENT.md) step P9). This is enforced in code: the provisioning tool creates them inactive by default, and `admin-users` refuses an active Department User unless the function secret `CMMS_DEPARTMENT_USERS=enabled` is set.
- **Production sign-in fails closed:** `PRODUCTION_SIGN_IN_DOMAIN = null` in `index.html` until decision D4 (the sign-in domain) is made.

**Runbook:** [DEPLOYMENT.md](DEPLOYMENT.md) covers deployment order, prerequisites and owner decisions, Supabase settings, account migration, rollback, the staging checks and fail-closed behaviour.

Comments in the SQL and code that cite `docs/P2_AUTH_PLAN.md` or `docs/P2A_MIGRATION.md` refer to internal planning documents, which are not published.

## Apply order

`tests/p2/apply-order.mjs` is the single source of the order:

0001, 0002, 0004, 0005, 0006, 0007, 0008, then **0003** (`app_data` lockdown) and **0009** (the P2b switch: no direct whole-list writes to `jobOrders` or `employees`).

Rollback runs the `rollback/*.down.sql` files in reverse order. `0003` records the previous `app_data` state (RLS flags, table and column grants, policies) in `private.pre_lockdown`, and its rollback restores exactly that state.

## Contents

| Path | What |
|---|---|
| `sql/0001_profiles.sql` | `public.profiles` linked to `auth.users`; Employee ID; `legacy_id` (keeps the numeric user ids that job orders reference); role, scope, status and forced-change fields controlled by the server; guard and last-Admin triggers |
| `sql/0002_access_helpers.sql` | `private` schema: `current_profile()`, `is_active()`, `has_role()`, `is_admin()`, `can_read_key()`, `can_write_key()` |
| `sql/0003_app_data_rls_p2a.sql` | `app_data` lockdown: records the old state, then deny `anon`; per-key SELECT/UPDATE by role (column grants); no INSERT/DELETE; the `users` key is readable by nobody; `environment_marker()` is the only anonymous function |
| `sql/0004_audit_rate_limit_recovery.sql` | `audit_log` (append-only), `auth_rate_limits` and `rate_limit_hit()`, `recovery_email_verifications` |
| `sql/0005_p2b_job_order_functions.sql` | `jo_list`, `asset_list` (scoped for Department Users), `jo_create`, `jo_update_request`, `jo_update_work`, `jo_set_status`, `jo_approve`, `jo_close` |
| `sql/0006_completion.sql` | `user_list()` (Admin: full list; others: self and active Job Card Editors, display fields only), `profile_update_self()`, `admin_reset_data()`, `notification_purge()`, `jo_update()` (one combined edit with per-role field rules) |
| `sql/0007_p2b_more_functions.sql` | `jo_revert`, `jo_delete`, `jo_import`, `category_rename`, `asset_clear_all`; employee status functions separate from employee administration; empty-dataset guard trigger |
| `sql/0008_notifications.sql` | Job-order events and recipients computed by the database; `my_notifications`, `notification_mark_read` (own rows only); de-duplication per status transition |
| `sql/0009_p2b_switch.sql` | Applied last: job orders and employees change only through the functions above |
| `sql/rollback/*.down.sql` | Rollback for each file |
| `functions/_shared/policy.mjs` | Password policy (8–72 bytes, four character classes), Employee ID rules, the internal sign-in address, temporary-password generator |
| `functions/_shared/handlers.mjs` | Edge Function logic with injected dependencies: `adminUsers` (create, reset_password, set_active, update; never delete), `completePasswordChange`, `requestRecovery` (non-enumerating), `verifyRecoveryEmail`, `completeRecovery` (requires a recovery session) |
| `functions/*/index.ts` | Thin Deno wrappers: JWT verification, the recovery claim (`amr`), environment secrets |
| `migration/map-accounts.mjs` | Builds the account-migration plan from an owner-provided export and mapping. No passwords; job orders are not rewritten |
| `migration/provision.mjs` | Creates the Auth users and profiles from that plan with temporary passwords and the forced change. Inactive accounts are blocked in Auth; Department Users are inactive unless explicitly enabled. Compensates on failure. Its output may only be written outside the repository (`safeOutputPath`) |
| `DEPLOYMENT.md` | The deployment runbook: order, settings, migration, rollback, staging checks |
| `functions/secrets.example.env`, `../staging/staging-config.example.js` | Configuration templates (names and placeholders only; placeholders fail closed) |
| `client/supabase-auth-adapter.mjs` | Earlier stand-alone adapter, kept for the mocked tests. `index.html` now contains its own integration |
| `model/access-model.mjs`, `model/notifications.mjs` | Reference models of the rules, used by the mocked and static tests |

## Tests

```
node tests/p2/static.test.mjs        # reads the SQL and function sources; checks they match index.html
node tests/p2/mocked.test.mjs        # handler logic with fake Auth, database and mail
node tests/p2/db.test.mjs            # the real SQL on PGlite: apply, roles, scopes, JO lifecycle, notifications, audit, full rollback
node tests/p2/handlers-db.test.mjs   # the real handlers against the PGlite database: provisioning, forced change, admin, recovery
node tests/e2e/run.js                # the browser app against the same local backend (tests/e2e/backend-mock.js)
```

The PGlite suites need `CMMS_PGLITE_DIR` (a folder with `@electric-sql/pglite` installed). Without it they print `SKIPPED` and exit with code 2. `tests/run-all.js` reports them as `SKIP`, never as passed.

**None of this proves real Supabase behaviour.** Before production: staging project, verified backup and restore, the G2-A checks, the staging run of these suites, and the R-* checks (including R-AMR for the recovery claim, R-OWNER for the table owner's `bypassrls`, R-RT for Realtime authorization). See [DEPLOYMENT.md §8](DEPLOYMENT.md).
