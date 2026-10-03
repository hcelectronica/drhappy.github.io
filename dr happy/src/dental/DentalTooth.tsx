import { useId } from 'react'
import { CONDITIONS, markColor, surfaceLabel } from './dentalModel'
import type { DentalMark, DentalSurface } from './dentalModel'

export function DentalTooth({ tooth, marks, selected, surface, onSelect, expanded = false }: {
  tooth: number
  marks: DentalMark[]
  selected: boolean
  surface: DentalSurface
  onSelect: (surface: DentalSurface) => void
  expanded?: boolean
}) {
  const mixedId = useId()
  const quadrant = Math.floor(tooth / 10)
  const patientRight = [1, 4, 5, 8].includes(quadrant)
  const upper = [1, 2, 5, 6].includes(quadrant)
  const segments: Array<{ face: DentalSurface; points: string }> = [
    { face: upper ? 'vestibular' : 'oral', points: '8,8 56,8 43,21 21,21' },
    { face: patientRight ? 'mesial' : 'distal', points: '56,8 56,56 43,43 43,21' },
    { face: upper ? 'oral' : 'vestibular', points: '56,56 8,56 21,43 43,43' },
    { face: patientRight ? 'distal' : 'mesial', points: '8,56 8,8 21,21 21,43' },
    { face: 'central', points: '21,21 43,21 43,43 21,43' },
  ]
  const wholeMarks = marks.filter((mark) => mark.surface === 'whole')
  return (
    <div data-tooth={tooth} className={`dental-tooth ${selected ? 'dental-tooth--selected' : ''} ${expanded ? 'dental-tooth--expanded' : ''}`}>
      <button type="button" className="dental-tooth-number" onClick={() => onSelect('whole')} aria-label={`Pieza ${tooth}, seleccionar pieza completa`} aria-pressed={selected && surface === 'whole'}>{tooth}</button>
      <svg viewBox="0 0 64 64" role="group" aria-label={`Superficies de la pieza ${tooth}`}>
        <defs><pattern id={mixedId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#f6bcc4" /><rect x="4" width="4" height="8" fill="#bcd4fa" /></pattern></defs>
        {segments.map(({ face, points }) => {
          const faceMarks = marks.filter((mark) => mark.surface === face)
          const colors = [...new Set(faceMarks.map(markColor))]
          const color = colors.length === 2 ? 'mixed' : colors[0]
          return <polygon key={face} points={points} style={color === 'mixed' ? { fill: `url(#${mixedId})` } : undefined} className={`dental-surface ${color ? `dental-surface--${color}` : ''} ${selected && surface === face ? 'dental-surface--selected' : ''}`}
            role="button" tabIndex={expanded ? 0 : -1} aria-label={`Pieza ${tooth}, ${surfaceLabel(face, tooth)}${faceMarks.length ? `: ${faceMarks.map((mark) => CONDITIONS.find((item) => item.id === mark.condition)?.label).join(', ')}` : ', sin registro'}`}
            aria-pressed={selected && surface === face}
            onClick={() => onSelect(face)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(face) } }}>
            <title>{surfaceLabel(face, tooth)}</title>
          </polygon>
        })}
        {wholeMarks.map((mark, index) => {
          const symbol = CONDITIONS.find((item) => item.id === mark.condition)?.symbol
          return <g key={mark.id} className={`dental-symbol dental-symbol--${markColor(mark)}`} transform={`translate(${index % 2}, ${index % 2})`} aria-hidden="true">
            {symbol === 'x' ? <path d="M11 11L53 53M53 11L11 53" /> : null}
            {symbol === '=' ? <path d="M12 27H52M12 37H52" /> : null}
            {symbol === 'circle' ? <circle cx="32" cy="32" r="27" /> : null}
            {symbol === 'bridge' ? <path d="M5 55V5H59V55" /> : null}
            {symbol === 'box' ? <rect x="4" y="4" width="56" height="56" /> : null}
            {symbol === 'surface' ? <rect x="11" y="11" width="42" height="42" rx="3" strokeDasharray="4 3" /> : null}
          </g>
        })}
        {marks.some((mark) => markColor(mark) === 'red') && marks.some((mark) => markColor(mark) === 'blue') ? <g aria-hidden="true"><circle cx="26" cy="61" r="2.5" fill="#b42336" /><circle cx="38" cy="61" r="2.5" fill="#2457ba" /></g> : null}
      </svg>
      <span className="dental-tooth-count" aria-hidden="true">{marks.length || '·'}</span>
    </div>
  )
}
