export interface MedicalToolUser {
  active?: boolean
  isAdmin?: boolean
  specialty?: string | null
  subscriptionStatus?: string | null
  subscriptionExpiresAt?: string | null
  trialStartedAt?: string | null
  enabledModules?: unknown
}

export const MEDICAL_TOOL_ACCESS_COLUMNS =
  'id, active, is_admin, specialty, subscription_status, subscription_expires_at, trial_started_at, enabled_modules_json'

export function hasMedicalToolAccess(
  user: MedicalToolUser | null | undefined,
  modules: readonly string[] = ['attention'],
  now = Date.now(),
): boolean {
  if (!user || user.active === false) return false
  if (user.isAdmin) return true
  const specialty = String(user.specialty ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (specialty.includes('odont')) return false
  if (!specialty.includes('medic')) return false
  const enabledModules = user.enabledModules
  if (enabledModules != null && (
    !Array.isArray(enabledModules) || modules.some(module => !enabledModules.includes(module))
  )) return false
  if (user.subscriptionStatus === 'active') {
    return !user.subscriptionExpiresAt || Date.parse(user.subscriptionExpiresAt) > now
  }
  if (user.subscriptionStatus && user.subscriptionStatus !== 'trial') return false
  const start = Date.parse(user.trialStartedAt ?? '')
  return Number.isFinite(start) && start <= now && now < start + 7 * 24 * 60 * 60 * 1000
}

export function hasMedicalToolRowAccess(
  row: Record<string, unknown> | null | undefined,
  modules: readonly string[] = ['attention'],
  now = Date.now(),
): boolean {
  if (!row) return false
  return hasMedicalToolAccess({
    active: row.active !== false,
    isAdmin: row.is_admin === true,
    specialty: typeof row.specialty === 'string' ? row.specialty : null,
    subscriptionStatus: typeof row.subscription_status === 'string' ? row.subscription_status : null,
    subscriptionExpiresAt: typeof row.subscription_expires_at === 'string' ? row.subscription_expires_at : null,
    trialStartedAt: typeof row.trial_started_at === 'string' ? row.trial_started_at : null,
    enabledModules: row.enabled_modules_json,
  }, modules, now)
}
