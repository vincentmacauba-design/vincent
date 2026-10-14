// DRAFT — NOT DEPLOYED, NOT TYPE-CHECKED. Deno runtime wiring for the P2 Edge Functions.
// SECRETS: read ONLY from the function environment (Supabase project secrets); never in code, never in index.html.
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (provided by the platform to Edge Functions)
//   CMMS_SIGN_IN_DOMAIN   internal sign-in address domain (owner decision O5; NOT a mail domain)
//   CMMS_APP_URL          https://<production or staging host>/   (verification / recovery links)
//   CMMS_APP_ORIGIN       the only allowed CORS origin
//   CMMS_HASH_PEPPER      >= 32 random bytes, used for HMAC of rate-limit subjects and verification tokens
//   CMMS_MAIL_API_URL, CMMS_MAIL_API_TOKEN   transactional mail endpoint (provider = open decision O5)
// The service-role client exists only inside this server code.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createHandlers } from './handlers.mjs';

const env = (k: string) => { const v = Deno.env.get(k); if (!v) throw new Error('missing configuration: ' + k); return v; };

export function buildDeps() {
  const url = env('SUPABASE_URL');
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const anonKey = env('SUPABASE_ANON_KEY');
  const pepper = new TextEncoder().encode(env('CMMS_HASH_PEPPER'));
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data; };
  return {
    config: { signInDomain: env('CMMS_SIGN_IN_DOMAIN'), appUrl: env('CMMS_APP_URL'), verifyTtlMinutes: 1440, recoveryMinMs: 600,
      // optional; anything but exactly "enabled" (including missing) keeps Department User access OFF (fail closed)
      departmentUsersEnabled: Deno.env.get('CMMS_DEPARTMENT_USERS') === 'enabled' },
    now: () => new Date(),
    sleep: (ms: number) => new Promise(r => setTimeout(r, ms)),
    randomUint32: (n: number) => crypto.getRandomValues(new Uint32Array(n)),
    randomToken: () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' } as any)[c]),
    hash: async (s: string) => {
      const key = await crypto.subtle.importKey('raw', pepper, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s)));
      return Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('');
    },
    auth: {
      createUser: async (a: any) => (await one(admin.auth.admin.createUser(a))).user,
      updateUser: async (id: string, a: any) => { await one(admin.auth.admin.updateUserById(id, a)); },
      deleteUser: async (id: string) => { await one(admin.auth.admin.deleteUser(id)); },
      // Revokes the user's refresh tokens (all sessions). Exact admin API to confirm on staging (P2A_MIGRATION §6.3 R-SESS).
      signOutAll: async (id: string) => { await one(admin.rpc('revoke_user_sessions', { p_user_id: id })); },
      // The link returns to the app (CMMS_APP_URL, which must also be in Auth → URL Configuration → Redirect URLs); never
      // to whatever the project's Site URL happens to be. Exact fragment shape after the redirect: staging check R-LINK.
      generateRecoveryLink: async (email: string) => (await one(admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: env('CMMS_APP_URL') } }))).properties.action_link,
      verifyPassword: async (email: string, password: string) => {
        const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data, error } = await c.auth.signInWithPassword({ email, password });
        if (error || !data.session) return false;
        await c.auth.signOut({ scope: 'local' });   // the check must not leave a usable session behind
        return true;
      },
    },
    db: {
      profileByUser: async (uid: string) => one(admin.from('profiles').select('*').eq('user_id', uid).maybeSingle()),
      profileByEmployeeId: async (eid: string) => one(admin.from('profiles').select('*').eq('employee_id', eid).maybeSingle()),
      profileByRecoveryEmail: async (e: string) => one(admin.from('profiles').select('*').eq('recovery_email', e).maybeSingle()),
      profileByLegacyId: async (n: number) => one(admin.from('profiles').select('*').eq('legacy_id', n).maybeSingle()),
      insertProfile: async (row: any) => { await one(admin.from('profiles').insert(row)); },
      updateProfile: async (uid: string, patch: any) => { await one(admin.from('profiles').update(patch).eq('user_id', uid)); },
      nextLegacyId: async () => { const r = await one(admin.from('profiles').select('legacy_id').order('legacy_id', { ascending: false }).limit(1)); return (r[0]?.legacy_id || 0) + 1; },
      activeAdminCount: async () => { const { count, error } = await admin.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'Admin').eq('active', true); if (error) throw error; return count || 0; },
      knownCategories: async () => (await one(admin.from('app_data').select('value').eq('key', 'customPlants').maybeSingle()))?.value || [],
      rateLimitHit: async (bucket: string, subject: string, max: number, windowSeconds: number) =>
        one(admin.rpc('rate_limit_hit', { p_bucket: bucket, p_subject_hash: subject, p_max_hits: max, p_window_seconds: windowSeconds })),
      insertAudit: async (row: any) => { await one(admin.from('audit_log').insert(row)); },
      saveVerification: async (row: any) => { await one(admin.from('recovery_email_verifications').insert(row)); },
      takeVerification: async (tokenHash: string, now: Date) => one(admin.from('recovery_email_verifications')
        .update({ used_at: now.toISOString() }).eq('token_hash', tokenHash).is('used_at', null).gt('expires_at', now.toISOString()).select().maybeSingle()),
    },
    mail: {
      send: async (m: any) => {
        const r = await fetch(env('CMMS_MAIL_API_URL'), { method: 'POST', headers: { 'Authorization': 'Bearer ' + env('CMMS_MAIL_API_TOKEN'), 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
        if (!r.ok) throw new Error('mail failed');
      },
    },
    log: (event: string) => console.log(JSON.stringify({ event })),   // no personal data, tokens or passwords
  };
}

// Common HTTP wrapper: CORS for the one app origin, POST only, JWT verified by Supabase Auth (never trusted unverified).
export function serve(handlerName: 'adminUsers' | 'completePasswordChange' | 'completeRecovery' | 'requestRecovery' | 'verifyRecoveryEmail') {
  const deps = buildDeps();
  const h = createHandlers(deps) as any;
  const cors = { 'Access-Control-Allow-Origin': env('CMMS_APP_ORIGIN'), 'Access-Control-Allow-Headers': 'authorization, content-type, apikey', 'Vary': 'Origin' };
  Deno.serve(async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: cors });
    let caller: string | null = null;
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (token) {
      const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
      const { data } = await admin.auth.getUser(token);
      caller = data?.user?.id || null;
    }
    // Recovery sessions: only a token the platform VERIFIED above, whose own sign-in method is "recovery" (a recovery
    // link), may set a password without the current one (completeRecovery). Exact claim shape: staging check R-AMR.
    let recovery = false;
    if (caller) { try { const c = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); recovery = Array.isArray(c.amr) && c.amr.some((m: any) => m && m.method === 'recovery'); } catch { recovery = false; } }
    // Client IP: the first X-Forwarded-For entry as set by the platform proxy (confirm on staging which header is trustworthy).
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    let body: any = {};
    try { body = await request.json(); } catch { /* empty or invalid body -> {} */ }
    const out = await h[handlerName]({ caller, ip, body, recovery });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { ...cors, ...out.headers } });
  });
}
