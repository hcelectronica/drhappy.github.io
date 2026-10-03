import { createClient } from '@supabase/supabase-js'
import { createProfessionalFetch } from './professionalSession'

function normalizeSupabaseUrl(rawUrl: string | undefined): string | null {
  const candidate = rawUrl?.trim()
  if (!candidate) {
    return null
  }
  try {
    const parsed = new URL(candidate)
    if (!/^https?:$/.test(parsed.protocol)) {
      return null
    }
    // createClient expects project origin (https://<project>.supabase.co), not REST paths.
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: createProfessionalFetch((input, init) => fetch(input, init)) },
  }) : null

export const isSupabaseConfigured = Boolean(supabase)
