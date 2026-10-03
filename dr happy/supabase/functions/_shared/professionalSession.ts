import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const SESSION_HEADER = 'x-drhappy-session'
const SESSION_DURATION_MS = 1000 * 60 * 60 * 12

type AuthUserIdentity = {
  provider?: string
  identity_data?: Record<string, unknown> | null
}

type AuthUserEmailProof = {
  email?: string | null
  email_confirmed_at?: string | null
  identities?: AuthUserIdentity[] | null
}

export function hasVerifiedGoogleEmail(user: AuthUserEmailProof): boolean {
  const email = user.email?.trim().toLowerCase()
  if (!email) return false
  return Boolean(user.identities?.some((identity) => {
    const identityEmail = identity.identity_data?.email
    return identity.provider === 'google'
      && typeof identityEmail === 'string'
      && identityEmail.trim().toLowerCase() === email
      && identity.identity_data?.email_verified === true
  }))
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createProfessionalSession(admin: SupabaseClient, professionalId: string): Promise<string> {
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString()
  const { error } = await admin.from('professional_sessions').insert({ professional_id: professionalId, token_hash: tokenHash, expires_at: expiresAt })
  if (error) throw new Error(`No se pudo crear la sesión profesional: ${error.message}`)
  return token
}

export async function resolveProfessionalId(request: Request, admin: SupabaseClient): Promise<string | null> {
  const sessionToken = request.headers.get(SESSION_HEADER)?.trim()
  if (sessionToken) {
    const tokenHash = await hashToken(sessionToken)
    const { data } = await admin
      .from('professional_sessions')
      .select('professional_id, professionals!inner(active)')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (data?.professional_id && (data.professionals as { active?: boolean | null } | null)?.active !== false) return data.professional_id
  }

  const authorization = request.headers.get('Authorization')
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!bearer) return null
  const { data: authData } = await admin.auth.getUser(bearer)
  const authUser = authData.user
  const email = authUser?.email?.trim().toLowerCase()
  if (!authUser || !email) return null
  const hasGoogleIdentity = authUser.identities?.some((identity) => identity.provider === 'google') ?? false
  if (hasGoogleIdentity ? !hasVerifiedGoogleEmail(authUser) : !authUser.email_confirmed_at) return null
  const verificationEnabled = Deno.env.get('ENABLE_EMAIL_VERIFICATION')?.trim().toLowerCase() === 'true'
  const columns = verificationEnabled ? 'id, active, email_verification_required, email_verified_at' : 'id, active'
  const { data: professional } = await admin.from('professionals')
    .select(columns)
    .ilike('email', email)
    .returns<Array<{ id: string; active: boolean | null; email_verification_required?: boolean; email_verified_at?: string | null }>>()
    .maybeSingle()
  if (verificationEnabled && professional?.email_verification_required === true && !professional.email_verified_at) return null
  return professional?.active === false ? null : professional?.id || null
}
