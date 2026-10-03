export const PROFESSIONAL_SESSION_KEY = 'drhappy-session-v2'
export const PROFESSIONAL_TOKEN_KEY = 'drhappy-professional-session'
export const PROFESSIONAL_USER_KEY = 'drhappy-active-user'
export const GOOGLE_LOGIN_PENDING_KEY = 'drhappy-google-login-pending'
export const GOOGLE_AUTO_LOGIN_BLOCKED_KEY = 'drhappy-google-auto-login-blocked'

export interface ProfessionalSession {
  userId: string
  token: string
}

export function readProfessionalSession(storage: Storage = localStorage): ProfessionalSession | null {
  const raw = storage.getItem(PROFESSIONAL_SESSION_KEY)
  if (raw) {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('userId' in value) || !('token' in value)
      || typeof value.userId !== 'string' || typeof value.token !== 'string' || !value.userId || !value.token) {
      throw new Error('La sesión guardada no es válida. Volvé a iniciar sesión.')
    }
    return { userId: value.userId, token: value.token }
  }
  const userId = storage.getItem(PROFESSIONAL_USER_KEY)
  const token = storage.getItem(PROFESSIONAL_TOKEN_KEY)
  return userId && token ? { userId, token } : null
}

export function storeProfessionalSession(userId: string, token: string): void {
  if (!userId || !token) throw new Error('El servidor no devolvió una sesión profesional válida.')
  localStorage.setItem(PROFESSIONAL_SESSION_KEY, JSON.stringify({ userId, token }))
  localStorage.setItem(PROFESSIONAL_USER_KEY, userId)
  localStorage.setItem(PROFESSIONAL_TOKEN_KEY, token)
  sessionStorage.setItem(PROFESSIONAL_TOKEN_KEY, token)
  localStorage.removeItem(GOOGLE_AUTO_LOGIN_BLOCKED_KEY)
}

export function restoreProfessionalSessionToken(): string | null {
  const session = readProfessionalSession()
  if (session) {
    sessionStorage.setItem(PROFESSIONAL_TOKEN_KEY, session.token)
    localStorage.setItem(PROFESSIONAL_USER_KEY, session.userId)
  } else {
    sessionStorage.removeItem(PROFESSIONAL_TOKEN_KEY)
  }
  return session?.token ?? null
}

export function clearProfessionalSession(): void {
  localStorage.removeItem(PROFESSIONAL_SESSION_KEY)
  localStorage.removeItem(PROFESSIONAL_TOKEN_KEY)
  localStorage.removeItem(PROFESSIONAL_USER_KEY)
  localStorage.removeItem('drhappy-active-user-cache')
  localStorage.removeItem(GOOGLE_LOGIN_PENDING_KEY)
  localStorage.setItem(GOOGLE_AUTO_LOGIN_BLOCKED_KEY, 'true')
  sessionStorage.removeItem(PROFESSIONAL_TOKEN_KEY)
}

export function createProfessionalFetch(send: typeof fetch, read: () => ProfessionalSession | null = readProfessionalSession): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes('/functions/v1/')) return send(input, init)
    const session = read()
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    const providedToken = headers.get('x-drhappy-session')
    if (providedToken && providedToken !== session?.token) throw new Error('La sesión cambió. Volvé a abrir la acción desde la cuenta actual.')
    if (session && !url.endsWith('/auth-professional')) {
      headers.set('x-drhappy-session', session.token)
    }
    const response = await send(input, { ...init, headers })
    const current = read()
    if (current?.userId !== session?.userId || current?.token !== session?.token) {
      throw new Error('Se descartó una respuesta de la cuenta anterior porque la sesión cambió.')
    }
    return response
  }
}
