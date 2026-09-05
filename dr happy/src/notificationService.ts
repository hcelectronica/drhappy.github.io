import { isSupabaseConfigured, supabase } from './supabaseClient'

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export const VAPID_PUBLIC_KEY =
  'BG4L8lMhlSk23SK20qTIyTZI2Af4yN_G-zCNkoqXLa75SRnQHsEm74IClL0ywCx3pVLiHECTIiSzibNtst9WXfM'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

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

export async function registerPushSubscription(userId: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false
  }

  if (Notification.permission !== 'granted') {
    return false
  }

  try {
    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    }

    if (subscription && isSupabaseConfigured && supabase) {
      const subJson = subscription.toJSON()
      // Guardar en la base de datos Supabase con el origen actual
      await supabase.from('user_push_subscriptions').upsert(
        {
          user_id: userId,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh || null,
          auth: subJson.keys?.auth || null,
          subscription_json: subJson,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      )
      return true
    }
    return Boolean(subscription)
  } catch (err) {
    console.warn('Fallo al registrar suscripción push en el dispositivo:', err)
    return false
  }
}

export interface ServerPushPayload {
  recipientUserId?: string
  broadcast?: boolean
  title: string
  body: string
  tag?: string
  icon?: string
  badge?: string
  url?: string
}

export async function sendServerPushNotification(payload: ServerPushPayload): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) {
    return false
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://drhappy.com.ar'
  const defaultIcon = `${origin}/icon-192.png`

  try {
    const { error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        action: 'send',
        ...payload,
        icon: payload.icon || defaultIcon,
        badge: payload.badge || defaultIcon,
        url: payload.url || `${origin}/`,
      },
    })
    if (error) {
      console.warn('Error al disparar push desde el servidor:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.warn('Fallo de red al enviar push desde el servidor:', err)
    return false
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
