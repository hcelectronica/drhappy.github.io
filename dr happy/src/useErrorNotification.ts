import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export const ErrorNotificationContext = createContext<((message: string) => void) | null>(null)

export function useErrorNotification(initialError: string | null = null): [
  string | null,
  (message: string | null) => void,
] {
  const notify = useContext(ErrorNotificationContext)
  if (!notify) throw new Error('Los avisos necesitan ErrorNotificationProvider.')
  const [error, setError] = useState({ message: initialError, revision: 0 })
  const lastNotified = useRef<typeof error | null>(null)
  const updateError = useCallback((message: string | null) => {
    setError((current) => ({ message, revision: current.revision + 1 }))
  }, [])
  useEffect(() => {
    if (error.message && lastNotified.current !== error) {
      lastNotified.current = error
      notify(error.message)
    }
  }, [error, notify])
  return [error.message, updateError]
}
