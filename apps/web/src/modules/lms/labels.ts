import { m } from '@/paraglide/messages'

/**
 * Short words for a connection's last error, like the AI providers' (M09 §7.1): the settings'
 * badges and the sync panel's reasons. A file of its own, so the sync panel (loaded whenever the
 * Program is bound) does not bring the settings' code with it.
 */
export const CONNECTION_ERROR_LABEL: Record<string, () => string> = {
  'lms.invalid_credentials': () => m.lms_status_invalid_credentials(),
  'lms.credentials_missing': () => m.lms_status_credentials_missing(),
  'lms.forbidden': () => m.lms_status_forbidden(),
  'lms.unreachable': () => m.lms_status_unreachable(),
  'lms.rate_limited': () => m.lms_status_rate_limited(),
  'lms.invalid_config': () => m.lms_status_address(),
  'lms.blocked_address': () => m.lms_status_address(),
}
