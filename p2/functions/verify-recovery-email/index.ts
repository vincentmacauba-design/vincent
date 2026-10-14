// DRAFT — NOT DEPLOYED. Edge Function 'verify-recovery-email': Unauthenticated. Single-use, expiring token from the verification email.
// Logic: ../_shared/handlers.mjs (verifyRecoveryEmail). Secrets: environment only (see ../_shared/deno.ts).
import { serve } from '../_shared/deno.ts';
serve('verifyRecoveryEmail');
