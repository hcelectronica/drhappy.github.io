import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface SignaturePadProps {
  value?: string
  onSave: (dataUrl: string) => void | Promise<void>
}

const PAD_HEIGHT = 200

// Recorta el lienzo al trazo real para que la firma se ubique bien en los documentos.
function exportTrimmedSignature(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { width, height } = canvas
  const pixels = ctx.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const padding = 12
  const cropX = Math.max(0, minX - padding)
  const cropY = Math.max(0, minY - padding)
  const cropWidth = Math.min(width, maxX + padding) - cropX
  const cropHeight = Math.min(height, maxY + padding) - cropY
  const output = document.createElement('canvas')
  output.width = cropWidth
  output.height = cropHeight
  output.getContext('2d')?.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return output.toDataURL('image/png')
}

export function SignaturePad({ value, onSave }: SignaturePadProps) {
  const [editing, setEditing] = useState(!value)
  const [hasStroke, setHasStroke] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setEditing(!value)
  }, [value])

  useEffect(() => {
    if (!editing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(PAD_HEIGHT * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0b1f4d'
    ctx.lineWidth = 2.6
    setHasStroke(false)
  }, [editing])

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    const point = pointFromEvent(event)
    lastPointRef.current = point
    const ctx = event.currentTarget.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.arc(point.x, point.y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = '#0b1f4d'
    ctx.fill()
    setHasStroke(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return
    const ctx = event.currentTarget.getContext('2d')
    const last = lastPointRef.current
    if (!ctx || !last) return
    const point = pointFromEvent(event)
    const midX = (last.x + point.x) / 2
    const midY = (last.y + point.y) / 2
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.quadraticCurveTo(last.x, last.y, midX, midY)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
  }

  function handlePointerUp(): void {
    drawingRef.current = false
    lastPointRef.current = null
  }

  function handleClear(): void {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setHasStroke(false)
  }

  async function handleSave(): Promise<void> {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = exportTrimmedSignature(canvas)
    if (!dataUrl) return
    setSaving(true)
    try {
      await onSave(dataUrl)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing && value) {
    return (
      <div className="signature-pad signature-pad--locked">
        <div className="signature-pad-preview">
          <img src={value} alt="Firma del profesional" />
        </div>
        <div className="signature-pad-footer">
          <span className="signature-pad-badge">🔒 Firma guardada</span>
          <button type="button" className="ghost compact" onClick={() => setEditing(true)}>✏️ Editar firma</button>
        </div>
      </div>
    )
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        className="signature-pad-canvas"
        style={{ height: PAD_HEIGHT }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="Área para firmar a mano alzada"
      />
      <span className="signature-pad-guide" aria-hidden="true">Firmá sobre la línea</span>
      <div className="signature-pad-footer">
        <button type="button" className="ghost compact" onClick={handleClear} disabled={!hasStroke || saving}>Limpiar</button>
        {value ? (
          <button type="button" className="ghost compact" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
        ) : null}
        <button type="button" className="compact" onClick={() => void handleSave()} disabled={!hasStroke || saving}>
          {saving ? 'Guardando...' : 'Guardar firma'}
        </button>
      </div>
    </div>
  )
}
