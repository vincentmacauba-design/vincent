// DRAFT — NOT DEPLOYED. Edge Function 'admin-users': Admin account actions (create, reset_password, set_active, update). Caller must be an active Admin.
// Logic: ../_shared/handlers.mjs (adminUsers). Secrets: environment only (see ../_shared/deno.ts).
import { serve } from '../_shared/deno.ts';
serve('adminUsers');
