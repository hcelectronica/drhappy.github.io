export interface SubscriptionUser {
  id: string
  isAdmin?: boolean
  subscriptionStatus?: 'trial' | 'active' | 'expired' | 'cancelled'
  subscriptionExpiresAt?: string
  trialStartedAt?: string
}

export interface TrialInfo {
  status: 'admin' | 'active' | 'expired' | 'legacy' | 'trial'
  daysLeft: number
  patientsLeft: number
  ownPatientCount?: number
  expired: boolean
  expiredByTime: boolean
  expiredByPatients: boolean
  expiredBySubscription: boolean
}

const DAY_IN_MS = 24 * 60 * 60 * 1000
const TRIAL_DAYS = 14
const TRIAL_PATIENTS = 15

export function calculateTrialInfo(
  user: SubscriptionUser | null,
  patients: Array<{ ownerUserId?: string }>,
  now = Date.now(),
): TrialInfo | null {
  if (!user) return null
  if (user.isAdmin) {
    return {
      status: 'admin',
      daysLeft: Infinity,
      patientsLeft: Infinity,
      expired: false,
      expiredByTime: false,
      expiredByPatients: false,
      expiredBySubscription: false,
    }
  }
  if (user.subscriptionStatus === 'active') {
    if (user.subscriptionExpiresAt) {
      const millisecondsLeft = new Date(user.subscriptionExpiresAt).getTime() - now
      const daysLeft = Math.max(0, Math.ceil(millisecondsLeft / DAY_IN_MS))
      const expired = millisecondsLeft <= 0
      return {
        status: expired ? 'expired' : 'active',
        daysLeft,
        patientsLeft: Infinity,
        expired,
        expiredByTime: false,
        expiredByPatients: false,
        expiredBySubscription: expired,
      }
    }
    return {
      status: 'active',
      daysLeft: Infinity,
      patientsLeft: Infinity,
      expired: false,
      expiredByTime: false,
      expiredByPatients: false,
      expiredBySubscription: false,
    }
  }
  if (user.subscriptionStatus === 'cancelled' || user.subscriptionStatus === 'expired') {
    return {
      status: 'expired',
      daysLeft: 0,
      patientsLeft: 0,
      expired: true,
      expiredByTime: false,
      expiredByPatients: false,
      expiredBySubscription: true,
    }
  }
  if (!user.trialStartedAt) {
    return {
      status: 'legacy',
      daysLeft: Infinity,
      patientsLeft: Infinity,
      expired: false,
      expiredByTime: false,
      expiredByPatients: false,
      expiredBySubscription: false,
    }
  }

  const daysPassed = Math.floor((now - new Date(user.trialStartedAt).getTime()) / DAY_IN_MS)
  const daysLeft = Math.max(0, TRIAL_DAYS - daysPassed)
  const ownPatientCount = patients.filter((patient) => patient.ownerUserId === user.id).length
  const patientsLeft = Math.max(0, TRIAL_PATIENTS - ownPatientCount)
  const expiredByTime = daysPassed >= TRIAL_DAYS
  const expiredByPatients = ownPatientCount >= TRIAL_PATIENTS

  return {
    status: expiredByTime || expiredByPatients ? 'expired' : 'trial',
    daysLeft,
    patientsLeft,
    ownPatientCount,
    expiredByTime,
    expiredByPatients,
    expiredBySubscription: false,
    expired: expiredByTime || expiredByPatients,
  }
}

export function hasPremiumTurneraAccess(user: SubscriptionUser | null): boolean {
  return Boolean(user?.isAdmin || user?.subscriptionStatus === 'active')
}
