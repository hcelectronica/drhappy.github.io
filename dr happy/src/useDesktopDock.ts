import { useEffect, useRef, useState } from 'react'

export function useDesktopDock() {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const desktop = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)')
    let timer: ReturnType<typeof setTimeout> | undefined
    let shown = false
    const hide = () => { shown = false; setVisible(false) }
    const move = (event: PointerEvent) => {
      if (!desktop.matches || event.pointerType === 'touch') return
      const bounds = ref.current?.getBoundingClientRect()
      const overDock = shown && bounds && event.clientX >= bounds.left - 12 && event.clientX <= bounds.right + 12
        && event.clientY >= bounds.top - 45 && event.clientY <= bounds.bottom + 12
      clearTimeout(timer)
      if (event.clientY >= window.innerHeight - 32 || overDock) {
        shown = true; setVisible(true)
      } else {
        timer = setTimeout(hide, 250)
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
