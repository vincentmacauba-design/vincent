// DRAFT — NOT LOADED BY index.html. DISABLED BY DEFAULT. Browser sign-in adapter for P2a (docs/P2_AUTH_PLAN.md §2.3, §2.7).
// Wiring it into the app is a later, separately approved step (P2A_MIGRATION gate L4/P5); until then the app keeps
// its current production adapter unchanged.
//   * Employee ID sign-in WITHOUT any lookup: the Auth login address is derived from the ID (Option B). No endpoint can
//     be asked "which email belongs to this ID" or "does this ID exist".
//   * Every failed sign-in returns the same message (wrong ID format, unknown ID, wrong password, banned/inactive).
//   * Session kept in memory only (persistSession: false): a reload signs out, as today. No token in browser storage.
//   * Only the public anon key is used here. The service role key never appears in browser code.
import { SIGN_IN_FAILED, normalizeEmployeeId, signInEmail } from '../functions/_shared/policy.mjs';

export const AUTH_CLIENT_OPTIONS = Object.freeze({ persistSession: false, autoRefreshToken: true, detectSessionInUrl: false });

export function createSupabaseAuthAdapter(opts = {}) {
  if (opts.enabled !== true) {
    return Object.freeze({ name: 'supabase-auth', enabled: false,
      signIn: async () => ({ ok: false, reason: 'disabled' }), signOut: async () => {}, loadProfile: async () => null });
  }
  const { createClient, url, anonKey, signInDomain } = opts;
  if (typeof createClient !== 'function' || !url || !anonKey || !signInDomain) throw new Error('supabase-auth adapter: incomplete configuration');
  if (/service_role|sb_secret_/i.test(String(anonKey)) || roleOf(anonKey) === 'service_role') throw new Error('supabase-auth adapter: a secret key must never be used in the browser');
  const client = createClient(url, anonKey, { auth: AUTH_CLIENT_OPTIONS });

  async function loadProfile() {
    const { data: u } = await client.auth.getUser();
    const uid = u && u.user && u.user.id;
    if (!uid) return null;
    const { data, error } = await client.from('profiles').select('*').eq('user_id', uid).maybeSingle();   // RLS: own row only
    return error ? null : data;
  }

  async function signIn(employeeId, password) {
    const id = normalizeEmployeeId(employeeId);
    if (!id || typeof password !== 'string' || !password) return { ok: false, reason: 'invalid', message: SIGN_IN_FAILED };   // no request at all
    let r;
    try { r = await client.auth.signInWithPassword({ email: signInEmail(id, signInDomain), password }); }
    catch (e) { return { ok: false, reason: 'unavailable', message: 'Sign-in is unavailable. Please try again later.' }; }
    if (r.error || !r.data || !r.data.session) {
      if (r.error && (r.error.status === 0 || r.error.name === 'AuthRetryableFetchError')) return { ok: false, reason: 'unavailable', message: 'Sign-in is unavailable. Please try again later.' };
      return { ok: false, reason: 'invalid', message: SIGN_IN_FAILED };   // GoTrue's own answer is never shown
    }
    const profile = await loadProfile();
    if (!profile || !profile.active) { await client.auth.signOut(); return { ok: false, reason: 'invalid', message: SIGN_IN_FAILED }; }
    return { ok: true, mustChangePassword: profile.must_change_password === true, profile };
  }

  async function signOut() { try { await client.auth.signOut(); } catch (e) { /* local state is cleared by the app regardless */ } }

  return Object.freeze({ name: 'supabase-auth', enabled: true, signIn, signOut, loadProfile, client });
}

function roleOf(key) {
  try { const p = String(key).split('.'); return p.length === 3 ? JSON.parse(atob(p[1].replace(/-/g, '+').replace(/_/g, '/'))).role : null; } catch (e) { return null; }
}
