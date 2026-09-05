<<<<<<< HEAD
const CACHE_NAME = 'drhappy-shell-v3'
=======
const CACHE_NAME = 'drhappy-shell-v4'
>>>>>>> desarrollo

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

// Passthrough fetch handler: required by browsers as an installability signal,
// without intercepting or caching application responses.
self.addEventListener('fetch', () => {})

// Manejador ultra-robusto de notificaciones Push en segundo plano (incluso con la app 100% cerrada)
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    if (event.data) {
      payload = event.data.json()
    }
  } catch (_err) {
    try {
      payload = { body: event.data ? event.data.text() : '' }
    } catch (_e) {
      payload = {}
    }
  }

  const title = (payload && payload.title) || 'Dr Happy 😊'
  const body =
    (payload && (payload.body || payload.text)) || 'Tienes una nueva novedad o mensaje en Dr Happy.'
  const url =
    (payload && payload.data && payload.data.url) ||
    (payload && payload.url) ||
    'https://drhappy.com.ar/'
  const tag = (payload && payload.tag) || `drhappy-alert-${Date.now()}`

  const baseUrl = self.location.origin || 'https://drhappy.com.ar'
  const iconUrl = `${baseUrl}/icon-192.png`
  const badgeUrl = `${baseUrl}/icon-192.png`

  // Opciones estándar compatibles con Android, iOS PWA, macOS y Windows
  const notificationOptions = {
    body,
    icon: iconUrl,
    badge: badgeUrl,
    tag,
    renotify: true,
    data: {
      url,
      timestamp: Date.now(),
    },
  }

  const promise = self.registration
    .showNotification(title, notificationOptions)
    .catch((err) => {
      console.warn('[SW] showNotification con opciones completas falló, reintentando con básicas:', err)
      // Fallback con opciones mínimas garantizadas en caso de que el sistema operativo rechace opciones avanzadas
      return self.registration.showNotification(title, {
        body,
        tag,
        data: { url },
      })
    })

  event.waitUntil(promise)
})

// Al hacer clic sobre la notificación emergente en el celular o escritorio
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl =
    (event.notification.data && event.notification.data.url) || 'https://drhappy.com.ar/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client && targetUrl) {
              client.navigate(targetUrl).catch(() => {})
            }
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
      }),
  )
})

