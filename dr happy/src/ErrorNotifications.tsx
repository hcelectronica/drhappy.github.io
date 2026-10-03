import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ErrorNotificationContext } from './useErrorNotification'
import './errorNotifications.css'

interface ErrorNotification {
  id: number
  message: string
}

const DISPLAY_TIME = 12000

function ErrorToast({ notification, onDismiss }: {
  notification: ErrorNotification
  onDismiss: (id: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(DISPLAY_TIME)
  useEffect(() => {
    if (hovered || focused) return
    const started = Date.now()
    const timer = window.setTimeout(() => onDismiss(notification.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [notification.id, onDismiss, hovered, focused])

  return (
    <div className="app-error-toast"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      <span className="app-error-toast-icon" aria-hidden="true">!</span>
      <p role="alert">{notification.message}</p>
      <button type="button" onClick={() => onDismiss(notification.id)} aria-label="Cerrar aviso">×</button>
    </div>
  )
}

export function ErrorNotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<ErrorNotification[]>([])
  const [portalContainer] = useState(() => document.createElement('div'))
  const nextId = useRef(0)
  const viewport = useRef<HTMLDivElement>(null)
  const notify = useCallback((message: string) => {
    const notification = { id: ++nextId.current, message }
    setNotifications((current) => [...current.filter((item) => item.message !== message), notification])
  }, [])
  const dismiss = useCallback((id: number) => {
    setNotifications((current) => current.filter((item) => item.id !== id))
  }, [])
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const supportsPopover = typeof element.showPopover === 'function'
    const dialog = document.querySelector<HTMLDialogElement>('dialog:modal')
    const attach = (target: HTMLElement) => {
      if (supportsPopover && element.matches(':popover-open')) element.hidePopover()
      if (portalContainer.parentElement !== target) target.appendChild(portalContainer)
      if (notifications.length && supportsPopover) element.showPopover()
    }
    // A popover outside a native modal is inert, even when it is in the top layer.
    attach(dialog ?? document.body)
    if (!dialog) return
    const restore = () => { attach(document.body); observer.disconnect() }
    const observer = new MutationObserver(() => { if (!dialog.isConnected) restore() })
    observer.observe(document.body, { childList: true, subtree: true })
    dialog.addEventListener('close', restore)
    return () => { dialog.removeEventListener('close', restore); observer.disconnect() }
  }, [notifications, portalContainer])
  useLayoutEffect(() => () => { portalContainer.remove() }, [portalContainer])

  return (
    <ErrorNotificationContext.Provider value={notify}>
      {children}
      {createPortal(
        <div ref={viewport} className={`app-error-toast-viewport${notifications.length ? ' is-visible' : ''}`}
          popover="manual" aria-label="Avisos de la aplicación">
          {notifications.map((notification) => <ErrorToast key={notification.id} notification={notification} onDismiss={dismiss} />)}
        </div>,
        portalContainer,
      )}
    </ErrorNotificationContext.Provider>
  )
}
