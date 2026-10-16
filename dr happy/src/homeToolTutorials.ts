export interface HomeTutorialStep {
  title: string
  summary: string
}

export interface HomeToolTutorial {
  image: string
  benefit: string
  promise: string
  steps: readonly [HomeTutorialStep, HomeTutorialStep, HomeTutorialStep]
}

export const homeToolTutorials: Record<string, HomeToolTutorial> = {
  ambulance: {
    image: 'ambulance', benefit: 'Lo importante, a mano en la guardia.',
    promise: 'Registrá cada intervención sin perder el hilo de la atención.',
    steps: [
      { title: 'Identificá al paciente', summary: 'Buscá al paciente antes de registrar la intervención.' },
      { title: 'Completá el traslado', summary: 'Anotá el diagnóstico, la ubicación y el destino del paciente.' },
      { title: 'Dejá el registro en su ficha', summary: 'Revisá los datos y guardá la intervención en la historia del paciente.' },
    ],
  },
  attention: {
    image: 'attention', benefit: 'Más continuidad en cada consulta.',
    promise: 'De los antecedentes al plan de manejo, todo en la misma ficha.',
    steps: [
      { title: 'Ubicá el contexto clínico', summary: 'Revisá los antecedentes y los controles antes de completar la evolución.' },
      { title: 'Registrá la consulta', summary: 'Completá el motivo, la enfermedad actual y tu sospecha diagnóstica.' },
      { title: 'Definí el próximo paso', summary: 'Escribí el plan de manejo y revisá la atención antes de guardarla.' },
    ],
  },
  appointments: {
    image: 'appointments', benefit: 'Tu agenda, ordenada y sin vueltas.',
    promise: 'Organizá tus horarios y ofrecé reservas desde tu enlace.',
    steps: [
      { title: 'Prepará tus horarios', summary: 'Entrá a Cupos y link público para configurar la disponibilidad de tu agenda.' },
      { title: 'Agendá una atención', summary: 'Usá Nuevo turno para reservar un horario y asociarlo al paciente.' },
      { title: 'Revisá tus reservas', summary: 'En Lista de turnos podés buscar y filtrar las atenciones agendadas.' },
    ],
  },
  video: {
    image: 'video', benefit: 'Acercá el consultorio a tu paciente.',
    promise: 'Una sala de videoconsulta vinculada a tu trabajo clínico.',
    steps: [
      { title: 'Elegí a quién vas a atender', summary: 'Seleccioná al paciente y, si corresponde, el turno asociado.' },
      { title: 'Prepará la sala', summary: 'Elegí la duración y usá Crear sala. Después compartí la invitación con el paciente.' },
      { title: 'Prepará audio y video', summary: 'Activá cámara y micrófono y entrá a la sala para comenzar la consulta.' },
    ],
  },
  patients: {
    image: 'patients', benefit: 'La historia de tu paciente, en un lugar.',
    promise: 'Encontrá la ficha y seguí trabajando sin buscar entre papeles.',
    steps: [
      { title: 'Encontrá al paciente', summary: 'Buscá por nombre, apellido o DNI para ubicar su ficha.' },
      { title: 'Consultá su historia', summary: 'Abrí la ficha para revisar sus datos, antecedentes y atenciones previas.' },
      { title: 'Continuá la atención', summary: 'Desde la tarjeta podés agendar, evolucionar o preparar un certificado u orden.' },
    ],
  },
  invite: {
    image: 'invite', benefit: 'Menos carga de datos para vos.',
    promise: 'El paciente completa sus datos desde tu invitación.',
    steps: [
      { title: 'Encontrá tu enlace', summary: 'Tu link personal identifica las invitaciones de tu consultorio.' },
      { title: 'Compartilo como prefieras', summary: 'Envialo por WhatsApp o email. El paciente completa sus datos desde su celular.' },
      { title: 'También en el consultorio', summary: 'Mostrá el QR para que el paciente abra el registro con la cámara de su celular.' },
    ],
  },
  'virtual-consult': {
    image: 'virtual-consult', benefit: 'Consultas por escrito, con tu criterio.',
    promise: 'Recibí el motivo, revisá la información y prepará tu devolución.',
    steps: [
      { title: 'Definí tu servicio', summary: 'Configurá el valor y activá las consultas. Para cobrar, conectá Mercado Pago en Perfil.' },
      { title: 'Acercá tu enlace al paciente', summary: 'Copiá o compartí tu link para que el paciente envíe su consulta.' },
      { title: 'Organizá las devoluciones', summary: 'Revisá la bandeja Para revisar. Sofía puede ayudarte; la decisión clínica sigue siendo tuya.' },
    ],
  },
  'paid-documents': {
    image: 'paid-documents', benefit: 'Solicitudes claras, revisión profesional.',
    promise: 'Separá el pedido y el cobro de tu decisión sobre el documento.',
    steps: [
      { title: 'Configurá el arancel', summary: 'Definí el importe del enlace. Para habilitar cobros, conectá Mercado Pago en Perfil.' },
      { title: 'Compartí el enlace', summary: 'Copiá tu enlace fijo para que el paciente envíe el motivo de su solicitud.' },
      { title: 'Revisá antes de emitir', summary: 'En Solicitudes revisás los pedidos pagos y decidís qué respuesta corresponde.' },
    ],
  },
  tools: {
    image: 'tools', benefit: 'Información clínica, a un paso.',
    promise: 'Protocolos y consulta farmacológica dentro de tu espacio de trabajo.',
    steps: [
      { title: 'Elegí qué consultar', summary: 'Usá las pestañas para entrar a protocolos, vademécum o patologías de consultorio.' },
      { title: 'Afiná la búsqueda', summary: 'Buscá la patología o filtrá por área para encontrar el contenido relevante.' },
      { title: 'Profundizá la información', summary: 'Abrí el protocolo completo para consultar la conducta y sus detalles.' },
    ],
  },
  ledger: {
    image: 'ledger', benefit: 'Sabé qué cobraste y qué falta.',
    promise: 'Tratamientos, cobros y saldos con una vista ordenada.',
    steps: [
      { title: 'Mirá el panorama', summary: 'Revisá los totales y el saldo pendiente en Balance de pagos.' },
      { title: 'Registrá el tratamiento', summary: 'Agregá una entrada con el paciente, el concepto y su importe.' },
      { title: 'Seguí cada cobro', summary: 'Filtrá por paciente o estado para ubicar las entradas y registrar los pagos.' },
    ],
  },
  profile: {
    image: 'profile', benefit: 'Tu identidad en cada documento.',
    promise: 'Dejá tus datos profesionales y tu firma listos para trabajar.',
    steps: [
      { title: 'Presentate con tus datos', summary: 'Completá tu nombre, especialidad y matrícula profesional.' },
      { title: 'Prepará tu firma', summary: 'Cargá o dibujá tu firma para incorporarla a los documentos de la app.' },
      { title: 'Guardá tu perfil', summary: 'Revisá los datos y guardá los cambios antes de volver a trabajar.' },
    ],
  },
  subscription: {
    image: 'subscription', benefit: 'Tu plan, sin perder de vista los detalles.',
    promise: 'Consultá la vigencia y el uso de tu asistente en una sola pantalla.',
    steps: [
      { title: 'Conocé tu vigencia', summary: 'Revisá el plan actual y su fecha de vencimiento.' },
      { title: 'Seguí el uso de Sofía', summary: 'Consultá cuántas solicitudes usaste y cuándo se renueva el cupo.' },
      { title: 'Renová cuando lo necesites', summary: 'Elegí el período para renovar o extender tu plan desde esta sección.' },
    ],
  },
  sofia: {
    image: 'sofia', benefit: 'Una ayuda para ordenar tu día clínico.',
    promise: 'Pedile asistencia con la agenda y tus tareas, sin salir de Dr Happy.',
    steps: [
      { title: 'Contale qué necesitás', summary: 'Escribí tu pedido con el contexto necesario: agenda, pacientes o tareas clínicas.' },
      { title: 'También podés dictar', summary: 'Usá el micrófono si preferís hablar en lugar de escribir tu pedido.' },
      { title: 'Enviá y revisá', summary: 'Enviá el pedido. Revisá la respuesta y confirmá los cambios que Sofía proponga.' },
    ],
  },
}

