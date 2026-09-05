const CACHE_NAME = 'drhappy-shell-v3'

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

// Manejador de notificaciones Push en segundo plano (incluso con la app 100% cerrada)
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_err) {
    data = { body: event.data ? event.data.text() : 'Tienes un nuevo mensaje en Dr Happy' }
  }

  const title = data.title || 'Dr Happy 😊'
  const origin = self.location.origin || ''
  const iconUrl = data.icon
    ? (data.icon.startsWith('http') ? data.icon : new URL(data.icon, origin).href)
    : `${origin}/icon-192.png`
  const badgeUrl = data.badge
    ? (data.badge.startsWith('http') ? data.badge : new URL(data.badge, origin).href)
    : `${origin}/icon-192.png`

  const options = {
    body: data.body || data.text || 'Nuevo aviso o mensaje recibido.',
    icon: iconUrl,
    badge: badgeUrl,
    tag: data.tag || 'drhappy-alert-' + Date.now(),
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 300],
    data: {
      url: data.data?.url || data.url || origin || 'https://drhappy.com.ar',
      timestamp: Date.now(),
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// Al hacer clic sobre la notificación emergente en el celular o escritorio
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || './'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
      }),
  )
})

