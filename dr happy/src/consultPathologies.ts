export interface ConsultPathology {
  id: string
  specialty: string
  title: string
  shortTitle: string
  cie10: string
  priority: 'Alta' | 'Media' | 'Baja'
  summary: string
  suspicion: {
    typicalContext: string
    keyClues: string[]
    redFlags: string[]
  }
  diagnosis: {
    officeConfirmation: string[]
    initialStudies: string[]
    differentialDiagnosis: string[]
  }
  treatment: {
    nonPharmacological: string[]
    firstLine: string[]
    pharmacologicalOptions: { drug: string; dose: string; notes: string }[]
    therapeuticLadder: { step: string; title: string; criteria: string; action: string; reassessment: string }[]
    avoidOrUseWithCaution: string[]
  }
  followUp: {
    goals: string[]
    monitoring: string[]
    referralCriteria: string[]
  }
  patientMessage: string
  actionCopyTemplate: string
  sourceBasis: string[]
}

export const CONSULT_PATHOLOGIES: ConsultPathology[] = [
  {
    id: 'hta-esencial',
    specialty: 'Cardiología',
    title: 'Hipertensión Arterial Esencial',
    shortTitle: 'HTA esencial',
    cie10: 'I10',
    priority: 'Alta',
    summary:
      'Patología crónica muy frecuente y habitualmente silenciosa. En consultorio no se trata solo un número: se confirma técnica/medición, se estima riesgo cardiovascular global, se busca daño de órgano blanco y se descartan causas secundarias cuando el patrón no encaja.',
    suspicion: {
      typicalContext:
        'Paciente adulto con registros repetidos de presión elevada en consultorio, domicilio, farmacia o control laboral. Puede consultar por cefalea, mareos o epistaxis, pero la mayoría está asintomática.',
      keyClues: [
        'PA elevada en mediciones repetidas con técnica correcta: reposo 5 minutos, espalda apoyada, pies en el piso, brazo a nivel del corazón y manguito adecuado.',
        'Factores de riesgo frecuentes: obesidad abdominal, sedentarismo, dieta alta en sal, alcohol, tabaquismo, diabetes, dislipemia, enfermedad renal o antecedente familiar.',
        'Buscar fármacos/sustancias que elevan PA: AINEs crónicos, corticoides, anticonceptivos, descongestivos, energizantes, cocaína/anfetaminas y regaliz.',
        'HTA nocturna, ronquidos, pausas respiratorias o somnolencia diurna sugieren apnea obstructiva del sueño.',
        'Inicio brusco, edad joven, hipokalemia, crisis paroxísticas o resistencia a 3 fármacos obliga a pensar HTA secundaria.'
      ],
      redFlags: [
        'PA ≥180/120 mmHg con dolor torácico, disnea, déficit neurológico, confusión, convulsiones, alteración visual severa, oliguria o edema agudo de pulmón: derivar a guardia.',
        'Embarazo o puerperio con PA elevada: descartar preeclampsia/eclampsia, no manejar como HTA esencial.',
        'Dolor torácico o dorsal transfixiante, asimetría de pulsos o síncope: sospechar disección aórtica.',
        'Cefalea súbita “en trueno”, focalidad neurológica o papiledema: emergencia neurológica.',
        'HTA severa asintomática no se baja bruscamente en consultorio: confirmar, evaluar daño de órgano y planificar descenso gradual.'
      ]
    },
    diagnosis: {
      officeConfirmation: [
        'Medir ambos brazos en la primera consulta; usar el brazo con mayor PA para controles posteriores.',
        'Realizar 2-3 tomas separadas por 1-2 minutos y promediar. Si la primera toma es muy alta, repetir tras reposo y descartar dolor, ansiedad, cafeína, tabaco o ejercicio reciente.',
        'Confirmar con controles seriados, AMPA o MAPA 24 h si está disponible. Umbrales orientativos: consultorio ≥140/90; domicilio promedio ≥135/85; MAPA 24 h ≥130/80.',
        'Identificar “guardapolvo blanco” y HTA enmascarada: el registro domiciliario ordenado suele cambiar decisiones terapéuticas.',
        'Clasificar grado: 140-159/90-99 grado 1; 160-179/100-109 grado 2; ≥180 y/o ≥110 grado 3.'
      ],
      initialStudies: [
        'Hemograma, glucemia y/o HbA1c, creatinina con eGFR, urea, sodio, potasio, perfil lipídico y orina completa.',
        'Relación albúmina/creatinina urinaria si está disponible: detecta daño renal temprano y modifica riesgo.',
        'ECG de 12 derivaciones: hipertrofia ventricular izquierda, isquemia, arritmias o secuelas de IAM.',
        'Fondo de ojo si HTA severa, diabetes, síntomas visuales o sospecha de daño de órgano blanco.',
        'Según contexto: ecocardiograma, TSH, ácido úrico, MAPA, pesquisa de apnea del sueño o estudio de aldosterona/renina.'
      ],
      differentialDiagnosis: [
        'HTA de guardapolvo blanco.',
        'HTA secundaria renal o renovascular.',
        'Hiperaldosteronismo primario, especialmente si hipokalemia o HTA resistente.',
        'Apnea obstructiva del sueño.',
        'Feocromocitoma/paraganglioma si crisis con cefalea, palpitaciones y sudoración.',
        'Hipertiroidismo, Cushing, coartación de aorta o fármacos/sustancias.'
      ]
    },
    treatment: {
      nonPharmacological: [
        'Reducción de sal: objetivo práctico <5 g de sal/día; evitar ultraprocesados, caldos, fiambres y snacks.',
        'Dieta tipo DASH/mediterránea: frutas, verduras, legumbres, lácteos bajos en grasa, frutos secos y aceite de oliva; menos azúcares y grasas trans.',
        'Actividad física aeróbica 150 min/semana + fuerza 2 días/semana, adaptada a edad/comorbilidad.',
        'Descenso ponderal si sobrepeso: cada reducción sostenida de peso mejora PA y riesgo metabólico.',
        'Reducir alcohol, suspender tabaco, dormir bien y tratar apnea del sueño si está presente.',
        'Evitar AINEs crónicos cuando sea posible; revisar automedicación y suplementos.'
      ],
      firstLine: [
        'Iniciar tratamiento farmacológico si HTA grado 2-3, daño de órgano blanco, diabetes/ERC, alto riesgo cardiovascular o persistencia tras medidas no farmacológicas.',
        'En HTA grado 1 de bajo riesgo puede intentarse intervención intensiva de estilo de vida con reevaluación cercana, si no hay daño de órgano blanco.',
        'Considerar doble terapia inicial si PA ≥160/100, >20/10 mmHg sobre objetivo, alto riesgo o daño de órgano.',
        'Combinaciones preferidas: IECA/ARA II + calcioantagonista dihidropiridínico o IECA/ARA II + tiazida/tiazídico-like.',
        'Betabloqueantes no son primera línea universal, pero sí si hay indicación: cardiopatía isquémica, post-IAM, ciertas arritmias, insuficiencia cardíaca o embarazo con fármacos específicos.'
      ],
      pharmacologicalOptions: [
        {
          drug: 'Enalapril',
          dose: '5 mg cada 12-24 h; titular según PA, creatinina y potasio',
          notes: 'Útil en diabetes, albuminuria, ERC, HVI o insuficiencia cardíaca. Contraindicado en embarazo.'
        },
        {
          drug: 'Losartán',
          dose: '50 mg/día; titular a 100 mg/día',
          notes: 'Alternativa a IECA si tos/intolerancia. No combinar con IECA. Contraindicado en embarazo.'
        },
        {
          drug: 'Amlodipina',
          dose: '5 mg/día; titular a 10 mg/día',
          notes: 'Muy útil en ancianos e HTA sistólica aislada. Vigilar edema maleolar, rubor y cefalea.'
        },
        {
          drug: 'Hidroclorotiazida',
          dose: '12.5-25 mg/día',
          notes: 'Controlar sodio, potasio, ácido úrico y función renal.'
        },
        {
          drug: 'Indapamida / Clortalidona',
          dose: 'Indapamida LP 1.5 mg/día o clortalidona 12.5 mg/día',
          notes: 'Tiazídico-like con buen efecto antihipertensivo; vigilar electrolitos.'
        }
      ],
      therapeuticLadder: [
        {
          step: 'Paso 0',
          title: 'Confirmar antes de intensificar',
          criteria: 'PA elevada aislada o discordante con clínica, técnica dudosa, ansiedad, dolor, cafeína/tabaco reciente o registros domiciliarios no disponibles.',
          action: 'Repetir medición correcta, indicar AMPA/MAPA si es posible, revisar adherencia y descartar emergencia hipertensiva. Si hay daño de órgano blanco o síntomas de alarma, no seguir escala de consultorio: derivar.',
          reassessment: 'Reevaluar con promedio domiciliario o nuevo control en 1-4 semanas según cifras y riesgo.'
        },
        {
          step: 'Paso 1',
          title: 'Riesgo bajo / HTA grado 1 sin daño de órgano',
          criteria: 'PA 140-159/90-99 mmHg, bajo riesgo cardiovascular, sin diabetes/ERC, sin HVI/albuminuria ni enfermedad cardiovascular establecida.',
          action: 'Intervención intensiva de estilo de vida: sal <5 g/día, plan DASH/mediterráneo, actividad física, descenso de peso, alcohol bajo, suspender tabaco y evitar AINEs crónicos. Considerar fármaco si el paciente prefiere tratamiento o hay persistencia.',
          reassessment: 'Control en 4-12 semanas. Si no alcanza objetivo, iniciar monoterapia o combinación según PA/riesgo.'
        },
        {
          step: 'Paso 2',
          title: 'Inicio farmacológico simple',
          criteria: 'HTA grado 1 persistente, riesgo moderado/alto, daño subclínico, diabetes/ERC, o imposibilidad de lograr cambios suficientes.',
          action: 'Monoterapia con IECA/ARA II, calcioantagonista dihidropiridínico o tiazida/tiazídico-like según perfil. Elegir pensando en comorbilidades: albuminuria/ERC favorece IECA/ARA II; anciano/HTA sistólica aislada favorece amlodipina o tiazídico-like.',
          reassessment: 'Control en 2-4 semanas. Titular dosis y controlar creatinina/potasio si IECA/ARA II/diurético.'
        },
        {
          step: 'Paso 3',
          title: 'Doble terapia preferida',
          criteria: 'PA ≥160/100, >20/10 mmHg por encima del objetivo, alto riesgo cardiovascular, daño de órgano blanco o falta de control con monoterapia.',
          action: 'Combinar IECA o ARA II + amlodipina, o IECA/ARA II + tiazida/tiazídico-like. Preferir combinaciones en un comprimido si mejora adherencia. No combinar IECA + ARA II.',
          reassessment: 'Control en 2-4 semanas con AMPA, efectos adversos, ortostatismo, creatinina, sodio y potasio.'
        },
        {
          step: 'Paso 4',
          title: 'Triple terapia',
          criteria: 'No controla con dos fármacos a dosis adecuadas o PA inicial muy elevada con necesidad de intensificación rápida pero ambulatoria.',
          action: 'IECA o ARA II + calcioantagonista dihidropiridínico + tiazida/tiazídico-like. Confirmar adherencia, técnica de toma, exceso de sal, alcohol, AINEs y apnea del sueño antes de rotular resistencia.',
          reassessment: 'Control en 2-4 semanas. Si sigue fuera de objetivo, evaluar HTA resistente.'
        },
        {
          step: 'Paso 5',
          title: 'HTA resistente / derivación',
          criteria: 'PA fuera de objetivo con 3 fármacos adecuados incluyendo diurético, o necesidad de 4 fármacos para controlar.',
          action: 'Confirmar con AMPA/MAPA, buscar secundaria y agregar espironolactona si eGFR y potasio lo permiten, con vigilancia estricta. Derivar a cardiología/nefrología o unidad de HTA.',
          reassessment: 'Control estrecho de potasio/creatinina a 1 semana, luego 4 semanas, y ajuste según respuesta.'
        }
      ],
      avoidOrUseWithCaution: [
        'No combinar IECA + ARA II: aumenta daño renal/hiperkalemia sin beneficio clínico neto.',
        'No iniciar IECA/ARA II en embarazo o sospecha de embarazo.',
        'Controlar creatinina y potasio 1-2 semanas después de iniciar o titular IECA/ARA II/diuréticos.',
        'No bajar rápido una HTA severa asintomática: riesgo de hipoperfusión cerebral, coronaria o renal.',
        'Cuidado con diuréticos en gota, hiponatremia, hipokalemia o fragilidad; individualizar.'
      ]
    },
    followUp: {
      goals: [
        'Objetivo general inicial: <140/90 mmHg; si tolera y el riesgo es alto, acercar a <130/80 mmHg según edad, fragilidad y comorbilidades.',
        'En ancianos frágiles, evitar hipotensión ortostática, caídas y PAD demasiado baja.',
        'El objetivo real es reducir ACV, IAM, insuficiencia cardíaca, enfermedad renal y retinopatía.'
      ],
      monitoring: [
        'Recontrol a 2-4 semanas tras inicio o ajuste; antes si PA muy alta, síntomas o efectos adversos.',
        'Pedir registro domiciliario: mañana/noche, 2 tomas, 3-7 días; promediar descartando el primer día si se usa protocolo AMPA.',
        'Controlar adherencia, técnica de toma, dieta salada, alcohol, AINEs y eventos adversos.',
        'Creatinina/potasio tras IECA/ARA II/diurético y luego según estabilidad.',
        'Reevaluar riesgo cardiovascular global y tratar dislipemia, diabetes, obesidad y tabaquismo.'
      ],
      referralCriteria: [
        'HTA resistente: no controla con 3 fármacos a dosis adecuadas, incluyendo diurético.',
        'Sospecha de HTA secundaria: joven, inicio brusco, hipokalemia, deterioro renal con IECA/ARA II, crisis adrenérgicas o apnea severa.',
        'Daño de órgano blanco: ERC progresiva, albuminuria marcada, HVI significativa, retinopatía avanzada, enfermedad coronaria o ACV.',
        'HTA en embarazo/puerperio: derivación obstétrica.',
        'Emergencia hipertensiva: guardia/shock room.'
      ]
    },
    patientMessage:
      'La presión alta muchas veces no duele ni avisa, pero va dañando arterias, cerebro, corazón, riñones y ojos. El tratamiento no busca solo bajar un número: busca evitar ACV, infarto, insuficiencia cardíaca y daño renal.',
    actionCopyTemplate:
      'HTA ESENCIAL EN CONSULTORIO. PA: ___/___ mmHg, brazo ___, promedio de ___ tomas. Riesgo CV: ___. Daño de órgano blanco: [sí/no] ___. Se solicita: laboratorio renal/metabólico, ionograma, orina/albuminuria y ECG. Medidas: reducción sal, DASH/mediterránea, actividad física, peso, alcohol/tabaco, evitar AINEs. Tratamiento: ___. Objetivo PA: ___. Control en ___ semanas con AMPA y creatinina/potasio según medicación.',
    sourceBasis: [
      'WHO HEARTS technical package for cardiovascular disease management in primary health care.',
      'ESC/ESH Guidelines for the management of arterial hypertension.',
      'ACC/AHA Guideline for prevention, detection, evaluation and management of high blood pressure in adults.',
      'International Society of Hypertension global hypertension practice guidelines.'
    ]
  }
]
