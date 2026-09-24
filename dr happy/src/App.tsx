import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
} from 'react'
import { BrowserPDF417Reader, BrowserQRCodeReader } from '@zxing/browser'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth'
import './App.css'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import {
  getNotificationPermission,
  getPushSubscriptionsCount,
  registerPushSubscription,
  requestNotificationPermission,
  sendServerPushNotification,
  showAppNotification,
} from './notificationService'
import type { NotificationPermissionState } from './notificationService'
import {
  sendWelcomeEmail,
  sendPasswordRecoveryEmail,
  sendPasswordChangedEmail,
  sendAdminBroadcastEmail,
  sendAppointmentEmail,
  sendEmail,
} from './emailService'
import {
  createPublicBookingLink,
  listPublicBookingLinks,
  cancelPublicBookingLink,
  getPublicBookingSettings,
  savePublicBookingSettings,
  buildPublicBookingUrl,
  buildFixedPublicBookingUrl,
  buildWhatsAppShareUrl,
} from './publicBookingService'
import type { PublicBookingAvailabilityBlock, PublicBookingLinkSummary, PublicBookingSettings } from './publicBookingService'
import { fetchAdminAIUsage, fetchAdminUserStats } from './adminStatsService'
import type { AdminAIUsageStats, AdminUserStats } from './adminStatsService'
import { askSofia } from './aiAssistantService'
import { loadWorkspaceData, saveWorkspaceData } from './workspaceService'
import { disconnectMercadoPago, getMercadoPagoConnectionStatus, startMercadoPagoConnection, verifyMercadoPagoConnection } from './mercadoPagoConnectService'
import { communityRequest } from './communityService'
import { parseClinicalSummary } from './clinicalSummaryParser'
import { loadProfessionals, loadOwnProfessional, updateOwnProfessionalProfile } from './professionalsService'
import type { AssistantMessage, AssistantPendingConfirmation } from './aiAssistantService'
import { SofiaAvatar } from './SofiaAvatar'
import { selfDeleteAccount } from './selfDeleteService'
import {
  setProfessionalActive,
  setProfessionalSubscription,
  setProfessionalModules,
  deleteProfessionalAsAdmin,
  archiveAndDeleteProfessional,
} from './adminProfessionalsService'
import { buildSignatureSeal } from './signatureSeal'
import {
  registerProfessional,
  loginProfessional,
  loginWithGoogle,
  changeProfessionalPassword,
  setProfessionalPassword,
} from './authService'
import type { AuthProfessionalPublic } from './authService'
import { CLINICAL_PROTOCOLS } from './clinicalProtocols'
import { CONSULT_PATHOLOGIES } from './consultPathologies'
import AuthBackground from './AuthBackground'
import SplashScreen from './SplashScreen'
import diagnosisCsv from '../cie-10.csv?raw'

type WorkspaceLayer =
  | 'overview'
  | 'medical-news'
  | 'my-patients'
  | 'patient-search'
  | 'patient-record'
  | 'clinical'
  | 'profile'
  | 'user-admin'
  | 'tools'
  | 'medication-detail'
  | 'protocol-detail'
  | 'consult-pathology-detail'
  | 'ambulance'
  | 'ambulance-history'
  | 'appointments'
type SubscriptionPlan = 'monthly' | 'semiannual' | 'annual'

type AppModuleId = 'attention' | 'appointments' | 'tools' | 'ambulance' | 'community' | 'ledger'

const APP_MODULES: Array<{ id: AppModuleId; label: string; description: string }> = [
  { id: 'attention', label: 'Atención médica', description: 'Pacientes, historia clínica y consultas' },
  { id: 'appointments', label: 'Turnera', description: 'Agenda de turnos y turnera libre' },
  { id: 'tools', label: 'Herramientas', description: 'Protocolos, vademécum y patologías' },
  { id: 'ambulance', label: 'Modo Ambulancia', description: 'Atención prehospitalaria y traslados' },
  { id: 'ledger', label: 'Balance de pagos', description: 'Planilla de cobros y saldos (odontología). Automático para odontólogos.' },
]

const WEEK_DAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]
const DEFAULT_APPOINTMENT_DAYS = [1, 2, 4]
const DEFAULT_DAILY_PATIENT_LIMIT = 10
const DEFAULT_APPOINTMENT_START_TIME = '09:00'
const DEFAULT_APPOINTMENT_END_TIME = '19:00'

function calculateDailyCapacity(startTime: string, endTime: string, durationMinutes: number): number {
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  const availableMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute)
  return availableMinutes > 0 && durationMinutes > 0 ? Math.floor(availableMinutes / durationMinutes) : 0
}

const APPOINTMENT_HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))
const APPOINTMENT_PERIOD_OPTIONS = ['AM', 'PM'] as const

function splitAppointmentTime(value: string): { hour: string; period: 'AM' | 'PM' } {
  const [rawHour] = value.split(':')
  const hour24 = Number(rawHour)
  return { hour: String(hour24 % 12 || 12), period: hour24 >= 12 ? 'PM' : 'AM' }
}

function joinAppointmentTime(hour: string, period: 'AM' | 'PM'): string {
  const hour12 = Math.max(1, Math.min(12, Number(hour) || 12))
  const hour24 = period === 'PM' ? (hour12 === 12 ? 12 : hour12 + 12) : hour12 === 12 ? 0 : hour12
  return `${String(hour24).padStart(2, '0')}:00`
}

/**
 * Módulos que no se habilitan por defecto: requieren activación explícita del
 * admin (o, en el caso del balance, una especialidad odontológica).
 */
const OPT_IN_APP_MODULE_IDS: AppModuleId[] = ['ledger']

const ALL_APP_MODULE_IDS: AppModuleId[] = APP_MODULES.map((module) => module.id)

/**
 * Normaliza la lista de módulos guardada. Devuelve `null` cuando el usuario no
 * tiene restricción configurada, que equivale a "todos los módulos habilitados".
 */
function normalizeEnabledModules(value: unknown): AppModuleId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const allowed = value.filter((item): item is AppModuleId =>
    typeof item === 'string' && (ALL_APP_MODULE_IDS as string[]).includes(item),
  )
  return Array.from(new Set(allowed))
}

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
  password?: string
  fullName: string
  specialty: string
  licenseNumber: string
  dni?: string
  email: string
  networkMemberships?: string[]
  isAdmin?: boolean
  active?: boolean
  // undefined = todos los módulos habilitados (usuarios previos a esta función).
  enabledModules?: AppModuleId[]
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
  // Link de cobro propio del profesional (Mercado Pago, alias, o cualquier medio).
  // Dr Happy solo lo muestra al paciente: el pago es directo al profesional.
  paymentLink?: string
  appointmentDays?: number[]
  dailyPatientLimit?: number
  appointmentDurationMinutes?: number
  appointmentAmountToCharge?: number
  appointmentAmountConcept?: 'sena' | 'consulta'
  appointmentStartTime?: string
  appointmentEndTime?: string
}

interface ConsultationEntry {
  id: string
  date: string
  motivoConsulta: string
  diagnostico?: string
  detalleAtencion: string
  pensamientoMedico: string
  enfermedadActual?: string
  examenFisico?: string
  impresionDiagnostica?: string
  planManejo?: string
  professionalSignature: {
    fullName: string
    licenseNumber: string
    signatureText: string
    signatureImageDataUrl?: string
  }
  signatureSeal?: import('./signatureSeal').SignatureSeal
  // Turno que originó esta evolución, para no duplicarla si se vuelve a atender.
  appointmentId?: string
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
  enfermedadActual: string
  examenFisico: string
  impresionDiagnostica: string
  planManejo: string
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
  dni: string
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
  patientDni?: string
  scheduledDate: string
  scheduledTime: string
  durationMinutes?: number
  scheduledAt?: string
  reason: string
  notes?: string
  location?: string
  status?: 'confirmed' | 'pending' | 'attended' | 'cancelled'
  createdAt: string
  createdByUserId: string
  emailDraftSentAt?: string
  emailConfirmationSentAt?: string
  // Monto a cobrar informado al paciente (opcional). Dr Happy no procesa el pago.
  amountToCharge?: number
  amountConcept?: 'sena' | 'consulta'
  publicBookingModality?: 'coverage' | 'private'
}

interface AppointmentDraft {
  id?: string
  patientId: string
  patientName: string
  patientEmail: string
  patientDni: string
  scheduledDate: string
  scheduledTime: string
  durationMinutes: number
  reason: string
  notes: string
  location: string
  sendEmailConfirmation: boolean
  amountToCharge: string
  amountConcept: 'sena' | 'consulta'
}

interface SeedPatientsPayload {
  patients: Array<Partial<PatientRecord>>
}

/**
 * Registro del balance de pagos: una intervención realizada a un paciente, con
 * el total acordado y lo que ya abonó. El saldo se deriva de ambos.
 */
interface TreatmentLedgerEntry {
  id: string
  patientId: string
  patientName: string
  date: string
  intervention: string
  totalAmount: number
  paidAmount: number
  notes?: string
  createdAt: string
  updatedAt: string
}

interface TreatmentLedgerDraft {
  id?: string
  patientId: string
  patientName: string
  date: string
  intervention: string
  totalAmount: string
  paidAmount: string
  notes: string
}

interface RemoteProfessionalRow {
  id: string
  username: string
  full_name: string
  specialty: string
  license_number: string
  dni?: string | null
  email: string
  network_memberships_json?: unknown
  is_admin?: boolean | null
  active?: boolean | null
  enabled_modules_json?: unknown
  trial_started_at?: string | null
  subscription_status?: string | null
  subscription_expires_at?: string | null
}

interface RemoteWorkspaceRow {
  user_id: string
  profile_json: unknown
  patients_json: unknown
  appointments_json: unknown
  treatment_ledger_json?: unknown
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

const SESSION_USER_KEY = 'drhappy-active-user'
const SESSION_USER_CACHE_KEY = 'drhappy-active-user-cache'
const SESSION_TOKEN_KEY = 'drhappy-professional-session'
const CREATED_USERS_KEY = 'drhappy-created-users'
const THEME_MODE_KEY = 'drhappy-theme-mode'
const PATIENT_REGISTRY_KEY = 'drhappy-patient-registry'
const PASSWORD_OVERRIDES_KEY = 'drhappy-password-overrides'
const PASSWORD_RECOVERY_KEY = 'drhappy-password-recovery'
const USER_ACTIVE_OVERRIDES_KEY = 'drhappy-user-active-overrides'
const CUSTOM_DIAGNOSIS_STORAGE_KEY = 'drhappy-custom-diagnosis-catalog'
const INSTALL_PROMPT_DISMISSED_KEY = 'drhappy-install-prompt-dismissed'
const NOTIFICATION_PROMPT_DISMISSED_KEY = 'drhappy-notification-prompt-dismissed'
// Cuántos días esperamos antes de volver a ofrecer la instalación tras un "Ahora no".
const INSTALL_PROMPT_SNOOZE_DAYS = 7
const NOTIFICATION_PROMPT_SNOOZE_DAYS = 7

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
  enfermedadActual: '',
  examenFisico: '',
  impresionDiagnostica: '',
  planManejo: '',
}

const emptyRegisterDraft: RegisterDraft = {
  firstName: '',
  lastName: '',
  dni: '',
  specialty: '',
  licenseNumber: '',
  email: '',
  username: '',
  password: '',
  networkMemberships: [],
}

/**
 * Fecha de hoy en horario local (YYYY-MM-DD).
 * toISOString() devuelve UTC: en Argentina (UTC-3) después de las 21 hs
 * adelantaba la fecha un día.
 */
function todayLocalISO(): string {
  const now = new Date()
  const offsetMs = now.getTimezoneOffset() * 60 * 1000
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10)
}

function buildEmptyAppointmentDraft(): AppointmentDraft {
  return {
    patientId: '',
    patientName: '',
    patientEmail: '',
    patientDni: '',
    scheduledDate: todayLocalISO(),
    scheduledTime: '09:00',
    durationMinutes: 30,
    reason: 'Control médico general',
    notes: '',
    location: 'Consultorio médico',
    sendEmailConfirmation: true,
    amountToCharge: '',
    amountConcept: 'consulta',
  }
}

const emptyAppointmentDraft: AppointmentDraft = {
  patientId: '',
  patientName: '',
  patientEmail: '',
  patientDni: '',
  scheduledDate: new Date().toISOString().slice(0, 10),
  scheduledTime: '09:00',
  durationMinutes: 30,
  reason: 'Control médico general',
  notes: '',
  location: 'Consultorio médico',
  sendEmailConfirmation: true,
  amountToCharge: '',
  amountConcept: 'consulta',
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

function treatmentLedgerStorageKey(userId: string): string {
  return `drhappy-treatment-ledger-${userId}`
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

function isAppointmentConsultation(entry: ConsultationEntry): boolean {
  return entry.motivoConsulta.trim().startsWith('[TURNO]')
}

function normalizeTreatmentLedgerEntry(raw: unknown): TreatmentLedgerEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const candidate = raw as Partial<TreatmentLedgerEntry>
  if (typeof candidate.id !== 'string' || typeof candidate.intervention !== 'string') {
    return null
  }
  const total = Number(candidate.totalAmount)
  const paid = Number(candidate.paidAmount)
  return {
    id: candidate.id,
    patientId: typeof candidate.patientId === 'string' ? candidate.patientId : '',
    patientName: typeof candidate.patientName === 'string' ? candidate.patientName : '',
    date: typeof candidate.date === 'string' ? candidate.date : '',
    intervention: candidate.intervention,
    totalAmount: Number.isFinite(total) ? total : 0,
    paidAmount: Number.isFinite(paid) ? paid : 0,
    notes: typeof candidate.notes === 'string' ? candidate.notes : undefined,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  }
}

function formatMoney(value: number): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
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
    fullName: row.full_name,
    specialty: row.specialty,
    licenseNumber: row.license_number,
    dni: row.dni ?? undefined,
    email: row.email,
    networkMemberships: normalizeProfessionalNetworks(row.network_memberships_json),
    isAdmin: isAdminUser({
      id: row.id,
      username: row.username,
      isAdmin: Boolean(row.is_admin),
    }),
    active: row.active ?? true,
    enabledModules: normalizeEnabledModules(row.enabled_modules_json),
    trialStartedAt: row.trial_started_at ?? undefined,
    subscriptionStatus: (row.subscription_status as SeedUser['subscriptionStatus']) ?? undefined,
    subscriptionExpiresAt: row.subscription_expires_at ?? undefined,
  }
}

function mapAuthProfessionalPublic(row: AuthProfessionalPublic): SeedUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    specialty: row.specialty,
    licenseNumber: row.license_number,
    dni: row.dni ?? undefined,
    email: row.email,
    networkMemberships: normalizeProfessionalNetworks(row.network_memberships_json),
    isAdmin: isAdminUser({
      id: row.id,
      username: row.username,
      isAdmin: Boolean(row.is_admin),
    }),
    active: row.active ?? true,
    enabledModules: normalizeEnabledModules(row.enabled_modules_json),
    trialStartedAt: row.trial_started_at ?? undefined,
    subscriptionStatus: (row.subscription_status as SeedUser['subscriptionStatus']) ?? undefined,
    subscriptionExpiresAt: row.subscription_expires_at ?? undefined,
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
    paymentLink: typeof candidate.paymentLink === 'string' ? candidate.paymentLink : undefined,
    appointmentDays: Array.isArray(candidate.appointmentDays)
      ? candidate.appointmentDays.filter((day): day is number => typeof day === 'number' && day >= 0 && day <= 6)
      : DEFAULT_APPOINTMENT_DAYS,
    dailyPatientLimit:
      typeof candidate.dailyPatientLimit === 'number' && candidate.dailyPatientLimit > 0
        ? candidate.dailyPatientLimit
        : DEFAULT_DAILY_PATIENT_LIMIT,
    appointmentDurationMinutes:
      typeof candidate.appointmentDurationMinutes === 'number' && candidate.appointmentDurationMinutes > 0
        ? candidate.appointmentDurationMinutes
        : 30,
    appointmentStartTime: typeof candidate.appointmentStartTime === 'string' && /^\d{2}:\d{2}$/.test(candidate.appointmentStartTime)
      ? candidate.appointmentStartTime
      : DEFAULT_APPOINTMENT_START_TIME,
    appointmentEndTime: typeof candidate.appointmentEndTime === 'string' && /^\d{2}:\d{2}$/.test(candidate.appointmentEndTime)
      ? candidate.appointmentEndTime
      : DEFAULT_APPOINTMENT_END_TIME,
    appointmentAmountToCharge:
      typeof candidate.appointmentAmountToCharge === 'number' && candidate.appointmentAmountToCharge > 0
        ? candidate.appointmentAmountToCharge
        : undefined,
    appointmentAmountConcept: candidate.appointmentAmountConcept === 'consulta' ? 'consulta' : 'sena',
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

function buildArchiveFileName(
  record: { deletedUsername: string; deletedFullName: string; deletedAt: string; deletedDni?: string },
): string {
  const preferredSegment = slugifyFileSegment(record.deletedFullName || record.deletedUsername || 'usuario')
  const dniSegment = slugifyFileSegment(record.deletedDni || 'sin-dni')
  const dateSegment = record.deletedAt.slice(0, 10)
  return `archivo-legal-${preferredSegment || 'usuario'}-${dniSegment}-${dateSegment}.json`
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim())
}

/** Un alias/CBU no es navegable: solo hay botón de pago si es una URL real. */
function isNavigablePaymentLink(value: string): boolean {
  const raw = value.trim()
  return /^https?:\/\//i.test(raw) || /^[\w-]+(\.[\w-]+)+\//.test(raw)
}

function buildDefaultPublicBookingSlug(fullName: string, userId: string): string {
  const base = fullName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || `profesional-${userId.slice(0, 8)}`
}

const MAX_COMMUNITY_FILE_SIZE_BYTES = 10 * 1024 * 1024

function formatMinutesLabel(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0 min'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

function parseTimeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
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
    appointmentDays: DEFAULT_APPOINTMENT_DAYS,
    dailyPatientLimit: DEFAULT_DAILY_PATIENT_LIMIT,
    appointmentDurationMinutes: 30,
    appointmentStartTime: DEFAULT_APPOINTMENT_START_TIME,
    appointmentEndTime: DEFAULT_APPOINTMENT_END_TIME,
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
  const inferredModality = appointment.publicBookingModality ?? (
    appointment.notes?.toLowerCase().includes('particular') ? 'private' :
      appointment.notes?.toLowerCase().includes('cobertura') ? 'coverage' : undefined
  )
  if (appointment.scheduledDate && appointment.scheduledTime) {
    return {
      ...appointment,
      publicBookingModality: inferredModality,
      durationMinutes: appointment.durationMinutes ?? 30,
      scheduledAt: appointment.scheduledAt ?? `${appointment.scheduledDate}T${appointment.scheduledTime}:00`,
    }
  }

  const scheduledDateTime = appointment.scheduledAt ? new Date(appointment.scheduledAt) : null
  if (!scheduledDateTime || Number.isNaN(scheduledDateTime.getTime())) {
    return {
      ...appointment,
      scheduledDate: '',
      scheduledTime: '',
      durationMinutes: 30,
      scheduledAt: appointment.scheduledAt,
    }
  }

  return {
    ...appointment,
    publicBookingModality: inferredModality,
    durationMinutes: appointment.durationMinutes ?? 30,
    scheduledDate: localDateKey(scheduledDateTime),
    scheduledTime: `${String(scheduledDateTime.getHours()).padStart(2, '0')}:${String(scheduledDateTime.getMinutes()).padStart(2, '0')}`,
    scheduledAt: appointment.scheduledAt,
  }
}

function linkAppointmentsToPatients(appointmentList: AppointmentRecord[], patientList: PatientRecord[]): AppointmentRecord[] {
  return appointmentList.map((appointment) => {
    const linked = patientList.find((patient) => {
      if (appointment.patientId && patient.id === appointment.patientId) return true
      if (appointment.patientDni && patient.dni && appointment.patientDni === patient.dni) return true
      return normalizeSearchText(`${patient.apellido}, ${patient.nombre}`) === normalizeSearchText(appointment.patientName)
    })
    if (!linked) return appointment
    return {
      ...appointment,
      patientId: linked.id,
      patientName: `${linked.apellido}, ${linked.nombre}`.trim(),
      patientDni: linked.dni || appointment.patientDni,
      patientEmail: linked.email || appointment.patientEmail,
    }
  })
}

