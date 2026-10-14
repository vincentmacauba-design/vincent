// DRAFT — NOT DEPLOYED. Edge Function 'request-recovery': Unauthenticated. Same response, status and minimum duration for every Employee ID; mails only a VERIFIED recovery address.
// Logic: ../_shared/handlers.mjs (requestRecovery). Secrets: environment only (see ../_shared/deno.ts).
import { serve } from '../_shared/deno.ts';
serve('requestRecovery');
