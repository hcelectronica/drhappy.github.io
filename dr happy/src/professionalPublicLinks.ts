import { publicDocumentPaths } from '../supabase/functions/_shared/publicLinkPaths'
import type { DocumentServiceType } from '../supabase/functions/_shared/clinicalDocumentServices'

export const PUBLIC_PROFESSIONAL_SITE = 'https://www.drhappy.com.ar'

export function buildProfessionalPublicUrl(tool: 'r' | 'registro' | 'consulta' | 'turnera' | 'documentos', alias: string, detail?: string): string {
  return `${PUBLIC_PROFESSIONAL_SITE}/${tool}/${encodeURIComponent(alias)}${detail ? `/${encodeURIComponent(detail)}` : ''}`
}

export function buildProfessionalDocumentUrl(alias: string, serviceType?: DocumentServiceType): string {
  const path = serviceType ? publicDocumentPaths[serviceType] : undefined
  return `${buildProfessionalPublicUrl('documentos', alias, path)}${serviceType && !path ? `?type=${serviceType}` : ''}`
}

export function parsePublicDocumentPath(pathname: string): { slug: string; serviceType?: DocumentServiceType } | null {
  const match = pathname.match(/^\/documentos\/([^/]+)(?:\/([^/]+))?\/?$/i)
  if (!match) return null
  let slug: string
  try { slug = decodeURIComponent(match[1]) } catch { return null }
  if (!/^[a-z0-9-]{1,80}$/i.test(slug)) return null
  if (!match[2]) return { slug }
  const serviceType = Object.entries(publicDocumentPaths).find(([, path]) => path === match[2])?.[0] as DocumentServiceType | undefined
  return serviceType ? { slug, serviceType } : null
}