function ensurePatientsForAppointments(appointmentList: AppointmentRecord[], patientList: PatientRecord[], ownerUserId: string): PatientRecord[] {
  const nextPatients = [...patientList]
  for (const appointment of appointmentList) {
    if (nextPatients.some((patient) => patient.id === appointment.patientId)) continue
    const nameParts = appointment.patientName.split(',')
    nextPatients.push({
      id: appointment.patientId || crypto.randomUUID(), ownerUserId,
      nombre: nameParts.slice(1).join(',').trim(), apellido: nameParts[0]?.trim() || appointment.patientName,
      dni: appointment.patientDni || '', email: appointment.patientEmail || '', obraSocial: '', numeroAfiliado: '', plan: '',
      birthDate: '', edad: 0, diagnosticoPrincipal: appointment.reason || '', patologiasConocidas: '', patologiasCronicas: '',
      ultimaInternacion: '', cirugiasPrevias: '', direccion: '', documents: [], consultations: [],
      createdAt: appointment.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
  }
  return sortPatientsByName(nextPatients)
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

function mapDictationError(errorCode?: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permiso de micrófono denegado. Habilítalo en el navegador y vuelve a intentar.'
    case 'audio-capture':
      return 'No se detectó micrófono disponible.'
    case 'network':
      return 'El servicio de voz del navegador no está disponible. Podés escribir la entrevista manualmente y usar Sofía para resumirla, o probar Chrome con conexión activa.'
    case 'no-speech':
      return 'No se detectó voz. Verifica volumen del micrófono y vuelve a intentar.'
    case 'aborted':
      return 'El dictado fue cancelado.'
    default:
      return 'No se pudo continuar con el dictado por voz.'
  }
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
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashLeaving, setSplashLeaving] = useState(false)

  useEffect(() => {
    if (loadingUsers) {
      return
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const holdMs = reduceMotion ? 600 : 3000
    const fadeMs = reduceMotion ? 0 : 550
    const leaveTimer = window.setTimeout(() => setSplashLeaving(true), holdMs)
    const hideTimer = window.setTimeout(() => setSplashVisible(false), holdMs + fadeMs)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(hideTimer)
    }
  }, [loadingUsers])
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [showInstallToast, setShowInstallToast] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegisterPassword, setShowRegisterPassword] = useState(false)
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
  const sessionGenerationRef = useRef(0)
  const [googleIdentity, setGoogleIdentity] = useState<{
    email: string
    avatarUrl?: string
    fullName?: string
  } | null>(null)
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null)
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [availablePatients, setAvailablePatients] = useState<PatientRecord[]>([])
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [appointmentSearchQuery, setAppointmentSearchQuery] = useState('')
  const [appointmentFilterTab, setAppointmentFilterTab] = useState<'today' | 'upcoming' | 'all' | 'past'>('today')
  const [appointmentDateFilter, setAppointmentDateFilter] = useState('')
  const [appointmentDays, setAppointmentDays] = useState<number[]>(DEFAULT_APPOINTMENT_DAYS)
  const [dailyPatientLimit, setDailyPatientLimit] = useState(DEFAULT_DAILY_PATIENT_LIMIT)
  const [appointmentDurationMinutes, setAppointmentDurationMinutes] = useState(30)
  const [appointmentAmountToCharge, setAppointmentAmountToCharge] = useState('')
  const [appointmentAmountConcept, setAppointmentAmountConcept] = useState<'sena' | 'consulta'>('sena')
  const [appointmentStartTime, setAppointmentStartTime] = useState(DEFAULT_APPOINTMENT_START_TIME)
  const [appointmentEndTime, setAppointmentEndTime] = useState(DEFAULT_APPOINTMENT_END_TIME)
  // Prueba piloto: vista alternativa de la Turnera con calendario mensual de ocupación
  // y estadísticas de pacientes atendidos por semana/mes (candidata a feature premium anual).
  const [turneraViewMode, setTurneraViewMode] = useState<'list' | 'calendar' | 'stats' | 'ledger' | 'capacity'>('list')
  // Balance de pagos (odontología): tratamientos realizados, cobrado y saldo pendiente.
  const [treatmentLedger, setTreatmentLedger] = useState<TreatmentLedgerEntry[]>([])
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false)
  const [ledgerDraft, setLedgerDraft] = useState<TreatmentLedgerDraft | null>(null)
  const [ledgerPatientQuery, setLedgerPatientQuery] = useState('')
  const [ledgerSuggestionsOpen, setLedgerSuggestionsOpen] = useState(false)
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'debt' | 'settled'>('all')
  const [paymentTarget, setPaymentTarget] = useState<{ entryId: string; amount: string } | null>(null)
  const [ledgerReminderSendingId, setLedgerReminderSendingId] = useState<string | null>(null)
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [calendarMonthCursor, setCalendarMonthCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)
  const [appointmentDraft, setAppointmentDraft] = useState<AppointmentDraft>(emptyAppointmentDraft)
  // Sugerencias de pacientes ya cargados al escribir en el modal de turno, para
  // que el turno quede vinculado a la ficha existente en vez de duplicarla.
  const [appointmentPatientQuery, setAppointmentPatientQuery] = useState('')
  const [appointmentSuggestionsOpen, setAppointmentSuggestionsOpen] = useState(false)
  const [appointmentSaving, setAppointmentSaving] = useState(false)
  const [appointmentResendingId, setAppointmentResendingId] = useState<string | null>(null)
  // NUEVA función "Turnos libres" — no modifica nada de la Turnera existente.
  // Permite generar enlaces públicos para que pacientes no registrados
  // elijan un horario habilitado por el profesional y se auto-agenden.
  const [freeSlotModalOpen, setFreeSlotModalOpen] = useState(false)
  const [freeSlotDraft, setFreeSlotDraft] = useState({
    slotDate: '',
    startTime: '09:00',
    endTime: '17:00',
    slotCount: 5,
    durationMinutes: 30,
    location: '',
    reason: '',
    amountToCharge: '',
    amountConcept: 'consulta' as 'sena' | 'consulta',
  })
  const [freeSlotSaving, setFreeSlotSaving] = useState(false)
  const [freeSlotError, setFreeSlotError] = useState<string | null>(null)
  const [freeSlotLinks, setFreeSlotLinks] = useState<PublicBookingLinkSummary[]>([])
  const [freeSlotLinksLoading, setFreeSlotLinksLoading] = useState(false)
  const [freeSlotGeneratedUrl, setFreeSlotGeneratedUrl] = useState<string | null>(null)
  const [publicBookingSettings, setPublicBookingSettings] = useState<PublicBookingSettings | null>(null)
  const [publicBookingLoading, setPublicBookingLoading] = useState(false)
  const [publicBookingSaving, setPublicBookingSaving] = useState(false)
  const [publicBookingError, setPublicBookingError] = useState<string | null>(null)
  const [publicBookingNotice, setPublicBookingNotice] = useState<string | null>(null)
  const [mercadoPagoConnected, setMercadoPagoConnected] = useState(false)
  const [mercadoPagoAccountEmail, setMercadoPagoAccountEmail] = useState<string | null>(null)
  const [mercadoPagoConnectionBusy, setMercadoPagoConnectionBusy] = useState(false)
  const [mercadoPagoVerificationMessage, setMercadoPagoVerificationMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!freeSlotModalOpen) {
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [freeSlotModalOpen])

  useEffect(() => {
    if (!activeUserId) return
    void getMercadoPagoConnectionStatus().then((result) => {
      setMercadoPagoConnected(Boolean(result.success && result.connected))
      setMercadoPagoAccountEmail(result.account?.public_email ?? null)
    })
  }, [activeUserId])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connectionState = params.get('mp_connection')
    if (!connectionState) return
    if (connectionState === 'connected') {
      setAppNotice('Cuenta de Mercado Pago conectada correctamente.')
      void verifyMercadoPagoConnection().then((result) => {
        setMercadoPagoConnected(Boolean(result.success && result.connected))
        setMercadoPagoAccountEmail(result.account?.public_email ?? null)
        setMercadoPagoVerificationMessage(result.connected ? 'Conexión verificada con Mercado Pago.' : result.message || 'La conexión necesita revisión.')
      })
    } else if (connectionState === 'error') {
      setAppError(params.get('message') || 'No se pudo conectar Mercado Pago.')
    }
    window.history.replaceState({}, document.title, window.location.pathname)
  }, [])
  // Métricas de uso por usuario (solo conteos y fechas, sin datos clínicos).
  const [adminUserStats, setAdminUserStats] = useState<AdminUserStats[]>([])
  const [adminUserStatsLoading, setAdminUserStatsLoading] = useState(false)
  const [adminAIUsage, setAdminAIUsage] = useState<AdminAIUsageStats[]>([])
  const [adminAIUsageLoading, setAdminAIUsageLoading] = useState(false)
  const [adminAITotal, setAdminAITotal] = useState({ requests: 0, tokens: 0, costUsd: 0 })
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [patientSearchQuery, setPatientSearchQuery] = useState('')
  const [myPatientsQuery, setMyPatientsQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [diagnosisCatalog, setDiagnosisCatalog] = useState<string[]>([])
  const [medicationCatalog, setMedicationCatalog] = useState<MedicationEntry[]>([])
  const [medicalNewsLoading, setMedicalNewsLoading] = useState(false)
  const [medicalNews, setMedicalNews] = useState<MedicalNewsItem[]>([])
  const [currentMedicalNewsIndex, setCurrentMedicalNewsIndex] = useState(0)
  const [vademecumSearchQuery, setVademecumSearchQuery] = useState('')
  const [selectedMedicationId, setSelectedMedicationId] = useState<string | null>(null)

  const [toolsActiveTab, setToolsActiveTab] = useState<'protocols' | 'vademecum' | 'consult' | 'community'>('protocols')
  const [adminSection, setAdminSection] = useState<'usuarios' | 'actividad' | 'sofia' | 'comunicados' | 'correo'>('usuarios')
  const [adminUserQuery, setAdminUserQuery] = useState('')
  const [adminExpandedUserId, setAdminExpandedUserId] = useState<string | null>(null)
  const [premiumPrompt, setPremiumPrompt] = useState<{ icon: string; title: string; pitch: string; bullets: string[] } | null>(null)
  const [protocolSearchQuery, setProtocolSearchQuery] = useState('')
  const [protocolCategoryFilter, setProtocolCategoryFilter] = useState<string>('all')
  const [selectedProtocolId, setSelectedProtocolId] = useState<string | null>(null)
  const [selectedConsultPathologyId, setSelectedConsultPathologyId] = useState<string | null>(null)
  const [selectedProtocolTab, setSelectedProtocolTab] = useState<
    'prehospital' | 'diagnostic' | 'management' | 'window' | 'prognosis'
  >('prehospital')
  const [ambulanceProtocolModalOpen, setAmbulanceProtocolModalOpen] = useState(false)
  const [ambulanceSelectedProtocolId, setAmbulanceSelectedProtocolId] = useState<string>('iamcest')
  const [protocolCopiedNotice, setProtocolCopiedNotice] = useState<string | null>(null)

  const [patientDraft, setPatientDraft] = useState<PatientDraft>(emptyPatientDraft)
  const [patientFormUnlocked, setPatientFormUnlocked] = useState(true)
  const [consultationDraft, setConsultationDraft] =
    useState<ConsultationDraft>(emptyConsultationDraft)
  const [clinicalSummaryBusy, setClinicalSummaryBusy] = useState(false)
  const consultationDiagnosisVisibleList = useMemo(
    () => buildDiagnosisSuggestions(diagnosisCatalog, consultationDraft.motivoConsulta, 10),
    [consultationDraft.motivoConsulta, diagnosisCatalog],
  )
  const [communityOpen, setCommunityOpen] = useState(false)
  const [communityTargetId, setCommunityTargetId] = useState<string | null>(null)
  const [communitySearchQuery, setCommunitySearchQuery] = useState('')
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
  const [passwordChangeDraft, setPasswordChangeDraft] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  // Auto-eliminación de cuenta (requisito de Google Play) — con archivo legal.
  const [selfDeletePassword, setSelfDeletePassword] = useState('')
  const [selfDeleteConfirm, setSelfDeleteConfirm] = useState(false)
  const [selfDeleteBusy, setSelfDeleteBusy] = useState(false)
  const processedCheckoutReturnRef = useRef<string | null>(null)
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>(() => getNotificationPermission())
  const [showNotificationToast, setShowNotificationToast] = useState(false)
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [sofiaOpen, setSofiaOpen] = useState(false)
  const [sofiaDraft, setSofiaDraft] = useState('')
  const [sofiaBusy, setSofiaBusy] = useState(false)
  const [sofiaDictating, setSofiaDictating] = useState(false)
  const sofiaRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const [sofiaPendingConfirmation, setSofiaPendingConfirmation] = useState<AssistantPendingConfirmation | null>(null)
  const [sofiaMessages, setSofiaMessages] = useState<AssistantMessage[]>([
    { role: 'assistant', content: 'Hola. Soy Sofía, tu secretaria clínica. Puedo ayudarte a ordenar ideas, preparar una consulta o trabajar con la información que me compartas.' },
  ])

  function stopSofiaDictation(): void {
    sofiaRecognitionRef.current?.stop()
    sofiaRecognitionRef.current = null
    setSofiaDictating(false)
  }

  function toggleSofiaDictation(): void {
    if (sofiaDictating) {
      stopSofiaDictation()
      return
    }
    const SpeechRecognitionApi = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRecognitionApi) {
      setAppError('Tu navegador no tiene dictado por voz disponible para Sofía.')
      return
    }
    const recognition = new SpeechRecognitionApi()
    recognition.lang = 'es-AR'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcripts: string[] = []
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result?.isFinal) transcripts.push(result[0].transcript)
      }
      if (transcripts.length) setSofiaDraft((current) => [current.trim(), transcripts.join(' ').trim()].filter(Boolean).join(' '))
    }
    recognition.onerror = (event) => {
      stopSofiaDictation()
      setAppError(mapDictationError(event.error))
    }
    recognition.onend = () => {
      sofiaRecognitionRef.current = null
      setSofiaDictating(false)
    }
    sofiaRecognitionRef.current = recognition
    setSofiaDictating(true)
    recognition.start()
  }
  const [adminBroadcastTarget, setAdminBroadcastTarget] = useState<string>('all')
  const [adminPushCount, setAdminPushCount] = useState<number | null>(null)
  const [adminTestingPush, setAdminTestingPush] = useState(false)
  const [adminBroadcastSubject, setAdminBroadcastSubject] = useState('')
  const [adminBroadcastBody, setAdminBroadcastBody] = useState('')
  const [adminBroadcastSending, setAdminBroadcastSending] = useState(false)
  const [adminBroadcastSendEmail, setAdminBroadcastSendEmail] = useState(true)
  const [adminTestEmailAddress, setAdminTestEmailAddress] = useState('')
  const [adminTestingEmail, setAdminTestingEmail] = useState(false)

  async function handleAskSofia(): Promise<void> {
    const question = sofiaDraft.trim()
    if (!question || sofiaBusy) return
    const nextMessages: AssistantMessage[] = [...sofiaMessages, { role: 'user', content: question }]
    setSofiaMessages(nextMessages)
    setSofiaDraft('')
    setSofiaBusy(true)
    const result = await askSofia({
      messages: nextMessages,
      professionalName: profile?.fullName || activeUser?.fullName,
      context: 'El profesional está dentro de Dr Happy. Sofía puede consultar agenda y pacientes, preparar borradores y ejecutar agendamientos directamente. Si el profesional pide un turno, no pidas confirmación ni campos opcionales: usa nombre, apellido y fecha, asigna la primera hora libre si no la indica y detente solo por cupo, día no habilitado o superposición.',
    })
    setSofiaMessages((current) => [...current, {
      role: 'assistant',
      content: result.success ? result.reply || 'No recibí una respuesta.' : (result.message || 'No pude responder en este momento.'),
    }])
    setSofiaPendingConfirmation(result.success ? result.pendingConfirmation || null : null)
    if (result.success && activeUser) {
      void loadWorkspaceForUser(activeUser)
    }
    setSofiaBusy(false)
  }

  async function handleConfirmSofiaAction(): Promise<void> {
    if (!sofiaPendingConfirmation || sofiaBusy) return
    setSofiaBusy(true)
    const confirmation = sofiaPendingConfirmation
    const result = await askSofia({
      messages: sofiaMessages,
      professionalName: profile?.fullName || activeUser?.fullName,
      context: 'Ejecutá la acción pendiente exactamente con los parámetros confirmados.',
      confirmation: { action: confirmation.action, input: { ...confirmation.proposal } },
    })
    setSofiaMessages((current) => [...current, { role: 'user', content: 'Confirmo la acción propuesta.' }, {
      role: 'assistant',
      content: result.success ? result.reply || 'Acción completada.' : (result.message || 'No se pudo completar la acción.'),
    }])
    setSofiaPendingConfirmation(null)
    setSofiaBusy(false)
  }

  // --- Trial / Suscripción ---
  const trialInfo = useMemo(() => {
    const TRIAL_DAYS = 7
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
    const ownPatientCount = patients.filter((p) => p.ownerUserId === activeUserId).length

    const expiredByTime = daysPassed >= TRIAL_DAYS
    const expired = expiredByTime

    return {
      status: expired ? ('expired' as const) : ('trial' as const),
      daysLeft,
      patientsLeft: Infinity,
      ownPatientCount,
      expiredByTime,
      expiredByPatients: false,
      expiredBySubscription: false,
      expired,
    }
  }, [seedUsers, activeUserId, patients])

  const activeUser = useMemo(
    () => seedUsers.find((user) => user.id === activeUserId) ?? null,
    [seedUsers, activeUserId],
  )
  const isAdminSession = isAdminUser(activeUser)
  // Acceso a la Turnera Premium (calendario de ocupación + estadísticas): solo suscripción activa,
  // no incluye usuarios en período de prueba (trial) ni vencidos.
  const hasPremiumTurneraAccess = Boolean(isAdminSession || activeUser?.subscriptionStatus === 'active')

  // Módulos visibles para el usuario activo. El admin siempre los ve todos, y
  // un usuario sin configuración (undefined) también, para no romper cuentas previas.
  const isModuleEnabled = useCallback(
    (moduleId: AppModuleId): boolean => {
      if (moduleId === 'community') {
        return false
      }
      if (isAdminSession) {
        return true
      }
      const profession = normalizeSearchText(activeUser?.specialty || profile?.specialty || '')
      const professionModules = profession.includes('odont')
        ? ['attention', 'appointments', 'ledger']
        : profession.includes('psic')
          ? ['attention', 'appointments', 'tools']
          : profession.includes('medic')
            ? ALL_APP_MODULE_IDS.filter((entry) => entry !== 'community')
            : null
      const configured = activeUser?.enabledModules
      if (professionModules && !professionModules.includes(moduleId)) return false
      if (configured) return configured.includes(moduleId)
      return !OPT_IN_APP_MODULE_IDS.includes(moduleId)
    },
    [isAdminSession, activeUser, profile, trialInfo],
  )

  const freeSlotCapacity = useMemo(() => {
    const parseMinutes = (value: string): number | null => {
      const [h, m] = value.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null
      return h * 60 + m
    }
    const startMinutes = parseMinutes(freeSlotDraft.startTime)
    const endMinutes = parseMinutes(freeSlotDraft.endTime)
    const duration = Number(freeSlotDraft.durationMinutes)
    const requested = Number(freeSlotDraft.slotCount)
    if (startMinutes === null || endMinutes === null || !duration) return null
    const rangeMinutes = endMinutes - startMinutes
    if (rangeMinutes <= 0) return { rangeMinutes, maxSlots: 0, requested, fits: false, invalidRange: true, requiredMinutes: requested * duration }

    const maxSlots = Math.floor(rangeMinutes / duration)
    return {
      rangeMinutes,
      maxSlots,
      requested,
      fits: requested > 0 && requested <= maxSlots,
      invalidRange: false,
      requiredMinutes: requested * duration,
    }
  }, [freeSlotDraft.startTime, freeSlotDraft.endTime, freeSlotDraft.durationMinutes, freeSlotDraft.slotCount])

  // Sugerencias del modal de turno: busca por apellido, nombre o DNI entre los
  // pacientes ya cargados, para vincular el turno a la ficha existente.
  const appointmentPatientSuggestions = useMemo(() => {
    const query = normalizeSearchText(appointmentPatientQuery)
    if (query.length < 2) {
      return []
    }
    return patients
      .filter((patient) => {
        const haystack = normalizeSearchText(
          `${patient.apellido} ${patient.nombre} ${patient.dni} ${patient.email}`,
        )
        return haystack.includes(query)
      })
      .sort((left, right) =>
        `${left.apellido} ${left.nombre}`.localeCompare(`${right.apellido} ${right.nombre}`, 'es'),
      )
      .slice(0, 6)
  }, [patients, appointmentPatientQuery])

  // El Balance de pagos queda disponible para cualquier profesional con acceso premium.
  const canUseTreatmentLedger = hasPremiumTurneraAccess

  const ledgerTotals = useMemo(() => {
    return treatmentLedger.reduce(
      (acc, entry) => {
        const pending = Math.max(entry.totalAmount - entry.paidAmount, 0)
        acc.total += entry.totalAmount
        acc.collected += entry.paidAmount
        acc.pending += pending
        if (pending > 0) acc.debtors.add(entry.patientName)
        return acc
      },
      { total: 0, collected: 0, pending: 0, debtors: new Set<string>() },
    )
  }, [treatmentLedger])

  const ledgerPatientBalances = useMemo(() => {
    const balances = new Map<string, { patientName: string; pending: number }>()
    for (const entry of treatmentLedger) {
      const pending = Math.max(entry.totalAmount - entry.paidAmount, 0)
      const current = balances.get(entry.patientId) ?? { patientName: entry.patientName, pending: 0 }
      current.pending += pending
      balances.set(entry.patientId, current)
    }
    return Array.from(balances.values()).sort((left, right) => right.pending - left.pending)
  }, [treatmentLedger])

  const pathologyStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const patient of patients) {
      for (const consultation of patient.consultations) {
        const diagnosis = consultation.diagnostico?.trim() || consultation.motivoConsulta?.trim()
        if (diagnosis) counts.set(diagnosis, (counts.get(diagnosis) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
  }, [patients])

  const visibleLedgerEntries = useMemo(() => {
    const query = normalizeSearchText(ledgerSearch)
    return treatmentLedger
      .filter((entry) => {
        const pending = entry.totalAmount - entry.paidAmount
        if (ledgerFilter === 'debt' && pending <= 0) return false
        if (ledgerFilter === 'settled' && pending > 0) return false
        if (!query) return true
        return normalizeSearchText(`${entry.patientName} ${entry.intervention}`).includes(query)
      })
      .sort((left, right) => right.date.localeCompare(left.date))
  }, [treatmentLedger, ledgerFilter, ledgerSearch])

  const ledgerPatientSuggestions = useMemo(() => {
    const query = normalizeSearchText(ledgerPatientQuery)
    if (query.length < 2) return []
    return patients
      .filter((patient) =>
        normalizeSearchText(`${patient.apellido} ${patient.nombre} ${patient.dni}`).includes(query),
      )
      .slice(0, 6)
  }, [patients, ledgerPatientQuery])

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
  const registerUsernameExists = useMemo(() => {
    const normalizedUsername = registerDraft.username.trim().toLowerCase()
    return (
      normalizedUsername.length > 0 &&
      seedUsers.some((user) => user.username.trim().toLowerCase() === normalizedUsername)
    )
  }, [registerDraft.username, seedUsers])
  const registerEmailExists = useMemo(() => {
    const normalizedEmail = registerDraft.email.trim().toLowerCase()
    return (
      normalizedEmail.length > 0 &&
      seedUsers.some((user) => user.email.trim().toLowerCase() === normalizedEmail)
    )
  }, [registerDraft.email, seedUsers])
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

  const filteredProtocols = useMemo(() => {
    const q = normalizeSearchText(protocolSearchQuery)
    return CLINICAL_PROTOCOLS.filter((proto) => {
      if (protocolCategoryFilter !== 'all' && proto.category !== protocolCategoryFilter) {
        return false
      }
      if (!q) return true
      return (
        normalizeSearchText(proto.title).includes(q) ||
        normalizeSearchText(proto.shortTitle).includes(q) ||
        normalizeSearchText(proto.cie10).includes(q) ||
        normalizeSearchText(proto.summary).includes(q) ||
        proto.prehospitalManifestations.keySigns.some((k) => normalizeSearchText(k).includes(q))
      )
    })
  }, [protocolSearchQuery, protocolCategoryFilter])

  const protocolCategories = useMemo(() => {
    const list: Array<{ id: string; label: string; count: number }> = [
      { id: 'all', label: 'Todas las áreas', count: CLINICAL_PROTOCOLS.length },
    ]
    const catMap = new Map<string, number>()
    for (const proto of CLINICAL_PROTOCOLS) {
      catMap.set(proto.category, (catMap.get(proto.category) || 0) + 1)
    }
    if (catMap.has('Pediatría')) {
      list.push({ id: 'Pediatría', label: '👶 Pediatría', count: catMap.get('Pediatría')! })
      catMap.delete('Pediatría')
    }
    for (const [cat, count] of catMap.entries()) {
      list.push({ id: cat, label: cat, count })
    }
    return list
  }, [])

  const selectedProtocol = useMemo(
    () => CLINICAL_PROTOCOLS.find((p) => p.id === selectedProtocolId) ?? null,
    [selectedProtocolId],
  )

  const selectedConsultPathology = useMemo(
    () => CONSULT_PATHOLOGIES.find((entry) => entry.id === selectedConsultPathologyId) ?? null,
    [selectedConsultPathologyId],
  )

  const handleCopyProtocolAction = (template: string, toConsultation = false) => {
    navigator.clipboard?.writeText(template)
    if (toConsultation) {
      setConsultationDraft((prev) => ({
        ...prev,
        pensamientoMedico: prev.pensamientoMedico
          ? `${prev.pensamientoMedico}\n\n[Guía Clínica Aplicada]:\n${template}`
          : `[Guía Clínica Aplicada]:\n${template}`,
      }))
      setProtocolCopiedNotice('¡Conducta copiada al pensamiento médico de la consulta!')
    } else {
      setProtocolCopiedNotice('¡Conducta clínica copiada al portapapeles!')
    }
    setTimeout(() => {
      setProtocolCopiedNotice(null)
    }, 3000)
  }

  const appointmentsMetrics = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    let todayCount = 0
    let upcomingCount = 0
    let emailSentCount = 0
    let pastCount = 0

    for (const a of appointments) {
      if (a.scheduledDate === todayStr) {
        todayCount++
      } else if (a.scheduledDate > todayStr) {
        upcomingCount++
      } else {
        pastCount++
      }
      if (a.emailConfirmationSentAt) {
        emailSentCount++
      }
    }

    return {
      total: appointments.length,
      todayCount,
      upcomingCount,
      pastCount,
      emailSentCount,
    }
  }, [appointments])

  const appointmentCapacityByDate = useMemo(() => {
    const counts = new Map<string, number>()
    for (const appointment of appointments) {
      if (appointment.status !== 'cancelled') {
        counts.set(appointment.scheduledDate, (counts.get(appointment.scheduledDate) ?? 0) + 1)
      }
    }
    return counts
  }, [appointments])

  const appointmentDaysLabel = useMemo(
    () => WEEK_DAYS.filter((day) => appointmentDays.includes(day.value)).map((day) => day.label).join(', '),
    [appointmentDays],
  )

  const filteredAppointments = useMemo(() => {
    const q = normalizeSearchText(appointmentSearchQuery)
    const todayStr = new Date().toISOString().slice(0, 10)

    return appointments
      .filter((item) => {
        if (appointmentFilterTab === 'today' && item.scheduledDate !== todayStr) return false
        if (appointmentFilterTab === 'upcoming' && item.scheduledDate < todayStr) return false
        if (appointmentFilterTab === 'past' && item.scheduledDate >= todayStr) return false
        if (appointmentDateFilter && item.scheduledDate !== appointmentDateFilter) return false

        if (!q) return true
        return (
          normalizeSearchText(item.patientName).includes(q) ||
          normalizeSearchText(item.patientEmail).includes(q) ||
          (item.patientDni && normalizeSearchText(item.patientDni).includes(q)) ||
          normalizeSearchText(item.reason).includes(q) ||
          (item.location && normalizeSearchText(item.location).includes(q))
        )
      })
      .sort((a, b) => appointmentSortKey(a).localeCompare(appointmentSortKey(b)))
  }, [appointments, appointmentSearchQuery, appointmentFilterTab, appointmentDateFilter])

  // Prueba piloto: conteo de turnos por día para pintar el calendario mensual de ocupación.
  const appointmentCountByDate = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of appointments) {
      map.set(a.scheduledDate, (map.get(a.scheduledDate) ?? 0) + 1)
    }
    return map
  }, [appointments])

  const appointmentModalityCountByDate = useMemo(() => {
    const map = new Map<string, { coverage: number; private: number }>()
    for (const appointment of appointments) {
      const current = map.get(appointment.scheduledDate) ?? { coverage: 0, private: 0 }
      if (appointment.publicBookingModality === 'private') current.private += 1
      else if (appointment.publicBookingModality === 'coverage') current.coverage += 1
      map.set(appointment.scheduledDate, current)
    }
    return map
  }, [appointments])

  const calendarWeeks = useMemo(() => {
    const year = calendarMonthCursor.getFullYear()
    const month = calendarMonthCursor.getMonth()
    const firstOfMonth = new Date(year, month, 1)
    // Lunes = 0 ... Domingo = 6
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const todayStr = new Date().toISOString().slice(0, 10)

    const cells: Array<{ dateStr: string | null; day: number | null; count: number; coverage: number; private: number; isToday: boolean } > = []
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ dateStr: null, day: null, count: 0, coverage: 0, private: 0, isToday: false })
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const modalityCounts = appointmentModalityCountByDate.get(dateStr) ?? { coverage: 0, private: 0 }
      cells.push({
        dateStr,
        day,
        count: appointmentCountByDate.get(dateStr) ?? 0,
        coverage: modalityCounts.coverage,
        private: modalityCounts.private,
        isToday: dateStr === todayStr,
      })
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateStr: null, day: null, count: 0, coverage: 0, private: 0, isToday: false })
    }

    const weeks: typeof cells[] = []
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7))
    }
    return weeks
  }, [calendarMonthCursor, appointmentCountByDate, appointmentModalityCountByDate])

  const calendarMonthLabel = useMemo(() => {
    return calendarMonthCursor.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  }, [calendarMonthCursor])

  const calendarMonthTotal = useMemo(() => {
    const year = calendarMonthCursor.getFullYear()
    const month = calendarMonthCursor.getMonth()
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
    let total = 0
    for (const [dateStr, count] of appointmentCountByDate.entries()) {
      if (dateStr.startsWith(prefix)) total += count
    }
    return total
  }, [calendarMonthCursor, appointmentCountByDate])

  // Prueba piloto: estadística de pacientes atendidos por semana (últimas 8) y por mes (últimos 6),
  // usando estado "attended" cuando existe, o el total de turnos agendados por fecha si no está marcado.
  const attendanceWeeklyStats = useMemo(() => {
    const relevant = appointments.filter((a) => !a.status || a.status === 'attended' || a.status === 'confirmed')

    function isoWeekKey(dateStr: string): { key: string; label: string; sortKey: string } {
      const d = new Date(`${dateStr}T00:00:00`)
      const day = (d.getDay() + 6) % 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - day)
      const key = monday.toISOString().slice(0, 10)
      const label = `${String(monday.getDate()).padStart(2, '0')}/${String(monday.getMonth() + 1).padStart(2, '0')}`
      return { key, label, sortKey: key }
    }

    const buckets = new Map<string, { label: string; count: number; sortKey: string }>()
    for (const a of relevant) {
      const { key, label, sortKey } = isoWeekKey(a.scheduledDate)
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.count++
      } else {
        buckets.set(key, { label, count: 1, sortKey })
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .slice(-8)
  }, [appointments])

  const attendanceMonthlyStats = useMemo(() => {
    const relevant = appointments.filter((a) => !a.status || a.status === 'attended' || a.status === 'confirmed')
    const buckets = new Map<string, { label: string; count: number }>()
    const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

    for (const a of relevant) {
      const [yearStr, monthStr] = a.scheduledDate.split('-')
      const key = `${yearStr}-${monthStr}`
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.count++
      } else {
        const label = `${monthNames[Number(monthStr) - 1] ?? monthStr} ${yearStr.slice(2)}`
        buckets.set(key, { label, count: 1 })
      }
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, value]) => value)
  }, [appointments])

  const attendanceTrend = useMemo(() => {
    if (attendanceMonthlyStats.length < 2) return null
    const last = attendanceMonthlyStats[attendanceMonthlyStats.length - 1]
    const prev = attendanceMonthlyStats[attendanceMonthlyStats.length - 2]
    if (prev.count === 0) return null
    const diff = last.count - prev.count
    const pct = Math.round((diff / prev.count) * 100)
    return { diff, pct, improving: diff >= 0 }
  }, [attendanceMonthlyStats])

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
      if (normalizedOwner === userId) {
        patientsList.push(normalizedPatient)
        availablePatientsList.push(normalizedPatient)
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
    nextLedger?: TreatmentLedgerEntry[],
  ): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      return
    }
    try {
      const result = await saveWorkspaceData({
        profile: nextProfile,
        patients: nextPatients,
        appointments: nextAppointments,
        treatmentLedger: nextLedger ?? readJsonStorage<TreatmentLedgerEntry[]>(treatmentLedgerStorageKey(userId), []),
      })
      if (!result.success) {
        console.warn('No se pudo guardar la base personal en la nube:', result.message)
      }
    } catch (err) {
      console.warn('Fallo de conexión al sincronizar workspace en la nube:', err)
    }
  }

  async function loadWorkspaceForUser(user: SeedUser): Promise<void> {
    const sessionGeneration = ++sessionGenerationRef.current
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
    let loadedLedger = readJsonStorage<unknown[]>(treatmentLedgerStorageKey(user.id), [])
      .map(normalizeTreatmentLedgerEntry)
      .filter((entry): entry is TreatmentLedgerEntry => Boolean(entry))
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('drhappy-community-thread-') || key.startsWith('drhappy-community-seen-')) {
        localStorage.removeItem(key)
      }
    }
    const localSeenIds: string[] = []

    localStorage.setItem(SESSION_USER_KEY, user.id)
    localStorage.setItem(SESSION_USER_CACHE_KEY, JSON.stringify(user))
    setActiveUserId(user.id)
    setProfile(localProfile)
    setCommunitySeenIds(localSeenIds)
    setPatients(localLoaded.patientsList)
    setAvailablePatients(localLoaded.availablePatientsList)
    setAppointments(localAppointments)
    setTreatmentLedger(loadedLedger)

    if (isSupabaseConfigured && supabase) {
      // El alta de cuentas ocurre en la Edge Function auth-professional (Service Role).
      // Desde el cliente solo se refrescan los campos del propio perfil: id y username
      // no son actualizables, y los privilegiados los maneja admin-professionals.
      const professionalUpdate = await updateOwnProfessionalProfile({ fullName: user.fullName, specialty: user.specialty, licenseNumber: user.licenseNumber, dni: user.dni ?? null, email: user.email, networkMemberships: user.networkMemberships ?? [] })
      if (!professionalUpdate.success) {
        console.warn('No se pudo sincronizar el perfil remoto al iniciar:', professionalUpdate.message)
      }

      let workspaceResult = await loadWorkspaceData()
      for (let attempt = 1; !workspaceResult.success && attempt < 3; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt * 350))
        workspaceResult = await loadWorkspaceData()
      }
      if (!workspaceResult.success) {
        setProfile(null)
        setPatients([])
        setAvailablePatients([])
        setAppointments([])
        setTreatmentLedger([])
        setAppError('No se pudo validar la sesión en la nube. Por seguridad, no se muestran datos locales hasta volver a iniciar sesión.')
        return
      }
      if (sessionGeneration !== sessionGenerationRef.current) return
      const data = workspaceResult.workspace as RemoteWorkspaceRow | null

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
        const remoteLedger = Array.isArray(workspace.treatment_ledger_json)
          ? workspace.treatment_ledger_json
              .map(normalizeTreatmentLedgerEntry)
              .filter((entry): entry is TreatmentLedgerEntry => Boolean(entry))
          : []
        // Primera sincronización: si la nube todavía no tiene el balance pero el
        // dispositivo sí, conservamos lo local y lo subimos en vez de borrarlo.
        if (remoteLedger.length === 0 && loadedLedger.length > 0) {
          void persistWorkspaceRemote(user.id, loadedProfile, patientsList, loadedAppointments, loadedLedger)
        } else {
          loadedLedger = remoteLedger
        }
      } else {
        await persistWorkspaceRemote(
          user.id,
          localProfile,
          localLoaded.patientsList,
          localAppointments,
          loadedLedger,
        )
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
    if (sessionGeneration !== sessionGenerationRef.current) return
    loadedAppointments = linkAppointmentsToPatients(loadedAppointments, patientsList)
    const patientsBeforeAppointmentRepair = patientsList.length
    patientsList = ensurePatientsForAppointments(loadedAppointments, patientsList, user.id)
    if (patientsList.length > patientsBeforeAppointmentRepair) {
      availablePatientsList = sortPatientsByName(patientsList)
      void persistWorkspaceRemote(user.id, loadedProfile, patientsList, loadedAppointments, loadedLedger)
    }
    localStorage.setItem(appointmentsStorageKey(user.id), JSON.stringify(loadedAppointments))
    localStorage.setItem(
      patientIndexStorageKey(user.id),
      JSON.stringify(patientsList.map((patient) => patient.id)),
    )
    for (const patient of patientsList) {
      localStorage.setItem(patientGlobalStorageKey(patient.id), JSON.stringify(patient))
    }

    setProfile(loadedProfile)
    setCommunitySeenIds(loadedProfile.communitySeenMessageIds ?? localSeenIds)
    setPatients(patientsList)
    setAvailablePatients(availablePatientsList)
    setAppointments(loadedAppointments)
    setTreatmentLedger(loadedLedger)
    localStorage.setItem(treatmentLedgerStorageKey(user.id), JSON.stringify(loadedLedger))
  }

  async function fetchRemoteProfessionalById(userId: string): Promise<SeedUser | null> {
    void userId
    if (!isSupabaseConfigured || !supabase) {
      return null
    }

    const result = await loadOwnProfessional()
    if (!result.success) throw new Error(`No se pudo refrescar la suscripción del profesional: ${result.message}`)
    if (!result.professional) {
      return null
    }
    return mapRemoteProfessional(result.professional as RemoteProfessionalRow)
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
        const archiveDeleteResult = await archiveAndDeleteProfessional(targetUser.id)
        if (!archiveDeleteResult.success) {
          throw new Error(archiveDeleteResult.message ?? 'No se pudo archivar y eliminar el usuario.')
        }
        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        localStorage.setItem(CREATED_USERS_KEY, JSON.stringify(localUsers.filter((user) => user.id !== targetUser.id)))
        removeLocalUserArtifacts(targetUser.id, [])
        setSeedUsers((current) => current.filter((user) => user.id !== targetUser.id))
        setAppNotice(`Usuario eliminado definitivamente: ${targetUser.fullName}.`)
        showSavedFloatingNotice()
        return
      }
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
            dni: targetUser.dni ?? '',
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

        const archiveDeletedAt = new Date().toISOString()
        const archiveContent = JSON.stringify(archiveData, null, 2)
        const archiveFileName = buildArchiveFileName({
          deletedUsername: targetUser.username,
          deletedFullName: targetUser.fullName,
          deletedDni: targetUser.dni ?? '',
          deletedAt: archiveDeletedAt,
        })
        const archiveEmailResult = await sendEmail({
          to: [targetUser.email],
          subject: `Archivo legal - ${targetUser.fullName} - DNI ${targetUser.dni ?? 'no informado'}`,
          text: `Se adjunta el archivo legal correspondiente a la eliminación del usuario ${targetUser.fullName} (DNI ${targetUser.dni ?? 'no informado'}).`,
          type: 'legal_archive',
          attachments: [
            {
              filename: archiveFileName,
              content: archiveContent,
              contentType: 'application/json',
            },
          ],
        })
        if (!archiveEmailResult.success) {
          throw new Error(`No se pudo enviar el archivo legal por correo: ${archiveEmailResult.message ?? 'error desconocido'}`)
        }

        if (!activeUserId) {
          throw new Error('Sesión no válida para esta acción.')
        }
        const deleteResult = await deleteProfessionalAsAdmin(activeUserId, targetUser.id)
        if (!deleteResult.success) {
          throw new Error(`No se pudo eliminar el usuario: ${deleteResult.message ?? 'error desconocido'}`)
        }

        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        localStorage.setItem(
          CREATED_USERS_KEY,
          JSON.stringify(localUsers.filter((user) => user.id !== targetUser.id)),
        )
        removeLocalUserArtifacts(targetUser.id, archivedPatients)
      } else {
        const localPatientIds = readJsonStorage<string[]>(patientIndexStorageKey(targetUser.id), [])
        const localPatients = localPatientIds
          .map((patientId) =>
            normalizeRemotePatient(readJsonStorage<unknown>(patientGlobalStorageKey(patientId), null), targetUser.id),
          )
          .filter((item): item is PatientRecord => Boolean(item))
        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        localStorage.setItem(
          CREATED_USERS_KEY,
          JSON.stringify(localUsers.filter((user) => user.id !== targetUser.id)),
        )
        removeLocalUserArtifacts(targetUser.id, localPatients)
      }

      setSeedUsers((current) => current.filter((user) => user.id !== targetUser.id))
      setAppNotice(`Usuario eliminado definitivamente: ${targetUser.fullName}.`)
      showSavedFloatingNotice()
    } finally {
      setAdminBusyUserId(null)
    }
  }

  async function handleAdminToggleModule(userId: string, moduleId: AppModuleId): Promise<void> {
    const targetUser = seedUsers.find((user) => user.id === userId)
    if (!targetUser) {
      setAppError('No se encontró el usuario a actualizar.')
      return
    }
    if (!isAdminSession) {
      setAppError('Solo el administrador puede modificar los módulos habilitados.')
      return
    }

    const defaultModules = ALL_APP_MODULE_IDS.filter(
      (entry) => !OPT_IN_APP_MODULE_IDS.includes(entry),
    )
    const current = targetUser.enabledModules ?? defaultModules
    const nextModules = current.includes(moduleId)
      ? current.filter((entry) => entry !== moduleId)
      : ALL_APP_MODULE_IDS.filter((entry) => entry === moduleId || current.includes(entry))

    setAdminBusyUserId(userId)
    setAppError(null)
    setAppNotice(null)

    try {
      if (isSupabaseConfigured && supabase) {
        if (!activeUserId) {
          throw new Error('Sesión no válida para esta acción.')
        }
        const result = await setProfessionalModules(activeUserId, userId, nextModules)
        if (!result.success) {
          throw new Error(result.message ?? 'No se pudieron actualizar los módulos.')
        }
      } else {
        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        localStorage.setItem(
          CREATED_USERS_KEY,
          JSON.stringify(
            localUsers.map((user) => (user.id === userId ? { ...user, enabledModules: nextModules } : user)),
          ),
        )
      }

      setSeedUsers((currentUsers) =>
        currentUsers.map((user) => (user.id === userId ? { ...user, enabledModules: nextModules } : user)),
      )

      setAppNotice(
        nextModules.length === ALL_APP_MODULE_IDS.length
          ? `${targetUser.fullName} tiene acceso a todos los módulos.`
          : `Módulos actualizados para ${targetUser.fullName}: ${nextModules.length} habilitado(s).`,
      )
      showSavedFloatingNotice()
    } catch (error) {
      setAppError(
        error instanceof Error
          ? `No se pudieron actualizar los módulos: ${error.message}`
          : 'No se pudieron actualizar los módulos.',
      )
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
        if (!activeUserId) {
          throw new Error('Sesión no válida para esta acción.')
        }
        const result = await setProfessionalSubscription(
          activeUserId,
          userId,
          nextStatus,
          nextExpiration,
        )
        if (!result.success) {
          throw new Error(result.message ?? 'No se pudo actualizar la suscripción.')
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

  async function handleSendAdminBroadcast(): Promise<void> {
    if (!adminBroadcastBody.trim() || !activeUserId) {
      return
    }
    const isBroadcast = adminBroadcastTarget === 'all'
    const recipients = isBroadcast
      ? seedUsers.filter((u) => u.id !== activeUserId)
      : seedUsers.filter((u) => u.id === adminBroadcastTarget)

    if (recipients.length === 0) {
      setAppError('No se encontraron profesionales destinatarios.')
      return
    }

    setAdminBroadcastSending(true)
    const broadcastTitle = adminBroadcastSubject.trim() || '📢 Novedades de Dr Happy'
    const formattedText = `📢 ${adminBroadcastSubject.trim() ? `[${adminBroadcastSubject.trim()}] ` : ''}${adminBroadcastBody.trim()}`
    const sentAt = new Date().toISOString()

    try {
      if (isSupabaseConfigured && supabase) {
        for (const recipient of recipients) {
          const result = await communityRequest({ action: 'send', recipientId: recipient.id, text: formattedText })
          if (!result.success) {
            throw new Error(result.message || 'No se pudo enviar el mensaje.')
          }
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

      // Enviar Web Push en segundo plano para celulares y navegadores registrados
      const pushRes = await sendServerPushNotification(
        isBroadcast
          ? {
              broadcast: true,
              title: broadcastTitle,
              body: adminBroadcastBody.trim(),
              tag: `drhappy-broadcast-${Date.now()}`,
            }
          : {
              recipientUserId: adminBroadcastTarget,
              title: broadcastTitle,
              body: adminBroadcastBody.trim(),
              tag: `drhappy-admin-${Date.now()}`,
            },
      )

      // Enviar también por Email oficial desde soporte@drhappy.com.ar si está habilitado
      if (adminBroadcastSendEmail) {
        const targetEmails = recipients.map((u) => u.email).filter(Boolean)
        if (targetEmails.length > 0) {
          void sendAdminBroadcastEmail({
            to: targetEmails,
            subject: broadcastTitle,
            message: adminBroadcastBody.trim(),
            recipientName: isBroadcast ? 'Estimado/a profesional' : recipients[0].fullName,
          })
        }
      }

      setAdminBroadcastSubject('')
      setAdminBroadcastBody('')
      const successNotice = pushRes.success && pushRes.sentCount > 0
        ? `Comunicado enviado. Notificación push entregada a ${pushRes.sentCount} dispositivo(s)${adminBroadcastSendEmail ? ' y correos enviados vía soporte@drhappy.com.ar' : ''}.`
        : `Comunicado publicado exitosamente para ${recipients.length} profesional(es)${adminBroadcastSendEmail ? ' (notificaciones por email emitidas)' : ''}.`
      setAppNotice(successNotice)
      showSavedFloatingNotice('Comunicado enviado')
      void showAppNotification(broadcastTitle, {
        body: `Enviado a ${recipients.length} profesional(es).`,
      })
    } catch (err) {
      setAppError(`Error al enviar comunicado: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAdminBroadcastSending(false)
    }
  }

  async function handleTestEmail(): Promise<void> {
    const target = adminTestEmailAddress.trim() || (activeUser ? activeUser.email : '')
    if (!target) {
      setAppError('Ingresa una dirección de correo válida para probar.')
      return
    }
    setAdminTestingEmail(true)
    setAppError(null)
    setAppNotice(null)
    try {
      const res = await sendEmail({
        to: target,
        subject: '🧪 Prueba de envío SMTP - DrHappy',
        text: '¡El servicio de correo electrónico SMTP de Hostinger (soporte@drhappy.com.ar) está funcionando correctamente!',
        type: 'custom',
        templateData: {
          message: `Hola,\n\nEste es un correo de prueba emitido desde la plataforma DrHappy utilizando el servidor SMTP de Hostinger (soporte@drhappy.com.ar).\n\nTodo el sistema de notificaciones por email (bienvenida, recuperación de contraseñas y turnos) está activo y listo para operar.`,
        },
      })
      if (res.success) {
        setAppNotice(`¡Correo de prueba enviado con éxito a ${target} desde soporte@drhappy.com.ar! Revisa tu bandeja de entrada.`)
        showSavedFloatingNotice('Email de prueba enviado')
      } else {
        setAppError(`Error al enviar correo: ${res.message || 'Verifica la configuración de SMTP_PASSWORD en Supabase'}`)
      }
    } catch (err) {
      setAppError(`Fallo al enviar correo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAdminTestingEmail(false)
    }
  }

  async function handleTestDevicePush(): Promise<void> {
    if (!activeUserId) return
    setAdminTestingPush(true)
    try {
      if (notificationPermission !== 'granted') {
        const res = await requestNotificationPermission()
        setNotificationPermission(res)
        if (res !== 'granted') {
          setAppError('Debes autorizar los permisos de notificación en tu celular o navegador.')
          return
        }
      }
      await registerPushSubscription(activeUserId)
      const pushRes = await sendServerPushNotification({
        recipientUserId: activeUserId,
        title: '🔔 Notificación de prueba Dr Happy 😊',
        body: '¡Excelente! Las notificaciones push en segundo plano están funcionando en este dispositivo.',
        tag: `drhappy-test-${Date.now()}`,
      })
      if (pushRes.success && pushRes.sentCount > 0) {
        showSavedFloatingNotice('¡Push enviada a tu equipo!')
        setAppNotice(`¡Notificación enviada! Recibida en ${pushRes.sentCount} dispositivo(s) asociado(s) a tu cuenta.`)
      } else {
        void showAppNotification('🔔 Notificación en pantalla', {
          body: 'Prueba de notificación directa en pantalla exitosa.',
        })
        showSavedFloatingNotice('Notificación emitida')
      }
    } catch (err) {
      setAppError(`Error en prueba push: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAdminTestingPush(false)
    }
  }

  async function handleShareApp(): Promise<void> {
    const shareData = {
      title: 'DrHappy - Herramientas para Profesionales de la Salud e Instituciones',
      text: '¡Hola! Te recomiendo DrHappy: historia clínica digital, vademécum, escaneo de DNI y protocolos de emergencia.',
      url: 'https://drhappy.com.ar',
    }
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share(shareData)
        showSavedFloatingNotice('¡Gracias por compartir DrHappy!')
        return
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText('https://drhappy.com.ar')
      showSavedFloatingNotice('¡Enlace www.drhappy.com.ar copiado!')
      setAppNotice('¡Enlace de DrHappy copiado al portapapeles! Ya podés pegarlo en WhatsApp o mensajes para compartirlo.')
    } catch {
      setAppNotice('Visita y comparte https://drhappy.com.ar')
    }
  }

  useEffect(() => {
    const loadSeedUsers = async () => {
      const persistedSessionToken = localStorage.getItem(SESSION_TOKEN_KEY)
      if (persistedSessionToken && !sessionStorage.getItem(SESSION_TOKEN_KEY)) {
        sessionStorage.setItem(SESSION_TOKEN_KEY, persistedSessionToken)
      }
      const storedUserId = localStorage.getItem(SESSION_USER_KEY)
      const cachedSessionUser = readJsonStorage<SeedUser | null>(SESSION_USER_CACHE_KEY, null)
      try {
        const localUsers = readJsonStorage<SeedUser[]>(CREATED_USERS_KEY, [])
        const localActiveOverrides = readJsonStorage<Record<string, boolean>>(
          USER_ACTIVE_OVERRIDES_KEY,
          {},
        )
        let merged: SeedUser[] = []

        if (isSupabaseConfigured && supabase && persistedSessionToken) {
          const result = await loadProfessionals()
          if (!result.success) throw new Error(`No se pudo cargar profesionales remotos: ${result.message}`)
          for (const row of result.professionals ?? []) {
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
        } else if (!isSupabaseConfigured) {
          merged = []
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
        } else {
          merged = []
        }
        const normalizedUsers = merged.map((user) => ({
          ...user,
          isAdmin: isAdminUser(user),
          active: user.active ?? true,
        }))
        const sessionUser =
          normalizedUsers.find((user) => user.id === storedUserId) ??
          (!isSupabaseConfigured && cachedSessionUser?.id === storedUserId ? cachedSessionUser : null)
        const usersWithSession =
          sessionUser && !normalizedUsers.some((user) => user.id === sessionUser.id)
            ? [...normalizedUsers, sessionUser]
            : normalizedUsers

        setSeedUsers(usersWithSession)

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
        if (sessionUser) {
          await loadWorkspaceForUser(sessionUser)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error cargando usuarios.'
        const invalidSession = /sesión profesional requerida|unauthorized|401/i.test(errorMessage)
        if (invalidSession) {
          localStorage.removeItem(SESSION_USER_KEY)
          localStorage.removeItem(SESSION_USER_CACHE_KEY)
          localStorage.removeItem(SESSION_TOKEN_KEY)
          sessionStorage.removeItem(SESSION_TOKEN_KEY)
          setSeedUsers([])
          setAppError(null)
          return
        }
        setAppError(errorMessage)
        if (cachedSessionUser?.id === storedUserId) {
          setSeedUsers([cachedSessionUser])
          await loadWorkspaceForUser(cachedSessionUser).catch((workspaceError: unknown) => {
            setAppError(
              workspaceError instanceof Error
                ? `La sesión sigue activa, pero no se pudieron sincronizar los datos: ${workspaceError.message}`
                : 'La sesión sigue activa, pero no se pudieron sincronizar los datos.',
            )
          })
        }
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
    if (!profile || !activeUserId) {
      setShowNotificationToast(false)
      return
    }
    const currentPerm = getNotificationPermission()
    setNotificationPermission(currentPerm)
    if (currentPerm === 'granted') {
      setShowNotificationToast(false)
      localStorage.removeItem(NOTIFICATION_PROMPT_DISMISSED_KEY)
      void registerPushSubscription(activeUserId)
      return
    }
    const dismissedUntil = Number(localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) || '0')
    if (dismissedUntil > Date.now()) {
      setShowNotificationToast(false)
      return
    }
    const timer = window.setTimeout(() => {
      setShowNotificationToast(true)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [profile, activeUserId])

  async function handleEnableNotifications(): Promise<void> {
    const result = await requestNotificationPermission()
    setNotificationPermission(result)
    if (result === 'granted') {
      setShowNotificationToast(false)
      localStorage.removeItem(NOTIFICATION_PROMPT_DISMISSED_KEY)
      if (activeUserId) {
        void registerPushSubscription(activeUserId)
      }
      void showAppNotification('🔔 Notificaciones activadas', {
        body: '¡Excelente! Ahora recibirás avisos de mensajes privados y novedades en tu dispositivo.',
      })
      showSavedFloatingNotice('Notificaciones activadas con éxito')
    } else if (result === 'denied') {
      setShowNotificationToast(true)
      setAppError(
        'Las notificaciones figuran bloqueadas en tu navegador. Tocá el candado 🔒 junto a la URL arriba para permitirlas.',
      )
    } else {
      setAppNotice('El navegador no mostró el permiso o lo dejaste pendiente. Podés activarlo más tarde desde el candado 🔒 de la barra de direcciones.')
    }
  }

  useEffect(() => {
    if (!activeUserId) return

    if (notificationPermission === 'granted') {
      void registerPushSubscription(activeUserId)
    }

    function checkPermissionAndSync(): void {
      const current = getNotificationPermission()
      setNotificationPermission(current)
      if (current === 'granted') {
        setShowNotificationToast(false)
        if (activeUserId) {
          void registerPushSubscription(activeUserId)
        }
      }
    }

    window.addEventListener('focus', checkPermissionAndSync)

    let interval: number | null = null
    if (notificationPermission !== 'granted') {
      interval = window.setInterval(checkPermissionAndSync, 3500)
    }

    return () => {
      window.removeEventListener('focus', checkPermissionAndSync)
      if (interval) window.clearInterval(interval)
    }
  }, [activeUserId, notificationPermission])

  function handleDismissNotificationToast(): void {
    setShowNotificationToast(false)
    localStorage.setItem(
      NOTIFICATION_PROMPT_DISMISSED_KEY,
      String(Date.now() + NOTIFICATION_PROMPT_SNOOZE_DAYS * 24 * 60 * 60 * 1000),
    )
  }

  useEffect(() => {
    if (workspaceLayer !== 'user-admin' || !isAdminSession) {
      return
    }
    void getPushSubscriptionsCount().then((res) => setAdminPushCount(res.total))
    // Carga métricas de uso por usuario (conteos y fechas, sin datos clínicos).
    if (activeUserId) {
      setAdminUserStatsLoading(true)
      void fetchAdminUserStats(activeUserId)
        .then((res) => {
          if (res.success && res.users) {
            setAdminUserStats(res.users)
          }
        })
        .finally(() => setAdminUserStatsLoading(false))
      setAdminAIUsageLoading(true)
      void fetchAdminAIUsage(activeUserId)
        .then((res) => {
          if (res.success) {
            setAdminAIUsage(res.usage || [])
            setAdminAITotal(res.total || { requests: 0, tokens: 0, costUsd: 0 })
          }
        })
        .finally(() => setAdminAIUsageLoading(false))
    }
  }, [workspaceLayer, isAdminSession, activeUserId])

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
    const oauthParams = new URLSearchParams(window.location.search)
    const oauthHash = new URLSearchParams(window.location.hash.replace(/^#/, '?'))
    const oauthError = oauthParams.get('error_description') || oauthHash.get('error_description')
    if (oauthError) {
      setAuthError(`Google no pudo iniciar sesión: ${oauthError.replace(/\+/g, ' ')}`)
      window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`)
      return
    }
    if (window.location.hash.includes('access_token') || window.location.hash.includes('refresh_token')) {
      // Supabase ya procesó el fragmento al inicializarse; no lo dejamos visible
      // mientras resolvemos el perfil profesional.
      window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`)
    }
    // Al volver del redirect de Google, Supabase deja la sesión activa; la resolvemos
    // buscando/creando el profesional correspondiente al email de Google.
    const storedUserId = localStorage.getItem(SESSION_USER_KEY)
    const storedUserIsLoaded = Boolean(
      storedUserId && seedUsers.some((user) => user.id === storedUserId),
    )
    if (storedUserIsLoaded && activeUserId === storedUserId) {
      return
    }
    void resolveGoogleSession().catch((error: unknown) => {
      setAppError(
        error instanceof Error
          ? `No se pudo completar el inicio de sesión con Google: ${error.message}`
          : 'No se pudo completar el inicio de sesión con Google.',
      )
    })
  }, [activeUserId, loadingUsers, seedUsers])

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

  const communityHasActiveFilters = Boolean(communitySearchQuery.trim())

  const filteredCommunityMembers = useMemo(() => {
    if (!communityHasActiveFilters) {
      return []
    }

    return communityMembers
      .map((member) => ({
        member,
        score: communitySearchQuery.trim()
          ? scoreProfessionalSearch(member, communitySearchQuery)
          : 0,
      }))
      .filter(({ score }) => !communitySearchQuery.trim() || Number.isFinite(score))
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

  const myPatients = useMemo(() => {
    const query = normalizeSearchText(myPatientsQuery)
    const filtered = patients.filter((patient) => {
      if (!query) return true
      return normalizeSearchText(`${patient.apellido} ${patient.nombre} ${patient.dni}`).includes(query)
    })
    return filtered
      .sort((left, right) => {
        const leftLast = left.consultations.reduce((latest, entry) => Math.max(latest, Date.parse(entry.date) || 0), 0)
        const rightLast = right.consultations.reduce((latest, entry) => Math.max(latest, Date.parse(entry.date) || 0), 0)
        return rightLast - leftLast || `${left.apellido} ${left.nombre}`.localeCompare(`${right.apellido} ${right.nombre}`, 'es')
      })
  }, [myPatientsQuery, patients])

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
    if (!profile) return
    setAppointmentDays(profile.appointmentDays?.length ? profile.appointmentDays : DEFAULT_APPOINTMENT_DAYS)
    setDailyPatientLimit(profile.dailyPatientLimit || DEFAULT_DAILY_PATIENT_LIMIT)
    setAppointmentDurationMinutes(profile.appointmentDurationMinutes || 30)
    setAppointmentAmountToCharge(typeof profile.appointmentAmountToCharge === 'number' ? String(profile.appointmentAmountToCharge) : '')
    setAppointmentAmountConcept(profile.appointmentAmountConcept === 'consulta' ? 'consulta' : 'sena')
    setAppointmentStartTime(profile.appointmentStartTime || DEFAULT_APPOINTMENT_START_TIME)
    setAppointmentEndTime(profile.appointmentEndTime || DEFAULT_APPOINTMENT_END_TIME)
  }, [profile])

  useEffect(() => {
    if (!communityOpen || !activeUserId) {
      return
    }

    if (!communityTargetId && communityDisplayedMembers.length > 0) {
      setCommunityTargetId(communityDisplayedMembers[0].id)
    }
  }, [communityOpen, communityTargetId, communityDisplayedMembers, activeUserId])

  useEffect(() => {
    if (!communityOpen || !activeUserId || !communityTargetId) {
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
          const result = await communityRequest({ action: 'thread', memberId: communityTargetId })
          if (!result.success) {
            console.warn('Error leyendo chat de comunidad:', result.message)
            return
          }
          const ordered = (result.messages ?? []).map((row) =>
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
    }, 10000)

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
  }, [communityOpen, activeUserId, communityTargetId])

  useEffect(() => {
    if (!communityOpen || !activeUserId || !communityTargetId) {
      return
    }
    markCommunityMessagesAsSeenForMember(communityTargetId)
  }, [communityOpen, activeUserId, communityTargetId])

  useEffect(() => {
    if (!isModuleEnabled('community')) {
      return
    }
    if (!activeUserId) {
      setCommunityUnreadCount(0)
      setCommunityUnreadByMember({})
      return
    }

    const scanUnread = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return
      }

      const seenIds = new Set(communitySeenIds)
      const incoming: CommunityMessage[] = []
      const byMember: Record<string, number> = {}

      if (isSupabaseConfigured && supabase) {
        try {
          const result = await communityRequest({ action: 'unread' })
          if (!result.success) {
            console.warn('No se pudieron escanear mensajes nuevos en Supabase:', result.message)
            return
          }
          for (const row of result.messages ?? []) {
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
    }, 30000)

    const handleVisibilityOrOnline = () => {
      if (navigator.onLine) {
        void scanUnread()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityOrOnline)
    window.addEventListener('online', handleVisibilityOrOnline)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline)
      window.removeEventListener('online', handleVisibilityOrOnline)
    }
  }, [activeUserId, communitySeenIds, seedUsers])

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
      const incomingForMember = communityMessages.filter((message) => message.senderId === memberId && message.recipientId === activeUserId)

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
      const result = await updateOwnProfessionalProfile({ fullName: nextFullName, specialty: nextSpecialty, licenseNumber: nextLicenseNumber, email: nextEmail })
      if (!result.success) throw new Error(`No se pudo sincronizar el perfil profesional: ${result.message}`)
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

  async function handleDeletePatient(patientId: string): Promise<void> {
    if (!activeUserId) return
    const target = patients.find((patient) => patient.id === patientId)
    if (!target || target.ownerUserId !== activeUserId) {
      setAppError('Solo podés eliminar pacientes creados por tu cuenta.')
      return
    }
    if (!window.confirm(`¿Eliminar definitivamente la ficha de ${target.nombre} ${target.apellido}?`)) return
    const nextPatients = patients.filter((patient) => patient.id !== patientId)
    const ownerIndex = readJsonStorage<string[]>(patientIndexStorageKey(activeUserId), []).filter((id) => id !== patientId)
    const registry = readJsonStorage<string[]>(PATIENT_REGISTRY_KEY, []).filter((id) => id !== patientId)
    localStorage.setItem(patientIndexStorageKey(activeUserId), JSON.stringify(ownerIndex))
    localStorage.setItem(PATIENT_REGISTRY_KEY, JSON.stringify(registry))
    localStorage.removeItem(patientGlobalStorageKey(patientId))
    setPatients(nextPatients)
    setAvailablePatients((current) => current.filter((patient) => patient.id !== patientId))
    if (selectedPatientId === patientId) {
      setSelectedPatientId(null)
      setWorkspaceLayer('my-patients')
    }
    if (profile) await persistWorkspaceRemote(activeUserId, profile, nextPatients, appointments, treatmentLedger)
    setAppNotice('Paciente eliminado correctamente.')
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
    const emailResult = await sendPasswordRecoveryEmail({
      to: user.email,
      fullName: user.fullName,
      code,
      expiresMinutes: 15,
    })
    if (emailResult.success) {
      setAppNotice(
        `Te enviamos el código de recuperación a ${user.email} desde soporte@drhappy.com.ar (vigente por 15 min).`,
      )
    } else {
      setAppNotice('Código de recuperación generado. Tiene una vigencia de 15 minutos.')
    }
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
    if (recoveryPassword.length < 6) {
      setAuthError('La nueva contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (isSupabaseConfigured && supabase) {
      const result = await setProfessionalPassword({ userId: user.id, newPassword: recoveryPassword })
      if (!result.success) {
        setAuthError(result.message || 'No se pudo actualizar la contraseña.')
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
        entry.id === user.id ? { ...entry, password: undefined } : entry,
      ),
    )
    void sendPasswordChangedEmail({
      to: user.email,
      fullName: user.fullName,
    })
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
    const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    const redirectUrl = isLocalDevelopment
      ? `${window.location.origin}${window.location.pathname || '/'}`
      : 'https://www.drhappy.com.ar/'
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
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
        headers: sessionStorage.getItem('drhappy-professional-session') ? { 'x-drhappy-session': sessionStorage.getItem('drhappy-professional-session') as string } : undefined,
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
    const sessionGeneration = sessionGenerationRef.current
    if (!isSupabaseConfigured || !supabase) {
      return
    }
    const { data } = await supabase.auth.getSession()
    const googleUser = data.session?.user
    if (!googleUser?.email) {
      return
    }

    const email = googleUser.email.toLowerCase()
    const fullName = (googleUser.user_metadata?.full_name as string | undefined) ?? email.split('@')[0]
    const result = await loginWithGoogle({ accessToken: data.session?.access_token || '', email, fullName })
    if (sessionGeneration !== sessionGenerationRef.current) return
    if (!result.success || !result.professional) {
      setAuthError(result.message || 'No se pudo iniciar sesión con Google.')
      return
    }
    const nextUser = mapAuthProfessionalPublic(result.professional)
    if (result.sessionToken) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, result.sessionToken)
      localStorage.setItem(SESSION_TOKEN_KEY, result.sessionToken)
    }
    setSeedUsers((current) => current.some((user) => user.id === nextUser.id) ? current.map((user) => user.id === nextUser.id ? nextUser : user) : [...current, nextUser])
    setGoogleIdentity({ email: googleUser.email, fullName })
    localStorage.setItem(SESSION_USER_KEY, nextUser.id)
    await loadWorkspaceForUser(nextUser)
    setWorkspaceLayer('overview')
    setSelectedPatientId(null)
    setAppNotice('Sesión iniciada con Google.')
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAuthError(null)
    setAppNotice(null)

    if (isSupabaseConfigured) {
      const result = await loginProfessional({ username: username.trim().toLowerCase(), password })
      if (!result.success || !result.professional) {
        setAuthError(result.message || 'Usuario o contraseña inválidos o usuario inactivo.')
        return
      }
      const user = mapAuthProfessionalPublic(result.professional)
      try {
        sessionGenerationRef.current += 1
        setActiveUserId(null)
        setProfile(null)
        setPatients([])
        setAvailablePatients([])
        setAppointments([])
        setTreatmentLedger([])
        setSeedUsers((current) => current.some((entry) => entry.id === user.id)
          ? current.map((entry) => entry.id === user.id ? user : entry)
          : [...current, user])
        if (result.sessionToken) {
          sessionStorage.setItem(SESSION_TOKEN_KEY, result.sessionToken)
          localStorage.setItem(SESSION_TOKEN_KEY, result.sessionToken)
        }
        localStorage.setItem(SESSION_USER_KEY, user.id)
        await loadWorkspaceForUser(user)
        setWorkspaceLayer('overview')
        setSelectedPatientId(null)
      } catch (error) {
        setAppError(
          error instanceof Error
            ? `No se pudieron cargar datos del profesional: ${error.message}`
            : 'No se pudieron cargar datos del profesional.',
        )
      }
      return
    }

    // Modo local (sin Supabase configurado): sólo para demo/desarrollo sin backend.
    const passwordOverrides = readJsonStorage<Record<string, string>>(PASSWORD_OVERRIDES_KEY, {})
    const user = seedUsers.find(
      (entry) =>
        entry.active !== false &&
        entry.username.trim().toLowerCase() === username.trim().toLowerCase() &&
        (passwordOverrides[entry.id] ?? entry.password) === password,
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

  function handleRegisterFieldChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
    const { name, value } = event.target
    setRegisterDraft((current) => {
      if (name === 'email') {
        const usernameFollowsEmail =
          !current.username.trim() ||
          current.username.trim().toLowerCase() === current.email.trim().toLowerCase()
        return {
          ...current,
          email: value,
          username: usernameFollowsEmail ? value.trim().toLowerCase() : current.username,
        }
      }
      return {
        ...current,
        [name]: name === 'username' ? value.toLowerCase() : value,
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
      dni: registerDraft.dni.trim(),
      specialty: registerDraft.specialty.trim(),
      licenseNumber: registerDraft.licenseNumber.trim(),
      email: registerDraft.email.trim().toLowerCase(),
      username: registerDraft.username.trim().toLowerCase(),
      password: registerDraft.password,
      networkMemberships: registerDraft.networkMemberships,
    }
    const fullName = `${draft.firstName} ${draft.lastName}`.trim()

    if (
      !draft.firstName ||
      !draft.lastName ||
      !draft.dni ||
      !draft.specialty ||
      !draft.licenseNumber ||
      !draft.email ||
      !draft.username ||
      !draft.password
    ) {
      setAuthError('Completa todos los campos para crear el usuario.')
      return
    }

    if (draft.password.length < 6) {
      setAuthError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (registerUsernameExists) {
      setAuthError('Ese nombre de usuario ya existe.')
      return
    }

    if (registerEmailExists) {
      setAuthError('Ese email ya está asociado a otro usuario.')
      return
    }

    let nextUser: SeedUser
    if (isSupabaseConfigured) {
      const result = await registerProfessional({
        username: draft.username,
        password: draft.password,
        fullName,
        specialty: draft.specialty,
        licenseNumber: draft.licenseNumber,
        dni: draft.dni,
        email: draft.email,
        networkMemberships: draft.networkMemberships,
      })
      if (!result.success || !result.professional) {
        setAuthError(result.message || 'No se pudo crear el usuario en la base remota.')
        return
      }
      nextUser = mapAuthProfessionalPublic(result.professional)
      await persistWorkspaceRemote(nextUser.id, profileFromSeed(nextUser), [], [])
    } else {
      nextUser = {
        id: crypto.randomUUID(),
        username: draft.username,
        password: draft.password,
        fullName,
        specialty: draft.specialty,
        licenseNumber: draft.licenseNumber,
        dni: draft.dni,
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
    void sendWelcomeEmail({
      to: draft.email,
      fullName,
      username: draft.username,
      specialty: draft.specialty,
    })
    setRegisterOpen(false)
    setRegisterDraft(emptyRegisterDraft)
    setUsername(nextUser.username)
    setPassword('')
    setAppNotice('Usuario creado y correo de bienvenida enviado. Ya puedes iniciar sesión con el nuevo profesional.')
    showSavedFloatingNotice()
  }

  async function handleToggleUserActive(userId: string): Promise<void> {
    const targetUser = seedUsers.find((user) => user.id === userId)
    if (!targetUser || isAdminUser(targetUser)) {
      return
    }

    const nextActive = targetUser.active === false
    if (isSupabaseConfigured && supabase) {
      if (!activeUserId) {
        setAppError('Sesión no válida para esta acción.')
        return
      }
      const result = await setProfessionalActive(activeUserId, userId, nextActive)
      if (!result.success) {
        setAppError(`No se pudo actualizar el estado del usuario: ${result.message ?? 'error desconocido'}`)
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
    sessionGenerationRef.current += 1
    stopLiveScanner()
    stopDictation()
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut()
    }
    localStorage.removeItem(SESSION_USER_KEY)
    localStorage.removeItem(SESSION_USER_CACHE_KEY)
    sessionStorage.removeItem('drhappy-professional-session')
    localStorage.removeItem(SESSION_TOKEN_KEY)
    setGoogleIdentity(null)
    setActiveUserId(null)
    setProfile(null)
    setPatients([])
    setAvailablePatients([])
    setAppointments([])
    setTreatmentLedger([])
    setSelectedPatientId(null)
    setPatientSearchQuery('')
    setPatientDraft(emptyPatientDraft)
    setConsultationDraft(emptyConsultationDraft)
    setCommunityOpen(false)
    setCommunityTargetId(null)
    setCommunitySearchQuery('')
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

  async function handleSofiaClinicalDocumentUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!selectedPatient) {
      setAppError('Seleccioná un paciente antes de subir un laboratorio a Sofía.')
      return
    }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(file.name)
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)
    if (!isPdf && !isDocx && !isImage && !/\.(txt|csv|md|json)$/i.test(file.name) && !file.type.startsWith('text/')) {
      setAppError('Sofía puede leer laboratorios en PDF, DOCX, imágenes, TXT, CSV, MD o JSON.')
      return
    }
    let text = ''
    if (isDocx) {
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
      text = result.value.trim()
    } else if (isImage) {
      setAppNotice(`Sofía está leyendo ${file.name}. Esto puede tardar unos segundos.`)
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('spa')
      try {
        const result = await worker.recognize(file)
        text = result.data.text.trim()
      } finally {
        await worker.terminate()
      }
    } else if (isPdf) {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
      const pages: string[] = []
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const content = await page.getTextContent()
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
      }
      text = pages.join('\n\n').trim()
    } else {
      text = (await file.text()).trim()
    }
    if (!text) {
      setAppError('El archivo no contiene texto legible.')
      return
    }
    setConsultationDraft((current) => ({
      ...current,
      detalleAtencion: [current.detalleAtencion.trim(), `Laboratorio adjunto (${file.name}):\n${text}`].filter(Boolean).join('\n\n'),
    }))
    setAppNotice(`Laboratorio ${file.name} cargado en el borrador. Usá Sofía para ordenarlo y luego guardá la evolución.`)
  }

  async function summarizeClinicalInterview(): Promise<void> {
    if (!selectedPatient || !consultationDraft.detalleAtencion.trim() || clinicalSummaryBusy) {
      setAppError('Transcribí primero el interrogatorio del paciente antes de pedir el resumen.')
      return
    }
    setClinicalSummaryBusy(true)
    setAppError(null)
    try {
      const patientName = `${selectedPatient.apellido}, ${selectedPatient.nombre}`.trim()
      const result = await askSofia({
        professionalName: profile?.fullName || activeUser?.fullName,
        messages: [{
          role: 'user',
          content: `Convertí la entrevista en una evolución clínica revisable. No inventes datos, no diagnostiques ni indiques tratamientos. Devolvé exactamente: MOTIVO:, ENFERMEDAD ACTUAL:, EXAMEN FÍSICO:, IMPRESIÓN DIAGNÓSTICA:, PLAN DE MANEJO:, ANTECEDENTES RELEVANTES: y PENSAMIENTO:. MOTIVO debe ser una etiqueta breve de 1 a 4 palabras. ENFERMEDAD ACTUAL debe contener solo lo relatado hoy. En examen, impresión y plan indicá No consignado o A revisar si faltan datos. ${patientName}. Transcripción:\n${consultationDraft.detalleAtencion.trim()}`,
        }],
        context: 'El profesional está completando una evolución clínica. El resultado es un borrador no guardado y debe ser revisado por el profesional antes de incorporarlo a la historia clínica.',
      })
      if (!result.success || !result.reply) {
        setAppError(result.message || 'No se pudo preparar el resumen clínico.')
        return
      }
      const parsedSummary = parseClinicalSummary(result.reply)
      const { motivo, enfermedadActual, examenFisico, impresionDiagnostica, planManejo, antecedentes, pensamiento } = parsedSummary
      if (!enfermedadActual && !pensamiento) {
        setAppError('Sofía respondió, pero no pudo separar el borrador en secciones. Conservé la transcripción original para que la revises.')
        return
      }
      setConsultationDraft((current) => ({
        ...current,
        motivoConsulta: motivo || current.motivoConsulta,
        detalleAtencion: enfermedadActual ? `${enfermedadActual}${antecedentes ? `\n\nAntecedentes relevantes:\n${antecedentes}` : ''}` : current.detalleAtencion,
        enfermedadActual: enfermedadActual || current.enfermedadActual,
        examenFisico: examenFisico || current.examenFisico,
        impresionDiagnostica: impresionDiagnostica || current.impresionDiagnostica,
        planManejo: planManejo || current.planManejo,
        pensamientoMedico: pensamiento || current.pensamientoMedico,
      }))
      setAppNotice('Sofía preparó un borrador. Revisalo antes de guardar la evolución.')
    } finally {
      setClinicalSummaryBusy(false)
    }
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

  function handleProfileFieldChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
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

  /** Las pestañas de Herramientas ahora incluyen Comunidad: al salir se corta el polling. */
  function handleSelectToolsTab(tab: 'protocols' | 'vademecum' | 'consult' | 'community'): void {
    const profession = normalizeSearchText(activeUser?.specialty || profile?.specialty || '')
    const restrictedProfession = profession.includes('psic') || profession.includes('odont')
    const safeTab = restrictedProfession && (tab === 'protocols' || tab === 'consult') ? 'vademecum' : tab
    setToolsActiveTab(safeTab)
    setCommunityOpen(safeTab === 'community')
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
    if (!isModuleEnabled('attention')) {
      setAppError('El módulo Atención médica no está habilitado para tu cuenta.')
      return
    }
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
    if (!isModuleEnabled('tools')) {
      setAppError('El módulo Herramientas no está habilitado para tu cuenta.')
      return
    }
    const profession = normalizeSearchText(activeUser?.specialty || profile?.specialty || '')
    if (profession.includes('psic') || profession.includes('odont')) {
      setToolsActiveTab('vademecum')
    }
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('tools')
    setAppError(null)
  }

  function handleOpenAmbulance(): void {
    if (!isModuleEnabled('ambulance')) {
      setAppError('El módulo Modo Ambulancia no está habilitado para tu cuenta.')
      return
    }
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('ambulance')
    setAppError(null)
  }

  function handleBackToOverview(): void {
    stopDictation()
    setCommunityOpen(false)
    setWorkspaceLayer('overview')
    setAppError(null)
  }

  function handleOpenAppointments(): void {
    if (!isModuleEnabled('appointments')) {
      setAppError('El módulo Turnera no está habilitado para tu cuenta.')
      return
    }
    stopDictation()
    setCommunityOpen(false)
    setTurneraViewMode('list')
    setWorkspaceLayer('appointments')
    setAppError(null)
  }

  function saveAppointmentCapacity(nextDays: number[], nextStartTime = appointmentStartTime, nextEndTime = appointmentEndTime, nextDuration = appointmentDurationMinutes): void {
    const normalizedDays = Array.from(new Set(nextDays)).filter((day) => day >= 0 && day <= 6)
    const normalizedLimit = Math.max(1, Math.min(100, calculateDailyCapacity(nextStartTime, nextEndTime, nextDuration)))
    const normalizedStartTime = /^\d{2}:\d{2}$/.test(nextStartTime) ? nextStartTime : DEFAULT_APPOINTMENT_START_TIME
    const normalizedEndTime = /^\d{2}:\d{2}$/.test(nextEndTime) ? nextEndTime : DEFAULT_APPOINTMENT_END_TIME
    const normalizedDuration = Math.max(5, Math.min(240, Math.round(nextDuration)))
    if (normalizedStartTime >= normalizedEndTime) {
      setAppError('El horario Desde debe ser anterior al horario Hasta.')
      return
    }
    setAppointmentDays(normalizedDays)
    setDailyPatientLimit(normalizedLimit)
    setAppointmentStartTime(normalizedStartTime)
    setAppointmentEndTime(normalizedEndTime)
    setAppointmentDurationMinutes(normalizedDuration)
    if (!activeUserId || !profile) return
    const nextProfile = {
      ...profile,
      appointmentDays: normalizedDays,
      dailyPatientLimit: normalizedLimit,
      appointmentDurationMinutes: normalizedDuration,
      appointmentAmountToCharge: Number(appointmentAmountToCharge) > 0 ? Number(appointmentAmountToCharge) : undefined,
      appointmentAmountConcept,
      appointmentStartTime: normalizedStartTime,
      appointmentEndTime: normalizedEndTime,
    }
    setProfile(nextProfile)
    localStorage.setItem(profileStorageKey(activeUserId), JSON.stringify(nextProfile))
    void persistWorkspaceRemote(activeUserId, nextProfile, patients, appointments, treatmentLedger)
    setAppNotice(`Configuración guardada: ${normalizedLimit} turnos posibles por día.`)
  }

  function saveAppointmentAmount(): void {
    if (!activeUserId || !profile) return
    const nextProfile = {
      ...profile,
      appointmentAmountToCharge: Number(appointmentAmountToCharge) > 0 ? Number(appointmentAmountToCharge) : undefined,
      appointmentAmountConcept,
    }
    setProfile(nextProfile)
    localStorage.setItem(profileStorageKey(activeUserId), JSON.stringify(nextProfile))
    void persistWorkspaceRemote(activeUserId, nextProfile, patients, appointments, treatmentLedger)
  }

  function handleAppointmentAmountChange(value: string): void {
    setAppointmentAmountToCharge(value)
    if (!activeUserId || !profile) return
    const nextProfile = {
      ...profile,
      appointmentAmountToCharge: Number(value) > 0 ? Number(value) : undefined,
    }
    setProfile(nextProfile)
    localStorage.setItem(profileStorageKey(activeUserId), JSON.stringify(nextProfile))
  }

  function handleNewAppointmentModal(prefillPatient?: PatientRecord | null, prefillDate?: string): void {
    if (prefillPatient) {
      setAppointmentDraft({
        patientId: prefillPatient.id,
        patientName: `${prefillPatient.apellido}, ${prefillPatient.nombre}`.trim(),
        patientEmail: prefillPatient.email || '',
        patientDni: prefillPatient.dni || '',
        scheduledDate: prefillDate || todayLocalISO(),
        scheduledTime: '09:00',
        durationMinutes: 30,
        reason: prefillPatient.diagnosticoPrincipal || 'Control médico general',
        notes: '',
        location: 'Consultorio médico',
        sendEmailConfirmation: Boolean(prefillPatient.email),
        amountToCharge: '',
        amountConcept: 'consulta',
      })
    } else {
      setAppointmentDraft({ ...buildEmptyAppointmentDraft(), scheduledDate: prefillDate || todayLocalISO() })
    }
    setAppointmentPatientQuery('')
    setAppointmentSuggestionsOpen(false)
    setAppointmentModalOpen(true)
  }

  function handleEditAppointment(record: AppointmentRecord): void {
    setAppointmentDraft({
      id: record.id,
      patientId: record.patientId,
      patientName: record.patientName,
      patientEmail: record.patientEmail || '',
      patientDni: record.patientDni || '',
      scheduledDate: record.scheduledDate,
      scheduledTime: record.scheduledTime,
      durationMinutes: record.durationMinutes ?? 30,
      reason: record.reason,
      notes: record.notes || '',
      location: record.location || 'Consultorio médico',
      sendEmailConfirmation: Boolean(record.patientEmail),
      amountToCharge: record.amountToCharge ? String(record.amountToCharge) : '',
      amountConcept: record.amountConcept || 'consulta',
    })
    setAppointmentPatientQuery('')
    setAppointmentSuggestionsOpen(false)
    setAppointmentModalOpen(true)
  }

  function handleSelectAppointmentPatient(patient: PatientRecord): void {
    const displayName = `${patient.apellido}${patient.nombre ? `, ${patient.nombre}` : ''}`.trim()
    setAppointmentDraft((prev) => ({
      ...prev,
      patientId: patient.id,
      patientName: displayName,
      patientDni: patient.dni || prev.patientDni,
      patientEmail: patient.email || prev.patientEmail,
    }))
    setAppointmentPatientQuery('')
    setAppointmentSuggestionsOpen(false)
  }

  // ── Balance de pagos (odontología) ──────────────────────────────────────────

  function persistTreatmentLedger(next: TreatmentLedgerEntry[]): void {
    if (!activeUserId) return
    setTreatmentLedger(next)
    localStorage.setItem(treatmentLedgerStorageKey(activeUserId), JSON.stringify(next))
    if (profile) {
      void persistWorkspaceRemote(activeUserId, profile, patients, appointments, next)
    }
  }

  function buildEmptyLedgerDraft(patient?: PatientRecord | null): TreatmentLedgerDraft {
    return {
      patientId: patient?.id ?? '',
      patientName: patient ? `${patient.apellido}${patient.nombre ? `, ${patient.nombre}` : ''}`.trim() : '',
      date: todayLocalISO(),
      intervention: '',
      totalAmount: '',
      paidAmount: '',
      notes: '',
    }
  }

  function handleOpenLedgerModal(entry?: TreatmentLedgerEntry): void {
    if (entry) {
      setLedgerDraft({
        id: entry.id,
        patientId: entry.patientId,
        patientName: entry.patientName,
        date: entry.date,
        intervention: entry.intervention,
        totalAmount: String(entry.totalAmount),
        paidAmount: String(entry.paidAmount),
        notes: entry.notes ?? '',
      })
    } else {
      setLedgerDraft(buildEmptyLedgerDraft())
    }
    setLedgerPatientQuery('')
    setLedgerSuggestionsOpen(false)
    setLedgerModalOpen(true)
  }

  function handleSaveLedgerEntry(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!ledgerDraft || !activeUserId) return

    const patientName = ledgerDraft.patientName.trim()
    const intervention = ledgerDraft.intervention.trim()
    if (!patientName || !intervention) {
      setAppError('Indicá el paciente y la intervención realizada.')
      return
    }

    const total = Number(ledgerDraft.totalAmount.replace(',', '.'))
    const paid = ledgerDraft.paidAmount.trim() ? Number(ledgerDraft.paidAmount.replace(',', '.')) : 0
    if (!Number.isFinite(total) || total <= 0) {
      setAppError('El monto total del tratamiento debe ser un número mayor a cero.')
      return
    }
    if (!Number.isFinite(paid) || paid < 0) {
      setAppError('El monto abonado debe ser un número válido.')
      return
    }
    if (paid > total) {
      setAppError('Lo abonado no puede superar el total del tratamiento.')
      return
    }

    const now = new Date().toISOString()
    const existing = ledgerDraft.id ? treatmentLedger.find((e) => e.id === ledgerDraft.id) : null
    const record: TreatmentLedgerEntry = {
      id: ledgerDraft.id ?? crypto.randomUUID(),
      patientId: ledgerDraft.patientId,
      patientName,
      date: ledgerDraft.date || todayLocalISO(),
      intervention,
      totalAmount: total,
      paidAmount: paid,
      notes: ledgerDraft.notes.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    const next = existing
      ? treatmentLedger.map((e) => (e.id === record.id ? record : e))
      : [record, ...treatmentLedger]

    persistTreatmentLedger(next)
    setAppError(null)
    setLedgerModalOpen(false)
    setLedgerDraft(null)
    setAppNotice(existing ? 'Tratamiento actualizado.' : 'Tratamiento registrado en el balance.')
    showSavedFloatingNotice()
  }

  /** Registra un pago parcial sobre un tratamiento con saldo pendiente. */
  function handleRegisterLedgerPayment(entryId: string): void {
    const entry = treatmentLedger.find((e) => e.id === entryId)
    if (!entry) return
    const pending = entry.totalAmount - entry.paidAmount
    if (pending <= 0) {
      setAppNotice(`El tratamiento de ${entry.patientName} ya está saldado.`)
      return
    }
    setPaymentTarget({ entryId, amount: String(pending) })
  }

  function handleConfirmLedgerPayment(): void {
    if (!paymentTarget) return
    const entry = treatmentLedger.find((e) => e.id === paymentTarget.entryId)
    if (!entry) {
      setPaymentTarget(null)
      return
    }
    const pending = entry.totalAmount - entry.paidAmount

    const amount = Number(paymentTarget.amount.replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) {
      setAppError('El importe del pago debe ser un número mayor a cero.')
      return
    }
    if (amount > pending) {
      setAppError(`El pago no puede superar el saldo pendiente (${formatMoney(pending)}).`)
      return
    }

    persistTreatmentLedger(
      treatmentLedger.map((e) =>
        e.id === paymentTarget.entryId
          ? { ...e, paidAmount: e.paidAmount + amount, updatedAt: new Date().toISOString() }
          : e,
      ),
    )
    setPaymentTarget(null)
    setAppError(null)
    setAppNotice(`Pago de ${formatMoney(amount)} registrado para ${entry.patientName}.`)
    showSavedFloatingNotice()
  }

  function handleDeleteLedgerEntry(entryId: string): void {
    const entry = treatmentLedger.find((e) => e.id === entryId)
    if (!entry) return
    if (!window.confirm(`¿Eliminar el registro "${entry.intervention}" de ${entry.patientName}?`)) {
      return
    }
    persistTreatmentLedger(treatmentLedger.filter((e) => e.id !== entryId))
    setAppNotice('Registro eliminado del balance.')
  }

  /** Envía por email el mismo recordatorio de saldo pendiente que puede generar Sofía. */
  async function handleSendLedgerPaymentReminder(entryId: string): Promise<void> {
    const entry = treatmentLedger.find((e) => e.id === entryId)
    if (!entry) return
    const pending = entry.totalAmount - entry.paidAmount
    if (pending <= 0) {
      setAppNotice(`El tratamiento de ${entry.patientName} ya está saldado.`)
      return
    }
    const patient = patients.find((p) => p.id === entry.patientId)
    const relatedAppointment = appointments.find((appointment) => appointment.patientId === entry.patientId && appointment.patientEmail?.trim())
    const email = patient?.email?.trim() || relatedAppointment?.patientEmail?.trim()
    if (!email) {
      setAppError(`${entry.patientName} no tiene un email cargado para enviarle el recordatorio.`)
      return
    }
    setLedgerReminderSendingId(entryId)
    const message = `Hola ${patient?.nombre || entry.patientName},\n\nTe informamos el saldo pendiente registrado:\n\nTratamiento: ${entry.intervention}\nTotal: ${formatMoney(entry.totalAmount)}\nPagado: ${formatMoney(entry.paidAmount)}\nPendiente: ${formatMoney(pending)}\n\nSaludos cordiales.`
    const result = await sendEmail({
      to: email,
      subject: 'Recordatorio de saldo pendiente',
      type: 'custom',
      text: message,
      templateData: { message },
    })
    setLedgerReminderSendingId(null)
    if (result.success) {
      setAppNotice(`Recordatorio de pago enviado a ${entry.patientName}.`)
      showSavedFloatingNotice()
    } else {
      setAppError(`No se pudo enviar el recordatorio: ${result.message || 'error de envío'}.`)
    }
  }

  async function handleSaveAppointment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!activeUserId) return
    if (!appointmentDraft.patientName.trim() || !appointmentDraft.scheduledDate || !appointmentDraft.scheduledTime) {
      setAppError('Completa el nombre del paciente, fecha y hora del turno.')
      return
    }
    if (appointmentDraft.patientEmail.trim() && !isValidEmail(appointmentDraft.patientEmail.trim())) {
      setAppError('El email del paciente no tiene un formato válido.')
      return
    }
    const rawAmount = appointmentDraft.amountToCharge.trim()
    const parsedAmount = rawAmount ? Number(rawAmount.replace(',', '.')) : null
    if (rawAmount && (!Number.isFinite(parsedAmount) || (parsedAmount as number) <= 0)) {
      setAppError('El monto a cobrar debe ser un número mayor a cero.')
      return
    }

    const toMinutes = (value: string): number => {
      const [hours, minutes] = value.split(':').map(Number)
      return hours * 60 + minutes
    }

    const selectedDateDay = new Date(`${appointmentDraft.scheduledDate}T12:00:00`).getDay()
    if (!appointmentDays.includes(selectedDateDay)) {
      setAppError(`Ese día no está habilitado en tu agenda. Días de atención: ${appointmentDaysLabel}.`)
      return
    }
    const configuredStart = toMinutes(appointmentStartTime)
    const configuredEnd = toMinutes(appointmentEndTime)
    if (toMinutes(appointmentDraft.scheduledTime) < configuredStart || toMinutes(appointmentDraft.scheduledTime) + appointmentDraft.durationMinutes > configuredEnd) {
      setAppError(`El turno debe quedar dentro del horario de atención: ${appointmentStartTime} a ${appointmentEndTime}.`)
      return
    }
    const dayCount = appointmentCapacityByDate.get(appointmentDraft.scheduledDate) ?? 0
    const isNewAppointment = !appointmentDraft.id
    if (isNewAppointment && dayCount >= dailyPatientLimit) {
      setAppError(`Cupo completo: ya tenés ${dayCount} de ${dailyPatientLimit} pacientes para ese día.`)
      setAppNotice('No quedan turnos libres para esa fecha según tu límite diario.')
      return
    }

    const requestedStart = toMinutes(appointmentDraft.scheduledTime)
    const requestedEnd = requestedStart + appointmentDraft.durationMinutes
    const conflict = appointments.find((a) => {
      if (a.id === appointmentDraft.id || a.status === 'cancelled' || a.scheduledDate !== appointmentDraft.scheduledDate) return false
      const currentStart = toMinutes(a.scheduledTime)
      const currentEnd = currentStart + (a.durationMinutes ?? 30)
      return requestedStart < currentEnd && currentStart < requestedEnd
    })
    if (conflict) {
      setAppError(
        `Ya tenés un turno con ${conflict.patientName} el ${appointmentDraft.scheduledDate} a las ${appointmentDraft.scheduledTime} hs. Elegí otro horario.`
      )
      return
    }

    setAppointmentSaving(true)
    setAppError(null)

    try {
      const isEdit = Boolean(appointmentDraft.id)
      let finalPatientId = appointmentDraft.patientId

      if (!finalPatientId) {
        const typedName = normalizeSearchText(appointmentDraft.patientName)
        const typedDni = appointmentDraft.patientDni.trim()
        // Solo reutilizamos una ficha existente ante una coincidencia inequívoca
        // (DNI exacto, o nombre completo idéntico). Una coincidencia parcial
        // podría asociar el turno al paciente equivocado.
        const existing = patients.find((p) => {
          if (typedDni && p.dni && p.dni === typedDni) {
            return true
          }
          const fullName = normalizeSearchText(`${p.apellido}${p.nombre ? `, ${p.nombre}` : ''}`)
          return Boolean(typedName) && fullName === typedName
        })
        if (existing) {
          finalPatientId = existing.id
        } else {
          finalPatientId = crypto.randomUUID()
          // "Apellido, Nombre" se separa en sus campos reales para que la ficha
          // quede bien formada y sea buscable después.
          const rawName = appointmentDraft.patientName.trim()
          const [rawApellido, ...restName] = rawName.split(',')
          const newPatient: PatientRecord = {
            id: finalPatientId,
            ownerUserId: activeUserId,
            apellido: (rawApellido || rawName).trim(),
            nombre: restName.join(',').trim(),
            dni: appointmentDraft.patientDni.trim(),
            email: appointmentDraft.patientEmail.trim(),
            obraSocial: '',
            numeroAfiliado: '',
            plan: '',
            birthDate: '',
            edad: 0,
            diagnosticoPrincipal: appointmentDraft.reason.trim(),
            patologiasConocidas: '',
            patologiasCronicas: '',
            ultimaInternacion: '',
            cirugiasPrevias: '',
            direccion: '',
            documents: [],
            consultations: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          persistPatient(newPatient)
        }
      }

      const scheduledAt = `${appointmentDraft.scheduledDate}T${appointmentDraft.scheduledTime}:00`
      const nextRecord: AppointmentRecord = {
        id: appointmentDraft.id || crypto.randomUUID(),
        patientId: finalPatientId,
        patientName: appointmentDraft.patientName.trim(),
        patientEmail: appointmentDraft.patientEmail.trim(),
        patientDni: appointmentDraft.patientDni.trim(),
        scheduledDate: appointmentDraft.scheduledDate,
        scheduledTime: appointmentDraft.scheduledTime,
        durationMinutes: appointmentDraft.durationMinutes,
        scheduledAt,
        reason: appointmentDraft.reason.trim() || 'Consulta médica general',
        notes: appointmentDraft.notes.trim(),
        location: appointmentDraft.location.trim() || 'Consultorio médico',
        status: 'confirmed',
        createdAt: isEdit
          ? (appointments.find((a) => a.id === appointmentDraft.id)?.createdAt || new Date().toISOString())
          : new Date().toISOString(),
        createdByUserId: activeUserId,
        emailConfirmationSentAt:
          appointmentDraft.sendEmailConfirmation && appointmentDraft.patientEmail.trim()
            ? new Date().toISOString()
            : undefined,
        amountToCharge: parsedAmount ?? undefined,
        amountConcept: parsedAmount ? appointmentDraft.amountConcept : undefined,
      }

      const nextAppointments = isEdit
        ? appointments.map((a) => (a.id === nextRecord.id ? nextRecord : a))
        : [...appointments, nextRecord].sort((a, b) => appointmentSortKey(a).localeCompare(appointmentSortKey(b)))

      setAppointments(nextAppointments)
      localStorage.setItem(appointmentsStorageKey(activeUserId), JSON.stringify(nextAppointments))
      const currentProf = profile || (activeUser ? profileFromSeed(activeUser) : null)
      if (currentProf) {
        void persistWorkspaceRemote(activeUserId, currentProf, patients, nextAppointments)
      }
      if (nextAppointments.filter((appointment) => appointment.scheduledDate === nextRecord.scheduledDate && appointment.status !== 'cancelled').length >= dailyPatientLimit) {
        setAppNotice(`Cupo completo para ${nextRecord.scheduledDate}: alcanzaste ${dailyPatientLimit} pacientes.`)
      }

      if (appointmentDraft.sendEmailConfirmation && appointmentDraft.patientEmail.trim()) {
        const profName = currentProf?.fullName || (activeUser ? activeUser.fullName : 'Profesional tratante')
        const profSpecialty = currentProf?.specialty || (activeUser ? activeUser.specialty : 'Medicina General')
        void sendAppointmentEmail({
          to: appointmentDraft.patientEmail.trim(),
          patientName: appointmentDraft.patientName.trim(),
          professionalName: profName,
          specialty: profSpecialty,
          date: appointmentDraft.scheduledDate,
          time: appointmentDraft.scheduledTime,
          location: appointmentDraft.location.trim() || 'Consultorio médico',
          notes: appointmentDraft.notes.trim(),
          amountToCharge: parsedAmount ?? undefined,
          amountConcept: parsedAmount ? appointmentDraft.amountConcept : undefined,
          paymentLink: currentProf?.paymentLink?.trim() || undefined,
        }).then((res) => {
          if (res.success) {
            showSavedFloatingNotice('Turno guardado y email enviado al paciente')
          } else {
            showSavedFloatingNotice('Turno guardado')
          }
        })
      } else {
        showSavedFloatingNotice('Turno guardado con éxito')
      }

      setAppointmentModalOpen(false)
      setAppointmentDraft(emptyAppointmentDraft)
      setAppNotice(`Turno para ${nextRecord.patientName} guardado para el ${nextRecord.scheduledDate} a las ${nextRecord.scheduledTime} hs.`)
    } catch (err) {
      setAppError(`Error al guardar turno: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAppointmentSaving(false)
    }
  }

  async function handleDeleteAppointment(appointmentId: string): Promise<void> {
    if (!activeUserId) return
    const target = appointments.find((a) => a.id === appointmentId)
    if (!target) return
    if (!window.confirm(`¿Seguro que deseas cancelar y eliminar el turno de ${target.patientName}?`)) {
      return
    }
    const nextAppointments = appointments.filter((a) => a.id !== appointmentId)
    setAppointments(nextAppointments)
    localStorage.setItem(appointmentsStorageKey(activeUserId), JSON.stringify(nextAppointments))
    const currentProf = profile || (activeUser ? profileFromSeed(activeUser) : null)
    if (currentProf) {
      void persistWorkspaceRemote(activeUserId, currentProf, patients, nextAppointments)
    }
    showSavedFloatingNotice('Turno cancelado')
  }

  async function handleGenerateFixedBookingLink(): Promise<void> {
    if (!activeUserId) return
    const current = publicBookingSettings || buildDefaultPublicBookingSettings()
    if (!current) return
    if (!mercadoPagoConnected) {
      setAppError('Conectá y verificá tu cuenta de Mercado Pago antes de publicar la turnera particular.')
      return
    }
    if (Number(appointmentAmountToCharge) <= 0) {
      setAppError('Cargá el monto de la consulta antes de publicar la turnera particular.')
      return
    }
    const block = {
      ...(current.blocks[0] || {}),
      id: current.blocks[0]?.id || crypto.randomUUID(),
      label: 'Turno disponible',
      modality: 'private' as const,
      days: appointmentDays,
      startTime: appointmentStartTime,
      endTime: appointmentEndTime,
      durationMinutes: appointmentDurationMinutes,
      slotCount: calculateDailyCapacity(appointmentStartTime, appointmentEndTime, appointmentDurationMinutes),
      reason: current.blocks[0]?.reason || 'Consulta médica',
      amountToCharge: Number(appointmentAmountToCharge) > 0 ? Number(appointmentAmountToCharge) : undefined,
      amountConcept: appointmentAmountConcept,
    }
    const professionalName = profile?.fullName || activeUser?.fullName || current.professionalName || 'profesional'
    const baseSlug = buildDefaultPublicBookingSlug(professionalName, activeUserId)
    const settings = { ...current, professionalId: activeUserId, professionalName, slug: current.slug || baseSlug, enabled: true, blocks: [block] }
    setPublicBookingSaving(true)
    const result = await savePublicBookingSettings(settings)
    setPublicBookingSaving(false)
    if (!result.success || !result.settings) {
      setAppError(result.message || 'No se pudo generar el link fijo.')
      return
    }
    setPublicBookingSettings(result.settings)
    const url = buildFixedPublicBookingUrl(result.settings.slug)
    setFreeSlotGeneratedUrl(url)
    setAppNotice('Turnera pública publicada. Link fijo generado.')
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title: `Turnera de ${profile?.fullName || activeUser?.fullName || 'Dr Happy'}`, text: 'Elegí tu turno disponible:', url }).catch(() => {
        window.open(buildWhatsAppShareUrl(url, profile?.fullName || activeUser?.fullName), '_blank', 'noopener,noreferrer')
      })
    } else {
      window.open(buildWhatsAppShareUrl(url, profile?.fullName || activeUser?.fullName), '_blank', 'noopener,noreferrer')
    }
  }

  async function handleConnectMercadoPago(): Promise<void> {
    setMercadoPagoConnectionBusy(true)
    setAppError(null)
    try {
      const result = await startMercadoPagoConnection()
      if (!result.success || !result.authorizationUrl) {
        setAppError(result.message || 'No se pudo iniciar la conexión con Mercado Pago.')
        return
      }
      window.location.assign(result.authorizationUrl)
    } finally {
      setMercadoPagoConnectionBusy(false)
    }
  }

  async function handleDisconnectMercadoPago(): Promise<void> {
    if (!window.confirm('¿Desconectar tu cuenta de Mercado Pago? Los cobros futuros dejarán de usarla.')) return
    setMercadoPagoConnectionBusy(true)
    try {
      const result = await disconnectMercadoPago()
      if (!result.success) {
        setAppError(result.message || 'No se pudo desconectar Mercado Pago.')
        return
      }
      setMercadoPagoConnected(false)
      setMercadoPagoAccountEmail(null)
      setAppNotice('Cuenta de Mercado Pago desconectada.')
    } finally {
      setMercadoPagoConnectionBusy(false)
    }
  }

  async function handleVerifyMercadoPago(): Promise<void> {
    setMercadoPagoConnectionBusy(true)
    setMercadoPagoVerificationMessage(null)
    try {
      const result = await verifyMercadoPagoConnection()
      setMercadoPagoConnected(Boolean(result.success && result.connected))
      setMercadoPagoAccountEmail(result.account?.public_email ?? null)
      setMercadoPagoVerificationMessage(result.connected ? 'Conexión verificada con Mercado Pago.' : result.message || 'La conexión necesita revisión.')
    } finally {
      setMercadoPagoConnectionBusy(false)
    }
  }

  async function refreshFreeSlotLinks(): Promise<void> {
    if (!activeUserId) return
    setFreeSlotLinksLoading(true)
    try {
      const result = await listPublicBookingLinks(activeUserId)
      if (result.success && result.links) {
        setFreeSlotLinks(result.links)
      }
    } finally {
      setFreeSlotLinksLoading(false)
    }
  }

  function buildDefaultPublicBookingSettings(): PublicBookingSettings | null {
    if (!activeUserId) return null
    const currentProf = profile || (activeUser ? profileFromSeed(activeUser) : null)
    const professionalName = currentProf?.fullName || activeUser?.fullName || 'Profesional Dr Happy'
    return {
      professionalId: activeUserId,
      slug: buildDefaultPublicBookingSlug(professionalName, activeUserId),
      enabled: false,
      professionalName,
      location: '',
      reason: 'Consulta médica',
      horizonDays: 60,
      blocks: [
        {
          id: crypto.randomUUID(),
          label: 'Turno disponible',
          modality: 'private',
          days: appointmentDays.length ? appointmentDays : DEFAULT_APPOINTMENT_DAYS,
          startTime: appointmentStartTime,
          endTime: appointmentEndTime,
          durationMinutes: appointmentDurationMinutes,
          slotCount: calculateDailyCapacity(appointmentStartTime, appointmentEndTime, appointmentDurationMinutes),
          location: '',
          reason: 'Consulta médica',
        },
      ],
    }
  }

  async function refreshPublicBookingSettings(): Promise<void> {
    if (!activeUserId) return
    setPublicBookingLoading(true)
    try {
      const result = await getPublicBookingSettings(activeUserId)
      if (result.success && result.settings) {
        const existingBlock = result.settings.blocks[0]
        setPublicBookingSettings({
          ...result.settings,
          blocks: [{
            ...(existingBlock || buildDefaultPublicBookingSettings()!.blocks[0]),
            label: 'Turno disponible',
            modality: 'private',
            days: appointmentDays.length ? appointmentDays : DEFAULT_APPOINTMENT_DAYS,
            startTime: appointmentStartTime,
            endTime: appointmentEndTime,
            durationMinutes: appointmentDurationMinutes,
            slotCount: calculateDailyCapacity(appointmentStartTime, appointmentEndTime, appointmentDurationMinutes),
          }],
        })
        setAppointmentAmountToCharge(existingBlock?.amountToCharge ? String(existingBlock.amountToCharge) : '')
        setAppointmentAmountConcept(existingBlock?.amountConcept === 'consulta' ? 'consulta' : 'sena')
      } else {
        setPublicBookingSettings(buildDefaultPublicBookingSettings())
      }
    } finally {
      setPublicBookingLoading(false)
    }
  }

  function updatePublicBookingBlock(blockId: string, patch: Partial<PublicBookingAvailabilityBlock>): void {
    setPublicBookingSettings((current) => current
      ? { ...current, blocks: current.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)) }
      : current)
  }

  /* El checklist de Inicio necesita saber si la turnera pública ya está publicada. */
  useEffect(() => {
    if (!activeUserId) return
    void refreshPublicBookingSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUserId])

  function togglePublicBookingBlockDay(blockId: string, dayValue: number): void {
    setPublicBookingSettings((current) => current
      ? {
          ...current,
          blocks: current.blocks.map((block) => {
            if (block.id !== blockId) return block
            const days = block.days.includes(dayValue)
              ? block.days.filter((value) => value !== dayValue)
              : [...block.days, dayValue].sort((left, right) => left - right)
            return { ...block, days }
          }),
        }
      : current)
  }

  function removePublicBookingBlock(blockId: string): void {
    setPublicBookingSettings((current) => current
      ? { ...current, blocks: current.blocks.filter((block) => block.id !== blockId) }
      : current)
  }

  function validatePublicBookingSettings(settings: PublicBookingSettings): string | null {
    if (!settings.slug.trim()) return 'Definí el link corto de la turnera pública.'
    if (!settings.professionalName.trim()) return 'Falta el nombre visible del profesional.'
    if (settings.blocks.length === 0) return 'Agregá al menos un bloque de disponibilidad.'
    for (const block of settings.blocks) {
      if (!block.label.trim()) return 'Cada bloque necesita una etiqueta visible para el paciente.'
      if (!block.days.length) return `El bloque "${block.label}" necesita al menos un día habilitado.`
      if (block.startTime >= block.endTime) return `En "${block.label}", el horario Desde debe ser anterior a Hasta.`
      const capacity = Math.floor((parseTimeMinutes(block.endTime) - parseTimeMinutes(block.startTime)) / block.durationMinutes)
      if (block.slotCount > capacity) return `En "${block.label}" no entran ${block.slotCount} turnos de ${block.durationMinutes} min.`
      if (block.modality === 'private' && (!block.amountToCharge || block.amountToCharge <= 0)) return `En "${block.label}" cargá el monto para pacientes particulares.`
    }
    return null
  }

  async function handleSavePublicBookingSettings(): Promise<void> {
    if (!publicBookingSettings) return
    const validation = validatePublicBookingSettings(publicBookingSettings)
    if (validation) {
      setPublicBookingError(validation)
      return
    }
    setPublicBookingSaving(true)
    setPublicBookingError(null)
    setPublicBookingNotice(null)
    try {
      const result = await savePublicBookingSettings(publicBookingSettings)
      if (!result.success || !result.settings) {
        setPublicBookingError(result.message || 'No se pudo guardar la turnera pública fija.')
        return
      }
      setPublicBookingSettings(result.settings)
      setPublicBookingNotice('Turnera pública fija guardada correctamente.')
      showSavedFloatingNotice('Turnera pública guardada')
    } catch (error) {
      setPublicBookingError(`Error al guardar: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setPublicBookingSaving(false)
    }
  }

  async function handleCreateFreeSlotLink(): Promise<void> {
    if (!activeUserId) return
    if (!freeSlotDraft.slotDate || !freeSlotDraft.startTime || !freeSlotDraft.endTime || !freeSlotDraft.slotCount) {
      setFreeSlotError('Completa fecha, horario y cantidad de turnos.')
      return
    }
    const freeSlotDay = new Date(`${freeSlotDraft.slotDate}T12:00:00`).getDay()
    if (!appointmentDays.includes(freeSlotDay)) {
      setFreeSlotError(`Ese día no está habilitado. Días de atención: ${appointmentDaysLabel}.`)
      return
    }
    const occupiedOnDate = appointmentCapacityByDate.get(freeSlotDraft.slotDate) ?? 0
    const remainingCapacity = Math.max(0, dailyPatientLimit - occupiedOnDate)
    if (Number(freeSlotDraft.slotCount) > remainingCapacity) {
      setFreeSlotError(`Solo quedan ${remainingCapacity} cupos disponibles para ese día.`)
      return
    }
    if (freeSlotCapacity?.invalidRange) {
      setFreeSlotError('El horario "Hasta" debe ser posterior al horario "Desde".')
      return
    }
    if (freeSlotCapacity && !freeSlotCapacity.fits) {
      const horasNecesarias = Math.ceil((freeSlotCapacity.requiredMinutes / 60) * 100) / 100
      setFreeSlotError(
        `No entran ${freeSlotCapacity.requested} turnos de ${freeSlotDraft.durationMinutes} min en ese rango horario. ` +
          `En ${formatMinutesLabel(freeSlotCapacity.rangeMinutes)} entran como máximo ${freeSlotCapacity.maxSlots} turno(s). ` +
          `Para ${freeSlotCapacity.requested} turnos necesitás al menos ${horasNecesarias} h de rango.`
      )
      return
    }
    const rawFreeAmount = freeSlotDraft.amountToCharge.trim()
    const parsedFreeAmount = rawFreeAmount ? Number(rawFreeAmount.replace(',', '.')) : null
    if (rawFreeAmount && (!Number.isFinite(parsedFreeAmount) || (parsedFreeAmount as number) <= 0)) {
      setFreeSlotError('El monto a cobrar debe ser un número mayor a cero.')
      return
    }
    setFreeSlotSaving(true)
    setFreeSlotError(null)
    setFreeSlotGeneratedUrl(null)
    try {
      const currentProf = profile || (activeUser ? profileFromSeed(activeUser) : null)
      const result = await createPublicBookingLink({
        professionalId: activeUserId,
        professionalName: currentProf?.fullName || activeUser?.fullName,
        slotDate: freeSlotDraft.slotDate,
        startTime: freeSlotDraft.startTime,
        endTime: freeSlotDraft.endTime,
        slotCount: Number(freeSlotDraft.slotCount),
        intervalMinutes: Number(freeSlotDraft.durationMinutes),
        location: freeSlotDraft.location.trim(),
        reason: freeSlotDraft.reason.trim(),
        amountToCharge: parsedFreeAmount ?? undefined,
        amountConcept: parsedFreeAmount ? freeSlotDraft.amountConcept : undefined,
        paymentLink: parsedFreeAmount ? currentProf?.paymentLink?.trim() || undefined : undefined,
        appointmentDays,
        dailyPatientLimit,
      })
      if (!result.success || !result.token) {
        setFreeSlotError(result.message || 'No se pudo generar el enlace de turnos libres.')
        return
      }
      const url = buildPublicBookingUrl(result.token)
      setFreeSlotGeneratedUrl(url)
      void refreshFreeSlotLinks()
    } catch (err) {
      setFreeSlotError(`Error al generar el enlace: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setFreeSlotSaving(false)
    }
  }

  async function handleCancelFreeSlotLink(linkId: string): Promise<void> {
    if (!activeUserId) return
    if (!window.confirm('¿Cancelar este enlace de turnos libres? Ya no podrá usarse.')) return
    await cancelPublicBookingLink({ linkId, professionalId: activeUserId })
    void refreshFreeSlotLinks()
  }

  function handleShareFreeSlotLink(url: string): void {
    const currentProf = profile || (activeUser ? profileFromSeed(activeUser) : null)
    const professionalName = currentProf?.fullName || activeUser?.fullName
    window.open(buildWhatsAppShareUrl(url, professionalName), '_blank', 'noopener,noreferrer')
  }

  async function handleResendAppointmentEmail(record: AppointmentRecord): Promise<void> {
    if (!record.patientEmail?.trim()) {
      setAppError('El paciente no tiene un correo electrónico registrado en este turno.')
      return
    }
    setAppointmentResendingId(record.id)
    setAppError(null)
    const currentProf = profile || (activeUser ? profileFromSeed(activeUser) : null)
    const profName = currentProf?.fullName || (activeUser ? activeUser.fullName : 'Profesional tratante')
    const profSpecialty = currentProf?.specialty || (activeUser ? activeUser.specialty : 'Medicina General')
    try {
      const res = await sendAppointmentEmail({
        to: record.patientEmail.trim(),
        patientName: record.patientName,
        professionalName: profName,
        specialty: profSpecialty,
        date: record.scheduledDate,
        time: record.scheduledTime,
        location: record.location || 'Consultorio médico',
        notes: record.notes || '',
        amountToCharge: record.amountToCharge,
        amountConcept: record.amountConcept,
        paymentLink: currentProf?.paymentLink?.trim() || undefined,
      })
      if (res.success) {
        const nextAppointments = appointments.map((a) =>
          a.id === record.id ? { ...a, emailConfirmationSentAt: new Date().toISOString() } : a
        )
        setAppointments(nextAppointments)
        if (activeUserId) {
          localStorage.setItem(appointmentsStorageKey(activeUserId), JSON.stringify(nextAppointments))
          if (currentProf) {
            void persistWorkspaceRemote(activeUserId, currentProf, patients, nextAppointments)
          }
        }
        setAppNotice(`Confirmación de turno enviada con éxito a ${record.patientEmail} desde soporte@drhappy.com.ar.`)
        showSavedFloatingNotice('Email de turno enviado')
      } else {
        setAppError(`No se pudo enviar el correo: ${res.message || 'Error SMTP'}`)
      }
    } catch (err) {
      setAppError(`Fallo al enviar correo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAppointmentResendingId(null)
    }
  }

  /**
   * Marca el turno como atendido y deja constancia en la historia clínica del
   * paciente, igual que las atenciones del modo ambulancia. Luego abre la ficha
   * para que el profesional complete la evolución.
   */
  function handleStartConsultationFromAppointment(record: AppointmentRecord): void {
    const patient = patients.find((p) => p.id === record.patientId)
    if (!patient) {
      setAppError('No se encontró la ficha del paciente de este turno.')
      return
    }

    const alreadyRegistered = patient.consultations.some(
      (entry) => isAppointmentConsultation(entry) && entry.appointmentId === record.id,
    )

    if (!alreadyRegistered) {
      const entry: ConsultationEntry = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        motivoConsulta: `[TURNO] ${record.reason || 'Consulta médica'}`,
        diagnostico: record.reason || 'Consulta médica',
        detalleAtencion: [
          `Turno del ${formatShortDate(record.scheduledDate)} a las ${record.scheduledTime} hs`,
          record.location ? `Lugar: ${record.location}` : '',
          record.notes ? `Notas del turno: ${record.notes}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        pensamientoMedico: '',
        professionalSignature: {
          fullName: profile?.fullName ?? '',
          licenseNumber: profile?.licenseNumber ?? '',
          signatureText: profile?.signatureText ?? '',
          signatureImageDataUrl: profile?.signatureImage?.dataUrl,
        },
        appointmentId: record.id,
      }
      persistPatientConsultation(patient.id, entry)
    }

    if (record.status !== 'attended') {
      void markAppointmentAsAttended(record.id)
    }

    handleSelectPatient(record.patientId)
    setConsultationDraft((curr) => ({
      ...curr,
      motivoConsulta: record.reason || curr.motivoConsulta,
    }))
    setAppNotice(
      alreadyRegistered
        ? `Este turno ya figura en la historia clínica de ${patient.apellido}.`
        : `Turno registrado como evolución en la historia clínica de ${patient.apellido}.`,
    )
  }

  /** Deja el turno marcado como atendido, sin tocar el resto de sus datos. */
  async function markAppointmentAsAttended(appointmentId: string): Promise<void> {
    if (!activeUserId) return
    const nextAppointments = appointments.map((a) =>
      a.id === appointmentId ? { ...a, status: 'attended' as const } : a,
    )
    setAppointments(nextAppointments)
    localStorage.setItem(appointmentsStorageKey(activeUserId), JSON.stringify(nextAppointments))
    const currentProf = profile || (activeUser ? profileFromSeed(activeUser) : null)
    if (currentProf) {
      void persistWorkspaceRemote(activeUserId, currentProf, patients, nextAppointments)
    }
  }

  async function handleCommunityFileInput(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) {
      return
    }
    const oversized = files.filter((file) => file.size > MAX_COMMUNITY_FILE_SIZE_BYTES)
    const validFiles = files.filter((file) => file.size <= MAX_COMMUNITY_FILE_SIZE_BYTES)
    if (oversized.length > 0) {
      setAppError(
        `${oversized.length === 1 ? 'El archivo supera' : 'Algunos archivos superan'} el límite de 10MB y no ${oversized.length === 1 ? 'fue' : 'fueron'} adjuntado${oversized.length === 1 ? '' : 's'}: ${oversized.map((f) => f.name).join(', ')}`
      )
    }
    if (validFiles.length === 0) {
      event.target.value = ''
      return
    }
    try {
      const converted = await Promise.all(validFiles.map((file) => fileToStoredFile(file)))
      setCommunityDraftFiles((current) => [...current, ...converted])
      if (oversized.length === 0) {
        setAppError(null)
      }
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
    const oversized = files.filter((file) => file.size > MAX_COMMUNITY_FILE_SIZE_BYTES)
    const validFiles = files.filter((file) => file.size <= MAX_COMMUNITY_FILE_SIZE_BYTES)
    if (oversized.length > 0) {
      setAppError(
        `${oversized.length === 1 ? 'El archivo supera' : 'Algunos archivos superan'} el límite de 10MB y no ${oversized.length === 1 ? 'fue' : 'fueron'} adjuntado${oversized.length === 1 ? '' : 's'}: ${oversized.map((f) => f.name).join(', ')}`
      )
    }
    if (validFiles.length === 0) {
      return
    }
    try {
      const converted = await Promise.all(validFiles.map((file) => fileToStoredFile(file)))
      setCommunityDraftFiles((current) => [...current, ...converted])
      if (oversized.length === 0) {
        setAppError(null)
      }
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
      const result = await communityRequest({
        action: 'send',
        recipientId: nextMessage.recipientId,
        text: nextMessage.text,
        attachments: nextMessage.attachments,
      })
      if (!result.success) {
        setAppError(`No se pudo enviar el mensaje al servidor: ${result.message || 'error desconocido'}`)
        return
      }
      setCommunityMessages((current) =>
        [...current, nextMessage].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
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

    // Disparar Web Push al celular del destinatario (incluso con la app 100% cerrada)
    const currentSender = seedUsers.find((u) => u.id === activeUserId)
    const senderName = currentSender?.fullName || 'Un colega'
    const pushBody = text
      ? text.length > 90
        ? text.slice(0, 87) + '...'
        : text
      : communityDraftFiles.length > 0
        ? 'Te ha enviado un archivo adjunto'
        : 'Nuevo mensaje recibido'

    void sendServerPushNotification({
      recipientUserId: communityTargetId,
      title: `${senderName} te ha enviado un mensaje`,
      body: pushBody,
      tag: `drhappy-chat-${activeUserId}`,
    })
  }

  /** Elimina un mensaje propio del chat de comunidad, por si se envió por error. */
  async function handleDeleteCommunityMessage(messageId: string): Promise<void> {
    if (!window.confirm('¿Eliminar este mensaje?')) {
      return
    }
    if (isSupabaseConfigured && supabase) {
      const result = await communityRequest({ action: 'delete', messageId })
      if (!result.success) {
        setAppError(`No se pudo eliminar el mensaje: ${result.message || 'error desconocido'}`)
        return
      }
    } else if (activeUserId && communityTargetId) {
      const key = communityThreadStorageKey(activeUserId, communityTargetId)
      const currentThread = readJsonStorage<CommunityMessage[]>(key, [])
      const nextThread = currentThread.filter((message) => message.id !== messageId)
      localStorage.setItem(key, JSON.stringify(nextThread))
    }
    setCommunityMessages((current) => current.filter((message) => message.id !== messageId))
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
    if (isSupabaseConfigured && !passwordChangeDraft.currentPassword) {
      setAppError('Ingresa tu contraseña actual para confirmar el cambio.')
      return
    }
    if (!passwordChangeDraft.newPassword || !passwordChangeDraft.confirmPassword) {
      setAppError('Ingresa la nueva contraseña en ambos campos.')
      return
    }
    if (passwordChangeDraft.newPassword.length < 6) {
      setAppError('La nueva contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (passwordChangeDraft.newPassword !== passwordChangeDraft.confirmPassword) {
      setAppError('Las contraseñas no coinciden.')
      return
    }

    setAppError(null)
    if (isSupabaseConfigured) {
      const result = await changeProfessionalPassword({
        userId: activeUserId,
        currentPassword: passwordChangeDraft.currentPassword,
        newPassword: passwordChangeDraft.newPassword,
      })
      if (!result.success) {
        setAppError(result.message || 'No se pudo actualizar la contraseña.')
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
          ? { ...user, password: isSupabaseConfigured ? undefined : passwordChangeDraft.newPassword }
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
    setPasswordChangeDraft({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setAppNotice('Contraseña actualizada correctamente.')
    showSavedFloatingNotice()
  }

  // Auto-eliminación de la propia cuenta (requisito de Google Play).
  // Dispara el flujo completo: archivo legal + emails + baja definitiva.
  async function handleSelfDeleteAccount(): Promise<void> {
    if (!activeUser || !activeUserId) {
      setAppError('No hay una sesión activa.')
      return
    }
    if (isAdminUser(activeUser)) {
      setAppError('La cuenta de administrador no puede auto-eliminarse.')
      return
    }
    if (!selfDeleteConfirm) {
      setAppError('Marcá la casilla de confirmación para continuar con la baja.')
      return
    }
    if (!selfDeletePassword) {
      setAppError('Ingresá tu contraseña actual para confirmar la baja.')
      return
    }

    const finalConfirm = window.confirm(
      '⚠️ ÚLTIMA CONFIRMACIÓN\n\nSe eliminará tu cuenta de forma permanente junto con tus pacientes, turnos y archivos. Antes de borrarla, se generará y enviará el archivo legal únicamente a tu correo.\n\nEsta acción NO se puede deshacer. ¿Confirmás la baja definitiva?',
    )
    if (!finalConfirm) {
      return
    }

    setSelfDeleteBusy(true)
    setAppError(null)
    try {
      const result = await selfDeleteAccount({ userId: activeUserId, password: selfDeletePassword })
      if (!result.success) {
        setAppError(result.message || 'No se pudo procesar la baja.')
        return
      }
      setAppNotice('Tu cuenta fue eliminada. Recibiste el archivo legal en tu correo.')
      setSelfDeletePassword('')
      setSelfDeleteConfirm(false)
      await handleLogout()
    } catch (error) {
      setAppError(
        error instanceof Error ? `No se pudo eliminar la cuenta: ${error.message}` : 'No se pudo eliminar la cuenta.',
      )
    } finally {
      setSelfDeleteBusy(false)
    }
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

  async function handleSaveConsultation(event: FormEvent<HTMLFormElement>): Promise<void> {
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
    const signatureImageDataUrl = profile.signatureImage?.dataUrl
    // Refuerzo de firma (Nivel 1): sello con hash SHA-256 del contenido +
    // timestamp + datos del firmante, para que el documento firmado sea
    // verificable y no alterable sin que se note.
    const signatureSeal = await buildSignatureSeal({
      contentToSign: {
        patientId: selectedPatient.id,
        patientDni: selectedPatient.dni,
        motivoConsulta: nextMotivo,
        detalleAtencion: consultationDraft.detalleAtencion,
        pensamientoMedico: consultationDraft.pensamientoMedico,
        signatureImageDataUrl: signatureImageDataUrl ?? '',
      },
      signerUserId: activeUserId ?? '',
      signerFullName: profile.fullName,
      signerLicense: profile.licenseNumber,
      signerDni: activeUser?.dni,
    })
    const entry: ConsultationEntry = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      motivoConsulta: nextMotivo,
      diagnostico: nextMotivo,
      detalleAtencion: consultationDraft.detalleAtencion,
      pensamientoMedico: consultationDraft.pensamientoMedico,
      enfermedadActual: consultationDraft.enfermedadActual,
      examenFisico: consultationDraft.examenFisico,
      impresionDiagnostica: consultationDraft.impresionDiagnostica,
      planManejo: consultationDraft.planManejo,
      professionalSignature: {
        fullName: profile.fullName,
        licenseNumber: profile.licenseNumber,
        signatureText: profile.signatureText,
        signatureImageDataUrl: profile.signatureImage?.dataUrl,
      },
      signatureSeal,
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
    setAppNotice('Consulta guardada con firma electrónica (sello de integridad incluido).')
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
              const sealMarkup = entry.signatureSeal
                ? `<p style="font-size:11px; color:#166534; margin-top:6px;">🔏 Firmado electrónicamente el ${escapeHtml(formatDate(entry.signatureSeal.signedAt))} · Sello de integridad SHA-256: <span style="font-family:monospace;">${escapeHtml(entry.signatureSeal.hashSha256)}</span></p>`
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
                  ${sealMarkup}
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
    return (
      <main className="loading">
        {splashVisible ? <SplashScreen leaving={false} /> : null}
        <span style={{ position: 'absolute', bottom: 24, opacity: 0.6, fontSize: '0.8rem' }}>
          Cargando modelo clínico...
        </span>
      </main>
    )
  }

  if (!activeUser || !profile) {
    return (
      <main className="auth-layout">
        {splashVisible ? <SplashScreen leaving={splashLeaving} /> : null}
        <AuthBackground />
        <section className={`auth-card ${splashVisible ? '' : 'auth-card--entering'}`}>
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
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#6b7280', fontWeight: 500 }}>
                Herramientas para profesionales de la salud e instituciones
              </p>
            </div>
          </div>
          {!recoveryOpen ? (
            <form onSubmit={handleLogin} className="grid">
              <label>
                Usuario
                <input
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Contraseña
                <div className="password-input">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    name="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-visibility"
                    onClick={() => setShowLoginPassword((current) => !current)}
                    aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showLoginPassword ? '🙈' : '👁'}
                  </button>
                </div>
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
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(130, 153, 186, 0.3)' }}>
                <button
                  type="button"
                  className="ghost"
                  style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                  onClick={() => void handleShareApp()}
                  title="Compartir DrHappy con un colega"
                >
                  📲 Compartir con un amigo
                </button>
                <button
                  type="button"
                  className="ghost"
                  style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                  onClick={() => setContactModalOpen(true)}
                  title="Contactar con el equipo de soporte y desarrolladores"
                >
                  💬 Contactar desarrolladores
                </button>
              </div>
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
                    Te enviaremos un código de seguridad de 6 dígitos a tu casilla de correo desde <strong>soporte@drhappy.com.ar</strong> (vigente por 15 minutos).
                  </small>
                  <button type="submit">Solicitar código por Email</button>
                </form>
              ) : (
                <form className="grid" onSubmit={handleResetPassword}>
                  <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: '#0369a1', background: '#e0f2fe', padding: '8px 12px', borderRadius: 8 }}>
                    ✉️ Ingresa el código de 6 dígitos que te enviamos a <strong>{recoveryEmail}</strong>.
                  </p>
                  {!isSupabaseConfigured && recoveryDemoCode ? (
                    <p className="demo-code">
                      Código de prueba (modo local): <strong>{recoveryDemoCode}</strong>
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
                      minLength={6}
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
            <div className="drhappy-modal-overlay" onClick={() => setRegisterOpen(false)}>
              <div
                className="drhappy-modal-card register-modal-card"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="register-modal-title"
              >
                <div className="drhappy-modal-header">
                  <h2 id="register-modal-title">Nuevo profesional</h2>
                  <button type="button" className="ghost compact" onClick={() => setRegisterOpen(false)} aria-label="Cerrar registro">×</button>
                </div>
                <form className="grid register-form" onSubmit={handleCreateUser}>
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
                DNI
                <input
                  name="dni"
                  value={registerDraft.dni}
                  onChange={handleRegisterFieldChange}
                  inputMode="numeric"
                  pattern="[0-9. -]+"
                  required
                />
              </label>
              <label>
                Profesión
                <select
                  name="specialty"
                  value={registerDraft.specialty}
                  onChange={handleRegisterFieldChange}
                  required
                >
                  <option value="">Seleccioná tu profesión</option>
                  <option value="Médico">Médico</option>
                  <option value="Odontólogo">Odontólogo</option>
                  <option value="Psicólogo">Psicólogo</option>
                </select>
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
                  aria-describedby="register-email-status"
                  required
                />
                {registerDraft.email.trim() ? (
                  <small
                    id="register-email-status"
                    className={registerEmailExists ? 'field-status error' : 'field-status available'}
                    aria-live="polite"
                  >
                    {registerEmailExists
                      ? 'Ese email ya está asociado a otro usuario.'
                      : 'Email disponible. Se sugerirá también como nombre de usuario.'}
                  </small>
                ) : null}
              </label>
              <label>
                Usuario
                <input
                  name="username"
                  value={registerDraft.username}
                  onChange={handleRegisterFieldChange}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  aria-describedby="register-username-status"
                  required
                />
                {registerDraft.username.trim() ? (
                  <small
                    id="register-username-status"
                    className={registerUsernameExists ? 'field-status error' : 'field-status available'}
                    aria-live="polite"
                  >
                    {registerUsernameExists
                      ? 'Ese nombre de usuario ya existe.'
                      : 'Nombre de usuario disponible. Se guardará en minúsculas.'}
                  </small>
                ) : null}
              </label>
              <label>
                Contraseña
                <div className="password-input">
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    name="password"
                    value={registerDraft.password}
                    onChange={handleRegisterFieldChange}
                    minLength={6}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-visibility"
                    onClick={() => setShowRegisterPassword((current) => !current)}
                    aria-label={showRegisterPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showRegisterPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showRegisterPassword ? '🙈' : '👁'}
                  </button>
                </div>
                <small>Mínimo 6 caracteres.</small>
              </label>
                  <button type="submit">Guardar usuario</button>
                </form>
              </div>
            </div>
          ) : null}
        </section>
        {floatingNotice ? <div className="floating-toast">{floatingNotice}</div> : null}
        {contactModalOpen ? (
          <div className="drhappy-modal-overlay" onClick={() => setContactModalOpen(false)}>
            <div
              className="drhappy-modal-card"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="contact-modal-title-login"
            >
              <div className="drhappy-modal-header">
                <h3 id="contact-modal-title-login" style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>
                  💬 Contactar con los desarrolladores
                </h3>
                <button
                  type="button"
                  className="drhappy-modal-close-btn"
                  onClick={() => setContactModalOpen(false)}
                  aria-label="Cerrar ventana"
                >
                  ✕
                </button>
              </div>
              <div className="drhappy-modal-body">
                <p style={{ margin: '0 0 16px', color: '#475569', fontSize: '0.92rem', lineHeight: 1.5 }}>
                  Para recibir soporte, escribinos a soporte@drhappy.com.ar.
                </p>
                <div className="drhappy-contact-options">
                  <a
                    href="mailto:soporte@drhappy.com.ar"
                    className="drhappy-contact-btn email"
                  >
                    <span className="contact-icon">✉️</span>
                    <div>
                      <strong>Enviar correo electrónico a Soporte</strong>
                      <small>soporte@drhappy.com.ar (Canal oficial)</small>
                    </div>
                  </a>

                </div>
              </div>
              <div className="drhappy-modal-footer">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setContactModalOpen(false)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    )
  }

  // ── Pantalla de acceso vencido ────────────────────────────────────────────
  if (trialInfo?.expired || previewTrialExpired) {
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
              : <>Los <strong>7 días</strong> de prueba gratuita de <strong>Dr Happy 😊</strong> terminaron. Tus datos siguen guardados.</>
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

  /* Primeros pasos: guía de activación que desaparece sola al completarse. */
  const onboardingSteps = [
    {
      key: 'patient',
      label: 'Cargá tu primer paciente',
      hint: 'Empezá tu base clínica',
      done: patients.length > 0,
      action: handleStartAttentionFlow,
    },
    {
      key: 'mercado-pago',
      label: 'Vinculá tu cuenta con Mercado Pago',
      hint: 'Los pacientes pagan directamente en tu cuenta',
      done: mercadoPagoConnected,
      action: handleOpenProfile,
    },
    {
      key: 'profile',
      label: 'Completá tus datos profesionales',
      hint: 'Nombre, matrícula y datos de contacto',
      done: Boolean(profile?.fullName && profile?.email && profile?.licenseNumber),
      action: handleOpenProfile,
    },
  ]
  const onboardingDone = onboardingSteps.filter((step) => step.done).length

  /* En móvil la navegación se resuelve con esta botonera de Inicio en lugar de la barra lateral. */
  const homeQuickActions: Array<{
    key: string
    icon: string
    label: string
    hint: string
    tone: string
    wide?: boolean
    badge?: number
    onClick: () => void
  }> = [
    isModuleEnabled('ambulance') ? {
      key: 'ambulance', icon: '🚑', label: 'Modo Ambulancia', hint: 'Traslados y guardia', tone: '#15945f', wide: true,
      onClick: handleOpenAmbulance,
    } : null,
    isModuleEnabled('attention') ? {
      key: 'attention', icon: '🩺', label: 'Atención médica', hint: 'Buscar y atender', tone: '#2563eb',
      onClick: handleStartAttentionFlow,
    } : null,
    isModuleEnabled('appointments') ? {
      key: 'appointments', icon: '📅', label: 'Turnera', hint: 'Agenda y cupos', tone: '#d97706',
      onClick: handleOpenAppointments,
    } : null,
    {
      key: 'patients', icon: '👥', label: 'Mis pacientes', hint: `${patients.length} fichas`, tone: '#0891b2',
      onClick: () => { stopDictation(); setCommunityOpen(false); setWorkspaceLayer('my-patients'); setAppError(null) },
    },
    isModuleEnabled('tools') ? {
      key: 'tools', icon: '💊', label: normalizeSearchText(activeUser?.specialty || profile?.specialty || '').includes('psic') ? 'Vademécum' : 'Herramientas', hint: normalizeSearchText(activeUser?.specialty || profile?.specialty || '').includes('psic') ? 'Consulta farmacológica' : 'Protocolos y vademécum', tone: '#7c3aed',
      onClick: handleOpenTools,
    } : null,
    canUseTreatmentLedger ? {
      key: 'ledger', icon: '💰', label: 'Balance', hint: 'Deudas y cobros', tone: '#dc2626',
      onClick: () => { handleOpenAppointments(); setTurneraViewMode('ledger') },
    } : null,
    {
      key: 'profile', icon: '👤', label: 'Perfil', hint: 'Firma y ajustes', tone: '#4f46e5',
      onClick: handleOpenProfile,
    },
    isAdminSession ? {
      key: 'admin', icon: '⚙️', label: 'Administrar', hint: 'Usuarios y planes', tone: '#64748b',
      onClick: handleOpenUserAdmin,
    } : null,
    {
      key: 'theme', icon: themeMode === 'night' ? '☀️' : '🌙', label: themeMode === 'night' ? 'Modo claro' : 'Modo nocturno', hint: 'Cambiar contraste', tone: '#0f766e',
      onClick: handleToggleThemeMode,
    },
    {
      key: 'logout', icon: '🚪', label: 'Cerrar sesión', hint: 'Salir de la cuenta', tone: '#9f1239',
      onClick: () => { void handleLogout() },
    },
  ].filter((action): action is NonNullable<typeof action> => action !== null)

  /* Encabezado compartido de Herramientas: lo reusa la pestaña Comunidad, que se
     renderiza antes en el árbol pero debe verse como una sección más de esa página. */
  const toolsPageHeader = (
    <>
      <section className="panel layer-header">
        <div>
          <h2>Herramientas clínicas y protocolos</h2>
          <p className="flow-hint">Guías de emergencia, conducta terapéutica y vademécum profesional.</p>
        </div>
        <button type="button" className="ghost" onClick={handleBackToOverview}>
          Volver
        </button>
      </section>

      <nav className="screen-action-bar" aria-label="Secciones de herramientas">
        {!(normalizeSearchText(activeUser?.specialty || profile?.specialty || '').includes('psic') || normalizeSearchText(activeUser?.specialty || profile?.specialty || '').includes('odont')) ? (
          <button
            type="button"
            className={`screen-action${toolsActiveTab === 'protocols' ? ' active' : ''}`}
            onClick={() => handleSelectToolsTab('protocols')}
          >
            <span aria-hidden="true">📖</span> Guías y Protocolos
          </button>
        ) : null}
        <button
          type="button"
          className={`screen-action${toolsActiveTab === 'vademecum' ? ' active' : ''}`}
          onClick={() => handleSelectToolsTab('vademecum')}
        >
          <span aria-hidden="true">💊</span> Vademécum
        </button>
        {!(normalizeSearchText(activeUser?.specialty || profile?.specialty || '').includes('psic') || normalizeSearchText(activeUser?.specialty || profile?.specialty || '').includes('odont')) ? (
          <button
            type="button"
            className={`screen-action${toolsActiveTab === 'consult' ? ' active' : ''}`}
            onClick={() => handleSelectToolsTab('consult')}
          >
            <span aria-hidden="true">🩺</span> Patologías en consultorio
          </button>
        ) : null}
      </nav>
    </>
  )

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
                Sesión iniciada como: {googleIdentity.email}
              </p>
            ) : null}
          </div>
        </div>
        <div className="topbar-actions">
          {googleIdentity ? (
            <button type="button" className="google-session-chip" title="Perfil y ajustes" onClick={handleOpenProfile}>
              {googleIdentity.avatarUrl ? (
                <img src={googleIdentity.avatarUrl} alt={googleIdentity.fullName ?? googleIdentity.email} />
              ) : (
                <span>{(googleIdentity.fullName ?? googleIdentity.email).slice(0, 1).toUpperCase()}</span>
              )}
            </button>
          ) : null}
          {isAdminSession ? <span className="build-badge compact">Compilación {APP_BUILD_ID}</span> : null}
          {trialInfo?.status === 'active' && Number.isFinite(trialInfo.daysLeft) && (
            <span className={`subscription-status plan-chip${trialInfo.daysLeft <= 7 ? ' warn' : ' ok'}`}>
              <span className="plan-chip-copy">
                <strong>{trialInfo.daysLeft <= 0 ? 'Suscripción vencida' : 'Suscripción activa'}</strong>
                <small>
                  {trialInfo.daysLeft <= 0
                    ? 'Renovala para seguir usando la app'
                    : `Quedan ${trialInfo.daysLeft} día${trialInfo.daysLeft === 1 ? '' : 's'}`}
                </small>
              </span>
              {trialInfo.daysLeft <= 7 && (
                <button type="button" className="plan-chip-cta" onClick={() => setPreviewTrialExpired(true)}>
                  Renovar
                </button>
              )}
            </span>
          )}
          {trialInfo?.status === 'trial' && (
            <span className={`subscription-status plan-chip${trialInfo.daysLeft <= 2 ? ' danger' : ' warn'}`}>
              <span className="plan-chip-copy">
                <strong>Prueba gratis</strong>
                <small>
                  {trialInfo.daysLeft === 0
                    ? 'Último día'
                    : `${trialInfo.daysLeft} de 7 días restantes`}
                </small>
              </span>
              <button type="button" className="plan-chip-cta" onClick={() => setPreviewTrialExpired(true)}>
                Suscribir
              </button>
            </span>
          )}
          <button type="button" className="ghost theme-toggle" onClick={handleToggleThemeMode}>
            {themeMode === 'night' ? 'Modo claro' : 'Modo nocturno'}
          </button>
          <button type="button" className="ghost" onClick={handleBackToOverview}>
            Inicio
          </button>
          {isModuleEnabled('appointments') ? (
            <button
              type="button"
              className={`ghost ${workspaceLayer === 'appointments' ? 'active' : ''}`}
              onClick={handleOpenAppointments}
              title="Turnera médica y citas programadas"
            >
              📅 Turnera
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={handleOpenProfile}>
            Perfil
          </button>
          {isModuleEnabled('tools') ? (
            <button type="button" className="ghost" onClick={handleOpenTools}>
              Herramientas
            </button>
          ) : null}
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
          <button
            type="button"
            className="ghost"
            onClick={() => setContactModalOpen(true)}
            title="Contactar al equipo de soporte y desarrolladores"
          >
            💬 Contactar
          </button>
          <button type="button" className="ghost sofia-nav-button" onClick={() => setSofiaOpen(true)} title="Abrir a Sofía, tu secretaria clínica">
            ✦ Sofía
          </button>
          <button type="button" className="ghost" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}`} aria-label="Navegación principal">
        <div className="app-sidebar-header">
          <div>
            <span className="sidebar-eyebrow">Espacio profesional</span>
            <strong>{profile.fullName}</strong>
          </div>
          <button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Cerrar navegación">
            ×
          </button>
        </div>
        <button type="button" className="sidebar-sofia" onClick={() => { setSofiaOpen(true); setSidebarOpen(false) }}>
          <span aria-hidden="true">✨</span>
          <span className="sidebar-sofia-copy">
            <strong>Sofía</strong>
            <small>Tu secretaria clínica</small>
          </span>
        </button>
        <nav className="sidebar-nav">
          {isModuleEnabled('ambulance') ? (
            <label className="sidebar-toggle-row ambulance-sidebar-item">
              <span><b>🚑</b> Modo Ambulancia</span>
              <input type="checkbox" checked={workspaceLayer === 'ambulance'} onChange={(event) => event.target.checked ? handleOpenAmbulance() : handleBackToOverview()} />
              <span className="sidebar-switch" aria-hidden="true" />
            </label>
          ) : null}
          <button type="button" className={workspaceLayer === 'overview' ? 'active' : ''} onClick={() => { handleBackToOverview(); setSidebarOpen(false) }}>
            <span>🏠</span> Inicio
          </button>
          <button type="button" className={workspaceLayer === 'my-patients' ? 'active' : ''} onClick={() => { setWorkspaceLayer('my-patients'); setSidebarOpen(false) }}>
            <span>👥</span> Mis pacientes <small>{patients.length}</small>
          </button>
          {isModuleEnabled('appointments') ? (
            <button type="button" className={workspaceLayer === 'appointments' ? 'active' : ''} onClick={() => { handleOpenAppointments(); setSidebarOpen(false) }}>
              <span>📅</span> Turnera
            </button>
          ) : null}
          {isModuleEnabled('tools') ? (
            <button type="button" className={workspaceLayer === 'tools' ? 'active' : ''} onClick={() => { handleOpenTools(); setSidebarOpen(false) }}>
              <span>🧰</span> Herramientas {communityUnreadCount > 0 ? <small>{communityUnreadCount}</small> : null}
            </button>
          ) : null}
          {canUseTreatmentLedger ? (
            <button type="button" className={workspaceLayer === 'appointments' && turneraViewMode === 'ledger' ? 'active' : ''} onClick={() => { handleOpenAppointments(); setTurneraViewMode('ledger'); setSidebarOpen(false) }}>
              <span>💰</span> Balance de pagos
            </button>
          ) : null}
          {isAdminSession ? (
            <button type="button" className={workspaceLayer === 'user-admin' ? 'active' : ''} onClick={() => { handleOpenUserAdmin(); setSidebarOpen(false) }}>
              <span>⚙️</span> Administrar usuarios
            </button>
          ) : null}
        </nav>
        <div className="sidebar-footer">
          <button type="button" onClick={() => { handleOpenProfile(); setSidebarOpen(false) }}>
            <span>👤</span> {googleIdentity ? 'Perfil' : 'Perfil y ajustes'}
          </button>
          <button type="button" onClick={() => { handleToggleThemeMode(); setSidebarOpen(false) }}>
            <span>{themeMode === 'night' ? '☀️' : '🌙'}</span> {themeMode === 'night' ? 'Modo claro' : 'Modo nocturno'}
          </button>
          <button type="button" onClick={handleLogout}><span>🚪</span> Cerrar sesión</button>
        </div>
      </aside>
      {sidebarOpen ? <button type="button" className="sidebar-scrim" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} /> : null}
      <button
        type="button"
        className={`sidebar-handle${sidebarOpen ? ' open' : ''}`}
        aria-label={sidebarOpen ? 'Cerrar navegación' : 'Abrir navegación'}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((current) => !current)}
      >
        <span className="sidebar-handle-arrow" aria-hidden="true">{sidebarOpen ? '‹' : '›'}</span>
        <span className="sidebar-handle-label" aria-hidden="true">Menú</span>
      </button>

      {/* Solo visible en móvil: reemplaza a la barra lateral como navegación principal. */}
      <nav className="mobile-tabbar" aria-label="Navegación rápida">
        <button
          type="button"
          className={workspaceLayer === 'overview' ? 'active' : ''}
          onClick={handleBackToOverview}
        >
          <span aria-hidden="true">🏠</span> Inicio
        </button>
        <button
          type="button"
          className={workspaceLayer === 'appointments' ? 'active' : ''}
          onClick={handleOpenAppointments}
        >
          <span aria-hidden="true">📅</span> Turnos
        </button>
        <button type="button" className="mobile-tab-sofia" onClick={() => setSofiaOpen(true)}>
          <span className="sofia-face" aria-hidden="true" /> Sofía IA
        </button>
        <button
          type="button"
          className={workspaceLayer === 'my-patients' || workspaceLayer === 'patient-search' || workspaceLayer === 'patient-record' ? 'active' : ''}
          onClick={() => { stopDictation(); setCommunityOpen(false); setWorkspaceLayer('my-patients'); setAppError(null) }}
        >
          <span aria-hidden="true">👥</span> Pacientes
        </button>
        <button
          type="button"
          className={workspaceLayer === 'profile' ? 'active' : ''}
          onClick={handleOpenProfile}
        >
          <span aria-hidden="true">👤</span> Perfil
        </button>
      </nav>

      {appError ? <p className="error">{appError}</p> : null}
      {appNotice ? <p className="notice">{appNotice}</p> : null}

      {workspaceLayer === 'tools' && toolsActiveTab === 'community' ? (
        <div className="screen-stage">
          {toolsPageHeader}
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
                      <div className="community-message-footer">
                        <small>{formatDate(message.sentAt)}</small>
                        {mine ? (
                          <button type="button" className="ghost compact" onClick={() => void handleDeleteCommunityMessage(message.id)}>
                            🗑️ Borrar
                          </button>
                        ) : null}
                      </div>
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
        </div>
      ) : null}

      {workspaceLayer === 'user-admin' ? (
        <div className="screen-stage">
          <section className="panel admin-users-panel">
            <div className="panel-header">
              <div>
                <h2>Administración clínica y suscripciones</h2>
                <p className="flow-hint">
                  Desde aquí puedes gestionar accesos y suscripciones de los profesionales.
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
            </div>

            <nav className="screen-action-bar" aria-label="Secciones de administración">
              <button type="button" className={`screen-action${adminSection === 'usuarios' ? ' active' : ''}`} onClick={() => setAdminSection('usuarios')}>
                <span aria-hidden="true">👥</span> Usuarios y planes
              </button>
              <button type="button" className={`screen-action${adminSection === 'actividad' ? ' active' : ''}`} onClick={() => setAdminSection('actividad')}>
                <span aria-hidden="true">📈</span> Actividad
              </button>
              <button type="button" className={`screen-action${adminSection === 'sofia' ? ' active' : ''}`} onClick={() => setAdminSection('sofia')}>
                <span aria-hidden="true">✨</span> Consumo de Sofía
              </button>
              <button type="button" className={`screen-action${adminSection === 'comunicados' ? ' active' : ''}`} onClick={() => setAdminSection('comunicados')}>
                <span aria-hidden="true">📢</span> Comunicados
              </button>
              <button type="button" className={`screen-action${adminSection === 'correo' ? ' active' : ''}`} onClick={() => setAdminSection('correo')}>
                <span aria-hidden="true">📧</span> Correo
              </button>
            </nav>

            {/* Métricas de uso por usuario — solo conteos y fechas, sin datos clínicos */}
            {adminSection === 'actividad' ? (
            <section style={{ marginBottom: 24 }}>
              <div className="panel-header" style={{ marginBottom: 12 }}>
                <div>
                  <h3>Actividad de usuarios</h3>
                  <p className="flow-hint">
                    Estadísticas de uso por profesional. Solo conteos y fechas — sin datos clínicos ni de pacientes.
                  </p>
                </div>
              </div>
              {adminUserStatsLoading ? (
                <div className="skeleton-block">
                  <div className="skeleton-line wide" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              ) : adminUserStats.length === 0 ? (
                <p className="flow-hint">No hay métricas disponibles todavía.</p>
              ) : (
                <div className="admin-table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '2px solid #d8e2ee' }}>
                        <th style={{ padding: '8px 6px' }}>Profesional</th>
                        <th style={{ padding: '8px 6px' }}>Email</th>
                        <th style={{ padding: '8px 6px' }}>Especialidad</th>
                        <th style={{ padding: '8px 6px' }}>Pacientes</th>
                        <th style={{ padding: '8px 6px' }}>Turnos</th>
                        <th style={{ padding: '8px 6px' }}>Último acceso</th>
                        <th style={{ padding: '8px 6px' }}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...adminUserStats]
                        .sort((a, b) => (b.patientsCount + b.appointmentsCount) - (a.patientsCount + a.appointmentsCount))
                        .map((u) => (
                          <tr key={u.id} style={{ borderBottom: '1px solid #eef2f7' }}>
                            <td style={{ padding: '8px 6px' }}>
                              <strong>{u.fullName}</strong>
                              <span style={{ display: 'block', fontSize: '0.78rem', color: '#667' }}>@{u.username}</span>
                            </td>
                            <td style={{ padding: '8px 6px' }}>{u.email}</td>
                            <td style={{ padding: '8px 6px' }}>{u.specialty || '—'}</td>
                            <td style={{ padding: '8px 6px', textAlign: 'center' }}>{u.patientsCount}</td>
                            <td style={{ padding: '8px 6px', textAlign: 'center' }}>{u.appointmentsCount}</td>
                            <td style={{ padding: '8px 6px' }}>
                              {u.lastSeenAt ? formatDate(u.lastSeenAt) : 'Nunca'}
                            </td>
                            <td style={{ padding: '8px 6px' }}>
                              <span className={u.active === false ? 'status-off' : 'status-on'}>
                                {u.active === false ? 'Inactivo' : 'Activo'}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            ) : null}

            {adminSection === 'sofia' ? (
            <section style={{ marginBottom: 24 }}>
              <div className="panel-header" style={{ marginBottom: 12 }}>
                <div>
                  <h3>Consumo de Sofía</h3>
                  <p className="flow-hint">Vista privada del administrador. Los profesionales no ven estos datos.</p>
                </div>
              </div>
              <div className="analytics-summary-grid" style={{ margin: '0 0 14px' }}>
                <article className="analytics-stat-card"><strong>{adminAITotal.requests}</strong><span>Consultas a Sofía</span></article>
                <article className="analytics-stat-card"><strong>{adminAITotal.tokens.toLocaleString('es-AR')}</strong><span>Tokens usados</span></article>
                <article className="analytics-stat-card warn"><strong>USD {adminAITotal.costUsd.toFixed(4)}</strong><span>Costo estimado</span></article>
              </div>
              {adminAIUsageLoading ? (
                <div className="skeleton-block">
                  <div className="skeleton-line wide" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              ) : adminAIUsage.length === 0 ? <p className="flow-hint">Todavía no hay consumo registrado.</p> : (
                <div className="admin-table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #d8e2ee' }}><th style={{ padding: '8px 6px' }}>Profesional</th><th style={{ padding: '8px 6px' }}>Consultas</th><th style={{ padding: '8px 6px' }}>Tokens</th><th style={{ padding: '8px 6px' }}>Costo estimado</th><th style={{ padding: '8px 6px' }}>Último uso</th></tr></thead>
                    <tbody>{adminAIUsage.map((item) => <tr key={item.professionalId} style={{ borderBottom: '1px solid #eef2f7' }}><td style={{ padding: '8px 6px' }}><strong>{item.fullName}</strong><span style={{ display: 'block', fontSize: '.78rem', color: '#667' }}>@{item.username}</span></td><td style={{ padding: '8px 6px', textAlign: 'center' }}>{item.requests}</td><td style={{ padding: '8px 6px' }}>{item.totalTokens.toLocaleString('es-AR')}</td><td style={{ padding: '8px 6px' }}>USD {item.estimatedCostUsd.toFixed(4)}</td><td style={{ padding: '8px 6px' }}>{item.lastUsedAt ? formatDate(item.lastUsedAt) : 'Nunca'}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
            ) : null}

            {adminSection === 'usuarios' ? (
            <>
            <label className="admin-user-search">
              Buscar profesional
              <input
                type="search"
                value={adminUserQuery}
                onChange={(event) => setAdminUserQuery(event.target.value)}
                placeholder="Nombre, usuario, especialidad o email"
              />
            </label>
            <ul className="admin-user-list">
              {[...seedUsers]
                .filter((user) => {
                  const query = adminUserQuery.trim().toLowerCase()
                  if (!query) return true
                  return [user.fullName, user.username, user.specialty, user.email]
                    .some((field) => (field ?? '').toLowerCase().includes(query))
                })
                .sort((left, right) => left.fullName.localeCompare(right.fullName, 'es'))
                .map((user) => {
                  const expanded = adminExpandedUserId === user.id
                  return (
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
                          className={`screen-action${expanded ? ' active' : ''}`}
                          aria-expanded={expanded}
                          onClick={() => setAdminExpandedUserId(expanded ? null : user.id)}
                        >
                          <span aria-hidden="true">{expanded ? '✕' : '⚙️'}</span> {expanded ? 'Cerrar' : 'Gestionar'}
                        </button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="admin-user-detail">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void handleToggleUserActive(user.id)}
                          disabled={isAdminUser(user) || adminBusyUserId === user.id}
                        >
                          {user.active === false ? 'Activar acceso' : 'Desactivar acceso'}
                        </button>
                      </div>
                    ) : null}

                    {expanded && !isAdminUser(user) ? (
                      <div className="admin-modules-box">
                        <strong className="admin-modules-title">Módulos habilitados</strong>
                        <div className="admin-modules-grid">
                          {APP_MODULES.map((module) => {
                            const enabled = (
                              user.enabledModules ??
                              ALL_APP_MODULE_IDS.filter((entry) => !OPT_IN_APP_MODULE_IDS.includes(entry))
                            ).includes(module.id)
                            return (
                              <label key={module.id} className="admin-module-option" title={module.description}>
                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  disabled={adminBusyUserId === user.id}
                                  onChange={() => void handleAdminToggleModule(user.id, module.id)}
                                />
                                <span>{module.label}</span>
                              </label>
                            )
                          })}
                        </div>
                        <small className="admin-modules-hint">
                          Perfil y Cerrar sesión siempre quedan visibles. Si desactivás todos, el usuario solo verá su perfil.
                        </small>
                      </div>
                    ) : null}

                    {expanded && !isAdminUser(user) ? (
                      <div className="admin-subscription-actions">
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
                          {adminBusyUserId === user.id ? 'Procesando...' : 'Eliminar usuario definitivamente'}
                        </button>
                      </div>
                    ) : null}
                  </li>
                  )
                })}
            </ul>
            </>
            ) : null}

            {adminSection === 'comunicados' ? (
            <section className="panel" style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <h3 style={{ margin: 0 }}>📢 Centro de Notificaciones Push y Comunicados</h3>
                <span
                  style={{
                    background: '#e0f2fe',
                    color: '#0369a1',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 20,
                  }}
                >
                  📱 Dispositivos suscritos:{' '}
                  {adminPushCount !== null ? adminPushCount : 'Consultando...'}
                </span>
              </div>
              <p className="flow-hint" style={{ marginTop: 8 }}>
                Envía alertas push de alta prioridad y mensajes directos a profesionales con sesión iniciada o con la app instalada en su celular (incluso con la app cerrada).
              </p>
              <div className="grid" style={{ marginTop: 12 }}>
                <label>
                  Destinatarios
                  <select
                    value={adminBroadcastTarget}
                    onChange={(event) => setAdminBroadcastTarget(event.target.value)}
                  >
                    <option value="all">📢 Todos los profesionales (Difusión global)</option>
                    <optgroup label="Usuario específico">
                      {seedUsers
                        .filter((u) => u.id !== activeUser.id)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            👤 {u.fullName} (@{u.username}) · {u.specialty}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </label>
                <label>
                  Asunto o título de la notificación
                  <input
                    value={adminBroadcastSubject}
                    onChange={(event) => setAdminBroadcastSubject(event.target.value)}
                    placeholder="Ej: Novedades DrHappy / Aviso importante de guardia"
                  />
                </label>
                <label>
                  Mensaje del comunicado o notificación
                  <textarea
                    value={adminBroadcastBody}
                    onChange={(event) => setAdminBroadcastBody(event.target.value)}
                    placeholder="Escribe el mensaje que llegará como notificación push y en la bandeja de comunidad..."
                    rows={3}
                  />
                </label>
                <label className="toggle-option" style={{ margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={adminBroadcastSendEmail}
                    onChange={(e) => setAdminBroadcastSendEmail(e.target.checked)}
                  />
                  <span className="toggle-switch" aria-hidden="true" />
                  <span>📧 Enviar también por correo electrónico institucional desde <strong>soporte@drhappy.com.ar</strong></span>
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={adminBroadcastSending || !adminBroadcastBody.trim()}
                    onClick={() => void handleSendAdminBroadcast()}
                  >
                    {adminBroadcastSending
                      ? 'Enviando comunicado...'
                      : adminBroadcastTarget === 'all'
                        ? '🚀 Enviar Notificación Push y Email a Todos'
                        : '📩 Enviar Notificación Push y Email al Usuario'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={adminTestingPush}
                    onClick={() => void handleTestDevicePush()}
                    title="Envía una notificación push real desde el servidor a este dispositivo"
                  >
                    {adminTestingPush ? 'Enviando prueba push...' : '📲 Probar Push en mi celular/PC'}
                  </button>
                </div>
              </div>
            </section>
            ) : null}

            {adminSection === 'correo' ? (
            <section className="panel" style={{ marginTop: 20 }}>
              <h3>📧 Servidor de Correo Institucional (soporte@drhappy.com.ar)</h3>
              <p className="flow-hint">
                Conexión configurada con el servidor SMTP de Hostinger (<code>smtp.hostinger.com:465</code> con TLS/SSL) para envíos de bienvenida, recuperación de contraseñas y turnos.
              </p>
              <div className="grid" style={{ marginTop: 12 }}>
                <label>
                  Probar envío de correo a una casilla:
                  <input
                    type="email"
                    value={adminTestEmailAddress}
                    onChange={(e) => setAdminTestEmailAddress(e.target.value)}
                    placeholder={activeUser ? activeUser.email : 'tu-correo@ejemplo.com'}
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="ghost"
                    disabled={adminTestingEmail}
                    onClick={() => void handleTestEmail()}
                  >
                    {adminTestingEmail ? 'Enviando correo de prueba...' : '✉️ Enviar correo de prueba con Hostinger SMTP'}
                  </button>
                </div>
              </div>
            </section>
            ) : null}
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'tools' ? (
        <div className="screen-stage">
          {toolsActiveTab === 'community' ? null : (
            <>
              {toolsPageHeader}

              <section className="workspace single-column">
                {toolsActiveTab === 'protocols' ? (
              <section className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading, #1e3a8a)' }}>Protocolos Clínicos de Urgencia</h3>
                    <small style={{ color: '#64748b' }}>
                      Algoritmos de decisión rápida, ventanas terapéuticas, dosis y pronóstico basado en evidencia.
                    </small>
                  </div>
                  <div className="protocol-category-pills">
                    {protocolCategories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        className={`protocol-category-pill ${protocolCategoryFilter === cat.id ? 'active' : ''}`}
                        onClick={() => setProtocolCategoryFilter(cat.id)}
                      >
                        <span>{cat.label}</span>
                        <span className="pill-count">{cat.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontWeight: 600 }}>
                    Buscar patología, código CIE-10 o signo de sospecha
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        value={protocolSearchQuery}
                        onChange={(event) => setProtocolSearchQuery(event.target.value)}
                        placeholder="Ej: pediatría, pals, asma, bronquiolitis, crup, sepsis, convulsión, deshidratación, iam, acv..."
                        style={{ flex: 1 }}
                      />
                      {protocolSearchQuery ? (
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={() => setProtocolSearchQuery('')}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          ✕ Limpiar
                        </button>
                      ) : null}
                    </div>
                  </label>
                </div>

                {protocolCopiedNotice ? (
                  <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '10px 14px', borderRadius: 8, marginTop: 12, fontSize: '0.9rem', fontWeight: 600 }}>
                    {protocolCopiedNotice}
                  </div>
                ) : null}

                <div className="protocol-cards-grid">
                  {filteredProtocols.length === 0 ? (
                    <p style={{ gridColumn: '1 / -1', color: '#64748b', textAlign: 'center', padding: '32px 0' }}>
                      No se encontraron protocolos con ese criterio de búsqueda.
                    </p>
                  ) : (
                    filteredProtocols.map((protocol) => (
                      <article
                        key={protocol.id}
                        className="protocol-card-item"
                        onClick={() => {
                          setSelectedProtocolId(protocol.id)
                          setSelectedProtocolTab('prehospital')
                          setWorkspaceLayer('protocol-detail')
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span className="protocol-badge-category">{protocol.category}</span>
                          <span className={protocol.severity.includes('Roja') || protocol.severity.includes('Crítica') ? 'protocol-badge-red' : 'protocol-badge-yellow'}>
                            {protocol.severity}
                          </span>
                        </div>
                        <h4 style={{ margin: '2px 0 0', color: '#1e3a8a', fontSize: '1.05rem', lineHeight: 1.35 }}>
                          {protocol.title}
                        </h4>
                        <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
                          CIE-10: {protocol.cie10}
                        </span>
                        <p style={{ margin: '2px 0', fontSize: '0.87rem', color: '#334155', lineHeight: 1.45, flex: 1 }}>
                          {protocol.summary}
                        </p>
                        <div style={{ background: 'var(--surface-muted, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, padding: '8px 10px', fontSize: '0.82rem', color: '#475569' }}>
                          <strong style={{ color: 'var(--text-heading, #0f172a)' }}>🚨 Sospecha prehospitalaria clave:</strong>
                          <div style={{ marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {protocol.prehospitalManifestations.keySigns[0]}
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                          <span style={{ fontSize: '0.85rem', color: '#2563eb', fontWeight: 700 }}>
                            Ver protocolo completo & Conducta →
                          </span>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ) : toolsActiveTab === 'consult' ? (
              <section className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading, #1e3a8a)' }}>
                      Patologías en consultorio, diagnóstico y tratamiento
                    </h3>
                    <small style={{ color: '#64748b' }}>
                      Fichas prácticas para consultorio: sospecha, confirmación, tratamiento, seguimiento y derivación.
                    </small>
                  </div>
                  <span className="protocol-badge-category">
                    Prototipo · {CONSULT_PATHOLOGIES.length} ficha
                  </span>
                </div>

                <div className="protocol-cards-grid">
                  {CONSULT_PATHOLOGIES.map((entry) => (
                    <article
                      key={entry.id}
                      className="protocol-card-item"
                      onClick={() => {
                        setSelectedConsultPathologyId(entry.id)
                        setWorkspaceLayer('consult-pathology-detail')
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span className="protocol-badge-category">{entry.specialty}</span>
                        <span className={entry.priority === 'Alta' ? 'protocol-badge-red' : 'protocol-badge-yellow'}>
                          Prioridad {entry.priority}
                        </span>
                      </div>
                      <h4 style={{ margin: '2px 0 0', color: '#1e3a8a', fontSize: '1.05rem', lineHeight: 1.35 }}>
                        {entry.title}
                      </h4>
                      <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
                        CIE-10: {entry.cie10}
                      </span>
                      <p style={{ margin: '2px 0', fontSize: '0.87rem', color: '#334155', lineHeight: 1.45, flex: 1 }}>
                        {entry.summary}
                      </p>
                      <div style={{ background: 'var(--surface-muted, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, padding: '8px 10px', fontSize: '0.82rem', color: '#475569' }}>
                        <strong style={{ color: 'var(--text-heading, #0f172a)' }}>🧭 Clave de consultorio:</strong>
                        <div style={{ marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {entry.suspicion.keyClues[0]}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                        <span style={{ fontSize: '0.85rem', color: '#2563eb', fontWeight: 700 }}>
                          Ver ficha completa →
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <section className="panel">
                <h3>Vademécum Farmacológico</h3>
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
            )}
              </section>
            </>
          )}
        </div>
      ) : null}

      {workspaceLayer === 'consult-pathology-detail' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>Patología en Consultorio</h2>
              <p className="flow-hint">Diagnóstico, tratamiento, seguimiento y criterios de derivación.</p>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setWorkspaceLayer('tools')
                setToolsActiveTab('consult')
              }}
            >
              Volver a Patologías
            </button>
          </section>

          {selectedConsultPathology ? (
            <section className="workspace single-column">
              <section className="panel">
                <div style={{ display: 'grid', gap: 16 }}>
                  <div style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)', border: '1px solid #bfdbfe', borderRadius: 16, padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span className="protocol-badge-category">{selectedConsultPathology.specialty}</span>
                      <span className={selectedConsultPathology.priority === 'Alta' ? 'protocol-badge-red' : 'protocol-badge-yellow'}>
                        Prioridad {selectedConsultPathology.priority}
                      </span>
                    </div>
                    <h1 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '1.55rem' }}>
                      {selectedConsultPathology.title}
                    </h1>
                    <p style={{ margin: 0, color: '#475569', fontWeight: 700 }}>CIE-10: {selectedConsultPathology.cie10}</p>
                    <p style={{ margin: '10px 0 0', color: '#334155', lineHeight: 1.55 }}>
                      {selectedConsultPathology.summary}
                    </p>
                  </div>

                  <div className="protocol-section-box">
                    <h4>🧭 Cuándo sospecharla en consultorio</h4>
                    <p style={{ marginTop: 0, color: '#475569', lineHeight: 1.5 }}>
                      {selectedConsultPathology.suspicion.typicalContext}
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 20, color: '#334155', lineHeight: 1.55 }}>
                      {selectedConsultPathology.suspicion.keyClues.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="protocol-redflag-box">
                    <strong style={{ color: '#991b1b', display: 'block', marginBottom: 8 }}>
                      ⚠️ Banderas rojas: derivar o actuar hoy
                    </strong>
                    <ul style={{ margin: 0, paddingLeft: 20, color: '#7f1d1d', lineHeight: 1.55 }}>
                      {selectedConsultPathology.suspicion.redFlags.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                    <div className="protocol-section-box">
                      <h4>🔎 Confirmación diagnóstica</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#334155', lineHeight: 1.55 }}>
                        {selectedConsultPathology.diagnosis.officeConfirmation.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="protocol-section-box">
                      <h4>🧪 Estudios iniciales</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#334155', lineHeight: 1.55 }}>
                        {selectedConsultPathology.diagnosis.initialStudies.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="protocol-section-box">
                    <h4>💚 Tratamiento no farmacológico</h4>
                    <ul style={{ margin: 0, paddingLeft: 20, color: '#334155', lineHeight: 1.55 }}>
                      {selectedConsultPathology.treatment.nonPharmacological.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="protocol-section-box" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                    <h4 style={{ color: '#166534' }}>💊 Tratamiento farmacológico inicial</h4>
                    <ul style={{ margin: '0 0 12px', paddingLeft: 20, color: '#14532d', lineHeight: 1.55 }}>
                      {selectedConsultPathology.treatment.firstLine.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                      ))}
                    </ul>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="protocol-med-table">
                        <thead>
                          <tr>
                            <th>Fármaco</th>
                            <th>Dosis orientativa</th>
                            <th>Perla clínica</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedConsultPathology.treatment.pharmacologicalOptions.map((item) => (
                            <tr key={item.drug}>
                              <td><strong>{item.drug}</strong></td>
                              <td>{item.dose}</td>
                              <td>{item.notes}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="protocol-section-box" style={{ background: '#f8fafc', borderColor: '#cbd5e1' }}>
                    <h4 style={{ color: '#0f172a' }}>🪜 Escalera terapéutica hasta lograr control</h4>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {selectedConsultPathology.treatment.therapeuticLadder.map((item) => (
                        <div
                          key={item.step}
                          style={{
                            border: '1px solid #dbeafe',
                            borderRadius: 12,
                            padding: 12,
                            background: '#ffffff',
                            boxShadow: '0 6px 14px rgba(30, 64, 175, 0.06)',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                            <span style={{ background: '#1d4ed8', color: '#fff', borderRadius: 999, padding: '3px 9px', fontSize: '0.78rem', fontWeight: 800 }}>
                              {item.step}
                            </span>
                            <strong style={{ color: '#1e3a8a' }}>{item.title}</strong>
                          </div>
                          <p style={{ margin: '0 0 6px', color: '#475569', lineHeight: 1.45, fontSize: '0.9rem' }}>
                            <strong>Criterio:</strong> {item.criteria}
                          </p>
                          <p style={{ margin: '0 0 6px', color: '#334155', lineHeight: 1.45, fontSize: '0.9rem' }}>
                            <strong>Conducta:</strong> {item.action}
                          </p>
                          <p style={{ margin: 0, color: '#166534', lineHeight: 1.45, fontSize: '0.9rem' }}>
                            <strong>Reevaluación:</strong> {item.reassessment}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                    <div className="protocol-section-box" style={{ background: '#fff7ed', borderColor: '#fed7aa' }}>
                      <h4 style={{ color: '#9a3412' }}>🚫 Errores frecuentes / precauciones</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#7c2d12', lineHeight: 1.55 }}>
                        {selectedConsultPathology.treatment.avoidOrUseWithCaution.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="protocol-section-box">
                      <h4>📌 Diagnósticos diferenciales</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#334155', lineHeight: 1.55 }}>
                        {selectedConsultPathology.diagnosis.differentialDiagnosis.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 5 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="protocol-section-box">
                    <h4>📅 Seguimiento, objetivos y derivación</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                      {[
                        ['Objetivos', selectedConsultPathology.followUp.goals],
                        ['Monitoreo', selectedConsultPathology.followUp.monitoring],
                        ['Derivar si', selectedConsultPathology.followUp.referralCriteria],
                      ].map(([title, items]) => (
                        <div key={title as string} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                          <strong style={{ color: '#0f172a' }}>{title as string}</strong>
                          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#334155', lineHeight: 1.5 }}>
                            {(items as string[]).map((item, idx) => (
                              <li key={idx} style={{ marginBottom: 4 }}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="protocol-section-box" style={{ background: '#eef2ff', borderColor: '#c7d2fe' }}>
                    <h4 style={{ color: '#3730a3' }}>🗣️ Mensaje breve para el paciente</h4>
                    <p style={{ margin: 0, color: '#312e81', lineHeight: 1.55 }}>
                      “{selectedConsultPathology.patientMessage}”
                    </p>
                  </div>

                  <div className="protocol-section-box">
                    <h4>📚 Base de fuentes internacionales</h4>
                    <ul style={{ margin: 0, paddingLeft: 20, color: '#475569', lineHeight: 1.5 }}>
                      {selectedConsultPathology.sourceBasis.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 4 }}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    style={{ justifySelf: 'start', background: '#1d4ed8', color: '#fff', fontSize: '0.92rem', padding: '10px 14px', borderRadius: 8, fontWeight: 700, border: 'none', cursor: 'pointer' }}
                    onClick={() => {
                      navigator.clipboard?.writeText(selectedConsultPathology.actionCopyTemplate)
                      showSavedFloatingNotice('Conducta de consultorio copiada')
                    }}
                  >
                    📋 Copiar conducta para historia clínica
                  </button>
                </div>
              </section>
            </section>
          ) : (
            <section className="panel">
              <p className="flow-hint">La ficha ya no está disponible. Vuelve al listado de patologías.</p>
            </section>
          )}
        </div>
      ) : null}

      {workspaceLayer === 'protocol-detail' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>Protocolo y Conducta Clínica</h2>
              <p className="flow-hint">Algoritmo de guardia, manejo de emergencias y sobrevida.</p>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setWorkspaceLayer('tools')
                setToolsActiveTab('protocols')
              }}
            >
              Volver a Protocolos
            </button>
          </section>

          <section className="workspace single-column">
            {selectedProtocol ? (
              <section className="panel protocol-detail-container">
                {/* Header card */}
                <div style={{ background: 'var(--surface-muted, #f8fafc)', border: '1px solid var(--border, #cbd5e1)', borderRadius: 14, padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="protocol-badge-category">{selectedProtocol.category}</span>
                      <span className={selectedProtocol.severity.includes('Roja') || selectedProtocol.severity.includes('Crítica') ? 'protocol-badge-red' : 'protocol-badge-yellow'}>
                        {selectedProtocol.severity}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                      CIE-10: {selectedProtocol.cie10}
                    </span>
                  </div>
                  <h1 style={{ margin: '0 0 8px 0', fontSize: '1.5rem', color: 'var(--text-heading, #0f172a)' }}>
                    {selectedProtocol.title}
                  </h1>
                  <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-muted, #334155)', lineHeight: 1.5 }}>
                    {selectedProtocol.summary}
                  </p>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border, #e2e8f0)' }}>
                    <button
                      type="button"
                      style={{ background: '#1d4ed8', color: '#fff', fontSize: '0.88rem', padding: '8px 14px', borderRadius: 8, fontWeight: 600, border: 'none', cursor: 'pointer' }}
                      onClick={() => handleCopyProtocolAction(selectedProtocol.actionCopyTemplate, false)}
                    >
                      📋 Copiar conducta médica al portapapeles
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ fontSize: '0.88rem' }}
                      onClick={() => handleCopyProtocolAction(selectedProtocol.actionCopyTemplate, true)}
                    >
                      📝 Aplicar al Pensamiento Médico de la consulta activa
                    </button>
                  </div>

                  {protocolCopiedNotice ? (
                    <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '8px 12px', borderRadius: 8, marginTop: 10, fontSize: '0.9rem', fontWeight: 600 }}>
                      {protocolCopiedNotice}
                    </div>
                  ) : null}
                </div>

                {/* Sub-tabs */}
                <div className="protocol-tabs-nav">
                  <button
                    type="button"
                    className={`protocol-tab-btn ${selectedProtocolTab === 'prehospital' ? 'active' : ''}`}
                    onClick={() => setSelectedProtocolTab('prehospital')}
                  >
                    🚨 1. Sospecha Prehospitalaria (5 Claves)
                  </button>
                  <button
                    type="button"
                    className={`protocol-tab-btn ${selectedProtocolTab === 'diagnostic' ? 'active' : ''}`}
                    onClick={() => setSelectedProtocolTab('diagnostic')}
                  >
                    📈 2. Algoritmo Diagnóstico
                  </button>
                  <button
                    type="button"
                    className={`protocol-tab-btn ${selectedProtocolTab === 'management' ? 'active' : ''}`}
                    onClick={() => setSelectedProtocolTab('management')}
                  >
                    🚑 3. Manejo Guardia / Ambulancia
                  </button>
                  <button
                    type="button"
                    className={`protocol-tab-btn ${selectedProtocolTab === 'window' ? 'active' : ''}`}
                    onClick={() => setSelectedProtocolTab('window')}
                  >
                    ⏱️ 4. Ventana Terapéutica & Reperfusión
                  </button>
                  <button
                    type="button"
                    className={`protocol-tab-btn ${selectedProtocolTab === 'prognosis' ? 'active' : ''}`}
                    onClick={() => setSelectedProtocolTab('prognosis')}
                  >
                    📊 5. Pronóstico & Sobrevida
                  </button>
                </div>

                {/* Tab 1: Sospecha Prehospitalaria */}
                {selectedProtocolTab === 'prehospital' ? (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div className="protocol-section-box">
                      <h4>📍 Escenario y Contexto de Inicio</h4>
                      <p style={{ margin: 0, fontSize: '0.93rem', color: 'var(--text-muted, #334155)', lineHeight: 1.5 }}>
                        {selectedProtocol.prehospitalManifestations.setting}
                      </p>
                    </div>

                    <div className="protocol-section-box">
                      <h4>🚨 5 Manifestaciones Clínicas Cardinales de Alta Sospecha</h4>
                      <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: '#64748b' }}>
                        Criterios clave para identificar el cuadro en domicilio, vía pública o primer contacto:
                      </p>
                      <ul className="protocol-key-signs-list">
                        {selectedProtocol.prehospitalManifestations.keySigns.map((sign, idx) => (
                          <li key={idx}>
                            <strong>Signo {idx + 1}:</strong> {sign}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {selectedProtocol.prehospitalManifestations.highSuspicionRedFlags.length > 0 ? (
                      <div className="protocol-redflag-box">
                        <strong style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.95rem' }}>
                          ⚠️ Banderas Rojas Prehospitalarias (Riesgo Inminente de Paro / Shock):
                        </strong>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#7f1d1d', fontSize: '0.9rem', lineHeight: 1.5 }}>
                          {selectedProtocol.prehospitalManifestations.highSuspicionRedFlags.map((flag, idx) => (
                            <li key={idx} style={{ marginTop: 4 }}>{flag}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Tab 2: Algoritmo Diagnóstico */}
                {selectedProtocolTab === 'diagnostic' ? (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div className="protocol-section-box">
                      <h4>⏱️ Pasos Iniciales y Tiempos de Atención</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted, #334155)', fontSize: '0.92rem', lineHeight: 1.55 }}>
                        {selectedProtocol.diagnosticAlgorithm.initialSteps.map((step, idx) => (
                          <li key={idx} style={{ marginBottom: 6 }}>{step}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="protocol-section-box">
                      <h4>📈 Criterios Electrocardiográficos / Neuroimagen</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted, #334155)', fontSize: '0.92rem', lineHeight: 1.55 }}>
                        {selectedProtocol.diagnosticAlgorithm.electrocardiogram.map((ecg, idx) => (
                          <li key={idx} style={{ marginBottom: 6 }}>{ecg}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="protocol-section-box">
                      <h4>🧪 Biomarcadores y Laboratorio Crítico</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted, #334155)', fontSize: '0.92rem', lineHeight: 1.55 }}>
                        {selectedProtocol.diagnosticAlgorithm.biomarkersAndLabs.map((lab, idx) => (
                          <li key={idx} style={{ marginBottom: 6 }}>{lab}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="protocol-section-box" style={{ background: 'var(--surface-muted, #f1f5f9)', borderColor: 'var(--border, #cbd5e1)' }}>
                      <h4 style={{ color: 'var(--text-heading, #334155)' }}>⚖️ Diagnósticos Diferenciales a Descartar</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted, #475569)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                        {selectedProtocol.diagnosticAlgorithm.differentialDiagnosis.map((diff, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>{diff}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

                {/* Tab 3: Manejo Guardia / Ambulancia */}
                {selectedProtocolTab === 'management' ? (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div className="protocol-section-box" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
                      <h4 style={{ color: '#991b1b' }}>🚑 Medidas Inmediatas en Ambulancia / Prehospitalario</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#7f1d1d', fontSize: '0.92rem', lineHeight: 1.55 }}>
                        {selectedProtocol.management.prehospitalAmbulance.map((step, idx) => (
                          <li key={idx} style={{ marginBottom: 6 }}>{step}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="protocol-section-box">
                      <h4>🏥 Manejo en Shock Room y Guardia Hospitalaria</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted, #334155)', fontSize: '0.92rem', lineHeight: 1.55 }}>
                        {selectedProtocol.management.emergencyRoomShockRoom.map((step, idx) => (
                          <li key={idx} style={{ marginBottom: 6 }}>{step}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="protocol-section-box">
                      <h4>💊 Esquema Farmacológico Inicial y Dosis de Carga</h4>
                      <div className="protocol-pharma-table-wrapper">
                        <table className="protocol-pharma-table">
                          <thead>
                            <tr>
                              <th>Fármaco</th>
                              <th>Dosis</th>
                              <th>Vía</th>
                              <th>Consideraciones y Notas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedProtocol.management.initialPharmacotherapy.map((pharma, idx) => (
                              <tr key={idx}>
                                <td><strong style={{ color: '#1e3a8a' }}>{pharma.drug}</strong></td>
                                <td><span style={{ fontWeight: 600, color: 'var(--text-heading, #0f172a)' }}>{pharma.dose}</span></td>
                                <td><span className="pharma-route-tag">{pharma.route}</span></td>
                                <td style={{ fontSize: '0.85rem', color: 'var(--text-muted, #475569)' }}>{pharma.notes}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Tab 4: Ventana Terapéutica */}
                {selectedProtocolTab === 'window' ? (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div className="protocol-section-box" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
                      <h4 style={{ color: '#1e40af' }}>⏱️ Tiempo es Tejido (Ventana Terapéutica)</h4>
                      <p style={{ margin: 0, fontSize: '0.95rem', color: '#1e3a8a', lineHeight: 1.55, fontWeight: 600 }}>
                        {selectedProtocol.therapeuticWindow.timeframe}
                      </p>
                    </div>

                    <div className="protocol-section-box">
                      <h4>🏆 Gold Standard de Reperfusión / Tratamiento Definitivo</h4>
                      <p style={{ margin: 0, fontSize: '0.93rem', color: 'var(--text-muted, #334155)', lineHeight: 1.55 }}>
                        {selectedProtocol.therapeuticWindow.goldStandard}
                      </p>
                    </div>

                    <div className="protocol-section-box">
                      <h4>💉 Estrategia Alternativa (ej. Fibrinolisis o Farmacológica)</h4>
                      <p style={{ margin: 0, fontSize: '0.93rem', color: 'var(--text-muted, #334155)', lineHeight: 1.55 }}>
                        {selectedProtocol.therapeuticWindow.alternativeReperfusion}
                      </p>
                    </div>

                    {selectedProtocol.therapeuticWindow.contraindications.length > 0 ? (
                      <div className="protocol-redflag-box">
                        <strong style={{ color: '#991b1b', fontSize: '0.95rem' }}>
                          🚫 Contraindicaciones Críticas a Considerar:
                        </strong>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#7f1d1d', fontSize: '0.9rem', lineHeight: 1.5 }}>
                          {selectedProtocol.therapeuticWindow.contraindications.map((contra, idx) => (
                            <li key={idx} style={{ marginTop: 4 }}>{contra}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Tab 5: Pronóstico y Sobrevida */}
                {selectedProtocolTab === 'prognosis' ? (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div className="protocol-section-box">
                      <h4>📊 Curvas de Sobrevida Basadas en Evidencia</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 10 }}>
                        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: 14 }}>
                          <strong style={{ color: '#065f46', fontSize: '0.88rem' }}>⏳ A las 6 Horas:</strong>
                          <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: '#047857', fontWeight: 500 }}>
                            {selectedProtocol.evidenceAndPrognosis.survivalAt6h}
                          </p>
                        </div>
                        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 14 }}>
                          <strong style={{ color: '#166534', fontSize: '0.88rem' }}>⏳ A las 24 Horas:</strong>
                          <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: '#15803d', fontWeight: 500 }}>
                            {selectedProtocol.evidenceAndPrognosis.survivalAt24h}
                          </p>
                        </div>
                        <div style={{ background: 'var(--surface-muted, #f8fafc)', border: '1px solid var(--border, #cbd5e1)', borderRadius: 10, padding: 14 }}>
                          <strong style={{ color: 'var(--text-heading, #334155)', fontSize: '0.88rem' }}>⏳ A los 7 Días:</strong>
                          <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--text-muted, #475569)', fontWeight: 500 }}>
                            {selectedProtocol.evidenceAndPrognosis.survivalAt7d}
                          </p>
                        </div>
                        <div style={{ background: 'var(--surface-muted, #f8fafc)', border: '1px solid var(--border, #cbd5e1)', borderRadius: 10, padding: 14 }}>
                          <strong style={{ color: 'var(--text-heading, #334155)', fontSize: '0.88rem' }}>⏳ Al 1 Año:</strong>
                          <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--text-muted, #475569)', fontWeight: 500 }}>
                            {selectedProtocol.evidenceAndPrognosis.survivalAt1y}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="protocol-section-box" style={{ background: '#fff1f2', borderColor: '#fecdd3' }}>
                      <h4 style={{ color: '#9f1239' }}>⚡ Complicaciones Inmediatas (Primeras 24 a 48 hs)</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#881337', fontSize: '0.92rem', lineHeight: 1.55 }}>
                        {selectedProtocol.evidenceAndPrognosis.immediateComplications.map((comp, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>{comp}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="protocol-section-box">
                      <h4>🔄 Consecuencias Mediatas y a Largo Plazo</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted, #334155)', fontSize: '0.92rem', lineHeight: 1.55 }}>
                        {selectedProtocol.evidenceAndPrognosis.mediateAndLongTermComplications.map((comp, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>{comp}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="panel">
                <p className="flow-hint">El protocolo no fue encontrado. Vuelve al listado de herramientas.</p>
              </section>
            )}
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
          {onboardingDone < onboardingSteps.length ? (
            <section className="onboarding-card" aria-label="Primeros pasos">
              <div className="onboarding-head">
                <div>
                  <span className="section-kicker">Primeros pasos</span>
                  <strong>Dejá tu consultorio listo en 4 pasos</strong>
                </div>
                <span className="onboarding-count">{onboardingDone}/{onboardingSteps.length}</span>
              </div>
              <div className="onboarding-bar" aria-hidden="true">
                <span style={{ width: `${(onboardingDone / onboardingSteps.length) * 100}%` }} />
              </div>
              <ul className="onboarding-list">
                {onboardingSteps.map((step) => (
                  <li key={step.key} className={step.done ? 'done' : ''}>
                    <span className="onboarding-check" aria-hidden="true">{step.done ? '✓' : ''}</span>
                    <span className="onboarding-copy">
                      <strong>{step.label}</strong>
                      <small>{step.hint}</small>
                    </span>
                    {step.done ? null : (
                      <button type="button" className="screen-action" onClick={step.action}>
                        Hacerlo
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <nav className="home-botonera" aria-label="Accesos rápidos">
            {homeQuickActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={`smart-btn${action.wide ? ' wide' : ''}`}
                style={{ '--tone': action.tone } as CSSProperties}
                onClick={action.onClick}
              >
                {action.badge && action.badge > 0 ? <span className="smart-badge">{action.badge}</span> : null}
                <span className="smart-ico" aria-hidden="true">{action.icon}</span>
                <span className="smart-txt">
                  <strong>{action.label}</strong>
                  <small>{action.hint}</small>
                </span>
              </button>
            ))}
          </nav>

        </div>
      ) : null}

      {workspaceLayer === 'medical-news' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <span className="section-kicker">Actualidad clínica</span>
              <h2>Noticias médicas</h2>
              <p className="flow-hint">Fuentes oficiales y novedades seleccionadas para profesionales de la salud.</p>
            </div>
            <button type="button" className="ghost" onClick={handleBackToOverview}>Volver</button>
          </section>
          <section className="panel medical-news-page">
            {medicalNewsLoading ? (
              <div className="skeleton-block">
                <div className="skeleton-line wide" />
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
              </div>
            ) : null}
            {medicalNews.length > 0 ? (
              <>
                <div className="medical-news-source-tabs">
                  {Array.from(new Map(medicalNews.map((item, index) => [item.source, index])).entries()).map(([source, index]) => (
                    <button key={source} type="button" className={`ghost compact ${index === currentMedicalNewsIndex ? 'active' : ''}`} onClick={() => setCurrentMedicalNewsIndex(index)}>
                      {source}
                    </button>
                  ))}
                </div>
                {(() => {
                  const item = medicalNews[currentMedicalNewsIndex] ?? medicalNews[0]
                  return (
                    <article className="medical-news-feature">
                      <div className="medical-news-feature-image" style={{ backgroundImage: `linear-gradient(180deg, rgba(10,20,35,.05), rgba(10,20,35,.7)), url("${item.imageUrl}")` }}>
                        <div><strong>{item.source}</strong><small>{item.publishedAt ? formatDate(item.publishedAt) : 'Fuente oficial'}</small><h3>{item.title}</h3></div>
                      </div>
                      <div className="medical-news-feature-body"><p>{item.summary || 'Abrí la fuente oficial para leer la noticia completa.'}</p><a href={item.link} target="_blank" rel="noreferrer">Ver noticia completa →</a></div>
                    </article>
                  )
                })()}
              </>
            ) : !medicalNewsLoading ? <p className="flow-hint">No hay noticias disponibles en este momento.</p> : null}
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

      {workspaceLayer === 'appointments' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <h2>{turneraViewMode === 'ledger' ? '◈ Balance de pagos' : '📅 Turnera Médica'}</h2>
              <p className="flow-hint">
                {turneraViewMode === 'ledger'
                  ? 'Registro exclusivo de cobros, saldos pendientes y deuda acumulada por paciente.'
                  : 'Gestión de turnos clínicos, agenda diaria y recordatorios automáticos por email desde soporte@drhappy.com.ar.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="ghost" onClick={handleBackToOverview}>
                Volver
              </button>
            </div>
          </section>

          {/* Todos los accesos de la Turnera juntos y arriba, sin scroll previo. */}
          <nav className="screen-action-bar" aria-label="Acciones de la turnera">
            <button type="button" className="screen-action primary" onClick={() => handleNewAppointmentModal()}>
              <span aria-hidden="true">➕</span> Nuevo turno
            </button>
            <button type="button" className={`screen-action${turneraViewMode === 'list' ? ' active' : ''}`} onClick={() => setTurneraViewMode('list')}>
              <span aria-hidden="true">📋</span> Lista de turnos
            </button>
            <button type="button" className={`screen-action${turneraViewMode === 'capacity' ? ' active' : ''}`} onClick={() => setTurneraViewMode('capacity')}>
              <span aria-hidden="true">⚙️</span> Cupos y link público
            </button>
            <button
              type="button"
              className={`screen-action${turneraViewMode === 'calendar' ? ' active' : ''}${!hasPremiumTurneraAccess ? ' locked' : ''}`}
              onClick={() => {
                if (!hasPremiumTurneraAccess) {
                  setPremiumPrompt({
                    icon: '🗓️',
                    title: 'Calendario de ocupación',
                    pitch: 'Veí de un vistazo qué días tenés llenos y cuáles te quedan libres, y acomodá tu agenda antes de que se te complique.',
                    bullets: [
                      'Mapa mensual con el nivel de ocupación de cada día',
                      'Detectá huecos y llená tu agenda con turnos públicos',
                      'Evitá sobreturnos viendo tu cupo real al instante',
                    ],
                  })
                  return
                }
                setTurneraViewMode('calendar')
              }}
            >
              <span aria-hidden="true">🗓️</span> Calendario de ocupación{!hasPremiumTurneraAccess ? ' 🔒' : ''}
            </button>
            <button
              type="button"
              className={`screen-action${turneraViewMode === 'stats' ? ' active' : ''}${!hasPremiumTurneraAccess ? ' locked' : ''}`}
              onClick={() => {
                if (!hasPremiumTurneraAccess) {
                  setPremiumPrompt({
                    icon: '📊',
                    title: 'Estadísticas de atención',
                    pitch: 'Sabé cuánto estás creciendo: pacientes atendidos por semana y por mes, con la tendencia a la vista.',
                    bullets: [
                      'Pacientes atendidos por semana y por mes',
                      'Tendencia de crecimiento de tu consultorio',
                      'Detectá tus días y horarios más demandados',
                    ],
                  })
                  return
                }
                setTurneraViewMode('stats')
              }}
            >
              <span aria-hidden="true">📊</span> Estadísticas{!hasPremiumTurneraAccess ? ' 🔒' : ''}
            </button>
            {isModuleEnabled('appointments') ? (
              <button
                type="button"
                className={`screen-action${turneraViewMode === 'ledger' ? ' active' : ''}${!canUseTreatmentLedger ? ' locked' : ''}`}
                onClick={() => {
                  if (!canUseTreatmentLedger) {
                    setPremiumPrompt({
                      icon: '💰',
                      title: 'Balance de pagos',
                      pitch: 'Dejá de anotar en papel quién te debe. Registrá cada tratamiento, lo cobrado y lo pendiente, y mandá recordatorios de pago.',
                      bullets: [
                        'Saldo pendiente por paciente, siempre actualizado',
                        'Recordatorios de pago por email en un toque',
                        'Total facturado y total adeudado del consultorio',
                      ],
                    })
                    return
                  }
                  setTurneraViewMode('ledger')
                }}
              >
                <span aria-hidden="true">💰</span> Balance de pagos{!canUseTreatmentLedger ? ' 🔒' : ''}
              </button>
            ) : null}
          </nav>

          {turneraViewMode === 'capacity' ? <section className="panel appointment-capacity-panel">
            <div>
              <span className="section-kicker">Control de agenda</span>
              <h3 style={{ margin: 0 }}>Cupos de atención</h3>
              <p className="flow-hint">Definí tu horario y la duración de cada turno. Dr Happy calcula automáticamente cuántos entran.</p>
            </div>
            <div className="capacity-controls">
              <label>
                Desde
                <span className="time-select-pair">
                  <select value={splitAppointmentTime(appointmentStartTime).hour} onChange={(event) => saveAppointmentCapacity(appointmentDays, joinAppointmentTime(event.target.value, splitAppointmentTime(appointmentStartTime).period), appointmentEndTime, appointmentDurationMinutes)}>
                    {APPOINTMENT_HOUR_OPTIONS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                  </select>
                  <select value={splitAppointmentTime(appointmentStartTime).period} onChange={(event) => saveAppointmentCapacity(appointmentDays, joinAppointmentTime(splitAppointmentTime(appointmentStartTime).hour, event.target.value as 'AM' | 'PM'), appointmentEndTime, appointmentDurationMinutes)}>
                    {APPOINTMENT_PERIOD_OPTIONS.map((period) => <option key={period} value={period}>{period}</option>)}
                  </select>
                </span>
              </label>
              <label>
                Hasta
                <span className="time-select-pair">
                  <select value={splitAppointmentTime(appointmentEndTime).hour} onChange={(event) => saveAppointmentCapacity(appointmentDays, appointmentStartTime, joinAppointmentTime(event.target.value, splitAppointmentTime(appointmentEndTime).period), appointmentDurationMinutes)}>
                    {APPOINTMENT_HOUR_OPTIONS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                  </select>
                  <select value={splitAppointmentTime(appointmentEndTime).period} onChange={(event) => saveAppointmentCapacity(appointmentDays, appointmentStartTime, joinAppointmentTime(splitAppointmentTime(appointmentEndTime).hour, event.target.value as 'AM' | 'PM'), appointmentDurationMinutes)}>
                    {APPOINTMENT_PERIOD_OPTIONS.map((period) => <option key={period} value={period}>{period}</option>)}
                  </select>
                </span>
              </label>
              <label>
                Duración del turno
                <select value={appointmentDurationMinutes} onChange={(event) => saveAppointmentCapacity(appointmentDays, appointmentStartTime, appointmentEndTime, Number(event.target.value))}>
                  {[15, 20, 30, 45, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
                </select>
              </label>
              <div className="capacity-calculated">
                <strong>{calculateDailyCapacity(appointmentStartTime, appointmentEndTime, appointmentDurationMinutes)}</strong>
                <span>turnos posibles por día</span>
              </div>
              <label>
                Monto a cobrar
                <input type="number" min="0" step="1" value={appointmentAmountToCharge} onChange={(event) => handleAppointmentAmountChange(event.target.value)} onBlur={saveAppointmentAmount} placeholder="0 = sin seña" />
              </label>
              <label>
                Concepto
                <select value={appointmentAmountConcept} onChange={(event) => setAppointmentAmountConcept(event.target.value as 'sena' | 'consulta')}>
                  <option value="sena">Reserva / seña</option>
                  <option value="consulta">Turno completo</option>
                </select>
              </label>
              <div className="capacity-days">
                <span>Días de atención</span>
                <div>
                  {WEEK_DAYS.map((day) => (
                    <label key={day.value} className="capacity-day-option">
                      <input
                        type="checkbox"
                        checked={appointmentDays.includes(day.value)}
                        onChange={() => {
                          const nextDays = appointmentDays.includes(day.value)
                            ? appointmentDays.filter((value) => value !== day.value)
                            : [...appointmentDays, day.value]
                          saveAppointmentCapacity(nextDays, appointmentStartTime, appointmentEndTime, appointmentDurationMinutes)
                        }}
                      />
                      <span>{day.label.slice(0, 3)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="capacity-status">{appointmentDaysLabel || 'Elegí al menos un día'} · Configuración guardada automáticamente al cambiar los campos.</div>
                    <button type="button" className="screen-action primary" disabled={publicBookingSaving} onClick={() => void handleGenerateFixedBookingLink()}><span aria-hidden="true">💾</span> {publicBookingSaving ? 'Guardando y generando link...' : 'Guardar y generar link de turnera'}</button>
            {freeSlotGeneratedUrl ? (
              <div className="capacity-generated-link">
                <strong>Tu link fijo</strong>
                <span>{freeSlotGeneratedUrl}</span>
                <button type="button" className="ghost compact" onClick={() => void navigator.clipboard.writeText(freeSlotGeneratedUrl!)}>Copiar link</button>
              </div>
            ) : null}
          </section> : null}

          {turneraViewMode === 'ledger' && canUseTreatmentLedger ? (
            <section className="panel turnera-ledger-panel">
              <div className="turnera-ledger-header">
                <div>
                  <h3 style={{ margin: 0 }}>💰 Balance de pagos</h3>
                  <small className="flow-hint">
                    Registrá cada intervención, cuánto cobraste y cuánto queda pendiente.
                  </small>
                </div>
                <button type="button" onClick={() => handleOpenLedgerModal()}>
                  ➕ Registrar intervención
                </button>
              </div>

              <div className="ledger-summary-grid">
                <div className="ledger-summary-card">
                  <span className="ledger-summary-label">Facturado</span>
                  <strong>{formatMoney(ledgerTotals.total)}</strong>
                </div>
                <div className="ledger-summary-card ok">
                  <span className="ledger-summary-label">Cobrado</span>
                  <strong>{formatMoney(ledgerTotals.collected)}</strong>
                </div>
                <div className={`ledger-summary-card ${ledgerTotals.pending > 0 ? 'warn' : 'ok'}`}>
                  <span className="ledger-summary-label">Pendiente de cobro</span>
                  <strong>{formatMoney(ledgerTotals.pending)}</strong>
                </div>
                <div className="ledger-summary-card">
                  <span className="ledger-summary-label">Pacientes con deuda</span>
                  <strong>{ledgerTotals.debtors.size}</strong>
                </div>
              </div>

              <div className="ledger-toolbar">
                <input
                  type="search"
                  placeholder="Buscar por paciente o intervención..."
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                />
                <div className="ledger-filter-buttons">
                  <button
                    type="button"
                    className={`ghost compact ${ledgerFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setLedgerFilter('all')}
                  >
                    Todos ({treatmentLedger.length})
                  </button>
                  <button
                    type="button"
                    className={`ghost compact ${ledgerFilter === 'debt' ? 'active' : ''}`}
                    onClick={() => setLedgerFilter('debt')}
                  >
                    Con saldo ({treatmentLedger.filter((e) => e.totalAmount - e.paidAmount > 0).length})
                  </button>
                  <button
                    type="button"
                    className={`ghost compact ${ledgerFilter === 'settled' ? 'active' : ''}`}
                    onClick={() => setLedgerFilter('settled')}
                  >
                    Saldados ({treatmentLedger.filter((e) => e.totalAmount - e.paidAmount <= 0).length})
                  </button>
                </div>
              </div>

              {visibleLedgerEntries.length === 0 ? (
                <div className="turnera-empty-state">
                  <p>
                    {treatmentLedger.length === 0
                      ? 'Todavía no registraste intervenciones. Empezá cargando el primer tratamiento.'
                      : 'No hay registros con los filtros seleccionados.'}
                  </p>
                  {treatmentLedger.length === 0 ? (
                    <button type="button" onClick={() => handleOpenLedgerModal()}>
                      ➕ Registrar la primera intervención
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="ledger-grid">
                  {visibleLedgerEntries.map((entry) => {
                    const pending = entry.totalAmount - entry.paidAmount
                    const progress = entry.totalAmount > 0
                      ? Math.min(Math.round((entry.paidAmount / entry.totalAmount) * 100), 100)
                      : 0
                    return (
                      <article key={entry.id} className={`ledger-card ${pending > 0 ? 'has-debt' : 'settled'}`}>
                        <div className="ledger-card-top">
                          <div>
                            <strong className="ledger-card-patient">{entry.patientName}</strong>
                            <span className="ledger-card-date">{formatShortDate(entry.date)}</span>
                          </div>
                          <span className={`ledger-badge ${pending > 0 ? 'warn' : 'ok'}`}>
                            {pending > 0 ? `Debe ${formatMoney(pending)}` : '✅ Saldado'}
                          </span>
                        </div>

                        <p className="ledger-card-intervention">{entry.intervention}</p>
                        {entry.notes ? <p className="ledger-card-notes">{entry.notes}</p> : null}

                        <div className="ledger-progress">
                          <div className="ledger-progress-bar">
                            <div className="ledger-progress-fill" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="ledger-progress-label">
                            {formatMoney(entry.paidAmount)} de {formatMoney(entry.totalAmount)} ({progress}%)
                          </span>
                        </div>

                        <div className="ledger-card-actions">
                          {pending > 0 ? (
                            <button type="button" onClick={() => handleRegisterLedgerPayment(entry.id)}>
                              💵 Registrar pago
                            </button>
                          ) : null}
                          {pending > 0 ? (
                            <button type="button" className="ghost" disabled={ledgerReminderSendingId === entry.id} onClick={() => void handleSendLedgerPaymentReminder(entry.id)}>
                              {ledgerReminderSendingId === entry.id ? 'Enviando...' : '📧 Enviar recordatorio de pago'}
                            </button>
                          ) : null}
                          <button type="button" className="ghost" onClick={() => handleOpenLedgerModal(entry)}>
                            ✏️ Editar
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            style={{ color: '#c0392b' }}
                            onClick={() => handleDeleteLedgerEntry(entry.id)}
                          >
                            🗑️ Eliminar
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          ) : null}

          {turneraViewMode === 'calendar' && !hasPremiumTurneraAccess ? (
            <section className="panel turnera-premium-locked">
              <h3 style={{ marginTop: 0 }}>🔒 Calendario de ocupación — función Premium</h3>
              <p className="flow-hint">
                Esta herramienta está disponible para profesionales con suscripción activa (mensual, semestral o anual).
                Activá o renová tu suscripción para acceder al calendario de ocupación y las estadísticas de atención.
              </p>
            </section>
          ) : null}

          {turneraViewMode === 'calendar' && hasPremiumTurneraAccess ? (
            <section className="panel turnera-calendar-panel">
              <div className="turnera-calendar-header">
                <button
                  type="button"
                  className="ghost compact"
                  onClick={() =>
                    setCalendarMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                  }
                >
                  ← Mes anterior
                </button>
                <div className="turnera-calendar-title">
                  <strong style={{ textTransform: 'capitalize' }}>{calendarMonthLabel}</strong>
                  <span>{calendarMonthTotal} turnos este mes</span>
                </div>
                <button
                  type="button"
                  className="ghost compact"
                  onClick={() =>
                    setCalendarMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                  }
                >
                  Mes siguiente →
                </button>
              </div>

              <div className="turnera-calendar-weekdays">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((wd) => (
                  <span key={wd}>{wd}</span>
                ))}
              </div>

              <div className="turnera-calendar-grid">
                {calendarWeeks.flatMap((week, weekIdx) =>
                  week.map((cell, cellIdx) => {
                    if (!cell.dateStr) {
                      return <div key={`${weekIdx}-${cellIdx}`} className="turnera-calendar-cell empty" />
                    }
                    const occupancyLevel =
                      cell.count === 0 ? 'none' : cell.count <= 2 ? 'low' : cell.count <= 5 ? 'mid' : 'high'
                    return (
                      <button
                        type="button"
                        key={cell.dateStr}
                        className={`turnera-calendar-cell occupancy-${occupancyLevel} ${cell.isToday ? 'is-today' : ''} ${selectedCalendarDay === cell.dateStr ? 'is-selected' : ''}`}
                        onClick={() => setSelectedCalendarDay(cell.dateStr)}
                      >
                        <span className="turnera-calendar-day-number">{cell.day}</span>
                        {cell.count > 0 ? <span className="turnera-calendar-day-count">{cell.count}</span> : null}
                        {cell.count > 0 ? <span className="turnera-calendar-day-breakdown">{cell.count} turno{cell.count === 1 ? '' : 's'}</span> : null}
                      </button>
                    )
                  })
                )}
              </div>

              <div className="turnera-calendar-legend">
                <span><i className="dot occupancy-none" /> Sin turnos</span>
                <span><i className="dot occupancy-low" /> 1-2 turnos</span>
                <span><i className="dot occupancy-mid" /> 3-5 turnos</span>
                <span><i className="dot occupancy-high" /> 6+ turnos</span>
              </div>

              {selectedCalendarDay ? (
                <div className="turnera-calendar-day-detail">
                  <strong>
                    {formatShortDate(selectedCalendarDay)}: {appointmentCountByDate.get(selectedCalendarDay) ?? 0} paciente(s) agendado(s)
                    <small className="turnera-calendar-day-breakdown-detail">Ocupación de la agenda</small>
                  </strong>
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={() => {
                      setAppointmentDateFilter(selectedCalendarDay)
                      setTurneraViewMode('list')
                    }}
                  >
                    Ver ese día en la lista →
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNewAppointmentModal(null, selectedCalendarDay)}
                    disabled={
                      !appointmentDays.includes(new Date(`${selectedCalendarDay}T12:00:00`).getDay()) ||
                      (appointmentCountByDate.get(selectedCalendarDay) ?? 0) >= dailyPatientLimit
                    }
                    title={
                      !appointmentDays.includes(new Date(`${selectedCalendarDay}T12:00:00`).getDay())
                        ? 'Día no habilitado en tu agenda'
                        : (appointmentCountByDate.get(selectedCalendarDay) ?? 0) >= dailyPatientLimit
                          ? 'Cupo diario completo'
                          : 'Agendar un turno nuevo para este día'
                    }
                  >
                    Agendar turno ese día
                  </button>
                </div>
              ) : (
                <p className="flow-hint">Tocá un día para ver cuántos pacientes tenés agendados.</p>
              )}
            </section>
          ) : null}

          {turneraViewMode === 'stats' && !hasPremiumTurneraAccess ? (
            <section className="panel turnera-premium-locked">
              <h3 style={{ marginTop: 0 }}>🔒 Estadísticas — función Premium</h3>
              <p className="flow-hint">
                Esta herramienta está disponible para profesionales con suscripción activa (mensual, semestral o anual).
                Activá o renová tu suscripción para acceder al calendario de ocupación y las estadísticas de atención.
              </p>
            </section>
          ) : null}

          {turneraViewMode === 'stats' && hasPremiumTurneraAccess ? (
            <section className="panel turnera-stats-panel">
              <h3 style={{ marginTop: 0 }}>📊 Pacientes atendidos por semana</h3>
              {attendanceWeeklyStats.length > 0 ? (
                <div className="turnera-bar-chart">
                  {attendanceWeeklyStats.map((week) => {
                    const max = Math.max(...attendanceWeeklyStats.map((w) => w.count), 1)
                    const heightPct = Math.max(6, Math.round((week.count / max) * 100))
                    return (
                      <div className="turnera-bar-chart-col" key={week.sortKey}>
                        <div className="turnera-bar-chart-bar-wrap">
                          <div className="turnera-bar-chart-bar" style={{ height: `${heightPct}%` }}>
                            <span>{week.count}</span>
                          </div>
                        </div>
                        <small>{week.label}</small>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="flow-hint">Todavía no hay turnos suficientes para graficar por semana.</p>
              )}

              <h3>📈 Comparación mensual</h3>
              {attendanceMonthlyStats.length > 0 ? (
                <>
                  <div className="turnera-bar-chart">
                    {attendanceMonthlyStats.map((month, idx) => {
                      const max = Math.max(...attendanceMonthlyStats.map((m) => m.count), 1)
                      const heightPct = Math.max(6, Math.round((month.count / max) * 100))
                      return (
                        <div className="turnera-bar-chart-col" key={`${month.label}-${idx}`}>
                          <div className="turnera-bar-chart-bar-wrap">
                            <div className="turnera-bar-chart-bar month-bar" style={{ height: `${heightPct}%` }}>
                              <span>{month.count}</span>
                            </div>
                          </div>
                          <small style={{ textTransform: 'capitalize' }}>{month.label}</small>
                        </div>
                      )
                    })}
                  </div>
                  {attendanceTrend ? (
                    <p className={`turnera-trend-note ${attendanceTrend.improving ? 'up' : 'down'}`}>
                      {attendanceTrend.improving ? '📈' : '📉'} Este mes{' '}
                      {attendanceTrend.improving ? 'llevás' : 'llevás'}{' '}
                      {Math.abs(attendanceTrend.diff)} paciente(s) {attendanceTrend.improving ? 'más' : 'menos'} que el mes
                      anterior ({attendanceTrend.pct >= 0 ? '+' : ''}
                      {attendanceTrend.pct}%).
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="flow-hint">Todavía no hay turnos suficientes para comparar meses.</p>
              )}
              <div className="analytics-summary-grid">
                <article className="analytics-stat-card"><strong>{patients.length}</strong><span>Pacientes registrados</span></article>
                <article className="analytics-stat-card"><strong>{patients.reduce((total, patient) => total + patient.consultations.length, 0)}</strong><span>Consultas registradas</span></article>
                <article className="analytics-stat-card"><strong>{pathologyStats.length}</strong><span>Patologías identificadas</span></article>
                <article className="analytics-stat-card"><strong>{ledgerPatientBalances.filter((entry) => entry.pending <= 0).length}</strong><span>Pacientes sin deuda</span></article>
                <article className="analytics-stat-card warn"><strong>{ledgerPatientBalances.filter((entry) => entry.pending > 0).length}</strong><span>Pacientes con deuda</span></article>
                <article className="analytics-stat-card warn"><strong>{formatMoney(ledgerTotals.pending)}</strong><span>Total adeudado</span></article>
              </div>
              <div className="analytics-columns">
                <section>
                  <h3>Patologías más frecuentes</h3>
                  {pathologyStats.length > 0 ? pathologyStats.map(([name, count]) => (
                    <div className="analytics-row" key={name}><span>{name}</span><strong>{count}</strong></div>
                  )) : <p className="flow-hint">Todavía no hay diagnósticos registrados.</p>}
                </section>
                <section>
                  <h3>Balance por paciente</h3>
                  {ledgerPatientBalances.length > 0 ? ledgerPatientBalances.slice(0, 8).map((entry) => (
                    <div className="analytics-row" key={entry.patientName}><span>{entry.patientName}</span><strong className={entry.pending > 0 ? 'analytics-debt' : 'analytics-paid'}>{entry.pending > 0 ? formatMoney(entry.pending) : 'Sin deuda'}</strong></div>
                  )) : <p className="flow-hint">Todavía no hay movimientos de balance.</p>}
                </section>
              </div>
            </section>
          ) : null}

          {turneraViewMode === 'list' ? (
          <>
          {/* Metrics bar */}
          <div className="turnera-metrics-grid">
            <button type="button" className={`turnera-metric-card ${appointmentFilterTab === 'today' ? 'active' : ''}`} onClick={() => setAppointmentFilterTab('today')}>
              <span className="turnera-metric-icon">📅</span>
              <div className="turnera-metric-info">
                <strong>{appointmentsMetrics.todayCount}</strong>
                <span>Turnos para hoy</span>
              </div>
            </button>
            <button type="button" className={`turnera-metric-card ${appointmentFilterTab === 'upcoming' ? 'active' : ''}`} onClick={() => setAppointmentFilterTab('upcoming')}>
              <span className="turnera-metric-icon">⏳</span>
              <div className="turnera-metric-info">
                <strong>{appointmentsMetrics.upcomingCount}</strong>
                <span>Próximos turnos</span>
              </div>
            </button>
            <button type="button" className="turnera-metric-card" onClick={() => setAppointmentFilterTab('all')}>
              <span className="turnera-metric-icon">✉️</span>
              <div className="turnera-metric-info">
                <strong>{appointmentsMetrics.emailSentCount}</strong>
                <span>Confirmados por email</span>
              </div>
            </button>
            <button type="button" className={`turnera-metric-card ${appointmentFilterTab === 'all' ? 'active' : ''}`} onClick={() => setAppointmentFilterTab('all')}>
              <span className="turnera-metric-icon">📋</span>
              <div className="turnera-metric-info">
                <strong>{appointmentsMetrics.total}</strong>
                <span>Total agendados</span>
              </div>
            </button>
          </div>

          {/* Toolbar & Filters */}
          <section className="panel turnera-toolbar-panel">
            <div className="turnera-filters-row">
              <div className="turnera-search-box">
                <input
                  type="search"
                  placeholder="Buscar por paciente, DNI, motivo, lugar..."
                  value={appointmentSearchQuery}
                  onChange={(e) => setAppointmentSearchQuery(e.target.value)}
                />
              </div>
              <div className="turnera-date-filter">
                <input
                  type="date"
                  value={appointmentDateFilter}
                  onChange={(e) => setAppointmentDateFilter(e.target.value)}
                  title="Filtrar por fecha específica"
                />
                {appointmentDateFilter ? (
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={() => setAppointmentDateFilter('')}
                    title="Limpiar filtro de fecha"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {/* Appointment list */}
          <section className="panel">
            {filteredAppointments.length > 0 ? (
              <div className="turnera-cards-grid">
                {filteredAppointments.map((record) => {
                  const now = new Date()
                  const todayStr = localDateKey(now)
                  const isToday = record.scheduledDate === todayStr
                  const isPast = record.scheduledDate < todayStr
                  const appointmentEnd = new Date(`${record.scheduledDate}T${record.scheduledTime}:00`)
                  appointmentEnd.setMinutes(appointmentEnd.getMinutes() + (record.durationMinutes ?? 30))
                  const isOutsideSchedule = record.status !== 'attended' && (isPast || (isToday && now >= appointmentEnd))
                  const dateBadgeClass = isToday
                    ? 'turnera-badge-today'
                    : isPast
                    ? 'turnera-badge-past'
                    : 'turnera-badge-upcoming'

                  return (
                    <article key={record.id} className={`turnera-card ${isToday ? 'highlight-today' : ''}`}>
                      <div className="turnera-card-header">
                        <span className={`turnera-date-badge ${dateBadgeClass}`}>
                          {formatShortDate(record.scheduledDate)} · {record.scheduledTime} hs
                        </span>
                        <span className="turnera-status-badge">
                          {record.status === 'attended' ? '✅ Atendido' : isOutsideSchedule ? '🔴 Fuera de horario' : isToday ? '🟢 Hoy' : '🔵 Confirmado'}
                        </span>
                      </div>

                      <div className="turnera-card-body">
                        <h3 className="turnera-patient-name">
                          {record.patientName}
                        </h3>
                        <div className="turnera-patient-meta">
                          {record.patientDni ? <span>🆔 DNI: {record.patientDni}</span> : null}
                          {record.patientEmail ? <span>✉️ {record.patientEmail}</span> : <span style={{ opacity: 0.6 }}>Sin email</span>}
                        </div>

                        <div className="turnera-reason-box">
                          <strong>Motivo:</strong> {record.reason || 'Consulta médica'}
                        </div>

                        {record.location ? (
                          <div className="turnera-location-box">
                            <span>📍 {record.location}</span>
                          </div>
                        ) : null}

                        {record.notes ? (
                          <div className="turnera-notes-box">
                            <small>📝 {record.notes}</small>
                          </div>
                        ) : null}

                        {record.amountToCharge ? (
                          <div className="turnera-amount-box">
                            <span>
                              💳 {record.amountConcept === 'sena' ? 'Seña' : 'Consulta'}: $
                              {record.amountToCharge.toLocaleString('es-AR')}
                            </span>
                          </div>
                        ) : null}

                        {/* Email Confirmation Status */}
                        <div className="turnera-email-status-bar">
                          {record.emailConfirmationSentAt ? (
                            <div className="email-status-sent">
                              <span>✉️ Confirmado por email</span>
                              <button
                                type="button"
                                className="ghost compact"
                                disabled={appointmentResendingId === record.id}
                                onClick={() => void handleResendAppointmentEmail(record)}
                              >
                                {appointmentResendingId === record.id ? 'Enviando...' : 'Reenviar email'}
                              </button>
                            </div>
                          ) : record.patientEmail ? (
                            <div className="email-status-pending">
                              <span>Sin enviar</span>
                              <button
                                type="button"
                                className="ghost compact"
                                disabled={appointmentResendingId === record.id}
                                onClick={() => void handleResendAppointmentEmail(record)}
                              >
                                {appointmentResendingId === record.id ? 'Enviando...' : 'Enviar confirmación'}
                              </button>
                            </div>
                          ) : (
                            <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Agregá un email para enviar la confirmación</small>
                          )}
                        </div>
                      </div>

                      <div className="turnera-card-actions">
                        <button
                          type="button"
                          onClick={() => handleStartConsultationFromAppointment(record)}
                          title="Iniciar atención médica para este paciente"
                        >
                          🩺 Atender
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleEditAppointment(record)}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          style={{ color: '#c0392b' }}
                          onClick={() => void handleDeleteAppointment(record.id)}
                        >
                          🗑️ Cancelar
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="turnera-empty-state">
                <p>No hay turnos agendados con los filtros seleccionados.</p>
              </div>
            )}
          </section>
          </>
          ) : null}
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
                    accept=".txt,.md,.json,text/plain,text/markdown,application/json"
                    onChange={handleImportPatient}
                  />
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {workspaceLayer === 'my-patients' ? (
        <div className="screen-stage">
          <section className="panel layer-header">
            <div>
              <span className="section-kicker">Tu base clínica</span>
              <h2>Mis pacientes</h2>
              <p className="flow-hint">Acceso directo a tus fichas, independientemente de la agenda.</p>
            </div>
            <button type="button" onClick={handleNewPatient}>+ Nuevo paciente</button>
          </section>
          <section className="panel patient-directory-panel">
            <label className="directory-search">
              <span>Buscar paciente</span>
              <input
                type="search"
                placeholder="Nombre, apellido o DNI"
                value={myPatientsQuery}
                onChange={(event) => setMyPatientsQuery(event.target.value)}
              />
            </label>
            <div className="directory-meta">
              <span>{myPatientsQuery ? `${myPatients.length} coincidencias` : 'Últimos pacientes vistos'}</span>
              <span>{patients.length} registrados</span>
            </div>
            {myPatients.length > 0 ? (
              <div className="patient-directory-grid">
                {myPatients.slice(0, myPatientsQuery ? myPatients.length : 5).map((patient) => {
                  const lastConsultation = [...patient.consultations].sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0]
                  return (
                    <article className="patient-directory-card" key={patient.id}>
                      <div className="patient-directory-avatar">{(patient.apellido || patient.nombre || '?').slice(0, 1).toUpperCase()}</div>
                      <div className="patient-directory-info">
                        <strong>{patient.apellido}, {patient.nombre || 'Sin nombre'}</strong>
                        <span>DNI {patient.dni || 'Sin dato'}</span>
                        <small>{lastConsultation ? `Última consulta: ${formatShortDate(lastConsultation.date)}` : 'Sin consultas registradas'}</small>
                      </div>
                      <div className="patient-directory-actions">
                        <button type="button" onClick={() => handleSelectPatient(patient.id)}>Abrir ficha</button>
                        {patient.ownerUserId === activeUserId ? (
                          <button type="button" className="ghost danger" onClick={() => void handleDeletePatient(patient.id)}>Eliminar</button>
                        ) : null}
                        <button type="button" className="ghost" onClick={() => handleNewAppointmentModal(patient)}>Agendar</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="directory-empty"><strong>No encontramos pacientes</strong><span>Probá con otro nombre, apellido o DNI.</span></div>
            )}
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
                onClick={() => handleNewAppointmentModal(selectedPatient)}
                disabled={!selectedPatient}
                title="Agendar un turno o cita para este paciente"
              >
                📅 Agendar turno
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
                            ? formatShortDate(selectedPatient.birthDate)
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
                        {selectedPatient.birthDate ? formatShortDate(selectedPatient.birthDate) : 'Sin dato'}
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
                  Enfermedad actual (EA)
                  <textarea name="enfermedadActual" value={consultationDraft.enfermedadActual} onChange={handleConsultationDraftChange} placeholder="Relato cronológico de la novedad de hoy..." />
                </label>
                <label>
                  Examen físico
                  <textarea name="examenFisico" value={consultationDraft.examenFisico} onChange={handleConsultationDraftChange} placeholder="Signos vitales y hallazgos de hoy; dejá constancia si no se realizó." />
                </label>
                <label>
                  Impresión diagnóstica
                  <textarea name="impresionDiagnostica" value={consultationDraft.impresionDiagnostica} onChange={handleConsultationDraftChange} placeholder="Impresión o diferenciales para revisar, sin automatismos." />
                </label>
                <label>
                  Plan de manejo
                  <textarea name="planManejo" value={consultationDraft.planManejo} onChange={handleConsultationDraftChange} placeholder="Estudios, conducta, pautas de alarma y control." />
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
                  <div className="clinical-document-upload">
                    <label htmlFor="sofia-clinical-document" className="file-picker-button compact">📄 Subir laboratorio a Sofía</label>
                    <input
                      id="sofia-clinical-document"
                      className="file-input-hidden"
                      type="file"
                      accept=".pdf,.docx,.txt,.csv,.md,.json,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,application/json"
                      onChange={(event) => { void handleSofiaClinicalDocumentUpload(event) }}
                    />
                    <small>Lee PDF, DOCX e imágenes, lo agrega al borrador y permite resumirlo en la evolución.</small>
                  </div>
                  {dictating && dictationField === 'detalleAtencion' ? (
                    <small>Dictando en este recuadro...</small>
                  ) : null}
                  {!dictationAvailable ? (
                    <small>Tu navegador no soporta transcripción por voz nativa.</small>
                  ) : null}
                  <button type="button" className="ghost clinical-ai-summary-button" onClick={() => { void summarizeClinicalInterview() }} disabled={clinicalSummaryBusy || !consultationDraft.detalleAtencion.trim()}>
                    {clinicalSummaryBusy ? 'Sofía está preparando el borrador...' : '✦ Resumir interrogatorio con Sofía'}
                  </button>
                  <small>El borrador no se guarda solo. Revisalo y corregilo antes de guardar la evolución.</small>
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
                    {entry.enfermedadActual ? <p><strong>Enfermedad actual:</strong> {entry.enfermedadActual}</p> : <p>{entry.detalleAtencion}</p>}
                    {entry.examenFisico ? <p><strong>Examen físico:</strong> {entry.examenFisico}</p> : null}
                    {entry.impresionDiagnostica ? <p><strong>Impresión diagnóstica:</strong> {entry.impresionDiagnostica}</p> : null}
                    {entry.planManejo ? <p><strong>Plan de manejo:</strong> {entry.planManejo}</p> : null}
                    <p>
                      <strong>Pensamiento médico:</strong> {entry.pensamientoMedico}
                    </p>
                    <footer>
                      <p>
                        Firma: {entry.professionalSignature.fullName} (Matrícula{' '}
                        {entry.professionalSignature.licenseNumber})
                      </p>
                      <p>{entry.professionalSignature.signatureText}</p>
                      {entry.signatureSeal ? (
                        <p
                          style={{
                            fontSize: '0.78rem',
                            color: '#15803d',
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: 8,
                            padding: '6px 10px',
                            marginTop: 6,
                            wordBreak: 'break-all',
                          }}
                          title={`Documento firmado electrónicamente el ${formatDate(entry.signatureSeal.signedAt)}. El hash SHA-256 garantiza que el contenido no fue alterado desde la firma.`}
                        >
                          🔏 Firma electrónica con sello de integridad · {formatDate(entry.signatureSeal.signedAt)}
                          <br />
                          <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#166534' }}>
                            SHA-256: {entry.signatureSeal.hashSha256.slice(0, 32)}…
                          </span>
                        </p>
                      ) : null}
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
                  Usuario
                  <input value={activeUser?.username ?? ''} readOnly />
                </label>
                <label>
                  Profesión
                  <select
                    name="specialty"
                    value={profile.specialty}
                    onChange={handleProfileFieldChange}
                    disabled={Boolean(profile.specialty.trim())}
                  >
                    <option value="">Seleccioná tu profesión</option>
                    <option value="Médico">Médico</option>
                    <option value="Odontólogo">Odontólogo</option>
                    <option value="Psicólogo">Psicólogo</option>
                  </select>
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
                <section className="mercadopago-connect-card" aria-labelledby="mercadopago-connect-title">
                  <div className="mercadopago-connect-copy">
                    <span className="section-kicker">Cobros para tu consultorio</span>
                    <h3 id="mercadopago-connect-title">Mercado Pago</h3>
                    <p>
                      Conectá tu propia cuenta para que los pacientes puedan pagarte a vos. Dr Happy no recibe ni administra ese dinero.
                    </p>
                    {mercadoPagoConnected ? (
                      <small className="mercadopago-connected-status">
                        ✓ Cuenta conectada{mercadoPagoAccountEmail ? ` · ${mercadoPagoAccountEmail}` : ''}
                      </small>
                    ) : (
                      <small className="field-hint">Todavía no conectaste una cuenta.</small>
                    )}
                  </div>
                  {mercadoPagoConnected ? (
                    <div className="mercadopago-connect-actions">
                      <button type="button" className="ghost" disabled={mercadoPagoConnectionBusy} onClick={() => void handleVerifyMercadoPago()}>
                        {mercadoPagoConnectionBusy ? 'Verificando...' : 'Verificar conexión'}
                      </button>
                      <button type="button" className="ghost" disabled={mercadoPagoConnectionBusy} onClick={() => void handleDisconnectMercadoPago()}>
                        Desconectar
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="mercadopago-connect-button" disabled={mercadoPagoConnectionBusy} onClick={() => void handleConnectMercadoPago()}>
                      <span className="mercadopago-logo" aria-hidden="true">MP</span>
                      {mercadoPagoConnectionBusy ? 'Conectando...' : 'Conectar Mercado Pago'}
                    </button>
                  )}
                  {mercadoPagoVerificationMessage ? <small className="mercadopago-verification-message">{mercadoPagoVerificationMessage}</small> : null}
                </section>
                <details className="profile-advanced-settings">
                  <summary>Ajustes avanzados</summary>
                <label>
                  Link de cobro (Mercado Pago, alias o CBU)
                  <input
                    name="paymentLink"
                    placeholder="https://link.mercadopago.com.ar/... o tu alias"
                    value={profile.paymentLink ?? ''}
                    onChange={handleProfileFieldChange}
                  />
                  <span className="field-hint">
                    Opcional. Se incluye en el email de confirmación cuando cargás un monto a cobrar. El pago va
                    directo a vos: Dr Happy no participa de la transacción.
                  </span>
                </label>
                </details>
                <button type="submit">Guardar perfil</button>
              </form>
            </section>
            <details className="panel profile-password-settings">
              <summary>⚙️ Seguridad y contraseña</summary>
              <h3>Cambiar contraseña</h3>
              <form className="grid" onSubmit={handleSaveOwnPassword}>
                <label>
                  Contraseña actual
                  <input
                    type="password"
                    name="currentPassword"
                    value={passwordChangeDraft.currentPassword}
                    onChange={handlePasswordChangeField}
                    required={isSupabaseConfigured}
                  />
                </label>
                <label>
                  Nueva contraseña
                  <input
                    type="password"
                    name="newPassword"
                    value={passwordChangeDraft.newPassword}
                    onChange={handlePasswordChangeField}
                    minLength={6}
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
                    minLength={6}
                    required
                  />
                </label>
                <button type="submit">Actualizar contraseña</button>
              </form>
            </details>
            {/* Zona de auto-eliminación de cuenta (requisito de Google Play).
                Dispara el flujo completo: archivo legal + emails + baja. */}
            {!isAdminSession ? (
              <details
                className="panel profile-delete-settings"
                style={{ border: '1px solid #fca5a5', background: 'var(--surface-elevated, #fff5f5)' }}
              >
                <summary>🗑️ Eliminar mi cuenta</summary>
                <h3 style={{ color: '#b91c1c' }}>Eliminar mi cuenta</h3>
                <p className="flow-hint">
                  Podés eliminar tu cuenta de forma permanente desde acá. Antes de borrarla, el sistema genera
                  automáticamente tu <strong>archivo legal</strong> (respaldo de tu información registrada) y lo envía
                  a tu correo electrónico, conforme a la legislación vigente.
                </p>
                <p className="flow-hint" style={{ color: '#991b1b', fontWeight: 600 }}>
                  ⚠️ Esta acción es irreversible: se eliminan tu cuenta, tus pacientes, turnos y archivos.
                </p>
                <div style={{ display: 'grid', gap: 12, marginTop: 12, maxWidth: 420 }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.9rem' }}>
                    <input
                      type="checkbox"
                      checked={selfDeleteConfirm}
                      onChange={(e) => setSelfDeleteConfirm(e.target.checked)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      Entiendo que la eliminación es permanente y que recibiré una copia del archivo legal en mi
                      correo registrado.
                    </span>
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: '0.9rem' }}>
                    Contraseña actual (para confirmar tu identidad)
                    <input
                      type="password"
                      value={selfDeletePassword}
                      onChange={(e) => setSelfDeletePassword(e.target.value)}
                      placeholder="Tu contraseña"
                      autoComplete="current-password"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={selfDeleteBusy || !selfDeleteConfirm || !selfDeletePassword}
                    onClick={() => void handleSelfDeleteAccount()}
                    style={{
                      background: '#b91c1c',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '12px 16px',
                      fontWeight: 700,
                      cursor: selfDeleteBusy || !selfDeleteConfirm || !selfDeletePassword ? 'not-allowed' : 'pointer',
                      opacity: selfDeleteBusy || !selfDeleteConfirm || !selfDeletePassword ? 0.6 : 1,
                    }}
                  >
                    {selfDeleteBusy ? 'Procesando baja y archivo legal...' : 'Eliminar mi cuenta definitivamente'}
                  </button>
                </div>
              </details>
            ) : null}
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

              {/* Botón destacado Protocolos de Emergencia */}
              <button
                type="button"
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#1e3a8a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 12px rgba(30, 58, 138, 0.25)',
                }}
                onClick={() => setAmbulanceProtocolModalOpen(true)}
              >
                ⚡ Guías y Protocolos de Emergencia (IAM, PCR, ACV, Trauma, Shock, Sepsis...)
              </button>

              {ambulanceProtocolModalOpen ? (
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    background: 'rgba(15, 23, 42, 0.75)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      background: '#ffffff',
                      borderRadius: 16,
                      maxWidth: 680,
                      width: '100%',
                      maxHeight: '90vh',
                      overflowY: 'auto',
                      padding: 20,
                      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <h3 style={{ margin: 0, color: '#1e3a8a' }}>⚡ Protocolos Rápidos de Guardia y Ambulancia</h3>
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => setAmbulanceProtocolModalOpen(false)}
                      >
                        ✕ Cerrar
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 14 }}>
                      {CLINICAL_PROTOCOLS.map((proto) => (
                        <button
                          key={proto.id}
                          type="button"
                          className="ghost compact"
                          style={{
                            flex: '0 0 auto',
                            background: ambulanceSelectedProtocolId === proto.id ? '#dbeafe' : undefined,
                            borderColor: ambulanceSelectedProtocolId === proto.id ? '#2563eb' : undefined,
                            color: ambulanceSelectedProtocolId === proto.id ? '#1e40af' : undefined,
                            fontWeight: ambulanceSelectedProtocolId === proto.id ? 700 : 500,
                          }}
                          onClick={() => setAmbulanceSelectedProtocolId(proto.id)}
                        >
                          {proto.shortTitle}
                        </button>
                      ))}
                    </div>

                    {(() => {
                      const proto = CLINICAL_PROTOCOLS.find((p) => p.id === ambulanceSelectedProtocolId) ?? CLINICAL_PROTOCOLS[0]
                      return (
                        <div style={{ display: 'grid', gap: 12 }}>
                          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong style={{ color: '#0f172a', fontSize: '1.05rem' }}>{proto.title}</strong>
                              <span className={proto.severity.includes('Roja') || proto.severity.includes('Crítica') ? 'protocol-badge-red' : 'protocol-badge-yellow'}>
                                {proto.severity}
                              </span>
                            </div>
                            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: '#475569' }}>{proto.summary}</p>
                          </div>

                          <div className="protocol-section-box" style={{ padding: 12 }}>
                            <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>🚨 5 Manifestaciones prehospitalarias</h4>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem', color: '#334155', lineHeight: 1.4 }}>
                              {proto.prehospitalManifestations.keySigns.map((s, idx) => (
                                <li key={idx} style={{ marginBottom: 3 }}>{s}</li>
                              ))}
                            </ul>
                          </div>

                          {proto.prehospitalManifestations.highSuspicionRedFlags.length > 0 ? (
                            <div className="protocol-section-box" style={{ padding: 12, background: '#fff7ed', borderColor: '#fed7aa' }}>
                              <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', color: '#9a3412' }}>⚠️ Banderas rojas / no perder tiempo</h4>
                              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem', color: '#7c2d12', lineHeight: 1.4 }}>
                                {proto.prehospitalManifestations.highSuspicionRedFlags.map((s, idx) => (
                                  <li key={idx} style={{ marginBottom: 3 }}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <div className="protocol-section-box" style={{ padding: 12, background: '#fef2f2', borderColor: '#fecaca' }}>
                            <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', color: '#991b1b' }}>🚑 Manejo inmediato en Ambulancia</h4>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem', color: '#7f1d1d', lineHeight: 1.4 }}>
                              {proto.management.prehospitalAmbulance.map((s, idx) => (
                                <li key={idx} style={{ marginBottom: 3 }}>{s}</li>
                              ))}
                            </ul>
                          </div>

                          <div className="protocol-section-box" style={{ padding: 12, background: '#eff6ff', borderColor: '#bfdbfe' }}>
                            <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', color: '#1e40af' }}>🏥 Recepción en guardia / shock room</h4>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem', color: '#1e3a8a', lineHeight: 1.4 }}>
                              {proto.management.emergencyRoomShockRoom.map((s, idx) => (
                                <li key={idx} style={{ marginBottom: 3 }}>{s}</li>
                              ))}
                            </ul>
                          </div>

                          <div className="protocol-section-box" style={{ padding: 12 }}>
                            <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>💊 Dosis de carga</h4>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem', color: '#1e293b', lineHeight: 1.4 }}>
                              {proto.management.initialPharmacotherapy.map((ph, idx) => (
                                <li key={idx} style={{ marginBottom: 3 }}>
                                  <strong>{ph.drug}:</strong> {ph.dose} ({ph.route}) — <span style={{ color: '#64748b' }}>{ph.notes}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="protocol-section-box" style={{ padding: 12, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                            <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem', color: '#166534' }}>⏱️ Ventana crítica y errores a evitar</h4>
                            <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: '#166534', lineHeight: 1.4 }}>
                              <strong>Ventana:</strong> {proto.therapeuticWindow.timeframe}
                            </p>
                            <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: '#166534', lineHeight: 1.4 }}>
                              <strong>Estándar:</strong> {proto.therapeuticWindow.goldStandard}
                            </p>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem', color: '#14532d', lineHeight: 1.4 }}>
                              {proto.therapeuticWindow.contraindications.map((s, idx) => (
                                <li key={idx} style={{ marginBottom: 3 }}>{s}</li>
                              ))}
                            </ul>
                          </div>

                          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                            <button
                              type="button"
                              style={{ flex: 1, padding: '10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
                              onClick={() => {
                                setAmbulanceDraft((prev) => ({
                                  ...prev,
                                  diagnosticoFinal: prev.diagnosticoFinal
                                    ? `${prev.diagnosticoFinal} · [Conducta]: ${proto.actionCopyTemplate}`
                                    : `[Conducta]: ${proto.actionCopyTemplate}`,
                                }))
                                setAmbulanceProtocolModalOpen(false)
                                showSavedFloatingNotice('Protocolo insertado en diagnóstico final')
                              }}
                            >
                              📋 Insertar conducta en ficha de traslado
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                navigator.clipboard?.writeText(proto.actionCopyTemplate)
                                showSavedFloatingNotice('Copiado al portapapeles')
                              }}
                            >
                              Copiar texto
                            </button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              ) : null}

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
      {paymentTarget ? (() => {
        const entry = treatmentLedger.find((e) => e.id === paymentTarget.entryId)
        if (!entry) return null
        const pending = entry.totalAmount - entry.paidAmount
        return (
          <div className="drhappy-modal-overlay" onClick={() => setPaymentTarget(null)}>
            <div
              className="drhappy-modal-card turnera-modal-card"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Registrar pago"
            >
              <div className="drhappy-modal-header">
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>💵 Registrar pago</h3>
                <button
                  type="button"
                  className="drhappy-modal-close-btn"
                  onClick={() => setPaymentTarget(null)}
                  aria-label="Cerrar ventana"
                >
                  ✕
                </button>
              </div>
              <div className="turnera-modal-body">
                <p style={{ margin: '0 0 4px' }}>
                  <strong>{entry.patientName}</strong> — {entry.intervention}
                </p>
                <p className="flow-hint" style={{ margin: '0 0 12px' }}>
                  Saldo pendiente: <strong>{formatMoney(pending)}</strong>
                </p>
                <label>
                  ¿Cuánto abona ahora?
                  <input
                    type="number"
                    min="0"
                    max={pending}
                    autoFocus
                    value={paymentTarget.amount}
                    onChange={(e) =>
                      setPaymentTarget((prev) => (prev ? { ...prev, amount: e.target.value } : prev))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleConfirmLedgerPayment()
                      }
                    }}
                  />
                </label>
                <div className="turnera-modal-actions">
                  <button type="button" className="ghost" onClick={() => setPaymentTarget(null)}>
                    Cancelar
                  </button>
                  <button type="button" onClick={handleConfirmLedgerPayment}>
                    Confirmar pago
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })() : null}
      {ledgerModalOpen && ledgerDraft ? (
        <div className="drhappy-modal-overlay" onClick={() => setLedgerModalOpen(false)}>
          <div
            className="drhappy-modal-card turnera-modal-card"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              const element = e.currentTarget
              if (element.scrollHeight > element.clientHeight) {
                element.scrollTop += e.deltaY
                e.preventDefault()
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-modal-title"
          >
            <div className="drhappy-modal-header">
              <h3 id="ledger-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>
                {ledgerDraft.id ? '✏️ Editar intervención' : '💰 Registrar intervención'}
              </h3>
              <button
                type="button"
                className="drhappy-modal-close-btn"
                onClick={() => setLedgerModalOpen(false)}
                aria-label="Cerrar ventana"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLedgerEntry} className="turnera-modal-form">
              <div className="turnera-form-group">
                <label>
                  Paciente *
                  <div className="patient-autocomplete">
                    <input
                      type="text"
                      required
                      autoComplete="off"
                      placeholder="Escribí apellido, nombre o DNI"
                      value={ledgerDraft.patientName}
                      onChange={(e) => {
                        const value = e.target.value
                        setLedgerDraft((prev) => (prev ? { ...prev, patientName: value, patientId: '' } : prev))
                        setLedgerPatientQuery(value)
                        setLedgerSuggestionsOpen(true)
                      }}
                      onFocus={() => setLedgerSuggestionsOpen(true)}
                      onBlur={() => window.setTimeout(() => setLedgerSuggestionsOpen(false), 150)}
                    />
                    {ledgerSuggestionsOpen && ledgerPatientSuggestions.length > 0 ? (
                      <ul className="patient-autocomplete-list">
                        {ledgerPatientSuggestions.map((patient) => (
                          <li key={patient.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                const displayName = `${patient.apellido}${patient.nombre ? `, ${patient.nombre}` : ''}`.trim()
                                setLedgerDraft((prev) =>
                                  prev ? { ...prev, patientId: patient.id, patientName: displayName } : prev,
                                )
                                setLedgerPatientQuery('')
                                setLedgerSuggestionsOpen(false)
                              }}
                            >
                              <strong>
                                {`${patient.apellido}${patient.nombre ? `, ${patient.nombre}` : ''}`.trim()}
                              </strong>
                              <span>{patient.dni ? `DNI ${patient.dni}` : 'Sin DNI'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </label>
              </div>

              <div className="turnera-form-group">
                <label>
                  Intervención realizada *
                  <input
                    type="text"
                    required
                    placeholder="Ej: Conducto molar superior derecho"
                    value={ledgerDraft.intervention}
                    onChange={(e) =>
                      setLedgerDraft((prev) => (prev ? { ...prev, intervention: e.target.value } : prev))
                    }
                  />
                </label>
              </div>

              <div className="turnera-form-row">
                <label style={{ flex: 1 }}>
                  Fecha
                  <input
                    type="date"
                    value={ledgerDraft.date}
                    onChange={(e) => setLedgerDraft((prev) => (prev ? { ...prev, date: e.target.value } : prev))}
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Total del tratamiento *
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder="Ej: 45000"
                    value={ledgerDraft.totalAmount}
                    onChange={(e) =>
                      setLedgerDraft((prev) =>
                        prev ? { ...prev, totalAmount: e.target.value.replace(/[^\d.,]/g, '') } : prev,
                      )
                    }
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Abonado ahora
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ej: 20000"
                    value={ledgerDraft.paidAmount}
                    onChange={(e) =>
                      setLedgerDraft((prev) =>
                        prev ? { ...prev, paidAmount: e.target.value.replace(/[^\d.,]/g, '') } : prev,
                      )
                    }
                  />
                </label>
              </div>

              {(() => {
                const total = Number(ledgerDraft.totalAmount.replace(',', '.'))
                const paid = ledgerDraft.paidAmount.trim() ? Number(ledgerDraft.paidAmount.replace(',', '.')) : 0
                if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(paid)) return null
                const pending = total - paid
                return (
                  <div className={`payment-info-note ${pending > 0 ? 'warn' : 'ok'}`}>
                    {pending > 0
                      ? `Queda un saldo pendiente de ${formatMoney(pending)}.`
                      : '✅ El tratamiento queda saldado por completo.'}
                  </div>
                )
              })()}

              <div className="turnera-form-group">
                <label>
                  Notas (opcional)
                  <textarea
                    rows={2}
                    placeholder="Ej: Continúa con la segunda sesión el mes próximo"
                    value={ledgerDraft.notes}
                    onChange={(e) => setLedgerDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                  />
                </label>
              </div>

              <div className="turnera-modal-actions">
                <button type="button" className="ghost" onClick={() => setLedgerModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit">{ledgerDraft.id ? 'Guardar cambios' : 'Registrar'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

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

      {/* Modal Central de Instalación de la App */}
      {showInstallToast ? (
        <div className="center-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="install-modal-title">
          <div className="center-modal-card">
            <div className="center-modal-icon-bubble" aria-hidden="true">
              📲
            </div>
            <h3 id="install-modal-title" className="center-modal-title">
              Instalá Dr. Happy en tu dispositivo
            </h3>
            <p className="center-modal-description">
              Agregá Dr. Happy directamente a la pantalla de inicio de tu celular o computadora para abrirla en 1 toque, recibir alertas en tiempo real y trabajar a pantalla completa sin distracciones.
            </p>
            <div className="center-modal-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleInstallApp()}
              >
                📲 Instalar Dr. Happy ahora
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleDismissInstallToast}
              >
                Continuar en el navegador por ahora
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Central de Activación de Notificaciones */}
      {!showInstallToast && showNotificationToast && notificationPermission !== 'granted' ? (
        <div
          className="center-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-modal-title"
        >
          <div className={`center-modal-card ${notificationPermission === 'denied' ? 'denied' : ''}`}>
            <div className="center-modal-icon-bubble" aria-hidden="true">
              {notificationPermission === 'denied' ? '⚠️' : '🔔'}
            </div>
            <h3 id="notification-modal-title" className="center-modal-title">
              {notificationPermission === 'denied'
                ? 'Notificaciones bloqueadas en tu navegador'
                : 'Activá las Notificaciones de Dr. Happy'}
            </h3>
            
            {notificationPermission === 'denied' ? (
              <>
                <p className="center-modal-description">
                  Las notificaciones ya fueron bloqueadas por el navegador. Por seguridad, Dr. Happy no puede volver a abrir el permiso automáticamente: hay que desbloquearlo una vez desde el candado o desde ajustes del sistema.
                </p>
                <div className="center-modal-instructions-box">
                  <div>📱 <strong>Android/Chrome:</strong> Tocá el candado 🔒 junto a <code>drhappy.com.ar</code> ➔ <em>Permisos / Notificaciones</em> ➔ <strong>Permitir</strong>. Si no aparece, entrá a <em>Ajustes del sitio</em>.</div>
                  <div>🍎 <strong>En iPhone (iOS):</strong> Abrí <em>Ajustes de iOS</em> ➔ <em>Notificaciones</em> ➔ <em>Dr. Happy</em> ➔ <strong>Permitir</strong>.</div>
                  <div>💻 <strong>En Computadora:</strong> Hacé clic en el candado 🔒 a la izquierda de la URL ➔ <em>Notificaciones</em> ➔ <strong>Permitir</strong>.</div>
                </div>
                <div className="center-modal-actions">
                  <button
                    type="button"
                    className="unblock-btn"
                    onClick={() => {
                      const p = getNotificationPermission()
                      setNotificationPermission(p)
                      if (p === 'granted') {
                        if (activeUserId) void registerPushSubscription(activeUserId)
                        setShowNotificationToast(false)
                        showSavedFloatingNotice('¡Notificaciones activadas con éxito!')
                      } else {
                        setAppError('Aún figuran bloqueadas en el navegador. Cambiá el permiso en el candado 🔒 arriba y volvé a presionar este botón.')
                      }
                    }}
                  >
                    🔄 Ya las desbloqueé (Re-verificar)
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleDismissNotificationToast}
                  >
                    Entendido, no volver a mostrar por 7 días
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="center-modal-description">
                  Recibí avisos inmediatos cuando un colega te envíe un mensaje privado, el administrador publique novedades de guardia o se agende un turno médico. Si el navegador muestra una ventana de permiso, elegí <strong>Permitir</strong>.
                </p>
                <div className="center-modal-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => void handleEnableNotifications()}
                  >
                    🔔 Abrir permiso del navegador
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleDismissNotificationToast}
                  >
                    Ahora no, recordar en 7 días
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {appointmentModalOpen ? (
        <div className="drhappy-modal-overlay" onClick={() => setAppointmentModalOpen(false)}>
          <div
            className="drhappy-modal-card turnera-modal-card"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              const element = e.currentTarget
              if (element.scrollHeight > element.clientHeight) {
                element.scrollTop += e.deltaY
                e.preventDefault()
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="appointment-modal-title"
          >
            <div className="drhappy-modal-header">
              <h3 id="appointment-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>
                {appointmentDraft.id ? '✏️ Modificar Turno' : '📅 Agendar Nuevo Turno'}
              </h3>
              <button
                type="button"
                className="drhappy-modal-close-btn"
                onClick={() => setAppointmentModalOpen(false)}
                aria-label="Cerrar ventana"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveAppointment(e)} className="turnera-modal-form">
              <div className="turnera-form-group">
                <label>
                  Paciente (Apellido y Nombre) *
                  <div className="patient-autocomplete">
                    <input
                      type="text"
                      required
                      autoComplete="off"
                      placeholder="Escribí apellido, nombre o DNI para buscar"
                      value={appointmentDraft.patientName}
                      onChange={(e) => {
                        const value = e.target.value
                        // Al reescribir el nombre se desvincula la ficha elegida,
                        // para no asociar el turno a un paciente equivocado.
                        setAppointmentDraft((prev) => ({ ...prev, patientName: value, patientId: '' }))
                        setAppointmentPatientQuery(value)
                        setAppointmentSuggestionsOpen(true)
                      }}
                      onFocus={() => setAppointmentSuggestionsOpen(true)}
                      onBlur={() => window.setTimeout(() => setAppointmentSuggestionsOpen(false), 150)}
                    />
                    {appointmentSuggestionsOpen && appointmentPatientSuggestions.length > 0 ? (
                      <ul className="patient-autocomplete-list">
                        {appointmentPatientSuggestions.map((patient) => (
                          <li key={patient.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSelectAppointmentPatient(patient)}
                            >
                              <strong>
                                {`${patient.apellido}${patient.nombre ? `, ${patient.nombre}` : ''}`.trim()}
                              </strong>
                              <span>
                                {patient.dni ? `DNI ${patient.dni}` : 'Sin DNI'}
                                {patient.consultations.length > 0
                                  ? ` · ${patient.consultations.length} ${patient.consultations.length === 1 ? 'atención registrada' : 'atenciones registradas'}`
                                  : ' · Sin atenciones previas'}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {appointmentDraft.patientId ? (
                    <span className="patient-linked-hint">
                      ✅ Vinculado a la ficha existente — el turno quedará en su historia clínica
                    </span>
                  ) : appointmentPatientQuery.trim().length >= 2 && appointmentPatientSuggestions.length === 0 ? (
                    <span className="field-hint">
                      No hay pacientes con ese dato. Se creará una ficha nueva al guardar.
                    </span>
                  ) : null}
                </label>
              </div>

              <div className="turnera-form-row">
                <label style={{ flex: 1 }}>
                  DNI
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ej: 32456789"
                    value={appointmentDraft.patientDni}
                    onChange={(e) =>
                      setAppointmentDraft((prev) => ({ ...prev, patientDni: e.target.value.replace(/\D/g, '') }))
                    }
                  />
                </label>
                <label style={{ flex: 1.5 }}>
                  Email del paciente
                  <input
                    type="email"
                    placeholder="paciente@correo.com"
                    value={appointmentDraft.patientEmail}
                    onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, patientEmail: e.target.value }))}
                  />
                  {appointmentDraft.patientEmail.trim() && !isValidEmail(appointmentDraft.patientEmail.trim()) ? (
                    <span className="field-error-hint">Ingresá un email con formato válido (ej: nombre@dominio.com)</span>
                  ) : null}
                </label>
              </div>

              <div className="turnera-form-row">
                <label style={{ flex: 1 }}>
                  Fecha *
                  <input
                    type="date"
                    required
                    value={appointmentDraft.scheduledDate}
                    onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, scheduledDate: e.target.value }))}
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Hora *
                  <input
                    type="time"
                    required
                    value={appointmentDraft.scheduledTime}
                    onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, scheduledTime: e.target.value }))}
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Duración
                  <select
                    value={appointmentDraft.durationMinutes}
                    onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, durationMinutes: Number(e.target.value) }))}
                  >
                    {[15, 20, 30, 45, 60, 90].map((minutes) => (
                      <option key={minutes} value={minutes}>{minutes} minutos</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="turnera-form-group">
                <label>
                  Lugar / Consultorio
                  <input
                    type="text"
                    placeholder="Ej: Consultorio 3 · Hospital Central / Telemedicina"
                    value={appointmentDraft.location}
                    onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, location: e.target.value }))}
                  />
                </label>
              </div>

              <div className="turnera-form-group">
                <label>
                  Motivo de consulta / Diagnóstico presuntivo
                  <input
                    type="text"
                    placeholder="Ej: Control de hipertensión / Examen preocupacional"
                    value={appointmentDraft.reason}
                    onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, reason: e.target.value }))}
                  />
                </label>
              </div>

              <div className="turnera-form-group">
                <label>
                  Observaciones e indicaciones previas
                  <textarea
                    rows={2}
                    placeholder="Ej: Concurrir en ayunas de 8 hs con estudios previos..."
                    value={appointmentDraft.notes}
                    onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </label>
              </div>

              <div className="turnera-form-row">
                <label style={{ flex: 1 }}>
                  Monto a cobrar (opcional)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ej: 25000"
                    value={appointmentDraft.amountToCharge}
                    onChange={(e) =>
                      setAppointmentDraft((prev) => ({
                        ...prev,
                        amountToCharge: e.target.value.replace(/[^\d.,]/g, ''),
                      }))
                    }
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Concepto
                  <select
                    value={appointmentDraft.amountConcept}
                    onChange={(e) =>
                      setAppointmentDraft((prev) => ({
                        ...prev,
                        amountConcept: e.target.value as 'sena' | 'consulta',
                      }))
                    }
                    disabled={!appointmentDraft.amountToCharge.trim()}
                  >
                    <option value="consulta">Valor de la consulta</option>
                    <option value="sena">Seña para reservar</option>
                  </select>
                </label>
              </div>

              {appointmentDraft.amountToCharge.trim() ? (
                (() => {
                  const link = profile?.paymentLink?.trim() || ''
                  if (!link) {
                    return (
                      <p className="payment-info-note warn">
                        ⚠️ El email va a mostrar el monto, pero sin botón de pago. Cargá tu link de cobro en{' '}
                        <strong>Perfil</strong> para que el paciente pueda pagarte online.
                      </p>
                    )
                  }
                  if (!isNavigablePaymentLink(link)) {
                    return (
                      <p className="payment-info-note warn">
                        ⚠️ Guardaste <strong>{link}</strong> como alias, no como link. El email va a mostrarlo para
                        que el paciente transfiera, pero sin botón. Si querés el botón <strong>Pagar ahora</strong>,
                        pegá en <strong>Perfil</strong> el link completo de Mercado Pago (empieza con{' '}
                        <code>https://</code>).
                      </p>
                    )
                  }
                  return (
                    <p className="payment-info-note ok">
                      ✅ El email incluirá el monto y tu botón de pago. El paciente te paga directo a vos.
                    </p>
                  )
                })()
              ) : null}

              <label className="toggle-option" style={{ marginTop: 4, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={appointmentDraft.sendEmailConfirmation}
                  onChange={(e) => setAppointmentDraft((prev) => ({ ...prev, sendEmailConfirmation: e.target.checked }))}
                />
                <span className="toggle-switch" />
                <span>
                  Enviar confirmación automática por email (<strong>soporte@drhappy.com.ar</strong>)
                </span>
              </label>

              <div className="drhappy-modal-footer" style={{ marginTop: 12 }}>
                <button type="submit" disabled={appointmentSaving}>
                  {appointmentSaving ? 'Guardando turno...' : appointmentDraft.id ? 'Guardar cambios' : 'Agendar turno'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setAppointmentModalOpen(false)}
                  disabled={appointmentSaving}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {freeSlotModalOpen ? (
        <div className="drhappy-modal-overlay" onClick={() => setFreeSlotModalOpen(false)}>
          <div
            className="drhappy-modal-card turnera-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="free-slot-modal-title"
          >
            <div className="drhappy-modal-header">
              <h3 id="free-slot-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>
                📲 Enviar turnera libre al paciente
              </h3>
              <button
                type="button"
                className="drhappy-modal-close-btn"
                onClick={() => setFreeSlotModalOpen(false)}
                aria-label="Cerrar ventana"
              >
                ✕
              </button>
            </div>

            <p className="flow-hint" style={{ marginTop: 0 }}>
              Configurá una agenda pública permanente. El paciente podrá elegir semanas futuras y la reserva se
              cargará automáticamente en tu Turnera.
            </p>

            <section className="panel public-booking-config" style={{ margin: '14px 0', padding: 16, background: '#f8fbff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <span className="section-kicker">Link fijo profesional</span>
                  <h4 style={{ margin: '4px 0 6px', fontSize: '1.05rem' }}>Liberar turnos para pacientes</h4>
                  <p className="flow-hint" style={{ margin: 0 }}>
                    El paciente verá los turnos que liberes durante los próximos 60 días y podrá elegir PAMI o
                    particular según el bloque que configures.
                  </p>
                </div>
                {publicBookingSettings ? (
                  <label className="toggle-option" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={publicBookingSettings.enabled}
                      onChange={(event) => setPublicBookingSettings((current) => current ? { ...current, enabled: event.target.checked } : current)}
                    />
                    <span className="toggle-switch" />
                    <span>{publicBookingSettings.enabled ? 'Activa' : 'Pausada'}</span>
                  </label>
                ) : null}
              </div>

              {publicBookingLoading ? <p className="flow-hint">Cargando configuración pública...</p> : null}

              {publicBookingSettings ? (
                <>
                  <div className="turnera-form-row" style={{ marginTop: 12 }}>
                    <label style={{ flex: 1.2 }}>
                      Link corto
                      <div className="public-booking-url-row">
                        <span>drhappy.com.ar/turnera/?p=</span>
                        <input
                          type="text"
                          value={publicBookingSettings.slug}
                          onChange={(event) => setPublicBookingSettings((current) => current ? { ...current, slug: buildDefaultPublicBookingSlug(event.target.value, activeUserId || 'user') } : current)}
                        />
                      </div>
                    </label>
                    <div className="public-booking-horizon-note">Disponibilidad visible: próximos 60 días</div>
                  </div>

                  <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                    {publicBookingSettings.blocks.map((block) => {
                      const blockCapacity = Math.floor((parseTimeMinutes(block.endTime) - parseTimeMinutes(block.startTime)) / block.durationMinutes)
                      return (
                        <article key={block.id} style={{ border: '1px solid #d8e2ee', borderRadius: 12, padding: 12, background: '#fff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong>{block.modality === 'private' ? 'Paciente particular' : 'Paciente con obra social'}</strong>
                            <button type="button" className="ghost compact" onClick={() => removePublicBookingBlock(block.id)} disabled={publicBookingSettings.blocks.length <= 1}>
                              Eliminar
                            </button>
                          </div>
                          <div className="turnera-form-row">
                            <label style={{ flex: 1 }}>
                              Tipo de turno
                              <select
                                value={block.modality}
                                onChange={(event) => updatePublicBookingBlock(block.id, {
                                  modality: event.target.value as 'coverage' | 'private',
                                  amountToCharge: event.target.value === 'private' ? block.amountToCharge || 25000 : undefined,
                                  amountConcept: event.target.value === 'private' ? block.amountConcept || 'consulta' : undefined,
                                  paymentLink: event.target.value === 'private' ? block.paymentLink || profile?.paymentLink?.trim() || '' : undefined,
                                })}
                              >
                                <option value="coverage">Obra social / sin pago online</option>
                                <option value="private">Particular / con pago</option>
                              </select>
                            </label>
                          </div>
                          <div className="capacity-days" style={{ marginTop: 8 }}>
                            <span>Días</span>
                            <div>
                              {WEEK_DAYS.map((day) => (
                                <label key={`${block.id}-${day.value}`} className="capacity-day-option">
                                  <input
                                    type="checkbox"
                                    checked={block.days.includes(day.value)}
                                    onChange={() => togglePublicBookingBlockDay(block.id, day.value)}
                                  />
                                  <span>{day.label.slice(0, 3)}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="turnera-form-row">
                            <label style={{ flex: 1 }}>
                              Desde
                              <input type="time" value={block.startTime} onChange={(event) => updatePublicBookingBlock(block.id, { startTime: event.target.value })} />
                            </label>
                            <label style={{ flex: 1 }}>
                              Hasta
                              <input type="time" value={block.endTime} onChange={(event) => updatePublicBookingBlock(block.id, { endTime: event.target.value })} />
                            </label>
                            <label style={{ flex: 1 }}>
                              Duración
                              <select value={block.durationMinutes} onChange={(event) => updatePublicBookingBlock(block.id, { durationMinutes: Number(event.target.value) })}>
                                <option value={15}>15 min</option>
                                <option value={20}>20 min</option>
                                <option value={30}>30 min</option>
                                <option value={45}>45 min</option>
                                <option value={60}>60 min</option>
                              </select>
                            </label>
                            <label style={{ flex: 1 }}>
                              Cupos
                              <input type="number" min={1} max={50} value={block.slotCount} onChange={(event) => updatePublicBookingBlock(block.id, { slotCount: Number(event.target.value) })} />
                            </label>
                          </div>
                          <small className={block.slotCount <= blockCapacity ? 'flow-hint' : 'freeslot-capacity-note error'}>
                            Capacidad del rango: {Math.max(0, blockCapacity)} turno(s). Configurado: {block.slotCount}.
                          </small>
                          <div className="turnera-form-row">
                            <label style={{ flex: 1 }}>
                              Lugar / consultorio
                              <input type="text" placeholder="Opcional" value={block.location || ''} onChange={(event) => updatePublicBookingBlock(block.id, { location: event.target.value })} />
                            </label>
                            <label style={{ flex: 1 }}>
                              Motivo del turno
                              <input type="text" placeholder="Ej: Control PAMI / Consulta particular" value={block.reason || ''} onChange={(event) => updatePublicBookingBlock(block.id, { reason: event.target.value })} />
                            </label>
                          </div>
                          {block.modality === 'private' ? (
                            <div className="turnera-form-row">
                              <label style={{ flex: 1 }}>
                                Monto
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={block.amountToCharge ? String(block.amountToCharge) : ''}
                                  onChange={(event) => updatePublicBookingBlock(block.id, { amountToCharge: Number(event.target.value.replace(',', '.')) || undefined })}
                                />
                              </label>
                              <label style={{ flex: 1 }}>
                                Concepto
                                <select value={block.amountConcept || 'consulta'} onChange={(event) => updatePublicBookingBlock(block.id, { amountConcept: event.target.value as 'sena' | 'consulta' })}>
                                  <option value="consulta">Consulta</option>
                                  <option value="sena">Seña</option>
                                </select>
                              </label>
                              <label style={{ flex: 2 }}>
                                Link o alias de pago
                                <input type="text" value={block.paymentLink || ''} onChange={(event) => updatePublicBookingBlock(block.id, { paymentLink: event.target.value })} />
                              </label>
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  </div>

                  {publicBookingError ? <p style={{ color: '#c62828', fontSize: '0.9rem' }}>{publicBookingError}</p> : null}
                  {publicBookingNotice ? <p className="payment-info-note ok">✅ {publicBookingNotice}</p> : null}

                  <div className="public-booking-links-grid">
                    {(['coverage', 'private'] as const).map((modality) => {
                      const url = buildFixedPublicBookingUrl(publicBookingSettings.slug, modality)
                      const label = modality === 'coverage' ? 'Turnera libre para obra social' : 'Turnera libre para particular'
                      return (
                        <div className="public-booking-link-card" key={modality}>
                          <strong>{label}</strong>
                          <span>{url}</span>
                          <div>
                            <button type="button" onClick={() => void handleSavePublicBookingSettings()} disabled={publicBookingSaving}>
                              {publicBookingSaving ? 'Guardando...' : 'Guardar turnera'}
                            </button>
                            <button type="button" className="ghost" onClick={() => window.open(buildWhatsAppShareUrl(url, publicBookingSettings.professionalName), '_blank', 'noopener,noreferrer')}>
                              WhatsApp
                            </button>
                            <button type="button" className="ghost" onClick={() => { void navigator.clipboard.writeText(url); showSavedFloatingNotice('Link copiado') }}>
                              Copiar link
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </section>

            {freeSlotCapacity ? (<div style={{ display: 'none' }}><>
            <div style={{ margin: '18px 0 10px' }}>
              <span className="section-kicker">Enlace puntual</span>
            </div>

            <div className="turnera-form-row">
              <label style={{ flex: 1 }}>
                Fecha *
                <input
                  type="date"
                  required
                  value={freeSlotDraft.slotDate}
                  onChange={(e) => setFreeSlotDraft((prev) => ({ ...prev, slotDate: e.target.value }))}
                />
              </label>
              <label style={{ flex: 1 }}>
                Cantidad de turnos libres *
                <input
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={freeSlotDraft.slotCount}
                  onChange={(e) => setFreeSlotDraft((prev) => ({ ...prev, slotCount: Number(e.target.value) }))}
                />
              </label>
            </div>

            <div className="turnera-form-row">
              <label style={{ flex: 1 }}>
                Desde *
                <input
                  type="time"
                  required
                  value={freeSlotDraft.startTime}
                  onChange={(e) => setFreeSlotDraft((prev) => ({ ...prev, startTime: e.target.value }))}
                />
              </label>
              <label style={{ flex: 1 }}>
                Hasta *
                <input
                  type="time"
                  required
                  value={freeSlotDraft.endTime}
                  onChange={(e) => setFreeSlotDraft((prev) => ({ ...prev, endTime: e.target.value }))}
                />
              </label>
            </div>

            <div className="turnera-form-row">
              <label style={{ flex: 1 }}>
                Duración de cada consulta *
                <select
                  value={freeSlotDraft.durationMinutes}
                  onChange={(e) => setFreeSlotDraft((prev) => ({ ...prev, durationMinutes: Number(e.target.value) }))}
                >
                  <option value={15}>15 minutos</option>
                  <option value={30}>30 minutos</option>
                  <option value={45}>45 minutos</option>
                  <option value={60}>60 minutos</option>
                </select>
              </label>
            </div>

            {freeSlotCapacity ? (
              freeSlotCapacity.invalidRange ? (
                <p className="freeslot-capacity-note error">
                  ⚠️ El horario <strong>Hasta</strong> debe ser posterior al horario <strong>Desde</strong>.
                </p>
              ) : freeSlotCapacity.fits ? (
                <p className="freeslot-capacity-note ok">
                  ✅ Entran {freeSlotCapacity.requested} turno(s) de {freeSlotDraft.durationMinutes} min en{' '}
                  {formatMinutesLabel(freeSlotCapacity.rangeMinutes)}
                  {freeSlotCapacity.maxSlots > freeSlotCapacity.requested
                    ? ` (capacidad máxima del rango: ${freeSlotCapacity.maxSlots}).`
                    : ' (usás el rango completo).'}
                </p>
              ) : (
                <p className="freeslot-capacity-note error">
                  ⚠️ No entran {freeSlotCapacity.requested} turnos de {freeSlotDraft.durationMinutes} min en{' '}
                  {formatMinutesLabel(freeSlotCapacity.rangeMinutes)}. Entran como máximo{' '}
                  <strong>{freeSlotCapacity.maxSlots}</strong>. Para {freeSlotCapacity.requested} turnos necesitás un
                  rango de al menos <strong>{formatMinutesLabel(freeSlotCapacity.requiredMinutes)}</strong>.
                  {freeSlotCapacity.maxSlots > 0 ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() =>
                          setFreeSlotDraft((prev) => ({ ...prev, slotCount: freeSlotCapacity.maxSlots }))
                        }
                      >
                        Ajustar a {freeSlotCapacity.maxSlots} turnos
                      </button>
                    </>
                  ) : null}
                  {' '}
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={() => {
                      const [h, m] = freeSlotDraft.startTime.split(':').map(Number)
                      const endTotal = h * 60 + m + freeSlotCapacity.requiredMinutes
                      const endH = Math.floor(endTotal / 60)
                      const endM = endTotal % 60
                      if (endH >= 24) {
                        setFreeSlotError('El rango necesario supera el fin del día. Reducí la cantidad de turnos.')
                        return
                      }
                      setFreeSlotError(null)
                      setFreeSlotDraft((prev) => ({
                        ...prev,
                        endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
                      }))
                    }}
                  >
                    Extender horario automáticamente
                  </button>
                </p>
              )
            ) : null}

            <div className="turnera-form-group">
              <label>
                Lugar / Consultorio
                <input
                  type="text"
                  placeholder="Ej: Consultorio 3 · Hospital Central"
                  value={freeSlotDraft.location}
                  onChange={(e) => setFreeSlotDraft((prev) => ({ ...prev, location: e.target.value }))}
                />
              </label>
            </div>

            <div className="turnera-form-group">
              <label>
                Motivo (opcional)
                <input
                  type="text"
                  placeholder="Ej: Primera consulta"
                  value={freeSlotDraft.reason}
                  onChange={(e) => setFreeSlotDraft((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </label>
            </div>

            <div className="turnera-form-row">
              <label style={{ flex: 1 }}>
                Monto a cobrar (opcional)
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Ej: 25000"
                  value={freeSlotDraft.amountToCharge}
                  onChange={(e) =>
                    setFreeSlotDraft((prev) => ({
                      ...prev,
                      amountToCharge: e.target.value.replace(/[^\d.,]/g, ''),
                    }))
                  }
                />
              </label>
              <label style={{ flex: 1 }}>
                Concepto
                <select
                  value={freeSlotDraft.amountConcept}
                  onChange={(e) =>
                    setFreeSlotDraft((prev) => ({
                      ...prev,
                      amountConcept: e.target.value as 'sena' | 'consulta',
                    }))
                  }
                  disabled={!freeSlotDraft.amountToCharge.trim()}
                >
                  <option value="consulta">Valor de la consulta</option>
                  <option value="sena">Seña para reservar</option>
                </select>
              </label>
            </div>

            {freeSlotDraft.amountToCharge.trim() ? (
              (() => {
                const link = profile?.paymentLink?.trim() || ''
                if (!link) {
                  return (
                    <p className="payment-info-note warn">
                      ⚠️ El paciente va a ver el monto, pero sin botón de pago. Cargá tu link de cobro en{' '}
                      <strong>Perfil</strong> para que pueda pagarte online.
                    </p>
                  )
                }
                if (!isNavigablePaymentLink(link)) {
                  return (
                    <p className="payment-info-note warn">
                      ⚠️ Guardaste <strong>{link}</strong> como alias. El paciente lo verá para transferir, pero sin
                      botón. Para el botón <strong>Pagar ahora</strong>, pegá en <strong>Perfil</strong> el link
                      completo de Mercado Pago.
                    </p>
                  )
                }
                return (
                  <p className="payment-info-note ok">
                    ✅ El paciente verá el monto y tu botón de pago al elegir su turno.
                  </p>
                )
              })()
            ) : null}

            {freeSlotError ? (
              <p style={{ color: '#c62828', fontSize: '0.9rem' }}>{freeSlotError}</p>
            ) : null}
            {freeSlotGeneratedUrl ? (
              <div className="turnera-form-group" style={{ background: '#e9f8f0', borderRadius: 10, padding: 12 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600 }}>✅ Enlace generado</p>
                <p style={{ margin: '0 0 10px', wordBreak: 'break-all', fontSize: '0.85rem' }}>{freeSlotGeneratedUrl}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => handleShareFreeSlotLink(freeSlotGeneratedUrl!)}>
                    💬 Compartir por WhatsApp
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(freeSlotGeneratedUrl!)
                      showSavedFloatingNotice('Enlace copiado al portapapeles')
                    }}
                  >
                    📋 Copiar enlace
                  </button>
                </div>
              </div>
            ) : null}

            <div className="drhappy-modal-footer" style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void handleCreateFreeSlotLink()}
                disabled={freeSlotSaving || Boolean(freeSlotCapacity && !freeSlotCapacity.fits)}
              >
                {freeSlotSaving ? 'Generando enlace...' : 'Generar enlace de turnos libres'}
              </button>
              <button type="button" className="ghost" onClick={() => setFreeSlotModalOpen(false)}>
                Cerrar
              </button>
            </div>

            {freeSlotLinks.length > 0 ? (
              <div style={{ marginTop: 18 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Enlaces activos</h4>
                {freeSlotLinksLoading ? <p className="flow-hint">Cargando...</p> : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {freeSlotLinks
                    .filter((l) => l.status === 'active')
                    .map((l) => (
                      <div
                        key={l.id}
                        style={{
                          border: '1px solid #d8e2ee',
                          borderRadius: 10,
                          padding: '8px 12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: '0.88rem' }}>
                          📅 {l.slot_date} · {l.start_time}–{l.end_time} hs · {l.bookedSlots}/{l.totalSlots} reservados
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="ghost" onClick={() => handleShareFreeSlotLink(buildPublicBookingUrl(l.token))}>
                            💬
                          </button>
                          <button type="button" className="ghost" onClick={() => void handleCancelFreeSlotLink(l.id)}>
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
            </></div>) : null}
          </div>
        </div>
      ) : null}
      {sofiaOpen ? (
        <div className="drhappy-modal-overlay" onClick={() => setSofiaOpen(false)}>
          <div className="drhappy-modal-card sofia-modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sofia-title">
            <div className="drhappy-modal-header">
              <div>
                <span className="section-kicker">Secretaria clínica</span>
                <div className="sofia-title-group">
                  <SofiaAvatar state={sofiaBusy ? 'thinking' : sofiaDictating ? 'listening' : sofiaPendingConfirmation ? 'ready' : 'idle'} />
                  <div>
                    <h3 id="sofia-title" style={{ margin: 0, fontSize: '1.3rem', color: '#0f172a' }}>✦ Sofía</h3>
                    <small className="sofia-state-label">{sofiaBusy ? 'Preparando respuesta' : sofiaDictating ? 'Escuchando' : sofiaPendingConfirmation ? 'Lista para confirmar' : 'Disponible'}</small>
                  </div>
                </div>
              </div>
              <button type="button" className="drhappy-modal-close-btn" onClick={() => setSofiaOpen(false)} aria-label="Cerrar Sofía">✕</button>
            </div>
            <p className="sofia-intro">Tu secretaria clínica para consultar la agenda, preparar información y ejecutar acciones con tu confirmación.</p>
            <div className="sofia-messages" aria-live="polite">
              {sofiaMessages.map((message, index) => <div className={`sofia-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'assistant' ? 'Sofía' : 'Vos'}</span><p>{message.content}</p></div>)}
              {sofiaBusy ? <div className="sofia-message assistant"><span>Sofía</span><p>Estoy pensando...</p></div> : null}
              {sofiaPendingConfirmation ? (
                <div className="sofia-confirmation-card" role="group" aria-label="Confirmación de acción">
                  <strong>{sofiaPendingConfirmation.action === 'cancelar_turno' ? 'Confirmar cancelación' : sofiaPendingConfirmation.action === 'enviar_notificacion_paciente' ? 'Confirmar envío' : 'Confirmar agendamiento'}</strong>
                  <div className="sofia-confirmation-details">
                    <span><b>Paciente:</b> {String(sofiaPendingConfirmation.proposal.patient || sofiaPendingConfirmation.proposal.patientName || 'Sin identificar')}</span>
                    {sofiaPendingConfirmation.proposal.date ? <span><b>Fecha:</b> {String(sofiaPendingConfirmation.proposal.date)}</span> : null}
                    {sofiaPendingConfirmation.proposal.time ? <span><b>Hora:</b> {String(sofiaPendingConfirmation.proposal.time)} hs</span> : null}
                    {sofiaPendingConfirmation.proposal.reason ? <span><b>Motivo:</b> {String(sofiaPendingConfirmation.proposal.reason)}</span> : null}
                    {sofiaPendingConfirmation.proposal.email ? <span><b>Email:</b> {String(sofiaPendingConfirmation.proposal.email)}</span> : null}
                  </div>
                  <small>La acción se ejecutará solo cuando confirmes.</small>
                  <div>
                    <button type="button" onClick={() => { void handleConfirmSofiaAction() }} disabled={sofiaBusy}>Confirmar</button>
                    <button type="button" className="ghost" onClick={() => setSofiaPendingConfirmation(null)} disabled={sofiaBusy}>Cancelar</button>
                  </div>
                </div>
              ) : null}
            </div>
            <form className="sofia-compose" onSubmit={(event) => { event.preventDefault(); void handleAskSofia() }}>
              <textarea value={sofiaDraft} onChange={(event) => setSofiaDraft(event.target.value)} placeholder="Ej: agendá a María López para el jueves..." rows={3} disabled={sofiaBusy} />
              <div className="sofia-compose-actions">
                <button type="button" className="ghost" onClick={toggleSofiaDictation} disabled={sofiaBusy}>{sofiaDictating ? '⏹ Detener audio' : '🎙 Dictar a Sofía'}</button>
                <button type="submit" disabled={sofiaBusy || !sofiaDraft.trim()}>{sofiaBusy ? 'Consultando...' : 'Preguntar a Sofía'}</button>
              </div>
            </form>
            <small className="sofia-disclaimer">Revisá toda respuesta antes de incorporarla a una historia clínica.</small>
          </div>
        </div>
      ) : null}
      {premiumPrompt ? (
        <div className="drhappy-modal-overlay" onClick={() => setPremiumPrompt(null)}>
          <div
            className="drhappy-modal-card premium-prompt-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="premium-prompt-title"
          >
            <span className="premium-prompt-badge">⭐ Incluido con tu suscripción activa</span>
            <span className="premium-prompt-icon" aria-hidden="true">{premiumPrompt.icon}</span>
            <h3 id="premium-prompt-title">{premiumPrompt.title}</h3>
            <p className="premium-prompt-pitch">{premiumPrompt.pitch}</p>
            <ul className="premium-prompt-list">
              {premiumPrompt.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className="premium-prompt-actions">
              <button
                type="button"
                disabled={subscriptionCheckoutLoading !== null}
                onClick={() => {
                  setPremiumPrompt(null)
                  void handleStartSubscriptionCheckout('monthly')
                }}
              >
                {subscriptionCheckoutLoading === 'monthly' ? 'Abriendo pago...' : 'Activar ahora'}
              </button>
              <button type="button" className="ghost" onClick={() => { setPremiumPrompt(null); setPreviewTrialExpired(true) }}>
                Ver planes y precios
              </button>
              <button type="button" className="text-button" onClick={() => setPremiumPrompt(null)}>
                Ahora no
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {contactModalOpen ? (
        <div className="drhappy-modal-overlay" onClick={() => setContactModalOpen(false)}>
          <div
            className="drhappy-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-modal-title"
          >
            <div className="drhappy-modal-header">
              <h3 id="contact-modal-title" style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>
                💬 Contactar con los desarrolladores
              </h3>
              <button
                type="button"
                className="drhappy-modal-close-btn"
                onClick={() => setContactModalOpen(false)}
                aria-label="Cerrar ventana"
              >
                ✕
              </button>
            </div>
            <div className="drhappy-modal-body">
              <p style={{ margin: '0 0 16px', color: '#475569', fontSize: '0.92rem', lineHeight: 1.5 }}>
                Para recibir soporte, escribinos a soporte@drhappy.com.ar.
              </p>
              <div className="drhappy-contact-options">
                <a
                  href="mailto:soporte@drhappy.com.ar"
                  className="drhappy-contact-btn email"
                >
                  <span className="contact-icon">✉️</span>
                  <div>
                    <strong>Enviar correo electrónico a Soporte</strong>
                    <small>soporte@drhappy.com.ar (Canal oficial)</small>
                  </div>
                </a>

              </div>
            </div>
            <div className="drhappy-modal-footer">
              <button
                type="button"
                className="ghost"
                onClick={() => setContactModalOpen(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
