import { supabase, isSupabaseConfigured } from './supabaseClient'

export const PATIENT_SESSION_KEY = 'drhappy-patient-session'
const SESSION_HEADER = 'x-drhappy-patient-session'

export type PatientDocumentCategory = 'laboratorio' | 'imagenes' | 'informes' | 'vacunas' | 'otros'

export const PATIENT_DOCUMENT_CATEGORIES: Array<{ id: PatientDocumentCategory; label: string; icon: string }> = [
  { id: 'laboratorio', label: 'Laboratorio', icon: '🧪' },
  { id: 'imagenes', label: 'Imágenes', icon: '🩻' },
  { id: 'informes', label: 'Informes', icon: '📋' },
  { id: 'vacunas', label: 'Vacunas', icon: '💉' },
  { id: 'otros', label: 'Otros', icon: '📁' },
]

export function patientCategoryMeta(category: string) {
  return PATIENT_DOCUMENT_CATEGORIES.find((item) => item.id === category) ?? PATIENT_DOCUMENT_CATEGORIES[PATIENT_DOCUMENT_CATEGORIES.length - 1]
}

export interface PatientProfile {
  id: string
  email: string
  fullName: string
  firstName: string
  lastName: string
  dni: string
  birthDate: string | null
  phone: string | null
  storageUsedBytes: number
  storageQuotaBytes: number
  createdAt: string
}

export interface PatientDocument {
  id: string
  title: string
  category: PatientDocumentCategory
  studyDate: string | null
  notes: string | null
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface PatientFolderResponse {
  success: boolean
  message?: string
  code?: string
  step?: 'verify'
  email?: string
  sessionToken?: string
  patient?: PatientProfile
  documents?: PatientDocument[]
  documentId?: string
  path?: string
  uploadToken?: string
  url?: string
  mimeType?: string
  doctor?: { id: string; name: string; specialty: string }
  shares?: PatientShare[]
  shareId?: string
  expiresAt?: string
  updated?: boolean
  readings?: BpReading[]
  reading?: BpReading
}

export interface BpReading {
  id: string
  measuredAt: string
  systolic: number
  diastolic: number
  pulse: number | null
  note: string | null
}

export interface PatientShare {
  id: string
  kind: 'doctor' | 'link'
  allDocuments: boolean
  documentCount: number
  includePressure: boolean
  expiresAt: string | null
  accessCount: number
  lastAccessedAt: string | null
  createdAt: string
  doctorName: string
  doctorSpecialty: string
  url: string | null
}

export interface SharedDocument {
  id: string
  title: string
  category: string
  studyDate: string | null
  notes: string | null
  mimeType: string
  sizeBytes: number
  url?: string
  downloadUrl?: string
}

export interface OpenShareResponse {
  success: boolean
  message?: string
  step?: 'code'
  patientName?: string
  birthDate?: string | null
  expiresAt?: string
  urlTtlSeconds?: number
  documents?: SharedDocument[]
  pressure?: BpReading[]
}

export interface DoctorSharedFolder {
  shareId: string
  patientName: string
  sharedAt: string
  documents: SharedDocument[]
  pressure?: BpReading[]
}

export interface DoctorFolderLink {
  id: string
  created_at: string
  nombre: string
  apellido: string
  dni: string
  birth_date: string | null
  phone: string | null
  email: string | null
}

// Acciones públicas o del profesional: no envían la sesión del paciente.
async function invokeWithoutPatientSession<T extends { success: boolean; message?: string }>(body: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'El servicio no está disponible en este momento.' } as T
  const { data, error } = await supabase.functions.invoke('patient-folder', { body })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json() as T
        if (payload?.message) return { ...payload, success: false }
      } catch {
        // sin cuerpo JSON
      }
    }
    return { success: false, message: 'No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.' } as T
  }
  return (data as T) ?? ({ success: false, message: 'Respuesta vacía del servidor.' } as T)
}

export function openPatientShare(token: string, code: string): Promise<OpenShareResponse> {
  return invokeWithoutPatientSession<OpenShareResponse>({ action: 'open-share', token, code })
}

export function pullDoctorFolderLinks(): Promise<{ success: boolean; message?: string; links?: DoctorFolderLink[] }> {
  return invokeWithoutPatientSession({ action: 'doctor-pull-links' })
}

export function acknowledgeDoctorFolderLinks(ids: string[]): Promise<{ success: boolean; message?: string }> {
  return invokeWithoutPatientSession({ action: 'doctor-ack-links', ids })
}

export function loadDoctorSharedFolders(dni: string): Promise<{ success: boolean; message?: string; folders?: DoctorSharedFolder[] }> {
  return invokeWithoutPatientSession({ action: 'doctor-folder', dni })
}

export function getDoctorSharedDocumentUrl(shareId: string, documentId: string, download = false): Promise<{ success: boolean; message?: string; url?: string }> {
  return invokeWithoutPatientSession({ action: 'doctor-document-url', shareId, documentId, download })
}

export function getPatientSessionToken(): string {
  try { return localStorage.getItem(PATIENT_SESSION_KEY) || '' } catch { return '' }
}

export function setPatientSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(PATIENT_SESSION_KEY, token)
    else localStorage.removeItem(PATIENT_SESSION_KEY)
  } catch {
    // almacenamiento bloqueado: la sesión dura solo mientras la pestaña esté abierta
  }
}

export async function callPatientFolder(body: Record<string, unknown>): Promise<PatientFolderResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'El servicio no está disponible en este momento.' }
  const token = getPatientSessionToken()
  const { data, error } = await supabase.functions.invoke('patient-folder', {
    body,
    headers: token ? { [SESSION_HEADER]: token } : undefined,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json() as PatientFolderResponse
        if (payload?.code === 'SESSION_EXPIRED') setPatientSessionToken(null)
        if (payload?.message) return { ...payload, success: false }
      } catch {
        // sin cuerpo JSON
      }
    }
    return { success: false, message: 'No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.' }
  }
  return (data as PatientFolderResponse) ?? { success: false, message: 'Respuesta vacía del servidor.' }
}

const MAX_IMAGE_SIDE = 2200
const COMPRESS_FROM_BYTES = 1.5 * 1024 * 1024

// Las fotos de celular suelen pesar varios MB: se reducen antes de subir sin perder legibilidad.
export async function prepareFileForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < COMPRESS_FROM_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export async function uploadPatientDocument(
  file: File,
  meta: { title: string; category: PatientDocumentCategory; studyDate: string; notes: string },
): Promise<PatientFolderResponse> {
  if (!supabase) return { success: false, message: 'El servicio no está disponible en este momento.' }
  const prepared = await prepareFileForUpload(file)
  const created = await callPatientFolder({
    action: 'create-upload',
    ...meta,
    mimeType: prepared.type,
    sizeBytes: prepared.size,
  })
  if (!created.success || !created.path || !created.uploadToken || !created.documentId) return created
  const { error } = await supabase.storage.from('patient-folders').uploadToSignedUrl(created.path, created.uploadToken, prepared, {
    contentType: prepared.type,
  })
  if (error) {
    await callPatientFolder({ action: 'delete-document', documentId: created.documentId })
    return { success: false, message: 'No se pudo subir el archivo. Revisá tu conexión e intentá de nuevo.' }
  }
  return callPatientFolder({ action: 'confirm-upload', documentId: created.documentId })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

export function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}
