import type { MobileHomeAction } from './MobileHomeMenu'
import './homeToolGuide.css'

const descriptions: Record<string, string> = {
  ambulance: 'Registrá traslados y atenciones de guardia con los datos de cada intervención.',
  attention: 'Documentá la consulta, los antecedentes y la evolución en la ficha del paciente.',
  appointments: 'Organizá horarios y cupos para administrar tu agenda de atención.',
  video: 'Realizá una consulta por videollamada con tu paciente.',
  patients: 'Consultá las fichas, las atenciones previas y los archivos de tus pacientes.',
  invite: 'Invitá al paciente a completar sus datos. Con su autorización, accedé a los estudios y registros de presión de su Carpeta de Salud.',
  'virtual-consult': 'Revisá las consultas enviadas por pacientes con la asistencia de Sofía.',
  'paid-documents': 'Gestioná solicitudes pagas de certificados y órdenes mediante tu enlace profesional.',
  tools: 'Consultá información farmacológica y las herramientas clínicas disponibles para tu especialidad.',
  ledger: 'Llevá el seguimiento de tratamientos, importes, cobros y saldos pendientes.',
  profile: 'Completá tus datos profesionales, matrícula, firma y preferencias de la cuenta.',
  subscription: 'Consultá tu plan, su vigencia y el consumo de tu asistente Sofía.',
}

export function HomeToolGuide({ actions }: {
  actions: ReadonlyArray<Pick<MobileHomeAction, 'key' | 'icon' | 'label'>>
}) {
  return (
    <section className="home-tool-guide" aria-labelledby="home-tool-guide-title">
      <header>
        <span className="section-kicker">Conocé Dr Happy</span>
        <h2 id="home-tool-guide-title">Tus herramientas, de un vistazo</h2>
        <p>Una guía rápida de lo que podés hacer. Para usar cada herramienta, elegila en el menú.</p>
      </header>
      <div className="home-tool-guide-grid">
        {actions.filter((action) => Object.hasOwn(descriptions, action.key)).map((action) => (
          <article className="home-tool-guide-card" key={action.key}>
            <span className="home-tool-guide-icon" aria-hidden="true">{action.icon}</span>
            <div>
              <h3>{action.label}</h3>
              <p>{descriptions[action.key]}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
