import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { closestCenter, DndContext, KeyboardSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { mobileHomeOrderKey, parseMobileHomeOrder, reorderHomeActions, visibleHomeOrder } from './mobileHomeOrder'

export interface MobileHomeAction {
  key: string
  icon: string
  label: string
  hint: string
  tone: string
  badge?: number
  disabled?: boolean
  onClick: () => void
}

function HomeButton({ action, mobile, suppressClick }: {
  action: MobileHomeAction
  mobile: boolean
  suppressClick: () => boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: action.key,
    disabled: !mobile || action.disabled,
  })
  const style: CSSProperties = {
    '--tone': action.tone,
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`smart-btn${isDragging ? ' smart-btn--dragging' : ''}${action.key === 'video' ? ' video-consultation-link' : ''}`}
      data-home-action={action.key}
      style={style}
      disabled={action.disabled}
      title={`${action.label}: ${action.hint}`}
      {...attributes}
      {...listeners}
      onClick={(event) => {
        if (suppressClick()) { event.preventDefault(); return }
        action.onClick()
      }}
      onContextMenu={(event) => { if (mobile) event.preventDefault() }}
    >
      {action.badge && action.badge > 0 ? <span className="smart-badge">{action.badge}</span> : null}
      <span className="smart-ico" aria-hidden="true">{action.icon}</span>
      <span className="smart-txt"><strong>{action.label}</strong><small>{action.hint}</small></span>
    </button>
  )
}

export function MobileHomeMenu({ actions, userId, onError }: {
  actions: MobileHomeAction[]
  userId: string
  onError: (message: string) => void
}) {
  const [initial] = useState(() => {
    try {
      return { order: parseMobileHomeOrder(localStorage.getItem(mobileHomeOrderKey(userId))), error: null }
    } catch (error) {
      return { order: [], error }
    }
  })
  const [order, setOrder] = useState<string[]>(initial.order)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 899px)').matches)
  const dragging = useRef(false)
  const suppressUntil = useRef(0)
  const reportError = useRef(onError)
  useEffect(() => { reportError.current = onError }, [onError])
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 450, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    const query = matchMedia('(max-width: 899px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    if (initial.error) {
      console.error('No se pudo restaurar el orden del menú móvil:', initial.error)
      reportError.current('No se pudo recuperar el orden de tu menú. Podés volver a acomodarlo.')
    }
    return () => query.removeEventListener('change', update)
  }, [initial.error])

  const keys = visibleHomeOrder(order, actions.map((action) => action.key))
  const byKey = new Map(actions.map((action) => [action.key, action]))
  const finishDrag = () => {
    dragging.current = false
    suppressUntil.current = Date.now() + 500
  }
  function saveOrder({ active, over }: DragEndEvent) {
    finishDrag()
    if (!mobile || !over || active.id === over.id) return
    const next = reorderHomeActions(order, actions.map((action) => action.key), String(active.id), String(over.id))
    setOrder(next)
    try {
      localStorage.setItem(mobileHomeOrderKey(userId), JSON.stringify(next))
    } catch (error) {
      console.error('No se pudo guardar el orden del menú móvil:', error)
      onError('El menú se acomodó, pero no se pudo guardar el orden en este dispositivo.')
    }
  }
  return (
    <section className="mobile-home-menu" aria-label="Menú de Inicio">
      <p className="mobile-home-hint">Mantené presionado un botón y arrastralo para ordenar.</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => { dragging.current = true }}
        onDragEnd={saveOrder}
        onDragCancel={finishDrag}
        accessibility={{
          screenReaderInstructions: { draggable: 'Para ordenar, presioná espacio, mové con las flechas y presioná espacio para guardar. Escape cancela.' },
          announcements: {
            onDragStart: ({ active }) => `Moviendo ${byKey.get(String(active.id))?.label ?? 'botón'}.`,
            onDragOver: ({ over }) => over ? `Ubicación ${keys.indexOf(String(over.id)) + 1} de ${keys.length}.` : undefined,
            onDragEnd: () => 'Orden actualizado.',
            onDragCancel: () => 'Movimiento cancelado.',
          },
        }}
      >
        <SortableContext items={keys} strategy={rectSortingStrategy}>
          <nav className="home-botonera" aria-label="Accesos rápidos">
            {keys.map((key) => {
              const action = byKey.get(key)
              return action ? <HomeButton key={key} action={action} mobile={mobile}
                suppressClick={() => dragging.current || Date.now() < suppressUntil.current} /> : null
            })}
          </nav>
        </SortableContext>
      </DndContext>
    </section>
  )
}
