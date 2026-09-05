import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { BrowserPDF417Reader, BrowserQRCodeReader } from '@zxing/browser'
import * as XLSX from 'xlsx'
import './App.css'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  getNotificationPermission,
  requestNotificationPermission,
  showAppNotification,
} from './notificationService'
import type { NotificationPermissionState } from './notificationService'
import diagnosisCsv from '../cie-10.csv?raw'
import specialtiesCsv from '../especialidades-medicas.csv?raw'

type WorkspaceLayer =
  | 'overview'
  | 'patient-search'
  | 'patient-record'
  | 'clinical'
  | 'profile'
  | 'user-admin'
  | 'tools'
  | 'medication-detail'
  | 'ambulance'
  | 'ambulance-history'
type SubscriptionPlan = 'monthly' | 'semiannual' | 'annual'

interface AmbulanceDraft {
  qth: string
  destino: string
  diagnosticoCie10: string
  diagnosticoFinal: string
}
type DictationConsultationField = 'detalleAtencion' | 'pensamientoMedico'
type ThemeMode = 'light' | 'night'
type LiveScanTarget = 'dni' | 'credential'

interface DictationResult {
  transcript: string
}

interface DictationResultList {
  length: number
  item(index: number): { isFinal: boolean; 0: DictationResult } | null
  [index: number]: { isFinal: boolean; 0: DictationResult }
}

interface DictationEvent extends Event {
  resultIndex: number
  results: DictationResultList
}

interface DictationErrorEvent extends Event {
  error?: string
  message?: string
}

interface BrowserSpeechRecognition extends EventTarget {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives?: number
  start(): void
  stop(): void
  onresult: ((event: DictationEvent) => void) | null
  onerror: ((event: DictationErrorEvent) => void) | null
  onend: (() => void) | null
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition

type BarcodeFormat = 'pdf417' | 'qr_code'

interface DetectedBarcode {
  rawValue: string
  format: string
}

interface BrowserBarcodeDetector {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

interface BrowserBarcodeDetectorCtor {
  new (options?: { formats?: BarcodeFormat[] }): BrowserBarcodeDetector
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionCtor
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor
    BarcodeDetector?: BrowserBarcodeDetectorCtor
  }
}

interface SeedUser {
  id: string
  username: string
  password: string
  fullName: string
  specialty: string
  licenseNumber: string
  email: string
  networkMemberships?: string[]
  isAdmin?: boolean
  active?: boolean
  trialStartedAt?: string        // ISO date cuando se registró
  subscriptionStatus?: 'trial' | 'active' | 'expired' | 'cancelled'
  subscriptionExpiresAt?: string // ISO date de vencimiento de suscripción paga
}

interface StoredFile {
  id: string
  name: string
  type: string
  size: number
  dataUrl: string
  uploadedAt: string
}

interface ProfessionalProfile {
  fullName: string
  specialty: string
  licenseNumber: string
  email: string
  phone: string
  matriculaPhoto?: StoredFile
  signatureImage?: StoredFile
  signatureText: string
  communitySeenMessageIds?: string[]
}

interface ConsultationEntry {
  id: string
  date: string
  motivoConsulta: string
  diagnostico?: string
  detalleAtencion: string
  pensamientoMedico: string
  professionalSignature: {
    fullName: string
    licenseNumber: string
    signatureText: string
    signatureImageDataUrl?: string
  }
}

interface PatientRecord {
  id: string
  ownerUserId: string
  nombre: string
  apellido: string
  dni: string
  email: string
  obraSocial: string
  numeroAfiliado: string
  plan: string
  birthDate: string
  edad: number
  diagnosticoPrincipal?: string
  patologiasConocidas: string
  patologiasCronicas: string
  ultimaInternacion: string
  cirugiasPrevias: string
  direccion: string
  photoCarnet?: StoredFile
  dniPhoto?: StoredFile
  documents: StoredFile[]
  consultations: ConsultationEntry[]
  createdAt: string
  updatedAt: string
}

interface PatientDraft {
  nombre: string
  apellido: string
  dni: string
  email: string
  obraSocial: string
  numeroAfiliado: string
  plan: string
  birthDate: string
  diagnosticoPrincipal: string
  patologiasConocidas: string
  patologiasCronicas: string
  ultimaInternacion: string
  cirugiasPrevias: string
  direccion: string
  photoCarnet?: StoredFile
  dniPhoto?: StoredFile
  documents: StoredFile[]
}

interface ConsultationDraft {
  motivoConsulta: string
  diagnostico: string
  detalleAtencion: string
  pensamientoMedico: string
}

interface CommunityMessage {
  id: string
  senderId: string
  recipientId: string
  text: string
  attachments: StoredFile[]
  sentAt: string
}

interface RegisterDraft {
  firstName: string
  lastName: string
  specialty: string
  licenseNumber: string
  email: string
  username: string
  password: string
  networkMemberships: string[]
}

interface MedicationEntry {
  id: string
  brand: string
  drug: string
  presentation: string
  laboratory: string
  mechanismOfAction: string
  adverseEffects: string
  dosage: string
  indications: string
  contraindications: string
}

interface MedicalNewsItem {
  id: string
  source: string
  title: string
  summary: string
  link: string
  publishedAt: string
  imageUrl: string
}

interface PasswordRecoveryChallenge {
  userId: string
  code: string
  expiresAt: string
}

interface AppointmentRecord {
  id: string
  patientId: string
  patientName: string
  patientEmail: string
  scheduledDate: string
  scheduledTime: string
  scheduledAt?: string
  reason: string
  createdAt: string
  createdByUserId: string
  emailDraftSentAt?: string
}

interface SeedPatientsPayload {
  patients: Array<Partial<PatientRecord>>
}

interface RemoteProfessionalRow {
  id: string
  username: string
  password: string
  full_name: string
  specialty: string
  license_number: string
  email: string
  network_memberships_json?: unknown
  is_admin?: boolean | null
  active?: boolean | null
  trial_started_at?: string | null
  subscription_status?: string | null
  subscription_expires_at?: string | null
}

interface RemoteWorkspaceRow {
  user_id: string
  profile_json: unknown
  patients_json: unknown
  appointments_json: unknown
}

interface RemoteCommunityMessageRow {
  id: string
  sender_id: string
  recipient_id: string
  text: string | null
  attachments_json: unknown
  sent_at: string
}

interface RemotePasswordRecoveryRow {
  user_id: string
  code: string
  expires_at: string
}

interface RemoteDeletedUserArchiveRow {
  id: string
  deleted_user_id: string
  deleted_username: string
  deleted_full_name: string
  deleted_email: string
  deleted_at: string
  deleted_by_user_id: string
  deleted_by_user_name: string
  patient_count: number | null
  appointment_count: number | null
  archive_json: unknown
}

interface DeletedUserArchiveRecord {
  id: string
  deletedUserId: string
  deletedUsername: string
  deletedFullName: string
  deletedEmail: string
  deletedAt: string
  deletedByUserId: string
  deletedByUserName: string
  patientCount: number
  appointmentCount: number
  archiveData: Record<string, unknown>
}

const SESSION_USER_KEY = 'drhappy-active-user'
const CREATED_USERS_KEY = 'drhappy-created-users'
const THEME_MODE_KEY = 'drhappy-theme-mode'
const PATIENT_REGISTRY_KEY = 'drhappy-patient-registry'
const PASSWORD_OVERRIDES_KEY = 'drhappy-password-overrides'
const PASSWORD_RECOVERY_KEY = 'drhappy-password-recovery'
const USER_ACTIVE_OVERRIDES_KEY = 'drhappy-user-active-overrides'
const CUSTOM_DIAGNOSIS_STORAGE_KEY = 'drhappy-custom-diagnosis-catalog'
const DELETED_USER_ARCHIVES_KEY = 'drhappy-deleted-user-archives'
const INSTALL_PROMPT_DISMISSED_KEY = 'drhappy-install-prompt-dismissed'
// Cuántos días esperamos antes de volver a ofrecer la instalación tras un "Ahora no".
const INSTALL_PROMPT_SNOOZE_DAYS = 7
const NOTIFICATION_PROMPT_DISMISSED_KEY = 'drhappy-notification-prompt-dismissed'
const NOTIFICATION_PROMPT_SNOOZE_DAYS = 5

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const emptyPatientDraft: PatientDraft = {
  nombre: '',
  apellido: '',
  dni: '',
  email: '',
  obraSocial: '',
  numeroAfiliado: '',
  plan: '',
  birthDate: '',
  diagnosticoPrincipal: '',
  patologiasConocidas: '',
  patologiasCronicas: '',
  ultimaInternacion: '',
  cirugiasPrevias: '',
  direccion: '',
  documents: [],
}

const emptyConsultationDraft: ConsultationDraft = {
  motivoConsulta: '',
  diagnostico: '',
  detalleAtencion: '',
  pensamientoMedico: '',
}

const emptyRegisterDraft: RegisterDraft = {
  firstName: '',
  lastName: '',
  specialty: '',
  licenseNumber: '',
  email: '',
  username: '',
  password: '',
  networkMemberships: [],
}

const PROFESSIONAL_NETWORK_OPTIONS = [
  'RED PAMI',
  'RED IOMA',
  'RED OSDE',
  'RED GALENO',
  'RED MEDICUS',
  'RED OMINT',
  'RED SWISSMEDICAL',
] as const

const APP_BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev-local'
const DAY_IN_MS = 86400000
const VADEMECUM_MIN_QUERY_LENGTH = 4
const VADEMECUM_MAX_SUGGESTIONS = 7
function buildManualNewsImage(label: string, leftColor: string, rightColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${label}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${leftColor}"/><stop offset="100%" stop-color="${rightColor}"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><rect x="56" y="56" width="1088" height="518" rx="36" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.25)" stroke-width="2"/><text x="80" y="220" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="700">${label}</text><text x="80" y="300" fill="#e5eefc" font-family="Arial, Helvetica, sans-serif" font-size="28">Fuente medica destacada en Dr Happy</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}
const MANUAL_MEDICAL_NEWS_ITEMS: MedicalNewsItem[] = [
  {
    id: 'manual-nejm',
    source: 'NEJM',
    title: 'The New England Journal of Medicine',
    summary:
      'Acceso directo a una de las publicaciones médicas más influyentes para consultar novedades, revisiones y contenido editorial.',
    link: 'https://www.nejm.org/',
    publishedAt: '',
    imageUrl: buildManualNewsImage('NEJM', '#0f172a', '#1d4ed8'),
  },
  {
    id: 'manual-lancet',
    source: 'The Lancet',
    title: 'The Lancet',
    summary:
      'Publicacion britanica lider en salud global, epidemiologia e investigacion clinica de vanguardia.',
    link: 'https://www.thelancet.com/',
    publishedAt: '',
    imageUrl: buildManualNewsImage('The Lancet', '#1f2937', '#0f766e'),
  },
  {
    id: 'manual-jama',
    source: 'JAMA Network',
    title: 'JAMA Network',
    summary:
      'Red de revistas del Journal of the American Medical Association con noticias, innovaciones y actualizacion medica periodica.',
    link: 'https://jamanetwork.com/',
    publishedAt: '',
    imageUrl: buildManualNewsImage('JAMA Network', '#7c2d12', '#dc2626'),
  },
  {
    id: 'manual-bmj',
    source: 'The BMJ',
    title: 'The BMJ',
    summary:
      'Investigaciones originales, comentarios de actualidad y debates sobre politicas de salud del British Medical Journal.',
    link: 'https://www.bmj.com/',
    publishedAt: '',
    imageUrl: buildManualNewsImage('The BMJ', '#1e3a8a', '#2563eb'),
  },
  {
    id: 'manual-ram',
    source: 'Revista Argentina de Medicina',
    title: 'Revista Argentina de Medicina',
    summary:
      'Publicacion trimestral de la Sociedad Argentina de Medicina con contenido cientifico, biomédico y epidemiologico.',
    link: 'https://revistasam.com.ar/',
    publishedAt: '',
    imageUrl: buildManualNewsImage('Revista Argentina de Medicina', '#1f2937', '#0f766e'),
  },
  {
    id: 'manual-gba-salud',
    source: 'Salud Provincia de Buenos Aires',
    title: 'Ministerio de Salud de la Provincia de Buenos Aires',
    summary:
      'Portal institucional con informacion sanitaria, programas y novedades del sistema de salud bonaerense.',
    link: 'https://www.gba.gob.ar/saludprovincia/noticias',
    publishedAt: '',
    imageUrl: buildManualNewsImage('Salud Provincia BA', '#0f172a', '#16a34a'),
  },
]
const MEDICAL_NEWS_FALLBACK: MedicalNewsItem[] = [
  {
    id: 'fallback-msal',
    source: 'Ministerio de Salud de la Nación',
    title: 'Ministerio de Salud de la Nación',
    summary: 'Noticias, campañas y comunicados oficiales del sistema sanitario nacional.',
    link: 'https://www.argentina.gob.ar/salud/noticias',
    publishedAt: '',
    imageUrl: 'https://www.argentina.gob.ar/sites/default/files/argentina-fb.png',
  },
  {
    id: 'fallback-who',
    source: 'OMS',
    title: 'OMS / WHO',
    summary: 'Lee los comunicados y noticias recientes de la Organización Mundial de la Salud.',
    link: 'https://www.who.int/es/news',
    publishedAt: '',
    imageUrl: 'https://cdn.who.int/media/images/default-source/imported/world-health-day-2025/uhc_2025_social-share5a5649a0-fe23-4f72-a42b-67a6c17fd4d5.tmb-1200v.jpg',
  },
  ...MANUAL_MEDICAL_NEWS_ITEMS,
] as const
const SUBSCRIPTION_PLAN_OPTIONS: Array<{
  plan: SubscriptionPlan
  icon: string
  title: string
  durationDays: number
  description: string
  accentColor: string
  badgeText?: string
}> = [
  {
    plan: 'monthly',
    icon: '📅',
    title: 'Plan Mensual',
    durationDays: 30,
    description: 'Acceso completo · Pacientes ilimitados · 30 días de vigencia',
    accentColor: '#c0392b',
  },
  {
    plan: 'semiannual',
    icon: '🗓️',
    title: 'Plan 6 Meses',
    durationDays: 180,
    description: 'Acceso completo · Pacientes ilimitados · 180 días de vigencia',
    accentColor: '#7c3aed',
    badgeText: 'MAYOR COBERTURA',
  },
  {
    plan: 'annual',
    icon: '📆',
    title: 'Plan Anual',
    durationDays: 365,
    description: 'Acceso completo · Pacientes ilimitados · 365 días de vigencia',
    accentColor: '#1d4ed8',
    badgeText: 'MEJOR VALOR',
  },
]

const DIAGNOSIS_TABLE_CANDIDATES = [
  'diagnosticos',
  'diagnostics',
  'diagnostico',
  'diagnosis_catalog',
  'listado_diagnosticos',
  'diagnosticos_cie10',
] as const

function profileStorageKey(userId: string): string {
  return `drhappy-profile-${userId}`
}

function patientIndexStorageKey(userId: string): string {
  return `drhappy-patient-index-${userId}`
}

function patientStorageKey(userId: string, patientId: string): string {
  return `drhappy-patient-${userId}-${patientId}`
}

function appointmentsStorageKey(userId: string): string {
  return `drhappy-appointments-${userId}`
}

function patientGlobalStorageKey(patientId: string): string {
  return `drhappy-patient-global-${patientId}`
}

function communityThreadStorageKey(userIdA: string, userIdB: string): string {
  const sorted = [userIdA, userIdB].sort()
  return `drhappy-community-thread-${sorted[0]}-${sorted[1]}`
}

function communitySeenStorageKey(userId: string): string {
  return `drhappy-community-seen-${userId}`
}

function normalizeStoredFile(raw: unknown): StoredFile | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const candidate = raw as Partial<StoredFile>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.type !== 'string' ||
    typeof candidate.size !== 'number' ||
    typeof candidate.dataUrl !== 'string' ||
    typeof candidate.uploadedAt !== 'string'
  ) {
    return null
  }
  return {
    id: candidate.id,
    name: candidate.name,
    type: candidate.type,
    size: candidate.size,
    dataUrl: candidate.dataUrl,
    uploadedAt: candidate.uploadedAt,
  }
}

function normalizeStoredFiles(raw: unknown): StoredFile[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const normalized: StoredFile[] = []
  for (const candidate of raw) {
    const parsed = normalizeStoredFile(candidate)
    if (parsed) {
      normalized.push(parsed)
    }
  }
  return normalized
}

function normalizeProfessionalNetworks(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const validNetworks = new Set<string>(PROFESSIONAL_NETWORK_OPTIONS)
  const normalized: string[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string') {
      continue
    }
    const value = candidate.trim()
    if (!validNetworks.has(value) || normalized.includes(value)) {
      continue
    }
    normalized.push(value)
  }
  return normalized
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: string[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string') {
      continue
    }
    const value = candidate.trim()
    if (!value || normalized.includes(value)) {
      continue
    }
    normalized.push(value)
  }
  return normalized
}

function extractDiagnosisText(row: Record<string, unknown>): string {
  const preferredKeys = [
    'diagnostico',
    'diagnosis',
    'descripcion',
    'description',
    'nombre',
    'name',
    'label',
    'titulo',
    'title',
  ]

  for (const key of preferredKeys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  for (const value of Object.values(row)) {
    if (typeof value === 'string' && value.trim().length >= 4) {
      return value.trim()
    }
  }
  return ''
}

function scoreDiagnosisSuggestion(diagnosis: string, query: string): number {
  const normalizedQuery = normalizeSearchText(query)
  const normalizedDiagnosis = normalizeSearchText(diagnosis)
  if (!normalizedQuery || !normalizedDiagnosis) {
    return Number.POSITIVE_INFINITY
  }
  if (normalizedDiagnosis === normalizedQuery) {
    return 0
  }
  if (normalizedDiagnosis.startsWith(normalizedQuery)) {
    return 1
  }
  if (normalizedDiagnosis.includes(normalizedQuery)) {
    return 2
  }
  if (normalizedDiagnosis.slice(0, 4) === normalizedQuery.slice(0, 4)) {
    return 1.5
  }
  return normalizedDiagnosis.split(/\s+/).some((token) => token.startsWith(normalizedQuery.slice(0, 4)))
    ? 2.5
    : Number.POSITIVE_INFINITY
}

function buildDiagnosisSuggestions(catalog: string[], query: string, limit = 35): string[] {
  const normalizedQuery = normalizeSearchText(query)
  const ranked = catalog
    .map((diagnosis) => ({ diagnosis, score: scoreDiagnosisSuggestion(diagnosis, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.diagnosis.localeCompare(right.diagnosis, 'es'))

  if (!normalizedQuery) {
    return ranked.slice(0, limit).map((entry) => entry.diagnosis)
  }

  return ranked.slice(0, limit).map((entry) => entry.diagnosis)
}

function loadSimpleCatalogFromCsv(csvText: string): string[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) {
    return []
  }

  const parsedRows = lines.map((line) => parseCsvLine(line))
  const header = parsedRows[0].map((cell) => normalizeHeader(cell))
  const preferredIndex = header.findIndex((cell) =>
    ['especialidad', 'specialty', 'nombre', 'name', 'titulo', 'title'].includes(cell),
  )
  const startIndex = preferredIndex >= 0 ? 1 : 0
  const values = new Set<string>()

  for (let index = startIndex; index < parsedRows.length; index += 1) {
    const row = parsedRows[index]
    const candidate = preferredIndex >= 0 ? row[preferredIndex] : row[0]
    if (candidate?.trim()) {
      values.add(candidate.trim())
    }
  }

  return Array.from(values).sort((left, right) => left.localeCompare(right, 'es'))
}

function buildStringSuggestions(catalog: string[], query: string, limit = 12): string[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return catalog.slice(0, limit)
  }

  return catalog
    .map((entry) => ({ entry, score: scoreDiagnosisSuggestion(entry, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.entry.localeCompare(right.entry, 'es'))
    .slice(0, limit)
    .map((entry) => entry.entry)
}

function loadMedicationCatalogFromJson(rawCatalog: unknown): MedicationEntry[] {
  if (!Array.isArray(rawCatalog)) {
    return []
  }

  const medications: MedicationEntry[] = []
  for (const rawEntry of rawCatalog) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      continue
    }

    const entry = rawEntry as Record<string, unknown>
    const medication: MedicationEntry = {
      id: asText(entry.id),
      brand: asText(entry.brand),
      drug: asText(entry.drug),
      presentation: asText(entry.presentation),
      laboratory: asText(entry.laboratory),
      mechanismOfAction: asText(entry.mechanismOfAction),
      adverseEffects: asText(entry.adverseEffects),
      dosage: asText(entry.dosage),
      indications: asText(entry.indications),
      contraindications: asText(entry.contraindications),
    }
    if (medication.id && (medication.brand || medication.drug)) {
      medications.push(medication)
    }
  }

  return medications.sort(
    (left, right) =>
      (left.brand || left.drug).localeCompare(right.brand || right.drug, 'es') ||
      left.presentation.localeCompare(right.presentation, 'es'),
  )
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells.map((value) => value.trim())
}

function mergeDiagnosisCatalog(entries: string[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, 'es'),
  )
}

function loadDiagnosisCatalogFromCsv(csvText: string): string[] {
  const lines = csvText.split(/\r?\n/).filter(Boolean)
  if (lines.length <= 1) {
    return []
  }

  const header = parseCsvLine(lines[0]).map((cell) => cell.toLowerCase())
  const descriptionIndex = header.findIndex((cell) => cell === 'description' || cell === 'diagnostico' || cell === 'diagnosis' || cell === 'nombre' || cell === 'label')
  const codeIndex = header.findIndex((cell) => cell === 'code' || cell === 'codigo' || cell === 'cod')

  const results = new Set<string>()
  for (let index = 1; index < lines.length; index += 1) {
    const row = parseCsvLine(lines[index])
    const description = descriptionIndex >= 0 ? row[descriptionIndex] : ''
    const code = codeIndex >= 0 ? row[codeIndex] : ''
    const candidate = [code, description].filter(Boolean).join(' - ').trim()
    if (candidate) {
      results.add(candidate)
    }
  }

  return Array.from(results)
}

function isAmbulanceConsultation(entry: ConsultationEntry): boolean {
  return entry.motivoConsulta.trim().startsWith('[AMBULANCIA]')
}

function mergeMedicalNewsItems(primaryItems: MedicalNewsItem[], secondaryItems: MedicalNewsItem[]): MedicalNewsItem[] {
  const merged: MedicalNewsItem[] = []
  const seenKeys = new Set<string>()

  for (const item of [...secondaryItems, ...primaryItems]) {
    const key = `${item.source}::${item.link}`
    if (seenKeys.has(key)) {
      continue
    }
    seenKeys.add(key)
    merged.push(item)
  }

  return merged
}

function mapRemoteCommunityMessage(row: RemoteCommunityMessageRow): CommunityMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    text: row.text ?? '',
    attachments: normalizeStoredFiles(row.attachments_json),
    sentAt: row.sent_at,
  }
}

function mapRemoteProfessional(row: RemoteProfessionalRow): SeedUser {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    fullName: row.full_name,
    specialty: row.specialty,
    licenseNumber: row.license_number,
    email: row.email,
    networkMemberships: normalizeProfessionalNetworks(row.network_memberships_json),
    isAdmin: isAdminUser({
      id: row.id,
      username: row.username,
      isAdmin: Boolean(row.is_admin),
    }),
    active: row.active ?? true,
    trialStartedAt: row.trial_started_at ?? undefined,
    subscriptionStatus: (row.subscription_status as SeedUser['subscriptionStatus']) ?? undefined,
    subscriptionExpiresAt: row.subscription_expires_at ?? undefined,
  }
}

function mapRemoteDeletedUserArchive(row: RemoteDeletedUserArchiveRow): DeletedUserArchiveRecord {
  return {
    id: row.id,
    deletedUserId: row.deleted_user_id,
    deletedUsername: row.deleted_username,
    deletedFullName: row.deleted_full_name,
    deletedEmail: row.deleted_email,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
    deletedByUserName: row.deleted_by_user_name,
    patientCount: typeof row.patient_count === 'number' ? row.patient_count : 0,
    appointmentCount: typeof row.appointment_count === 'number' ? row.appointment_count : 0,
    archiveData: row.archive_json && typeof row.archive_json === 'object' ? (row.archive_json as Record<string, unknown>) : {},
  }
}

function normalizeRemoteProfile(raw: unknown, fallback: ProfessionalProfile): ProfessionalProfile {
  if (!raw || typeof raw !== 'object') {
    return fallback
  }
  const candidate = raw as Partial<ProfessionalProfile>
  if (
    typeof candidate.fullName !== 'string' ||
    typeof candidate.specialty !== 'string' ||
    typeof candidate.licenseNumber !== 'string' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.phone !== 'string' ||
    typeof candidate.signatureText !== 'string'
  ) {
    return fallback
  }
  return {
    fullName: candidate.fullName,
    specialty: candidate.specialty,
    licenseNumber: candidate.licenseNumber,
    email: candidate.email,
    phone: candidate.phone,
    signatureText: candidate.signatureText,
    matriculaPhoto: normalizeStoredFile(candidate.matriculaPhoto) ?? undefined,
    signatureImage: normalizeStoredFile(candidate.signatureImage) ?? undefined,
    communitySeenMessageIds: normalizeStringList(candidate.communitySeenMessageIds),
  }
}

function normalizeRemotePatient(raw: unknown, ownerUserId: string): PatientRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const candidate = raw as Partial<PatientRecord>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.apellido !== 'string' ||
    typeof candidate.dni !== 'string'
  ) {
    return null
  }
  const birthDate = typeof candidate.birthDate === 'string' ? candidate.birthDate : ''
  return {
    id: candidate.id,
    ownerUserId:
      typeof candidate.ownerUserId === 'string' && candidate.ownerUserId
        ? candidate.ownerUserId
        : ownerUserId,
    nombre: typeof candidate.nombre === 'string' ? candidate.nombre : '',
    apellido: candidate.apellido,
    dni: candidate.dni,
    email: typeof candidate.email === 'string' ? candidate.email : '',
    obraSocial: typeof candidate.obraSocial === 'string' ? candidate.obraSocial : '',
    numeroAfiliado:
      typeof candidate.numeroAfiliado === 'string' ? candidate.numeroAfiliado : '',
    plan: typeof candidate.plan === 'string' ? candidate.plan : '',
    birthDate,
    edad: calculateAge(birthDate),
    diagnosticoPrincipal:
      typeof candidate.diagnosticoPrincipal === 'string' ? candidate.diagnosticoPrincipal : '',
    patologiasConocidas:
      typeof candidate.patologiasConocidas === 'string' ? candidate.patologiasConocidas : '',
    patologiasCronicas:
      typeof candidate.patologiasCronicas === 'string' ? candidate.patologiasCronicas : '',
    ultimaInternacion:
      typeof candidate.ultimaInternacion === 'string' ? candidate.ultimaInternacion : '',
    cirugiasPrevias: typeof candidate.cirugiasPrevias === 'string' ? candidate.cirugiasPrevias : '',
    direccion: typeof candidate.direccion === 'string' ? candidate.direccion : '',
    photoCarnet: normalizeStoredFile(candidate.photoCarnet) ?? undefined,
    dniPhoto: normalizeStoredFile(candidate.dniPhoto) ?? undefined,
    documents: normalizeStoredFiles(candidate.documents),
    consultations: Array.isArray(candidate.consultations)
      ? (candidate.consultations as ConsultationEntry[]).map((entry) => ({
          ...entry,
          diagnostico: typeof entry.diagnostico === 'string' ? entry.diagnostico : '',
        }))
      : [],
    createdAt:
      typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  }
}

function calculateAge(birthDate: string): number {
  const normalized = normalizeBirthDate(birthDate)
  if (!normalized) {
    return 0
  }

  const [yearText, monthText, dayText] = normalized.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const birth = new Date(year, month - 1, day)
  if (Number.isNaN(birth.getTime())) {
    return 0
  }

  const today = new Date()
  let age = today.getFullYear() - year
  const monthDiff = today.getMonth() - (month - 1)
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age -= 1
  }
  return age >= 0 ? age : 0
}

function readJsonStorage<T>(key: string, fallback: T): T {
  const value = localStorage.getItem(key)
  if (!value) {
    return fallback
  }
  return JSON.parse(value) as T
}

function sortPatientsByName(list: PatientRecord[]): PatientRecord[] {
  const sorted = [...list]
  sorted.sort((a, b) => {
    const byApellido = a.apellido.localeCompare(b.apellido, 'es')
    if (byApellido !== 0) {
      return byApellido
    }
    return a.nombre.localeCompare(b.nombre, 'es')
  })
  return sorted
}

function computeGrantExpiryIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortDate(value: string): string {
  if (!value) {
    return 'No informado'
  }
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(value)
  return date.toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function slugifyFileSegment(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function buildSubscriptionExpiryIso(plan: SubscriptionPlan, baseIso = new Date().toISOString()): string {
  const durationDays = SUBSCRIPTION_PLAN_OPTIONS.find((option) => option.plan === plan)?.durationDays ?? 30
  return new Date(new Date(baseIso).getTime() + durationDays * DAY_IN_MS).toISOString()
}

function buildArchiveFileName(record: Pick<DeletedUserArchiveRecord, 'deletedUsername' | 'deletedFullName' | 'deletedAt'>): string {
  const preferredSegment = slugifyFileSegment(record.deletedUsername || record.deletedFullName || 'usuario')
  const dateSegment = record.deletedAt.slice(0, 10)
  return `archivo-legal-${preferredSegment || 'usuario'}-${dateSegment}.json`
}

function patientToDraft(patient: PatientRecord): PatientDraft {
  return {
    nombre: patient.nombre,
    apellido: patient.apellido,
    dni: patient.dni,
    email: patient.email,
    obraSocial: patient.obraSocial,
    numeroAfiliado: patient.numeroAfiliado,
    plan: patient.plan,
    birthDate: patient.birthDate,
    diagnosticoPrincipal: patient.diagnosticoPrincipal ?? '',
    patologiasConocidas: patient.patologiasConocidas,
    patologiasCronicas: patient.patologiasCronicas,
    ultimaInternacion: patient.ultimaInternacion,
    cirugiasPrevias: patient.cirugiasPrevias,
    direccion: patient.direccion,
    photoCarnet: patient.photoCarnet,
    dniPhoto: patient.dniPhoto,
    documents: patient.documents,
  }
}

async function fileToStoredFile(file: File): Promise<StoredFile> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`No se pudo leer el archivo: ${file.name}`))
    reader.readAsDataURL(file)
  })

  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type,
    size: file.size,
    dataUrl,
    uploadedAt: new Date().toISOString(),
  }
}

function profileFromSeed(user: SeedUser): ProfessionalProfile {
  return {
    fullName: user.fullName,
    specialty: user.specialty,
    licenseNumber: user.licenseNumber,
    email: user.email,
    phone: '',
    signatureText: 'Validado digitalmente por profesional de la salud.',
    communitySeenMessageIds: [],
  }
}

function isAdminUser(user?: Partial<SeedUser> | null): boolean {
  if (!user) {
    return false
  }
  const normalizedUsername = user.username?.trim().toLowerCase() ?? ''
  return Boolean(user.isAdmin) || user.id === 'admin-general' || normalizedUsername === 'admin'
}

function localDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function appointmentSortKey(appointment: AppointmentRecord): string {
  return `${appointment.scheduledDate}T${appointment.scheduledTime}`
}

function normalizeAppointmentRecord(appointment: AppointmentRecord): AppointmentRecord {
  if (appointment.scheduledDate && appointment.scheduledTime) {
    return {
      ...appointment,
      scheduledAt: appointment.scheduledAt ?? `${appointment.scheduledDate}T${appointment.scheduledTime}:00`,
    }
  }

  const scheduledDateTime = appointment.scheduledAt ? new Date(appointment.scheduledAt) : null
  if (!scheduledDateTime || Number.isNaN(scheduledDateTime.getTime())) {
    return {
      ...appointment,
      scheduledDate: '',
      scheduledTime: '',
      scheduledAt: appointment.scheduledAt,
    }
  }

  return {
    ...appointment,
    scheduledDate: localDateKey(scheduledDateTime),
    scheduledTime: `${String(scheduledDateTime.getHours()).padStart(2, '0')}:${String(scheduledDateTime.getMinutes()).padStart(2, '0')}`,
    scheduledAt: appointment.scheduledAt,
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function levenshteinDistance(left: string, right: string): number {
  const a = normalizeSearchText(left)
  const b = normalizeSearchText(right)

  if (a === b) {
    return 0
  }
  if (a.length === 0) {
    return b.length
  }
  if (b.length === 0) {
    return a.length
  }

  const previous = new Array<number>(b.length + 1)
  const current = new Array<number>(b.length + 1)

  for (let index = 0; index <= b.length; index += 1) {
    previous[index] = index
  }

  for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
    current[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
      const cost = a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost,
      )
    }
    for (let index = 0; index <= b.length; index += 1) {
      previous[index] = current[index]
    }
  }

  return previous[b.length]
}

function scorePatientSearch(patient: PatientRecord, query: string): number {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return 0
  }

  const candidates = [
    `${patient.apellido} ${patient.nombre}`.trim(),
    patient.apellido,
    patient.nombre,
    patient.dni,
  ]
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeSearchText(candidate)
    if (!normalizedCandidate) {
      continue
    }
    if (normalizedCandidate === normalizedQuery) {
      return 0
    }
    if (normalizedCandidate.startsWith(normalizedQuery)) {
      bestScore = Math.min(bestScore, 1)
    }
    if (normalizedCandidate.includes(normalizedQuery)) {
      bestScore = Math.min(bestScore, 2)
    }

    for (const word of normalizedCandidate.split(/\s+/)) {
      if (!word) {
        continue
      }
      if (word.startsWith(normalizedQuery)) {
        bestScore = Math.min(bestScore, 1.2)
      }
      const distance = levenshteinDistance(normalizedQuery, word)
      const similarity = distance / Math.max(normalizedQuery.length, word.length)
      if (similarity <= 0.34) {
        bestScore = Math.min(bestScore, 3 + similarity)
      }
    }

    const distance = levenshteinDistance(normalizedQuery, normalizedCandidate)
    const similarity = distance / Math.max(normalizedQuery.length, normalizedCandidate.length)
    if (similarity <= 0.32) {
      bestScore = Math.min(bestScore, 3.5 + similarity)
    }
  }

  return bestScore
}

