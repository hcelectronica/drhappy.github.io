export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getNotificationPermission(): NotificationPermissionState {
  if (!isNotificationSupported()) {
    return 'unsupported'
  }
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isNotificationSupported()) {
    return 'unsupported'
  }
  try {
    const permission = await Notification.requestPermission()
    return permission
  } catch (err) {
    console.warn('Error al solicitar permiso de notificaciones:', err)
    return Notification.permission
  }
}

export interface AppNotificationOptions {
  body: string
  icon?: string
  badge?: string
  tag?: string
  url?: string
}

export async function showAppNotification(
  title: string,
  options: AppNotificationOptions,
): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false
  }

  const iconUrl =
    options.icon || `${import.meta.env.BASE_URL}icon-192.png`
  const badgeUrl =
    options.badge || `${import.meta.env.BASE_URL}icon-192.png`

  const notificationOptions = {
    body: options.body,
    icon: iconUrl,
    badge: badgeUrl,
    tag: options.tag || 'drhappy-alert',
    renotify: true,
    data: {
      url: options.url || window.location.href,
    },
  } as NotificationOptions

  // Si Service Worker está disponible y registrado, usar registration.showNotification
  // (requerido en dispositivos móviles como Android y PWA instalada en iOS)
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready
      if (registration && 'showNotification' in registration) {
        await registration.showNotification(title, notificationOptions)
        return true
      }
    } catch (err) {
      console.warn('Fallo al mostrar notificación vía service worker:', err)
    }
  }

  // Fallback con constructor directo de Notification
  try {
    const notification = new Notification(title, notificationOptions)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch (err) {
    console.warn('Fallo al instanciar Notification estándar:', err)
    return false
  }
}
