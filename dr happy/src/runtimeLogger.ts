type RuntimeLogLevel = 'info' | 'warn' | 'error'

interface RuntimeLogEntry {
  timestamp: string
  level: RuntimeLogLevel
  event: string
  details?: Record<string, unknown>
}

const RUNTIME_LOG_KEY = 'drhappy-runtime-log-v1'
const MAX_RUNTIME_LOG_ENTRIES = 200
const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|api[-_]?key|cookie|patient|clinical|history|dni|email/i

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]'
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}...[truncated]` : value
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitize(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitize(item, depth + 1),
  ]))
}

function readRuntimeLogs(): RuntimeLogEntry[] {
  try {
    const stored = localStorage.getItem(RUNTIME_LOG_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.slice(-MAX_RUNTIME_LOG_ENTRIES) : []
  } catch {
    return []
  }
}

export function logRuntime(level: RuntimeLogLevel, event: string, details?: Record<string, unknown>): void {
  const entry: RuntimeLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    details: details ? sanitize(details) as Record<string, unknown> : undefined,
  }
  const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  consoleMethod(`[DrHappy:${level}] ${event}`, entry.details || '')
  try {
    localStorage.setItem(RUNTIME_LOG_KEY, JSON.stringify([...readRuntimeLogs(), entry].slice(-MAX_RUNTIME_LOG_ENTRIES)))
  } catch {
    // Logging must never break the application.
  }
}

export function getRuntimeLogs(): RuntimeLogEntry[] {
  return readRuntimeLogs()
}

export function installRuntimeErrorLogging(): () => void {
  const handleError = (event: ErrorEvent) => {
    logRuntime('error', 'window.error', { name: event.error?.name, message: event.message, source: event.filename, line: event.lineno })
  }
  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error ? { name: event.reason.name, message: event.reason.message } : { reason: String(event.reason) }
    logRuntime('error', 'unhandled.promise.rejection', reason)
  }
  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)
  return () => {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
}
