import { supabase, isSupabaseConfigured } from './supabaseClient'

// Servicio NUEVO e independiente de la Turnera. Gestiona los enlaces
// públicos de "turnos libres" que el profesional comparte por WhatsApp.

export interface PublicBookingLinkSummary {
  id: string
  token: string
  slot_date: string
  start_time: string
  end_time: string
  slot_count: number
  location: string | null
  reason: string | null
  status: 'active' | 'expired' | 'cancelled'
  created_at: string
  totalSlots: number
  bookedSlots: number
}

export interface PublicBookingAvailabilityBlock {
  id: string
  label: string
  modality: 'coverage' | 'private'
  days: number[]
  startTime: string
  endTime: string
  durationMinutes: number
  slotCount: number
  location?: string
  reason?: string
  amountToCharge?: number
  amountConcept?: 'sena' | 'consulta'
  paymentLink?: string
}

export interface PublicBookingSettings {
  professionalId: string
  slug: string
  enabled: boolean
  professionalName: string
  location?: string
  reason?: string
  horizonDays: number
  blocks: PublicBookingAvailabilityBlock[]
  updatedAt?: string
}

interface ActionResult {
  success: boolean
  message?: string
}

async function invokePublicBooking(body: Record<string, unknown>): Promise<any> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase no está conectado en este entorno.' }
  }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('public-booking', { body, headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined })
  if (error) {
    return { success: false, message: error.message || 'Error invocando el servicio de turnos libres.' }
  }
  return data
}

export async function createPublicBookingLink(params: {
  professionalId: string
  professionalName?: string
  slotDate: string
  startTime: string
  endTime: string
  slotCount: number
  location?: string
  reason?: string
  intervalMinutes?: number
  amountToCharge?: number
  amountConcept?: 'sena' | 'consulta'
  paymentLink?: string
  appointmentDays?: number[]
  dailyPatientLimit?: number
}): Promise<ActionResult & { token?: string; slotCount?: number }> {
  return invokePublicBooking({ action: 'create-link', ...params })
}

export async function listPublicBookingLinks(
  professionalId: string,
): Promise<ActionResult & { links?: PublicBookingLinkSummary[] }> {
  return invokePublicBooking({ action: 'list-links', professionalId })
}

export async function cancelPublicBookingLink(params: {
  linkId: string
  professionalId: string
}): Promise<ActionResult> {
  return invokePublicBooking({ action: 'cancel-link', ...params })
}

export async function getPublicBookingSettings(
  professionalId: string,
): Promise<ActionResult & { settings?: PublicBookingSettings }> {
  return invokePublicBooking({ action: 'get-public-settings', professionalId })
}

export async function savePublicBookingSettings(
  settings: PublicBookingSettings,
): Promise<ActionResult & { settings?: PublicBookingSettings }> {
  return invokePublicBooking({ action: 'save-public-settings', settings })
}

export function buildPublicBookingUrl(token: string): string {
  const base = `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`
  return `${base}turno-libre.html?t=${token}`
}

export function buildFixedPublicBookingUrl(slug: string, modality?: 'coverage' | 'private'): string {
  const base = `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`
  const modalityQuery = modality ? `&m=${modality}` : ''
  return `${base}turnos/?p=${encodeURIComponent(slug)}${modalityQuery}`
}

export function buildWhatsAppShareUrl(link: string, professionalName?: string): string {
  const message = `Hola! ${professionalName ? `Soy ${professionalName}. ` : ''}Te comparto un enlace para que elijas tu turno disponible: ${link}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