export function getHomeToolTutorial(key: string, label: string): HomeToolTutorial | undefined {
  if (!Object.hasOwn(homeToolTutorials, key)) return undefined
  if (key === 'attention' && label.toLocaleLowerCase('es').includes('odont')) {
    return {
      image: 'attention-dental', benefit: 'Cada pieza, cada tratamiento, en su lugar.',
      promise: 'Un odontograma para seguir la evolución de tu paciente.',
      steps: [
        { title: 'Reconocé la ficha', summary: 'Revisá los datos del paciente antes de trabajar en su odontograma.' },
        { title: 'Registrá el estado dental', summary: 'Elegí las piezas y usá las referencias para registrar los hallazgos y tratamientos.' },
        { title: 'Guardá la atención', summary: 'Guardá los cambios para conservar el registro en la ficha odontológica.' },
      ],
    }
  }
  if (key === 'tools' && label === 'Vademécum') {
    return {
      image: 'tools-dental', benefit: 'Tu consulta farmacológica, más cerca.',
      promise: 'Buscá medicamentos desde tu espacio de trabajo.',
      steps: [
        { title: 'Buscá el medicamento', summary: 'Escribí la marca o el principio activo en el buscador del vademécum.' },
        { title: 'Elegí una coincidencia', summary: 'Revisá los resultados y seleccioná la presentación que querés consultar.' },
        { title: 'Leé los detalles', summary: 'Consultá la información de la ficha como apoyo a tu criterio profesional.' },
      ],
    }
  }
  return homeToolTutorials[key]
}

export function homeToolTutorialImage(image: string, step = 0): string {
  return `${import.meta.env.BASE_URL}tool-tutorials/${image}-${step + 1}.png`
}
