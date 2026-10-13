import { sendHeartbeat } from './workspaceService'

type ActionType = 'consultation' | 'prescription' | 'certificate' | 'appointment' | 'patient'

interface PendingCounts {
  consultations: number
  prescriptions: number
  certificates: number
  appointments: number
  patients: number
}

let activeInterval: ReturnType<typeof setInterval> | null = null
let currentUserId: string | null = null
let lastVisibleTimestamp: number = Date.now()
let accumulatedVisibleMs: number = 0
let isSending = false

const pendingCounts: PendingCounts = {
  consultations: 0,
  prescriptions: 0,
  certificates: 0,
  appointments: 0,
  patients: 0,
}

export function trackClinicalAction(action: ActionType): void {
  switch (action) {
    case 'consultation':
      pendingCounts.consultations += 1
      break
    case 'prescription':
      pendingCounts.prescriptions += 1
      break
    case 'certificate':
      pendingCounts.certificates += 1
      break
    case 'appointment':
      pendingCounts.appointments += 1
      break
    case 'patient':
      pendingCounts.patients += 1
      break
  }
}

async function flushHeartbeat(force = false): Promise<void> {
  if (isSending || !currentUserId) return

  // Si la pestaña está visible, sumar el tramo actual
  if (document.visibilityState === 'visible') {
    const now = Date.now()
    accumulatedVisibleMs += Math.max(0, now - lastVisibleTimestamp)
    lastVisibleTimestamp = now
  }

  const minutes = Math.floor(accumulatedVisibleMs / 60000)
  const hasPendingActions =
    pendingCounts.consultations > 0 ||
    pendingCounts.prescriptions > 0 ||
    pendingCounts.certificates > 0 ||
    pendingCounts.appointments > 0 ||
    pendingCounts.patients > 0

  // Si no pasó al menos 1 minuto y no hay acciones clínicas pendientes (salvo force), esperar
  if (!force && minutes < 1 && !hasPendingActions) {
    return
  }

  const effectiveMinutes = Math.max(0, minutes)
  const snapshotCounts = { ...pendingCounts }

  isSending = true
  try {
    const res = await sendHeartbeat({
      minutes: effectiveMinutes,
      consultations: snapshotCounts.consultations,
      prescriptions: snapshotCounts.prescriptions,
      certificates: snapshotCounts.certificates,
      appointments: snapshotCounts.appointments,
      patients: snapshotCounts.patients,
    })

    if (res.success) {
      accumulatedVisibleMs -= effectiveMinutes * 60000
      pendingCounts.consultations -= snapshotCounts.consultations
      pendingCounts.prescriptions -= snapshotCounts.prescriptions
      pendingCounts.certificates -= snapshotCounts.certificates
      pendingCounts.appointments -= snapshotCounts.appointments
      pendingCounts.patients -= snapshotCounts.patients
    }
  } catch {
    // Si falla la red, los contadores se conservan para el siguiente intento
  } finally {
    isSending = false
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    lastVisibleTimestamp = Date.now()
  } else {
    // La pestaña pasó a segundo plano o minimizada
    const now = Date.now()
    accumulatedVisibleMs += Math.max(0, now - lastVisibleTimestamp)
    lastVisibleTimestamp = now
    void flushHeartbeat(true)
  }
}

function handleBeforeUnload(): void {
  if (document.visibilityState === 'visible') {
    accumulatedVisibleMs += Math.max(0, Date.now() - lastVisibleTimestamp)
  }
  void flushHeartbeat(true)
}

export function startTelemetry(userId: string): void {
  if (currentUserId === userId && activeInterval) return

  stopTelemetry()
  currentUserId = userId
  lastVisibleTimestamp = Date.now()
  accumulatedVisibleMs = 0

  // Primer latido al iniciar sesión (avisa que está en línea)
  void flushHeartbeat(true)

  // Latido periódico cada 2 minutos
  activeInterval = setInterval(() => {
    void flushHeartbeat(false)
  }, 2 * 60 * 1000)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
  }
}

export function stopTelemetry(): void {
  if (activeInterval) {
    clearInterval(activeInterval)
    activeInterval = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('beforeunload', handleBeforeUnload)
  }
  if (currentUserId) {
    void flushHeartbeat(true)
  }
  currentUserId = null
  accumulatedVisibleMs = 0
}
