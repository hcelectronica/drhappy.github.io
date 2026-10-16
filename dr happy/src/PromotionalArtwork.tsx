import { ServiceIllustration } from './ServiceIllustration'

const promotionalFeatures = {
  care: { eyebrow: 'PARA MÉDICOS', headline: 'ATENCIÓN\nMÉDICA', caption: 'Historia clínica y seguimiento en contexto' },
  calendar: { eyebrow: 'AGENDA INTELIGENTE', headline: 'MENOS AUSENCIAS.\nMÁS CONSULTAS.', caption: 'Recordatorios automáticos de turnos' },
  video: { eyebrow: 'ATENCIÓN A DISTANCIA', headline: 'VIDEOCONSULTA\nPROFESIONAL', caption: 'Acceso seguro desde la ficha o el turno' },
  emergency: { eyebrow: 'TRASLADOS Y GUARDIA', headline: 'ATENCIÓN\nEN MOVIMIENTO', caption: 'Asistencia clínica cuando cada minuto cuenta' },
  patients: { eyebrow: 'HISTORIA CLÍNICA', headline: 'DIGITAL', caption: 'Asesorada con Sofía IA' },
  certificates: { eyebrow: 'DOCUMENTOS CLÍNICOS', headline: 'CERTIFICADOS\nEN MINUTOS', caption: 'Con tu firma y código QR' },
  invite: { eyebrow: 'TUS PACIENTES, MÁS CERCA', headline: 'INVITÁ.\nELLOS SE REGISTRAN.', caption: 'Por link o código QR' },
  protocols: { eyebrow: 'RECURSOS CLÍNICOS', headline: 'CRITERIO\nA MANO', caption: 'Protocolos, guías y vademécum' },
  ledger: { eyebrow: 'GESTIÓN SIMPLE', headline: 'COBROS\nMÁS CLAROS', caption: 'Pagos, saldos y seguimiento' },
} as const

export function PromotionalArtwork({ service }: { service: keyof typeof promotionalFeatures }) {
  const feature = promotionalFeatures[service]
  return <div className={`auth-promo-tool-art auth-promo-tool-art--${service}`} aria-hidden="true">
    <ServiceIllustration service={service} />
    <span>{feature.eyebrow}</span>
    <strong style={{ whiteSpace: 'pre-line' }}>{feature.headline}</strong>
    <small>{feature.caption}</small>
  </div>
}
