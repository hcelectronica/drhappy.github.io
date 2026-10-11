import { useEffect, useState } from 'react'

function readDisplayMode() {
  const isFullscreenDisplay = window.matchMedia('(display-mode: fullscreen)').matches
  const isElementFullscreen = document.fullscreenElement !== null
  return {
    isInstalledDisplayMode: window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui)').matches ||
      (isFullscreenDisplay && !isElementFullscreen) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  }
}

export function useDisplayMode() {
  const [mode, setMode] = useState(readDisplayMode)

  useEffect(() => {
    const queries = [
      window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui)'),
      window.matchMedia('(display-mode: fullscreen)'),
    ]
    const update = () => setMode(readDisplayMode())
    queries.forEach(query => query.addEventListener('change', update))
    document.addEventListener('fullscreenchange', update)
    update()
    return () => {
      queries.forEach(query => query.removeEventListener('change', update))
      document.removeEventListener('fullscreenchange', update)
    }
  }, [])

  return mode
}
