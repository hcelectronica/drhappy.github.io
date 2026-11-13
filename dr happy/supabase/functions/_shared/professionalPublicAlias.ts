import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export async function ensurePublicAlias(admin: SupabaseClient, professionalId: string): Promise<string> {
  const { data, error } = await admin.rpc('ensure_professional_public_alias', { p_professional_id: professionalId })
  if (error) throw error
  if (typeof data !== 'string' || !data) throw new Error('No se pudo preparar el alias público.')
  return data
}

export async function findPublicAliasOwner(admin: SupabaseClient, alias: string): Promise<string | null> {
  const { data, error } = await admin.from('professional_public_aliases')
    .select('professional_id').eq('alias', alias).maybeSingle()
  if (error) throw error
  return data?.professional_id ?? null
}

export async function resolvePublicToolSettings(
  admin: SupabaseClient, table: string, columns: string, identifier: string, field = 'slug',
) {
  const exact = await admin.from(table).select(columns).eq(field, identifier).maybeSingle()
  if (exact.error) throw exact.error
  const aliasOwner = await findPublicAliasOwner(admin, identifier)
  // Fail closed if an imported/legacy record conflicts with a reserved alias.
  if (exact.data && aliasOwner && exact.data.professional_id !== aliasOwner) return null
  let settings = exact.data
  if (!settings && aliasOwner) {
    const result = await admin.from(table).select(columns).eq('professional_id', aliasOwner).maybeSingle()
    if (result.error) throw result.error
    settings = result.data
  }
  if (!settings) return null
  const { data: professional, error } = await admin.from('professionals')
    .select('active').eq('id', settings.professional_id).maybeSingle()
  if (error) throw error
  return professional && professional.active !== false ? settings : null
}

export { publicDocumentPaths } from './publicLinkPaths.ts'
