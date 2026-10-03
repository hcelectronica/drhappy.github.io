import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './AppErrorBoundary'
import { installRuntimeErrorLogging, logRuntime } from './runtimeLogger'

const DentalDesignPreview = import.meta.env.DEV && window.location.pathname === '/dental-design'
  ? lazy(() => import('./dental/DentalDesignPreview'))
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {DentalDesignPreview
        ? <Suspense fallback={<p>Cargando diseño de ficha dental...</p>}><DentalDesignPreview /></Suspense>
        : <App />}
    </AppErrorBoundary>
  </StrictMode>,
)

installRuntimeErrorLogging()
logRuntime('info', 'app.started', { buildId: import.meta.env.VITE_BUILD_ID })

if (!DentalDesignPreview && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}service-worker.js`)
      .then((registration) => {
        // Chequear inmediatamente si hay una nueva versión del service worker y de la app
        registration.update().catch(() => {})
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Hay nueva versión disponible
                console.log('[DrHappy] Nueva versión instalada.')
              }
            })
          }
        })
      })
      .catch(() => {
        // La app sigue funcionando sin service worker; solo se pierde la instalación offline.
      })
  })
}