function scoreProfessionalSearch(user: SeedUser, query: string): number {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return 0
  }

  const candidates = [
    user.fullName,
    user.specialty,
    user.username,
    ...(user.networkMemberships ?? []),
  ]
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeSearchText(candidate)
    if (!normalizedCandidate) {
      continue
    }
    if (normalizedCandidate === normalizedQuery) {
      return 0
    }
    if (normalizedCandidate.startsWith(normalizedQuery)) {
      bestScore = Math.min(bestScore, 1)
    }
    if (normalizedCandidate.includes(normalizedQuery)) {
      bestScore = Math.min(bestScore, 2)
    }

    for (const word of normalizedCandidate.split(/\s+/)) {
      if (!word) {
        continue
      }
      if (word.startsWith(normalizedQuery)) {
        bestScore = Math.min(bestScore, 1.2)
      }
      const distance = levenshteinDistance(normalizedQuery, word)
      const similarity = distance / Math.max(normalizedQuery.length, word.length)
      if (similarity <= 0.34) {
        bestScore = Math.min(bestScore, 3 + similarity)
      }
    }

    const distance = levenshteinDistance(normalizedQuery, normalizedCandidate)
    const similarity = distance / Math.max(normalizedQuery.length, normalizedCandidate.length)
    if (similarity <= 0.32) {
      bestScore = Math.min(bestScore, 3.5 + similarity)
    }
  }

  return bestScore
}

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

function excelDateToIso(value: unknown): string {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      const month = String(parsed.m).padStart(2, '0')
      const day = String(parsed.d).padStart(2, '0')
      return `${parsed.y}-${month}-${day}`
    }
  }

  const text = asText(value)
  if (!text) {
    return ''
  }

  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (slashDate) {
    const day = slashDate[1].padStart(2, '0')
    const month = slashDate[2].padStart(2, '0')
    const year = slashDate[3]
    return `${year}-${month}-${day}`
  }

  const nativeDate = new Date(text)
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate.toISOString().slice(0, 10)
  }
  return ''
}

function mapDictationError(errorCode?: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permiso de micrófono denegado. Habilítalo en el navegador y vuelve a intentar.'
    case 'audio-capture':
      return 'No se detectó micrófono disponible.'
    case 'network':
      return 'El servicio de voz no respondió (error de red). Reintenta en unos segundos.'
    case 'no-speech':
      return 'No se detectó voz. Verifica volumen del micrófono y vuelve a intentar.'
    case 'aborted':
      return 'El dictado fue cancelado.'
    default:
      return 'No se pudo continuar con el dictado por voz.'
  }
}

function setupSignatureCanvas(
  canvas: HTMLCanvasElement,
  signatureImageDataUrl?: string,
): Promise<boolean> {
  const context = canvas.getContext('2d')
  if (!context) {
    return Promise.resolve(false)
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.lineWidth = 2.2
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = '#0f172a'

  if (!signatureImageDataUrl) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(true)
    }
    image.onerror = () => resolve(false)
    image.src = signatureImageDataUrl
  })
}

function normalizeBirthDate(value: string): string {
  const text = value.trim()
  if (!text) {
    return ''
  }

  const normalizeDateParts = (year: number, month: number, day: number): string => {
    const dayText = String(day).padStart(2, '0')
    const monthText = String(month).padStart(2, '0')
    const date = new Date(year, month - 1, day)
    if (Number.isNaN(date.getTime())) {
      return ''
    }
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return ''
    }
    return `${year}-${monthText}-${dayText}`
  }

  const isoDate = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text)
  if (isoDate) {
    const year = Number(isoDate[1])
    const month = Number(isoDate[2])
    const day = Number(isoDate[3])
    return normalizeDateParts(year, month, day)
  }

  const slashDate = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(text)
  if (slashDate) {
    const day = Number(slashDate[1])
    const month = Number(slashDate[2])
    const year = Number(slashDate[3])
    return normalizeDateParts(year, month, day)
  }

  const compactYmd = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (compactYmd) {
    const year = Number(compactYmd[1])
    const month = Number(compactYmd[2])
    const day = Number(compactYmd[3])
    return normalizeDateParts(year, month, day)
  }

  const compactDmy = /^(\d{2})(\d{2})(\d{4})$/.exec(text)
  if (compactDmy) {
    const day = Number(compactDmy[1])
    const month = Number(compactDmy[2])
    const year = Number(compactDmy[3])
    return normalizeDateParts(year, month, day)
  }

  const compactDmySingle = /^(\d{1,2})(\d{1,2})(\d{4})$/.exec(text)
  if (compactDmySingle) {
    const day = Number(compactDmySingle[1])
    const month = Number(compactDmySingle[2])
    const year = Number(compactDmySingle[3])
    return normalizeDateParts(year, month, day)
  }

  return ''
}

function extractLineValue(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return ''
}

function normalizeScannedName(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function tokenizeScannedBarcode(value: string): string[] {
  return value
    .replace(/[\u0000-\u001f]+/g, '\n')
    .replace(/\r/g, '\n')
    .split(/[@\n;|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function isCompactDateDigits(value: string): boolean {
  if (!/^\d{8}$/.test(value)) {
    return false
  }
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  return year >= 1900 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

function parseMrzShortDate(value: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(value)
  if (!match) {
    return ''
  }
  const yy = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return ''
  }
  const currentYear = new Date().getFullYear() % 100
  const century = yy > currentYear ? 1900 : 2000
  const year = century + yy
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return ''
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseDniFromMrz(rawValue: string): Partial<PatientDraft> {
  const normalized = rawValue.replace(/\r/g, '\n')
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const extracted: Partial<PatientDraft> = {}

  const line1 = lines.find((line) => /^IDARG\d{8}/.test(line))
  if (line1) {
    const match = /^IDARG(\d{8})/.exec(line1)
    if (match?.[1]) {
      extracted.dni = match[1]
    }
  }

  const line2 = lines.find((line) => /^\d{6}[MF<]\d{6}/.test(line))
  if (line2) {
    const match = /^(\d{6})([MF<])(\d{6})/.exec(line2)
    if (match) {
      const birthDate = parseMrzShortDate(match[1])
      if (birthDate) {
        extracted.birthDate = birthDate
      }
    }
  }

  const line3 = lines.find((line) => line.includes('<<'))
  if (line3) {
    const [apellidoRaw, nombresRaw = ''] = line3.split('<<')
    const apellido = apellidoRaw.replace(/</g, ' ').trim()
    const nombre = nombresRaw.replace(/</g, ' ').trim()
    if (apellido) {
      extracted.apellido = normalizeScannedName(apellido)
    }
    if (nombre) {
      extracted.nombre = normalizeScannedName(nombre)
    }
  }

  return extracted
}

function extractLikelyDniFromRaw(rawValue: string): string {
  const numericTokens = tokenizeScannedBarcode(rawValue)
    .map((token) => token.replace(/[^\d]/g, ''))
    .filter((token) => token.length >= 7 && token.length <= 10)

  const candidates = numericTokens.filter((token) => !isCompactDateDigits(token.slice(0, 8)))
  const best = candidates.find((token) => token.length === 8) ?? candidates[0] ?? ''
  if (best.length === 9) {
    return best.slice(0, 8)
  }
  return best.slice(0, 9)
}

async function fileToImageElement(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image()
      candidate.onload = () => resolve(candidate)
      candidate.onerror = () => reject(new Error(`No se pudo cargar la imagen: ${file.name}`))
      candidate.src = objectUrl
    })
    return image
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function detectBarcodesFromImage(
  file: File,
  formats: BarcodeFormat[],
): Promise<DetectedBarcode[]> {
  const detectorCtor = window.BarcodeDetector
  if (!detectorCtor) {
    throw new Error('Tu navegador no soporta escaneo automático de códigos (BarcodeDetector).')
  }
  const image = await fileToImageElement(file)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('No se pudo preparar la imagen para escanear códigos.')
  }
  context.drawImage(image, 0, 0)
  const detector = new detectorCtor({ formats })
  return detector.detect(canvas)
}

function buildRotatedImageDataUrls(image: HTMLImageElement): string[] {
  const dataUrls: string[] = []
  const rotations = [0, 90, 180, 270]
  for (const degrees of rotations) {
    const radians = (degrees * Math.PI) / 180
    const swapSides = degrees === 90 || degrees === 270
    const width = swapSides ? image.naturalHeight : image.naturalWidth
    const height = swapSides ? image.naturalWidth : image.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      continue
    }
    context.translate(width / 2, height / 2)
    context.rotate(radians)
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    dataUrls.push(canvas.toDataURL('image/jpeg', 0.94))
  }
  return dataUrls
}

function hasParsedDniData(parsed: Partial<PatientDraft>): boolean {
  return Boolean(parsed.nombre || parsed.apellido || parsed.dni || parsed.birthDate)
}

async function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo cargar la imagen para analizarla.'))
    image.src = dataUrl
  })
}

async function parseDniFromImageUrlWithZxing(source: string): Promise<Partial<PatientDraft> | null> {
  const reader = new BrowserPDF417Reader()
  try {
    const image = await imageFromDataUrl(source)
    const result = await reader.decodeFromImageElement(image)
    const rawText =
      result && typeof result === 'object' && 'getText' in result && typeof result.getText === 'function'
        ? result.getText()
        : ''
    const parsed = parseDniFromBarcode(rawText)
    return hasParsedDniData(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function parseDniFromFileWithZxing(file: File): Promise<Partial<PatientDraft> | null> {
  const image = await fileToImageElement(file)
  const candidates = buildRotatedImageDataUrls(image)
  for (const candidate of candidates) {
    const parsed = await parseDniFromImageUrlWithZxing(candidate)
    if (parsed) {
      return parsed
    }
  }
  return null
}

async function parseQrFromImageUrlWithZxing(source: string): Promise<Partial<PatientDraft> | null> {
  const reader = new BrowserQRCodeReader()
  try {
    const image = await imageFromDataUrl(source)
    const result = await reader.decodeFromImageElement(image)
    const rawText =
      result && typeof result === 'object' && 'getText' in result && typeof result.getText === 'function'
        ? result.getText()
        : ''
    const parsed = parseInsuranceFromQr(rawText)
    return parsed.obraSocial || parsed.numeroAfiliado || parsed.plan ? parsed : null
  } catch {
    return null
  }
}

async function parseInsuranceFromFileWithZxing(file: File): Promise<Partial<PatientDraft> | null> {
  const image = await fileToImageElement(file)
  const candidates = buildRotatedImageDataUrls(image)
  for (const candidate of candidates) {
    const parsed = await parseQrFromImageUrlWithZxing(candidate)
    if (parsed) {
      return parsed
    }
  }
  return null
}

function parseDniFromBarcode(rawValue: string): Partial<PatientDraft> {
  const normalized = rawValue.replace(/\r/g, '\n').trim()
  const extracted: Partial<PatientDraft> = {}

  // --- Formato PDF417 del DNI argentino actual ---
  // El PDF417 del DNI argentino codifica los datos separados por '@'
  // Formato nuevo (DNI plastificado desde ~2009):
  //   @APELLIDO@NOMBRE@SEXO@DNI@TRAMITE@FECHANAC@VENCIMIENTO@...
  // El primer token puede ser vacío (empieza con @), por eso se filtra.
  if (normalized.includes('@')) {
    const rawTokens = normalized.split('@')
    // Limpiar tokens vacíos al inicio pero conservar posición relativa
    const tokens = rawTokens.map((t) => t.trim())

    // Buscar el índice del DNI (8 dígitos) en los tokens
    const dniIdx = tokens.findIndex((t) => /^\d{7,9}$/.test(t))
    if (dniIdx >= 2) {
      // En el formato estándar: ...@APELLIDO@NOMBRE@SEXO@DNI@TRAMITE@FECHANAC@...
      // SEXO es justo antes del DNI (M/F), NOMBRE dos antes, APELLIDO tres antes
      const beforeDni = tokens.slice(0, dniIdx).filter((t) => t.length > 0)
      const sexoIdx = beforeDni.findLastIndex((t) => /^[MFmf]$/.test(t))
      if (sexoIdx >= 2) {
        // beforeDni[sexoIdx-2] = apellido, beforeDni[sexoIdx-1] = nombre
        const maybeApellido = beforeDni[sexoIdx - 2] ?? ''
        const maybeNombre = beforeDni[sexoIdx - 1] ?? ''
        if (!extracted.apellido && /^[A-ZÁÉÍÓÚÜÑ ]{2,}$/i.test(maybeApellido)) {
          extracted.apellido = normalizeScannedName(maybeApellido)
        }
        if (!extracted.nombre && /^[A-ZÁÉÍÓÚÜÑ ]{2,}$/i.test(maybeNombre)) {
          extracted.nombre = normalizeScannedName(maybeNombre)
        }
      } else if (beforeDni.length >= 2) {
        // Sin sexo encontrado: tomar los dos últimos textos antes del DNI como nombre/apellido
        const textBefore = beforeDni.filter((t) => /^[A-ZÁÉÍÓÚÜÑ ]{2,}$/i.test(t))
        if (!extracted.apellido && textBefore.length >= 1) {
          extracted.apellido = normalizeScannedName(textBefore[textBefore.length - 2] ?? textBefore[0])
        }
        if (!extracted.nombre && textBefore.length >= 2) {
          extracted.nombre = normalizeScannedName(textBefore[textBefore.length - 1])
        }
      }
      if (!extracted.dni) {
        extracted.dni = tokens[dniIdx].replace(/[^\d]/g, '').slice(0, 9)
      }
      // Fecha de nacimiento: primer token de 8 dígitos DESPUÉS del DNI que sea fecha válida
      const afterDni = tokens.slice(dniIdx + 1)
      for (const t of afterDni) {
        const digits = t.replace(/[^\d]/g, '')
        if (digits.length === 8) {
          const candidate = normalizeBirthDate(digits)
          if (candidate) {
            extracted.birthDate = candidate
            break
          }
        }
        // También intentar formato dd/mm/yyyy o similares
        const withSlashes = t.replace(/[.\-]/g, '/')
        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(withSlashes)) {
          const candidate = normalizeBirthDate(t)
          if (candidate) {
            extracted.birthDate = candidate
            break
          }
        }
      }
      // Dirección: a veces viene después del vencimiento como texto libre
      const afterBirth = afterDni.slice(afterDni.findIndex((t) => {
        const d = t.replace(/[^\d]/g, ''); return d.length === 8 && !!normalizeBirthDate(d)
      }) + 1)
      const addressCandidate = afterBirth.find((t) => t.length > 5 && /[A-Za-z]/.test(t) && /\d/.test(t))
      if (!extracted.direccion && addressCandidate) {
        extracted.direccion = addressCandidate.trim()
      }
    }
  }

  // --- Parseo por claves explícitas (algunos lectores emiten texto con labels) ---
  const apellidoByKey = extractLineValue(normalized, [/(?:^|\n)\s*apellido\s*[:=]\s*([^\n]+)/i])
  const nombreByKey = extractLineValue(normalized, [/(?:^|\n)\s*nombre\s*[:=]\s*([^\n]+)/i])
  const dniByKey = extractLineValue(normalized, [
    /(?:^|\n)\s*(?:dni|documento|nrodoc|numero\s*de\s*documento)\s*[:=]?\s*([^\n]+)/i,
  ])
  const birthByKey = extractLineValue(normalized, [
    /(?:^|\n)\s*(?:fecha\s*de\s*nacimiento|fechanacimiento|nacimiento)\s*[:=]?\s*([^\n]+)/i,
  ])
  if (apellidoByKey) extracted.apellido = normalizeScannedName(apellidoByKey)
  if (nombreByKey) extracted.nombre = normalizeScannedName(nombreByKey)
  if (dniByKey) extracted.dni = dniByKey.replace(/[^\d]/g, '')
  if (birthByKey) extracted.birthDate = normalizeBirthDate(birthByKey)

  // --- MRZ (pasaporte/DNI chip) ---
  const mrzParsed = parseDniFromMrz(normalized)
  if (!extracted.apellido && mrzParsed.apellido) extracted.apellido = mrzParsed.apellido
  if (!extracted.nombre && mrzParsed.nombre) extracted.nombre = mrzParsed.nombre
  if (!extracted.dni && mrzParsed.dni) extracted.dni = mrzParsed.dni
  if (!extracted.birthDate && mrzParsed.birthDate) extracted.birthDate = mrzParsed.birthDate

  // --- Fallback genérico si todavía faltan datos ---
  if (!extracted.apellido || !extracted.nombre || !extracted.dni) {
    const atTokens = tokenizeScannedBarcode(normalized)
    const textTokens = atTokens.filter(
      (token) => /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ ]+$/i.test(token) && !(/^[MFmf]$/.test(token)) && !/\d/.test(token),
    )
    if (!extracted.apellido && textTokens[0]) extracted.apellido = normalizeScannedName(textTokens[0])
    if (!extracted.nombre && textTokens[1]) extracted.nombre = normalizeScannedName(textTokens[1])
    if (!extracted.dni) {
      const dniToken = atTokens.find((t) => /^\d{7,9}$/.test(t.replace(/[^\d]/g, '')))
      if (dniToken) extracted.dni = dniToken.replace(/[^\d]/g, '').slice(0, 9)
    }
    if (!extracted.birthDate) {
      const dateToken = atTokens.find((t) => normalizeBirthDate(t))
      if (dateToken) extracted.birthDate = normalizeBirthDate(dateToken)
    }
    if (!extracted.dni) extracted.dni = extractLikelyDniFromRaw(normalized)
  }

  // Deduplicar nombre = apellido
  if (extracted.apellido && extracted.nombre && extracted.apellido === extracted.nombre) {
    const atTokens = tokenizeScannedBarcode(normalized)
    const textTokens = atTokens
      .filter((t) => /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ ]+$/i.test(t) && !/\d/.test(t))
      .map((t) => normalizeScannedName(t))
      .filter((t) => t && t !== extracted.apellido)
    if (textTokens.length >= 2) {
      extracted.apellido = textTokens[0]
      extracted.nombre = textTokens[1]
    }
  }

  return extracted
}

function parseInsuranceFromQr(rawValue: string): Partial<PatientDraft> {
  const normalized = rawValue.replace(/\r/g, '\n').trim()
  const extracted: Partial<PatientDraft> = {}

  // --- QR de URL (algunos sistemas emiten una URL con parámetros) ---
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized)
      for (const [key, value] of parsedUrl.searchParams.entries()) {
        const normalizedKey = normalizeHeader(key)
        if (!extracted.obraSocial && /obrasocial|cobertura|seguro|prestador|aseguradora/.test(normalizedKey)) {
          extracted.obraSocial = value.trim()
        } else if (!extracted.numeroAfiliado && /afiliado|nrosocio|socio|credencial|afiliacion|poliza|member/.test(normalizedKey)) {
          extracted.numeroAfiliado = value.trim()
        } else if (!extracted.plan && /plan|producto|categoria|programa/.test(normalizedKey)) {
          extracted.plan = value.trim()
        } else if (!extracted.nombre && /nombre|name/.test(normalizedKey)) {
          extracted.nombre = normalizeScannedName(value.trim())
        } else if (!extracted.apellido && /apellido|surname|lastname/.test(normalizedKey)) {
          extracted.apellido = normalizeScannedName(value.trim())
        } else if (!extracted.dni && /\bdni\b|documento|cedula/.test(normalizedKey)) {
          extracted.dni = value.replace(/[^\d]/g, '')
        }
      }
    } catch { /* no es URL válida */ }
  }

  // --- QR de PAMI / IOMA / OSDE y similares: texto plano con claves ---
  // Formato típico PAMI: "APELLIDO NOMBRE\nDNI: 12345678\nN° AFILIADO: 123456789\nPLAN: PAMI-..."
  // Algunos usan separadores distintos o todo en una línea.

  // Detectar "PAMI" u otras obras sociales conocidas en el texto
  const pamiMatch = /\bPAMI\b/i.exec(normalized)
  const iomaMatch = /\bIOMA\b/i.exec(normalized)
  const osdeMatch = /\bOSDE\b/i.exec(normalized)
  const swissMatch = /\bSWISS\s*MEDICAL\b/i.exec(normalized)
  const galiciaMatch = /\bGALENO\b/i.exec(normalized)
  const medifexMatch = /\bMEDIFEX\b/i.exec(normalized)
  const osaMatch = /\bOSA\b|\bOBRA\s*SOCIAL\s*DE\s*ABOGADOS\b/i.exec(normalized)

  if (!extracted.obraSocial) {
    if (pamiMatch) extracted.obraSocial = 'PAMI'
    else if (iomaMatch) extracted.obraSocial = 'IOMA'
    else if (osdeMatch) extracted.obraSocial = 'OSDE'
    else if (swissMatch) extracted.obraSocial = 'Swiss Medical'
    else if (galiciaMatch) extracted.obraSocial = 'Galeno'
    else if (medifexMatch) extracted.obraSocial = 'Medifex'
    else if (osaMatch) extracted.obraSocial = 'OSA'
  }

  // Parseo por claves explícitas
  if (!extracted.obraSocial) {
    extracted.obraSocial =
      extractLineValue(normalized, [
        /(?:^|\n)\s*(?:obra\s*social|prestador|cobertura|seguro|empresa)\s*[:=]\s*([^\n;|,]+)/i,
      ]) ?? undefined
  }
  if (!extracted.numeroAfiliado) {
    extracted.numeroAfiliado =
      extractLineValue(normalized, [
        /(?:n[°uo]?\.?\s*afiliad[oa]|afiliad[oa]|nro\.?\s*socio|socio|credencial|beneficiario)\s*[:=]?\s*([A-Z0-9\-/.]+)/i,
        /\b(\d{9,12})\b/,  // algunos QR sólo contienen el número de afiliado como secuencia larga de dígitos
      ]) ?? undefined
  }
  if (!extracted.plan) {
    extracted.plan =
      extractLineValue(normalized, [
        /(?:^|\n)\s*(?:plan|producto|categoria|cobertura)\s*[:=]\s*([^\n;|,]+)/i,
      ]) ?? undefined
  }

  // Intentar extraer nombre y apellido del titular si están en el QR
  if (!extracted.apellido || !extracted.nombre) {
    const apellidoKey = extractLineValue(normalized, [/(?:^|\n)\s*apellido\s*[:=]\s*([^\n]+)/i])
    const nombreKey = extractLineValue(normalized, [/(?:^|\n)\s*nombre\s*[:=]\s*([^\n]+)/i])
    if (apellidoKey && !extracted.apellido) extracted.apellido = normalizeScannedName(apellidoKey)
    if (nombreKey && !extracted.nombre) extracted.nombre = normalizeScannedName(nombreKey)
  }

  // Intentar extraer DNI del titular
  if (!extracted.dni) {
    const dniKey =
      extractLineValue(normalized, [
        /(?:dni|doc\.?|documento)\s*[:=]?\s*(\d{7,9})/i,
      ]) ?? undefined
    if (dniKey) extracted.dni = dniKey.replace(/[^\d]/g, '')
  }

  // Si el número de afiliado es demasiado corto (≤6 dígitos), podría ser el DNI
  if (extracted.numeroAfiliado && !extracted.dni && /^\d{7,9}$/.test(extracted.numeroAfiliado)) {
    extracted.dni = extracted.numeroAfiliado
    extracted.numeroAfiliado = undefined
  }

  return {
    obraSocial: extracted.obraSocial?.trim() || undefined,
    numeroAfiliado: extracted.numeroAfiliado?.trim() || undefined,
    plan: extracted.plan?.trim() || undefined,
    nombre: extracted.nombre || undefined,
    apellido: extracted.apellido || undefined,
    dni: extracted.dni || undefined,
  }
}

