import { useEffect, useRef, useState } from 'react'

export function useDesktopDock() {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const desktop = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)')
    const revealZone = 120
    const hideDelay = 450
    let timer: ReturnType<typeof setTimeout> | undefined
    let shown = false
    const hide = () => { shown = false; setVisible(false) }
    const move = (event: PointerEvent) => {
      if (!desktop.matches || event.pointerType === 'touch') return
      const bounds = ref.current?.getBoundingClientRect()
      const overDock = shown && bounds && event.clientX >= bounds.left - 12 && event.clientX <= bounds.right + 12
        && event.clientY >= bounds.top - 45 && event.clientY <= bounds.bottom + 12
      clearTimeout(timer)
      if (event.clientY >= window.innerHeight - revealZone || overDock) {
        shown = true; setVisible(true)
      } else {
        timer = setTimeout(hide, hideDelay)
      }
    }
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) { clearTimeout(timer); hide() } }
    const resize = () => { clearTimeout(timer); hide() }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerout', leave)
    window.addEventListener('resize', resize)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', leave)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return { ref, visible }
}
