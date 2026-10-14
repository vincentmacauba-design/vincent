// DRAFT — NOT DEPLOYED. Edge Function 'complete-password-change': Forced first-login change and self-service change. Clears must_change_password only after Auth accepted the new password.
// Logic: ../_shared/handlers.mjs (completePasswordChange). Secrets: environment only (see ../_shared/deno.ts).
import { serve } from '../_shared/deno.ts';
serve('completePasswordChange');
