const CACHE_NAME = 'drhappy-shell-v1'

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

// Manejador de notificaciones Push en segundo plano
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_err) {
    data = { body: event.data ? event.data.text() : 'Tienes un nuevo mensaje en Dr Happy' }
  }

  const title = data.title || 'Dr Happy 😊'
  const options = {
    body: data.body || data.text || 'Nuevo aviso o mensaje recibido.',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    tag: data.tag || 'drhappy-notification',
    renotify: true,
    vibrate: [200, 100, 200],
    data: data.data || { url: './' },
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

