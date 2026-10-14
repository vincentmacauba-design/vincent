// DRAFT — NOT DEPLOYED. Edge Function 'complete-recovery': new password for a session that came from a recovery link
// (no current password; clears a pending forced change). Logic: ../_shared/handlers.mjs (completeRecovery).
import { serve } from '../_shared/deno.ts';
serve('completeRecovery');