function captureScanFrame(video: HTMLVideoElement, label: string): StoredFile | null {
  if (!video.videoWidth || !video.videoHeight) {
    return null
  }
  const maxWidth = 1280
  const scale = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1
  const targetWidth = Math.max(1, Math.round(video.videoWidth * scale))
  const targetHeight = Math.max(1, Math.round(video.videoHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  context.drawImage(video, 0, 0, targetWidth, targetHeight)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  return {
    id: crypto.randomUUID(),
    name: `${label}-${Date.now()}.jpg`,
    type: 'image/jpeg',
    size: Math.round((dataUrl.length * 3) / 4),
    dataUrl,
    uploadedAt: new Date().toISOString(),
  }
}

function extractPatientSuggestionsFromText(text: string): {
  patientDraft: Partial<PatientDraft>
  consultationDraft: Partial<ConsultationDraft>
} {
  const fullName = extractLineValue(text, [
    /(?:^|\n)\s*(?:nombre\s*y\s*apellido|paciente)\s*[:\-]\s*([^\n\r]+)/i,
  ])
  const nombre = extractLineValue(text, [/(?:^|\n)\s*nombre\s*[:\-]\s*([^\n\r]+)/i])
  const apellido = extractLineValue(text, [/(?:^|\n)\s*apellido\s*[:\-]\s*([^\n\r]+)/i])
  const dniRaw = extractLineValue(text, [/(?:^|\n)\s*dni\s*[:\-]?\s*([^\n\r]+)/i])
  const birthRaw = extractLineValue(text, [
    /(?:^|\n)\s*(?:fecha\s*de\s*nacimiento|nacimiento)\s*[:\-]\s*([^\n\r]+)/i,
  ])

  let parsedNombre = nombre
  let parsedApellido = apellido
  if ((!parsedNombre || !parsedApellido) && fullName) {
    const tokens = fullName.split(/\s+/).filter(Boolean)
    if (tokens.length >= 2) {
      parsedNombre = parsedNombre || tokens[0]
      parsedApellido = parsedApellido || tokens.slice(1).join(' ')
    }
  }

  return {
    patientDraft: {
      nombre: parsedNombre,
      apellido: parsedApellido,
      dni: dniRaw.replace(/[^\d]/g, ''),
      obraSocial: extractLineValue(text, [/(?:^|\n)\s*obra\s*social\s*[:\-]\s*([^\n\r]+)/i]),
      numeroAfiliado: extractLineValue(text, [
        /(?:^|\n)\s*(?:n(?:u|ú|°|ro)?\.?\s*afiliad[oa]|afiliad[oa]|nro\s*socio)\s*[:\-]\s*([^\n\r]+)/i,
      ]),
      plan: extractLineValue(text, [/(?:^|\n)\s*plan\s*[:\-]\s*([^\n\r]+)/i]),
      birthDate: normalizeBirthDate(birthRaw),
      patologiasConocidas: extractLineValue(text, [
        /(?:^|\n)\s*patolog(?:i|í)as?\s*conocidas?\s*[:\-]\s*([^\n\r]+)/i,
      ]),
      patologiasCronicas: extractLineValue(text, [
        /(?:^|\n)\s*patolog(?:i|í)as?\s*cr[oó]nicas?\s*[:\-]\s*([^\n\r]+)/i,
      ]),
      ultimaInternacion: extractLineValue(text, [
        /(?:^|\n)\s*[uú]ltima\s*internaci[oó]n\s*[:\-]\s*([^\n\r]+)/i,
      ]),
      cirugiasPrevias: extractLineValue(text, [/(?:^|\n)\s*cirug(?:i|í)as?\s*previas?\s*[:\-]\s*([^\n\r]+)/i]),
    },
    consultationDraft: {
      motivoConsulta: extractLineValue(text, [
        /(?:^|\n)\s*motivo\s*de\s*consulta\s*[:\-]\s*([^\n\r]+)/i,
      ]),
      detalleAtencion: extractLineValue(text, [
        /(?:^|\n)\s*(?:enfermedad\s*actual|resumen\s*de\s*atenci[oó]n)\s*[:\-]\s*([^\n\r]+)/i,
      ]),
      pensamientoMedico: extractLineValue(text, [
        /(?:^|\n)\s*pensamiento\s*m[eé]dico\s*[:\-]\s*([^\n\r]+)/i,
      ]),
    },
  }
}

function App() {
  const [seedUsers, setSeedUsers] = useState<SeedUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [appError, setAppError] = useState<string | null>(null)
  const [appNotice, setAppNotice] = useState<string | null>(null)
  const [floatingNotice, setFloatingNotice] = useState<string | null>(null)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [showInstallToast, setShowInstallToast] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_MODE_KEY)
    return stored === 'night' ? 'night' : 'light'
  })
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerDraft, setRegisterDraft] = useState<RegisterDraft>(emptyRegisterDraft)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryRequested, setRecoveryRequested] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryDemoCode, setRecoveryDemoCode] = useState<string | null>(null)
  const [activeUserId, setActiveUserId] = useState<string | null>(null)
  const [googleIdentity, setGoogleIdentity] = useState<{
    email: string
    avatarUrl?: string
    fullName?: string
  } | null>(null)
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null)
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [availablePatients, setAvailablePatients] = useState<PatientRecord[]>([])
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [patientSearchQuery, setPatientSearchQuery] = useState('')
  const [diagnosisCatalog, setDiagnosisCatalog] = useState<string[]>([])
  const [specialtyCatalog, setSpecialtyCatalog] = useState<string[]>([])
  const [medicationCatalog, setMedicationCatalog] = useState<MedicationEntry[]>([])
  const [medicalNews, setMedicalNews] = useState<MedicalNewsItem[]>([])
  const [medicalNewsLoading, setMedicalNewsLoading] = useState(false)
  const [currentMedicalNewsIndex, setCurrentMedicalNewsIndex] = useState(0)
  const [vademecumSearchQuery, setVademecumSearchQuery] = useState('')
  const [selectedMedicationId, setSelectedMedicationId] = useState<string | null>(null)

  const [patientDraft, setPatientDraft] = useState<PatientDraft>(emptyPatientDraft)
  const [patientFormUnlocked, setPatientFormUnlocked] = useState(true)
  const [consultationDraft, setConsultationDraft] =
    useState<ConsultationDraft>(emptyConsultationDraft)
  const consultationDiagnosisVisibleList = useMemo(
    () => buildDiagnosisSuggestions(diagnosisCatalog, consultationDraft.motivoConsulta, 10),
    [consultationDraft.motivoConsulta, diagnosisCatalog],
  )
  const [communityOpen, setCommunityOpen] = useState(false)
  const [communityTargetId, setCommunityTargetId] = useState<string | null>(null)
  const [communitySearchQuery, setCommunitySearchQuery] = useState('')
  const [communityNetworkFilters, setCommunityNetworkFilters] = useState<string[]>([])
  const [communityDraftText, setCommunityDraftText] = useState('')
  const [communityDraftFiles, setCommunityDraftFiles] = useState<StoredFile[]>([])
  const [communityDragActive, setCommunityDragActive] = useState(false)
  const [communityMessages, setCommunityMessages] = useState<CommunityMessage[]>([])
  const [communitySeenIds, setCommunitySeenIds] = useState<string[]>([])
  const [communityUnreadCount, setCommunityUnreadCount] = useState(0)
  const [communityUnreadByMember, setCommunityUnreadByMember] = useState<
    Record<string, number>
  >({})
  const [workspaceLayer, setWorkspaceLayer] = useState<WorkspaceLayer>('overview')
  const [dictationAvailable, setDictationAvailable] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [dictationField, setDictationField] = useState<DictationConsultationField | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const dictationBaseTextRef = useRef('')
  const dictationCommittedTextRef = useRef('')
  const dictationHadErrorRef = useRef(false)
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const signatureDrawingRef = useRef(false)
  const signatureHasStrokeRef = useRef(false)
  const floatingTimerRef = useRef<number | null>(null)
  const lastCommunityNotifiedAtRef = useRef<string>('')
  const [liveScanTarget, setLiveScanTarget] = useState<LiveScanTarget | null>(null)
  const [liveScanStatus, setLiveScanStatus] = useState('')
  const liveScanVideoRef = useRef<HTMLVideoElement | null>(null)
  const liveScanStreamRef = useRef<MediaStream | null>(null)
  const liveScanRafRef = useRef<number | null>(null)
  const liveScanSessionRef = useRef(0)
  const liveDecodeBusyRef = useRef(false)
  const lastLiveDetectedRawRef = useRef('')
  const lastLiveDetectedAtRef = useRef(0)
  const [ambulanceDraft, setAmbulanceDraft] = useState<AmbulanceDraft>({ qth: '', destino: '', diagnosticoCie10: '', diagnosticoFinal: '' })
  const [ambulanceDictating, setAmbulanceDictating] = useState(false)
  const ambulanceDictationRef = useRef<BrowserSpeechRecognition | null>(null)
  const [ambulancePatientSearch, setAmbulancePatientSearch] = useState('')
  const [ambulanceSelectedPatientId, setAmbulanceSelectedPatientId] = useState<string | null>(null)
  const [ambulanceNewPatient, setAmbulanceNewPatient] = useState<{ nombre: string; apellido: string; dni: string } | null>(null)
  const [previewTrialExpired, setPreviewTrialExpired] = useState(false)
  const [subscriptionCheckoutLoading, setSubscriptionCheckoutLoading] = useState<SubscriptionPlan | null>(null)
  const [adminBusyUserId, setAdminBusyUserId] = useState<string | null>(null)
  const [adminArchivedUsers, setAdminArchivedUsers] = useState<DeletedUserArchiveRecord[]>([])
  const [loadingAdminArchives, setLoadingAdminArchives] = useState(false)
  const [passwordChangeDraft, setPasswordChangeDraft] = useState({
    newPassword: '',
    confirmPassword: '',
  })
  const processedCheckoutReturnRef = useRef<string | null>(null)
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>(() => getNotificationPermission())
  const [showNotificationToast, setShowNotificationToast] = useState(false)
  const [adminBroadcastSubject, setAdminBroadcastSubject] = useState('')
  const [adminBroadcastBody, setAdminBroadcastBody] = useState('')
  const [adminBroadcastSending, setAdminBroadcastSending] = useState(false)

  // --- Trial / Suscripción ---
  const trialInfo = useMemo(() => {
    const TRIAL_DAYS = 14
    const TRIAL_PATIENTS = 15
    const user = seedUsers.find((u) => u.id === activeUserId)
    if (!user) return null
    if (user.isAdmin) {
      return {
        status: 'admin' as const,
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
        const millisecondsLeft = new Date(user.subscriptionExpiresAt).getTime() - Date.now()
        const daysLeft = Math.max(0, Math.ceil(millisecondsLeft / DAY_IN_MS))
        const expired = millisecondsLeft <= 0
        return {
          status: expired ? ('expired' as const) : ('active' as const),
          daysLeft,
          patientsLeft: Infinity,
          expired,
          expiredByTime: false,
          expiredByPatients: false,
          expiredBySubscription: expired,
        }
      }
      return {
        status: 'active' as const,
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
        status: 'expired' as const,
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
        status: 'legacy' as const,
        daysLeft: Infinity,
        patientsLeft: Infinity,
        expired: false,
        expiredByTime: false,
        expiredByPatients: false,
        expiredBySubscription: false,
      }
    }

    const daysPassed = Math.floor((Date.now() - new Date(user.trialStartedAt).getTime()) / DAY_IN_MS)
    const daysLeft = Math.max(0, TRIAL_DAYS - daysPassed)

    // Contar solo los pacientes propios del usuario
    const ownPatientCount = patients.filter((p) => p.ownerUserId === activeUserId).length
    const patientsLeft = Math.max(0, TRIAL_PATIENTS - ownPatientCount)

    const expiredByTime = daysPassed >= TRIAL_DAYS
    const expiredByPatients = ownPatientCount >= TRIAL_PATIENTS
    const expired = expiredByTime || expiredByPatients

    return {
      status: expired ? ('expired' as const) : ('trial' as const),
      daysLeft,
      patientsLeft,
      ownPatientCount,
      expiredByTime,
      expiredByPatients,
      expiredBySubscription: false,
      expired,
    }
  }, [seedUsers, activeUserId, patients])

  const activeUser = useMemo(
    () => seedUsers.find((user) => user.id === activeUserId) ?? null,
    [seedUsers, activeUserId],
  )
  const isAdminSession = isAdminUser(activeUser)
  const ambulanceRecentPatients = useMemo(() => {
    const normalizedLicense = profile?.licenseNumber.trim().toLowerCase() ?? ''
    const normalizedFullName = profile?.fullName.trim().toLowerCase() ?? ''

    if (!normalizedLicense && !normalizedFullName) {
      return []
    }

    return patients
      .map((patient) => {
        const latestAmbulanceConsultation =
          patient.consultations
            .filter((entry) => {
              if (!isAmbulanceConsultation(entry)) {
                return false
              }

              const entryLicense = entry.professionalSignature.licenseNumber.trim().toLowerCase()
              const entryFullName = entry.professionalSignature.fullName.trim().toLowerCase()
              return (
                (normalizedLicense && entryLicense === normalizedLicense) ||
                (normalizedFullName && entryFullName === normalizedFullName)
              )
            })
            .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0] ?? null

        if (!latestAmbulanceConsultation) {
          return null
        }

        return {
          patient,
          consultation: latestAmbulanceConsultation,
        }
      })
      .filter(
        (
          entry,
        ): entry is {
          patient: PatientRecord
          consultation: ConsultationEntry
        } => Boolean(entry),
      )
      .sort(
        (left, right) =>
          Date.parse(right.consultation.date) - Date.parse(left.consultation.date) ||
          left.patient.apellido.localeCompare(right.patient.apellido, 'es'),
      )
  }, [patients, profile?.fullName, profile?.licenseNumber])
  const registerSpecialtySuggestions = useMemo(
    () => buildStringSuggestions(specialtyCatalog, registerDraft.specialty, 8),
    [specialtyCatalog, registerDraft.specialty],
  )
  const profileSpecialtySuggestions = useMemo(
    () => buildStringSuggestions(specialtyCatalog, profile?.specialty ?? '', 8),
    [specialtyCatalog, profile?.specialty],
  )
  const filteredMedicationCatalog = useMemo(() => {
    const normalizedQuery = normalizeSearchText(vademecumSearchQuery)
    if (normalizedQuery.length < VADEMECUM_MIN_QUERY_LENGTH) {
      return []
    }

    return medicationCatalog
      .map((entry) => {
        const candidates = [entry.brand, entry.drug, entry.presentation, entry.laboratory]
        let score = Number.POSITIVE_INFINITY
        for (const candidate of candidates) {
          if (!candidate) {
            continue
          }
          score = Math.min(score, scoreDiagnosisSuggestion(candidate, vademecumSearchQuery))
        }
        return { entry, score }
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort(
        (left, right) =>
          left.score - right.score ||
          (left.entry.brand || left.entry.drug).localeCompare(right.entry.brand || right.entry.drug, 'es'),
      )
      .slice(0, VADEMECUM_MAX_SUGGESTIONS)
      .map((entry) => entry.entry)
  }, [medicationCatalog, vademecumSearchQuery])
  const selectedMedication = useMemo(
    () => medicationCatalog.find((entry) => entry.id === selectedMedicationId) ?? null,
    [medicationCatalog, selectedMedicationId],
  )

  function loadAccessiblePatientsForUser(userId: string): {
    patientsList: PatientRecord[]
    availablePatientsList: PatientRecord[]
  } {
    const ownerIndex = readJsonStorage<string[]>(patientIndexStorageKey(userId), [])
    const knownIds = new Set<string>([
      ...ownerIndex,
      ...readJsonStorage<string[]>(PATIENT_REGISTRY_KEY, []),
    ])

    for (const patientId of ownerIndex) {
      const legacyKey = patientStorageKey(userId, patientId)
      const legacyRecord = readJsonStorage<PatientRecord | null>(legacyKey, null)
      if (!legacyRecord) {
        continue
      }
      const migratedRecord: PatientRecord = {
        ...legacyRecord,
        ownerUserId: legacyRecord.ownerUserId || userId,
      }
      localStorage.setItem(patientGlobalStorageKey(patientId), JSON.stringify(migratedRecord))
      localStorage.removeItem(legacyKey)
      knownIds.add(patientId)
    }

    const registry = Array.from(knownIds)
    localStorage.setItem(PATIENT_REGISTRY_KEY, JSON.stringify(registry))

    const patientsList: PatientRecord[] = []
    const availablePatientsList: PatientRecord[] = []
    for (const patientId of registry) {
      const patient = readJsonStorage<PatientRecord | null>(patientGlobalStorageKey(patientId), null)
      if (!patient) {
        continue
      }
      const normalizedOwner = patient.ownerUserId || (ownerIndex.includes(patientId) ? userId : '')
      if (!normalizedOwner) {
        continue
      }
      const normalizedPatient =
        patient.ownerUserId === normalizedOwner ? patient : { ...patient, ownerUserId: normalizedOwner }
      if (patient.ownerUserId !== normalizedOwner) {
        localStorage.setItem(patientGlobalStorageKey(patientId), JSON.stringify(normalizedPatient))
      }
      availablePatientsList.push(normalizedPatient)
      if (normalizedOwner === userId) {
        patientsList.push(normalizedPatient)
      }
    }

    return {
      patientsList: sortPatientsByName(patientsList),
      availablePatientsList: sortPatientsByName(availablePatientsList),
    }
  }

  async function persistWorkspaceRemote(
    userId: string,
    nextProfile: ProfessionalProfile,
    nextPatients: PatientRecord[],
    nextAppointments: AppointmentRecord[],
  ): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      return
    }
    try {
      const { error } = await supabase.from('user_workspaces').upsert(
        {
          user_id: userId,
          profile_json: nextProfile,
          patients_json: nextPatients,
          appointments_json: nextAppointments,
        },
        { onConflict: 'user_id' },
      )
      if (error) {
        console.warn('No se pudo guardar la base personal en la nube:', error.message)
      }
    } catch (err) {
      console.warn('Fallo de conexión al sincronizar workspace en la nube:', err)
    }
  }

  async function loadWorkspaceForUser(user: SeedUser): Promise<void> {
    const localProfile = readJsonStorage<ProfessionalProfile>(profileStorageKey(user.id), profileFromSeed(user))
    const localLoaded = loadAccessiblePatientsForUser(user.id)
    const localAppointments = readJsonStorage<AppointmentRecord[]>(appointmentsStorageKey(user.id), [])
      .map(normalizeAppointmentRecord)
      .filter((appointment) => appointment.scheduledDate && appointment.scheduledTime)
      .sort((left, right) => appointmentSortKey(left).localeCompare(appointmentSortKey(right)))

    let loadedProfile = localProfile
    let patientsList = localLoaded.patientsList
    let availablePatientsList = localLoaded.availablePatientsList
    let loadedAppointments = localAppointments
    const localSeenIds = readJsonStorage<string[]>(communitySeenStorageKey(user.id), [])

    if (isSupabaseConfigured && supabase) {
      const { error: professionalError } = await supabase.from('professionals').upsert(
        {
          id: user.id,
          username: user.username,
          password: user.password,
          full_name: user.fullName,
          specialty: user.specialty,
          license_number: user.licenseNumber,
          email: user.email,
          network_memberships_json: user.networkMemberships ?? [],
        },
        { onConflict: 'id' },
      )
      if (professionalError) {
        throw new Error(`No se pudo sincronizar el profesional: ${professionalError.message}`)
      }

      const { data, error } = await supabase
        .from('user_workspaces')
        .select('user_id, profile_json, patients_json, appointments_json')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) {
        throw new Error(`No se pudo cargar la base personal del profesional: ${error.message}`)
      }

      if (data) {
        const workspace = data as RemoteWorkspaceRow
        loadedProfile = normalizeRemoteProfile(workspace.profile_json, profileFromSeed(user))
        const remotePatients = Array.isArray(workspace.patients_json)
          ? workspace.patients_json
              .map((item) => normalizeRemotePatient(item, user.id))
              .filter((item): item is PatientRecord => Boolean(item))
          : []
        patientsList = sortPatientsByName(remotePatients)
        availablePatientsList = sortPatientsByName(remotePatients)
        loadedAppointments = Array.isArray(workspace.appointments_json)
          ? workspace.appointments_json
              .map((item) => normalizeAppointmentRecord(item as AppointmentRecord))
              .filter((appointment) => appointment.scheduledDate && appointment.scheduledTime)
              .sort((left, right) => appointmentSortKey(left).localeCompare(appointmentSortKey(right)))
          : []
      } else {
        await persistWorkspaceRemote(user.id, localProfile, localLoaded.patientsList, localAppointments)
      }
    }

    if (
      (!loadedProfile.communitySeenMessageIds || loadedProfile.communitySeenMessageIds.length === 0) &&
      localSeenIds.length > 0
    ) {
      loadedProfile = {
        ...loadedProfile,
        communitySeenMessageIds: localSeenIds,
      }
    }

    localStorage.setItem(profileStorageKey(user.id), JSON.stringify(loadedProfile))
    localStorage.setItem(appointmentsStorageKey(user.id), JSON.stringify(loadedAppointments))
    localStorage.setItem(
      patientIndexStorageKey(user.id),
      JSON.stringify(patientsList.map((patient) => patient.id)),
    )
    for (const patient of patientsList) {
      localStorage.setItem(patientGlobalStorageKey(patient.id), JSON.stringify(patient))
    }

    setActiveUserId(user.id)
    setProfile(loadedProfile)
    setCommunitySeenIds(loadedProfile.communitySeenMessageIds ?? localSeenIds)
    setPatients(patientsList)
    setAvailablePatients(availablePatientsList)
    setAppointments(loadedAppointments)
  }

  async function fetchRemoteProfessionalById(userId: string): Promise<SeedUser | null> {
    if (!isSupabaseConfigured || !supabase) {
      return null
    }

    const { data, error } = await supabase
      .from('professionals')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      throw new Error(`No se pudo refrescar la suscripción del profesional: ${error.message}`)
    }

    if (!data) {
      return null
    }

    return mapRemoteProfessional(data as RemoteProfessionalRow)
  }

  async function loadAdminDeletedUserArchives(): Promise<void> {
    if (!isAdminSession) {
      setAdminArchivedUsers([])
      return
    }

    if (!isSupabaseConfigured || !supabase) {
      const localArchives = readJsonStorage<DeletedUserArchiveRecord[]>(DELETED_USER_ARCHIVES_KEY, [])
      setAdminArchivedUsers(localArchives)
      return
    }

    setLoadingAdminArchives(true)
    const { data, error } = await supabase
      .from('deleted_user_archives')
      .select('*')
      .order('deleted_at', { ascending: false })
    setLoadingAdminArchives(false)

    if (error) {
      setAppError(`No se pudieron cargar los archivos legales: ${error.message}`)
      return
    }

    setAdminArchivedUsers((data ?? []).map((row) => mapRemoteDeletedUserArchive(row as RemoteDeletedUserArchiveRow)))
  }

  function removeLocalUserArtifacts(userId: string, ownedPatients: PatientRecord[]): void {
    localStorage.removeItem(profileStorageKey(userId))
    localStorage.removeItem(appointmentsStorageKey(userId))
    localStorage.removeItem(patientIndexStorageKey(userId))
    localStorage.removeItem(communitySeenStorageKey(userId))

    for (const patient of ownedPatients) {
      localStorage.removeItem(patientStorageKey(userId, patient.id))
      localStorage.removeItem(patientGlobalStorageKey(patient.id))
    }
  }

  async function archiveAndDeleteUser(targetUser: SeedUser): Promise<void> {
    if (!activeUser || !isAdminSession) {
      setAppError('Solo el administrador puede eliminar usuarios.')
      return
    }
    if (isAdminUser(targetUser)) {
      setAppError('No se puede eliminar el usuario administrador.')
      return
    }

    setAppError(null)
    setAppNotice(null)
    setAdminBusyUserId(targetUser.id)

    try {
      if (isSupabaseConfigured && supabase) {
        const [{ data: workspaceData, error: workspaceError }, { data: messagesData, error: messagesError }] =
          await Promise.all([
            supabase
              .from('user_workspaces')
              .select('user_id, profile_json, patients_json, appointments_json')
              .eq('user_id', targetUser.id)
              .maybeSingle(),
            supabase
              .from('community_messages')
              .select('id, sender_id, recipient_id, text, attachments_json, sent_at')
              .or(`sender_id.eq.${targetUser.id},recipient_id.eq.${targetUser.id}`)
              .order('sent_at', { ascending: true }),
          ])

        if (workspaceError) {
          throw new Error(`No se pudo leer la base del usuario a eliminar: ${workspaceError.message}`)
        }
        if (messagesError) {
          throw new Error(`No se pudieron leer los mensajes del usuario a eliminar: ${messagesError.message}`)
        }

        const workspace = workspaceData as RemoteWorkspaceRow | null
        const archivedPatients = Array.isArray(workspace?.patients_json)
          ? workspace!.patients_json
              .map((item) => normalizeRemotePatient(item, targetUser.id))
              .filter((item): item is PatientRecord => Boolean(item))
          : []
        const archivedAppointments = Array.isArray(workspace?.appointments_json)
          ? workspace!.appointments_json
              .map((item) => normalizeAppointmentRecord(item as AppointmentRecord))
              .filter((appointment) => appointment.scheduledDate && appointment.scheduledTime)
          : []
        const archivedMessages = (messagesData ?? []).map((row) =>
          mapRemoteCommunityMessage(row as RemoteCommunityMessageRow),
        )

        const archiveData: Record<string, unknown> = {
          exportedAt: new Date().toISOString(),
          deletedBy: {
            id: activeUser.id,
            username: activeUser.username,
            fullName: activeUser.fullName,
            email: activeUser.email,
          },
          user: {
            id: targetUser.id,
            username: targetUser.username,
            fullName: targetUser.fullName,
            specialty: targetUser.specialty,
            licenseNumber: targetUser.licenseNumber,
            email: targetUser.email,
            networkMemberships: targetUser.networkMemberships ?? [],
            active: targetUser.active ?? true,
            trialStartedAt: targetUser.trialStartedAt ?? null,
            subscriptionStatus: targetUser.subscriptionStatus ?? null,
            subscriptionExpiresAt: targetUser.subscriptionExpiresAt ?? null,
          },
          workspace: {
            profile: workspace ? normalizeRemoteProfile(workspace.profile_json, profileFromSeed(targetUser)) : profileFromSeed(targetUser),
            patients: archivedPatients,
            appointments: archivedAppointments,
          },
          communityMessages: archivedMessages,
        }

        const { data: archiveInsert, error: archiveError } = await supabase
          .from('deleted_user_archives')
          .insert({
            deleted_user_id: targetUser.id,
            deleted_username: targetUser.username,
            deleted_full_name: targetUser.fullName,
            deleted_email: targetUser.email,
            deleted_at: new Date().toISOString(),
            deleted_by_user_id: activeUser.id,
            deleted_by_user_name: activeUser.fullName,
            patient_count: archivedPatients.length,
            appointment_count: archivedAppointments.length,
            archive_json: archiveData,
          })
          .select('*')
          .single()

        if (archiveError) {
          throw new Error(`No se pudo guardar el archivo legal del usuario: ${archiveError.message}`)
        }

        const { error: deleteError } = await supabase.from('professionals').delete().eq('id', targetUser.id)
        if (deleteError) {
          throw new Error(`No se pudo eliminar el usuario: ${deleteError.message}`)
        }

        const nextArchive = mapRemoteDeletedUserArchive(archiveInsert as RemoteDeletedUserArchiveRow)
        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        localStorage.setItem(
          CREATED_USERS_KEY,
          JSON.stringify(localUsers.filter((user) => user.id !== targetUser.id)),
        )
        removeLocalUserArtifacts(targetUser.id, archivedPatients)
        setAdminArchivedUsers((current) => [nextArchive, ...current])
        downloadTextFile(buildArchiveFileName(nextArchive), JSON.stringify(nextArchive.archiveData, null, 2))
      } else {
        const localProfile = readJsonStorage<ProfessionalProfile>(profileStorageKey(targetUser.id), profileFromSeed(targetUser))
        const localPatientIds = readJsonStorage<string[]>(patientIndexStorageKey(targetUser.id), [])
        const localPatients = localPatientIds
          .map((patientId) =>
            normalizeRemotePatient(readJsonStorage<unknown>(patientGlobalStorageKey(patientId), null), targetUser.id),
          )
          .filter((item): item is PatientRecord => Boolean(item))
        const localAppointments = readJsonStorage<AppointmentRecord[]>(appointmentsStorageKey(targetUser.id), [])
          .map(normalizeAppointmentRecord)
          .filter((appointment) => appointment.scheduledDate && appointment.scheduledTime)
        const localArchive: DeletedUserArchiveRecord = {
          id: crypto.randomUUID(),
          deletedUserId: targetUser.id,
          deletedUsername: targetUser.username,
          deletedFullName: targetUser.fullName,
          deletedEmail: targetUser.email,
          deletedAt: new Date().toISOString(),
          deletedByUserId: activeUser.id,
          deletedByUserName: activeUser.fullName,
          patientCount: localPatients.length,
          appointmentCount: localAppointments.length,
          archiveData: {
            exportedAt: new Date().toISOString(),
            deletedBy: {
              id: activeUser.id,
              username: activeUser.username,
              fullName: activeUser.fullName,
              email: activeUser.email,
            },
            user: {
              id: targetUser.id,
              username: targetUser.username,
              fullName: targetUser.fullName,
              specialty: targetUser.specialty,
              licenseNumber: targetUser.licenseNumber,
              email: targetUser.email,
            },
            workspace: {
              profile: localProfile,
              patients: localPatients,
              appointments: localAppointments,
            },
            communityMessages: [],
          },
        }
        const localArchives = readJsonStorage<DeletedUserArchiveRecord[]>(DELETED_USER_ARCHIVES_KEY, [])
        localStorage.setItem(DELETED_USER_ARCHIVES_KEY, JSON.stringify([localArchive, ...localArchives]))
        setAdminArchivedUsers((current) => [localArchive, ...current])

        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        localStorage.setItem(
          CREATED_USERS_KEY,
          JSON.stringify(localUsers.filter((user) => user.id !== targetUser.id)),
        )
        removeLocalUserArtifacts(targetUser.id, localPatients)
        downloadTextFile(buildArchiveFileName(localArchive), JSON.stringify(localArchive.archiveData, null, 2))
      }

      setSeedUsers((current) => current.filter((user) => user.id !== targetUser.id))
      setAppNotice(`Usuario eliminado y archivado correctamente: ${targetUser.fullName}.`)
      showSavedFloatingNotice()
    } finally {
      setAdminBusyUserId(null)
    }
  }

  async function handleAdminDeleteUser(userId: string): Promise<void> {
    const targetUser = seedUsers.find((user) => user.id === userId)
    if (!targetUser) {
      setAppError('No se encontró el usuario a eliminar.')
      return
    }

    const confirmed = window.confirm(
      `Se eliminará al usuario ${targetUser.fullName} y se archivará toda su información clínica para resguardo legal. ¿Deseas continuar?`,
    )
    if (!confirmed) {
      return
    }

    try {
      await archiveAndDeleteUser(targetUser)
    } catch (error) {
      setAppError(
        error instanceof Error
          ? `No se pudo eliminar y archivar el usuario: ${error.message}`
          : 'No se pudo eliminar y archivar el usuario.',
      )
    }
  }

  async function handleAdminSetSubscription(userId: string, mode: SubscriptionPlan | 'cancel'): Promise<void> {
    const targetUser = seedUsers.find((user) => user.id === userId)
    if (!targetUser) {
      setAppError('No se encontró el usuario a actualizar.')
      return
    }
    if (!isAdminSession) {
      setAppError('Solo el administrador puede modificar suscripciones.')
      return
    }

    setAdminBusyUserId(userId)
    setAppError(null)
    setAppNotice(null)

    try {
      const nextStatus: SeedUser['subscriptionStatus'] = mode === 'cancel' ? 'cancelled' : 'active'
      const nextExpiration =
        mode === 'cancel'
          ? new Date().toISOString()
          : buildSubscriptionExpiryIso(
              mode,
              targetUser.subscriptionStatus === 'active' &&
                targetUser.subscriptionExpiresAt &&
                new Date(targetUser.subscriptionExpiresAt).getTime() > Date.now()
                ? targetUser.subscriptionExpiresAt
                : new Date().toISOString(),
            )

      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase
          .from('professionals')
          .update({
            subscription_status: nextStatus,
            subscription_expires_at: nextExpiration,
          })
          .eq('id', userId)
        if (error) {
          throw new Error(error.message)
        }
      } else {
        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        localStorage.setItem(
          CREATED_USERS_KEY,
          JSON.stringify(
            localUsers.map((user) =>
              user.id === userId
                ? {
                    ...user,
                    subscriptionStatus: nextStatus,
                    subscriptionExpiresAt: nextExpiration,
                  }
                : user,
            ),
          ),
        )
      }

      setSeedUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? {
                ...user,
                subscriptionStatus: nextStatus,
                subscriptionExpiresAt: nextExpiration,
              }
            : user,
        ),
      )

      if (activeUserId === userId) {
        const refreshed = await fetchRemoteProfessionalById(userId)
        if (refreshed) {
          await loadWorkspaceForUser(refreshed)
        }
      }

      setAppNotice(
        mode === 'cancel'
          ? `Suscripción cancelada para ${targetUser.fullName}.`
          : `Suscripción actualizada para ${targetUser.fullName}.`,
      )
      showSavedFloatingNotice()
    } catch (error) {
      setAppError(
        error instanceof Error
          ? `No se pudo actualizar la suscripción: ${error.message}`
          : 'No se pudo actualizar la suscripción.',
      )
    } finally {
      setAdminBusyUserId(null)
    }
  }

  function handleDownloadDeletedUserArchive(archive: DeletedUserArchiveRecord): void {
    downloadTextFile(buildArchiveFileName(archive), JSON.stringify(archive.archiveData, null, 2))
  }

  async function handleSendAdminBroadcast(): Promise<void> {
    if (!adminBroadcastBody.trim() || !activeUserId) {
      return
    }
    const recipients = seedUsers.filter((u) => u.id !== activeUserId)
    if (recipients.length === 0) {
      setAppError('No hay otros profesionales registrados para recibir el comunicado.')
      return
    }

    setAdminBroadcastSending(true)
    const formattedText = `📢 ${adminBroadcastSubject.trim() ? `[${adminBroadcastSubject.trim()}] ` : ''}${adminBroadcastBody.trim()}`
    const sentAt = new Date().toISOString()

    try {
      if (isSupabaseConfigured && supabase) {
        const rows = recipients.map((r) => ({
          sender_id: activeUserId,
          recipient_id: r.id,
          text: formattedText,
          attachments_json: [],
          sent_at: sentAt,
        }))
        const { error } = await supabase.from('community_messages').insert(rows)
        if (error) {
          throw new Error(error.message)
        }
      } else {
        recipients.forEach((r) => {
          const key = communityThreadStorageKey(activeUserId, r.id)
          const currentThread = readJsonStorage<CommunityMessage[]>(key, [])
          const nextThread = [
            ...currentThread,
            {
              id: crypto.randomUUID(),
              senderId: activeUserId,
              recipientId: r.id,
              text: formattedText,
              attachments: [],
              sentAt,
            },
          ]
          localStorage.setItem(key, JSON.stringify(nextThread))
        })
      }

      setAdminBroadcastSubject('')
      setAdminBroadcastBody('')
      setAppNotice('Comunicado y notificaciones enviadas a todos los profesionales.')
      showSavedFloatingNotice('Comunicado enviado con éxito')
      void showAppNotification('📢 Comunicado publicado', {
        body: `Enviado a ${recipients.length} profesionales registrados.`,
      })
    } catch (err) {
      setAppError(`Error al enviar comunicado: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAdminBroadcastSending(false)
    }
  }

  useEffect(() => {
    const loadSeedUsers = async () => {
      try {
        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        const localActiveOverrides = readJsonStorage<Record<string, boolean>>(
          USER_ACTIVE_OVERRIDES_KEY,
          {},
        )
        let merged: SeedUser[] = []

        if (isSupabaseConfigured && supabase) {
          const { data, error } = await supabase
            .from('professionals')
            .select('*')
            .order('full_name', { ascending: true })
          if (error) {
            throw new Error(`No se pudo cargar profesionales remotos: ${error.message}`)
          }
          for (const row of data ?? []) {
            const remoteUser = mapRemoteProfessional(row as RemoteProfessionalRow)
            if (
              !merged.some(
                (user) =>
                  user.username.trim().toLowerCase() === remoteUser.username.trim().toLowerCase(),
              )
            ) {
              merged.push(remoteUser)
            }
          }
        } else {
          const response = await fetch(`${import.meta.env.BASE_URL}users.json`)
          if (!response.ok) {
            throw new Error('No se pudo cargar users.json')
          }
          const payload = (await response.json()) as { users: SeedUser[] }
          merged = payload.users.map((user) => ({
            ...user,
            isAdmin: isAdminUser(user),
            active: localActiveOverrides[user.id] ?? user.active ?? true,
          }))
          for (const localUser of localUsers) {
            const normalizedLocalUser: SeedUser = {
              ...localUser,
              isAdmin: isAdminUser(localUser),
              active: localActiveOverrides[localUser.id] ?? localUser.active ?? true,
            }
            if (!merged.some((user) => user.username === normalizedLocalUser.username)) {
              merged.push(normalizedLocalUser)
            }
          }
          setAppNotice(
            'Modo local activo: los nuevos profesionales y chats solo se comparten en este navegador.',
          )
        }
        setSeedUsers(
          merged.map((user) => ({
            ...user,
            isAdmin: isAdminUser(user),
            active: user.active ?? true,
          })),
        )

        if (!isSupabaseConfigured) {
          const patientsResponse = await fetch(`${import.meta.env.BASE_URL}patients.json`)
          if (patientsResponse.ok) {
            const payload = (await patientsResponse.json()) as SeedPatientsPayload
            const registry = new Set(readJsonStorage<string[]>(PATIENT_REGISTRY_KEY, []))

            for (const rawPatient of payload.patients ?? []) {
              if (!rawPatient.apellido || !rawPatient.dni) {
                continue
              }

              const existingId =
                Array.from(registry).find((patientId) => {
                  const current = readJsonStorage<PatientRecord | null>(
                    patientGlobalStorageKey(patientId),
                    null,
                  )
                  return Boolean(
                    current &&
                      ((rawPatient.id && current.id === rawPatient.id) || current.dni === rawPatient.dni),
                  )
                }) ?? rawPatient.id

              const patientId = existingId ?? crypto.randomUUID()
              const currentPatient = existingId
                ? readJsonStorage<PatientRecord | null>(patientGlobalStorageKey(existingId), null)
                : null
              const createdAt = currentPatient?.createdAt ?? new Date().toISOString()
              const normalizedPatient: PatientRecord = {
                id: patientId,
                ownerUserId: rawPatient.ownerUserId || currentPatient?.ownerUserId || 'admin-general',
                nombre: rawPatient.nombre ?? currentPatient?.nombre ?? '',
                apellido: rawPatient.apellido,
                dni: rawPatient.dni,
                email: rawPatient.email ?? currentPatient?.email ?? '',
                obraSocial: rawPatient.obraSocial ?? currentPatient?.obraSocial ?? '',
                numeroAfiliado: rawPatient.numeroAfiliado ?? currentPatient?.numeroAfiliado ?? '',
                plan: rawPatient.plan ?? currentPatient?.plan ?? '',
                birthDate: rawPatient.birthDate ?? currentPatient?.birthDate ?? '',
                edad: calculateAge(rawPatient.birthDate ?? currentPatient?.birthDate ?? ''),
                patologiasConocidas:
                  rawPatient.patologiasConocidas ?? currentPatient?.patologiasConocidas ?? '',
                patologiasCronicas:
                  rawPatient.patologiasCronicas ?? currentPatient?.patologiasCronicas ?? '',
                ultimaInternacion: rawPatient.ultimaInternacion ?? currentPatient?.ultimaInternacion ?? '',
                cirugiasPrevias: rawPatient.cirugiasPrevias ?? currentPatient?.cirugiasPrevias ?? '',
                direccion: typeof rawPatient.direccion === 'string' ? rawPatient.direccion : (currentPatient?.direccion ?? ''),
                photoCarnet: rawPatient.photoCarnet ?? currentPatient?.photoCarnet,
                dniPhoto: rawPatient.dniPhoto ?? currentPatient?.dniPhoto,
                documents: rawPatient.documents ?? currentPatient?.documents ?? [],
                consultations: currentPatient?.consultations ?? [],
                createdAt,
                updatedAt: currentPatient?.updatedAt ?? createdAt,
              }

              registry.add(patientId)
              localStorage.setItem(
                patientGlobalStorageKey(patientId),
                JSON.stringify(normalizedPatient),
              )
            }

            localStorage.setItem(PATIENT_REGISTRY_KEY, JSON.stringify(Array.from(registry)))
          }
        }
      } catch (error) {
        setAppError(error instanceof Error ? error.message : 'Error cargando usuarios.')
      } finally {
        setLoadingUsers(false)
      }
    }

    void loadSeedUsers()
  }, [])

  useEffect(() => {
    const loadDiagnosisCatalog = async () => {
      const storedCustom = readJsonStorage<string[]>(CUSTOM_DIAGNOSIS_STORAGE_KEY, [])
      const fallbackCatalog = mergeDiagnosisCatalog([
        ...loadDiagnosisCatalogFromCsv(diagnosisCsv),
        ...storedCustom,
      ])
      if (fallbackCatalog.length > 0) {
        setDiagnosisCatalog(fallbackCatalog)
      }

      try {
        const response = await fetch(`${import.meta.env.BASE_URL}cie-10.csv`)
        if (response.ok) {
          const csvText = await response.text()
          const fetchedCatalog = mergeDiagnosisCatalog([
            ...loadDiagnosisCatalogFromCsv(csvText),
            ...storedCustom,
          ])
          if (fetchedCatalog.length > 0) {
            setDiagnosisCatalog(fetchedCatalog)
            return
          }
        }
      } catch {
        // Fallback to Supabase below if the static CSV is not reachable.
      }

      if (!isSupabaseConfigured || !supabase) {
        if (fallbackCatalog.length === 0) {
          setDiagnosisCatalog([])
        }
        return
      }

      for (const tableName of DIAGNOSIS_TABLE_CANDIDATES) {
        const { data, error } = await supabase.from(tableName).select('*').limit(5000)
        if (error) {
          continue
        }
        const unique = new Set<string>(storedCustom)
        for (const row of data ?? []) {
          const diagnosis = extractDiagnosisText((row as Record<string, unknown>) ?? {})
          if (diagnosis) {
            unique.add(diagnosis)
          }
        }
        if (unique.size > 0) {
          const ordered = mergeDiagnosisCatalog(Array.from(unique))
          setDiagnosisCatalog(ordered)
          return
        }
      }

      if (fallbackCatalog.length === 0) {
        setDiagnosisCatalog([])
      }
    }

    void loadDiagnosisCatalog()
  }, [])

  useEffect(() => {
    setSpecialtyCatalog(loadSimpleCatalogFromCsv(specialtiesCsv))
  }, [])

  useEffect(() => {
    const loadMedicationCatalog = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}vademecum.json`)
        if (!response.ok) {
          setMedicationCatalog([])
          return
        }
        setMedicationCatalog(loadMedicationCatalogFromJson(await response.json()))
      } catch {
        setMedicationCatalog([])
      }
    }

    void loadMedicationCatalog()
  }, [])

  useEffect(() => {
    const loadMedicalNews = async () => {
      if (!isSupabaseConfigured || !supabase) {
        setMedicalNews(mergeMedicalNewsItems([...MEDICAL_NEWS_FALLBACK], MANUAL_MEDICAL_NEWS_ITEMS))
        return
      }

      setMedicalNewsLoading(true)
      const { data, error } = await supabase.functions.invoke('fetch-medical-news')
      setMedicalNewsLoading(false)

      if (error) {
        setMedicalNews(mergeMedicalNewsItems([...MEDICAL_NEWS_FALLBACK], MANUAL_MEDICAL_NEWS_ITEMS))
        return
      }

      if (!data || typeof data !== 'object' || !Array.isArray((data as { items?: unknown[] }).items)) {
        setMedicalNews(mergeMedicalNewsItems([...MEDICAL_NEWS_FALLBACK], MANUAL_MEDICAL_NEWS_ITEMS))
        return
      }

      const items = ((data as { items: unknown[] }).items ?? [])
        .map((item, index) => {
          if (!item || typeof item !== 'object') {
            return null
          }
          const candidate = item as Partial<MedicalNewsItem>
          if (typeof candidate.title !== 'string' || typeof candidate.link !== 'string' || typeof candidate.source !== 'string') {
            return null
          }
          return {
            id: typeof candidate.id === 'string' ? candidate.id : `news-${index}`,
            source: candidate.source,
            title: candidate.title,
            summary: typeof candidate.summary === 'string' ? candidate.summary : '',
            link: candidate.link,
            publishedAt: typeof candidate.publishedAt === 'string' ? candidate.publishedAt : '',
            imageUrl:
              typeof candidate.imageUrl === 'string' && candidate.imageUrl.trim()
                ? candidate.imageUrl
                : candidate.source.includes('Ministerio')
                  ? MEDICAL_NEWS_FALLBACK[0].imageUrl
                  : MEDICAL_NEWS_FALLBACK[1].imageUrl,
          }
        })
        .filter((item): item is MedicalNewsItem => Boolean(item))

      setMedicalNews(
        items.length > 0
          ? mergeMedicalNewsItems(items, MANUAL_MEDICAL_NEWS_ITEMS)
          : mergeMedicalNewsItems([...MEDICAL_NEWS_FALLBACK], MANUAL_MEDICAL_NEWS_ITEMS),
      )
    }

    void loadMedicalNews()
  }, [])

  useEffect(() => {
    setCurrentMedicalNewsIndex(0)
  }, [medicalNews])

  useEffect(() => {
    if (medicalNews.length <= 1) {
      return
    }

    const intervalId = window.setInterval(() => {
      setCurrentMedicalNewsIndex((current) => (current + 1) % medicalNews.length)
    }, 7000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [medicalNews])

  useEffect(() => {
    if (!selectedMedicationId) {
      return
    }

    if (filteredMedicationCatalog.length === 0) {
      setSelectedMedicationId(null)
      return
    }

    if (!filteredMedicationCatalog.some((entry) => entry.id === selectedMedicationId)) {
      setSelectedMedicationId(null)
    }
  }, [filteredMedicationCatalog, selectedMedicationId])

  useEffect(() => {
    const SpeechRecognitionApi = window.SpeechRecognition ?? window.webkitSpeechRecognition
    setDictationAvailable(Boolean(SpeechRecognitionApi))

    return () => {
      stopLiveScanner()
      recognitionRef.current?.stop()
      if (floatingTimerRef.current) {
        window.clearTimeout(floatingTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(THEME_MODE_KEY, themeMode)
    document.body.classList.toggle('theme-night', themeMode === 'night')
  }, [themeMode])

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event): void {
      event.preventDefault()
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
    }

    function handleAppInstalled(): void {
      setInstallPromptEvent(null)
      setShowInstallToast(false)
      // No guardamos un bloqueo permanente: si el usuario desinstala la app más
      // adelante, dejará de estar en modo standalone y el aviso podrá reaparecer.
      localStorage.removeItem(INSTALL_PROMPT_DISMISSED_KEY)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    if (!profile || !installPromptEvent || isStandalone) {
      setShowInstallToast(false)
      return
    }
    const dismissedUntilRaw = localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)
    const dismissedUntil = dismissedUntilRaw ? Number(dismissedUntilRaw) : 0
    if (dismissedUntil && Date.now() < dismissedUntil) {
      return
    }
    const timer = window.setTimeout(() => setShowInstallToast(true), 1200)
    return () => window.clearTimeout(timer)
  }, [profile, installPromptEvent])

  async function handleInstallApp(): Promise<void> {
    if (!installPromptEvent) {
      return
    }
    setShowInstallToast(false)
    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    if (choice.outcome !== 'accepted') {
      // Solo pospone el aviso si el usuario no instaló; si aceptó, lo maneja
      // el evento "appinstalled" (sin bloqueo permanente).
      localStorage.setItem(
        INSTALL_PROMPT_DISMISSED_KEY,
        String(Date.now() + INSTALL_PROMPT_SNOOZE_DAYS * 24 * 60 * 60 * 1000),
      )
    }
    setInstallPromptEvent(null)
    setAppNotice(
      choice.outcome === 'accepted'
        ? 'DrHappy se está instalando en tu dispositivo.'
        : 'Podés instalar DrHappy más tarde desde el menú del navegador.',
    )
    showSavedFloatingNotice(choice.outcome === 'accepted' ? 'Instalando DrHappy' : 'Instalación cancelada')
  }

  function handleDismissInstallToast(): void {
    setShowInstallToast(false)
    localStorage.setItem(
      INSTALL_PROMPT_DISMISSED_KEY,
      String(Date.now() + INSTALL_PROMPT_SNOOZE_DAYS * 24 * 60 * 60 * 1000),
    )
  }

  useEffect(() => {
    if (!profile) {
      setShowNotificationToast(false)
      return
    }
    const currentPerm = getNotificationPermission()
    setNotificationPermission(currentPerm)
    if (currentPerm !== 'default') {
      setShowNotificationToast(false)
      return
    }
    if (showInstallToast) {
      setShowNotificationToast(false)
      return
    }
    const dismissedUntilRaw = localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY)
    const dismissedUntil = dismissedUntilRaw ? Number(dismissedUntilRaw) : 0
    if (dismissedUntil && Date.now() < dismissedUntil) {
      return
    }
    const timer = window.setTimeout(() => {
      setShowNotificationToast(true)
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [profile, showInstallToast])

  async function handleEnableNotifications(): Promise<void> {
    setShowNotificationToast(false)
    const result = await requestNotificationPermission()
    setNotificationPermission(result)
    if (result === 'granted') {
      localStorage.removeItem(NOTIFICATION_PROMPT_DISMISSED_KEY)
      void showAppNotification('🔔 Notificaciones activadas', {
        body: '¡Excelente! Ahora recibirás avisos de mensajes privados y novedades en tu dispositivo.',
      })
      showSavedFloatingNotice('Notificaciones activadas')
    } else if (result === 'denied') {
      setAppError(
        'Las notificaciones están bloqueadas en tu navegador o celular. Podés habilitarlas desde los ajustes del sitio.',
      )
    }
  }

  function handleDismissNotificationToast(): void {
    setShowNotificationToast(false)
    localStorage.setItem(
      NOTIFICATION_PROMPT_DISMISSED_KEY,
      String(Date.now() + NOTIFICATION_PROMPT_SNOOZE_DAYS * 24 * 60 * 60 * 1000),
    )
  }

  useEffect(() => {
    if (loadingUsers || seedUsers.length === 0) {
      return
    }

    const storedUserId = localStorage.getItem(SESSION_USER_KEY)
    if (!storedUserId) {
      return
    }

    const user = seedUsers.find((entry) => entry.id === storedUserId)
    if (!user) {
      localStorage.removeItem(SESSION_USER_KEY)
      return
    }

    void loadWorkspaceForUser(user).catch((error: unknown) => {
      setAppError(
        error instanceof Error
          ? `No se pudieron recuperar datos del profesional: ${error.message}`
          : 'No se pudieron recuperar datos del profesional.',
      )
    })
  }, [loadingUsers, seedUsers])

  useEffect(() => {
    if (workspaceLayer !== 'user-admin' || !isAdminSession) {
      return
    }
    void loadAdminDeletedUserArchives()
  }, [workspaceLayer, isAdminSession])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setGoogleIdentity(null)
      return
    }
    const authClient = supabase

    const syncGoogleIdentity = async (): Promise<void> => {
      const { data } = await authClient.auth.getSession()
      const sessionUser = data.session?.user
      const provider = sessionUser?.app_metadata?.provider
      if (!sessionUser?.email || provider !== 'google') {
        setGoogleIdentity(null)
        return
      }
      const metadata =
        sessionUser.user_metadata && typeof sessionUser.user_metadata === 'object'
          ? (sessionUser.user_metadata as Record<string, unknown>)
          : null
      const avatarUrl =
        typeof metadata?.avatar_url === 'string'
          ? metadata.avatar_url
          : typeof metadata?.picture === 'string'
            ? metadata.picture
            : undefined
      const fullName =
        typeof metadata?.full_name === 'string' ? metadata.full_name : undefined
      setGoogleIdentity({
        email: sessionUser.email,
        avatarUrl,
        fullName,
      })
    }

    void syncGoogleIdentity()
    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange(() => {
      void syncGoogleIdentity()
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (loadingUsers || !activeUserId || !isSupabaseConfigured || !supabase) {
      return
    }
    const supabaseClient = supabase

    const currentUrl = new URL(window.location.href)
    if (!currentUrl.search) {
      processedCheckoutReturnRef.current = null
      return
    }

    if (processedCheckoutReturnRef.current === currentUrl.search) {
      return
    }

    const paymentStatus =
      currentUrl.searchParams.get('collection_status') ||
      currentUrl.searchParams.get('status') ||
      ''
    const paymentId =
      currentUrl.searchParams.get('payment_id') ||
      currentUrl.searchParams.get('collection_id') ||
      ''

    const clearCheckoutParams = () => {
      const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`
      window.history.replaceState({}, document.title, cleanUrl)
    }

    if (!paymentStatus) {
      return
    }

    processedCheckoutReturnRef.current = currentUrl.search

    if (paymentStatus !== 'approved') {
      if (paymentStatus === 'pending' || paymentStatus === 'in_process') {
        setAppNotice('El pago quedó pendiente de confirmación. Cuando MercadoPago lo apruebe, la suscripción se activará automáticamente.')
      } else {
        setAppNotice('El pago no se aprobó. Puedes intentar nuevamente cuando quieras.')
      }
      clearCheckoutParams()
      return
    }

    let cancelled = false
    setAppNotice('Pago aprobado. Verificando la activación de tu suscripción...')

    const verifySubscriptionActivation = async (): Promise<void> => {
      const maxAttempts = 6
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const refreshedUser = await fetchRemoteProfessionalById(activeUserId)
        if (cancelled) {
          return
        }
        if (refreshedUser) {
          setSeedUsers((current) => {
            const exists = current.some((user) => user.id === refreshedUser.id)
            if (!exists) {
              return [...current, refreshedUser]
            }
            return current.map((user) => (user.id === refreshedUser.id ? refreshedUser : user))
          })

          if (refreshedUser.subscriptionStatus === 'active') {
            await loadWorkspaceForUser(refreshedUser)
            if (cancelled) {
              return
            }
            setAppNotice(
              paymentId
                ? `Suscripción activada correctamente. Pago confirmado #${paymentId}.`
                : 'Suscripción activada correctamente.',
            )
            showSavedFloatingNotice()
            clearCheckoutParams()
            return
          }
        }

        await new Promise((resolve) => window.setTimeout(resolve, 2000))
      }

      if (paymentId) {
        const { error: activationError } = await supabaseClient.functions.invoke('mercadopago-webhook', {
          body: {
            type: 'payment',
            data: {
              id: paymentId,
            },
          },
        })

        if (activationError) {
          throw new Error(`MercadoPago aprobó el pago, pero no se pudo activar la suscripción: ${activationError.message}`)
        }

        const refreshedUser = await fetchRemoteProfessionalById(activeUserId)
        if (cancelled) {
          return
        }
        if (refreshedUser) {
          setSeedUsers((current) => current.map((user) => (user.id === refreshedUser.id ? refreshedUser : user)))
          if (refreshedUser.subscriptionStatus === 'active') {
            await loadWorkspaceForUser(refreshedUser)
            if (cancelled) {
              return
            }
            setAppNotice(`Suscripción activada correctamente. Pago confirmado #${paymentId}.`)
            showSavedFloatingNotice()
            clearCheckoutParams()
            return
          }
        }
      }

      if (!cancelled) {
        setAppNotice(
          'El pago fue aprobado, pero la suscripción todavía se está sincronizando. Espera unos segundos y recarga la página si la leyenda del trial sigue visible.',
        )
        clearCheckoutParams()
      }
    }

    void verifySubscriptionActivation().catch((error: unknown) => {
      if (!cancelled) {
        setAppError(
          error instanceof Error
            ? `El pago volvió correctamente, pero no se pudo verificar la suscripción: ${error.message}`
            : 'El pago volvió correctamente, pero no se pudo verificar la suscripción.',
        )
        clearCheckoutParams()
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeUserId, loadingUsers, seedUsers.length])

  useEffect(() => {
    if (loadingUsers || !isSupabaseConfigured || !supabase) {
      return
    }
    // Al volver del redirect de Google, Supabase deja la sesión activa; la resolvemos
    // buscando/creando el profesional correspondiente al email de Google.
    if (localStorage.getItem(SESSION_USER_KEY)) {
      return
    }
    void resolveGoogleSession().catch((error: unknown) => {
      setAppError(
        error instanceof Error
          ? `No se pudo completar el inicio de sesión con Google: ${error.message}`
          : 'No se pudo completar el inicio de sesión con Google.',
      )
    })
  }, [loadingUsers, seedUsers])

  const sortedPatients = useMemo(() => {
    const list = [...patients]
    list.sort((a, b) => {
      const byApellido = a.apellido.localeCompare(b.apellido, 'es')
      if (byApellido !== 0) {
        return byApellido
      }
      return a.nombre.localeCompare(b.nombre, 'es')
    })
    return list
  }, [patients])

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) ?? null,
    [patients, selectedPatientId],
  )

  const canEditSelectedPatientRecord = Boolean(
    selectedPatient && activeUserId && selectedPatient.ownerUserId === activeUserId,
  )
  const canEditPatientForm =
    !selectedPatient || (canEditSelectedPatientRecord && patientFormUnlocked)

  const communityMembers = useMemo(
    () => seedUsers.filter((user) => user.id !== activeUserId && user.active !== false),
    [seedUsers, activeUserId],
  )

  const communityHasActiveFilters = Boolean(
    communitySearchQuery.trim() || communityNetworkFilters.length > 0,
  )

  const filteredCommunityMembers = useMemo(() => {
    if (!communityHasActiveFilters) {
      return []
    }

    const selectedNetworks = new Set(communityNetworkFilters)
    return communityMembers
      .map((member) => ({
        member,
        score: communitySearchQuery.trim()
          ? scoreProfessionalSearch(member, communitySearchQuery)
          : 0,
      }))
      .filter(({ member, score }) => {
        const matchesSearch = !communitySearchQuery.trim() || Number.isFinite(score)
        const matchesNetwork =
          selectedNetworks.size === 0 ||
          (member.networkMemberships ?? []).some((network) => selectedNetworks.has(network))
        return matchesSearch && matchesNetwork
      })
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score
        }
        return left.member.fullName.localeCompare(right.member.fullName, 'es')
      })
      .map(({ member }) => member)
  }, [
    communityMembers,
    communityHasActiveFilters,
    communityNetworkFilters,
    communitySearchQuery,
  ])

  const communityDisplayedMembers = useMemo(() => {
    if (communityHasActiveFilters) {
      return filteredCommunityMembers
    }

    const withUnread = communityMembers
      .filter((member) => (communityUnreadByMember[member.id] ?? 0) > 0)
      .sort((left, right) => {
        const unreadDiff =
          (communityUnreadByMember[right.id] ?? 0) - (communityUnreadByMember[left.id] ?? 0)
        if (unreadDiff !== 0) {
          return unreadDiff
        }
        return left.fullName.localeCompare(right.fullName, 'es')
      })
    if (withUnread.length > 0) {
      return withUnread
    }
    if (communityTargetId) {
      const currentTarget = communityMembers.find((member) => member.id === communityTargetId)
      return currentTarget ? [currentTarget] : []
    }
    return []
  }, [
    communityHasActiveFilters,
    communityMembers,
    communityTargetId,
    communityUnreadByMember,
    filteredCommunityMembers,
  ])

  const rankedPatients = useMemo(() => {
    const query = patientSearchQuery.trim()
    if (!query) {
      return sortedPatients.map((patient) => ({ patient, score: 0 }))
    }

    return sortedPatients
      .map((patient) => ({
        patient,
        score: scorePatientSearch(patient, query),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score
        }
        const leftLabel = `${left.patient.apellido} ${left.patient.nombre} ${left.patient.dni}`
        const rightLabel = `${right.patient.apellido} ${right.patient.nombre} ${right.patient.dni}`
        return leftLabel.localeCompare(rightLabel, 'es')
      })
  }, [patientSearchQuery, sortedPatients])

  const visiblePatients = useMemo(
    () => rankedPatients.map((entry) => entry.patient),
    [rankedPatients],
  )

  const patientSearchSuggestions = useMemo(() => {
    if (!patientSearchQuery.trim()) {
      return []
    }
    return visiblePatients.slice(0, 6)
  }, [patientSearchQuery, visiblePatients])

  const selectedCommunityMember = useMemo(
    () => communityMembers.find((member) => member.id === communityTargetId) ?? null,
    [communityMembers, communityTargetId],
  )

  useEffect(() => {
    if (!selectedPatient) {
      setPatientDraft(emptyPatientDraft)
      setPatientFormUnlocked(true)
      return
    }
    const nextDraft = patientToDraft(selectedPatient)
    setPatientDraft(nextDraft)
    setPatientFormUnlocked(false)
  }, [selectedPatient])

  useEffect(() => {
    if (!communityOpen || !activeUserId) {
      return
    }

    if (!communityTargetId && communityDisplayedMembers.length > 0) {
      setCommunityTargetId(communityDisplayedMembers[0].id)
    }
  }, [communityOpen, communityTargetId, communityDisplayedMembers, activeUserId])

  useEffect(() => {
    if (!activeUserId || !communityTargetId) {
      setCommunityMessages([])
      return
    }

    const readThread = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return
      }

      if (isSupabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase
            .from('community_messages')
            .select('id, sender_id, recipient_id, text, attachments_json, sent_at')
            .or(
              `and(sender_id.eq.${activeUserId},recipient_id.eq.${communityTargetId}),and(sender_id.eq.${communityTargetId},recipient_id.eq.${activeUserId})`,
            )
            .order('sent_at', { ascending: true })
          if (error) {
            console.warn('Error leyendo chat de comunidad:', error.message)
            return
          }
          const ordered = (data ?? []).map((row) =>
            mapRemoteCommunityMessage(row as RemoteCommunityMessageRow),
          )
          setCommunityMessages(ordered)
        } catch (err) {
          console.warn('Fallo de conexión al cargar chat de comunidad:', err)
        }
        return
      }

      const key = communityThreadStorageKey(activeUserId, communityTargetId)
      const thread = readJsonStorage<CommunityMessage[]>(key, [])
      const normalized = thread.map((message) => ({
        ...message,
        attachments: message.attachments ?? [],
      }))
      const ordered = [...normalized].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
      setCommunityMessages(ordered)
    }

    void readThread()
    const intervalId = window.setInterval(() => {
      void readThread()
    }, 2000)

    const handleVisibilityOrOnline = () => {
      if (!document.hidden && navigator.onLine) {
        void readThread()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityOrOnline)
    window.addEventListener('online', handleVisibilityOrOnline)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline)
      window.removeEventListener('online', handleVisibilityOrOnline)
    }
  }, [activeUserId, communityTargetId])

  useEffect(() => {
    if (!communityOpen || !activeUserId || !communityTargetId) {
      return
    }
    markCommunityMessagesAsSeenForMember(communityTargetId)
  }, [communityOpen, activeUserId, communityTargetId])

  useEffect(() => {
    if (!activeUserId) {
      setCommunityUnreadCount(0)
      setCommunityUnreadByMember({})
      return
    }

    const scanUnread = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return
      }

      const seenIds = new Set(communitySeenIds)
      const incoming: CommunityMessage[] = []
      const byMember: Record<string, number> = {}

      if (isSupabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase
            .from('community_messages')
            .select('id, sender_id, recipient_id, text, attachments_json, sent_at')
            .eq('recipient_id', activeUserId)
            .order('sent_at', { ascending: true })
          if (error) {
            console.warn('No se pudieron escanear mensajes nuevos en Supabase:', error.message)
            return
          }
          for (const row of data ?? []) {
            const message = mapRemoteCommunityMessage(row as RemoteCommunityMessageRow)
            if (seenIds.has(message.id)) {
              continue
            }
            incoming.push(message)
            byMember[message.senderId] = (byMember[message.senderId] ?? 0) + 1
          }
        } catch (err) {
          console.warn('Fallo de red temporal al escanear mensajes:', err)
          return
        }
      } else {
        for (const member of seedUsers) {
          if (member.id === activeUserId) {
            continue
          }
          const threadKey = communityThreadStorageKey(activeUserId, member.id)
          const thread: CommunityMessage[] = readJsonStorage<CommunityMessage[]>(threadKey, [])
          let memberUnread = 0
          for (const message of thread as CommunityMessage[]) {
            if (message.recipientId === activeUserId && !seenIds.has(message.id)) {
              incoming.push(message)
              memberUnread += 1
            }
          }
          byMember[member.id] = memberUnread
        }
      }

      for (const member of seedUsers) {
        if (member.id === activeUserId) {
          continue
        }
        if (!Object.prototype.hasOwnProperty.call(byMember, member.id)) {
          byMember[member.id] = 0
        }
      }

      incoming.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
      setCommunityUnreadCount(incoming.length)
      setCommunityUnreadByMember(byMember)

      const latest = incoming[incoming.length - 1]
      if (latest && latest.sentAt !== lastCommunityNotifiedAtRef.current) {
        lastCommunityNotifiedAtRef.current = latest.sentAt
        const sender = seedUsers.find((user) => user.id === latest.senderId)
        const isBroadcast = latest.text.startsWith('📢')
        const noticeText = isBroadcast
          ? '📢 Novedad del administrador'
          : sender
            ? `nuevo mensaje de ${sender.fullName}`
            : 'nuevo mensaje en comunidad'
        setFloatingNotice(noticeText)
        if (floatingTimerRef.current) {
          window.clearTimeout(floatingTimerRef.current)
        }
        floatingTimerRef.current = window.setTimeout(() => {
          setFloatingNotice(null)
          floatingTimerRef.current = null
        }, 3200)

        // Enviar notificación al sistema operativo / celular
        const notifTitle = isBroadcast
          ? '📢 Dr Happy: Novedades de la plataforma'
          : sender
            ? `${sender.fullName} te ha enviado un mensaje`
            : 'Nuevo mensaje en Dr Happy'
        const notifBody = latest.text
          ? latest.text.length > 90
            ? latest.text.slice(0, 87) + '...'
            : latest.text
          : latest.attachments?.length
            ? 'Te ha enviado un archivo adjunto'
            : 'Tienes un nuevo mensaje'

        void showAppNotification(notifTitle, {
          body: notifBody,
          tag: `drhappy-chat-${latest.senderId}`,
        })
      }
    }

    void scanUnread()
    const intervalId = window.setInterval(() => {
      void scanUnread()
    }, 2500)

    let realtimeChannel: RealtimeChannel | null = null
    if (isSupabaseConfigured && supabase) {
      realtimeChannel = supabase
        .channel(`incoming-messages-${activeUserId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'community_messages',
            filter: `recipient_id=eq.${activeUserId}`,
          },
          (payload) => {
            const newRow = payload.new as RemoteCommunityMessageRow
            const message = mapRemoteCommunityMessage(newRow)
            const sender = seedUsers.find((user) => user.id === message.senderId)
            const isBroadcast = message.text.startsWith('📢')
            const notifTitle = isBroadcast
              ? '📢 Dr Happy: Novedades de la plataforma'
              : sender
                ? `${sender.fullName} te ha enviado un mensaje`
                : 'Nuevo mensaje en Dr Happy'
            const notifBody = message.text
              ? message.text.length > 90
                ? message.text.slice(0, 87) + '...'
                : message.text
              : message.attachments?.length
                ? 'Te ha enviado un archivo adjunto'
                : 'Tienes un nuevo mensaje'

            void showAppNotification(notifTitle, {
              body: notifBody,
              tag: `drhappy-chat-${message.senderId}`,
            })
            void scanUnread()
          },
        )
        .subscribe()
    }

    const handleVisibilityOrOnline = () => {
      if (navigator.onLine) {
        void scanUnread()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityOrOnline)
    window.addEventListener('online', handleVisibilityOrOnline)

    return () => {
      window.clearInterval(intervalId)
      if (realtimeChannel && supabase) {
        void supabase.removeChannel(realtimeChannel)
      }
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline)
      window.removeEventListener('online', handleVisibilityOrOnline)
    }
  }, [activeUserId, communitySeenIds, seedUsers])

  useEffect(() => {
    if (workspaceLayer !== 'profile') {
      return
    }
    const canvas = signatureCanvasRef.current
    if (!canvas || !profile) {
      return
    }

    void setupSignatureCanvas(canvas, profile.signatureImage?.dataUrl).then((hasExisting) => {
      signatureHasStrokeRef.current = hasExisting
    })
  }, [workspaceLayer, profile?.signatureImage?.dataUrl])

  function showSavedFloatingNotice(message = 'Datos guardados'): void {
    setFloatingNotice(message)
    if (floatingTimerRef.current) {
      window.clearTimeout(floatingTimerRef.current)
    }
    floatingTimerRef.current = window.setTimeout(() => {
      setFloatingNotice(null)
      floatingTimerRef.current = null
    }, 2600)
  }

  function persistCommunitySeenIds(nextSeenIds: string[]): void {
    if (!activeUserId) {
      return
    }

    localStorage.setItem(communitySeenStorageKey(activeUserId), JSON.stringify(nextSeenIds))
    setCommunitySeenIds(nextSeenIds)
    const workspaceProfile = profile ?? (activeUser ? profileFromSeed(activeUser) : null)
    if (!workspaceProfile) {
      return
    }

    const nextProfile = {
      ...workspaceProfile,
      communitySeenMessageIds: nextSeenIds,
    }
    setProfile(nextProfile)
    void persistWorkspaceRemote(activeUserId, nextProfile, patients, appointments)
  }

  function markCommunityMessagesAsSeenForMember(memberId: string): void {
    if (!activeUserId) {
      return
    }

    const currentSeen = new Set(communitySeenIds)
    const markSeen = async () => {
      let incomingForMember: CommunityMessage[] = []
      if (isSupabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase
            .from('community_messages')
            .select('id, sender_id, recipient_id, text, attachments_json, sent_at')
            .eq('sender_id', memberId)
            .eq('recipient_id', activeUserId)
            .order('sent_at', { ascending: true })
          if (error) {
            console.warn('No se pudieron actualizar mensajes vistos:', error.message)
            return
          }
          incomingForMember = (data ?? []).map((row) =>
            mapRemoteCommunityMessage(row as RemoteCommunityMessageRow),
          )
        } catch (err) {
          console.warn('Fallo de red al marcar mensajes vistos:', err)
          return
        }
      } else {
        const thread: CommunityMessage[] = readJsonStorage<CommunityMessage[]>(
          communityThreadStorageKey(activeUserId, memberId),
          [],
        )
        incomingForMember = thread.filter((message) => message.recipientId === activeUserId)
      }

      let marked = 0
      for (const message of incomingForMember) {
        if (!currentSeen.has(message.id)) {
          currentSeen.add(message.id)
          marked += 1
        }
      }

      persistCommunitySeenIds(Array.from(currentSeen))
      if (marked > 0) {
        setCommunityUnreadByMember((current) => ({ ...current, [memberId]: 0 }))
        setCommunityUnreadCount((current) => Math.max(0, current - marked))
      }
    }

    void markSeen()
  }

  function persistProfile(nextProfile: ProfessionalProfile): void {
    if (!activeUserId) {
      return
    }
    localStorage.setItem(profileStorageKey(activeUserId), JSON.stringify(nextProfile))
    void persistWorkspaceRemote(activeUserId, nextProfile, patients, appointments)
  }

  async function syncProfessionalFromProfile(nextProfile: ProfessionalProfile): Promise<void> {
    if (!activeUserId) {
      return
    }

    const nextFullName = nextProfile.fullName.trim()
    const nextSpecialty = nextProfile.specialty.trim()
    const nextLicenseNumber = nextProfile.licenseNumber.trim()
    const nextEmail = nextProfile.email.trim()

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('professionals')
        .update({
          full_name: nextFullName,
          specialty: nextSpecialty,
          license_number: nextLicenseNumber,
          email: nextEmail,
        })
        .eq('id', activeUserId)
      if (error) {
        throw new Error(`No se pudo sincronizar el perfil profesional: ${error.message}`)
      }
    }

    setSeedUsers((current) =>
      current.map((user) =>
        user.id === activeUserId
          ? {
              ...user,
              fullName: nextFullName,
              specialty: nextSpecialty,
              licenseNumber: nextLicenseNumber,
              email: nextEmail,
            }
          : user,
      ),
    )

    const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
    localStorage.setItem(
      CREATED_USERS_KEY,
      JSON.stringify(
        localUsers.map((user) =>
          user.id === activeUserId
            ? {
                ...user,
                fullName: nextFullName,
                specialty: nextSpecialty,
                licenseNumber: nextLicenseNumber,
                email: nextEmail,
              }
            : user,
        ),
      ),
    )
  }

  function persistPatientsBatch(nextPatients: PatientRecord[]): void {
    if (!activeUserId) {
      return
    }

    const ownerIndex = readJsonStorage<string[]>(patientIndexStorageKey(activeUserId), [])
    const nextOwnerIndex = [...ownerIndex]
    const registry = new Set(readJsonStorage<string[]>(PATIENT_REGISTRY_KEY, []))
    const normalizedPatients = nextPatients.map((patient) => ({
      ...patient,
      ownerUserId: patient.ownerUserId || activeUserId,
    }))

    for (const nextPatient of normalizedPatients) {
      localStorage.setItem(patientGlobalStorageKey(nextPatient.id), JSON.stringify(nextPatient))
      registry.add(nextPatient.id)
      if (
        nextPatient.ownerUserId === activeUserId &&
        !nextOwnerIndex.includes(nextPatient.id)
      ) {
        nextOwnerIndex.push(nextPatient.id)
      }
    }

    localStorage.setItem(PATIENT_REGISTRY_KEY, JSON.stringify(Array.from(registry)))
    localStorage.setItem(patientIndexStorageKey(activeUserId), JSON.stringify(nextOwnerIndex))

    const nextPatientsMap = new Map(patients.map((entry) => [entry.id, entry]))
    const nextAvailableMap = new Map(availablePatients.map((entry) => [entry.id, entry]))
    for (const nextPatient of normalizedPatients) {
      nextPatientsMap.set(nextPatient.id, nextPatient)
      nextAvailableMap.set(nextPatient.id, nextPatient)
    }
    const persistedPatients = sortPatientsByName(Array.from(nextPatientsMap.values()))
    const persistedAvailable = sortPatientsByName(Array.from(nextAvailableMap.values()))
    setPatients(persistedPatients)
    setAvailablePatients(persistedAvailable)
    const workspaceProfile = profile ?? (activeUser ? profileFromSeed(activeUser) : null)
    if (workspaceProfile) {
      void persistWorkspaceRemote(activeUserId, workspaceProfile, persistedPatients, appointments)
    }
  }

  function persistPatient(nextPatient: PatientRecord): void {
    persistPatientsBatch([nextPatient])
  }

  function persistPatientConsultation(patientId: string, entry: ConsultationEntry): void {
    const patient = patients.find((p) => p.id === patientId)
    if (!patient) {
      return
    }
    const record: PatientRecord = {
      ...patient,
      consultations: [entry, ...patient.consultations],
      updatedAt: new Date().toISOString(),
    }
    persistPatient(record)
  }

  function resetRecoveryForm(): void {
    setRecoveryOpen(false)
    setRecoveryRequested(false)
    setRecoveryEmail('')
    setRecoveryCode('')
    setRecoveryPassword('')
    setRecoveryDemoCode(null)
    setAuthError(null)
  }

  async function handleRequestPasswordRecovery(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalizedEmail = recoveryEmail.trim().toLowerCase()
    const user = seedUsers.find((entry) => entry.email.trim().toLowerCase() === normalizedEmail)

    setAuthError(null)
    setRecoveryRequested(true)
    setRecoveryCode('')
    setRecoveryPassword('')
    if (!user) {
      setRecoveryDemoCode(null)
      setAppNotice(
        'Si el correo está registrado, recibirás las instrucciones de recuperación.',
      )
      return
    }

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
    const challenge: PasswordRecoveryChallenge = {
      userId: user.id,
      code,
      expiresAt: computeGrantExpiryIso(0.25),
    }
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('password_recovery_challenges').upsert(
        {
          user_id: challenge.userId,
          code: challenge.code,
          expires_at: challenge.expiresAt,
        },
        { onConflict: 'user_id' },
      )
      if (error) {
        setAuthError(`No se pudo generar el código de recuperación: ${error.message}`)
        return
      }
    } else {
      localStorage.setItem(PASSWORD_RECOVERY_KEY, JSON.stringify(challenge))
    }
    setRecoveryDemoCode(code)
    setAppNotice('Código de recuperación generado. Tiene una vigencia de 15 minutos.')
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalizedEmail = recoveryEmail.trim().toLowerCase()
    const user = seedUsers.find((entry) => entry.email.trim().toLowerCase() === normalizedEmail)
    let challenge: PasswordRecoveryChallenge | null = null
    if (isSupabaseConfigured && supabase && user) {
      const { data, error } = await supabase
        .from('password_recovery_challenges')
        .select('user_id, code, expires_at')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) {
        setAuthError(`No se pudo validar el código de recuperación: ${error.message}`)
        return
      }
      if (data) {
        const remoteChallenge = data as RemotePasswordRecoveryRow
        challenge = {
          userId: remoteChallenge.user_id,
          code: remoteChallenge.code,
          expiresAt: remoteChallenge.expires_at,
        }
      }
    } else {
      challenge = readJsonStorage<PasswordRecoveryChallenge | null>(PASSWORD_RECOVERY_KEY, null)
    }
    const isChallengeValid =
      user &&
      challenge &&
      challenge.userId === user.id &&
      challenge.code === recoveryCode.trim() &&
      new Date(challenge.expiresAt).getTime() > Date.now()

    if (!isChallengeValid) {
      setAuthError('El código es inválido o venció. Solicita uno nuevo.')
      return
    }
    if (recoveryPassword.length < 8) {
      setAuthError('La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }

    if (isSupabaseConfigured && supabase) {
      const { error: updateError } = await supabase
        .from('professionals')
        .update({ password: recoveryPassword })
        .eq('id', user.id)
      if (updateError) {
        setAuthError(`No se pudo actualizar la contraseña: ${updateError.message}`)
        return
      }
      const { error: deleteError } = await supabase
        .from('password_recovery_challenges')
        .delete()
        .eq('user_id', user.id)
      if (deleteError) {
        setAuthError(`No se pudo cerrar la recuperación: ${deleteError.message}`)
        return
      }
    } else {
      const passwordOverrides = readJsonStorage<Record<string, string>>(PASSWORD_OVERRIDES_KEY, {})
      localStorage.setItem(
        PASSWORD_OVERRIDES_KEY,
        JSON.stringify({ ...passwordOverrides, [user.id]: recoveryPassword }),
      )
      localStorage.removeItem(PASSWORD_RECOVERY_KEY)
    }
    setSeedUsers((current) =>
      current.map((entry) =>
        entry.id === user.id ? { ...entry, password: recoveryPassword } : entry,
      ),
    )
    setUsername(user.username)
    setPassword('')
    resetRecoveryForm()
    setAppNotice('Contraseña actualizada. Ya puedes iniciar sesión.')
    showSavedFloatingNotice()
  }

  async function handleGoogleLogin(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      setAuthError('El inicio de sesión con Google requiere Supabase configurado.')
      return
    }
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href.split('#')[0],
        queryParams: {
          prompt: 'select_account',
        },
      },
    })
    if (error) {
      setAuthError(`No se pudo iniciar sesión con Google: ${error.message}`)
    }
  }

  async function handleStartSubscriptionCheckout(plan: SubscriptionPlan): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      setAppError('La suscripción online requiere Supabase configurado.')
      return
    }
    if (!activeUserId) {
      setAppError('Primero iniciá sesión para continuar con la suscripción.')
      return
    }

    const payerEmail = (profile?.email || activeUser?.email || '').trim()
    const fullName = (profile?.fullName || activeUser?.fullName || '').trim()
    if (!payerEmail) {
      setAppError('Completa tu correo profesional antes de iniciar la suscripción.')
      setWorkspaceLayer('profile')
      return
    }

    setAppError(null)
    setAppNotice(null)
    setSubscriptionCheckoutLoading(plan)
    try {
      const { data, error } = await supabase.functions.invoke('create-mercadopago-checkout', {
        body: {
          userId: activeUserId,
          plan,
          email: payerEmail,
          fullName,
        },
      })
      if (error) {
        const maybeError = error as {
          message?: string
          context?: {
            json?: () => Promise<unknown>
            text?: () => Promise<string>
          }
        }
        let detailedMessage = error.message
        if (maybeError.context?.json) {
          const payload = await maybeError.context.json().catch(() => null)
          if (payload && typeof payload === 'object') {
            const candidate = payload as {
              message?: unknown
              details?: unknown
            }
            if (typeof candidate.message === 'string' && candidate.message) {
              detailedMessage = candidate.message
            }
            if (candidate.details && typeof candidate.details === 'object') {
              const detailRecord = candidate.details as Record<string, unknown>
              if (typeof detailRecord.message === 'string' && detailRecord.message) {
                detailedMessage = `${detailedMessage}: ${detailRecord.message}`
              }
            }
          }
        }
        throw new Error(detailedMessage)
      }
      if (!data || typeof data !== 'object') {
        throw new Error('Respuesta inválida del checkout.')
      }
      const response = data as { initPoint?: unknown; sandboxInitPoint?: unknown; message?: unknown }
      const targetUrl =
        (typeof response.initPoint === 'string' && response.initPoint) ||
        (typeof response.sandboxInitPoint === 'string' && response.sandboxInitPoint) ||
        ''
      if (!targetUrl) {
        throw new Error(
          typeof response.message === 'string'
            ? response.message
            : 'MercadoPago no devolvió una URL de pago válida.',
        )
      }
      window.location.assign(targetUrl)
    } catch (error) {
      setAppError(
        error instanceof Error
          ? `No se pudo iniciar el checkout de suscripción: ${error.message}`
          : 'No se pudo iniciar el checkout de suscripción.',
      )
    } finally {
      setSubscriptionCheckoutLoading(null)
    }
  }

  async function resolveGoogleSession(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      return
    }
    const { data } = await supabase.auth.getSession()
    const googleUser = data.session?.user
    if (!googleUser?.email) {
      return
    }

    const email = googleUser.email.toLowerCase()
    const existing = seedUsers.find((entry) => entry.email.toLowerCase() === email)

    if (existing) {
      const metadata =
        googleUser.user_metadata && typeof googleUser.user_metadata === 'object'
          ? (googleUser.user_metadata as Record<string, unknown>)
          : null
      const avatarUrl =
        typeof metadata?.avatar_url === 'string'
          ? metadata.avatar_url
          : typeof metadata?.picture === 'string'
            ? metadata.picture
            : undefined
      setGoogleIdentity({
        email: googleUser.email,
        avatarUrl,
        fullName: typeof metadata?.full_name === 'string' ? metadata.full_name : undefined,
      })
      localStorage.setItem(SESSION_USER_KEY, existing.id)
      await loadWorkspaceForUser(existing)
      setWorkspaceLayer('overview')
      setSelectedPatientId(null)
      return
    }

    // Usuario nuevo vía Google: crear profesional con datos básicos de Google.
    const fullName = (googleUser.user_metadata?.full_name as string | undefined) ?? email.split('@')[0]
    const generatedUsername = email.split('@')[0]
    const draft = {
      username: generatedUsername,
      password: crypto.randomUUID(),
      fullName,
      specialty: '',
      licenseNumber: '',
      email: googleUser.email,
      networkMemberships: [] as string[],
    }

    let nextUser: SeedUser
    const trialStartedAt = new Date().toISOString()
    if (isSupabaseConfigured && supabase) {
      const { data: inserted, error } = await supabase
        .from('professionals')
        .insert({
          username: draft.username,
          password: draft.password,
          full_name: draft.fullName,
          specialty: draft.specialty,
          license_number: draft.licenseNumber,
          email: draft.email,
          network_memberships_json: draft.networkMemberships,
          trial_started_at: trialStartedAt,
          subscription_status: 'trial',
        })
        .select(
          'id, username, password, full_name, specialty, license_number, email, network_memberships_json, trial_started_at, subscription_status',
        )
        .single()
      if (error) {
        setAuthError(`No se pudo crear el usuario con Google: ${error.message}`)
        return
      }
      nextUser = mapRemoteProfessional(inserted as RemoteProfessionalRow)
      await persistWorkspaceRemote(nextUser.id, profileFromSeed(nextUser), [], [])
    } else {
      nextUser = {
        id: crypto.randomUUID(),
        ...draft,
        isAdmin: false,
        active: true,
        trialStartedAt,
        subscriptionStatus: 'trial',
      }
      const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
      localStorage.setItem(CREATED_USERS_KEY, JSON.stringify([...localUsers, nextUser]))
    }

    setSeedUsers((current) => [...current, nextUser])
    {
      const metadata =
        googleUser.user_metadata && typeof googleUser.user_metadata === 'object'
          ? (googleUser.user_metadata as Record<string, unknown>)
          : null
      const avatarUrl =
        typeof metadata?.avatar_url === 'string'
          ? metadata.avatar_url
          : typeof metadata?.picture === 'string'
            ? metadata.picture
            : undefined
      setGoogleIdentity({
        email: googleUser.email,
        avatarUrl,
        fullName: typeof metadata?.full_name === 'string' ? metadata.full_name : undefined,
      })
    }
    localStorage.setItem(SESSION_USER_KEY, nextUser.id)
    await loadWorkspaceForUser(nextUser)
    setWorkspaceLayer('overview')
    setSelectedPatientId(null)
    setAppNotice('Cuenta creada con Google. Completá tu perfil profesional para continuar.')
    showSavedFloatingNotice()
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAuthError(null)
    setAppNotice(null)
    const passwordOverrides = readJsonStorage<Record<string, string>>(PASSWORD_OVERRIDES_KEY, {})
    const user = seedUsers.find(
      (entry) =>
        entry.active !== false &&
        entry.username === username.trim() &&
        (isSupabaseConfigured ? entry.password : passwordOverrides[entry.id] ?? entry.password) ===
          password,
    )
    if (!user) {
      setAuthError('Usuario o contraseña inválidos o usuario inactivo.')
      return
    }

    try {
      localStorage.setItem(SESSION_USER_KEY, user.id)
      await loadWorkspaceForUser(user)
      setWorkspaceLayer('overview')
      setSelectedPatientId(null)
      setPassword('')
    } catch (error) {
      setAppError(
        error instanceof Error
          ? `No se pudieron cargar datos del profesional: ${error.message}`
          : 'No se pudieron cargar datos del profesional.',
      )
    }
  }

  function handleRegisterFieldChange(event: ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.target
    setRegisterDraft((current) => ({ ...current, [name]: value }))
  }

  function handleRegisterNetworkToggle(network: string): void {
    setRegisterDraft((current) => {
      const isSelected = current.networkMemberships.includes(network)
      return {
        ...current,
        networkMemberships: isSelected
          ? current.networkMemberships.filter((entry) => entry !== network)
          : [...current.networkMemberships, network],
      }
    })
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAuthError(null)
    setAppNotice(null)

    const draft = {
      firstName: registerDraft.firstName.trim(),
      lastName: registerDraft.lastName.trim(),
      specialty: registerDraft.specialty.trim(),
      licenseNumber: registerDraft.licenseNumber.trim(),
      email: registerDraft.email.trim(),
      username: registerDraft.username.trim(),
      password: registerDraft.password,
      networkMemberships: registerDraft.networkMemberships,
    }
    const fullName = `${draft.firstName} ${draft.lastName}`.trim()

    if (
      !draft.firstName ||
      !draft.lastName ||
      !draft.specialty ||
      !draft.licenseNumber ||
      !draft.email ||
      !draft.username ||
      !draft.password
    ) {
      setAuthError('Completa todos los campos para crear el usuario.')
      return
    }

    const usernameExists = seedUsers.some(
      (user) => user.username.toLowerCase() === draft.username.toLowerCase(),
    )
    if (usernameExists) {
      setAuthError('Ese nombre de usuario ya existe.')
      return
    }

    let nextUser: SeedUser
    if (isSupabaseConfigured && supabase) {
      const trialStartedAt = new Date().toISOString()
      const { data, error } = await supabase
        .from('professionals')
        .insert({
          username: draft.username,
          password: draft.password,
          full_name: fullName,
          specialty: draft.specialty,
          license_number: draft.licenseNumber,
          email: draft.email,
          network_memberships_json: draft.networkMemberships,
          trial_started_at: trialStartedAt,
          subscription_status: 'trial',
        })
        .select(
          'id, username, password, full_name, specialty, license_number, email, network_memberships_json, active, trial_started_at, subscription_status, subscription_expires_at',
        )
        .single()
      if (error) {
        setAuthError(`No se pudo crear el usuario en la base remota: ${error.message}`)
        return
      }
      nextUser = mapRemoteProfessional(data as RemoteProfessionalRow)
      await persistWorkspaceRemote(nextUser.id, profileFromSeed(nextUser), [], [])
    } else {
      nextUser = {
        id: crypto.randomUUID(),
        username: draft.username,
        password: draft.password,
        fullName,
        specialty: draft.specialty,
        licenseNumber: draft.licenseNumber,
        email: draft.email,
        networkMemberships: draft.networkMemberships,
        isAdmin: false,
        active: true,
        trialStartedAt: new Date().toISOString(),
        subscriptionStatus: 'trial',
      }
      const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
      localStorage.setItem(CREATED_USERS_KEY, JSON.stringify([...localUsers, nextUser]))
    }

    setSeedUsers((current) => [...current, nextUser])
    setRegisterOpen(false)
    setRegisterDraft(emptyRegisterDraft)
    setUsername(nextUser.username)
    setPassword(nextUser.password)
    setAppNotice('Usuario creado. Ya puedes iniciar sesión con el nuevo profesional.')
    showSavedFloatingNotice()
  }

  async function handleToggleUserActive(userId: string): Promise<void> {
    const targetUser = seedUsers.find((user) => user.id === userId)
    if (!targetUser || isAdminUser(targetUser)) {
      return
    }

    const nextActive = targetUser.active === false
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('professionals').update({ active: nextActive }).eq('id', userId)
      if (error) {
        setAppError(
          `No se pudo actualizar el estado del usuario: ${error.message}. Si falta la columna active, agrega la migración indicada en README.`,
        )
        return
      }
    } else {
      const currentOverrides = readJsonStorage<Record<string, boolean>>(USER_ACTIVE_OVERRIDES_KEY, {})
      localStorage.setItem(
        USER_ACTIVE_OVERRIDES_KEY,
        JSON.stringify({ ...currentOverrides, [userId]: nextActive }),
      )
    }

    setSeedUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, active: nextActive } : user)),
    )
    if (!nextActive && communityTargetId === userId) {
      setCommunityTargetId(null)
      setCommunityMessages([])
    }
    setAppNotice(nextActive ? 'Usuario activado correctamente.' : 'Usuario desactivado correctamente.')
  }

  async function handleLogout(): Promise<void> {
    stopLiveScanner()
    stopDictation()
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut()
    }
    localStorage.removeItem(SESSION_USER_KEY)
    setGoogleIdentity(null)
    setActiveUserId(null)
    setProfile(null)
    setPatients([])
    setAvailablePatients([])
    setAppointments([])
    setSelectedPatientId(null)
    setPatientSearchQuery('')
    setPatientDraft(emptyPatientDraft)
    setConsultationDraft(emptyConsultationDraft)
    setCommunityOpen(false)
    setCommunityTargetId(null)
    setCommunitySearchQuery('')
    setCommunityNetworkFilters([])
    setCommunityDraftText('')
    setCommunityDraftFiles([])
    setCommunityDragActive(false)
    setCommunityMessages([])
    setCommunitySeenIds([])
    setCommunityUnreadCount(0)
    setCommunityUnreadByMember({})
    setWorkspaceLayer('overview')
    setAppNotice(null)
  }

  function stopLiveScanner(): void {
    liveScanSessionRef.current += 1
    if (liveScanRafRef.current !== null) {
      window.cancelAnimationFrame(liveScanRafRef.current)
      window.clearTimeout(liveScanRafRef.current)
      liveScanRafRef.current = null
    }
    if (liveScanStreamRef.current) {
      for (const track of liveScanStreamRef.current.getTracks()) {
        track.stop()
      }
      liveScanStreamRef.current = null
    }
    if (liveScanVideoRef.current) {
      liveScanVideoRef.current.srcObject = null
    }
    liveDecodeBusyRef.current = false
    lastLiveDetectedRawRef.current = ''
    lastLiveDetectedAtRef.current = 0
    setLiveScanTarget(null)
    setLiveScanStatus('')
  }

  async function waitForLiveScanVideo(sessionId: number): Promise<HTMLVideoElement> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (sessionId !== liveScanSessionRef.current) {
        throw new Error('El escaneo fue cancelado.')
      }
      const video = liveScanVideoRef.current
      if (video) {
        return video
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 50)
      })
    }
    throw new Error('No se pudo preparar la vista previa de cámara para escanear.')
  }

  function applyPatientAutofill(
    fields: Partial<Pick<PatientDraft, 'nombre' | 'apellido' | 'dni' | 'birthDate' | 'obraSocial' | 'numeroAfiliado' | 'plan'>>,
  ): boolean {
    let changed = false
    setPatientDraft((current) => {
      const next: PatientDraft = { ...current }
      const autofillKeys: Array<
        keyof Pick<
          PatientDraft,
          'nombre' | 'apellido' | 'dni' | 'birthDate' | 'obraSocial' | 'numeroAfiliado' | 'plan'
        >
      > = ['nombre', 'apellido', 'dni', 'birthDate', 'obraSocial', 'numeroAfiliado', 'plan']

      for (const key of autofillKeys) {
        const incoming = fields[key]
        if (typeof incoming !== 'string') {
          continue
        }
        const value = incoming.trim()
        if (!value || current[key] === value) {
          continue
        }
        next[key] = value
        changed = true
      }

      return changed ? next : current
    })
    return changed
  }

  async function handleCaptureScannerPhoto(): Promise<void> {
    const video = liveScanVideoRef.current
    if (!video || !liveScanTarget) {
      setAppError('No hay una vista previa de cámara disponible para tomar la foto.')
      return
    }

    const snapshot = captureScanFrame(video, liveScanTarget === 'dni' ? 'dni-scan' : 'credencial-scan')
    if (!snapshot) {
      setAppError('No se pudo capturar la foto del documento para analizarlo.')
      return
    }

    if (liveScanTarget === 'dni') {
      setPatientDraft((current) => ({ ...current, dniPhoto: snapshot }))
    } else {
      setPatientDraft((current) => ({ ...current, photoCarnet: snapshot }))
    }

    setLiveScanStatus(
      liveScanTarget === 'dni'
        ? 'Analizando foto del DNI…'
        : 'Analizando foto de la credencial…',
    )

    try {
      if (liveScanTarget === 'dni') {
        const parsed = await parseDniFromImageUrlWithZxing(snapshot.dataUrl)
        if (!parsed || !hasParsedDniData(parsed)) {
          setAppNotice('Foto capturada. No encontré datos legibles en el DNI, pero la imagen quedó guardada para revisarla.')
          setLiveScanStatus('Foto guardada. El DNI no tuvo datos legibles en el código.')
          return
        }
        const changed = applyPatientAutofill(parsed)
        setAppNotice(
          changed
            ? 'Foto del DNI analizada: se autocompletaron datos del paciente.'
            : 'La foto del DNI fue procesada y los datos ya estaban completos.',
        )
      } else {
        const parsed = await parseQrFromImageUrlWithZxing(snapshot.dataUrl)
        if (!parsed) {
          setAppNotice('Foto capturada. No encontré datos legibles en la credencial, pero la imagen quedó guardada para revisarla.')
          setLiveScanStatus('Foto guardada. La credencial no tuvo datos legibles en el código.')
          return
        }
        const changed = applyPatientAutofill(parsed)
        setAppNotice(
          changed
            ? 'Foto de la credencial analizada: se autocompletaron datos de cobertura.'
            : 'La foto de la credencial fue procesada y los datos ya estaban completos.',
        )
      }

      stopLiveScanner()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo analizar la foto tomada.'
      setAppError(message)
      stopLiveScanner()
    }
  }

  async function handleReadSavedScannerPhoto(): Promise<void> {
    if (!liveScanTarget) {
      setAppError('Abre primero el escáner para leer una foto guardada.')
      return
    }

    const savedPhoto =
      liveScanTarget === 'dni' ? patientDraft.dniPhoto : patientDraft.photoCarnet

    if (!savedPhoto) {
      setAppNotice('Todavía no hay una foto guardada para leer. Toma una foto del documento.')
      return
    }

    setLiveScanStatus(
      liveScanTarget === 'dni'
        ? 'Leyendo la foto guardada del DNI…'
        : 'Leyendo la foto guardada de la credencial…',
    )

    try {
      const parsed =
        liveScanTarget === 'dni'
          ? await parseDniFromImageUrlWithZxing(savedPhoto.dataUrl)
          : await parseQrFromImageUrlWithZxing(savedPhoto.dataUrl)

      if (!parsed || !((liveScanTarget === 'dni' && hasParsedDniData(parsed)) || (liveScanTarget !== 'dni' && (parsed.obraSocial || parsed.numeroAfiliado || parsed.plan)))) {
        setAppNotice('La foto guardada no tuvo datos legibles. Reencuadra o toma otra foto.')
        setLiveScanStatus('La foto guardada no pudo ser leída.')
        return
      }

      const changed = applyPatientAutofill(parsed)
      setAppNotice(
        changed
          ? `Foto guardada leída: se autocompletaron los datos del ${liveScanTarget === 'dni' ? 'DNI' : 'carnet'}.`
          : 'La foto guardada fue leída y los datos ya estaban completos.',
      )
      stopLiveScanner()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo leer la foto guardada.'
      setAppError(message)
    }
  }

  async function startLiveScanner(target: LiveScanTarget): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAppError('Tu navegador no permite abrir la cámara para escaneo en vivo.')
      return
    }

    stopLiveScanner()
    setAppError(null)
    setLiveScanTarget(target)
    setLiveScanStatus('Iniciando cámara…')
    liveDecodeBusyRef.current = false
    lastLiveDetectedRawRef.current = ''
    lastLiveDetectedAtRef.current = 0
    const sessionId = liveScanSessionRef.current + 1
    liveScanSessionRef.current = sessionId

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280, max: 4032 },
          height: { ideal: 960, max: 3024 },
          frameRate: { ideal: 30, max: 60 },
        },
      })
      if (sessionId !== liveScanSessionRef.current) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }

      liveScanStreamRef.current = stream
      const video = await waitForLiveScanVideo(sessionId)
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error('No se pudo inicializar la cámara para escaneo.'))
        }, 3500)
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded)
          video.removeEventListener('error', onError)
          window.clearTimeout(timeoutId)
          resolve()
        }
        const onError = () => {
          video.removeEventListener('loadedmetadata', onLoaded)
          video.removeEventListener('error', onError)
          window.clearTimeout(timeoutId)
          reject(new Error('No se pudo abrir la cámara para escanear.'))
        }
        video.addEventListener('loadedmetadata', onLoaded, { once: true })
        video.addEventListener('error', onError, { once: true })
        video.srcObject = stream
      })
      video.setAttribute('playsinline', 'true')
      await video.play().catch(() => undefined)
      setLiveScanStatus(
        target === 'dni'
          ? 'Cámara lista. Toma la foto del frente del DNI y luego presiona “Leer foto guardada”.'
          : 'Cámara lista. Toma la foto de la credencial y luego presiona “Leer foto guardada”.',
      )

      // El escaneo automático se desactiva por compatibilidad móvil. La lectura robusta se hace
      // siempre a partir de la foto capturada del documento y la lectura manual posterior.
      liveDecodeBusyRef.current = false
      lastLiveDetectedRawRef.current = ''
      lastLiveDetectedAtRef.current = 0
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo abrir la cámara para escaneo.'
      stopLiveScanner()
      setAppError(message)
    }
  }

  async function autofillFromDniBarcode(file: File): Promise<void> {
    let parsed: Partial<PatientDraft> | null =
      (await detectBarcodesFromImage(file, ['pdf417']))
        .map((item) => parseDniFromBarcode(item.rawValue))
        .find((entry) => hasParsedDniData(entry)) ?? null

    if (!parsed) {
      parsed = await parseDniFromFileWithZxing(file)
    }

    if (!parsed) {
      setAppNotice('No encontré datos legibles en el código de barras del DNI.')
      return
    }

    const changed = applyPatientAutofill(parsed)
    setAppNotice(
      changed
        ? 'DNI escaneado: se autocompletaron datos de la ficha.'
        : 'DNI leído correctamente, pero los datos ya estaban cargados.',
    )
  }

  async function autofillFromInsuranceQr(file: File): Promise<void> {
    let parsed: Partial<PatientDraft> | null =
      (await detectBarcodesFromImage(file, ['qr_code']))
        .map((item) => parseInsuranceFromQr(item.rawValue))
        .find((entry) => entry.obraSocial || entry.numeroAfiliado || entry.plan) ?? null

    if (!parsed) {
      parsed = await parseInsuranceFromFileWithZxing(file)
    }

    if (!parsed) {
      setAppNotice('No encontré datos de obra social/afiliado en el QR del carnet.')
      return
    }

    const changed = applyPatientAutofill(parsed)
    setAppNotice(
      changed
        ? 'QR escaneado: se autocompletaron obra social, afiliado y plan.'
        : 'QR leído correctamente, pero los datos ya estaban cargados.',
    )
  }

  async function handleSingleUpload(
    event: ChangeEvent<HTMLInputElement>,
    field: 'photoCarnet' | 'dniPhoto' | 'matriculaPhoto' | 'signatureImage',
  ): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    const storedFile = await fileToStoredFile(file)
    if (field === 'photoCarnet' || field === 'dniPhoto') {
      setPatientDraft((current) => ({ ...current, [field]: storedFile }))
      setAppError(null)
      try {
        if (field === 'dniPhoto') {
          await autofillFromDniBarcode(file)
        } else {
          await autofillFromInsuranceQr(file)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo escanear el código.'
        setAppError(message)
      }
      return
    }

    if (profile) {
      const nextProfile = { ...profile, [field]: storedFile }
      setProfile(nextProfile)
      persistProfile(nextProfile)
    }
  }

  function openFileDialog(inputId: string): void {
    const input = document.getElementById(inputId)
    if (!input || !(input instanceof HTMLInputElement)) {
      setAppError('No se pudo abrir la cámara/galería en este dispositivo.')
      return
    }
    input.click()
  }

  async function handleDocumentsUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) {
      return
    }

    const patientName = `${patientDraft.nombre} ${patientDraft.apellido}`.trim() || 'Paciente'

    const storedFiles = await Promise.all(
      files.map(async (file) => {
        const stored = await fileToStoredFile(file)
        const lower = file.name.toLowerCase()
        const ext = lower.includes('.') ? lower.split('.').pop() ?? '' : ''
        let prefix = 'Documento'
        if (/\bdni\b/.test(lower)) prefix = 'DNI'
        else if (/carnet|credencial|obrasocial|obra_social/.test(lower)) prefix = 'Credencial'
        else if (/historia|clinica|hc\b/.test(lower)) prefix = 'HistoriaClinica'
        else if (/receta|prescription/.test(lower)) prefix = 'Receta'
        else if (/laborat|lab\b/.test(lower)) prefix = 'Laboratorio'
        else if (/image|foto|photo/.test(lower) || file.type.startsWith('image/')) prefix = 'Imagen'
        const structuredName = `${prefix}-${patientName}${ext ? '.' + ext : ''}`.replace(/\s+/g, '_')
        return { ...stored, name: structuredName }
      }),
    )
    setPatientDraft((current) => ({
      ...current,
      documents: [...current.documents, ...storedFiles],
    }))
  }

  function handlePatientDraftChange(
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    const { name, value } = event.target
    setPatientDraft((current) => ({ ...current, [name]: value }))
  }

  function handleConsultationDraftChange(
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    const { name, value } = event.target
    setConsultationDraft((current) => ({ ...current, [name]: value }))
  }

  function stopDictation(): void {
    const recognition = recognitionRef.current
    if (!recognition) {
      return
    }
    recognitionRef.current = null
    recognition.stop()
    dictationCommittedTextRef.current = ''
    setDictating(false)
    setDictationField(null)
    setAppNotice('Dictado detenido.')
  }

  async function startDictationForConsultationField(
    field: DictationConsultationField,
  ): Promise<void> {
    const SpeechRecognitionApi = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRecognitionApi) {
      setAppError('Este navegador no soporta dictado por voz.')
      return
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
      }
    } catch {
      setAppError('No se pudo acceder al micrófono. Revisa permisos del navegador.')
      return
    }

    setAppError(null)
    const fieldLabel =
      field === 'detalleAtencion' ? 'resumen de atención' : 'pensamiento médico'
    setAppNotice(`Dictado activado en ${fieldLabel}. Habla para transcribir.`)
    dictationBaseTextRef.current = consultationDraft[field].trim()
    dictationCommittedTextRef.current = ''
    dictationHadErrorRef.current = false

    const previous = recognitionRef.current
    recognitionRef.current = null
    previous?.stop()

    const recognition = new SpeechRecognitionApi()
    const isAndroidDevice = /Android/i.test(window.navigator.userAgent)
    recognition.lang = 'es-AR'
    recognition.interimResults = !isAndroidDevice
    recognition.continuous = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      if (isAndroidDevice) {
        let appendedAny = false
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index] ?? event.results.item(index)
          if (!result || !result.isFinal) {
            continue
          }

          const fragment = result[0].transcript.trim().replace(/\s+/g, ' ')
          if (!fragment) {
            continue
          }

          const currentCommitted = dictationCommittedTextRef.current.trim()
          if (currentCommitted.endsWith(fragment)) {
            continue
          }

          dictationCommittedTextRef.current = currentCommitted
            ? `${currentCommitted} ${fragment}`.trim()
            : fragment
          appendedAny = true
        }

        if (appendedAny) {
          const base = dictationBaseTextRef.current
          setConsultationDraft((current) => ({
            ...current,
            [field]: [base, dictationCommittedTextRef.current].filter(Boolean).join(' ').trim(),
          }))
        }
        return
      }

      const finalFragments: string[] = []
      const interimFragments: string[] = []
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index] ?? event.results.item(index)
        if (!result) {
          continue
        }

        const fragment = result[0].transcript.trim().replace(/\s+/g, ' ')
        if (!fragment) {
          continue
        }
        if (result.isFinal) {
          finalFragments.push(fragment)
        } else {
          interimFragments.push(fragment)
        }
      }

      const base = dictationBaseTextRef.current
      const finalText = finalFragments.join(' ').trim()
      const interimText = interimFragments.join(' ').trim()
      setConsultationDraft((current) => ({
        ...current,
        [field]: [base, finalText, interimText].filter(Boolean).join(' ').trim(),
      }))
    }

    recognition.onerror = (event) => {
      dictationHadErrorRef.current = true
      setDictating(false)
      setDictationField(null)
      setAppError(mapDictationError(event.error))
    }

    recognition.onend = () => {
      setDictating(false)
      setDictationField(null)
      dictationCommittedTextRef.current = ''
      if (!dictationHadErrorRef.current) {
        setAppNotice('Dictado finalizado.')
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setDictating(true)
      setDictationField(field)
    } catch {
      setAppError('No se pudo iniciar el dictado. Intenta nuevamente.')
      setDictating(false)
      setDictationField(null)
    }
  }

  function handleProfileFieldChange(event: ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.target
    if (!profile || !name) {
      return
    }
    setProfile({ ...profile, [name]: value })
  }

  function handlePasswordChangeField(event: ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.target
    setPasswordChangeDraft((current) => ({ ...current, [name]: value }))
  }

  function getCanvasPoint(
    canvas: HTMLCanvasElement,
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    }
  }

  function handleSignaturePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = signatureCanvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      setAppError('No se pudo inicializar el pad de firma.')
      return
    }

    const point = getCanvasPoint(canvas, event)
    signatureDrawingRef.current = true
    signatureHasStrokeRef.current = true
    context.beginPath()
    context.moveTo(point.x, point.y)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleSignaturePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!signatureDrawingRef.current) {
      return
    }
    const canvas = signatureCanvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const point = getCanvasPoint(canvas, event)
    context.lineTo(point.x, point.y)
    context.stroke()
  }

  function handleSignaturePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!signatureDrawingRef.current) {
      return
    }
    signatureDrawingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleClearSignaturePad(): void {
    const canvas = signatureCanvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      setAppError('No se pudo limpiar el pad de firma.')
      return
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.lineWidth = 2.2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#0f172a'
    signatureHasStrokeRef.current = false
    setAppNotice('Pad de firma limpio.')
  }

  function handleSaveHandwrittenSignature(): void {
    if (!profile) {
      return
    }
    const canvas = signatureCanvasRef.current
    if (!canvas) {
      setAppError('No se encontró el pad de firma.')
      return
    }
    if (!signatureHasStrokeRef.current) {
      setAppError('Primero dibuja la firma en el pad.')
      return
    }

    const dataUrl = canvas.toDataURL('image/png')
    const storedFile: StoredFile = {
      id: crypto.randomUUID(),
      name: 'firma-manual.png',
      type: 'image/png',
      size: Math.round((dataUrl.length * 3) / 4),
      dataUrl,
      uploadedAt: new Date().toISOString(),
    }

    const nextProfile = {
      ...profile,
      signatureImage: storedFile,
    }
    setProfile(nextProfile)
    persistProfile(nextProfile)
    setAppError(null)
    setAppNotice('Firma manual guardada correctamente.')
    showSavedFloatingNotice()
  }

  function handleToggleCommunity(): void {
    setCommunityOpen((current) => !current)
    setAppError(null)
    setAppNotice(null)
  }

  function handleToggleCommunityNetworkFilter(network: string): void {
    setCommunityNetworkFilters((current) =>
      current.includes(network)
        ? current.filter((entry) => entry !== network)
        : [...current, network],
    )
  }

  function handleToggleThemeMode(): void {
    setThemeMode((current) => (current === 'light' ? 'night' : 'light'))
  }

  function handleSelectCommunityMember(memberId: string): void {
    setCommunityTargetId(memberId)
    markCommunityMessagesAsSeenForMember(memberId)
  }

  function handleSelectPatient(patientId: string): void {
    stopDictation()
    setCommunityOpen(false)
    setSelectedPatientId(patientId)
    setWorkspaceLayer('patient-record')
    setAppError(null)
  }

  function handleStartAttentionFlow(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('patient-search')
    setSelectedPatientId(null)
    setPatientSearchQuery('')
    setAppError(null)
  }

  function handleOpenUserAdmin(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('user-admin')
    setAppError(null)
  }

  function handleOpenClinicalPage(): void {
    stopDictation()
    setWorkspaceLayer('clinical')
    setAppError(null)
  }

  function handleBackToPatient(): void {
    stopDictation()
    setWorkspaceLayer('patient-record')
    setAppError(null)
  }

  function handleOpenProfile(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('profile')
    setAppError(null)
  }

  function handleOpenTools(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('tools')
    setAppError(null)
  }

  function handleOpenAmbulance(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('ambulance')
    setAppError(null)
  }

  function handleOpenAmbulanceHistory(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('ambulance-history')
    setAppError(null)
  }

  function handleBackToOverview(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('overview')
    setAppError(null)
  }

  async function handleCommunityFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) {
      return
    }
    try {
      const converted = await Promise.all(files.map((file) => fileToStoredFile(file)))
      setCommunityDraftFiles((current) => [...current, ...converted])
      setAppError(null)
    } catch {
      setAppError('No se pudo adjuntar uno o más archivos al chat.')
    } finally {
      event.target.value = ''
    }
  }

  async function handleCommunityDrop(event: ReactDragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    setCommunityDragActive(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length === 0) {
      return
    }
    try {
      const converted = await Promise.all(files.map((file) => fileToStoredFile(file)))
      setCommunityDraftFiles((current) => [...current, ...converted])
      setAppError(null)
    } catch {
      setAppError('No se pudieron adjuntar archivos arrastrados.')
    }
  }

  function handleRemoveCommunityDraftFile(fileId: string): void {
    setCommunityDraftFiles((current) => current.filter((file) => file.id !== fileId))
  }

  async function handleSendCommunityMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!activeUserId || !communityTargetId) {
      setAppError('Selecciona un profesional para enviar el mensaje.')
      return
    }

    const text = communityDraftText.trim()
    if (!text && communityDraftFiles.length === 0) {
      setAppError('El mensaje no puede estar vacío si no hay archivos adjuntos.')
      return
    }

    const nextMessage: CommunityMessage = {
      id: crypto.randomUUID(),
      senderId: activeUserId,
      recipientId: communityTargetId,
      text,
      attachments: communityDraftFiles,
      sentAt: new Date().toISOString(),
    }
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('community_messages')
        .insert({
          sender_id: nextMessage.senderId,
          recipient_id: nextMessage.recipientId,
          text: nextMessage.text,
          attachments_json: nextMessage.attachments,
          sent_at: nextMessage.sentAt,
        })
        .select('id, sender_id, recipient_id, text, attachments_json, sent_at')
        .single()
      if (error) {
        setAppError(`No se pudo enviar el mensaje al servidor: ${error.message}`)
        return
      }
      const persisted = mapRemoteCommunityMessage(data as RemoteCommunityMessageRow)
      setCommunityMessages((current) =>
        [...current, persisted].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
      )
    } else {
      const key = communityThreadStorageKey(activeUserId, communityTargetId)
      const currentThread = readJsonStorage<CommunityMessage[]>(key, [])
      const nextThread = [...currentThread, nextMessage].sort((a, b) =>
        a.sentAt.localeCompare(b.sentAt),
      )
      localStorage.setItem(key, JSON.stringify(nextThread))
      setCommunityMessages(nextThread)
    }

    setCommunityDraftText('')
    setCommunityDraftFiles([])
    setAppError(null)
    setAppNotice('Mensaje privado enviado.')
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!profile) {
      return
    }
    try {
      persistProfile(profile)
      await syncProfessionalFromProfile(profile)
      setAppNotice('Perfil profesional guardado.')
      showSavedFloatingNotice()
    } catch (error) {
      setAppError(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar el perfil profesional.',
      )
    }
  }

  async function handleSaveOwnPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!activeUserId) {
      return
    }
    if (!passwordChangeDraft.newPassword || !passwordChangeDraft.confirmPassword) {
      setAppError('Ingresa la nueva contraseña en ambos campos.')
      return
    }
    if (passwordChangeDraft.newPassword.length < 8) {
      setAppError('La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (passwordChangeDraft.newPassword !== passwordChangeDraft.confirmPassword) {
      setAppError('Las contraseñas no coinciden.')
      return
    }

    setAppError(null)
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('professionals')
        .update({ password: passwordChangeDraft.newPassword })
        .eq('id', activeUserId)
      if (error) {
        setAppError(`No se pudo actualizar la contraseña: ${error.message}`)
        return
      }
    } else {
      const passwordOverrides = readJsonStorage<Record<string, string>>(PASSWORD_OVERRIDES_KEY, {})
      localStorage.setItem(
        PASSWORD_OVERRIDES_KEY,
        JSON.stringify({ ...passwordOverrides, [activeUserId]: passwordChangeDraft.newPassword }),
      )
    }

    setSeedUsers((current) =>
      current.map((user) =>
        user.id === activeUserId
          ? { ...user, password: passwordChangeDraft.newPassword }
          : user,
      ),
    )
    const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
    localStorage.setItem(
      CREATED_USERS_KEY,
      JSON.stringify(
        localUsers.map((user) =>
          user.id === activeUserId
            ? { ...user, password: passwordChangeDraft.newPassword }
            : user,
        ),
      ),
    )
    setPasswordChangeDraft({ newPassword: '', confirmPassword: '' })
    setAppNotice('Contraseña actualizada correctamente.')
    showSavedFloatingNotice()
  }

  function handleSavePatient(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!activeUserId) {
      return
    }
    const existing = selectedPatientId
      ? patients.find((entry) => entry.id === selectedPatientId) ?? null
      : null
    if (existing && existing.ownerUserId !== activeUserId) {
      setAppError(
        'No puedes modificar la ficha base de un paciente compartido. Solo puedes agregar consultas nuevas.',
      )
      return
    }
    if (!patientDraft.apellido.trim() || !patientDraft.dni.trim()) {
      setAppError('Apellido y DNI son obligatorios para guardar el paciente.')
      return
    }
    setAppError(null)

    const now = new Date().toISOString()
    const record: PatientRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      ownerUserId: existing?.ownerUserId ?? activeUserId,
      ...patientDraft,
      numeroAfiliado: patientDraft.numeroAfiliado.trim(),
      plan: patientDraft.plan.trim(),
      diagnosticoPrincipal: patientDraft.diagnosticoPrincipal.trim(),
      edad: calculateAge(patientDraft.birthDate),
      consultations: existing?.consultations ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    persistPatient(record)
    setSelectedPatientId(record.id)
    setPatientFormUnlocked(false)
    setWorkspaceLayer('patient-record')
    setAppNotice('Ficha del paciente guardada.')
    showSavedFloatingNotice()
  }

  function handleNewPatient(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('patient-record')
    setSelectedPatientId(null)
    setPatientDraft(emptyPatientDraft)
    setPatientFormUnlocked(true)
    setConsultationDraft(emptyConsultationDraft)
    setAppError(null)
  }

  function persistCustomDiagnosis(nextDiagnosis: string): void {
    const value = nextDiagnosis.trim()
    if (!value) {
      return
    }

    const nextCatalog = mergeDiagnosisCatalog([
      ...readJsonStorage<string[]>(CUSTOM_DIAGNOSIS_STORAGE_KEY, []),
      value,
    ])
    localStorage.setItem(CUSTOM_DIAGNOSIS_STORAGE_KEY, JSON.stringify(nextCatalog))
    setDiagnosisCatalog((current) => mergeDiagnosisCatalog([...current, ...nextCatalog]))

    if (isSupabaseConfigured && supabase) {
      const remoteClient = supabase
      void (async () => {
        try {
          const { error } = await remoteClient
            .from('diagnosticos')
            .upsert({ descripcion: value }, { onConflict: 'descripcion' })
          if (error) {
            await remoteClient
              .from('diagnosis_catalog')
              .upsert({ description: value }, { onConflict: 'description' })
          }
        } catch {
          // El catálogo local se conserva aunque el servidor remoto no tenga esa tabla.
        }
      })()
    }
  }

  function handleSaveConsultation(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    stopDictation()
    if (!selectedPatient || !profile) {
      setAppError('Primero selecciona un paciente y completa tu perfil profesional.')
      return
    }

    const nextMotivo = consultationDraft.motivoConsulta.trim()
    if (!nextMotivo) {
      setAppError('El motivo de consulta es obligatorio.')
      return
    }

    if (!diagnosisCatalog.some((entry) => normalizeSearchText(entry) === normalizeSearchText(nextMotivo))) {
      persistCustomDiagnosis(nextMotivo)
    }

    setAppError(null)
    const entry: ConsultationEntry = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      motivoConsulta: nextMotivo,
      diagnostico: nextMotivo,
      detalleAtencion: consultationDraft.detalleAtencion,
      pensamientoMedico: consultationDraft.pensamientoMedico,
      professionalSignature: {
        fullName: profile.fullName,
        licenseNumber: profile.licenseNumber,
        signatureText: profile.signatureText,
        signatureImageDataUrl: profile.signatureImage?.dataUrl,
      },
    }

    const record: PatientRecord = {
      ...selectedPatient,
      ...(canEditSelectedPatientRecord
        ? {
            ...patientDraft,
            numeroAfiliado: patientDraft.numeroAfiliado.trim(),
            plan: patientDraft.plan.trim(),
            diagnosticoPrincipal: patientDraft.diagnosticoPrincipal.trim(),
            edad: calculateAge(patientDraft.birthDate),
          }
        : {}),
      consultations: [entry, ...selectedPatient.consultations],
      updatedAt: new Date().toISOString(),
    }
    persistPatient(record)
    setConsultationDraft(emptyConsultationDraft)
    setAppNotice('Consulta clínica guardada con firma digital.')
    showSavedFloatingNotice()
  }

  async function handleImportPatient(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    if (!activeUserId) {
      return
    }
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const lowerName = file.name.toLowerCase()
    const text = await file.text()

    if (lowerName.endsWith('.json') || file.type === 'application/json') {
      const incoming = JSON.parse(text) as Partial<PatientRecord>
      if (!incoming.apellido || !incoming.dni) {
        setAppError('El archivo importado no tiene datos válidos de paciente.')
        return
      }

      const now = new Date().toISOString()
      const existingByDni = patients.find((entry) => entry.dni === incoming.dni)
      if (existingByDni && existingByDni.ownerUserId !== activeUserId) {
        setAppError(
          'No puedes sobrescribir la ficha base de un paciente compartido. Solo puedes agregar consultas.',
        )
        return
      }
      const incomingId = existingByDni?.id ?? incoming.id ?? crypto.randomUUID()
      const nextPatient: PatientRecord = {
        id: incomingId,
        ownerUserId: existingByDni?.ownerUserId ?? activeUserId,
        nombre: incoming.nombre ?? '',
        apellido: incoming.apellido,
        dni: incoming.dni,
        email: incoming.email ?? '',
        obraSocial: incoming.obraSocial ?? '',
        numeroAfiliado: incoming.numeroAfiliado ?? '',
        plan: incoming.plan ?? '',
        birthDate: incoming.birthDate ?? '',
        edad: calculateAge(incoming.birthDate ?? ''),
        patologiasConocidas: incoming.patologiasConocidas ?? '',
        patologiasCronicas: incoming.patologiasCronicas ?? '',
        ultimaInternacion: incoming.ultimaInternacion ?? '',
        cirugiasPrevias: incoming.cirugiasPrevias ?? '',
        direccion: incoming.direccion ?? '',
        photoCarnet: incoming.photoCarnet,
        dniPhoto: incoming.dniPhoto,
        documents: incoming.documents ?? [],
        consultations: incoming.consultations ?? [],
        createdAt: incoming.createdAt ?? now,
        updatedAt: now,
      }

      persistPatient(nextPatient)
      setSelectedPatientId(nextPatient.id)
      setWorkspaceLayer('patient-record')
      setAppError(null)
      setAppNotice('Paciente importado correctamente desde archivo de respaldo.')
      return
    }

    const isTextLike =
      file.type.startsWith('text/') ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.md')

    // Para PDF, DOCX e imágenes: guardar como documento del paciente actual
    if (!isTextLike) {
      const targetPatient = selectedPatient
      if (!targetPatient) {
        setAppError('Para adjuntar un documento primero selecciona o crea un paciente.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const patientName = `${targetPatient.nombre} ${targetPatient.apellido}`.trim()
        const ext = lowerName.includes('.') ? lowerName.split('.').pop() : ''
        const prefix = lowerName.includes('historia') || lowerName.includes('hc')
          ? 'HistoriaClinica'
          : lowerName.includes('dni')
          ? 'DNI'
          : lowerName.includes('carnet') || lowerName.includes('credencial') || lowerName.includes('obrasocial')
          ? 'Credencial'
          : 'Documento'
        const docName = `${prefix}-${patientName}${ext ? '.' + ext : ''}`.replace(/\s+/g, '_')
        const newDoc: StoredFile = {
          id: crypto.randomUUID(),
          name: docName,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
          uploadedAt: new Date().toISOString(),
        }
        const updated: PatientRecord = {
          ...targetPatient,
          documents: [...(targetPatient.documents ?? []), newDoc],
          updatedAt: new Date().toISOString(),
        }
        persistPatient(updated)
        setAppNotice(
          `Documento "${docName}" adjuntado a la ficha de ${patientName}. Podés verlo en la sección Documentación.`,
        )
      }
      reader.readAsDataURL(file)
      return
    }

    const extracted = extractPatientSuggestionsFromText(text)
    const patientSuggestion = {
      ...emptyPatientDraft,
      ...extracted.patientDraft,
    }
    const detectedFields = Object.values(extracted.patientDraft).filter(Boolean).length
    if (detectedFields === 0) {
      setAppError('No pude detectar datos útiles en el texto. Si querés, te ayudo con un ejemplo.')
      return
    }

    setSelectedPatientId(null)
    setWorkspaceLayer('patient-record')
    setPatientDraft(patientSuggestion)
    setPatientFormUnlocked(true)
    setConsultationDraft({
      ...emptyConsultationDraft,
      ...extracted.consultationDraft,
    })
    setAppError(null)
    setAppNotice(
      `Leí el documento y sugerí ${detectedFields} campo(s) para completar la ficha automáticamente. Revisa y guarda.`,
    )
  }

  async function handleImportPadronExcel(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    if (!activeUserId) {
      return
    }
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const firstSheet = workbook.SheetNames[0]
    if (!firstSheet) {
      setAppError('El Excel no tiene hojas con datos.')
      return
    }

    const sheet = workbook.Sheets[firstSheet]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: true,
    })

    if (rows.length === 0) {
      setAppError('El padrón está vacío.')
      return
    }

    const byDni = new Map(patients.map((patient) => [patient.dni, patient]))
    const imported: PatientRecord[] = []
    let skipped = 0

    for (const row of rows) {
      const normalizedRow = new Map<string, string>()
      for (const [key, value] of Object.entries(row)) {
        normalizedRow.set(normalizeHeader(key), asText(value))
      }

      const apellido =
        normalizedRow.get('apellido') ??
        normalizedRow.get('apellidos') ??
        normalizedRow.get('lastname') ??
        ''
      const dni = normalizedRow.get('dni') ?? normalizedRow.get('documento') ?? ''

      if (!apellido || !dni) {
        skipped += 1
        continue
      }

      const nombre =
        normalizedRow.get('nombre') ??
        normalizedRow.get('nombres') ??
        normalizedRow.get('firstname') ??
        ''
      const obraSocial =
        normalizedRow.get('obrasocial') ??
        normalizedRow.get('cobertura') ??
        normalizedRow.get('seguro') ??
        ''
      const numeroAfiliado =
        normalizedRow.get('numeroafiliado') ??
        normalizedRow.get('nroafiliado') ??
        normalizedRow.get('afiliado') ??
        normalizedRow.get('nrosocio') ??
        normalizedRow.get('socio') ??
        ''
      const plan =
        normalizedRow.get('plan') ??
        normalizedRow.get('plancobertura') ??
        normalizedRow.get('producto') ??
        ''
      const email =
        normalizedRow.get('email') ?? normalizedRow.get('correo') ?? normalizedRow.get('mail') ?? ''
      const birthDate = excelDateToIso(
        normalizedRow.get('fechadenacimiento') ??
          normalizedRow.get('nacimiento') ??
          normalizedRow.get('birthdate') ??
          '',
      )

      const existing = byDni.get(dni)
      if (existing && existing.ownerUserId !== activeUserId) {
        skipped += 1
        continue
      }
      const now = new Date().toISOString()
      imported.push({
        id: existing?.id ?? crypto.randomUUID(),
        ownerUserId: existing?.ownerUserId ?? activeUserId,
        nombre,
        apellido,
        dni,
        email,
        obraSocial,
        numeroAfiliado,
        plan,
        birthDate,
        edad: calculateAge(birthDate),
        patologiasConocidas: existing?.patologiasConocidas ?? '',
        patologiasCronicas: existing?.patologiasCronicas ?? '',
        ultimaInternacion: existing?.ultimaInternacion ?? '',
        cirugiasPrevias: existing?.cirugiasPrevias ?? '',
        direccion: existing?.direccion ?? '',
        photoCarnet: existing?.photoCarnet,
        dniPhoto: existing?.dniPhoto,
        documents: existing?.documents ?? [],
        consultations: existing?.consultations ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    }

    if (imported.length === 0) {
      setAppError('No se detectaron filas válidas. Verifica que existan columnas Apellido y DNI.')
      setAppNotice(null)
      return
    }

    persistPatientsBatch(imported)
    setWorkspaceLayer('patient-search')
    setAppError(null)
    setAppNotice(
      `Padrón importado: ${imported.length} pacientes agregados/actualizados${skipped > 0 ? `, ${skipped} filas omitidas` : ''}.`,
    )
  }

  function exportSelectedPatient(): void {
    if (!selectedPatient) {
      return
    }
    downloadTextFile(
      `paciente-${selectedPatient.apellido}-${selectedPatient.dni}.json`,
      JSON.stringify(selectedPatient, null, 2),
    )
  }

  function buildPatientForPrint(): PatientRecord | null {
    if (!selectedPatient) {
      return null
    }

    return {
      ...selectedPatient,
      ...(canEditSelectedPatientRecord
        ? {
            ...patientDraft,
            edad: calculateAge(patientDraft.birthDate),
          }
        : {}),
    }
  }

  function printPatientDocument(
    patientForPrint: PatientRecord,
    consultationEntriesForPrint: ConsultationEntry[],
    documentTitle: string,
  ): void {
    if (!profile) {
      setAppError('Completa tu perfil profesional para imprimir documentos clínicos.')
      return
    }

    const now = new Date()
    const nowLabel = now.toLocaleString('es-AR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

    const consultationsMarkup =
      consultationEntriesForPrint.length === 0
        ? '<p>No hay atenciones registradas.</p>'
        : consultationEntriesForPrint
            .map((entry, index) => {
              const signatureImage = entry.professionalSignature.signatureImageDataUrl
                ? `<img src="${entry.professionalSignature.signatureImageDataUrl}" alt="Firma digital" style="max-width:160px; max-height:70px; display:block; margin-top:6px;" />`
                : ''
              return `
                <article style="border:1px solid #d8e2ee; border-radius:8px; padding:10px; margin-bottom:10px;">
                  <h3 style="margin:0 0 6px; font-size:15px;">Atención ${index + 1} - ${escapeHtml(formatDate(entry.date))}</h3>
                  <p><strong>Motivo de consulta:</strong> ${escapeHtml(entry.motivoConsulta)}</p>
                  <p><strong>Diagnóstico:</strong> ${escapeHtml(entry.diagnostico || 'No informado')}</p>
                  <p><strong>Resumen de atención:</strong><br />${escapeHtml(entry.detalleAtencion).replaceAll('\n', '<br />')}</p>
                  <p><strong>Pensamiento médico:</strong><br />${escapeHtml(entry.pensamientoMedico).replaceAll('\n', '<br />')}</p>
                  <p><strong>Firma:</strong> ${escapeHtml(entry.professionalSignature.fullName)} - Matrícula ${escapeHtml(entry.professionalSignature.licenseNumber)}</p>
                  <p>${escapeHtml(entry.professionalSignature.signatureText)}</p>
                  ${signatureImage}
                </article>
              `
            })
            .join('')

    const documentsMarkup =
      patientForPrint.documents.length === 0
        ? '<li>Sin documentos adjuntos.</li>'
        : patientForPrint.documents
            .map(
              (document) =>
                `<li>${escapeHtml(document.name)} (${escapeHtml(formatDate(document.uploadedAt))})</li>`,
            )
            .join('')

    const printWindow = window.open('', '_blank', 'width=1024,height=768')
    if (!printWindow) {
      setAppError('No se pudo abrir la vista de impresión. Verifica bloqueador de ventanas.')
      return
    }

    printWindow.document.write(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(documentTitle)} - ${escapeHtml(patientForPrint.apellido)} ${escapeHtml(patientForPrint.nombre)}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #1f2d3d; padding: 20px; }
      h1 { margin: 0 0 4px; font-size: 24px; }
      h2 { font-size: 18px; border-bottom: 1px solid #d8e2ee; padding-bottom: 4px; margin-top: 22px; }
      p { margin: 4px 0; line-height: 1.4; }
      .muted { color: #506079; font-size: 13px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
      .photos { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
      .photos img { max-width: 180px; max-height: 180px; border: 1px solid #d8e2ee; border-radius: 8px; object-fit: contain; padding: 4px; }
      ul { margin: 6px 0 0 16px; }
      @media print {
        body { padding: 0; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(documentTitle)}</h1>
      <p class="muted">Fecha de impresión: ${escapeHtml(nowLabel)}</p>
      <p class="muted">Profesional: ${escapeHtml(profile.fullName)} - Matrícula ${escapeHtml(profile.licenseNumber)}</p>
    </header>

    <section>
      <h2>Datos del paciente</h2>
      <div class="grid">
        <p><strong>Nombre:</strong> ${escapeHtml(patientForPrint.nombre || 'No informado')}</p>
        <p><strong>Apellido:</strong> ${escapeHtml(patientForPrint.apellido || 'No informado')}</p>
        <p><strong>DNI:</strong> ${escapeHtml(patientForPrint.dni || 'No informado')}</p>
        <p><strong>Obra social:</strong> ${escapeHtml(patientForPrint.obraSocial || 'No informado')}</p>
        <p><strong>Número de afiliado:</strong> ${escapeHtml(patientForPrint.numeroAfiliado || 'No informado')}</p>
        <p><strong>Plan:</strong> ${escapeHtml(patientForPrint.plan || 'No informado')}</p>
        <p><strong>Diagnóstico principal:</strong> ${escapeHtml(patientForPrint.diagnosticoPrincipal || 'No informado')}</p>
        <p><strong>Fecha de nacimiento:</strong> ${escapeHtml(formatShortDate(patientForPrint.birthDate))}</p>
        <p><strong>Edad actual:</strong> ${escapeHtml(String(patientForPrint.edad))}</p>
      </div>
      <div class="photos">
        ${patientForPrint.photoCarnet ? `<figure><img src="${patientForPrint.photoCarnet.dataUrl}" alt="Foto carnet" /><figcaption>Foto carnet</figcaption></figure>` : ''}
        ${patientForPrint.dniPhoto ? `<figure><img src="${patientForPrint.dniPhoto.dataUrl}" alt="Foto DNI" /><figcaption>Foto DNI</figcaption></figure>` : ''}
      </div>
    </section>

    <section>
      <h2>Antecedentes clínicos</h2>
      <p><strong>Patologías conocidas:</strong><br />${escapeHtml(patientForPrint.patologiasConocidas).replaceAll('\n', '<br />') || 'No informado'}</p>
      <p><strong>Patologías crónicas:</strong><br />${escapeHtml(patientForPrint.patologiasCronicas).replaceAll('\n', '<br />') || 'No informado'}</p>
      <p><strong>Última internación:</strong><br />${escapeHtml(patientForPrint.ultimaInternacion).replaceAll('\n', '<br />') || 'No informado'}</p>
      <p><strong>Cirugías previas:</strong><br />${escapeHtml(patientForPrint.cirugiasPrevias).replaceAll('\n', '<br />') || 'No informado'}</p>
    </section>

    <section>
      <h2>Documentos adjuntos</h2>
      <ul>${documentsMarkup}</ul>
    </section>

    <section>
      <h2>${consultationEntriesForPrint.length <= 1 ? 'Atención clínica' : 'Evolución y atenciones registradas'}</h2>
      ${consultationsMarkup}
    </section>
  </body>
</html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    setAppNotice('Documento preparado para guardar o imprimir en PDF.')
  }

  function printSelectedPatientSummary(): void {
    const patientForPrint = buildPatientForPrint()
    if (!patientForPrint || !profile) {
      setAppError('Selecciona un paciente para imprimir su resumen clínico.')
      return
    }

    const hasDraftConsultation = Boolean(
      consultationDraft.motivoConsulta.trim() ||
        consultationDraft.detalleAtencion.trim() ||
        consultationDraft.pensamientoMedico.trim(),
    )

    const consultationEntriesForPrint = hasDraftConsultation
      ? [
          {
            id: 'draft',
            date: new Date().toISOString(),
            motivoConsulta: consultationDraft.motivoConsulta || 'Atención en edición',
            detalleAtencion: consultationDraft.detalleAtencion,
            pensamientoMedico: consultationDraft.pensamientoMedico,
            professionalSignature: {
              fullName: profile.fullName,
              licenseNumber: profile.licenseNumber,
              signatureText: profile.signatureText,
              signatureImageDataUrl: profile.signatureImage?.dataUrl,
            },
          },
          ...patientForPrint.consultations,
        ]
      : patientForPrint.consultations
    printPatientDocument(
      patientForPrint,
      consultationEntriesForPrint,
      'RESUMEN DE HISTORIA CLINICA',
    )
  }

  function printSingleConsultation(entry: ConsultationEntry): void {
    const patientForPrint = buildPatientForPrint()
    if (!patientForPrint || !profile) {
      setAppError('Selecciona un paciente para imprimir la atención clínica.')
      return
    }

    printPatientDocument(patientForPrint, [entry], 'ATENCION CLINICA INDIVIDUAL')
  }

  if (loadingUsers) {
    return <main className="loading">Cargando modelo clínico...</main>
  }

  if (!activeUser || !profile) {
    return (
      <main className="auth-layout">
        <section className="auth-card">
          <div className="brand-block">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 64 64" role="presentation">
                <rect x="4" y="4" width="56" height="56" rx="16" fill="#1d4ed8" />
                <circle cx="32" cy="32" r="19" fill="#93c5fd" opacity="0.35" />
                <path d="M32 13v38" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M24 28h16" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M22 18c4 4 7 6 10 6" stroke="#dbeafe" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M42 18c-4 4-7 6-10 6" stroke="#dbeafe" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="32" cy="50" r="4" fill="#dbeafe" />
                <circle cx="15" cy="48" r="2" fill="#bfdbfe" />
                <circle cx="49" cy="16" r="2" fill="#bfdbfe" />
              </svg>
            </span>
            <div className="brand-copy">
              <h1>Dr Happy 😊</h1>
              <p className="slogan">Basta de Papeleo, Hagamos medicina.</p>
            </div>
          </div>
          {!recoveryOpen ? (
            <form onSubmit={handleLogin} className="grid">
              <label>
                Usuario
                <input
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </label>
              <label>
                Contraseña
                <input
                  type="password"
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              {authError ? <p className="error">{authError}</p> : null}
              {appError ? <p className="error">{appError}</p> : null}
              {appNotice ? <p className="notice">{appNotice}</p> : null}
              <button type="submit">Iniciar sesión</button>
              {isSupabaseConfigured ? (
                <button
                  type="button"
                  className="google-login-btn"
                  onClick={() => void handleGoogleLogin()}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    background: '#fff', color: '#3c4043', border: '1px solid #dadce0',
                    borderRadius: 6, padding: '10px 14px', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.4 29.4 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5 13.5 4.5 5 13 5 23.5S13.5 42.5 24 42.5 43 34 43 23.5c0-1-.1-2-.4-3z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.8 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5c-7.7 0-14.4 4.4-17.7 10.2z" />
                    <path fill="#4CAF50" d="M24 42.5c5.3 0 9.9-1.8 13.2-4.9l-6.1-5.2c-2 1.4-4.5 2.1-7.1 2.1-5.4 0-9.9-3.1-11.4-7.6l-6.6 5.1C9.5 38 16.2 42.5 24 42.5z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2-1.9 3.6-3.4 4.9l6.1 5.2C41 34.9 43 29.6 43 23.5c0-1-.1-2-.4-3z" />
                  </svg>
                  Iniciar sesión con Google
                </button>
              ) : null}
              <div className="build-badge">Compilación {APP_BUILD_ID}</div>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setRecoveryOpen(true)
                  setRegisterOpen(false)
                  setAuthError(null)
                  setAppNotice(null)
                }}
              >
                ¿Olvidaste tu contraseña?
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setRegisterOpen((current) => !current)
                  setAuthError(null)
                }}
              >
                {registerOpen ? 'Cancelar registro' : 'Crear usuario'}
              </button>
              <button type="button" className="ghost theme-toggle" onClick={handleToggleThemeMode}>
                {themeMode === 'night' ? 'Modo claro' : 'Modo nocturno'}
              </button>
            </form>
          ) : (
            <section className="recovery-form">
              <h2>Recuperar contraseña</h2>
              {!recoveryRequested ? (
                <form className="grid" onSubmit={handleRequestPasswordRecovery}>
                  <label>
                    Correo profesional
                    <input
                      type="email"
                      value={recoveryEmail}
                      onChange={(event) => setRecoveryEmail(event.target.value)}
                      required
                    />
                  </label>
                  <small>
                    En la versión publicada recibirás un enlace por correo. Por ahora se usa
                    un código de prueba.
                  </small>
                  <button type="submit">Solicitar código</button>
                </form>
              ) : (
                <form className="grid" onSubmit={handleResetPassword}>
                  {recoveryDemoCode ? (
                    <p className="demo-code">
                      Código de prueba: <strong>{recoveryDemoCode}</strong>
                    </p>
                  ) : null}
                  <label>
                    Código de recuperación
                    <input
                      inputMode="numeric"
                      value={recoveryCode}
                      onChange={(event) => setRecoveryCode(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Nueva contraseña
                    <input
                      type="password"
                      value={recoveryPassword}
                      onChange={(event) => setRecoveryPassword(event.target.value)}
                      minLength={8}
                      required
                    />
                  </label>
                  <button type="submit">Actualizar contraseña</button>
                </form>
              )}
              {authError ? <p className="error">{authError}</p> : null}
              {appError ? <p className="error">{appError}</p> : null}
              {appNotice ? <p className="notice">{appNotice}</p> : null}
              <button type="button" className="ghost" onClick={resetRecoveryForm}>
                Volver a iniciar sesión
              </button>
            </section>
          )}
          {registerOpen ? (
            <form className="grid register-form" onSubmit={handleCreateUser}>
              <h2>Nuevo profesional</h2>
              <label>
                Nombre
                <input
                  name="firstName"
                  value={registerDraft.firstName}
                  onChange={handleRegisterFieldChange}
                  required
                />
              </label>
              <label>
                Apellido
                <input
                  name="lastName"
                  value={registerDraft.lastName}
                  onChange={handleRegisterFieldChange}
                  required
                />
              </label>
              <label>
                Especialidad (ej: Traumatología, Hematología)
                <input
                  name="specialty"
                  value={registerDraft.specialty}
                  onChange={handleRegisterFieldChange}
                  autoComplete="off"
                  list="register-specialty-suggestions-list"
                  required
                />
                <datalist id="register-specialty-suggestions-list">
                  {registerSpecialtySuggestions.map((specialty) => (
                    <option key={specialty} value={specialty} />
                  ))}
                </datalist>
              </label>
              <label>
                Matrícula
                <input
                  name="licenseNumber"
                  value={registerDraft.licenseNumber}
                  onChange={handleRegisterFieldChange}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  value={registerDraft.email}
                  onChange={handleRegisterFieldChange}
                  required
                />
              </label>
              <label>
                Usuario
                <input
                  name="username"
                  value={registerDraft.username}
                  onChange={handleRegisterFieldChange}
                  required
                />
              </label>
              <label>
                Contraseña
                <input
                  type="password"
                  name="password"
                  value={registerDraft.password}
                  onChange={handleRegisterFieldChange}
                  required
                />
              </label>
              <fieldset className="register-networks-fieldset">
                <legend>Redes en las que trabaja</legend>
                <div className="register-networks-grid">
                  {PROFESSIONAL_NETWORK_OPTIONS.map((network) => (
                    <label key={network} className="toggle-option">
                      <input
                        type="checkbox"
                        checked={registerDraft.networkMemberships.includes(network)}
                        onChange={() => handleRegisterNetworkToggle(network)}
                      />
                      <span className="toggle-switch" aria-hidden="true" />
                      <span>{network}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit">Guardar usuario</button>
            </form>
          ) : null}
        </section>
        {floatingNotice ? <div className="floating-toast">{floatingNotice}</div> : null}
      </main>
    )
  }

  // ── Pantalla de acceso vencido ────────────────────────────────────────────
  if (trialInfo?.expired || previewTrialExpired) {
    const expiredByPatients = trialInfo?.expiredByPatients ?? false
    const expiredByTime = trialInfo?.expiredByTime ?? true
    const expiredBySubscription = trialInfo?.expiredBySubscription ?? false
    const isPlanPreview = previewTrialExpired && !trialInfo?.expired
    return (
      <main className="app" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8f4f4', padding: 24 }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: 16 }}>⏰</div>
          <h1 style={{ fontSize: '1.6rem', color: '#c0392b', marginBottom: 8 }}>
            {isPlanPreview
              ? 'Elegí tu plan de suscripción'
              : expiredBySubscription
                ? 'Tu suscripción ha vencido'
                : 'Tu período de prueba ha vencido'}
          </h1>
          <p style={{ color: '#555', marginBottom: 8, lineHeight: 1.6 }}>
            {isPlanPreview
              ? <>Elegí entre <strong>30 días</strong>, <strong>6 meses</strong> o <strong>1 año</strong> de acceso completo.</>
              : expiredBySubscription
              ? <>Ya pasaron los <strong>30 días</strong> de tu suscripción actual.</>
              : expiredByPatients && !expiredByTime
              ? <>Alcanzaste el límite de <strong>15 pacientes</strong> del período de prueba gratuita.</>
              : expiredByTime && !expiredByPatients
              ? <>Los <strong>14 días</strong> de acceso gratuito a <strong>Dr Happy 😊</strong> terminaron.</>
              : <>Alcanzaste el límite del período de prueba gratuita (<strong>14 días</strong> y <strong>15 pacientes</strong>).</>
            }
          </p>
          <p style={{ color: '#555', marginBottom: 24, lineHeight: 1.6 }}>
            {isPlanPreview
              ? 'Podés ampliar tu cobertura cuando quieras sin perder tus datos.'
              : expiredBySubscription
                ? 'Renová tu plan para habilitar el próximo período de acceso completo.'
                : 'Suscribite para seguir usando todas las funciones sin interrupciones.'}
            <br />
            <strong>Tus datos están guardados</strong> y te esperan cuando te suscribas.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
            {SUBSCRIPTION_PLAN_OPTIONS.map((option) => (
              <div
                key={option.plan}
                style={{
                  border: `2px solid ${option.accentColor}`,
                  borderRadius: 12,
                  padding: '18px 20px',
                  background: '#fff',
                  position: 'relative',
                }}
              >
                {option.badgeText ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: -12,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: option.accentColor,
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '3px 12px',
                      borderRadius: 20,
                    }}
                  >
                    {option.badgeText}
                  </div>
                ) : null}
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: option.accentColor, marginBottom: 4 }}>
                  {option.icon} {option.title}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: 12 }}>
                  {option.description}
                </div>
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: option.accentColor,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  disabled={subscriptionCheckoutLoading !== null}
                  onClick={() => {
                    void handleStartSubscriptionCheckout(option.plan)
                  }}
                >
                  {subscriptionCheckoutLoading === option.plan
                    ? 'Redirigiendo a MercadoPago...'
                    : expiredBySubscription
                      ? `Renovar suscripción — ${option.title}`
                      : `Suscribirme — ${option.title}`}
                </button>
              </div>
            ))}
          </div>

          <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: 20 }}>
            ¿Ya realizaste el pago? Puede demorar unos minutos en activarse.<br />
            Contactanos por cualquier problema.
          </p>

          <button
            type="button"
            style={{ background: 'none', border: 'none', color: '#888', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={handleLogout}
          >
            Cerrar sesión
          </button>
          {previewTrialExpired && (
            <button
              type="button"
              style={{ display: 'block', marginTop: 10, background: 'none', border: 'none', color: '#1d4ed8', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setPreviewTrialExpired(false)}
            >
              ← Volver (modo previsualización)
            </button>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand-block compact">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64" role="presentation">
              <rect x="4" y="4" width="56" height="56" rx="16" fill="#1d4ed8" />
              <circle cx="32" cy="32" r="19" fill="#93c5fd" opacity="0.35" />
              <path d="M32 13v38" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M24 28h16" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M22 18c4 4 7 6 10 6" stroke="#dbeafe" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M42 18c-4 4-7 6-10 6" stroke="#dbeafe" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="32" cy="50" r="4" fill="#dbeafe" />
              <circle cx="15" cy="48" r="2" fill="#bfdbfe" />
              <circle cx="49" cy="16" r="2" fill="#bfdbfe" />
            </svg>
          </span>
          <div className="brand-copy">
            <h1>Dr Happy 😊</h1>
            <p className="slogan">Basta de Papeleo, Hagamos medicina.</p>
            <p className="professional">Profesional: {profile.fullName}</p>
            {googleIdentity ? (
              <p className="google-session-indicator">
                Sesión Google: {googleIdentity.email}
              </p>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
          {googleIdentity ? (
            <div className="google-session-chip" title={googleIdentity.email}>
              {googleIdentity.avatarUrl ? (
                <img src={googleIdentity.avatarUrl} alt={googleIdentity.fullName ?? googleIdentity.email} />
              ) : (
                <span>{(googleIdentity.fullName ?? googleIdentity.email).slice(0, 1).toUpperCase()}</span>
              )}
            </div>
          ) : null}
          <span className="build-badge compact">Compilación {APP_BUILD_ID}</span>
          {trialInfo?.status === 'active' && Number.isFinite(trialInfo.daysLeft) && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              background: trialInfo.daysLeft <= 7 ? '#1d4ed8' : '#1f7a3d',
              color: '#fff', fontSize: '0.75rem', fontWeight: 600,
              padding: '4px 10px', borderRadius: 20,
            }}>
              <span>
                {trialInfo.daysLeft <= 0
                  ? 'Suscripción vencida'
                  : `Suscripción activa — ${trialInfo.daysLeft} día${trialInfo.daysLeft === 1 ? '' : 's'} restante${trialInfo.daysLeft === 1 ? '' : 's'}`}
              </span>
              {trialInfo.daysLeft <= 7 && (
                <>
                  <button
                    type="button"
                    style={{ background: '#fff', color: '#1d4ed8', border: 'none', borderRadius: 12, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    disabled={subscriptionCheckoutLoading !== null}
                    onClick={() => {
                      void handleStartSubscriptionCheckout('monthly')
                    }}
                  >
                    {subscriptionCheckoutLoading === 'monthly' ? 'Abriendo pago...' : 'Renovar ahora'}
                  </button>
                  <button
                    type="button"
                    style={{ background: '#dbeafe', color: '#1d4ed8', border: 'none', borderRadius: 12, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => setPreviewTrialExpired(true)}
                  >
                    Mejorar plan
                  </button>
                </>
              )}
            </span>
          )}
          {trialInfo?.status === 'trial' && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              background: (trialInfo.daysLeft <= 3 || trialInfo.patientsLeft <= 3) ? '#c0392b' : trialInfo.daysLeft <= 7 || trialInfo.patientsLeft <= 7 ? '#e67e22' : '#555',
              color: '#fff', fontSize: '0.75rem', fontWeight: 600,
              padding: '4px 10px', borderRadius: 20,
            }}>
              <span>
                ⏳ Trial — {trialInfo.daysLeft === 0 ? 'último día' : `${trialInfo.daysLeft} día${trialInfo.daysLeft === 1 ? '' : 's'}`}
                {' · '}
                {trialInfo.patientsLeft === 0 ? 'sin pacientes restantes' : `${trialInfo.patientsLeft} paciente${trialInfo.patientsLeft === 1 ? '' : 's'} restante${trialInfo.patientsLeft === 1 ? '' : 's'}`}
              </span>
              <button
                type="button"
                style={{ background: '#fff', color: '#c0392b', border: 'none', borderRadius: 12, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                disabled={subscriptionCheckoutLoading !== null}
                onClick={() => {
                  void handleStartSubscriptionCheckout('monthly')
                }}
              >
                {subscriptionCheckoutLoading === 'monthly' ? 'Abriendo pago...' : 'Suscribirme'}
              </button>
              <button
                type="button"
                style={{ background: '#fdecea', color: '#c0392b', border: 'none', borderRadius: 12, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => setPreviewTrialExpired(true)}
              >
                Ver planes
              </button>
            </span>
          )}
          <button type="button" className="ghost theme-toggle" onClick={handleToggleThemeMode}>
            {themeMode === 'night' ? 'Modo claro' : 'Modo nocturno'}
          </button>
          <button type="button" className="ghost" onClick={handleBackToOverview}>
            Inicio
          </button>
          <button type="button" className="ghost" onClick={handleOpenProfile}>
            Perfil
          </button>
          <button type="button" className="ghost" onClick={handleOpenTools}>
            Herramientas
          </button>
          {isAdminSession ? (
            <button type="button" className="ghost" onClick={handleOpenUserAdmin}>
              Editar usuarios
            </button>
          ) : null}
          {isAdminSession ? (
            <button
              type="button"
              className="ghost"
              style={{ fontSize: '0.78rem', color: '#c0392b' }}
              onClick={() => setPreviewTrialExpired(true)}
              title="Ver cómo se ve la pantalla de suscripción cuando el trial vence"
            >
              👁 Ver pantalla de trial
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={handleToggleCommunity}>
            Comunidad {communityUnreadCount > 0 ? `(${communityUnreadCount})` : ''}
          </button>
          <button type="button" className="ghost" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      {appError ? <p className="error">{appError}</p> : null}
      {appNotice ? <p className="notice">{appNotice}</p> : null}

      {communityOpen ? (
        <section className="panel community-panel">
          <h2>Comunidad médica</h2>
          <div className="community-grid">
            <aside>
              <h3>Buscar profesionales</h3>
              <div className="community-filters">
                <label>
                  Buscar por nombre o especialidad
                  <input
                    value={communitySearchQuery}
                    onChange={(event) => setCommunitySearchQuery(event.target.value)}
                    placeholder="Ej: cardiólogo, Pérez, traumatología"
                  />
                </label>
                <fieldset className="community-network-filters">
                  <legend>Filtrar por red</legend>
                  <div className="register-networks-grid">
                    {PROFESSIONAL_NETWORK_OPTIONS.map((network) => (
                      <label key={network} className="toggle-option">
                        <input
                          type="checkbox"
                          checked={communityNetworkFilters.includes(network)}
                          onChange={() => handleToggleCommunityNetworkFilter(network)}
                        />
                        <span className="toggle-switch" aria-hidden="true" />
                        <span>{network}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="community-results">
                <ul className="community-member-list">
                  {communityDisplayedMembers.map((member) => {
                    const unread = communityUnreadByMember[member.id] ?? 0
                    const statusClass = unread > 0 ? 'unseen' : 'seen'
                    const selectedClass = member.id === communityTargetId ? 'selected' : ''
                    return (
                      <li key={member.id}>
                        <button
                          type="button"
                          className={`${statusClass} ${selectedClass}`.trim()}
                          onClick={() => handleSelectCommunityMember(member.id)}
                        >
                          <strong>{member.fullName}</strong>
                          <span>{member.specialty}</span>
                          <small>
                            {member.networkMemberships && member.networkMemberships.length > 0
                              ? member.networkMemberships.join(' · ')
                              : 'Sin redes cargadas'}
                          </small>
                          <small>{unread > 0 ? `No visto (${unread})` : 'Visto'}</small>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {communityDisplayedMembers.length === 0 ? (
                  <p className="empty-chat">
                    {communityHasActiveFilters
                      ? 'No hay profesionales que coincidan con la búsqueda o los filtros.'
                      : 'Usa la búsqueda o los filtros por red para encontrar profesionales.'}
                  </p>
                ) : null}
              </div>
            </aside>
            <section>
              <h3>
                Chat privado{' '}
                {selectedCommunityMember ? `con ${selectedCommunityMember.fullName}` : ''}
              </h3>
              <ul className="community-messages">
                {communityMessages.map((message) => {
                  const mine = message.senderId === activeUser.id
                  return (
                    <li key={message.id} className={mine ? 'mine' : 'theirs'}>
                      {message.text ? <p>{message.text}</p> : null}
                      {message.attachments.length > 0 ? (
                        <ul className="community-attachments">
                          {message.attachments.map((file) => (
                            <li key={file.id}>
                              <a href={file.dataUrl} download={file.name}>
                                {file.name}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <small>{formatDate(message.sentAt)}</small>
                    </li>
                  )
                })}
                {communityMessages.length === 0 ? (
                  <li className="empty-chat">No hay mensajes en esta conversación.</li>
                ) : null}
              </ul>
              <form className="community-form" onSubmit={handleSendCommunityMessage}>
                <textarea
                  placeholder="Escribe un mensaje privado..."
                  value={communityDraftText}
                  onChange={(event) => setCommunityDraftText(event.target.value)}
                  disabled={!communityTargetId}
                />
                <div
                  className={`community-dropzone${communityDragActive ? ' drag-active' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setCommunityDragActive(true)
                  }}
                  onDragLeave={() => setCommunityDragActive(false)}
                  onDrop={(event) => {
                    void handleCommunityDrop(event)
                  }}
                >
                  Arrastra archivos aquí o selecciónalos para compartir interconsultas.
                </div>
                <label>
                  Adjuntar archivo
                  <div className="file-picker">
                    <label
                      htmlFor="community-file-input"
                      className={`file-picker-button${!communityTargetId ? ' disabled' : ''}`}
                    >
                      Seleccionar archivos
                    </label>
                    <input
                      id="community-file-input"
                      className="file-input-hidden"
                      type="file"
                      multiple
                      onChange={(event) => {
                        void handleCommunityFileInput(event)
                      }}
                      disabled={!communityTargetId}
                    />
                  </div>
                </label>
                {communityDraftFiles.length > 0 ? (
                  <ul className="community-draft-files">
                    {communityDraftFiles.map((file) => (
                      <li key={file.id}>
                        <span>{file.name}</span>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleRemoveCommunityDraftFile(file.id)}
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button type="submit" disabled={!communityTargetId}>
                  Enviar mensaje
                </button>
              </form>
            </section>
          </div>
        </section>
      ) : null}

      {workspaceLayer === 'user-admin' ? (
        <div className="screen-stage">
          <section className="panel admin-users-panel">
            <div className="panel-header">
              <div>
                <h2>Administración clínica y suscripciones</h2>
                <p className="flow-hint">
                  Desde aquí puedes gestionar accesos, suscripciones y archivar el contenido de usuarios eliminados.
                </p>
              </div>
              <button type="button" className="ghost" onClick={handleBackToOverview}>
                Volver
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: 18,
              }}
            >
              <div className="overview-card" style={{ padding: 14 }}>
                <strong>Suscripciones activas</strong>
                <div style={{ fontSize: '1.4rem', marginTop: 6 }}>
                  {seedUsers.filter((user) => !isAdminUser(user) && user.subscriptionStatus === 'active').length}
                </div>
              </div>
              <div className="overview-card" style={{ padding: 14 }}>
                <strong>Próximas a vencer</strong>
                <div style={{ fontSize: '1.4rem', marginTop: 6 }}>
                  {
                    seedUsers.filter(
                      (user) =>
                        !isAdminUser(user) &&
                        user.subscriptionStatus === 'active' &&
                        user.subscriptionExpiresAt &&
                        new Date(user.subscriptionExpiresAt).getTime() - Date.now() <= 7 * DAY_IN_MS &&
                        new Date(user.subscriptionExpiresAt).getTime() > Date.now(),
                    ).length
                  }
                </div>
              </div>
              <div className="overview-card" style={{ padding: 14 }}>
                <strong>Archivos legales</strong>
                <div style={{ fontSize: '1.4rem', marginTop: 6 }}>{adminArchivedUsers.length}</div>
              </div>
            </div>

            <ul className="admin-user-list">
              {[...seedUsers]
                .sort((left, right) => left.fullName.localeCompare(right.fullName, 'es'))
                .map((user) => (
                  <li key={user.id} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 10 }}>
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <strong>{user.fullName}</strong>
                        <span>
                          {user.specialty} · {user.username}
                          {isAdminUser(user) ? ' · Administrador general' : ''}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.85rem', color: '#666', marginTop: 4 }}>
                          Estado suscripción:{' '}
                          <strong>
                            {user.subscriptionStatus === 'active'
                              ? 'Activa'
                              : user.subscriptionStatus === 'cancelled'
                                ? 'Cancelada'
                                : user.subscriptionStatus === 'expired'
                                  ? 'Vencida'
                                  : 'Trial'}
                          </strong>
                          {user.subscriptionExpiresAt ? ` · vence ${formatDate(user.subscriptionExpiresAt)}` : ''}
                        </span>
                      </div>
                      <div className="admin-user-actions">
                        <span className={user.active === false ? 'status-off' : 'status-on'}>
                          {user.active === false ? 'Inactivo' : 'Activo'}
                        </span>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void handleToggleUserActive(user.id)}
                          disabled={isAdminUser(user) || adminBusyUserId === user.id}
                        >
                          {user.active === false ? 'Activar' : 'Desactivar'}
                        </button>
                      </div>
                    </div>

                    {!isAdminUser(user) ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="ghost"
                          disabled={adminBusyUserId === user.id}
                          onClick={() => void handleAdminSetSubscription(user.id, 'monthly')}
                        >
                          Activar 30 días
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={adminBusyUserId === user.id}
                          onClick={() => void handleAdminSetSubscription(user.id, 'semiannual')}
                        >
                          Extender 6 meses
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={adminBusyUserId === user.id}
                          onClick={() => void handleAdminSetSubscription(user.id, 'annual')}
                        >
                          Extender 1 año
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={adminBusyUserId === user.id}
                          onClick={() => void handleAdminSetSubscription(user.id, 'cancel')}
                        >
                          Cancelar suscripción
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          style={{ color: '#c0392b' }}
                          disabled={adminBusyUserId === user.id}
                          onClick={() => void handleAdminDeleteUser(user.id)}
                        >
                          {adminBusyUserId === user.id ? 'Procesando...' : 'Eliminar usuario y archivar'}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>

            <section style={{ marginTop: 24 }}>
              <div className="panel-header" style={{ marginBottom: 12 }}>
                <div>
                  <h3>Archivo legal de usuarios eliminados</h3>
                  <p className="flow-hint">
                    Cada eliminación genera un resguardo descargable con pacientes, turnos y datos clínicos.
                  </p>
                </div>
              </div>
              {loadingAdminArchives ? (
                <p>Cargando archivos legales...</p>
              ) : adminArchivedUsers.length === 0 ? (
                <p>Aún no hay usuarios archivados.</p>
              ) : (
                <ul className="admin-user-list">
                  {adminArchivedUsers.map((archive) => (
                    <li key={archive.id}>
                      <div>
                        <strong>{archive.deletedFullName}</strong>
                        <span>
                          {archive.deletedUsername} · {archive.patientCount} paciente{archive.patientCount === 1 ? '' : 's'} ·{' '}
                          {archive.appointmentCount} turno{archive.appointmentCount === 1 ? '' : 's'}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.85rem', color: '#666', marginTop: 4 }}>
                          Eliminado el {formatDate(archive.deletedAt)} por {archive.deletedByUserName}
                        </span>
                      </div>
                      <div className="admin-user-actions">
                        <button type="button" className="ghost" onClick={() => handleDownloadDeletedUserArchive(archive)}>
                          Descargar archivo legal
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel" style={{ marginTop: 20 }}>
              <h3>📢 Enviar comunicado general o novedades</h3>
              <p className="flow-hint">
                Envía una notificación y mensaje a todos los profesionales registrados sobre cambios en la plataforma, actualizaciones o avisos urgentes.
              </p>
              <div className="grid" style={{ marginTop: 12 }}>
                <label>
                  Asunto o título del comunicado (opcional)
                  <input
                    value={adminBroadcastSubject}
                    onChange={(event) => setAdminBroadcastSubject(event.target.value)}
                    placeholder="Ej: Nueva versión disponible / Mantenimiento programado"
                  />
                </label>
                <label>
                  Mensaje del comunicado
                  <textarea
                    value={adminBroadcastBody}
                    onChange={(event) => setAdminBroadcastBody(event.target.value)}
                    placeholder="Escribe el mensaje que recibirán todos los profesionales..."
                    rows={3}
                  />
                </label>
                <div>
                  <button
                    type="button"
                    disabled={adminBroadcastSending || !adminBroadcastBody.trim()}
                    onClick={() => void handleSendAdminBroadcast()}
                  >
                    {adminBroadcastSending ? 'Enviando comunicado...' : '🚀 Enviar comunicado a todos los médicos'}
                  </button>
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'tools' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>Herramientas clínicas</h2>
              <p className="flow-hint">Consulta rápida de medicamentos y recursos de apoyo.</p>
            </div>
            <button type="button" className="ghost" onClick={handleBackToOverview}>
              Volver
            </button>
          </section>
          <section className="workspace">
            <section className="panel">
              <h3>Vademécum</h3>
              <label>
                Buscar medicamento
                <input
                  value={vademecumSearchQuery}
                  onChange={(event) => {
                    setVademecumSearchQuery(event.target.value)
                    setSelectedMedicationId(null)
                  }}
                  placeholder="Escribe al menos 4 letras: ibup, amox, enal"
                />
              </label>
              <small>
                Escribe 4 letras o más para buscar por aproximación. Se muestran hasta 7 sugerencias.
              </small>
              <ul className="admin-user-list" style={{ marginTop: 16 }}>
                {vademecumSearchQuery.trim().length === 0 ? (
                  <li>
                    <div>
                      <strong>Busca por nombre o droga</strong>
                      <span>Escribe al menos 4 letras para activar las sugerencias.</span>
                    </div>
                  </li>
                ) : normalizeSearchText(vademecumSearchQuery).length < VADEMECUM_MIN_QUERY_LENGTH ? (
                  <li>
                    <div>
                      <strong>Faltan letras para buscar</strong>
                      <span>Ingresa 4 letras o más para ver coincidencias aproximadas.</span>
                    </div>
                  </li>
                ) : filteredMedicationCatalog.length === 0 ? (
                  <li>
                    <div>
                      <strong>No hay sugerencias</strong>
                      <span>Prueba con otra marca, droga o laboratorio.</span>
                    </div>
                  </li>
                ) : (
                  filteredMedicationCatalog.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="ghost"
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          justifyContent: 'flex-start',
                          borderColor: selectedMedication?.id === entry.id ? '#1d4ed8' : undefined,
                        }}
                        onClick={() => {
                          setSelectedMedicationId(entry.id)
                          setWorkspaceLayer('medication-detail')
                        }}
                      >
                        <span>
                          <strong>{entry.brand || entry.drug}</strong>
                          <br />
                          <small>{[entry.drug, entry.presentation].filter(Boolean).join(' · ') || 'Sin detalle adicional'}</small>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'medication-detail' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>Ficha del medicamento</h2>
              <p className="flow-hint">Información farmacológica del catálogo.</p>
            </div>
            <button type="button" className="ghost" onClick={handleOpenTools}>
              Volver a la búsqueda
            </button>
          </section>
          {selectedMedication ? (
            <section className="panel medication-detail-panel">
              <header>
                <h1>{selectedMedication.brand || selectedMedication.drug}</h1>
                {selectedMedication.drug ? <p>{selectedMedication.drug}</p> : null}
              </header>
              <dl className="medication-details">
                {[
                  ['Marca', selectedMedication.brand],
                  ['Droga', selectedMedication.drug],
                  ['Presentación', selectedMedication.presentation],
                  ['Laboratorio', selectedMedication.laboratory],
                  ['Mecanismo de acción', selectedMedication.mechanismOfAction],
                  ['Efectos adversos', selectedMedication.adverseEffects],
                  ['Posología', selectedMedication.dosage],
                  ['Indicaciones', selectedMedication.indications],
                  ['Contraindicaciones', selectedMedication.contraindications],
                ].map(([label, value]) =>
                  value ? (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </section>
          ) : (
            <section className="panel">
              <p className="flow-hint">El medicamento ya no está disponible. Vuelve a la búsqueda.</p>
            </section>
          )}
        </div>
      ) : null}

      {workspaceLayer === 'overview' ? (
        <div className="screen-stage">
          <section className="workspace single-column">
            <section className="panel">
              <div className="overview-dashboard">
                <article className="overview-card quick-start-card">
                  <h2>Atención médica</h2>
                  <p>Inicia una consulta, busca un paciente o crea uno nuevo.</p>
                  <button type="button" onClick={handleStartAttentionFlow}>
                    Iniciar atención médica
                  </button>
                  <small>Luego podrás buscar o agregar pacientes desde la ficha.</small>
                </article>
                <article className="overview-card ambulance-card">
                  <h2>🚑 Modo Ambulancia</h2>
                  <p>Activa el acceso rápido para traslados, guardias y atención prehospitalaria.</p>
                  <label className="toggle-option">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={(event) => {
                        if (event.target.checked) {
                          handleOpenAmbulance()
                          return
                        }
                        setWorkspaceLayer('overview')
                      }}
                    />
                    <span className="toggle-switch" />
                    <span>Desactivado</span>
                  </label>
                  <button type="button" className="ghost" style={{ marginTop: 16 }} onClick={handleOpenAmbulanceHistory}>
                    Pacientes atendidos en ambulancia
                  </button>
                </article>
                <article className="overview-card">
                  <h2>📰 Noticias médicas</h2>
                  <p>
                    Elegí una fuente para verla en el momento. OMS y Ministerio de Salud de la Nación se
                    actualizan automáticamente; las demás abren su sitio oficial.
                  </p>
                  {(() => {
                    const activeNews = medicalNews[currentMedicalNewsIndex] ?? medicalNews[0] ?? null
                    const activeImageUrl =
                      activeNews?.imageUrl ||
                      (activeNews?.source.includes('Ministerio')
                        ? MEDICAL_NEWS_FALLBACK[0].imageUrl
                        : MEDICAL_NEWS_FALLBACK[1].imageUrl)
                    if (medicalNewsLoading) {
                      return <p>Cargando noticias...</p>
                    }
                    if (!activeNews) {
                      return <p>No hay noticias disponibles en este momento.</p>
                    }
                    return (
                      <div style={{ display: 'grid', gap: 12 }}>
                        <div
                          aria-label="Fuentes de noticias médicas"
                          style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}
                        >
                          {Array.from(new Map(medicalNews.map((item, index) => [item.source, index])).entries()).map(
                            ([source, index]) => (
                              <button
                                key={source}
                                type="button"
                                className="ghost compact"
                                style={{
                                  flex: '0 0 auto',
                                  borderColor:
                                    index === currentMedicalNewsIndex ? '#1d4ed8' : undefined,
                                  background:
                                    index === currentMedicalNewsIndex ? '#e8f0ff' : undefined,
                                  color: index === currentMedicalNewsIndex ? '#0b2d6b' : undefined,
                                }}
                                onClick={() => setCurrentMedicalNewsIndex(index)}
                              >
                                {source}
                              </button>
                            ),
                          )}
                        </div>
                        <article
                          style={{
                            borderRadius: 18,
                            overflow: 'hidden',
                            border: '1px solid rgba(69, 116, 191, 0.2)',
                            background: '#f7faff',
                            boxShadow: '0 12px 24px rgba(18, 58, 104, 0.12)',
                          }}
                        >
                          <div
                            style={{
                              minHeight: 320,
                              backgroundImage: `linear-gradient(180deg, rgba(10, 20, 35, 0.1), rgba(10, 20, 35, 0.55)), url("${activeImageUrl}")`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              display: 'flex',
                              alignItems: 'flex-end',
                              padding: 20,
                            }}
                          >
                            <div style={{ color: '#fff', display: 'grid', gap: 8 }}>
                              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                <strong>{activeNews.source}</strong>
                                <small style={{ color: 'rgba(255,255,255,0.9)' }}>
                                  {activeNews.publishedAt ? formatDate(activeNews.publishedAt) : 'Fuente oficial'}
                                </small>
                              </div>
                              <h3 style={{ margin: 0, fontSize: '1.35rem', lineHeight: 1.25 }}>{activeNews.title}</h3>
                            </div>
                          </div>
                          <div style={{ padding: 18, display: 'grid', gap: 12 }}>
                            <p style={{ margin: 0, color: '#42556f', lineHeight: 1.6 }}>
                              {activeNews.summary || 'Abrí la fuente oficial para ver la noticia completa.'}
                            </p>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                              <small>
                                {currentMedicalNewsIndex + 1} de {medicalNews.length}
                              </small>
                              <a href={activeNews.link} target="_blank" rel="noreferrer">
                                Ver noticia completa
                              </a>
                            </div>
                          </div>
                        </article>
                      </div>
                    )
                  })()}
                </article>
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'ambulance-history' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>Pacientes atendidos en ambulancia</h2>
              <p className="flow-hint">Consulta completa de los pacientes atendidos durante la guardia.</p>
            </div>
            <button type="button" className="ghost" onClick={handleBackToOverview}>
              Volver
            </button>
          </section>
          <section className="workspace single-column">
            <section className="panel">
              {ambulanceRecentPatients.length > 0 ? (
                <ul className="search-suggestions">
                  {ambulanceRecentPatients.map(({ patient, consultation }) => (
                    <li key={`${patient.id}-${consultation.id}`}>
                      <button type="button" onClick={() => handleSelectPatient(patient.id)}>
                        <strong>
                          {patient.apellido}, {patient.nombre || '(sin nombre)'}
                        </strong>
                        <span>{consultation.diagnostico || 'Sin diagnóstico'}</span>
                        <span>
                          {formatDate(consultation.date)} · DNI {patient.dni || 'Sin dato'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="search-empty">Todavía no registraste pacientes desde Modo Ambulancia.</p>
              )}
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'patient-search' ? (
        <div className="screen-stage">
          <section className="workspace single-column">
            <section className="panel patient-browser-panel">
              <div className="panel-header">
                <h2>Pacientes</h2>
                <button type="button" onClick={handleNewPatient}>
                  Nuevo
                </button>
              </div>
              <label>
                Buscar paciente
                <input
                  type="search"
                  placeholder="Nombre, apellido o DNI"
                  value={patientSearchQuery}
                  onChange={(event) => setPatientSearchQuery(event.target.value)}
                />
              </label>
              <small>
                Escribe un nombre, apellido o DNI para ver coincidencias y abrir la ficha.
              </small>
              {patientSearchQuery.trim() ? (
                <>
                  <small>{visiblePatients.length} coincidencias cercanas</small>
                  {patientSearchSuggestions.length > 0 ? (
                    <ul className="search-suggestions">
                      {patientSearchSuggestions.map((patient) => (
                        <li key={patient.id}>
                          <button type="button" onClick={() => handleSelectPatient(patient.id)}>
                            <strong>
                              {patient.apellido}, {patient.nombre || '(sin nombre)'}
                            </strong>
                            <span>DNI {patient.dni}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="search-empty">No hay coincidencias cercanas.</p>
                  )}
                </>
              ) : (
                <p className="search-empty">Escribe para empezar a buscar pacientes.</p>
              )}
              <div className="patient-import-actions">
                <div className="file-picker">
                  <label htmlFor="import-patient-json" className="file-picker-button compact">
                    Historia previa
                  </label>
                  <input
                    id="import-patient-json"
                    className="file-input-hidden"
                    type="file"
                    accept=".txt,.md,.json,text/plain,text/markdown,application/json,.pdf,.doc,.docx"
                    onChange={handleImportPatient}
                  />
                </div>
                <div className="file-picker">
                  <label htmlFor="import-padron-excel" className="file-picker-button compact">
                    Importar padrón
                  </label>
                  <input
                    id="import-padron-excel"
                    className="file-input-hidden"
                    type="file"
                    accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    onChange={(event) => {
                      void handleImportPadronExcel(event)
                    }}
                  />
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'patient-record' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>Ficha del paciente</h2>
              <p className="flow-hint">
                Completa la ficha inicial y luego modifícala solo cuando lo necesites.
              </p>
            </div>
            <div className="layer-actions">
              <button type="button" className="ghost" onClick={handleStartAttentionFlow}>
                Volver a pacientes
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleOpenClinicalPage}
                disabled={!selectedPatient}
              >
                + Evolucionar paciente
              </button>
            </div>
          </section>

          <section className="workspace single-column">
            <section className="panel patient-record-panel">
              <form className="grid" onSubmit={handleSavePatient}>
                {!canEditSelectedPatientRecord && selectedPatient ? (
                  <p className="access-note">
                    Esta historia está compartida por otro profesional. Puedes agregar consultas
                    nuevas, pero no modificar la ficha base ni imprimir el resumen completo.
                  </p>
                ) : null}
                {selectedPatient ? (
                  <section className="patient-summary-card">
                    <div>
                      <p className="patient-summary-label">Resumen del paciente</p>
                      <h3>
                        {selectedPatient.apellido}, {selectedPatient.nombre || 'Sin nombre'}
                      </h3>
                    </div>
                    <div className="patient-summary-grid">
                      <div>
                        <span>DNI</span>
                        <strong>{selectedPatient.dni || 'Sin dato'}</strong>
                      </div>
                      <div>
                        <span>Obra social</span>
                        <strong>{selectedPatient.obraSocial || 'Sin dato'}</strong>
                      </div>
                      <div>
                        <span>Número de afiliado</span>
                        <strong>{selectedPatient.numeroAfiliado || 'Sin dato'}</strong>
                      </div>
                      <div>
                        <span>Plan</span>
                        <strong>{selectedPatient.plan || 'Sin dato'}</strong>
                      </div>
                      <div>
                        <span>Diagnóstico principal</span>
                        <strong>{selectedPatient.diagnosticoPrincipal || 'Sin dato'}</strong>
                      </div>
                      <div>
                        <span>Fecha de nacimiento</span>
                        <strong>
                          {selectedPatient.birthDate
                            ? formatDate(selectedPatient.birthDate)
                            : 'Sin dato'}
                        </strong>
                      </div>
                      <div>
                        <span>Edad actual</span>
                        <strong>
                          {selectedPatient.edad || calculateAge(selectedPatient.birthDate)}
                        </strong>
                      </div>
                    </div>
                  </section>
                ) : null}
                {!selectedPatient || canEditSelectedPatientRecord ? (
                  <div className="record-mode-actions">
                    <div className="record-scan-actions">
                      <button
                        type="button"
                        className="file-picker-button compact"
                        onClick={() => {
                          openFileDialog('patient-photo-carnet-upload')
                        }}
                      >
                        SUBIR FOTO CREDENCIAL
                      </button>
                      <button
                        type="button"
                        className="file-picker-button compact"
                        onClick={() => {
                          void startLiveScanner('credential')
                        }}
                      >
                        SCANEAR CREDENCIAL
                      </button>
                      <button
                        type="button"
                        className="file-picker-button compact"
                        onClick={() => {
                          openFileDialog('patient-photo-dni-upload')
                        }}
                      >
                        SUBIR FOTO DNI
                      </button>
                      <button
                        type="button"
                        className="file-picker-button compact"
                        onClick={() => {
                          void startLiveScanner('dni')
                        }}
                      >
                        SCANEAR DNI
                      </button>
                      <input
                        id="patient-photo-carnet-upload"
                        className="file-input-hidden"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          void handleSingleUpload(event, 'photoCarnet')
                        }}
                      />
                      <input
                        id="patient-photo-dni-upload"
                        className="file-input-hidden"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          void handleSingleUpload(event, 'dniPhoto')
                        }}
                      />
                    </div>
                    {selectedPatient ? (
                      !patientFormUnlocked ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setPatientFormUnlocked(true)
                          }}
                        >
                          Modificar datos del paciente
                        </button>
                      ) : (
                        <p className="access-note">
                          Estás editando la ficha base. Guarda los cambios para volver a bloquearla.
                        </p>
                      )
                    ) : null}
                  </div>
                ) : null}
                <fieldset className="patient-edit-fieldset" disabled={!canEditPatientForm}>
                  <section className="patient-form-block">
                    <h4 className="block-title">📋 Datos filiatorios</h4>
                    <div className="grid two-col">
                      <label>
                        Nombre
                        <input name="nombre" value={patientDraft.nombre} onChange={handlePatientDraftChange} />
                      </label>
                      <label>
                        Apellido
                        <input name="apellido" value={patientDraft.apellido} onChange={handlePatientDraftChange} required />
                      </label>
                      <label>
                        DNI
                        <input name="dni" value={patientDraft.dni} onChange={handlePatientDraftChange} required />
                      </label>
                      <label>
                        Fecha de nacimiento
                        <input type="date" name="birthDate" value={patientDraft.birthDate} onChange={handlePatientDraftChange} />
                      </label>
                      <label>
                        Edad actual
                        <input value={calculateAge(patientDraft.birthDate) || ''} readOnly />
                      </label>
                      <label>
                        Dirección
                        <input name="direccion" value={patientDraft.direccion} onChange={handlePatientDraftChange} />
                      </label>
                      <label>
                        Correo electrónico
                        <input type="email" name="email" value={patientDraft.email} onChange={handlePatientDraftChange} />
                      </label>
                    </div>
                  </section>
                  <section className="patient-form-block">
                    <h4 className="block-title">🏥 Datos de afiliación</h4>
                    <div className="grid two-col">
                      <label>
                        Obra social
                        <input name="obraSocial" value={patientDraft.obraSocial} onChange={handlePatientDraftChange} />
                      </label>
                      <label>
                        Número de afiliado
                        <input name="numeroAfiliado" value={patientDraft.numeroAfiliado} onChange={handlePatientDraftChange} />
                      </label>
                      <label>
                        Plan
                        <input name="plan" value={patientDraft.plan} onChange={handlePatientDraftChange} />
                      </label>
                    </div>
                  </section>
                  <section className="patient-form-block">
                    <h4 className="block-title">🩺 Antecedentes clínicos</h4>
                    <label>
                      Diagnóstico principal
                      <input
                        name="diagnosticoPrincipal"
                        value={patientDraft.diagnosticoPrincipal}
                        onChange={handlePatientDraftChange}
                        placeholder="Escriba el diagnóstico principal..."
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Patologías conocidas
                      <textarea name="patologiasConocidas" value={patientDraft.patologiasConocidas} onChange={handlePatientDraftChange} />
                    </label>
                    <label>
                      Patologías crónicas
                      <textarea name="patologiasCronicas" value={patientDraft.patologiasCronicas} onChange={handlePatientDraftChange} />
                    </label>
                    <label>
                      Última internación
                      <textarea name="ultimaInternacion" value={patientDraft.ultimaInternacion} onChange={handlePatientDraftChange} />
                    </label>
                    <label>
                      Cirugías previas
                      <textarea name="cirugiasPrevias" value={patientDraft.cirugiasPrevias} onChange={handlePatientDraftChange} />
                    </label>
                  </section>
                  <section className="patient-form-block">
                    <h4 className="block-title">📁 Documentación del paciente</h4>
                    <label>
                      Adjuntar documentos (foto, PDF, DOCX, imagen)
                      <div className="file-picker">
                        <label htmlFor="patient-documents" className="file-picker-button">Seleccionar archivos</label>
                        <input
                          id="patient-documents"
                          className="file-input-hidden"
                          type="file"
                          multiple
                          accept="image/*,.pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={(event) => { void handleDocumentsUpload(event) }}
                        />
                      </div>
                    </label>
                    <ul className="file-list">
                      {patientDraft.dniPhoto ? (
                        <li>
                          <strong>DNI:</strong>{' '}
                          <a href={patientDraft.dniPhoto.dataUrl} target="_blank" rel="noreferrer">{patientDraft.dniPhoto.name}</a>
                        </li>
                      ) : null}
                      {patientDraft.photoCarnet ? (
                        <li>
                          <strong>Credencial:</strong>{' '}
                          <a href={patientDraft.photoCarnet.dataUrl} target="_blank" rel="noreferrer">{patientDraft.photoCarnet.name}</a>
                        </li>
                      ) : null}
                      {patientDraft.documents.map((document) => (
                        <li key={document.id}>
                          <a href={document.dataUrl} download={document.name}>{document.name}</a>
                          {` `}
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => {
                              setPatientDraft((current) => ({
                                ...current,
                                documents: current.documents.filter((d) => d.id !== document.id),
                              }))
                            }}
                          >✕</button>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <button type="submit">Guardar ficha</button>
                  <small>Cada paciente se almacena de forma individual en su archivo plano local.</small>
                </fieldset>
                <div className="record-document-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={exportSelectedPatient}
                    disabled={!selectedPatient}
                  >
                    Descargar ficha
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={printSelectedPatientSummary}
                    disabled={!selectedPatient}
                  >
                    Imprimir resumen (PDF)
                  </button>
                </div>
              </form>
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'clinical' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>Evolucionar paciente</h2>
              {selectedPatient ? (
                <p className="flow-hint">
                  Paciente actual: {selectedPatient.nombre} {selectedPatient.apellido}
                </p>
              ) : null}
            </div>
            <button type="button" className="ghost" onClick={handleBackToPatient}>
              Volver a la ficha
            </button>
          </section>
          <section className="workspace single-column">
            <section className="panel patient-clinical-section">
              <h2>Evolución clínica (últimas consultas)</h2>
              {!selectedPatient ? (
                <p>Selecciona o crea un paciente para registrar consultas.</p>
              ) : (
                <section className="patient-summary-card clinical-summary-card">
                  <div>
                    <p className="patient-summary-label">Paciente en atención</p>
                    <h3>
                      {selectedPatient.apellido}, {selectedPatient.nombre || 'Sin nombre'}
                    </h3>
                  </div>
                  <div className="patient-summary-grid">
                    <div>
                      <span>DNI</span>
                      <strong>{selectedPatient.dni || 'Sin dato'}</strong>
                    </div>
                    <div>
                      <span>Obra social</span>
                      <strong>{selectedPatient.obraSocial || 'Sin dato'}</strong>
                    </div>
                    <div>
                      <span>Número de afiliado</span>
                      <strong>{selectedPatient.numeroAfiliado || 'Sin dato'}</strong>
                    </div>
                    <div>
                      <span>Plan</span>
                      <strong>{selectedPatient.plan || 'Sin dato'}</strong>
                    </div>
                    <div>
                      <span>Diagnóstico principal</span>
                      <strong>{selectedPatient.diagnosticoPrincipal || 'Sin dato'}</strong>
                    </div>
                    <div>
                      <span>Fecha de nacimiento</span>
                      <strong>
                        {selectedPatient.birthDate ? formatDate(selectedPatient.birthDate) : 'Sin dato'}
                      </strong>
                    </div>
                    <div>
                      <span>Edad actual</span>
                      <strong>{selectedPatient.edad || calculateAge(selectedPatient.birthDate)}</strong>
                    </div>
                    <div>
                      <span>Patologías crónicas</span>
                      <strong>{selectedPatient.patologiasCronicas || 'Sin dato'}</strong>
                    </div>
                    <div>
                      <span>Última internación</span>
                      <strong>{selectedPatient.ultimaInternacion || 'Sin dato'}</strong>
                    </div>
                  </div>
                </section>
              )}
              <form className="grid" onSubmit={handleSaveConsultation}>
                <label>
                  Motivo de consulta (última atención)
                  <input
                    name="motivoConsulta"
                    value={consultationDraft.motivoConsulta}
                    onChange={handleConsultationDraftChange}
                    required
                    placeholder="Escriba el diagnóstico o elija una sugerencia..."
                    autoComplete="off"
                    list="diagnosis-suggestions-list"
                  />
                  <datalist id="diagnosis-suggestions-list">
                    {consultationDiagnosisVisibleList.map((diagnosis) => (
                      <option key={diagnosis} value={diagnosis} />
                    ))}
                  </datalist>
                  {consultationDiagnosisVisibleList.length > 0 ? (
                    <div className="diagnosis-picker-panel">
                      <p className="search-empty">Sugerencias con aproximación</p>
                      <ul className="search-suggestions">
                        {consultationDiagnosisVisibleList.map((diagnosis) => (
                          <li key={diagnosis}>
                            <button
                              type="button"
                              onClick={() => {
                                setConsultationDraft((current) => ({
                                  ...current,
                                  motivoConsulta: diagnosis,
                                }))
                              }}
                            >
                              {diagnosis}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </label>
                <label>
                  Resumen de atención
                  <div className="dictation-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        void startDictationForConsultationField('detalleAtencion')
                      }}
                      disabled={!dictationAvailable || dictating}
                    >
                      🎙 Iniciar micrófono
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={stopDictation}
                      disabled={!dictationAvailable || !dictating}
                    >
                      Detener
                    </button>
                  </div>
                  <textarea
                    name="detalleAtencion"
                    value={consultationDraft.detalleAtencion}
                    onChange={handleConsultationDraftChange}
                  />
                  {dictationAvailable ? (
                    <small>Tip: permite el micrófono cuando el navegador lo solicite.</small>
                  ) : null}
                  {dictating && dictationField === 'detalleAtencion' ? (
                    <small>Dictando en este recuadro...</small>
                  ) : null}
                  {!dictationAvailable ? (
                    <small>Tu navegador no soporta transcripción por voz nativa.</small>
                  ) : null}
                </label>
                <label>
                  Pensamiento médico (reflexión profesional)
                  <div className="dictation-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        void startDictationForConsultationField('pensamientoMedico')
                      }}
                      disabled={!dictationAvailable || dictating}
                    >
                      🎙 Iniciar micrófono
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={stopDictation}
                      disabled={!dictationAvailable || !dictating}
                    >
                      Detener
                    </button>
                  </div>
                  <textarea
                    name="pensamientoMedico"
                    value={consultationDraft.pensamientoMedico}
                    onChange={handleConsultationDraftChange}
                  />
                  {dictating && dictationField === 'pensamientoMedico' ? (
                    <small>Dictando en este recuadro...</small>
                  ) : null}
                </label>
                <button type="submit">Guardar actualización</button>
              </form>
              <ul className="consultation-list">
                {selectedPatient?.consultations.map((entry) => (
                  <li key={entry.id}>
                    <header>
                      <strong>{formatDate(entry.date)}</strong>
                      <span>Motivo: {entry.motivoConsulta}</span>
                    </header>
                    {entry.diagnostico ? <p><strong>Diagnóstico:</strong> {entry.diagnostico}</p> : null}
                    <p>{entry.detalleAtencion}</p>
                    <p>
                      <strong>Pensamiento médico:</strong> {entry.pensamientoMedico}
                    </p>
                    <footer>
                      <p>
                        Firma: {entry.professionalSignature.fullName} (Matrícula{' '}
                        {entry.professionalSignature.licenseNumber})
                      </p>
                      <p>{entry.professionalSignature.signatureText}</p>
                      <button
                        type="button"
                        className="ghost consultation-print-button"
                        onClick={() => {
                          printSingleConsultation(entry)
                        }}
                      >
                        Imprimir esta atención
                      </button>
                      {entry.professionalSignature.signatureImageDataUrl ? (
                        <img
                          src={entry.professionalSignature.signatureImageDataUrl}
                          alt="Firma digital"
                          className="signature-preview"
                        />
                      ) : null}
                    </footer>
                  </li>
                ))}
              </ul>
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'profile' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <h2>Perfil profesional</h2>
            <button type="button" className="ghost" onClick={handleBackToOverview}>
              Volver al listado general
            </button>
          </section>
          <section className="workspace single-column">
            <section className="panel">
              <form className="grid" onSubmit={handleSaveProfile}>
                <label>
                  Nombre profesional
                  <input
                    name="fullName"
                    value={profile.fullName}
                    onChange={handleProfileFieldChange}
                  />
                </label>
                <label>
                  Especialidad
                  <input
                    name="specialty"
                    value={profile.specialty}
                    onChange={handleProfileFieldChange}
                    autoComplete="off"
                    list="profile-specialty-suggestions-list"
                  />
                  <datalist id="profile-specialty-suggestions-list">
                    {profileSpecialtySuggestions.map((specialty) => (
                      <option key={specialty} value={specialty} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Matrícula
                  <input
                    name="licenseNumber"
                    value={profile.licenseNumber}
                    onChange={handleProfileFieldChange}
                  />
                </label>
                <label>
                  Email
                  <input name="email" value={profile.email} onChange={handleProfileFieldChange} />
                </label>
                <label>
                  Teléfono
                  <input name="phone" value={profile.phone} onChange={handleProfileFieldChange} />
                </label>
                <label>
                  Texto de firma digital
                  <input
                    name="signatureText"
                    value={profile.signatureText}
                    onChange={handleProfileFieldChange}
                  />
                </label>
                <label>
                  Foto de matrícula
                  <div className="file-picker">
                    <label htmlFor="profile-matricula-photo" className="file-picker-button">
                      Seleccionar imagen
                    </label>
                    <input
                      id="profile-matricula-photo"
                      className="file-input-hidden"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        void handleSingleUpload(event, 'matriculaPhoto')
                      }}
                    />
                  </div>
                </label>
                <label>
                  Imagen de firma digital
                  <div className="file-picker">
                    <label htmlFor="profile-signature-image" className="file-picker-button">
                      Seleccionar imagen
                    </label>
                    <input
                      id="profile-signature-image"
                      className="file-input-hidden"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        void handleSingleUpload(event, 'signatureImage')
                      }}
                    />
                  </div>
                </label>
                <div className="signature-pad-group">
                  <p>Firma a mano alzada (mouse, touch o lápiz)</p>
                  <canvas
                    ref={signatureCanvasRef}
                    width={640}
                    height={220}
                    className="signature-pad"
                    onPointerDown={handleSignaturePointerDown}
                    onPointerMove={handleSignaturePointerMove}
                    onPointerUp={handleSignaturePointerUp}
                    onPointerLeave={handleSignaturePointerUp}
                  />
                  <div className="dictation-actions">
                    <button type="button" className="ghost" onClick={handleClearSignaturePad}>
                      Limpiar firma
                    </button>
                    <button type="button" onClick={handleSaveHandwrittenSignature}>
                      Guardar firma manual
                    </button>
                  </div>
                </div>
                {profile.matriculaPhoto ? (
                  <img
                    src={profile.matriculaPhoto.dataUrl}
                    alt="Foto matrícula"
                    className="signature-preview"
                  />
                ) : null}
                {profile.signatureImage ? (
                  <img
                    src={profile.signatureImage.dataUrl}
                    alt="Firma digital"
                    className="signature-preview"
                  />
                ) : null}
                <button type="submit">Guardar perfil</button>
              </form>
            </section>
            <section className="panel">
              <h3>Cambiar contraseña</h3>
              <form className="grid" onSubmit={handleSaveOwnPassword}>
                <label>
                  Nueva contraseña
                  <input
                    type="password"
                    name="newPassword"
                    value={passwordChangeDraft.newPassword}
                    onChange={handlePasswordChangeField}
                    minLength={8}
                    required
                  />
                </label>
                <label>
                  Repetir nueva contraseña
                  <input
                    type="password"
                    name="confirmPassword"
                    value={passwordChangeDraft.confirmPassword}
                    onChange={handlePasswordChangeField}
                    minLength={8}
                    required
                  />
                </label>
                <button type="submit">Actualizar contraseña</button>
              </form>
            </section>
            <section className="panel">
              <h3>🔔 Notificaciones en tu dispositivo</h3>
              <p className="flow-hint">
                Recibe alertas en pantalla y vibración cuando un colega te envíe un mensaje privado o el administrador publique novedades.
              </p>
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>Estado:</strong>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        notificationPermission === 'granted'
                          ? '#16a34a'
                          : notificationPermission === 'denied'
                            ? '#dc2626'
                            : '#d97706',
                    }}
                  >
                    {notificationPermission === 'granted'
                      ? '✅ Notificaciones activas'
                      : notificationPermission === 'denied'
                        ? '❌ Bloqueadas en tu navegador'
                        : '⚠️ Pendiente de activación'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {notificationPermission !== 'granted' ? (
                    <button type="button" onClick={() => void handleEnableNotifications()}>
                      🔔 Activar notificaciones en este celular / equipo
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        void showAppNotification('🔔 Dr Happy 😊', {
                          body: '¡La prueba de notificación en tu dispositivo funciona correctamente!',
                        })
                        showSavedFloatingNotice('Notificación de prueba enviada')
                      }}
                    >
                      📲 Enviar notificación de prueba
                    </button>
                  )}
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}
      {workspaceLayer === 'ambulance' ? (() => {
        const ambulancePatient = patients.find((p) => p.id === ambulanceSelectedPatientId) ?? null
        const ambulanceResults = ambulancePatientSearch.trim()
          ? patients.filter((p) => {
              const q = normalizeSearchText(ambulancePatientSearch)
              return (
                normalizeSearchText(p.apellido).includes(q) ||
                normalizeSearchText(p.nombre).includes(q) ||
                p.dni.includes(q)
              )
            }).slice(0, 10)
          : []
        return (
          <div
            className="ambulance-fullscreen"
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'var(--bg, #fff)', overflowY: 'auto' }}
          >
            {/* Header */}
            <div className="ambulance-topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#c0392b', color: '#fff' }}>
              <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>🚑 MODO AMBULANCIA</span>
              <label className="toggle-option" style={{ color: '#fff' }}>
                <input
                  type="checkbox"
                  checked
                  onChange={() => {
                    ambulanceDictationRef.current?.stop()
                    setAmbulanceDictating(false)
                    setWorkspaceLayer('overview')
                    setAmbulancePatientSearch('')
                    setAmbulanceSelectedPatientId(null)
                  }}
                />
                <span className="toggle-switch" style={{ background: '#16a34a', borderColor: '#166534' }} />
                <span>ACTIVO</span>
              </label>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 600, margin: '0 auto' }}>

              {/* Bloque paciente */}
              <section className="panel" style={{ padding: '14px' }}>
                <h3 style={{ margin: '0 0 10px' }}>👤 Paciente</h3>
                {ambulancePatient ? (
                  <div>
                    <p style={{ margin: '4px 0', fontWeight: 600 }}>{ambulancePatient.apellido}, {ambulancePatient.nombre || 'Sin nombre'}</p>
                    <p style={{ margin: '4px 0', fontSize: '0.9rem' }}>DNI: {ambulancePatient.dni} | Edad: {ambulancePatient.edad || calculateAge(ambulancePatient.birthDate)}</p>
                    <p style={{ margin: '4px 0', fontSize: '0.9rem' }}>Obra social: {ambulancePatient.obraSocial || 'Sin dato'}</p>
                    <button
                      type="button"
                      className="ghost compact"
                      style={{ marginTop: 8 }}
                      onClick={() => { setAmbulanceSelectedPatientId(null); setAmbulancePatientSearch(''); setAmbulanceNewPatient(null) }}
                    >
                      🔄 Cambiar paciente
                    </button>
                  </div>
                ) : ambulanceNewPatient !== null ? (
                  /* Formulario rápido de nuevo paciente */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#888' }}>Paciente nuevo — completá los datos mínimos para registrarlo.</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        placeholder="Apellido *"
                        value={ambulanceNewPatient.apellido}
                        onChange={(e) => setAmbulanceNewPatient((p) => p ? { ...p, apellido: e.target.value } : p)}
                        style={{ flex: 1, padding: '10px', borderRadius: 6, border: '1px solid #ccc', fontSize: '1rem' }}
                        autoFocus
                      />
                      <input
                        placeholder="Nombre"
                        value={ambulanceNewPatient.nombre}
                        onChange={(e) => setAmbulanceNewPatient((p) => p ? { ...p, nombre: e.target.value } : p)}
                        style={{ flex: 1, padding: '10px', borderRadius: 6, border: '1px solid #ccc', fontSize: '1rem' }}
                      />
                    </div>
                    <input
                      placeholder="DNI (números)"
                      value={ambulanceNewPatient.dni}
                      onChange={(e) => setAmbulanceNewPatient((p) => p ? { ...p, dni: e.target.value.replace(/[^\d]/g, '') } : p)}
                      inputMode="numeric"
                      maxLength={9}
                      style={{ padding: '10px', borderRadius: 6, border: '1px solid #ccc', fontSize: '1rem' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        disabled={!ambulanceNewPatient.apellido.trim() || !ambulanceNewPatient.dni.trim()}
                        style={{
                          flex: 1, padding: '10px', fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: ambulanceNewPatient.apellido.trim() && ambulanceNewPatient.dni.trim() ? '#c0392b' : '#ccc',
                          color: '#fff',
                        }}
                        onClick={() => {
                          if (!activeUserId || !ambulanceNewPatient.apellido.trim() || !ambulanceNewPatient.dni.trim()) return
                          const existing = patients.find((p) => p.dni === ambulanceNewPatient.dni.trim())
                          if (existing) {
                            setAmbulanceSelectedPatientId(existing.id)
                            setAmbulanceNewPatient(null)
                            setAppNotice(`Paciente con DNI ${existing.dni} ya existe — seleccionado.`)
                            return
                          }
                          const now = new Date().toISOString()
                          const newId = crypto.randomUUID()
                          const newPatient: PatientRecord = {
                            id: newId,
                            ownerUserId: activeUserId,
                            nombre: ambulanceNewPatient.nombre.trim(),
                            apellido: ambulanceNewPatient.apellido.trim(),
                            dni: ambulanceNewPatient.dni.trim(),
                            email: '',
                            obraSocial: '',
                            numeroAfiliado: '',
                            plan: '',
                            birthDate: '',
                            edad: 0,
                            patologiasConocidas: '',
                            patologiasCronicas: '',
                            ultimaInternacion: '',
                            cirugiasPrevias: '',
                            direccion: '',
                            documents: [],
                            consultations: [],
                            createdAt: now,
                            updatedAt: now,
                          }
                          persistPatient(newPatient)
                          setAmbulanceSelectedPatientId(newId)
                          setAmbulanceNewPatient(null)
                          setAppNotice(`Paciente ${newPatient.apellido} registrado. Podés completar los datos luego desde la ficha.`)
                        }}
                      >
                        ✅ Registrar y continuar
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: '10px 14px', borderRadius: 6 }}
                        onClick={() => { setAmbulanceNewPatient(null) }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      type="search"
                      placeholder="Buscar paciente por apellido, nombre o DNI..."
                      value={ambulancePatientSearch}
                      onChange={(e) => setAmbulancePatientSearch(e.target.value)}
                      style={{ width: '100%', padding: '10px', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box' }}
                      autoFocus
                    />
                    {ambulanceResults.length > 0 && (
                      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, border: '1px solid #ddd', borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
                        {ambulanceResults.map((p) => (
                          <li key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                            <button
                              type="button"
                              className="ambulance-result-btn"
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.95rem' }}
                              onClick={() => { setAmbulanceSelectedPatientId(p.id); setAmbulancePatientSearch('') }}
                            >
                              <strong className="ambulance-result-name">{p.apellido}, {p.nombre || 'Sin nombre'}</strong>
                              <span className="ambulance-result-dni" style={{ marginLeft: 8, fontSize: '0.85rem' }}>DNI {p.dni}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {ambulancePatientSearch.trim().length > 1 && ambulanceResults.length === 0 && (
                      <div style={{ marginTop: 10 }}>
                        <p style={{ fontSize: '0.85rem', color: '#888', margin: '0 0 8px' }}>No se encontró "{ambulancePatientSearch.trim()}" en la base de datos.</p>
                        <button
                          type="button"
                          style={{ padding: '10px 16px', fontWeight: 600, background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                          onClick={() => setAmbulanceNewPatient({ nombre: '', apellido: ambulancePatientSearch.trim(), dni: '' })}
                        >
                          ➕ Registrar paciente nuevo
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Diagnóstico CIE-10 sugerido */}
              <section className="panel" style={{ padding: '14px' }}>
                <h3 style={{ margin: '0 0 10px' }}>🩺 Diagnóstico CIE-10</h3>
                <input
                  placeholder="Buscar diagnóstico CIE-10..."
                  value={ambulanceDraft.diagnosticoCie10}
                  onChange={(e) => setAmbulanceDraft((c) => ({ ...c, diagnosticoCie10: e.target.value }))}
                  autoComplete="off"
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box' }}
                />
                {ambulanceDraft.diagnosticoCie10.trim() && buildDiagnosisSuggestions(diagnosisCatalog, ambulanceDraft.diagnosticoCie10, 6).length > 0 && (
                  <ul className="search-suggestions" style={{ margin: '6px 0 0' }}>
                    {buildDiagnosisSuggestions(diagnosisCatalog, ambulanceDraft.diagnosticoCie10, 6).map((d) => (
                      <li key={d}>
                        <button type="button" onClick={() => setAmbulanceDraft((c) => ({ ...c, diagnosticoCie10: d }))}>
                          {d}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* QTH */}
              <section className="panel" style={{ padding: '14px' }}>
                <h3 style={{ margin: '0 0 10px' }}>📍 QTH del paciente</h3>
                <textarea
                  placeholder="Ubicación actual del paciente..."
                  value={ambulanceDraft.qth}
                  onChange={(e) => setAmbulanceDraft((c) => ({ ...c, qth: e.target.value }))}
                  rows={3}
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </section>

              {/* Destino */}
              <section className="panel" style={{ padding: '14px' }}>
                <h3 style={{ margin: '0 0 10px' }}>🏥 Destino del paciente</h3>
                <textarea
                  placeholder="Destino / centro de derivación..."
                  value={ambulanceDraft.destino}
                  onChange={(e) => setAmbulanceDraft((c) => ({ ...c, destino: e.target.value }))}
                  rows={3}
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </section>

              {/* Diagnóstico final — texto libre + dictado */}
              <section className="panel" style={{ padding: '14px' }}>
                <h3 style={{ margin: '0 0 10px' }}>📝 Diagnóstico final</h3>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!dictationAvailable || ambulanceDictating}
                    onClick={() => {
                      const SpeechApi = (window.SpeechRecognition ?? window.webkitSpeechRecognition) as (new () => BrowserSpeechRecognition) | undefined
                      if (!SpeechApi) { setAppError(`Este navegador no soporta dictado por voz.`); return }
                      setAppError(null)
                      const rec = new SpeechApi()
                      rec.lang = `es-AR`
                      rec.interimResults = false
                      rec.continuous = true
                      rec.onresult = (ev: DictationEvent) => {
                        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
                          const result = ev.results[i] ?? ev.results.item(i)
                          if (result && result.isFinal) {
                            const fragment = result[0].transcript.trim()
                            setAmbulanceDraft((c) => ({ ...c, diagnosticoFinal: (c.diagnosticoFinal + ` ` + fragment).trim() }))
                          }
                        }
                      }
                      rec.onerror = () => { setAmbulanceDictating(false) }
                      rec.onend = () => { setAmbulanceDictating(false) }
                      ambulanceDictationRef.current = rec
                      rec.start()
                      setAmbulanceDictating(true)
                    }}
                  >
                    🎙 {ambulanceDictating ? 'Dictando...' : 'Dictar'}
                  </button>
                  {ambulanceDictating && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => { ambulanceDictationRef.current?.stop(); setAmbulanceDictating(false) }}
                    >
                      ⏹ Detener
                    </button>
                  )}
                </div>
                <textarea
                  placeholder="Diagnóstico final del paciente (texto libre o dictado)..."
                  value={ambulanceDraft.diagnosticoFinal}
                  onChange={(e) => setAmbulanceDraft((c) => ({ ...c, diagnosticoFinal: e.target.value }))}
                  rows={4}
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: ambulanceDictating ? '2px solid #c0392b' : '1px solid #ccc', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </section>

              {/* Botón guardar */}
              <button
                type="button"
                style={{ padding: '14px', fontSize: '1rem', fontWeight: 700, background: '#c0392b', color: '#fff', border: 'none', borderRadius: 8, cursor: ambulancePatient ? 'pointer' : 'not-allowed', opacity: ambulancePatient ? 1 : 0.5 }}
                disabled={!ambulancePatient}
                onClick={() => {
                  if (!ambulancePatient || !activeUserId) {
                    setAppNotice(`Selecciona un paciente antes de guardar.`)
                    return
                  }
                  const diagnosticoGuardado = ambulanceDraft.diagnosticoFinal.trim() || ambulanceDraft.diagnosticoCie10.trim() || 'Sin diagnóstico'
                  const consultEntry: ConsultationEntry = {
                    id: crypto.randomUUID(),
                    date: new Date().toISOString(),
                    motivoConsulta: `[AMBULANCIA] QTH: ${ambulanceDraft.qth} | Destino: ${ambulanceDraft.destino}`,
                    diagnostico: diagnosticoGuardado,
                    detalleAtencion: [
                      ambulanceDraft.diagnosticoCie10 ? `CIE-10: ${ambulanceDraft.diagnosticoCie10}` : '',
                      `QTH: ${ambulanceDraft.qth}`,
                      `Destino: ${ambulanceDraft.destino}`,
                    ].filter(Boolean).join('\n'),
                    pensamientoMedico: ``,
                    professionalSignature: {
                      fullName: profile?.fullName ?? ``,
                      licenseNumber: profile?.licenseNumber ?? ``,
                      signatureText: profile?.signatureText ?? ``,
                      signatureImageDataUrl: profile?.signatureImage?.dataUrl,
                    },
                  }
                  persistPatientConsultation(ambulancePatient.id, consultEntry)
                  setAppNotice(`Consulta ambulancia guardada en la ficha de ${ambulancePatient.apellido}.`)
                  setAmbulanceDraft({ qth: ``, destino: ``, diagnosticoCie10: ``, diagnosticoFinal: `` })
                }}
              >
                💾 Guardar en ficha del paciente
              </button>

            </div>
          </div>
        )
      })() : null}
      {liveScanTarget ? (
        <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Escáner en vivo">
          <div className="scanner-panel">
            <h3>{liveScanTarget === 'dni' ? 'Escanear DNI' : 'Escanear credencial'}</h3>
            <p>{liveScanStatus || 'Preparando cámara…'}</p>
            <p className="scanner-hint">
              {liveScanTarget === 'dni'
                ? 'Apunta al frente del DNI y centra el código PDF417 dentro del recuadro.'
                : 'Centra el código QR de la credencial dentro del recuadro.'}
            </p>
            <div className="scanner-viewport">
              <video ref={liveScanVideoRef} className="scanner-video" autoPlay muted playsInline />
              <div className={`scanner-guide ${liveScanTarget === 'dni' ? 'dni' : 'qr'}`}>
                <div className="scanner-line" />
              </div>
            </div>
            <div className="scanner-actions">
              {(liveScanTarget === 'dni' ? patientDraft.dniPhoto : patientDraft.photoCarnet) ? (
                <img
                  src={liveScanTarget === 'dni' ? patientDraft.dniPhoto?.dataUrl : patientDraft.photoCarnet?.dataUrl}
                  alt={liveScanTarget === 'dni' ? 'Foto guardada del DNI' : 'Foto guardada de la credencial'}
                  className="scanner-preview"
                />
              ) : null}
              <button type="button" onClick={() => {
                void handleCaptureScannerPhoto()
              }}>
                Tomar foto del documento
              </button>
              <button type="button" className="ghost" onClick={() => {
                void handleReadSavedScannerPhoto()
              }}>
                Leer foto guardada
              </button>
              <button type="button" className="ghost" onClick={stopLiveScanner}>
                Cancelar escaneo
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {floatingNotice ? <div className="floating-toast">{floatingNotice}</div> : null}
      {showInstallToast ? (
        <div className="install-app-toast" role="status">
          <div className="install-app-toast-icon" aria-hidden="true">
            📲
          </div>
          <div className="install-app-toast-copy">
            <strong>Instalar DrHappy</strong>
            <span>Agregá un acceso directo a DrHappy en la pantalla de tu celular.</span>
          </div>
          <div className="install-app-toast-actions">
            <button type="button" onClick={() => void handleInstallApp()}>
              Instalar app
            </button>
            <button type="button" className="ghost" onClick={handleDismissInstallToast}>
              Ahora no
            </button>
          </div>
        </div>
      ) : null}
      {showNotificationToast ? (
        <div className="install-app-toast" role="status">
          <div className="install-app-toast-icon" aria-hidden="true">
            🔔
          </div>
          <div className="install-app-toast-copy">
            <strong>Activar notificaciones</strong>
            <span>Recibí alertas en tu celular cuando recibas mensajes privados o novedades.</span>
          </div>
          <div className="install-app-toast-actions">
            <button type="button" onClick={() => void handleEnableNotifications()}>
              Activar
            </button>
            <button type="button" className="ghost" onClick={handleDismissNotificationToast}>
              Ahora no
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
