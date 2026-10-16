export interface HomeToolTutorial {
  image: string
  summary: string
}

export const homeToolTutorials: Record<string, HomeToolTutorial> = {
  ambulance: {
    image: 'ambulance',
    summary: 'Elegí al paciente, completá diagnóstico, ubicación y destino. Guardá la atención en su ficha.',
  },
  attention: {
    image: 'attention',
    summary: 'Buscá al paciente y abrí su ficha. Registrá la evolución, el diagnóstico y el plan; luego guardá la atención.',
  },
  appointments: {
    image: 'appointments',
    summary: 'Creá un turno o configurá cupos y tu link público. Revisá la agenda, la ocupación y los recordatorios.',
  },
  video: {
    image: 'video',
    summary: 'Elegí al paciente, creá una sala y compartí la invitación. Activá cámara y micrófono para iniciar la consulta.',
  },
  patients: {
    image: 'patients',
    summary: 'Buscá por nombre o DNI y abrí la ficha. Consultá antecedentes, atenciones y adjuntos, o agendá un turno.',
  },
  invite: {
    image: 'invite',
    summary: 'Copiá tu enlace y compartilo. El paciente completa sus datos y, si autoriza, comparte su Carpeta de Salud.',
  },
  'virtual-consult': {
    image: 'virtual-consult',
    summary: 'Configurá tu enlace y arancel. Revisá las consultas recibidas y prepará la devolución con ayuda de Sofía.',
  },
  'paid-documents': {
    image: 'paid-documents',
    summary: 'Configurá el arancel y compartí tu enlace. Revisá cada solicitud paga antes de emitir el documento.',
  },
  tools: {
    image: 'tools',
    summary: 'Elegí una sección y buscá por patología o medicamento. Consultá protocolos, indicaciones y dosis.',
  },
  ledger: {
    image: 'ledger',
    summary: 'Elegí al paciente y registrá el tratamiento y su importe. Cargá los cobros y revisá los saldos pendientes.',
  },
  profile: {
    image: 'profile',
    summary: 'Completá tus datos y matrícula, cargá tu firma y guardá los cambios para usarlos en tus documentos.',
  },
  subscription: {
    image: 'subscription',
    summary: 'Revisá tu vencimiento, el consumo de Sofía y los pagos. Elegí un período si necesitás renovar tu plan.',
  },
  sofia: {
    image: 'sofia',
    summary: 'Escribí o dictá tu pedido sobre agenda o tareas clínicas. Revisá la propuesta antes de confirmar cambios.',
  },
}

export function getHomeToolTutorial(key: string, label: string): HomeToolTutorial | undefined {
  if (!Object.hasOwn(homeToolTutorials, key)) return undefined
  if (key === 'attention' && label.toLocaleLowerCase('es').includes('odont')) {
    return {
      image: 'attention-dental',
      summary: 'Buscá al paciente y abrí su odontograma. Registrá el estado dental y los tratamientos; guardá la ficha.',
    }
  }
  if (key === 'tools' && label === 'Vademécum') {
    return {
      image: 'tools-dental',
      summary: 'Buscá por marca o principio activo. Abrí el medicamento para consultar su presentación e información.',
    }
  }
  return homeToolTutorials[key]
}

export function homeToolTutorialImage(image: string): string {
  return `${import.meta.env.BASE_URL}tool-tutorials/${image}.jpg`
}
