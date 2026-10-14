// TEMPLATE. Copy to ./staging-config.js (repo root, next to index.html). That file is untracked (.gitignore).
// Loaded only on localhost / 127.0.0.1 / [::1] / file://, never on production or previews.
// Use the STAGING project only:
//   url          = https://<staging-project-ref>.supabase.co
//   anonKey      = the staging project's legacy JWT "anon" key, or its publishable key (sb_publishable_...).
//   signInDomain = the STAGING project's internal sign-in address domain (its Edge Function secret
//                  CMMS_SIGN_IN_DOMAIN). It receives no mail; never a real mailbox domain.
// NEVER the production project. NEVER a service_role or secret key.
// These placeholders deliberately fail validation, so the app stays blocked (and sign-in stays off) until replaced.
window.CMMS_STAGING_CONFIG = {
  url: 'https://YOUR_STAGING_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_STAGING_ANON_KEY',
  signInDomain: 'YOUR_STAGING_SIGN_IN_DOMAIN'
};
