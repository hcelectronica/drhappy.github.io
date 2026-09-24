import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const SESSION_HEADER = 'x-drhappy-session'
const SESSION_DURATION_MS = 1000 * 60 * 60 * 12

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createProfessionalSession(admin: SupabaseClient, professionalId: string): Promise<string> {
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString()
  await admin.from('professional_sessions').insert({ professional_id: professionalId, token_hash: tokenHash, expires_at: expiresAt })
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
  const email = authData.user?.email?.trim().toLowerCase()
  if (!email) return null
  const { data: professional } = await admin.from('professionals').select('id, active').ilike('email', email).maybeSingle()
  return professional?.active === false ? null : professional?.id || null
}
