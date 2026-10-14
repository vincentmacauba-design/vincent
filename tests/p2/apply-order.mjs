// The order in which the P2 SQL files are applied (rollback: the reverse). Everything additive first; then the switch
// (0003: app_data lockdown) and the P2b switch (0009: no direct job-order / employee writes), together with the new client.
export const APPLY = ['0001_profiles.sql', '0002_access_helpers.sql', '0004_audit_rate_limit_recovery.sql', '0005_p2b_job_order_functions.sql',
  '0006_completion.sql', '0007_p2b_more_functions.sql', '0008_notifications.sql', '0003_app_data_rls_p2a.sql', '0009_p2b_switch.sql'];
