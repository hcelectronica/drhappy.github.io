export interface ClinicalProtocol {
  id: string
  title: string
  shortTitle: string
  category: 'Pediatría' | 'Cardiovascular' | 'Neurológico' | 'Respiratorio' | 'Trauma' | 'Infeccioso / Shock' | 'Inmunológico / Alergia' | 'Metabólico' | 'Toxicología'
  cie10: string
  severity: 'Crítica / Código Rojo' | 'Urgencia / Código Amarillo' | 'Prioritaria'
  summary: string
  prehospitalManifestations: {
    setting: string
    keySigns: string[]
    highSuspicionRedFlags: string[]
  }
  diagnosticAlgorithm: {
    initialSteps: string[]
    electrocardiogram: string[]
    biomarkersAndLabs: string[]
    differentialDiagnosis: string[]
  }
  management: {
    prehospitalAmbulance: string[]
    emergencyRoomShockRoom: string[]
    initialPharmacotherapy: { drug: string; dose: string; route: string; notes: string }[]
  }
  therapeuticWindow: {
    timeframe: string
    goldStandard: string
    alternativeReperfusion: string
    contraindications: string[]
  }
  evidenceAndPrognosis: {
    survivalAt6h: string
    survivalAt24h: string
    survivalAt7d: string
    survivalAt1y: string
    immediateComplications: string[]
    mediateAndLongTermComplications: string[]
  }
  actionCopyTemplate: string
}

export const CLINICAL_PROTOCOLS: ClinicalProtocol[] = [
  {
    id: 'iamcest',
    title: 'Infarto Agudo de Miocardio con Elevación del ST (IAMCEST)',
    shortTitle: 'IAMCEST / STEMI',
    category: 'Cardiovascular',
    cie10: 'I21.0 - I21.3 (IAM transmural)',
    severity: 'Crítica / Código Rojo',
    summary: 'Oclusión coronaria total aguda. Emergencia tiempo-dependiente con indicación perentoria de reperfusión inmediata (angioplastia primaria o fibrinolisis).',
    prehospitalManifestations: {
      setting: 'Inicio habitual en domicilio, vía pública o ámbito laboral, frecuentemente en reposo o tras esfuerzo/estrés.',
      keySigns: [
        'Dolor retroesternal o precordial intenso, de carácter opresivo, constrictivo ("pata de elefante"), con duración > 20 minutos y sin respuesta al reposo.',
        'Irradiación típica a miembro superior izquierdo (borde cubital), cuello, mandíbula, epigastrio o región interescapular.',
        'Cortejo vegetativo florido: diaforesis fría profusa, palidez cutáneo-mucosa, náuseas, vómitos y mareos.',
        'Sensación de angustia extrema o muerte inminente ("angor animi") y disnea súbita asociada.',
        'Presentaciones atípicas (equivalentes anginosos): disnea aislada, dolor epigástrico, confusión o síncope (muy frecuente en ancianos, mujeres y pacientes diabéticos).'
      ],
      highSuspicionRedFlags: [
        'Hipotensión arterial (PAS < 90 mmHg), taquicardia > 100 lpm o bradicardia < 50 lpm (signos de shock cardiogénico).',
        'Rales crepitantes bibasales o en campos medios (Killip II-III / Edema Agudo de Pulmón).',
        'Síncope o presíncope al inicio del cuadro (alerta de taquiarritmia ventricular maligna o bloqueo AV completo).'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Primer contacto médico (PCM): anamnesis dirigida, evaluación rápida ABCDE y signos vitales.',
        'Realizar ECG de 12 derivaciones en los primeros 10 minutos (tiempo PCM-a-ECG ≤ 10 min) e interpretar de inmediato.',
        'Si el ECG inicial no es diagnóstico pero la sospecha persiste, repetir cada 10-15 minutos o realizar derivaciones posteriores (V7-V9) y derechas (V3R-V4R).'
      ],
      electrocardiogram: [
        'Nueva elevación del punto J persistente en ≥ 2 derivaciones contiguas: ≥ 2.5 mm en V2-V3 en varones < 40 años; ≥ 2 mm en varones ≥ 40 años; ≥ 1.5 mm en mujeres de cualquier edad; ≥ 1 mm en el resto de derivaciones.',
        'Bloqueo de rama izquierda (BRI) nuevo o presuntamente nuevo con criterios de Sgarbossa / Smith-modified.',
        'Depresión del ST en V1-V3 con ondas R altas y T positivas (equivalente a infarto posterior; confirmar con V7-V9 ≥ 0.5 mm).'
      ],
      biomarkersAndLabs: [
        'Troponina I o T de alta sensibilidad (hs-cTn) al ingreso. ¡ATENCIÓN: No demorar la reperfusión en IAMCEST esperando el resultado de laboratorio!',
        'Laboratorio general: Hemograma, coagulograma (TP/KPTT), función renal (urea, creatinina), ionograma y glucemia.'
      ],
      differentialDiagnosis: [
        'Disección aórtica aguda tipo A (descartar antes de trombolíticos si hay asimetría de pulsos o dolor transfixiante dorsal).',
        'Pericarditis aguda (elevación cóncava difusa del ST, infradesnivel del PR, dolor que calma al inclinarse hacia adelante).',
        'Tromboembolismo pulmonar masivo.',
        'Miocardiopatía por estrés (Takotsubo).',
        'Espasmo esofágico / Úlcera péptica perforada.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Reposo absoluto en posición semisentada a 30-45°.',
        'Oxigenoterapia solo si SatO2 < 90% o PaO2 < 60 mmHg (el exceso de O2 induce vasoconstricción coronaria).',
        'Monitorización cardíaca continua y desfibrilador listo para uso inmediato.',
        'Colocación de 1 o 2 accesos venosos periféricos (preferencia miembro superior izquierdo si se prevé cateterismo radial derecho).',
        'Activación inmediata de Código Infarto / Red de Reperfusión provincial/institucional.',
        'Antiagregación plaquetaria precoz en ambulancia según protocolo de derivación.'
      ],
      emergencyRoomShockRoom: [
        'Ingreso directo a Shock Room o pase directo a Sala de Hemodinamia ("bypass" de guardia si la red está activa).',
        'Alivio sintomático del dolor: Nitroglicerina sublingual 0.4-0.5 mg c/5 min (máx 3 dosis) si PAS > 100 mmHg (CONTRAINDICADA en infarto de ventrículo derecho o uso de inhibidores de PDE5/Sildenafil en últimas 24-48h).',
        'Morfina EV 2-4 mg lenta si el dolor es refractario (usar con precaución por retardo en absorción de antiagregantes).',
        'Anticoagulación con Heparina Sódica o Enoxaparina según estrategia elegida.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Ácido Acetilsalicílico (AAS)',
          dose: '162 a 325 mg (dosis de carga)',
          route: 'Vía oral masticada',
          notes: 'Administrar a todos sin contraindicación (alergia activa o hemorragia digestiva exanguinante).'
        },
        {
          drug: 'Ticagrelor o Clopidogrel (Inhibidor P2Y12)',
          dose: 'Ticagrelor 180 mg carga (o Clopidogrel 300-600 mg carga si se fibrinolisará o no hay Ticagrelor)',
          route: 'Vía oral',
          notes: 'En > 75 años con fibrinolisis, la dosis de carga de clopidogrel es 75 mg.'
        },
        {
          drug: 'Heparina no fraccionada (HNF) o Enoxaparina',
          dose: 'HNF bolo 70-100 UI/kg EV (en ATC) // Enoxaparina 30 mg bolo EV + 1 mg/kg SC c/12h (en fibrinolisis)',
          route: 'Intravenosa / Subcutánea',
          notes: 'Ajustar en insuficiencia renal o edad > 75 años.'
        },
        {
          drug: 'Nitroglicerina',
          dose: '0.4 mg SL o infusión continua 5-10 mcg/min',
          route: 'Sublingual / EV en goteo',
          notes: 'Solo si PAS > 100 mmHg y no hay afectación de VD ni uso de sildenafil.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Tiempo es miocardio: la ventana máxima de beneficio de reperfusión es de 12 horas desde el inicio de los síntomas (beneficio crítico en las primeras 2 a 3 horas).',
      goldStandard: 'Angioplastia Coronaria Primaria (ATC): tiempo PCM-a-Guía < 90 min (en centro con hemodinamia) o < 120 min si requiere traslado.',
      alternativeReperfusion: 'Fibrinolisis (TNK-Tenecteplasa bolo peso-ajustado o Estreptoquinasa 1.5M UI en 60 min): si el tiempo estimado a la ATC primaria es > 120 minutos, administrar fibrinolítico en los primeros 10 minutos ("tiempo aguja" ≤ 10 min).',
      contraindications: [
        'Absolutas para fibrinolisis: ACV hemorrágico previo en cualquier momento, ACV isquémico < 6 meses, neoplasia o malformación vascular del SNC, sangrado digestivo < 1 mes, sospecha de disección aórtica, punción no compresible < 24h.'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Reperfusión en ventana dorada (< 2-3h): Sobrevida aguda > 95-97%. Aborta necrosis transmural extensa.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~93-95% con reperfusión exitosa. Sin reperfusión, mortalidad aguda asciende al 12-16%.',
      survivalAt7d: 'Sobrevida a los 7 días: ~91-94%. El pronóstico depende del Killip-Kimball de ingreso y la fracción de eyección residual.',
      survivalAt1y: 'Sobrevida al año: 88-92% con tratamiento médico óptimo post-infarto (DAPT, estatinas alta intensidad, IECA/ARAII, betabloqueantes).',
      immediateComplications: [
        'Fibrilación ventricular primaria o Taquicardia ventricular sin pulso (primera causa de muerte prehospitalaria en las primeras 2h).',
        'Shock cardiogénico (Killip IV, mortalidad 40-50%).',
        'Bloqueo AV completo (frecuente en IAM inferior por afectación de coronaria derecha).'
      ],
      mediateAndLongTermComplications: [
        'Complicaciones mecánicas (día 3-7): rotura de pared libre, rotura del tabique interventricular o rotura de músculo papilar con insuficiencia mitral aguda severa.',
        'Insuficiencia cardíaca crónica con FEVI reducida por remodelado ventricular.',
        'Aneurisma ventricular y trombosis mural del ventrículo izquierdo.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON SOSPECHA DE IAMCEST. ECG de 12 derivaciones realizado a los <10 min. Conducta: Reposo en cama, monitorización cardíaca continua, SatO2 evaluada, 2 vías periféricas. Dosis de carga administrada: AAS 300 mg masticable + Inhibidor P2Y12 según esquema. Se activa red de reperfusión / derivación a hemodinamia de urgencia (Objetivo PCM-Guía <120 min).'
  },
  {
    id: 'pcr-acls',
    title: 'Paro Cardiorrespiratorio en Adultos (PCR / Algoritmo ACLS Avanzado)',
    shortTitle: 'PCR / Algoritmo ACLS',
    category: 'Cardiovascular',
    cie10: 'I46.0 - I46.9 (Paro cardíaco)',
    severity: 'Crítica / Código Rojo',
    summary: 'Cese brusco e inesperado de la circulación y respiración espontáneas. Algoritmo universal de soporte vital cardiovascular avanzado (ritmos desfibrilables FV/TVSP vs no desfibrilables AESP/Asistolia).',
    prehospitalManifestations: {
      setting: 'Vía pública, domicilio, transporte o guardia. Colapso súbito e inesperado.',
      keySigns: [
        'Pérdida súbita del conocimiento / inconsciencia absoluta (no responde al llamado ni estímulo táctil).',
        'Ausencia de respiración normal o presencia de respiración agónica / boqueo ("gasping").',
        'Ausencia de pulso central palpable (carotídeo o femoral) verificado en no más de 10 segundos.',
        'Palidez cérea, cianosis progresiva y midriasis paralítica bilateral.',
        'Flacidez muscular generalizada e incontinencia de esfínteres.'
      ],
      highSuspicionRedFlags: [
        'Tiempo de colapso sin RCP > 5-10 minutos (riesgo exponencial de muerte encefálica irreversible).',
        'Asistolia prolongada con frialdad extrema o signos de muerte evidente (rigidez, livideces).',
        'Sospecha de causa etiológica corregible inmediata: neumotórax a tensión, taponamiento cardíaco, hipoxia severa, intoxicación por opioides.'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Seguridad de la escena. Confirmar inconsciencia y falta de respiración / gasping.',
        'Activar sistema de emergencias y solicitar Desfibrilador (DEA / Monitor desfibrilador manual).',
        'Iniciar compresiones torácicas inmediatas de alta calidad: frecuencia 100-120 cpm, profundidad 5-6 cm, permitir reexpansión torácica completa, minimizar interrupciones (< 10 seg).',
        'Conectar monitor/paletas y verificar ritmo: ¿Desfibrilable (FV / TV sin pulso) o No Desfibrilable (Asistolia / AESP)?'
      ],
      electrocardiogram: [
        'Fibrilación Ventricular (FV): ondulación caótica irregular sin complejos QRS identificables.',
        'Taquicardia Ventricular sin Pulso (TVSP): complejos anchos rápidos monomórficos/polimórficos sin perfusión.',
        'Asistolia: línea isoeléctrica en al menos 2 derivaciones contiguas (confirmar cables y ganancia).',
        'Actividad Eléctrica Sin Pulso (AESP): ritmo eléctrico organizado en monitor en ausencia total de pulso palpable.'
      ],
      biomarkersAndLabs: [
        'Capnografía cuantitativa en forma de onda (ETCO2): objetivo > 10-20 mmHg durante compresiones; un salto brusco de ETCO2 > 35-40 mmHg es el indicador más precoz de RCE (Retorno de Circulación Espontánea).',
        'Glucemia capilar inmediata y gasometría de urgencia con ionograma (descartar hipo/hiperpotasemia, acidosis severa).'
      ],
      differentialDiagnosis: [
        'Buscar y tratar causas reversibles (Las 5 H y 5 T):',
        '5 H: Hipovolemia, Hipoxia, Hidrogeniones (acidosis), Hipo/Hiperpotasemia, Hipotermia.',
        '5 T: Neumotórax a Tensión, Taponamiento cardíaco, Tóxicos, Trombosis coronaria (IAM), Trombosis pulmonar (TEP masivo).'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Prioridad 1: RCP de alta calidad continua con rotación del operador cada 2 minutos.',
        'Desfibrilación inmediata precoz si el ritmo es FV/TVSP (120-200 J bifásico o 360 J monofásico), reiniciar compresiones inmediatamente sin verificar pulso.',
        'Acceso vascular rápido (IV periférico o Intraósea IO humeral/tibial).',
        'Vía aérea avanzada: dispositivo supraglótico (I-gel / Tubo Laríngeo) o intubación orotraqueal SIN interrumpir el masaje torácico.',
        'Administración de Adrenalina y Antiarrítmicos según ritmo y ciclo.'
      ],
      emergencyRoomShockRoom: [
        'Shock Room: asignación estricta de roles de equipo (Líder, Masajeador, Vía aérea, Fármacos, Registro/Tiempo).',
        'Evaluación ecográfica POCUS durante pausas de 10 seg (descartar taponamiento, neumotórax, evaluar motilidad cardíaca).',
        'Si RCE (Retorno de Circulación Espontánea): cuidados post-paro inmediatos: optimizar ventilación (Sat 92-98%, PaCO2 35-45 mmHg), hemodinamia (PAM ≥ 65 mmHg con noradrenalina si precisa), ECG 12 derivaciones (si IAMCEST -> hemodinamia urgente) y control de temperatura objetivo (32-36°C).'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Adrenalina (Epinefrina 1:1000 / 1:10000)',
          dose: '1 mg (1 ampolla de 1 mg) cada 3 a 5 minutos EV / IO',
          route: 'Intravenosa / Intraósea rápida + flush 20 ml SF',
          notes: 'En ritmos NO desfibrilables: administrar lo antes posible. En ritmos desfibrilables: tras la 2° descarga.'
        },
        {
          drug: 'Amiodarona (o Lidocaína)',
          dose: '1° dosis: 300 mg en bolo EV/IO. 2° dosis: 150 mg en bolo EV/IO',
          route: 'Intravenosa / Intraósea rápida',
          notes: 'Indicado en FV/TVSP refractaria a la 3° descarga. Alternativa: Lidocaína 1-1.5 mg/kg 1° dosis, luego 0.5-0.75 mg/kg.'
        },
        {
          drug: 'Sulfato de Magnesio',
          dose: '1 a 2 g EV diluidos en 10 ml D5% en 1-2 minutos',
          route: 'Intravenosa / Intraósea',
          notes: 'Indicado específicamente si se sospecha Torsade de Pointes (TV polimórfica con QT prolongado) o hipomagnesemia.'
        },
        {
          drug: 'Bicarbonato de Sodio 1M (8.4%)',
          dose: '1 mEq/kg EV bolo',
          route: 'Intravenosa',
          notes: 'Solo indicado en hiperpotasemia severa conocida, acidosis metabólica preexistente o intoxicación por antidepresivos tricíclicos.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Ventana de resucitación cerebral: los primeros 3 a 4 minutos sin masaje torácico producen daño neuronal irreversible. Cada minuto sin desfibrilación en FV disminuye la sobrevida en un 7-10%.',
      goldStandard: 'Desfibrilación ultra-precoz (< 2 min) + RCP de alta calidad continua + resolución de la causa reversible desencadenante.',
      alternativeReperfusion: 'Soporte vital extracorpóreo (E-CPR / ECMO veno-arterial) en centros especializados de alta complejidad para PCR presenciado refractario.',
      contraindications: [
        'Criterios de no inicio o cese de RCP: orden médica válida de No Reanimar (DNR), signos inequívocos de muerte biológica (decapitación, rigor mortis, livideces fijas, carbonización), asistolia persistente > 20-30 min con protocolo completo y todas las causas reversibles tratadas (salvo hipotermia severa: "no está muerto hasta que esté caliente y muerto").'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'En FV presenciada con desfibrilación inmediata (< 3 min): sobrevida inicial con RCE > 50-70%. En asistolia extrahospitalaria no presenciada: RCE < 10-15%.',
      survivalAt24h: 'Sobrevida a las 24 horas: 25-40% de los pacientes con RCE; la mayoría requiere soporte ventilatorio y vasopresor intensivo.',
      survivalAt7d: 'Sobrevida al alta hospitalaria: ~10-12% en PCR extrahospitalario global; asciende a 30-35% en ritmo inicial FV con respuesta precoz de testigos.',
      survivalAt1y: 'Sobrevida al año con buen estado neurológico (CPC 1-2): 8-10% global; > 25% en PCR por FV con angioplastia y cuidados post-paro.',
      immediateComplications: [
        'Síndrome post-paro cardíaco (daño cerebral anóxico, disfunción miocárdica post-resucitación, respuesta sistémica de isquemia-reperfusión).',
        'Fracturas costales/esternales y neumotórax traumático secundario a compresiones.',
        'Edema pulmonar no cardiogénico e inestabilidad hemodinámica severa.'
      ],
      mediateAndLongTermComplications: [
        'Encefalopatía anóxica-isquémica severa y estado vegetativo persistente.',
        'Miocardiopatía isquémica dilatada con falla cardíaca crónica.',
        'Déficit neurocognitivo y síndrome de estrés postraumático familiar.'
      ]
    },
    actionCopyTemplate: 'PACIENTE EN PARO CARDIORRESPIRATORIO (PCR). Ritmo inicial detectado: [FV / TVSP / Asistolia / AESP]. Maniobras de RCP avanzada iniciadas con compresiones de alta calidad. Número de descargas: ___. Fármacos administrados: Adrenalina ___ mg + Antiarrítmico: ___. Causas 5H y 5T evaluadas. Estado actual: [RCE logrado con ETCO2 ___ mmHg / Óbito tras 25 min de maniobras sin respuesta].'
  },
  {
    id: 'iamsest',
    title: 'Síndrome Coronario Agudo sin Elevación del ST (IAMSEST / Angina Inestable)',
    shortTitle: 'IAMSEST / NSTEMI',
    category: 'Cardiovascular',
    cie10: 'I21.4 (IAM subendocárdico) / I20.0 (Angina inestable)',
    severity: 'Urgencia / Código Amarillo',
    summary: 'Isquemia miocárdica aguda sin oclusión transmural completa persistente. Estratificación de riesgo rápida (GRACE / TIMI / CRUSADE) para definir momento de coronariografía invasiva.',
    prehospitalManifestations: {
      setting: 'Aparición en reposo, de novo (aparición reciente < 2 meses severa) o in crescendo (progresiva en frecuencia o intensidad).',
      keySigns: [
        'Dolor retroesternal o malestar precordial opresivo de intensidad variable, habitualmente intermitente o > 15-20 min.',
        'Disnea asociada de esfuerzo progresivo o en reposo.',
        'Sensación de indigestión, epigastralgia opresiva inexplicable o molestia mandibular.',
        'Diaforesis moderada, astenia marcada o mareos.',
        'Falta de elevación persistente del segmento ST en el ECG.'
      ],
      highSuspicionRedFlags: [
        'Inestabilidad hemodinámica o shock cardiogénico.',
        'Dolor precordial refractario al tratamiento médico inicial.',
        'Arritmias ventriculares sostenidas o cambios dinámicos del ST (depresión > 1 mm o inversión profunda de onda T).'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'ECG en ≤ 10 minutos. Evaluar infradesnivel del ST, inversión de ondas T simétricas o ECG aparentemente normal.',
        'Troponina ultrasensible (hs-cTn) con algoritmo de descarte/confirmación rápido a las 0h y 1h (o 0h y 2h).'
      ],
      electrocardiogram: [
        'Infradesnivel del segmento ST horizontal o descendente ≥ 0.5 mm en ≥ 2 derivaciones contiguas.',
        'Inversión profunda y simétrica de ondas T (≥ 2 mm) en derivaciones anteriores (Síndrome de Wellens: alta sospecha de lesión crítica de DA proximal).',
        'Infradesnivel multiderivacional (≥ 6 derivaciones) con elevación del ST en aVR (sospecha de lesión de tronco coronario izquierdo o enfermedad de 3 vasos).'
      ],
      biomarkersAndLabs: [
        'Troponina hs-cTn I o T cuantitativa seriada.',
        'Hemograma (descartar anemia que agrave la isquemia), función renal, ionograma, coagulograma.'
      ],
      differentialDiagnosis: [
        'Miocarditis aguda / Pericarditis.',
        'Crisis de pánico / Ataque de ansiedad.',
        'Enfermedad por reflujo gastroesofágico / Espasmo esofágico.',
        'Costocondritis (Síndrome de Tietze).'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Reposo absoluto, monitorización de signos vitales y trazado de ECG.',
        'Vía venosa permeable.',
        'AAS 162-325 mg vía oral.',
        'Nitratos SL si hay dolor y no hay contraindicaciones de presión ni vasodilatadores.',
        'Traslado a centro con unidad coronaria / hemodinamia disponible.'
      ],
      emergencyRoomShockRoom: [
        'Estratificación de riesgo clínico: cálculo de score GRACE (> 140 = Muy alto riesgo) o TIMI.',
        'Estrategia invasiva muy urgente (< 2h): si hay inestabilidad, arritmias ventriculares o dolor refractario.',
        'Estrategia invasiva precoz (< 24h): si hay confirmación de IAMSEST con biomarcadores positivos o GRACE > 140.',
        'Anticoagulación completa con Enoxaparina 1 mg/kg SC c/12h o Fondaparinux 2.5 mg/día.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Ácido Acetilsalicílico (AAS)',
          dose: '162 a 325 mg carga VO',
          route: 'Vía oral masticada',
          notes: 'Mantenimiento: 100 mg/día de por vida.'
        },
        {
          drug: 'Inhibidor P2Y12 (Ticagrelor o Clopidogrel)',
          dose: 'Ticagrelor 180 mg o Clopidogrel 300-600 mg',
          route: 'Vía oral',
          notes: 'En estrategia invasiva inmediata puede reservarse la carga para la sala de hemodinamia.'
        },
        {
          drug: 'Enoxaparina sódica',
          dose: '1 mg/kg cada 12 horas SC',
          route: 'Subcutánea',
          notes: 'Ajustar a 1 mg/kg cada 24h si Clearance de creatinina < 30 ml/min.'
        },
        {
          drug: 'Betabloqueante (Bisoprolol / Atenolol / Carvedilol)',
          dose: 'Bisoprolol 2.5-5 mg/día VO',
          route: 'Vía oral',
          notes: 'Iniciar en las primeras 24h si no hay signos de insuficiencia cardíaca aguda ni broncoespasmo.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Estratificación continua: Muy alto riesgo (< 2h a cateterismo), Alto riesgo (< 24h a cateterismo), Riesgo bajo/intermedio (< 72h o prueba funcional no invasiva).',
      goldStandard: 'Coronariografía con revascularización percutánea (angioplastia con stent liberador de fármacos).',
      alternativeReperfusion: 'La fibrinolisis NO está indicada en IAMSEST (aumenta el riesgo de hemorragia sin beneficio demostrado).',
      contraindications: [
        'No administrar fibrinolíticos en ausencia de supradesnivel del ST.'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Mortalidad hiperaguda < 1-2% bajo monitorización y tratamiento médico precoz.',
      survivalAt24h: 'Sobrevida a las 24 horas: 97-98%.',
      survivalAt7d: 'Sobrevida a los 7 días: 95-97%.',
      survivalAt1y: 'Sobrevida al año: 88-92% (a largo plazo la mortalidad del IAMSEST iguala o supera a la del IAMCEST por mayor edad y comorbilidades asociadas).',
      immediateComplications: [
        'Progresión a oclusión total e IAMCEST con shock.',
        'Arritmias ventriculares y auriculares.',
        'Insuficiencia cardíaca descompensada.'
      ],
      mediateAndLongTermComplications: [
        'Reinfarto miocárdico recurrente.',
        'Isquemia residual post-revascularización.',
        'Hemorragia mayor asociada a doble antiagregación y anticoagulación.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON CUADRO COMPATIBLE CON SCASEST / IAMSEST. ECG sin elevación persistente de ST. Se administra AAS 300 mg carga + Enoxaparina 1 mg/kg SC. Se solicitan troponinas seriadas 0-1h y laboratorio general. Estratificación de riesgo en curso para coronariografía programada.'
  },
  {
    id: 'crisis-hta',
    title: 'Crisis Hipertensiva: Emergencia vs Urgencia Hipertensiva',
    shortTitle: 'Crisis Hipertensiva',
    category: 'Cardiovascular',
    cie10: 'I10 (Hipertensión esencial) / I16.0 - I16.9 (Crisis hipertensiva)',
    severity: 'Crítica / Código Rojo',
    summary: 'Elevación aguda y severa de la presión arterial (habitualmente PAS ≥ 180 mmHg o PAD ≥ 120 mmHg). La presencia de daño de órgano diana (DOD) define la Emergencia Hipertensiva.',
    prehospitalManifestations: {
      setting: 'Frecuente abandono de medicación antihipertensiva, consumo excesivo de sodio, estrés severo, tóxicos (cocaína, anfetaminas) o nefropatías agudas.',
      keySigns: [
        'Cefalea intensa, pulsátil, predominantemente occipital u holocraneal, que no cede con analgésicos comunes.',
        'Alteraciones visuales: visión borrosa, fotopsias, escotomas o amaurosis fugaz.',
        'Disnea súbita, ortopnea, sensación de opresión torácica o palpitaciones taquicárdicas.',
        'Signos neurológicos focales: debilidad facial/braquial, confusión, letargo, ataxia o convulsiones.',
        'Epistaxis profusa o náuseas/vómitos de origen central.'
      ],
      highSuspicionRedFlags: [
        'Déficit neurológico focal agudo (sospecha de ACV hemorrágico/isquémico o Encefalopatía Hipertensiva).',
        'Dolor torácico transfixiante desgarrador irradiado al dorso (sospecha de Disección Aórtica aguda).',
        'Disnea severa con rales hasta vértices y expectoración asalmonada (Edema Agudo de Pulmón cardiogénico).'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Medición de PA en ambos brazos con manguito adecuado al diámetro del brazo.',
        'Fondo de ojo de urgencia (descartar papiledema, exudados o hemorragias en llama).',
        'Evaluación neurológica rápida y examen cardiovascular (pulsos periféricos simétricos, soplos cardíacos/carotídeos).'
      ],
      electrocardiogram: [
        'Signos de hipertrofia ventricular izquierda (índice de Sokolow-Lyon > 35 mm).',
        'Sobrecarga sistólica ventricular o signos de isquemia aguda subendocárdica (infradesnivel ST).'
      ],
      biomarkersAndLabs: [
        'Sedimento urinario y proteinuria en tira (micro/macrohematuria, cilindros).',
        'Urea, creatinina plasmática e ionograma (descartar insuficiencia renal aguda).',
        'Troponina y BNP/NT-proBNP si hay dolor torácico o disnea.',
        'TAC de cerebro simple si hay focalidad neurológica o encefalopatía.'
      ],
      differentialDiagnosis: [
        'Hipertensión reactiva a dolor intenso o cuadro de ansiedad.',
        'Feocromocitoma / Crisis por uso de simpaticomiméticos (cocaína).',
        'Preeclampsia severa / Eclampsia en pacientes gestantes o puerperio.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Diferenciar inmediatamente Emergencia de Urgencia: ¿Hay daño agudo de órgano blanco?',
        'Urgencia Hipertensiva (SIN daño de órgano): descenso gradual en 24-48h por vía oral. NO descensos bruscos.',
        'Emergencia Hipertensiva (CON daño de órgano): derivación inmediata con vía periférica permeable y monitoreo estricto.'
      ],
      emergencyRoomShockRoom: [
        'Emergencia: Reducción de la PAM en no más del 20-25% en la primera hora, luego hacia 160/100 mmHg en 2 a 6 horas (salvo en Disección Aórtica donde se busca PAS < 120 mmHg y FC < 60 lpm en < 20 min).',
        'Vía venosa con bomba de infusión continua para titulaciones seguras.',
        'Evitar nifedipina sublingual cápsulas (provoca caídas tensionales incontrolables con riesgo de ACV e IAM).'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Labetalol EV',
          dose: 'Bolo 20 mg EV en 2 min, luego 20-80 mg c/10 min (máx 300 mg) o infusión 0.5-2 mg/min',
          route: 'Intravenosa',
          notes: 'Fármaco de elección en Encefalopatía HTA, ACV isquémico candidato a trombolisis y Disección Aórtica.'
        },
        {
          drug: 'Nitroglicerina EV',
          dose: '5 a 100 mcg/min en infusión continua',
          route: 'Intravenosa en bomba',
          notes: 'Fármaco de elección en Edema Agudo de Pulmón y Síndromes Coronarios Agudos.'
        },
        {
          drug: 'Nitroprusiato de Sodio',
          dose: '0.25 a 10 mcg/kg/min en infusión protegida de la luz',
          route: 'Intravenosa',
          notes: 'Potente vasodilatador arterial/venoso. Riesgo de toxicidad por tiocianato en infusión prolongada.'
        },
        {
          drug: 'Enalaprilato EV o Amlodipina / Losartán VO',
          dose: 'Enalaprilato 1.25 mg EV c/6h // Amlodipina 5-10 mg VO',
          route: 'Intravenosa / Vía oral',
          notes: 'Uso oral en Urgencia Hipertensiva para manejo ambulatorio o internación en sala general.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Emergencia con Disección Aórtica: < 20 minutos para control de PA y FC. Edema de pulmón / ACV: 1 a 2 horas. Urgencia HTA: 24 a 48 horas.',
      goldStandard: 'Titulación intravenosa continua con monitoreo hemodinámico no invasivo o línea arterial en UTI.',
      alternativeReperfusion: 'N/A',
      contraindications: [
        'No administrar betabloqueantes puros en sospecha de feocromocitoma o intoxicación por cocaína sin bloqueo alfa previo (riesgo de vasoespasmo paradójico severo).'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'En emergencia HTA tratada adecuadamente, sobrevida aguda > 98%.',
      survivalAt24h: 'Sobrevida a las 24 horas: > 96% con control de órgano blanco.',
      survivalAt7d: 'Sobrevida a los 7 días: > 92-95%.',
      survivalAt1y: 'Sobrevida al año: 75-85% en emergencias no tratadas o con daño renal/cardíaco previo. En urgencias bien controladas: > 95%.',
      immediateComplications: [
        'Hemorragia intracerebral / Infarto cerebral.',
        'Edema agudo de pulmón cardiogénico y falla ventricular izquierda aguda.',
        'Falla renal aguda oligúrica.'
      ],
      mediateAndLongTermComplications: [
        'Cardiopatía hipertensiva dilatada.',
        'Nefroangioesclerosis e insuficiencia renal crónica terminal.',
        'Deterioro cognitivo vascular.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON CRISIS HIPERTENSIVA. PA: ___/___ mmHg. Evaluación de daño de órgano blanco negativo/positivo. Conducta: Monitoreo continuo de PA y ECG, colocación de acceso periférico. Esquema farmacológico iniciado: __________. Objetivo de reducción: 20-25% de la PAM en la 1° hora.'
  },
  {
    id: 'ica-eap',
    title: 'Insuficiencia Cardíaca Aguda / Edema Agudo de Pulmón (EAP)',
    shortTitle: 'Insuficiencia Cardíaca / EAP',
    category: 'Cardiovascular',
    cie10: 'I50.1 (Falla ventricular izquierda) / I50.9 (Insuficiencia cardíaca no especificada)',
    severity: 'Crítica / Código Rojo',
    summary: 'Aparición rápida o empeoramiento de signos y síntomas de falla cardíaca que conducen a congestión pulmonar o sistémica con compromiso respiratorio inminente.',
    prehospitalManifestations: {
      setting: 'Frecuente en domicilio, muchas veces de madrugada (disnea paroxística nocturna) en pacientes hipertensos, cardiópatas o con sobrecarga de volumen.',
      keySigns: [
        'Disnea asfixiante de inicio súbito, ortopnea severa (el paciente no tolera el decúbito) y taquipnea > 28-30 rpm.',
        'Tos con expectoración espumosa blanquecina o asalmonada/rosácea.',
        'Rales crepitantes húmedos bilaterales audibles a distancia o desde bases hasta campos superiores ("marea montante").',
        'Diaforesis fría profusa, cianosis periférica y livedo reticularis.',
        'Ingurgitación yugular 2/3 o 3/3 con reflujo hepatoyugular y edemas en miembros inferiores.'
      ],
      highSuspicionRedFlags: [
        'Saturación de oxígeno < 85% con signos de agotamiento de la mecánica ventilatoria y uso de músculos accesorios.',
        'Hipotensión arterial (PAS < 90 mmHg) con mala perfusión periférica: shock cardiogénico.',
        'Bradicardia o taquiarritmias extremas asociadas.'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Posición fowler estricta (90°) con miembros inferiores declives para reducir el retorno venoso.',
        'Oximetría de pulso continua y monitor cardíaco.',
        'Medición de presión arterial y auscultación pulmonar en 4 cuadrantes.'
      ],
      electrocardiogram: [
        'Identificar causa desencadenante: arritmias (Fibrilación auricular de alta respuesta ventricular), signos de isquemia aguda o sobrecarga ventricular izquierda.'
      ],
      biomarkersAndLabs: [
        'Péptidos natriuréticos: BNP (> 100 pg/ml) o NT-proBNP (> 300 pg/ml para exclusión; > 450-900 según edad para confirmación).',
        'Troponina ultrasensible (descartar IAM desencadenante).',
        'Gasometría arterial (evaluar hipoxemia severa, acidosis respiratoria/láctica).',
        'Ecografía pulmonar a la cabecera (Point-of-Care Ultrasound - POCUS): líneas B múltiples ("perfil B") y evaluación de contractilidad cardíaca.'
      ],
      differentialDiagnosis: [
        'Crisis asmática severa / EPOC reagudizado (broncoespasmo con sibilancias predominantes).',
        'Neumonía grave bilateral / SDRA.',
        'Tromboembolismo pulmonar.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Posición sentada con piernas colgando.',
        'Ventilación no invasiva (CPAP / BiPAP) precoz si SatO2 < 90% y taquipnea (reduce necesidad de intubación y mortalidad).',
        'Acceso venoso periférico.',
        'Si PAS > 110 mmHg: Nitroglicerina sublingual o infusión continua inmediata.',
        'Furosemida intravenosa en bolo.'
      ],
      emergencyRoomShockRoom: [
        'Optimización de VNI (PEEP 5-10 cmH2O, FiO2 para Sat 92-96%).',
        'Diuréticos de asa EV en bolo rápido (doble de la dosis habitual o 40-80 mg si es virgen de tratamiento).',
        'Vasodilatadores en goteo titulable (Nitroglicerina) en pacientes hipertensos.',
        'Inotrópicos (Dobutamina / Levosimendán) o vasopresores (Noradrenalina) SOLAMENTE si hay shock cardiogénico o hipotensión severa.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Furosemida EV',
          dose: '40 a 80 mg en bolo EV lento (o dosis oral previa x 2 en mg EV)',
          route: 'Intravenosa',
          notes: 'Efecto venodilatador temprano a los 5-15 min, efecto diurético a los 30 min.'
        },
        {
          drug: 'Nitroglicerina',
          dose: '0.4-0.5 mg SL cada 5 min (máx 3) o infusión EV 10-100 mcg/min',
          route: 'Sublingual / EV en bomba',
          notes: 'Fármaco pilar en EAP hiperdinámico/hipertensivo con PAS > 110 mmHg.'
        },
        {
          drug: 'Ventilación No Invasiva (CPAP / BiPAP)',
          dose: 'CPAP 5 a 10 cmH2O con FiO2 titulada',
          route: 'Máscara oronasal hermética',
          notes: 'Disminuye la precarga y postcarga ventricular, recluta alvéolos inundados.'
        },
        {
          drug: 'Morfina EV (opcional en baja dosis)',
          dose: '1 a 2 mg EV',
          route: 'Intravenosa lenta',
          notes: 'Solo para ansiedad severa; usar con extrema cautela por depresión respiratoria.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Primeros 30-60 minutos críticos para alivio de la congestión alveolar y normalización del intercambio gaseoso.',
      goldStandard: 'Combinación temprana de VNI + Vasodilatadores + Diuréticos de asa EV.',
      alternativeReperfusion: 'N/A (Cateterismo de urgencia si la causa primaria es IAM).',
      contraindications: [
        'Contraindicación de nitratos si PAS < 90 mmHg, sospecha de estenosis aórtica severa o miocardiopatía hipertrófica obstructiva.'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Con VNI precoz y vasodilatación, sobrevida aguda > 95%.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~90-93%.',
      survivalAt7d: 'Sobrevida a los 7 días: ~85-90%.',
      survivalAt1y: 'Sobrevida al año: 70-78% tras una primera internación por falla cardíaca aguda.',
      immediateComplications: [
        'Paro cardiorrespiratorio por hipoxemia severa y acidosis.',
        'Shock cardiogénico.',
        'Arritmias ventriculares letales.'
      ],
      mediateAndLongTermComplications: [
        'Síndrome cardiorrenal agudo tipo 1 con deterioro de función renal.',
        'Reingreso hospitalario frecuente (tasa de readmisión > 20% a 30 días).',
        'Falla multiorgánica por hipoperfusión tisular prolongada.'
      ]
    },
    actionCopyTemplate: 'PACIENTE EN EDEMA AGUDO DE PULMÓN (EAP). Posición sentada a 90°. Signos vitales: PA ___/___ mmHg, SatO2 ___%, FR ___ rpm. Se inicia VNI (CPAP) + Oxígeno suplementario. Dosis administradas: Nitroglicerina SL/EV + Furosemida ___ mg EV en bolo. Monitoreo clínico de respuesta diurética y ventilatoria.'
  },
  {
    id: 'acv-isquemico',
    title: 'Ataque Cerebrovascular Isquémico Agudo (ACV / Ictus)',
    shortTitle: 'ACV Isquémico Agudo',
    category: 'Neurológico',
    cie10: 'I63.0 - I63.9 (Infarto cerebral)',
    severity: 'Crítica / Código Rojo',
    summary: 'Déficit neurológico focal súbito por oclusión arterial encefálica. Emergencia tiempo-dependiente máxima (Ventana para trombolisis EV ≤ 4.5 horas, trombectomía mecánica ≤ 6-24 horas).',
    prehospitalManifestations: {
      setting: 'Aparición brusca en cualquier entorno. La hora exacta de "última vez visto sano" es el dato crítico prehospitalario.',
      keySigns: [
        'Asimetría facial súbita (caída de la comisura labial, borramiento del surco nasogeniano al sonreír).',
        'Pérdida de fuerza o parálisis en un hemicuerpo (brazo o pierna con caída motora - Escala de Cincinnati).',
        'Trastorno del lenguaje: disartria marcada ("lengua pesada") o afasia (dificultad para hablar o comprender órdenes).',
        'Alteración visual aguda: pérdida visual monocular súbita (amaurosis) o hemianopsia homónima.',
        'Inestabilidad súbita de la marcha, ataxia o vértigo agudo severo con nistagmo.'
      ],
      highSuspicionRedFlags: [
        'Deterioro rápido del nivel de conciencia (estupor, coma - sospecha de oclusión de arteria basilar o ACV hemorrágico extenso).',
        'Crisis convulsiva al inicio del cuadro.',
        'Cefalea explosiva en trueno ("la peor cefalea de la vida" - sospecha de hemorragia subaracnoidea).'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Escala Prehospitalaria de Cincinnati o Escala LAPSS.',
        'Determinación de glucemia capilar inmediata (descartar hipoglucemia simulación).',
        'Establecer con precisión la hora de inicio de los síntomas o última vez visto sano.',
        'Activación de "Código ACV" y preaviso al centro de destino con tomografía disponible 24/7.'
      ],
      electrocardiogram: [
        'ECG de 12 derivaciones para detección de Fibrilación Auricular no conocida como fuente cardioembólica.'
      ],
      biomarkersAndLabs: [
        'TAC de cerebro simple SIN contraste inmediata (Door-to-CT < 20 min): descartar hemorragia intracraneal y evaluar signos tempranos de isquemia (Score ASPECTS).',
        'Angio-TAC de vasos de cuello e intracraneales para evaluar oclusión de gran vaso (LVO).',
        'Laboratorio: Glucemia, coagulograma (RIN, TP, KPTT), hemograma y plaquetas.'
      ],
      differentialDiagnosis: [
        'Hipoglucemia severa (glucemia < 50 mg/dl).',
        'Parálisis postictal de Todd (tras convulsión focal no presenciada).',
        'Migraña con aura hemipléjica.',
        'Crisis de conversión o trastorno funcional neurológico.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Posición de la cabecera en plano horizontal o 15-30° si hay vómitos o sospecha de hipertensión endocraneana.',
        'Oxígeno suplementario solo si SatO2 < 94%.',
        'Vía venosa periférica con solución fisiológica (NUNCA soluciones glucosadas salvo hipoglucemia comprobada).',
        'Manejo de PA: NO descender la PA en el prehospitalario salvo que PAS > 220 mmHg o PAD > 120 mmHg (la HTA es un mecanismo de autorregulación para perfundir la penumbra isquémica).',
        'Traslado prioritario con código rojo activo.'
      ],
      emergencyRoomShockRoom: [
        'Ingreso prioritario a Tomógrafo sin escalas.',
        'Evaluación neurológica con Escala NIHSS.',
        'Si es candidato a Trombolisis con r-tPA: PA debe ser < 185/110 mmHg antes de iniciar infusión (utilizar Labetalol EV).',
        'Si hay oclusión de gran vaso (LVO: carótida interna, M1, basilar) en ventana < 24h: evaluar Trombectomía Mecánica endovascular.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Alteplasa (r-tPA) o Tenecteplasa (TNK)',
          dose: 'Alteplasa 0.9 mg/kg (máx 90 mg): 10% en bolo en 1 min y el 90% restante en 60 min // Tenecteplasa 0.25 mg/kg bolo único',
          route: 'Intravenosa',
          notes: 'Administrar dentro de las primeras 4.5 horas tras descartar hemorragia en TAC y contraindicaciones.'
        },
        {
          drug: 'Labetalol EV',
          dose: '10-20 mg en bolo EV en 1-2 min, repetir si es necesario',
          route: 'Intravenosa',
          notes: 'Para mantener PA < 185/110 mmHg previo a trombolisis y < 180/105 mmHg durante y post-trombolisis.'
        },
        {
          drug: 'Ácido Acetilsalicílico (AAS)',
          dose: '160 a 300 mg VO / SNG',
          route: 'Vía oral / Sonda nasogástrica',
          notes: 'Administrar dentro de las 24-48h, pero diferir 24h si el paciente recibió trombolisis.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Tiempo es cerebro: cada minuto se pierden 1.9 millones de neuronas. Ventana trombolisis intravenosa: hasta 4.5 horas. Ventana trombectomía mecánica: hasta 6 horas (o hasta 24 horas seleccionados por mismatch en neuroimagen avanzada).',
      goldStandard: 'Trombolisis intravenosa combinada con trombectomía mecánica en oclusión de gran vaso.',
      alternativeReperfusion: 'Trombectomía mecánica directa si hay contraindicación para trombolíticos.',
      contraindications: [
        'Contraindicaciones de r-tPA: hemorragia activa, plaquetas < 100.000, anticoagulación con RIN > 1.7 o DOACs < 48h, traumatismo craneal o cirugía mayor < 3 meses.'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Sobrevida aguda > 97% en centros con Unidad de ACV.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~94-96%. Riesgo de transformación hemorrágica sintomática post-trombolisis ~3-5%.',
      survivalAt7d: 'Sobrevida a los 7 días: ~88-92%.',
      survivalAt1y: 'Sobrevida al año: 75-82%. La trombectomía/trombolisis oportuna reduce la discapacidad severa en más del 40-50% (independencia funcional mRS 0-2).',
      immediateComplications: [
        'Transformación hemorrágica del infarto.',
        'Edema cerebral maligno con herniación uncal/subfalcial (infartos masivos de ACM).',
        'Neumonía aspirativa por disfagia neurogénica.'
      ],
      mediateAndLongTermComplications: [
        'Espasticidad, dolor central post-ACV y hemiparesia residual.',
        'Depresión post-ACV y deterioro cognitivo vascular.',
        'Trombosis venosa profunda y embolia pulmonar por inmovilidad.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON SOSPECHA DE ACV ISQUÉMICO AGUDO. Escala de Cincinnati POSITIVA. Hora de última vez visto sano: ___:___ hs. Glucemia capilar descartada: ___ mg/dl. Se activa CÓDIGO ACV y traslado directo a centro con TAC y capacidad de trombolisis/trombectomía dentro de ventana terapéutica.'
  },
  {
    id: 'anafilaxia',
    title: 'Anafilaxia Severa y Shock Anafiláctico',
    shortTitle: 'Anafilaxia / Shock Alérgico',
    category: 'Inmunológico / Alergia',
    cie10: 'T78.2 (Shock anafiláctico no especificado) / T88.6',
    severity: 'Crítica / Código Rojo',
    summary: 'Reacción sistémica de hipersensibilidad inmediata mediada por IgE que compromete la vía aérea, respiración o circulación. La Adrenalina IM temprana es el tratamiento salvador indiscutible.',
    prehospitalManifestations: {
      setting: 'Exposición reciente (minutos a pocas horas) a fármacos (antibióticos, AINEs), alimentos (frutos secos, mariscos), picaduras de himenópteros (abejas/avispas) o látex.',
      keySigns: [
        'Manifestaciones cutáneo-mucosas generalizadas: urticaria pruriginosa extensa, eritema difuso, prurito palmoplantar o periocular.',
        'Angioedema de labios, lengua, úvula, párpados o edema laríngeo con sensación de opresión faríngea.',
        'Compromiso respiratorio: disnea, estridor laríngeo inspiratorio, disfonía/voz gangosa, tos seca y sibilancias espiratorias.',
        'Compromiso cardiovascular: hipotensión arterial brusca (síncope, colapso), taquicardia refleja y palidez/diaforesis.',
        'Síntomas gastrointestinales agudos asociados: dolor cólico abdominal intenso, náuseas, vómitos repetidos o diarrea súbita.'
      ],
      highSuspicionRedFlags: [
        'Estridor laríngeo o disfonía progresiva rápida (cierre inminente de la vía aérea glótica).',
        'Hipotensión arterial refractaria con pérdida de conciencia (shock anafiláctico distributivo severo).',
        'Reacción anafiláctica bifásica (reaparición de síntomas 1 a 72 horas después de la resolución inicial).'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Retirar de inmediato el alérgeno causante (detener infusión EV, retirar aguijón con raspado sin apretar).',
        'Evaluación ABCDE inmediata. Evaluar permeabilidad de vía aérea y buscar estridor.',
        'Colocar al paciente en decúbito supino con miembros inferiores elevados (Posición de Trendelenburg o Shock). ¡NUNCA poner de pie ni sentar bruscamente a un paciente en shock anafiláctico por riesgo de síndrome de ventrículo vacío y paro cardíaco fulminante!',
        'Si hay dificultad respiratoria o vómitos: posición semisentada o decúbito lateral de seguridad si está inconsciente.'
      ],
      electrocardiogram: [
        'Taquicardia sinusal refleja, arritmias auriculares o ventriculares por liberación masiva de histamina y mediadores mastocitarios (Síndrome de Kounis: vasoespasmo coronario / IAM alérgico).'
      ],
      biomarkersAndLabs: [
        'Triptasa sérica mastocitaria (tomar muestra a las 1-2h del inicio para confirmación diagnóstica retrospectiva).',
        'Gasometría arterial y lactato si hay shock establecido.'
      ],
      differentialDiagnosis: [
        'Crisis asmática severa aislada.',
        'Síncope vasovagal (bradicardia, palidez, ausencia de urticaria o angioedema).',
        'Obstrucción de vía aérea por cuerpo extraño (OVACE).',
        'Angioedema hereditario o inducido por IECA (sin urticaria ni prurito; no responde a adrenalina habitual).'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'ADRENALINA INTRAMUSCULAR (1:1000 = 1 mg/ml) INMEDIATA en la cara anterolateral del tercio medio del muslo (vasto lateral). NO demorar por buscar accesos venosos.',
        'Oxigenoterapia con máscara con reservorio a alto flujo (10-15 L/min).',
        'Colocar 2 accesos venosos periféricos de gran calibre (14G o 16G).',
        'Reposición hídrica agresiva con cristaloides isotónicos (SF o Ringer Lactato) en bolos rápidos si hay hipotensión.',
        'Repetir Adrenalina IM cada 5 a 15 minutos si no hay mejoría clínica.'
      ],
      emergencyRoomShockRoom: [
        'Shock Room: preparación inmediata para vía aérea difícil (videolaringoscopio / set de cricotiroidotomía de urgencia).',
        'Si el shock persiste tras 2-3 dosis de Adrenalina IM: iniciar infusión intravenosa continua de Adrenalina con bomba (0.05 a 0.5 mcg/kg/min).',
        'Fármacos de segunda línea (corticoides y antihistamínicos): previenen rebote bifásico pero NO sustituyen la adrenalina.',
        'En pacientes tratados con betabloqueantes que no responden a adrenalina: administrar Glucagón EV.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Adrenalina (Epinefrina) 1:1000 (1 mg/ml)',
          dose: '0.5 mg IM en adultos (0.01 mg/kg en niños, máx 0.3-0.5 mg)',
          route: 'Intramuscular profunda (muslo anterolateral)',
          notes: 'Primera línea absoluta. Repetir cada 5 a 15 min según respuesta clínica.'
        },
        {
          drug: 'Cristaloides isotónicos (Solución Fisiológica / Ringer Lactato)',
          dose: '1000 a 2000 ml en infusión rápida (20 ml/kg en bolos)',
          route: 'Intravenosa a flujo libre',
          notes: 'Para compensar la vasodilatación masiva y fuga capilar al tercer espacio.'
        },
        {
          drug: 'Hidrocortisona o Metilprednisolona EV',
          dose: 'Hidrocortisona 200-500 mg EV // Metilprednisolona 1-2 mg/kg EV',
          route: 'Intravenosa lenta',
          notes: 'Segunda línea: efecto antiinflamatorio tardío (a partir de las 4-6h), previene reacciones bifásicas.'
        },
        {
          drug: 'Difenhidramina (Antihistamínico H1) + Ranitidina/Famotidina (H2)',
          dose: 'Difenhidramina 25-50 mg EV lento + Famotidina 20 mg EV',
          route: 'Intravenosa',
          notes: 'Segunda línea sintomática para prurito y urticaria.'
        },
        {
          drug: 'Glucagón EV (en usuarios de Betabloqueantes)',
          dose: '1 a 5 mg EV en bolo en 5 min, luego infusión 5-15 mcg/min',
          route: 'Intravenosa',
          notes: 'Activa la adenilato ciclasa independientemente de los receptores beta-adrenérgicos bloqueados.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Tiempo es vida: la muerte por colapso respiratorio o circulatorio en anafilaxia ocurre habitualmente en los primeros 5 a 30 minutos tras la exposición. La adrenalina debe inyectarse en los primeros 5 minutos.',
      goldStandard: 'Adrenalina IM inmediata en vasto lateral + resucitación con cristaloides.',
      alternativeReperfusion: 'Infusión continua de Adrenalina EV / Noradrenalina en shock refractario.',
      contraindications: [
        '¡NO EXISTE NINGUNA CONTRAINDICACIÓN ABSOLUTA para el uso de Adrenalina IM en una situación de anafilaxia con riesgo vital!'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Con administración precoz de Adrenalina IM en los primeros 10 min: sobrevida > 98-99%.',
      survivalAt24h: 'Sobrevida a las 24 horas: > 97%. La observación obligatoria mínima es de 6 a 8 horas (y hasta 24h si requirió múltiples dosis) por riesgo de reacción bifásica (5-20%).',
      survivalAt7d: 'Sobrevida a los 7 días: > 96%.',
      survivalAt1y: 'Sobrevida al año excelente con prescripción de autoinyector de adrenalina y seguimiento por Alergología.',
      immediateComplications: [
        'Asfixia por edema laríngeo / angioedema masivo.',
        'Shock distributivo irreversible y paro cardiorrespiratorio en AESP.',
        'Isquemia miocárdica aguda alérgica (Síndrome de Kounis).'
      ],
      mediateAndLongTermComplications: [
        'Reacción anafiláctica bifásica tardía.',
        'Encefalopatía anóxica por hipoxia prolongada.',
        'Riesgo de recurrencia fatal ante nueva exposición accidental.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON ANAFILAXIA SEVERA / SHOCK ANAFILÁCTICO. Alérgeno sospechoso: __________. Posición decúbito supino con miembros elevados. Conducta inmediata: ADRENALINA 1:1000 0.5 mg IM en muslo anterolateral aplicada a las ___:___ hs. Expansión rápida con 1000 ml SF EV + Oxígeno a alto flujo. Fármacos coadyuvantes: Hidrocortisona ___ mg EV + Difenhidramina ___ mg EV.'
  },
  {
    id: 'crisis-asmatica',
    title: 'Crisis Asmática Severa y EPOC Reagudizado Grave',
    shortTitle: 'Crisis Asmática / EPOC Severo',
    category: 'Respiratorio',
    cie10: 'J45.9 (Asma no especificada) / J46 (Estado asmático) / J44.1 (EPOC con exacerbación aguda)',
    severity: 'Crítica / Código Rojo',
    summary: 'Broncoespasmo agudo severo con atrapamiento aéreo, aumento del trabajo respiratorio y riesgo inminente de fallo ventilatorio hipercápnico / paro respiratorio.',
    prehospitalManifestations: {
      setting: 'Domicilio o vía pública tras exposición a desencadenantes (infección respiratoria viral/bacteriana, alérgenos, suspensión de corticoides inhalados, frío extremo o contaminación).',
      keySigns: [
        'Disnea intensa en reposo con imposibilidad de pronunciar frases completas (habla entrecortada palabra por palabra).',
        'Taquipnea severa (FR > 30 rpm) y uso marcado de musculatura accesoria (tiraje supraclavicular, intercostal y aleteo nasal).',
        'Sibilancias espiratorias e inspiratorias audibles a distancia o "tórax silente" por broncoconstricción extrema sin flujo de aire.',
        'Postura en trípode (inclinado hacia adelante apoyando brazos en rodillas) y taquicardia > 120 lpm.',
        'Pulso paradójico (caída de la PAS > 12-20 mmHg durante la inspiración).'
      ],
      highSuspicionRedFlags: [
        'Tórax silente / abolición del murmullo vesicular (signo de pre-paro respiratorio por colapso del flujo aéreo).',
        'Bradicardia, cianosis central o bradipnea agónica.',
        'Deterioro del sensorio, somnolencia, confusión o agitación extrema (encefalopatía hipercápnica e hipoxia crítica).'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Oximetría de pulso continua y monitorización cardiorrespiratoria.',
        'Medición de Flujo Espiratorio Pico (PEF) si el estado del paciente lo permite: PEF < 50% del valor teórico indica crisis severa; < 33% riesgo vital inminente.',
        'Auscultación pulmonar bilateral comparativa (descartar neumotórax espontáneo asociado).'
      ],
      electrocardiogram: [
        'Taquicardia sinusal, signos de sobrecarga ventricular derecha aguda (P pulmonale, patrón S1Q3T3 transitorio) o arritmias por hiperadrenergia o hipopotasemia.'
      ],
      biomarkersAndLabs: [
        'Gasometría arterial: en crisis inicial suele haber alcalosis respiratoria con hipocapnia (PaCO2 < 35 mmHg); una PaCO2 "normal" (40 mmHg) o elevada (> 45 mmHg) en un paciente taquipneico es signo de fatiga muscular inminente y gravedad extrema.',
        'Radiografía de tórax portátil: descartar neumotórax, neumomediastino, atelectasias o consolidaciones infecciosas.',
        'Laboratorio: Ionograma (riesgo de hipopotasemia severa secundaria a dosis repetidas de beta-2 agonistas).'
      ],
      differentialDiagnosis: [
        'Edema agudo de pulmón cardiogénico ("asma cardíaca").',
        'Obstrucción de vía aérea superior / Edema de glotis o cuerpo extraño.',
        'Tromboembolismo pulmonar.',
        'Neumotórax a tensión espontáneo.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Posición sentada erguida.',
        'Oxigenoterapia controlada: titular para SatO2 93-95% en Asma; SatO2 88-92% en pacientes con EPOC retenedores crónicos de CO2.',
        'Broncodilatadores inhalados a dosis altas: Salbutamol + Bromuro de Ipratropio mediante nebulizador con O2 a 6-8 L/min o MDI con aerocámara (4 a 8 disparos cada 15-20 min).',
        'Corticoides sistémicos tempranos por vía EV o VO.',
        'Vía venosa permeable.'
      ],
      emergencyRoomShockRoom: [
        'Nebulizaciones continuas o seriadas con Salbutamol + Ipratropio.',
        'Sulfato de Magnesio EV en infusión de 20 min en crisis severas refractarias.',
        'Ventilación No Invasiva (VNI - BiPAP): de primera línea en EPOC reagudizado hipercápnico con acidosis respiratoria (pH < 7.35, PaCO2 > 45 mmHg); reduce intubación y mortalidad en un 60%.',
        'Si paro inminente o agotamiento extremo: Secuencia de Intubación Rápida con tubo orotraqueal de gran calibre (≥ 8 mm para reducir resistencia) y ventilación protectora con tiempo espiratorio prolongado (I:E 1:3 o 1:4) para evitar auto-PEEP y barotrauma.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Salbutamol (Albuterol) solución para nebulizar o aerosol MDI',
          dose: 'Nebulización: 2.5 a 5 mg (0.5 a 1 ml) diluido en 3 ml SF c/20 min o continuo // MDI: 4-8 puffs c/15-20 min',
          route: 'Inhalatoria / Nebulizada',
          notes: 'Beta-2 agonista de acción rápida. Primera línea de broncodilatación.'
        },
        {
          drug: 'Bromuro de Ipratropio',
          dose: '0.5 mg (1 ampolla o 20 gotas) nebulizado cada 20 min x 3 dosis junto con Salbutamol',
          route: 'Inhalatoria',
          notes: 'Anticolinérgico antimuscarínico que potencia la broncodilatación y reduce secreciones.'
        },
        {
          drug: 'Hidrocortisona o Metilprednisolona EV / Meprednisona VO',
          dose: 'Hidrocortisona 200 mg EV o Metilprednisolona 40-80 mg EV // Meprednisona 40-60 mg VO',
          route: 'Intravenosa / Vía oral',
          notes: 'Iniciar de inmediato; disminuye el edema de la mucosa bronquial y previene recaídas.'
        },
        {
          drug: 'Sulfato de Magnesio EV',
          dose: '2 g EV diluidos en 100 ml Solución Fisiológica a pasar en 20 minutos',
          route: 'Intravenosa en goteo',
          notes: 'Produce relajación del músculo liso bronquial al bloquear los canales de calcio; indicado en asma severa que no responde a la primera hora.'
        },
        {
          drug: 'Adrenalina SC / IM (en asma con colapso inminente)',
          dose: '0.3 a 0.5 mg (1:1000) IM / SC',
          route: 'Intramuscular / Subcutánea',
          notes: 'Rescate extremo en broncoespasmo fulminante con mala entrada de aire para aerosoles.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Primeros 60 minutos ("Hora de oro respiratoria") para revertir la obstrucción bronquial severa antes de la fatiga diafragmática y la acidosis láctica-respiratoria.',
      goldStandard: 'Broncodilatadores duales inhalados a altas dosis + Corticoides sistémicos precoces + VNI en EPOC.',
      alternativeReperfusion: 'N/A (Intubación orotraqueal con ventilación mecánica protectora si falla VNI o hay coma hipercápnico).',
      contraindications: [
        'Contraindicado el uso de sedantes o ansiolíticos comunes sin control de vía aérea (deprimen el centro respiratorio y precipitan el paro).'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Con tratamiento broncodilatador agresivo y corticoides precoces, sobrevida aguda > 98%.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~96-98% en UCI/Shock Room.',
      survivalAt7d: 'Sobrevida a los 7 días: > 94-96%. Requiere esquema descendente de corticoides orales por 5-7 días.',
      survivalAt1y: 'Sobrevida al año dependiente de adherencia a corticoides inhalados y control ambiental; en EPOC avanzado dependiente de oxígeno la mortalidad anual es de 10-15%.',
      immediateComplications: [
        'Paro respiratorio por agotamiento muscular y acidosis hipercápnica severa.',
        'Neumotórax a tensión por rotura de bullas hiperinsufladas (barotrauma/volutrauma).',
        'Arritmias cardíacas inducidas por hipoxemia severa o exceso de beta-agonistas.'
      ],
      mediateAndLongTermComplications: [
        'Reingreso frecuente por crisis no controlada.',
        'Efectos adversos de corticoides sistémicos recurrentes (miopatía, hiperglucemia, osteoporosis).',
        'Deterioro progresivo irreversible de la función pulmonar (remodelado de vía aérea).'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON CRISIS ASMÁTICA SEVERA / EPOC REAGUDIZADO. Signos vitales: SatO2 ___%, FR ___ rpm, FC ___ lpm. Uso de músculos accesorios (+). Conducta: Oxigenoterapia titulada + Nebulización combinada con Salbutamol (___ mg) + Bromuro de Ipratropio (___ mg). Dosis de corticoide administrada: Hidrocortisona ___ mg EV. Sulfato de magnesio 2g EV [indicado/no indicado].'
  },
  {
    id: 'sepsis-shock',
    title: 'Sepsis Grave y Shock Séptico (Código Sepsis / Hora de Oro)',
    shortTitle: 'Sepsis / Shock Séptico',
    category: 'Infeccioso / Shock',
    cie10: 'A41.9 (Sepsis no especificada) / R65.21 (Shock séptico)',
    severity: 'Crítica / Código Rojo',
    summary: 'Disfunción orgánica potencialmente mortal causada por una respuesta desregulada del huésped a la infección. El Shock Séptico añade anomalías circulatorias y celulares graves con alta mortalidad.',
    prehospitalManifestations: {
      setting: 'Domicilio, residencias de ancianos, vía pública o internación. Frecuente foco respiratorio (neumonía), urinario (pielonefritis), abdominal (peritonitis) o partes blandas.',
      keySigns: [
        'Alteración aguda del estado mental (confusión, somnolencia, desorientación o letargia - Escala Glasgow < 15).',
        'Taquipnea marcada con FR ≥ 22 rpm y trabajo respiratorio.',
        'Hipotensión arterial sistólica con PAS ≤ 100 mmHg o PAM < 65 mmHg.',
        'Fiebre alta (> 38.3°C) o hipotermia paradójica (< 36°C - signo de extrema gravedad en ancianos).',
        'Signos de mala perfusión tisular: piel moteada (mottling score), relleno capilar enlentecido (> 3 segundos), oliguria y extremidades frías.'
      ],
      highSuspicionRedFlags: [
        'Score qSOFA ≥ 2 (FR ≥ 22, Alteración mental Glasgow < 15, PAS ≤ 100): alta sospecha de sepsis con riesgo de muerte hospitalaria.',
        'Hipotensión arterial que no responde a la carga inicial de volumen con requerimiento de vasopresores (Shock Séptico).',
        'Hiperlactatemia sérica > 2 mmol/L (> 18 mg/dl) o > 4 mmol/L (acidosis metabólica severa).'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Detección y activación precoz de CÓDIGO SEPSIS mediante herramientas de screening (qSOFA / NEWS2).',
        'Evaluación de signos vitales completos, saturometría y temperatura central.',
        'Búsqueda activa del foco infeccioso (respiratorio, urinario, abdominal, neurológico, catéteres vasculares o heridas quirúrgicas).'
      ],
      electrocardiogram: [
        'Taquicardia sinusal refleja, arritmias auriculares de novo (Fibrilación Auricular frecuente) o cambios isquémicos por aumento del consumo miocárdico de O2.'
      ],
      biomarkersAndLabs: [
        'Lactato sérico en sangre venosa o arterial (marcador crítico de hipoperfusión celular).',
        'Hemocultivos seriados (al menos 2 tomas de sitios periféricos distintos) ANTES de iniciar antibióticos (sin retrasar la dosis > 45 min).',
        'Laboratorio completo: Hemograma con fórmula leucocitaria (leucocitosis > 12.000 con desviación a la izquierda > 10% en banda o leucopenia < 4.000), coagulograma (plaquetopenia < 100.000, RIN > 1.5), función renal y hepática (bilirrubina total).',
        'Procalcitonina y Proteína C Reactiva (PCR) cuantitativa.'
      ],
      differentialDiagnosis: [
        'Shock cardiogénico (congestión pulmonar, ingurgitación yugular).',
        'Shock hipovolémico no séptico (deshidratación severa o hemorragia oculta).',
        'Shock anafiláctico.',
        'Insuficiencia suprarrenal aguda (crisis addisoniana).'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Reconocimiento rápido mediante qSOFA positivo.',
        'Oxigenoterapia para mantener SatO2 ≥ 94%.',
        'Colocación precoz de 2 accesos venosos periféricos de grueso calibre (16G o 18G).',
        'Iniciar resucitación hídrica con cristaloides isotónicos a 30 ml/kg en infusión continua.',
        'Preaviso hospitalario de Código Sepsis.'
      ],
      emergencyRoomShockRoom: [
        'BUNDLE DE LA HORA DE ORO (Surviving Sepsis Campaign):',
        '1. Medir lactato sérico (repetir a las 2-4h si inicialmente > 2 mmol/L).',
        '2. Obtener hemocultivos previos al antibiótico.',
        '3. Administrar antibióticos de amplio espectro EV dentro de la 1° hora del reconocimiento.',
        '4. Iniciar infusión rápida de cristaloides 30 ml/kg para hipotensión o lactato ≥ 4 mmol/L.',
        '5. Iniciar Vasopresores (Noradrenalina de 1° elección) si el paciente persiste hipotenso durante o tras la resucitación con fluidos para mantener PAM ≥ 65 mmHg.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Cristaloides balanceados o Solución Fisiológica 0.9%',
          dose: '30 ml/kg de peso ideal en bolo en las primeras 3 horas',
          route: 'Intravenosa a flujo rápido',
          notes: 'Evaluar respuesta clínica y sobrecarga de volumen mediante elevación pasiva de piernas o ecografía de vena cava.'
        },
        {
          drug: 'Noradrenalina (Norepinefrina)',
          dose: '0.05 a 0.5 mcg/kg/min (titulable c/2-5 min hasta PAM ≥ 65 mmHg)',
          route: 'Intravenosa en bomba de infusión continua (preferente acceso central o periférico transitorio seguro)',
          notes: 'Vasopresor de primera línea. Iniciar precozmente si la PAS es muy baja sin esperar a terminar toda la carga hídrica.'
        },
        {
          drug: 'Ceftriaxona + Vancomicina o Piperacilina/Tazobactam (según foco sospechado)',
          dose: 'Ceftriaxona 2 g EV bolo // Pip/Tazo 4.5 g EV // Vancomicina 25-30 mg/kg carga',
          route: 'Intravenosa en bolo / infusión rápida',
          notes: 'Administrar dentro de la primera hora. Cada hora de retraso en el antibiótico incrementa la mortalidad en un 7-8%.'
        },
        {
          drug: 'Hidrocortisona EV (en shock refractario)',
          dose: '200 mg/día en infusión continua o 50 mg EV cada 6 horas',
          route: 'Intravenosa',
          notes: 'Indicada solo si el shock séptico persiste refractario a pesar de adecuada reposición de volumen y dosis altas de vasopresores.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'La "Hora de Oro": el inicio de antibióticos empíricos adecuados y la resucitación hemodinámica en los primeros 60 minutos es el determinante pronóstico más poderoso de supervivencia.',
      goldStandard: 'Resucitación hídrica guiada por objetivos + Antibioticoterapia precoz dirigida + Noradrenalina para PAM ≥ 65 mmHg + Control quirúrgico/drenaje del foco séptico en < 6-12 horas.',
      alternativeReperfusion: 'Adición de Vasopresina (0.03 UI/min) o Adrenalina si dosis de Noradrenalina son elevadas.',
      contraindications: [
        'Evitar el uso de almidones hidroxietílicos (aumentan mortalidad y necesidad de terapia de reemplazo renal).'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Con bundle de resucitación completado en la 1° hora: sobrevida aguda > 88-92%.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~80-85%. En shock séptico establecido la mortalidad a 24-48h asciende al 30-40%.',
      survivalAt7d: 'Sobrevida a los 7 días: ~70-75% dependiendo de la edad y comorbilidades (Score SOFA).',
      survivalAt1y: 'Sobrevida al año: 55-65%. El síndrome post-sepsis genera debilidad neuromuscular severa y alta tasa de reinternación.',
      immediateComplications: [
        'Falla multiorgánica aguda (SDRA, falla renal aguda que requiere hemodiálisis, disfunción miocárdica séptica).',
        'Coagulación Intravascular Diseminada (CID) con diátesis hemorrágica y trombosis microvascular.',
        'Paro cardíaco en asistolia o AESP por acidosis láctica extrema.'
      ],
      mediateAndLongTermComplications: [
        'Insuficiencia renal crónica terminal dependiente de diálisis.',
        'Encefalopatía séptica residual y deterioro cognitivo permanente.',
        'Inmunosupresión persistente post-séptica y susceptibilidad a infecciones oportunistas.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON SOSPECHA DE SEPSIS / SHOCK SÉPTICO. Score qSOFA: __/3 (FR: __, Glasgow: __, PAS: __). Foco infeccioso sospechado: __________. Hemocultivos x2 extraídos. Antibiótico administrado dentro de la 1° hora: __________. Resucitación con cristaloides iniciada a 30 ml/kg. Lactato inicial: ___ mmol/L. Noradrenalina [iniciada/no requerida] para PAM ≥ 65 mmHg.'
  },
  {
    id: 'politrauma-shock',
    title: 'Politrauma Grave y Shock Hipovolémico Hemorrágico (Protocolo XABCDE)',
    shortTitle: 'Politrauma / Shock Hemorrágico',
    category: 'Trauma',
    cie10: 'T07 (Traumatismo múltiple no especificado) / R57.1 (Shock hipovolémico)',
    severity: 'Crítica / Código Rojo',
    summary: 'Lesiones traumáticas múltiples con riesgo vital inminente. Prioridad absoluta en el control de la hemorragia exanguinante externa (X), resucitación con control de daños y protocolo de transfusión masiva.',
    prehospitalManifestations: {
      setting: 'Accidente de tránsito de alta energía, caída de altura (> 3 metros), herida por arma de fuego/blanca, atrapamiento o explosión.',
      keySigns: [
        'Hemorragia externa masiva visible a chorro o pulsátil en extremidades o zonas de unión (axilas/ingles).',
        'Shock hipovolémico evidente: palidez extrema, sudoración fría, piel marmórea y relleno capilar > 3 segundos.',
        'Hipotensión arterial marcada (PAS < 90 mmHg) y taquicardia severa (> 110-120 lpm).',
        'Taquipnea superficial (> 25-30 rpm) y alteración del estado de conciencia por hipoperfusión cerebral.',
        'Deformidad evidente en múltiples miembros, inestabilidad pélvica o abdomen doloroso en tabla distendido.'
      ],
      highSuspicionRedFlags: [
        'Tríada letal del trauma: Hipotermia (< 35°C), Acidosis metabólica (pH < 7.2) y Coagulopatía traumática inducida.',
        'Hipotensión persistente a pesar de hemostasia externa (sospecha de hemorragia interna en tórax, abdomen, pelvis o retroperitoneo).',
        'Índice de Shock (FC / PAS) ≥ 1.0: predictor certero de sangrado masivo y necesidad de transfusión inmediata.'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Evaluación sistemática XABCDE del ATLS / PHTLS:',
        'X (eXsanguinating hemorrhage): Control inmediato de hemorragias exanguinantes externas.',
        'A (Airway): Vía aérea permeable con control estricto de la columna cervical (inmovilización bimanual / collarín rígido).',
        'B (Breathing): Evaluar mecánica ventilatoria y descartar las 3 lesiones torácicas con riesgo de muerte inmediata: Neumotórax a Tensión, Neumotórax Abierto y Tórax Inestable.',
        'C (Circulation): Evaluación del estado de shock, pulsos centrales/periféricos, compresión de pelvis con faja/sábana si hay sospecha de fractura de pelvis.',
        'D (Disability): Evaluación pupilar y Escala de Coma de Glasgow.',
        'E (Exposure): Exposición completa del paciente con prevención estricta de la HIPOTERMIA (mantas térmicas).'
      ],
      electrocardiogram: [
        'Taquicardia sinusal extrema; arritmias por contusión miocárdica traumática.'
      ],
      biomarkersAndLabs: [
        'Ecografía E-FAST (Extended Focused Assessment with Sonography for Trauma): evaluación rápida en < 3 minutos de líquido libre en saco pericárdico, fosa hepatorrenal (Morison), fosa esplenorrenal, fondo de saco pélvico y espacios pleurales (neumotórax/hemotórax).',
        'Laboratorio de trauma: Grupo y factor Rh urgente, gases arteriales y lactato, hemograma, coagulograma, fibrinógeno sérico (si < 1.5-2 g/L indica coagulopatía de consumo) y calcio iónico.',
        'Tromboelastometría / Tromboelastografía (ROTEM/TEG) para guiar reposición de hemoderivados si está disponible.'
      ],
      differentialDiagnosis: [
        'Shock obstructivo por Neumotórax a Tensión o Taponamiento Cardíaco (ingurgitación yugular, ruidos cardíacos apagados).',
        'Shock neurogénico por sección medular espinal alta (hipotensión con BRADICARDIA paradójica y extremidades calientes).',
        'Shock cardiogénico por contusión miocárdica severa.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'X: Aplicación inmediata de TORNIQUETE de extremidades bien colocado (5-7 cm proximal a la herida o en la raíz del miembro) si hay sangrado arterial; empaquetamiento de heridas cavitarias/de unión con gasa hemostática y vendaje compresivo.',
        'A-B: Descompresión torácica inmediata con aguja/catéter 14G en 2° espacio intercostal línea medioclavicular o 5° EIC línea axilar anterior si hay Neumotórax a Tensión.',
        'C: Colocación de faja pélvica a nivel de los trocánteres mayores ante inestabilidad de pelvis.',
        'Resucitación con "Hipotensión permisiva": mantener PAS entre 80-90 mmHg (PAM ~50-60 mmHg) para evitar desalojar coágulos formados ("popping the clot"), SALVO en presencia de Traumatismo Encéfalocraneano asociado donde se requiere PAS ≥ 100-110 mmHg.',
        'Ácido Tranexámico precoz por vía EV.',
        'Traslado en código rojo con preaviso al centro de trauma de nivel 1.'
      ],
      emergencyRoomShockRoom: [
        'Activación del Protocolo de Transfusión Masiva (PTM): relación 1:1:1 (1 unidad de Glóbulos Rojos Concentrados : 1 unidad de Plasma Fresco Congelado : 1 unidad de Plaquetas) o sangre total 0 negativo.',
        'Evitar la sobrecarga de cristaloides transparentes fríos (máx 1000 ml SF; el exceso diluye factores de coagulación e incrementa la acidosis/hipotermia).',
        'Cirugía de Control de Daños (Damage Control Surgery) inmediata si hay hemorragia abdominal no contenida o angioembolización pélvica.',
        'Corrección activa del calcio iónico (Cloruro o Gluconato de Calcio EV tras cada 4 unidades de hemoderivados por quelación de citrato).'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Ácido Tranexámico (TXA)',
          dose: '1 g EV en bolo diluido en 100 ml SF a pasar en 10 minutos, seguido de infusión de 1 g en 8 horas',
          route: 'Intravenosa',
          notes: 'ADMINISTRAR EN LAS PRIMERAS 3 HORAS del trauma (estudio CRASH-2). Si se administra pasadas las 3 horas aumenta la mortalidad.'
        },
        {
          drug: 'Hemoderivados balanceados (GRC + PFC + Plaquetas)',
          dose: 'Protocolo 1:1:1 o Sangre Total Grupo 0 Negativo de emergencia',
          route: 'Intravenosa en calentador / infusor rápido',
          notes: 'Pilar de la resucitación hemostática con control de daños.'
        },
        {
          drug: 'Cloruro o Gluconato de Calcio EV',
          dose: 'Gluconato de Calcio 10% 1 a 2 g EV lento',
          route: 'Intravenosa',
          notes: 'Mantener Calcio iónico > 1.1 mmol/L; crítico para la coagulación y contractilidad miocárdica.'
        },
        {
          drug: 'Fibrinógeno concentrado o Crioprecipitados',
          dose: 'Fibrinógeno 2 a 4 g EV o Crioprecipitados 1 unidad por cada 10 kg',
          route: 'Intravenosa',
          notes: 'Si fibrinógeno sérico < 1.5-2.0 g/L o signos de hipofibrinogenemia en ROTEM.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'La "Golden Hour" del trauma: el control quirúrgico/intervencionista de la hemorragia interna y la hemostasia precoz en los primeros 60 minutos reduce drásticamente la muerte prevenible por exanguinación.',
      goldStandard: 'Control quirúrgico de daños (Damage Control Laparotomy/Thoracotomy) + Protocolo de Transfusión Masiva 1:1:1 + Ácido Tranexámico < 3h.',
      alternativeReperfusion: 'REBOA (Resuscitative Endovascular Balloon Occlusion of the Aorta) como puente temporal de estabilización endovascular en hemorragias infradiafragmáticas catastróficas.',
      contraindications: [
        'Contraindicada la administración masiva de suero salino frío o soluciones hipotónicas (agravan la coagulopatía y la hipotermia).'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'Con control precoz de la hemorragia y TXA en < 3h: sobrevida aguda > 85-90%.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~75-80% en pacientes con shock clase III/IV que reciben resucitación hemostática balanceada.',
      survivalAt7d: 'Sobrevida a los 7 días: ~70-75% (principales causas de muerte tardía: fallo multiorgánico y sepsis por trauma).',
      survivalAt1y: 'Sobrevida al año: 65-72%.',
      immediateComplications: [
        'Exanguinación masiva y paro cardíaco traumático.',
        'Tríada letal de la muerte: acidosis severa, coagulopatía de consumo e hipotermia grave.',
        'Síndrome compartimental abdominal secundario a empaquetamiento y resucitación agresiva.'
      ],
      mediateAndLongTermComplications: [
        'Síndrome de Distrés Respiratorio Agudo (SDRA) y Falla Multiorgánica.',
        'Secuelas físicas graves, amputaciones y síndrome de dolor regional complejo.',
        'Trastorno por estrés postraumático severo y discapacidad funcional.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON POLITRAUMATISMO GRAVE / SHOCK HEMORRÁGICO. Mecanismo de lesión: __________. Evaluación XABCDE completada. Control de hemorragia externa con [Torniquete / Empaquetamiento hemostático]. Inmovilización espinal y pélvica colocadas. PA: ___/___ mmHg, FC: ___ lpm. Ácido Tranexámico 1g EV administrado a las ___:___ hs. Protocolo de Transfusión Masiva activado.'
  },
  {
    id: 'tec-grave',
    title: 'Traumatismo Encéfalocraneano Grave (TEC / Glasgow ≤ 8)',
    shortTitle: 'TEC Grave / Neurotrauma',
    category: 'Trauma',
    cie10: 'S06.9 (Traumatismo intracraneal no especificado)',
    severity: 'Crítica / Código Rojo',
    summary: 'Lesión cerebral traumática aguda con puntuación en la Escala de Coma de Glasgow ≤ 8 puntos. Emergencia neuroquirúrgica que exige protección estricta de la vía aérea y prevención absoluta de lesiones secundarias (hipoxia e hipotensión).',
    prehospitalManifestations: {
      setting: 'Impacto craneal directo de alta energía, caída, colisión vehicular o herida penetrante de cráneo.',
      keySigns: [
        'Deterioro severo del sensorio con Escala de Coma de Glasgow ≤ 8 (no obedece órdenes, respuesta motora anormal o ausente).',
        'Asimetría pupilar (anisocoria > 1 mm) o midriasis unilateral fija arreactiva (signo de herniación uncal inminente).',
        'Respuesta motora patológica: postura de decorticación (flexión anormal) o descerebración (extensión rígida con pronación).',
        'Signos de fractura de base de cráneo: hematoma periorbitario bilateral ("ojos de mapache"), signo de Battle (equimosis retroauricular mastoidea), otorraquia o rinolicuorrea.',
        'Tríada de Cushing (signo tardío de hipertensión endocraneana crítica): Hipertensión arterial sistólica con aumento de la presión diferencial + Bradicardia + Alteración del patrón respiratorio (bradipnea / respiración irregular).'
      ],
      highSuspicionRedFlags: [
        'Anisocoria rápidamente evolutiva con caída de más de 2 puntos en el Glasgow.',
        'Episodios de hipoxia (SatO2 < 90%) o hipotensión (PAS < 100 mmHg): un solo episodio duplica la mortalidad del TEC.',
        'Crisis convulsivas postraumáticas inmediatas o vómitos a chorro repetidos.'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Aseguramiento de la vía aérea con Secuencia de Intubación Rápida (SIR) neuroprotectora y control cervical estricto.',
        'Evaluación pupilar cuantitativa milimétrica y cálculo riguroso del Glasgow desglosado (Ocular, Verbal, Motor).',
        'Evitar la hipoxia: oxigenoterapia para mantener SatO2 ≥ 95%.',
        'Evitar la hipotensión: mantener PAS ≥ 100 mmHg (en pacientes de 50-69 años) o ≥ 110 mmHg (en pacientes de 15-49 o ≥ 70 años).'
      ],
      electrocardiogram: [
        'Bradicardia sinusal, prolongación del intervalo QT u ondas T invertidas gigantes ("ondas T cerebrales" neurogénicas).'
      ],
      biomarkersAndLabs: [
        'TAC de cerebro simple SIN contraste urgente (Door-to-CT < 30 min): identificar hematoma epidural (imagen biconvexa hiperdensa), hematoma subdural (imagen en semiluna cóncava), contusiones parenquimatosas, hemorragia subaracnoidea traumática, desviación de la línea media (> 5 mm es indicación quirúrgica) y colapso de cisternas perimesencefálicas.',
        'Laboratorio: Glucemia (mantener normoglucemia 140-180 mg/dl), ionograma con Sodio plasmático estricto (evitar hiponatremia que empeora el edema cerebral), coagulograma y hemograma.'
      ],
      differentialDiagnosis: [
        'Intoxicación alcohólica o por drogas depresoras del SNC (nunca atribuir el coma al alcohol si hay traumatismo craneal).',
        'ACV hemorrágico espontáneo que produjo una caída secundaria.',
        'Coma hipoglucémico con traumatismo asociado.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'Intubación orotraqueal precoz si Glasgow ≤ 8 para protección de la vía aérea frente a la broncoaspiración.',
        'Prevenir hipoxia e hipotensión: fluidoterapia con Solución Fisiológica 0.9% (PROHIBIDO el uso de soluciones hipotónicas como Ringer Lactato o Dextrosa que aumentan el edema cerebral).',
        'Posición de la cabecera a 30° centrada (evitar rotación de cuello que dificulta el drenaje venoso yugular).',
        'Ventilación con normocapnia (ETCO2 objetivo 35-40 mmHg). La hiperventilación profunda solo se reserva como rescate transitorio de emergencia ante herniación uncal inminente.',
        'Traslado a centro con Servicio de Neurocirugía y Unidad de Cuidados Intensivos.'
      ],
      emergencyRoomShockRoom: [
        'Terapia osmolar de rescate ante signos de herniación cerebral (anisocoria, bradicardia, postura extensora): Solución Salina Hipertónica (SSH 3% o 7.5%) o Manitol 20%.',
        'Evaluación neuroquirúrgica inmediata para craneotomía descompresiva o evacuación de hematoma.',
        'Colocación de catéter de Presión Intracraneal (PIC) en UTI: objetivo PIC < 20-22 mmHg y Presión de Perfusión Cerebral (PPC = PAM - PIC) entre 60 y 70 mmHg.',
        'Profilaxis anticomicial con Levetiracetam o Fenitoína para prevenir crisis tempranas en los primeros 7 días.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Solución Salina Hipertónica 3% (SSH)',
          dose: 'Bolo de 250 a 500 ml EV en 15-20 minutos (o 3-5 ml/kg)',
          route: 'Intravenosa',
          notes: 'Fármaco osmolar de elección: reduce la PIC sin inducir diuresis osmótica ni hipotensión sistémica.'
        },
        {
          drug: 'Manitol 20%',
          dose: '0.5 a 1 g/kg EV en infusión rápida en 15-20 min',
          route: 'Intravenosa',
          notes: 'Alternativa osmolar. CONTRAINDICADO si el paciente presenta hipotensión arterial (PAS < 90 mmHg) o hipovolemia.'
        },
        {
          drug: 'Levetiracetam o Fenitoína EV',
          dose: 'Levetiracetam 1000 a 1500 mg EV bolo (o Fenitoína 18-20 mg/kg en 30 min)',
          route: 'Intravenosa',
          notes: 'Profilaxis de convulsiones postraumáticas precoces en la primera semana.'
        },
        {
          drug: 'Secuencia de Intubación Rápida (Fentanilo + Ketamina/Etomidato + Rocuronio/Succinilcolina)',
          dose: 'Fentanilo 2-3 mcg/kg + Etomidato 0.3 mg/kg (o Ketamina 1.5-2 mg/kg) + Rocuronio 1.2 mg/kg EV',
          route: 'Intravenosa rápida',
          notes: 'Protocolo neuroprotector que minimiza el aumento reflejo de la PIC durante la laringoscopía.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Primeras 2 a 4 horas: la evacuación neuroquirúrgica precoz de un hematoma epidural o subdural agudo antes de la dilatación pupilar bilateral irreversible es el factor determinante de sobrevida funcional.',
      goldStandard: 'Evacuación neuroquirúrgica urgente + Manejo neurointensivo guiado por PIC/PPC + Prevención de lesiones secundarias.',
      alternativeReperfusion: 'Craneotomía descompresiva primaria o secundaria ante hipertensión endocraneana refractaria.',
      contraindications: [
        'Contraindicación formal del uso de corticoides (Metilprednisolona / Dexametasona): el estudio CRASH demostró aumento de la mortalidad en TEC.'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'En pacientes sin hipoxia ni hipotensión previa: sobrevida aguda > 80-85%.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~70-75% tras intervención oportuna.',
      survivalAt7d: 'Sobrevida a los 7 días: ~60-68%.',
      survivalAt1y: 'Sobrevida al año: 50-60%. Aproximadamente un 30-40% de los supervivientes de TEC grave logran una recuperación funcional favorable (GOS 4-5).',
      immediateComplications: [
        'Herniación cerebral transtentorial / uncal y paro cardiorrespiratorio por enclavamiento.',
        'Edema cerebral difuso masivo e isquemia cerebral secundaria.',
        'Neumonía aspirativa y lesión pulmonar aguda neurogénica.'
      ],
      mediateAndLongTermComplications: [
        'Epilepsia postraumática crónica.',
        'Déficit cognitivo, cambios severos de conducta y personalidad.',
        'Hidrocefalia postraumática y síndrome de fatiga crónica o discapacidad motora.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON TRAUMATISMO ENCÉFALOCRANEANO GRAVE (TEC). Escala de Glasgow inicial: __/15 (O: __, V: __, M: __). Pupilas: [Isocóricas reactivas / Anisocoria / Midriasis bilateral]. Vía aérea asegurada con tubo orotraqueal a las ___:___ hs. Signos vitales protegidos: PAS ___ mmHg, SatO2 ___%. Solución hipertónica 3% [administrada / no requerida]. Traslado urgente a centro con Neurocirugía y TAC.'
  },
  {
    id: 'status-epileptico',
    title: 'Status Epiléptico y Crisis Convulsivas Prolongadas',
    shortTitle: 'Status Epiléptico',
    category: 'Neurológico',
    cie10: 'G41.0 - G41.9 (Estado de mal epiléptico)',
    severity: 'Crítica / Código Rojo',
    summary: 'Crisis convulsiva continua con duración ≥ 5 minutos o ≥ 2 crisis repetidas sin recuperación completa de la conciencia intercrisis. Emergencia neurológica tiempo-dependiente que causa daño neuronal excitotóxico irreversible.',
    prehospitalManifestations: {
      setting: 'Domicilio, vía pública o ámbito laboral. Paciente con antecedentes de epilepsia conocida (abandono de medicación), ACV previo, traumatismo, infección del SNC o debut sin antecedentes.',
      keySigns: [
        'Movimientos tónico-clónicos generalizados sostenidos (sacudidas rítmicas de las 4 extremidades, rigidez muscular, contractura de mandíbula).',
        'Pérdida absoluta de la conciencia con desconexión del medio.',
        'Cianosis peribucal, respiración ruidosa/estertorosa o apnea durante la fase tónica.',
        'Sialorrea espumosa por boca (con o sin mordedura lingual lateral y sangrado).',
        'Relajación de esfínteres (micción involuntaria) e hipertonía generalizada.'
      ],
      highSuspicionRedFlags: [
        'Duración de la crisis > 5 minutos (cumple definición operativa de Status Epiléptico convulsivo).',
        'Crisis refractaria tras la administración de 2 dosis de benzodiacepinas.',
        'Status epiléptico no convulsivo: estupor, mirada fija, automatismos sutiles o mioclonías periorbitales persistentes tras una crisis.'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Cronometrar el tiempo exacto de duración de la convulsión desde el inicio.',
        'Seguridad del paciente: despejar el entorno de objetos peligrosos, proteger la cabeza, colocar de lado (decúbito lateral) para evitar aspiración. ¡NUNCA forzar objetos ni los dedos dentro de la boca!',
        'Garantizar oxigenoterapia a alto flujo.',
        'MEDIR GLUCEMIA CAPILAR INMEDIATA (descartar y corregir hipoglucemia de urgencia).'
      ],
      electrocardiogram: [
        'Monitoreo de frecuencia cardíaca (taquicardia sinusal autonómica habitual; descartar arritmias desencadenantes de síncope convulsivo).'
      ],
      biomarkersAndLabs: [
        'Glucemia capilar y venosa.',
        'Ionograma sérico completo: Sodio (hiponatremia severa < 120 mEq/L causa convulsiones frecuentes), Calcio, Magnesio.',
        'Gases en sangre: acidosis láctica metabólica severa postictal transitoria.',
        'Dosaje plasmático de fármacos anticonvulsivantes si el paciente tiene epilepsia conocida.',
        'Screening toxicológico en orina / sangre (cocaína, anfetaminas, abstinencia a alcohol/benzodiacepinas).'
      ],
      differentialDiagnosis: [
        'Síncope convulsivo vasovagal o cardiogénico (sacudidas breves < 15 segundos sin estado postictal prolongado).',
        'Crisis psicógena no epiléptica (movimientos asincrónicos, cierre ocular activo con resistencia a la apertura, signos vitales normales).',
        'Temblor o rigidez por decorticación/descerebración en el contexto de paro o herniación cerebral.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        '0 a 5 minutos: Soporte ABC, Oxígeno al 100%, glucemia capilar y colocación de vía venosa periférica si es posible.',
        '5 a 10 minutos (FASE 1 - Benzodiacepinas): Si la convulsión dura ≥ 5 minutos, administrar Benzodiacepina de 1° línea de inmediato:',
        '- Si hay vía EV: Diazepam 10 mg EV lento (o Lorazepam 4 mg EV).',
        '- Si NO hay vía EV disponible: Midazolam 10 mg Intramuscular (o intranasal/bucal). ¡No perder tiempo buscando vías periféricas difíciles!',
        'Repetir una segunda dosis de benzodiacepina a los 5-10 minutos si la crisis persiste.'
      ],
      emergencyRoomShockRoom: [
        '10 a 30 minutos (FASE 2 - Anticonvulsivantes de 2° línea EV): Si la crisis continúa a pesar de las benzodiacepinas, iniciar infusión de fármaco antiepiléptico no sedante:',
        '- Levetiracetam EV (60 mg/kg, máx 4500 mg en 10 min) O Valproato de Sodio EV (40 mg/kg en 10 min) O Fenitoína EV (20 mg/kg en 20-30 min con monitor cardíaco).',
        '> 30 a 60 minutos (FASE 3 - Status Epiléptico Refractario): Inducción de anestesia general, intubación orotraqueal e infusión continua de Propofol, Midazolam o Tiopental en UCI con monitoreo electroencefalográfico continuo (EEG).'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Diazepam EV o Midazolam IM',
          dose: 'Diazepam 10 mg (0.15-0.2 mg/kg) EV lento a 2-5 mg/min // Midazolam 10 mg IM (> 40 kg)',
          route: 'Intravenosa lenta / Intramuscular',
          notes: 'Primera línea (Fase 1). Midazolam IM es superior si no hay acceso venoso inmediato.'
        },
        {
          drug: 'Levetiracetam EV',
          dose: '60 mg/kg EV (dosis habitual adulto: 3000 a 4000 mg en 100 ml SF en 10 min)',
          route: 'Intravenosa en infusión rápida',
          notes: 'Segunda línea de elección: excelente perfil de seguridad, sin riesgo de hipotensión ni arritmias.'
        },
        {
          drug: 'Valproato de Sodio EV',
          dose: '40 mg/kg EV en bolo rápido en 5-10 minutos (máx 3000 mg)',
          route: 'Intravenosa',
          notes: 'Excelente opción de segunda línea (precaución en hepatopatía severa o embarazo).'
        },
        {
          drug: 'Fenitoína sódica EV',
          dose: '18 a 20 mg/kg EV diluido ÚNICAMENTE en Solución Fisiológica a velocidad ≤ 50 mg/min',
          route: 'Intravenosa con monitor cardíaco',
          notes: 'Riesgo de hipotensión severa y arritmias si se infunde rápidamente; incompatible con soluciones glucosadas (precipita).'
        },
        {
          drug: 'Dextrosa 50% + Tiamina (si hipoglucemia)',
          dose: 'Tiamina 100 mg EV seguido de Dextrosa 50% 50 ml (25 g de glucosa)',
          route: 'Intravenosa',
          notes: 'Administrar siempre Tiamina previa a la glucosa en pacientes con sospecha de desnutrición o alcoholismo para prevenir Encefalopatía de Wernicke.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Punto de corte operativo: Tiempo T1 (5 minutos) -> inicio de tratamiento farmacológico de rescate. Tiempo T2 (30 minutos) -> inicio de daño neuronal citotóxico irreversible y refractariedad farmacológica por internalización de receptores GABA.',
      goldStandard: 'Control de la crisis convulsiva en los primeros 10-15 minutos mediante Benzodiacepina precoz + Antiepiléptico de 2° línea.',
      alternativeReperfusion: 'Anestesia general con infusión continua de Propofol / Midazolam en UTI si persiste > 30 min.',
      contraindications: [
        'No administrar Fenitoína en bolo rápido directo (máx 50 mg/min) ni mezclar con dextrosa.'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'En crisis yugulada en los primeros 15-30 minutos: sobrevida aguda > 95-98%.',
      survivalAt24h: 'Sobrevida a las 24 horas: ~90-94%. En status refractario prolongado (> 60 min), la mortalidad asciende al 20-30%.',
      survivalAt7d: 'Sobrevida a los 7 días: ~85-90% dependiendo de la causa etiológica subyacente.',
      survivalAt1y: 'Sobrevida al año: 75-85%.',
      immediateComplications: [
        'Paro respiratorio, apnea postictal y neumonía aspirativa por pérdida de reflejos de la vía aérea.',
        'Rabdomiólisis severa por contracción muscular masiva con falla renal aguda mioglobinúrica.',
        'Hipertermia maligna y acidosis láctica extrema.'
      ],
      mediateAndLongTermComplications: [
        'Daño cerebral permanente con deterioro cognitivo y pérdida de memoria.',
        'Epileptogénesis secundaria y aumento de frecuencia de crisis recurrentes.',
        'Muerte súbita inesperada en epilepsia (SUDEP).'
      ]
    },
    actionCopyTemplate: 'PACIENTE EN STATUS EPILÉPTICO / CRISIS CONVULSIVA PROLONGADA. Duración aproximada: ___ minutos. Glucemia capilar: ___ mg/dl. Conducta: Vía aérea protegida, decúbito lateral. Benzodiacepina administrada: [Diazepam 10 mg EV / Midazolam 10 mg IM] a las ___:___ hs. Fármaco de 2° línea: Levetiracetam ___ mg EV. Respuesta: [Crisis yugulada / Persiste con pase a UTI].'
  },
  {
    id: 'crisis-glucemia',
    title: 'Hipoglucemia Severa y Complicaciones Hiperglucémicas (CAD / EHH)',
    shortTitle: 'Emergencias Glucémicas (Hipoglucemia / CAD / EHH)',
    category: 'Metabólico',
    cie10: 'E16.2 (Hipoglucemia) / E10.1 (Cetoacidosis diabética) / E11.0 (Coma hiperosmolar)',
    severity: 'Crítica / Código Rojo',
    summary: 'Descompensaciones metabólicas agudas extremas del metabolismo hidrocarbonado: desde neuroglucopenia crítica rápidamente reversible hasta acidosis metabólica grave y deshidratación hiperosmolar extrema.',
    prehospitalManifestations: {
      setting: 'Domicilio, vía pública o trabajo en pacientes con diabetes (tratamiento con insulina o sulfonilureas) o debut diabético tras infección desencadenante.',
      keySigns: [
        'Hipoglucemia: sudoración fría profusa, temblor fino distal, taquicardia/palpitaciones, hambre voraz y palidez marcada.',
        'Neuroglucopenia: confusión, desorientación, conducta bizarra/agresiva, focalidad neurológica que simula ACV, estupor o coma convulsivo (glucemia < 50-60 mg/dl).',
        'Cetoacidosis Diabética (CAD): respiración acidótica rápida y profunda de Kussmaul, aliento cetónico afrutado ("manzana madura"), náuseas, vómitos y dolor abdominal pseudoperitoneal.',
        'Estado Hiperosmolar Hiperglicémico (EHH): deshidratación extrema (signo del pliegue cutáneo marcado, mucosas resecas, globos oculares hundidos), hipotensión y letargo/coma progresivo con glucemias > 600 mg/dl.',
        'Polidipsia, poliuria y pérdida de peso previa de días de evolución.'
      ],
      highSuspicionRedFlags: [
        'Coma hipoglucémico prolongado (> 30-60 min sin corrección): riesgo de necrosis laminar cortical cerebral y muerte.',
        'Glucemia capilar "HIGH" o indetectable por el glucómetro con signos de shock hipovolémico.',
        'Acidosis severa con pH < 7.0 o Bicarbonato < 10 mEq/L y respiración agónica de Kussmaul.'
      ]
    },
    diagnosticAlgorithm: {
      initialSteps: [
        'Medición inmediata de GLUCEMIA CAPILAR con tira reactiva en el primer minuto de contacto.',
        'Si Glucemia < 70 mg/dl (y especialmente < 54 mg/dl): iniciar tratamiento de rescate glucémico inmediato.',
        'Si Glucemia > 300 mg/dl: evaluar cetonemia/cetonuria en tira reactiva, estado de hidratación y signos de acidosis.'
      ],
      electrocardiogram: [
        'Evaluar signos de Hipo o Hiperpotasemia (ondas T picudas simétricas en hiperK; ondas T aplanadas y ondas U prominentes en hipoK).'
      ],
      biomarkersAndLabs: [
        'Laboratorio completo: Glucemia venosa, Gases en sangre arterial o venosa (evaluar pH, bicarbonato y Anion Gap = [Na] - ([Cl] + [HCO3])), Ionograma sérico estricto con Sodio corregido (Na corregido = Na medido + 1.6 x [(Glucosa - 100) / 100]).',
        'Cetonemia (beta-hidroxibutirato > 3.0 mmol/L confirma CAD) o cetonuria (+++).',
        'Osmolaridad plasmática efectiva = 2 x [Na] + [Glucosa (mg/dl) / 18] (en EHH > 320 mOsm/kg).',
        'Función renal (urea, creatinina) y sedimento urinario (búsqueda de foco infeccioso urinario desencadenante).'
      ],
      differentialDiagnosis: [
        'ACV isquémico (la hipoglucemia es el gran simulador de focalidad neurológica focal).',
        'Abdomen agudo quirúrgico (la CAD produce dolor abdominal severo que resuelve con hidratación e insulina).',
        'Intoxicación alcohólica o farmacológica.'
      ]
    },
    management: {
      prehospitalAmbulance: [
        'HIPOGLUCEMIA:',
        '- Paciente consciente: 15-20 g de hidratos de carbono simples por vía oral (jugo de frutas azucarado, 3 sobres de azúcar o tabletas de glucosa; regla de los 15: dar 15g y revaluar a los 15 min).',
        '- Paciente inconsciente / sin reflejo deglutorio: NUNCA dar líquidos por boca por riesgo de broncoaspiración.',
        '- Vía venosa disponible: Dextrosa al 50% (25 a 50 ml en bolo EV lento) o Dextrosa al 10% (200 ml en infusión rápida).',
        '- Sin acceso venoso: Glucagón 1 mg Intramuscular o Subcutáneo.',
        'HIPERGLUCEMIA SEVERA (CAD / EHH):',
        '- Iniciar hidratación parenteral inmediata con Solución Fisiológica 0.9% a 1000 ml/h.',
        '- NO iniciar insulina en ambulancia sin conocer el nivel de potasio sérico previo (riesgo de hipopotasemia fatal).'
      ],
      emergencyRoomShockRoom: [
        'CAD y EHH en Shock Room / UTI:',
        '1. HIDRATACIÓN: Solución Fisiológica 0.9% 1000-1500 ml en la 1° hora; luego titular según sodio corregido.',
        '2. POTASIO: ¡Verificar Potasio sérico antes de la insulina! Si K < 3.3 mEq/L: corregir potasio primero y NO iniciar insulina. Si K 3.3-5.2 mEq/L: añadir 20-30 mEq de Cloruro de Potasio por litro de suero. Si K > 5.2 mEq/L: no añadir potasio pero monitorear c/2h.',
        '3. INSULINA: Insulina Corriente / Regular EV en infusión continua a 0.1 UI/kg/h (o bolo inicial 0.1 UI/kg + infusión 0.1 UI/kg/h). Objetivo: descenso de glucemia de 50 a 75 mg/dl por hora.',
        '4. TRANSICIÓN A DEXTROSA: Cuando glucemia llegue a 200-250 mg/dl en CAD (o 300 mg/dl en EHH), cambiar sueros a Dextrosa 5% con SF para evitar hipoglucemia mientras se mantiene la insulina hasta cerrar el Anion Gap.'
      ],
      initialPharmacotherapy: [
        {
          drug: 'Dextrosa 50% o Dextrosa 10% (en Hipoglucemia)',
          dose: 'Dextrosa 50%: 25 a 50 ml EV en bolo (12.5 a 25 g de glucosa) // Dextrosa 10%: 200 ml EV',
          route: 'Intravenosa',
          notes: 'Rescate inmediato del coma hipoglucémico. Repetir glucemia capilar a los 15 minutos.'
        },
        {
          drug: 'Glucagón IM / SC',
          dose: '1 mg IM / SC (o 0.5 mg en niños < 25 kg)',
          route: 'Intramuscular / Subcutánea',
          notes: 'De elección en hipoglucemia severa sin acceso venoso (menos eficaz en alcohólicos o desnutridos por depleción de glucógeno hepático).'
        },
        {
          drug: 'Solución Fisiológica 0.9% (en CAD / EHH)',
          dose: '1000 a 1500 ml en la primera hora (15-20 ml/kg/h)',
          route: 'Intravenosa rápida',
          notes: 'Restaura la volemia y mejora la perfusión tisular antes del inicio de insulina.'
        },
        {
          drug: 'Insulina Regular / Corriente EV (en CAD / EHH)',
          dose: 'Infusión continua a 0.1 UI/kg/hora (ej. 50 UI en 500 ml SF = 0.1 UI/ml)',
          route: 'Intravenosa continua en bomba',
          notes: 'Solo iniciar tras confirmar Potasio > 3.3 mEq/L.'
        },
        {
          drug: 'Cloruro de Potasio (KCl)',
          dose: '20 a 30 mEq por cada litro de solución de infusión',
          route: 'Intravenosa diluida',
          notes: 'Fundamental: la insulina introduce potasio al interior de la célula causando hipopotasemia súbita.'
        }
      ]
    },
    therapeuticWindow: {
      timeframe: 'Hipoglucemia: < 15 minutos para restaurar euglucemia y prevenir muerte neuronal. CAD: resolución de cetoacidosis en 12 a 24 horas. EHH: rehidratación gradual y normalización de la osmolaridad en 24 a 48 horas.',
      goldStandard: 'Hipoglucemia: Glucosa EV/Glucagón inmediato. CAD: Triángulo terapéutico (Hidratación agresiva + Reposición de Potasio + Insulina EV continua).',
      alternativeReperfusion: 'Insulina ultrarrápida subcutánea horaria si no hay bombas de infusión disponibles en sala general.',
      contraindications: [
        'Contraindicado iniciar insulina con Potasio sérico < 3.3 mEq/L (riesgo de paro cardíaco por hipopotasemia severa).',
        'Evitar el uso de Bicarbonato de Sodio en CAD salvo pH extremo < 6.9.'
      ]
    },
    evidenceAndPrognosis: {
      survivalAt6h: 'En hipoglucemia corregida precozmente: sobrevida > 99% con recuperación neurológica ad integrum.',
      survivalAt24h: 'Sobrevida a las 24 horas en CAD tratada según protocolo: > 98% (mortalidad global en centros de referencia < 1%).',
      survivalAt7d: 'Sobrevida a los 7 días: > 95% en CAD; ~85-90% en EHH (la mortalidad del Estado Hiperosmolar en ancianos oscila entre el 10-15% por comorbilidades).',
      survivalAt1y: 'Sobrevida al año dependiente del control metabólico y adherencia a insulina/educación diabetológica.',
      immediateComplications: [
        'Edema cerebral agudo (complicación temible en niños y adultos jóvenes por descenso excesivamente rápido de la osmolaridad sérica).',
        'Hipopotasemia severa con arritmias ventriculares letales.',
        'Hipoglucemia refractaria prolongada en intoxicación por sulfonilureas (requiere internación 24-48h).'
      ],
      mediateAndLongTermComplications: [
        'Déficit neurológico permanente tras coma hipoglucémico anóxico prolongado.',
        'Trombosis vascular periférica o venosa profunda por hiperviscosidad sanguínea en EHH.',
        'Mucormicosis u otras infecciones oportunistas fúngicas invasivas en pacientes con CAD.'
      ]
    },
    actionCopyTemplate: 'PACIENTE CON DESCOMPENSACIÓN GLUCÉMICA. Glucemia capilar inicial: ___ mg/dl. Cuadro clínico: [Hipoglucemia severa / Cetoacidosis Diabética / Estado Hiperosmolar]. Conducta: [Dextrosa 50% ___ ml EV con normalización de glucemia / Hidratación con SF 0.9% 1000 ml/h + Infusión de Insulina Regular a 0.1 UI/kg/h con monitoreo de Potasio]. Signos vitales estables.'
  },
  {
    "id": "pcr-pals",
    "title": "Paro Cardiorrespiratorio Pediátrico (Algoritmo PALS Avanzado)",
    "shortTitle": "PCR Pediátrico / PALS",
    "category": "Pediatría",
    "cie10": "I46.9 (Paro cardíaco)",
    "severity": "Crítica / Código Rojo",
    "summary": "Cese brusco de la actividad mecánica cardíaca en pediatría. En >80% de los casos es de origen hipóxico/asfíctico secundario a falla respiratoria o shock descompensado. Requiere soporte ventilatorio prioritario, compresiones torácicas 15:2 y acceso vascular o intraóseo inmediato.",
    "prehospitalManifestations": {
      "setting": "Hogar, guardería, vía pública o unidad de traslado pediátrico / ambulancia.",
      "keySigns": [
        "Inconsciencia / Falta de respuesta absoluta al estímulo táctil y auditivo vigoroso.",
        "Apnea o respiración agónica espasmódica (\"gasping\") ineficaz.",
        "Ausencia de pulso central palpable en < 10 segundos (pulso braquial/femoral en lactantes < 1 año; pulso carotídeo/femoral en niños > 1 año).",
        "Bradicardia severa < 60 lpm persistente con signos de hipoperfusión tisular pese a oxigenación/ventilación adecuada (indicación mandatoria de compresiones en pediatría).",
        "Palidez cérea terrosa, cianosis central generalizada o livedo reticularis grave con hipotonía muscular total."
      ],
      "highSuspicionRedFlags": [
        "Lactante que no llora, no se mueve y presenta respiración agónica tras asfixia por inmersión o atragantamiento.",
        "Frecuencia cardíaca < 60 lpm con frialdad distal extrema y letargia profunda.",
        "Cianosis refractaria a la ventilación con bolsa-válvula-máscara (BVM).",
        "Retraso en el inicio de compresiones torácicas > 10 segundos por duda diagnóstica (ante la duda, iniciar RCP)."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Seguridad de la escena y verificar respuesta: tocar hombros/planta de los pies y llamar en voz alta.",
        "2. Pedir ayuda inmediata / Activar \"Código Azul Pediátrico\" y solicitar Desfibrilador (DEA/Monitor bifásico).",
        "3. Evaluar respiración y pulso central simultáneamente en < 10 segundos (braquial en lactantes, carotídeo en niños).",
        "4. Si NO respira (o solo boquea) y NO hay pulso (o FC < 60 lpm con mala perfusión): Iniciar RCP inmediata.",
        "5. Relación Compresiones/Ventilaciones: 15:2 con 2 reanimadores (30:2 si hay 1 solo reanimador). Frecuencia: 100-120 cpm. Profundidad: al menos 1/3 del diámetro anteroposterior del tórax (~4 cm en lactantes con técnica de 2 pulgares abrazando el tórax; ~5 cm en niños mayores con 1 o 2 manos).",
        "6. Conectar monitor/desfibrilador e identificar ritmo cardíaco en cuanto esté disponible."
      ],
      "electrocardiogram": [
        "Ritmos Desfibrilables (~10-15% en niños, más común en cardiopatías/intoxicaciones): Fibrilación Ventricular (FV) o Taquicardia Ventricular sin Pulso (TVSP).",
        "Ritmos No Desfibrilables (~85-90% en niños): Asistolia o Actividad Eléctrica sin Pulso (AESP) secundaria a hipoxia/acidosis.",
        "Verificar derivaciones, ganancia y ausencia de desconexión de cables ante trazo isoeléctrico (asistolia)."
      ],
      "biomarkersAndLabs": [
        "Capnografía cuantitativa continua (ETCO2): ETCO2 < 10-15 mmHg indica compresiones de baja calidad; elevación súbita a > 35-40 mmHg indica Retorno de la Circulación Espontánea (RCE).",
        "Glucemia capilar urgente (descartar hipoglucemia severa como causa o cofactor).",
        "Gases en sangre arterial/venosa: acidosis metabólica/respiratoria severa, lactato sérico, déficit de base.",
        "Ionograma: descartar hiperpotasemia/hipopotasemia, hipocalcemia."
      ],
      "differentialDiagnosis": [
        "Regla de las 6 H: Hipoxia (causa #1), Hipovolemia/deshidratación/hemorragia, Hidrogeniones (acidosis), Hipo/Hiperpotasemia, Hipoglucemia, Hipotermia.",
        "Regla de las 6 T: Tensión (neumotórax a tensión), Taponamiento cardíaco, Tóxicos/intoxicación, Trombosis pulmonar, Trombosis coronaria (anomalías coronarias), Trauma grave."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. RCP de alta calidad sin interrupciones: minimizar pausas en compresiones a < 10 segundos.",
        "2. Vía aérea y ventilación: Apertura de vía aérea (posición de olfateo en lactantes con rollo bajo hombros; evitar hiperextensión cervical). Bolsa-válvula-máscara (BVM) conectada a O2 a 15 L/min con reservorio (1 ventilación cada 2-3 segundos / 20-30 ventilaciones por minuto si hay vía aérea avanzada).",
        "3. Acceso Vascular Urgente: Intentar vía venosa periférica (máximo 60 segundos o 2 intentos). Si falla: COLOCAR ACCESO INTRAÓSEO (IO) INMEDIATO en tuberosidad tibial anterior (1-2 cm distal y medial).",
        "4. Si Ritmo Desfibrilable (FV/TVSP): Descarga 2 J/kg inicial -> reanudar RCP 2 min -> 2ª descarga 4 J/kg -> Adrenalina tras 2ª descarga -> 3ª descarga ≥ 4 J/kg (máx 10 J/kg) -> Amiodarona o Lidocaína tras 3ª descarga.",
        "5. Si Ritmo No Desfibrilable (Asistolia/AESP): Adrenalina precoz IV/IO lo antes posible y repetir cada 3-5 minutos + búsqueda y tratamiento de las 6H y 6T."
      ],
      "emergencyRoomShockRoom": [
        "1. Manejo avanzado de la vía aérea: Intubación orotraqueal con tubo endotraqueal (TET) con balón de baja presión (Fórmula tamaño TET: [Edad en años / 4] + 3.5 con balón, o [Edad / 4] + 4 sin balón). Confirmar con capnografía continua.",
        "2. Continuar ciclos de 2 minutos de RCP con relevo de compresores para evitar fatiga.",
        "3. Expansión rápida con Cristaloides isotónicos: Bolo de SF 0.9% 10-20 ml/kg IV/IO si sospecha de hipovolemia/shock séptico.",
        "4. Post-RCE (Cuidados Post-Paro): Control específico de temperatura (evitar fiebre, meta normotermia 36-37.5°C), PaO2 94-98% (evitar hiperoxia), normocapnia (PaCO2 35-45 mmHg), infusión de inotrópicos (adrenalina/noradrenalina) para mantener TAM > percentil 50 para la edad, corrección de glucemia."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Adrenalina (Epinefrina)",
          "dose": "0.01 mg/kg (0.1 ml/kg de dilución 1:10.000)",
          "route": "IV / Intraósea (IO) en bolo rápido con lavado de 5 ml SF",
          "notes": "Administrar cada 3 a 5 minutos durante todo el paro. Máximo 1 mg (1 ampolla de 1:10.000) por dosis."
        },
        {
          "drug": "Amiodarona",
          "dose": "5 mg/kg en bolo rápido IV/IO",
          "route": "IV / IO",
          "notes": "Para FV/TVSP refractaria tras la 3ª descarga. Puede repetirse hasta 2 veces (dosis acumulada máx 15 mg/kg o 300 mg)."
        },
        {
          "drug": "Lidocaína 1% o 2%",
          "dose": "1 mg/kg bolo de carga inicial",
          "route": "IV / IO",
          "notes": "Alternativa a amiodarona en FV/TVSP refractaria. Mantenimiento post-RCE: 20-50 mcg/kg/min."
        },
        {
          "drug": "Solución Fisiológica 0.9%",
          "dose": "10 a 20 ml/kg en bolo rápido",
          "route": "IV / IO",
          "notes": "En sospecha de hipovolemia, shock séptico o anafiláctico previo al paro. Reevaluar rales."
        },
        {
          "drug": "Dextrosa al 10%",
          "dose": "2 a 5 ml/kg en bolo lento",
          "route": "IV / IO",
          "notes": "Si glucemia < 60 mg/dl en niños o < 45 mg/dl en neonatos/lactantes."
        },
        {
          "drug": "Bicarbonato de Sodio 1M (8.4%)",
          "dose": "1 mEq/kg (1 ml/kg)",
          "route": "IV / IO lento",
          "notes": "Solo indicado en hiperpotasemia documentada, intoxicación por antidepresivos tricíclicos o paro prolongado con ventilación efectiva previa."
        },
        {
          "drug": "Gluconato de Calcio 10%",
          "dose": "0.5 ml/kg (60 mg/kg) o Cloruro de Calcio 10% 0.2 ml/kg (20 mg/kg)",
          "route": "IV / IO lento",
          "notes": "Indicado únicamente en hipocalcemia documentada, hiperpotasemia severa o sobredosis de bloqueantes cálcicos."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "Tiempo crítico inmediato: Reanimación cerebral efectiva depende de compresiones y oxigenación en < 2 minutos. Desfibrilación precoz (< 2 min en FV/TVSP) duplica la sobrevida.",
      "goldStandard": "RCP de alta calidad con ventilación efectiva, acceso intraóseo en < 60 s y desfibrilación precoz si el ritmo lo requiere.",
      "alternativeReperfusion": "Soporte Vital Extracorpóreo Pediátrico (E-CPR) en centros de alta complejidad con oxigenación por membrana extracorpórea (ECMO) si PCR intrahospitalario presenciado refractario.",
      "contraindications": [
        "Signos indiscutibles de muerte biológica (rigidez cadavérica establecida, livideces fijas, decapitación, maceración en recién nacidos).",
        "Directivas anticipadas documentadas de No Reanimar (DNR) / Limitación del Esfuerzo Terapéutico en patología terminal."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "En PCR intrahospitalario: RCE inicial 50-70%. En PCR extrahospitalario: RCE inicial 25-35%. Alto riesgo de disfunción miocárdica post-paro en las primeras 6 horas.",
      "survivalAt24h": "Sobrevida a las 24 horas en UCIP: 30-45% en intrahospitalario; 15-20% en extrahospitalario.",
      "survivalAt7d": "Sobrevida al alta hospitalaria: ~35-45% en paro intrahospitalario; ~8-12% en paro extrahospitalario pediátrico.",
      "survivalAt1y": "Sobrevida al año con estado neurológico favorable (Escala PCPC 1-2): ~25-35% en intrahospitalario; ~6-10% en extrahospitalario.",
      "immediateComplications": [
        "Disfunción miocárdica post-resucitación con shock cardiogénico e hipotensión severa.",
        "Edema cerebral anóxico e hipertensión endocraneana.",
        "Lesiones por RCP: fracturas costales, neumotórax, laceración hepática o esplénica por mala posición de manos."
      ],
      "mediateAndLongTermComplications": [
        "Encefalopatía hipóxico-isquémica severa con parálisis cerebral, cuadriparesia espástica o estado vegetativo persistente.",
        "Falla multiorgánica (insuficiencia renal aguda, coagulopatía de consumo, necrosis tubular aguda).",
        "Convulsiones post-anóxicas y mioclonías rebeldes."
      ]
    },
    "actionCopyTemplate": "PARO CARDIORRESPIRATORIO PEDIÁTRICO (PALS). Peso estimado: ___ kg. Causa probable: [Hipoxia / Asfixia / Shock / Cardiopatía / Intoxicación]. Ritmo inicial: [Asistolia / AESP / FV / TVSP]. Conducta: RCP 15:2 de alta calidad + Oxigenación 100% BVM/TET + Acceso [IV / Intraóseo tibial]. Fármacos: Adrenalina 0.01 mg/kg EV/IO (dosis: ___ mg) x ___ ciclos. [Desfibrilación ___ Joules]. Retorno a Circulación Espontánea (RCE): [Logrado / No logrado]. Traslado / Ingreso inmediato a UCIP."
  },
  {
    "id": "insuf-resp-pediatrica",
    "title": "Insuficiencia Respiratoria y Obstrucción Laríngea Aguda (Crup Grave / Estridor)",
    "shortTitle": "Insuficiencia Respiratoria Pediátrica / Crup",
    "category": "Pediatría",
    "cie10": "J96.0 (Insuficiencia respiratoria aguda) / J05.0 (Laringotraqueítis aguda)",
    "severity": "Crítica / Código Rojo",
    "summary": "Dificultad ventilatoria aguda con riesgo de claudicación respiratoria inminente en niños. Caracterizada por aumento marcado del trabajo respiratorio, estridor inspiratorio en reposo, tiraje universal y alteración del intercambio gaseoso.",
    "prehospitalManifestations": {
      "setting": "Hogar, guardería, vía pública o traslado en ambulancia.",
      "keySigns": [
        "Estridor inspiratorio rudo y audible en reposo (indica obstrucción de vía aérea superior en glotis/subglotis).",
        "Tiraje respiratorio universal: supraclavicular, supraesternal, intercostal y subcostal severo.",
        "Aleteo nasal activo y cabeceo sincronizado con la inspiración (signo de fatiga muscular).",
        "Quejido espiratorio audible y respiración paradojal toracoabdominal en \"balancín\" (falla ventilatoria inminente).",
        "Cianosis peribucal / ungueal, palidez cenicienta o bradipnea con somnolencia extrema por hipercapnia/agotamiento diafragmático."
      ],
      "highSuspicionRedFlags": [
        "Niño con estridor que pasa de estar agitado/taquipneico a silencioso, bradipneico y letárgico (agotamiento extremo / parada respiratoria inminente).",
        "Incapacidad para deglutir saliva con sialorrea profusa y postura en \"trípode\" (sospecha de epiglotitis aguda / absceso retrofaríngeo).",
        "Saturación de O2 < 90% con aire ambiente refractaria a O2 estándar.",
        "Silencio auscultatorio pulmonar bilateral tras período de estridor severo."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Aplicar Triángulo de Evaluación Pediátrica (TEP): Evaluar Apariencia (tono, interactividad, mirada, llanto), Trabajo Respiratorio (ruidos anormales, tiraje, aleteo) y Circulación Cutánea (palidez, cianosis, livedo).",
        "2. NO MOLESTAR NI FORZAR AL NIÑO: Evitar procedimientos dolorosos o llanto intenso (el llanto aumenta el flujo turbulento y colapsa la vía aérea subglótica). Permitir que permanezca en brazos de su madre/padre.",
        "3. Evaluar Score de Westley en Crup (Estridor: 0-2, Tiraje: 0-3, Entrada de aire: 0-2, Cianosis: 0-5, Sensorio: 0-5. Score ≥ 6 = Crup Moderado/Grave).",
        "4. Oximetría de pulso continua (SatO2 meta ≥ 94%)."
      ],
      "electrocardiogram": [
        "Taquicardia sinusal compensadora. La aparición de bradicardia en hipoxia severa es un signo pre-paro cardíaco."
      ],
      "biomarkersAndLabs": [
        "Gases en sangre arterial/capilar: evaluar PaCO2 (hipercapnia > 45-50 mmHg indica fatiga ventilatoria) y PaO2/SatO2.",
        "Radiografía de tórax/cuello frente y perfil (solo si el paciente está clínicamente estabilizado; buscar signo del \"campanario\" o \"punta de lápiz\" en subglotis o \"signo del pulgar\" en epiglotitis)."
      ],
      "differentialDiagnosis": [
        "Laringitis aguda subglótica (Crup viral por Parainfluenza).",
        "Epiglotitis aguda bacteriana (S. pneumoniae / H. influenzae): fiebre alta, aspecto tóxico, sialorrea, ausencia de tos perruna.",
        "Aspiración de cuerpo extraño en vía aérea (inicio brusco asfixiante con tos paroxística sin pródromo febril).",
        "Traqueítis bacteriana o absceso periamigdalino/retrofaríngeo.",
        "Anafilaxia con angioedema de cuerdas vocales."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. Oxigenoterapia en flujo libre (\"blow-by\") o con máscara con reservorio colocada suavemente cerca de la cara sin sujetar rígidamente.",
        "2. Nebulización urgente con Adrenalina Corriente (1:1000): 0.5 ml/kg (dosis mínima 2.5 ml, máxima 5 ml sin diluir) nebulizada con O2 a 6-8 L/min.",
        "3. Dexametasona vía oral o intramuscular temprana: 0.6 mg/kg (máx 16 mg) dosis única.",
        "4. Mantener al paciente en posición semisentada o fowler en brazos del acompañante.",
        "5. Traslado urgente con preaviso hospitalario."
      ],
      "emergencyRoomShockRoom": [
        "1. Si persiste estridor en reposo tras 30 min: Repetir nebulización con Adrenalina corriente 1:1000.",
        "2. Cánula Nasal de Alto Flujo (CAFO) si hipoxemia refractaria con flujo 1.5 - 2 L/kg/min.",
        "3. Si paro respiratorio o falla inminente: Intubación orotraqueal con TET 0.5 a 1 calibre menor al esperado para la edad debido al edema subglótico, asistida por el médico más experimentado.",
        "4. Período de observación hospitalaria obligatoria de al menos 3 a 4 horas tras la última nebulización con adrenalina para descartar efecto rebote."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Adrenalina corriente 1:1000 (1 mg/ml)",
          "dose": "0.5 ml/kg (mín 2.5 ml, máx 5 ml) en nebulizador",
          "route": "Inhalatoria / Nebulizada con flujo de O2 a 6-8 L/min",
          "notes": "Efecto descongestivo alfa-1 en 10-20 min. Vigilar efecto rebote a las 2-3 horas."
        },
        {
          "drug": "Dexametasona",
          "dose": "0.15 a 0.6 mg/kg (máx 16 mg) dosis única",
          "route": "Vía Oral / IM / IV",
          "notes": "Efecto antiinflamatorio glucocorticoide sistémico a partir de 1-2 horas. Reduce tasas de intubación y reconsulta."
        },
        {
          "drug": "Budesonide para nebulizar",
          "dose": "2 mg (4 ml de solución para nebulizar)",
          "route": "Inhalatoria / Nebulizada",
          "notes": "Alternativa o coadyuvante a dexametasona si vómitos incoercibles y dificultad para acceso IM."
        },
        {
          "drug": "Salbutamol en aerosol con aerocámara",
          "dose": "2 a 4 puffs",
          "route": "Inhalatoria con máscara facial sellada",
          "notes": "Si coexiste sibilancias espiratorias o sospecha de hiperreactividad bronquial asociada."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "Nebulización con adrenalina en < 15 minutos; Corticoides en < 30 minutos. La acción descongestiva máxima de la adrenalina ocurre a los 15-30 minutos.",
      "goldStandard": "Dexametasona 0.6 mg/kg + Nebulización con Adrenalina 1:1000 en todo crup moderado a severo con estridor en reposo.",
      "alternativeReperfusion": "Ventilación no invasiva / Cánula de Alto Flujo (CAFO) o Intubación con tubo traqueal fino bajo laringoscopía directa / videolaringoscopía.",
      "contraindications": [
        "Examen de fauces con bajalenguas si se sospecha epiglotitis aguda (puede desencadenar laringoespasmo fatal inmediato).",
        "Separación del niño de sus progenitores durante la reanimación inicial."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "Sobrevida > 99% con tratamiento oportuno con adrenalina y corticoides; remisión del estridor en > 85% de los casos en las primeras 2 horas.",
      "survivalAt24h": "Sobrevida > 99.5% tras internación en sala de observación pediátrica.",
      "survivalAt7d": "Resolución completa del cuadro en 48-72 horas sin secuelas.",
      "survivalAt1y": "Excelente pronóstico; baja tasa de recurrencia en niños mayores de 3-5 años al aumentar el calibre laríngeo.",
      "immediateComplications": [
        "Asfixia aguda por obstrucción completa de la vía aérea subglótica o espasmo glótico.",
        "Edema pulmonar por presión negativa post-obstructivo tras alivio brusco de obstrucción severa.",
        "Paro cardiorrespiratorio hipóxico."
      ],
      "mediateAndLongTermComplications": [
        "Estenosis subglótica adquirida en caso de intubación traumática o prolongada con tubo sobredimensionado.",
        "Sobreinfección bacteriana secundaria (traqueítis bacteriana membranosa, neumonía aspirativa)."
      ]
    },
    "actionCopyTemplate": "PACIENTE PEDIÁTRICO CON INSUFICIENCIA RESPIRATORIA / CRUP GRAVE. Edad: ___ meses/años. Peso: ___ kg. Presentación: Estridor inspiratorio en reposo + Tiraje universal [supraesternal/intercostal/subcostal]. SatO2: ___%. Conducta: O2 suplementario + Nebulización con Adrenalina 1:1000 ___ ml + Dexametasona ___ mg [VO/IM/EV]. Respuesta: [Favorable con alivio del estridor / Refractaria con requerimiento de CAFO / Intubación]. Paciente en observación estricta."
  },
  {
    "id": "bronquiolitis-grave",
    "title": "Bronquiolitis Aguda Grave e Insuficiencia Ventilatoria en Lactantes",
    "shortTitle": "Bronquiolitis Grave en Lactantes",
    "category": "Pediatría",
    "cie10": "J21.0 (Bronquiolitis por VSR) / J21.9 (Bronquiolitis aguda)",
    "severity": "Urgencia / Código Amarillo",
    "summary": "Primer episodio sibilante y dificultad respiratoria en lactantes menores de 12-24 meses tras pródromo catarral, predominantemente causado por Virus Sincicial Respiratorio (VSR). En formas graves genera obstrucción bronquiolar por moco, atelectasias, fatiga muscular y apneas.",
    "prehospitalManifestations": {
      "setting": "Hogar, sala de espera pediátrica o traslado en ambulancia durante meses de otoño/invierno.",
      "keySigns": [
        "Lactante < 1 año con antecedente de rinorrea y tos de 2-4 días que progresa a dificultad respiratoria severa.",
        "Taquipnea marcada: > 60 rpm en < 2 meses; > 50 rpm en 2-11 meses; > 40 rpm en 1-2 años.",
        "Tiraje subcostal e intercostal evidente con aleteo nasal y quejido espiratorio.",
        "Rechazo alimentario marcado: ingesta de leche < 50% de su ración habitual con atragantamiento durante las tomas.",
        "Episodios de apneas (pausas respiratorias > 20 segundos o < 20 s con cianosis/bradicardia), especialmente en prematuros o < 2 meses."
      ],
      "highSuspicionRedFlags": [
        "Lactante menor de 6 semanas de vida o nacido prematuro (< 37 semanas).",
        "Antecedente de Cardiopatía Congénita con flujo pulmonar aumentado o Displasia Broncopulmonar.",
        "Pausas apneicas reiteradas o somnolencia con llanto débil.",
        "Saturación de O2 < 90% con aire ambiente persistente."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Evaluar signos vitales completos: Frecuencia Respiratoria (contar en 60 segundos completos), Frecuencia Cardíaca, SatO2 y Temperatura.",
        "2. Aplicar Score de Tal Modificado (FR, Sibilancias, Cianosis, Tiraje: 0-4 Leve, 5-8 Moderada, 9-12 Grave) o Score de Wood-Downes-Ferrés.",
        "3. Auscultación pulmonar: Rales subcrepitantes bilaterales (\"en velcro\"), sibilancias espiratorias diseminadas y tiempo espiratorio prolongado.",
        "4. Evaluar hidratación: fontanela, llanto con lágrimas, signo del pliegue y diuresis."
      ],
      "electrocardiogram": [
        "Taquicardia sinusal acorde a la fiebre, estrés y dificultad respiratoria."
      ],
      "biomarkersAndLabs": [
        "Panel viral respiratorio por inmunofluorescencia o PCR en hisopado nasofaríngeo (VSR, Rinovirus, Influenza, Metaneumovirus).",
        "Gases en sangre capilar/venosa: retención de CO2 (PaCO2 > 45-50 mmHg) en casos de fatiga diafragmática o atelectasias masivas.",
        "Radiografía de tórax (indicada solo en bronquiolitis grave o sospecha de complicación): signos de hiperinsuflación (aplanamiento diafragmático, aumento de espacios intercostales), infiltrados parahiliares o atelectasias laminares/segmentarias."
      ],
      "differentialDiagnosis": [
        "Crisis asmática / Asma del lactante (en mayores de 1 año con episodios recurrentes previos o atopia familiar).",
        "Neumonía bacteriana o por gérmenes atípicos (consolidación focal con fiebre persistente elevada).",
        "Insuficiencia cardíaca congestiva descompensada por cardiopatía congénita acianótica.",
        "Tos convulsa / Síndrome coqueluchoide (paroxismos de tos con \"estridor inspiratorio\" y cianosis)."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. Posición semisentada en 30° con ligera extensión cervical.",
        "2. Aspiración suave de secreciones nasales con jeringa y solución fisiológica antes de alimentar o trasladar.",
        "3. Oxigenoterapia normotérmica humidificada mediante cánula nasal para mantener SatO2 92-94%.",
        "4. Suspender alimentación oral forzada para evitar broncoaspiración si FR > 60 rpm.",
        "5. Traslado con calefacción adecuada en ambulancia para prevenir hipotermia."
      ],
      "emergencyRoomShockRoom": [
        "1. Cánula Nasal de Alto Flujo (CAFO): Terapia de elección en bronquiolitis moderada/grave. Iniciar a 1.5 - 2 L/kg/min con aire/O2 tibio y humidificado para reducir trabajo respiratorio y generar PEEP fisiológico.",
        "2. Nutrición enteral por Sonda Orogástrica a débito continuo fraccionado si tolera, o Hidratación Parenteral IV con Solución Glucosada al 5% + Na+ isotónico al 80% de las necesidades basales (restringido por riesgo de secreción inadecuada de ADH).",
        "3. Prueba terapéutica con Salbutamol (2 puffs con aerocámara): continuar SOLO si se evidencia mejoría objetiva de ≥ 2 puntos en el Score de Tal a los 15-20 min; de lo contrario suspender.",
        "4. Si falla ventilatoria refractaria o apneas recurrentes: CPAP / VMNI o Intubación Orotraqueal y pase a UCIP."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Solución Salina Hipertónica al 3%",
          "dose": "3 a 4 ml por nebulizador cada 6-8 horas",
          "route": "Inhalatoria / Nebulizada",
          "notes": "Facilita el aclaramiento mucociliar y disminuye el edema submucoso en pacientes internados."
        },
        {
          "drug": "Salbutamol en aerosol con aerocámara valvulada",
          "dose": "2 puffs con máscara facial",
          "route": "Inhalatoria",
          "notes": "Prueba terapéutica única. Continuar solo si hay respuesta clínica medible. No indicado de rutina según guías AAP/SAP."
        },
        {
          "drug": "Solución de Hidratación Parenteral IV",
          "dose": "60 a 80 ml/kg/día (Holiday-Segar al 80%) con Na+ 77-140 mEq/L",
          "route": "IV continua",
          "notes": "En lactantes con dificultad respiratoria severa que no pueden alimentarse por vía oral."
        },
        {
          "drug": "Antitérmicos: Paracetamol",
          "dose": "10 a 15 mg/kg cada 6 horas vía oral / rectal",
          "route": "VO / Rectal",
          "notes": "Si temperatura axilar ≥ 38°C para confort y reducir consumo de O2."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "Instauración de soporte ventilatorio no invasivo (CAFO) en las primeras 2 horas de ingreso para evitar fatiga muscular diafragmática.",
      "goldStandard": "Medidas de soporte: Aspiración de secreciones, Oxigenoterapia/CAFO, adecuada hidratación y nutrición enteral protegida.",
      "alternativeReperfusion": "Presión positiva continua en vía aérea (CPAP nasal) o Ventilación Mecánica Invasiva en UCIP.",
      "contraindications": [
        "Corticoides sistémicos de rutina (no han demostrado eficacia en bronquiolitis típica viral según consenso internacional).",
        "Antibióticos de rutina (la etiología es viral; solo indicados ante sospecha fundada de sobreinfección bacteriana).",
        "Kinesioterapia respiratoria con técnicas percusivas forzadas en fase aguda (aumenta el distrés y el broncoespasmo)."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "Estabilización clínica con CAFO en > 85% de los lactantes sin necesidad de intubación.",
      "survivalAt24h": "Sobrevida > 99% en centros pediátricos con soporte ventilatorio adecuado.",
      "survivalAt7d": "Duración media del cuadro agudo: 5 a 7 días. Pico de máxima gravedad entre el 3er y 5to día.",
      "survivalAt1y": "Sobrevida excelente (> 99.8%). Un 30-40% puede presentar episodios posteriores de hiperreactividad bronquial / sibilancias recurrentes desencadenadas por virus.",
      "immediateComplications": [
        "Agotamiento ventilatorio con hipercapnia severa y paro respiratorio.",
        "Atelectasias lobares masivas (frecuente en lóbulo superior derecho o lóbulo medio).",
        "Neumotórax / Neumomediastino por hiperinsuflación alveolar y barotrauma."
      ],
      "mediateAndLongTermComplications": [
        "Síndrome de sibilancias recurrentes post-bronquiolitis (asma del lactante).",
        "Bronquiolitis obliterante (rara secuela tras infección grave por Adenovirus serotipos 7/21)."
      ]
    },
    "actionCopyTemplate": "LACTANTE CON BRONQUIOLITIS AGUDA GRAVE. Edad: ___ meses. Peso: ___ kg. Score de Tal: ___/12 (Grave). SatO2: ___% aire ambiente. Signos: Tiraje universal + FR ___ rpm + Rales y sibilancias bilaterales. Conducta: Aspiración de secreciones + Oxigenoterapia con [Cánula nasal / CAFO a ___ L/min] + SNG / Hidratación parenteral al 80% basal. [Prueba con Salbutamol: respuesta positiva/negativa]. Traslado/ingreso a internación pediátrica."
  },
  {
    "id": "crisis-asmatica-pediatrica",
    "title": "Crisis Asmática Pediátrica Severa y Status Asmático",
    "shortTitle": "Crisis Asmática Pediátrica Severa",
    "category": "Pediatría",
    "cie10": "J45.9 (Asma severa) / J46 (Estado asmático)",
    "severity": "Crítica / Código Rojo",
    "summary": "Exacerbación aguda o subaguda de obstrucción bronquial en pacientes pediátricos, caracterizada por broncoespasmo severo, inflamación de la mucosa y tapones de moco. Requiere broncodilatación intensiva seriada, corticoterapia temprana y sulfato de magnesio IV.",
    "prehospitalManifestations": {
      "setting": "Hogar, escuela, club deportivo o traslado en ambulancia.",
      "keySigns": [
        "Disnea sibilante de instalación brusca o progresiva refractaria a dosis habituales de salbutamol.",
        "Incapacidad para pronunciar frases completas o llanto entrecortado monofásico.",
        "Tiraje subcostal, intercostal y supraesternal con uso intenso de músculos esternocleidomastoideos.",
        "Tórax hiperinsuflado y \"silente\" a la auscultación (ausencia de sibilancias por flujo espiratorio críticamente bajo: signo de gravedad extrema).",
        "Agitación psicomotriz extrema inicial que vira a letargia, confusión y somnolencia por retención de CO2 y fatiga diafragmática."
      ],
      "highSuspicionRedFlags": [
        "Tórax silencioso a la auscultación con trabajo respiratorio máximo.",
        "Paciente que adopta postura fija hacia adelante (\"trípode\") y no tolera el decúbito dorsal.",
        "Pulso paradójico > 15-20 mmHg (caída palpable de la amplitud del pulso durante la inspiración).",
        "Falta de respuesta tras la primera hora de broncodilatación reglada con aerocámara."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Evaluar gravedad mediante Score Pulmonary Score (PS) o Pediatric Respiratory Assessment Measure (PRAM).",
        "2. Oximetría de pulso continua (meta de SatO2: 94-98% con O2 suplementario).",
        "3. Auscultación pulmonar en 4 cuadrantes: sibilancias espiratorias e inspiratorias generalizadas vs silencio auscultatorio.",
        "4. Evaluar antecedentes de riesgo de asma potencialmente mortal: intubaciones previas en UCIP, internaciones en el último año, uso frecuente de corticoides orales."
      ],
      "electrocardiogram": [
        "Taquicardia sinusal marcada. En crisis severas con hiperinsuflación: signos de sobrecarga ventricular derecha aguda (S1Q3T3 transitorio, onda P pulmonale)."
      ],
      "biomarkersAndLabs": [
        "Gases en sangre arterial o capilar: en fase inicial hay alcalosis respiratoria con PaCO2 baja (< 35 mmHg); una PaCO2 normal (38-42 mmHg) o elevada (> 45 mmHg) en un niño exhausto indica claudicación respiratoria inminente.",
        "Ionograma: monitorear potasio sérico (la administración repetida de salbutamol a dosis altas induce hipopotasemia por translocación celular).",
        "Radiografía de tórax: indicada para descartar complicaciones mecánicas como neumotórax o neumomediastino ante dolor torácico súbito o descompensación brusca."
      ],
      "differentialDiagnosis": [
        "Cuerpo extraño en vía aérea inferior.",
        "Anafilaxia con broncoespasmo como manifestación predominante.",
        "Neumonía / Bronconeumonía bacteriana con broncoespasmo reactivo.",
        "Disfunción de cuerdas vocales o laringomalacia."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. Oxigenoterapia normobárica para mantener SatO2 94-98%.",
        "2. Salbutamol MDI con aerocámara valvulada: 4 a 8 puffs (1 puff cada 30-60 s con 5-10 respiraciones por puff) cada 20 minutos durante la primera hora (esquema de crisis de 3 dosis).",
        "3. Bromuro de Ipratropio en aerosol: 2 a 4 puffs asociados al Salbutamol en cada una de las 3 dosis de la primera hora.",
        "4. Corticoide oral temprano: Meprednisona / Prednisolona 1-2 mg/kg VO de inmediato.",
        "5. Traslado con preaviso a shock room pediátrico."
      ],
      "emergencyRoomShockRoom": [
        "1. Si la crisis persiste severa tras la 1ª hora (PRAM ≥ 8 / PS ≥ 7): Canalizar vía venosa periférica.",
        "2. Sulfato de Magnesio IV: Infusión de 25 a 50 mg/kg (máximo 2 g) diluido en Solución Fisiológica a pasar en 20-30 minutos con monitoreo cardíaco y de presión arterial.",
        "3. Corticoterapia parenteral: Hidrocortisona 4-8 mg/kg IV o Metilprednisolona 1-2 mg/kg IV cada 6 horas.",
        "4. Cánula Nasal de Alto Flujo (CAFO) o VMNI (BiPAP) con PEEP baja (4-6 cmH2O) y soporte inspiratorio.",
        "5. Si paro inminente o agotamiento total: Intubación Orotraqueal de secuencia rápida con Ketamina (1-2 mg/kg) por sus propiedades broncodilatadoras + Rocuronio/Succinilcolina, con ventilación protectora a frecuencia respiratoria baja y tiempo espiratorio prolongado (evitar auto-PEEP masivo)."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Salbutamol MDI (100 mcg/puff)",
          "dose": "4 a 8 puffs cada 20 minutos durante 1 hora (o nebulizado 0.15 mg/kg, mín 2.5 mg, máx 5 mg)",
          "route": "Inhalatoria con aerocámara con válvula",
          "notes": "Fármaco de 1ª línea para relajación del músculo liso bronquial. Vigilar taquicardia e hipopotasemia."
        },
        {
          "drug": "Bromuro de Ipratropio MDI (20 mcg/puff)",
          "dose": "2 a 4 puffs cada 20 min en la primera hora (o nebulizado 250 mcg en < 20 kg / 500 mcg en > 20 kg)",
          "route": "Inhalatoria asociada a salbutamol",
          "notes": "Bloqueo colinérgico que potencia la broncodilatación en crisis moderadas-severas."
        },
        {
          "drug": "Prednisolona / Meprednisona VO",
          "dose": "1 a 2 mg/kg/día (máx 60 mg/día) durante 3-5 días",
          "route": "Vía Oral",
          "notes": "Administración oral tan eficaz como la IV si el paciente deglute y no vomita."
        },
        {
          "drug": "Hidrocortisona IV",
          "dose": "4 a 8 mg/kg bolo inicial (luego 2-4 mg/kg c/6h)",
          "route": "IV lenta",
          "notes": "Indicada si intolerancia oral, vómitos o crisis asfixiante con riesgo vital."
        },
        {
          "drug": "Sulfato de Magnesio 25%",
          "dose": "25 a 50 mg/kg (máx 2000 mg) diluido en 100 ml SF en 20-30 min",
          "route": "IV en bomba de infusión",
          "notes": "Broncodilatador por antagonismo de canales de calcio. Vigilar hipotensión y arritmias."
        },
        {
          "drug": "Salbutamol IV continuo (en UCIP)",
          "dose": "0.5 a 2 mcg/kg/min en bomba de infusión",
          "route": "IV continua",
          "notes": "En status asmático refractario a terapia inhalatoria y magnesio IV."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "\"Hora de Oro del Asma\": La respuesta a las 3 dosis de broncodilatador + corticoide en los primeros 60 minutos define el curso y la necesidad de internación en UCIP vs sala común.",
      "goldStandard": "Salbutamol + Bromuro de Ipratropio en aerosol con espaciador + Corticoide sistémico oral o IV + Sulfato de Magnesio IV en crisis severas.",
      "alternativeReperfusion": "Ventilación no invasiva (BiPAP) o infusión continua de salbutamol IV / aminofilina en UCIP.",
      "contraindications": [
        "Sedantes o ansiolíticos comunes sin control de vía aérea (deprimen el centro respiratorio y aceleran el paro).",
        "Nebulizaciones continuas con aire comprimido en lugar de oxígeno al 100% en hipoxémicos."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "Reversión y estabilización en shock room en > 80% de los pacientes; reducción del 70% de admisiones a UCIP con Sulfato de Magnesio IV temprano.",
      "survivalAt24h": "Sobrevida > 99.5% con manejo protocolizado.",
      "survivalAt7d": "Recuperación funcional respiratoria completa en 3 a 5 días con esquema de corticoide corto.",
      "survivalAt1y": "Sobrevida > 99.9%; requiere seguimiento por neumonología infantil e indicación de corticoide inhalado de mantenimiento (budesonide/fluticasona).",
      "immediateComplications": [
        "Neumotórax a tensión o neumomediastino por ruptura de bullas alveolares hiperinsufladas.",
        "Hipopotasemia sintomática con extrasístoles ventriculares por dosis masivas de salbutamol.",
        "Agotamiento diafragmático con acidosis respiratoria mixta grave."
      ],
      "mediateAndLongTermComplications": [
        "Remodelado de la vía aérea en pacientes con crisis reiteradas sin tratamiento controlador.",
        "Crisis asfícticas recurrentes de riesgo vital."
      ]
    },
    "actionCopyTemplate": "PACIENTE PEDIÁTRICO CON CRISIS ASMÁTICA SEVERA / STATUS ASMÁTICO. Edad: ___ años. Peso: ___ kg. Pulmonary Score / PRAM: ___/12. SatO2: ___% con O2. Conducta: Salbutamol + Ipratropio MDI (___ puffs c/20 min x 3 dosis) + [Meprednisona VO / Hidrocortisona EV ___ mg] + Sulfato de Magnesio EV ___ mg en 20 min. Respuesta: [Favorable / Parcial / Refractaria con requerimiento de VMNI / UCIP]."
  },
  {
    "id": "sepsis-pediatrica-shock",
    "title": "Sepsis Pediátrica y Shock Séptico (Criterios Phoenix / Algoritmo PALS)",
    "shortTitle": "Sepsis Pediátrica y Shock Séptico",
    "category": "Pediatría",
    "cie10": "A41.9 (Sepsis no especificada) / R57.2 (Shock séptico)",
    "severity": "Crítica / Código Rojo",
    "summary": "Disfunción orgánica potencialmente mortal causada por una respuesta desregulada del huésped ante una infección (Criterios Phoenix). En pediatría, el shock séptico puede presentarse como \"shock frío\" (vasoconstricción con bajo gasto, >60%) o \"shock caliente\" (vasodilatación periférica). Requiere resucitación con fluidos y antibióticos en la primera hora.",
    "prehospitalManifestations": {
      "setting": "Hogar, centro de atención primaria, vía pública o ambulancia.",
      "keySigns": [
        "Fiebre alta (> 38.5°C) o HIPOTERMIA (< 36°C, signo de extrema gravedad en lactantes y neonatos).",
        "Taquicardia severa desproporcionada a la elevación térmica o bradicardia en lactantes.",
        "Alteración del estado mental: letargia, irritabilidad inconsolable, somnolencia o desconexión del entorno.",
        "Mala perfusión periférica: Relleno capilar enlentecido > 3 segundos, extremidades frías y moteadas (livedo reticularis) con pulsos débiles (Shock Frío), O relleno capilar instantáneo en < 1 segundo (\"flash\") con pulsos saltones (Shock Caliente).",
        "Lesiones cutáneas purpúricas / petequiales de rápida aparición y progresión (sospecha de sepsis meningocócica / púrpura fulminans)."
      ],
      "highSuspicionRedFlags": [
        "Aparición de petequias o púrpuras que se extienden en minutos.",
        "Hipotensión arterial (signo TARDÍO y pre-mortem en niños; la presión se mantiene compensada hasta etapas terminales).",
        "Lactante que no fija la mirada, no sonríe y presenta quejido espiratorio o respiración acidótica de Kussmaul.",
        "Oliguria / anuria comprobada (> 4-6 horas sin pañal mojado)."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Reconocimiento rápido mediante \"Código Sepsis Pediátrico\" / Criterios Phoenix (puntaje ≥ 2 puntos de disfunción cardiovascular, respiratoria, neurológica o de coagulación).",
        "2. Medir signos vitales: FC, FR, TA, SatO2, Temperatura y Glucemia.",
        "3. Acceso Vascular Inmediato: Intentar 2 vías periféricas en < 60 segundos; SI FALLA -> COLOCAR VÍA INTRAÓSEA (IO) SIN DEMORA.",
        "4. Tomar Hemocultivos x 2, Urocultivo y muestras de foco infeccioso ANTES del antibiótico (sin demorar el inicio del antimicrobiano > 45-60 min)."
      ],
      "electrocardiogram": [
        "Taquicardia sinusal extrema. Monitoreo continuo de arritmias y signos de isquemia miocárdica en shock cardiogénico secundario."
      ],
      "biomarkersAndLabs": [
        "Lactato sérico urgente (> 2 mmol/L indica hipoperfusión tisular; > 4 mmol/L gravedad extrema).",
        "Gases en sangre: acidosis metabólica profunda con exceso de base negativo.",
        "Laboratorio completo: Hemograma (leucocitosis con desviación a la izquierda o leucopenia severa < 4.000/mm3), plaquetopenia (< 100.000), coagulograma (KPTT prolongado, RIN > 1.5, dímero D, fibrinógeno), función renal (urea/creatinina), hepatograma.",
        "Proteína C Reactiva (PCR) y Procalcitonina (PCT)."
      ],
      "differentialDiagnosis": [
        "Shock hipovolémico no infeccioso (deshidratación severa por GEA, quemaduras).",
        "Shock anafiláctico.",
        "Shock cardiogénico (miocarditis viral, arritmias congénitas, miocardiopatía dilatada).",
        "Errores congénitos del metabolismo o crisis suprarrenal congénita."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. Oxígeno al 100% por máscara con reservorio.",
        "2. Acceso venoso periférico o INTRAÓSEO (IO) tibial inmediato.",
        "3. Resucitación con fluidos: Bolo de Solución Fisiológica 0.9% o Ringer Lactato a 10-20 ml/kg a pasar en 10-20 minutos.",
        "4. Reevaluar signos de respuesta (mejoría de FC y relleno capilar) y signos de sobrecarga (crepitantes pulmonares, hepatomegalia). Repetir bolo hasta 40-60 ml/kg si no hay sobrecarga.",
        "5. Notificación inmediata de Código Sepsis al centro receptor y traslado urgente."
      ],
      "emergencyRoomShockRoom": [
        "1. Antibioticoterapia de amplio espectro en la primera hora (\"Hora de Oro\").",
        "2. Soporte Inotrópico / Vasoactivo Temprano: Si el shock persiste tras 40-60 ml/kg de cristaloides (o antes si hay disfunción miocárdica): Iniciar Adrenalina IV/IO (0.05-0.3 mcg/kg/min) en Shock Frío o Noradrenalina IV/IO (0.05-0.3 mcg/kg/min) en Shock Caliente.",
        "3. Si shock refractario a catecolaminas: Administrar Hidrocortisona en dosis de estrés por sospecha de insuficiencia suprarrenal relativa.",
        "4. Corregir hipoglucemia e hipocalcemia (el calcio es cofactor miocárdico fundamental en niños).",
        "5. Ingreso a Unidad de Cuidados Intensivos Pediátricos (UCIP)."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Solución Fisiológica 0.9% o Ringer Lactato",
          "dose": "10 a 20 ml/kg en bolo rápido (10-20 min)",
          "route": "IV / Intraósea (IO)",
          "notes": "Repetible hasta 40-60 ml/kg en la 1ª hora guiado por clínica. Suspender si hepatomegalia o rales."
        },
        {
          "drug": "Ceftriaxona",
          "dose": "100 mg/kg/día (máx 2 g) IV en 1 o 2 dosis",
          "route": "IV / IO",
          "notes": "Antibiótico empírico de 1ª línea para bacteriemia / meningitis / sepsis comunitaria."
        },
        {
          "drug": "Vancomicina",
          "dose": "15 mg/kg cada 6 horas (máx 2 g/día)",
          "route": "IV en infusión de 60 min",
          "notes": "Agregar si sospecha de SAMR, neumococo resistente o foco cutáneo/osteoarticular."
        },
        {
          "drug": "Ampicilina + Gentamicina",
          "dose": "Ampicilina 100 mg/kg c/6h + Genta 5 mg/kg c/24h",
          "route": "IV / IO",
          "notes": "Esquema empírico mandatorio en neonatos y lactantes menores de 28-60 días (cubre Listeria y GBS)."
        },
        {
          "drug": "Adrenalina (Epinefrina) en infusión continua",
          "dose": "0.05 a 0.3 mcg/kg/min en bomba",
          "route": "IV / IO periférica o central",
          "notes": "Inotrópico de elección en Shock Frío pediátrico (gasto cardíaco disminuido y vasoconstricción)."
        },
        {
          "drug": "Noradrenalina en infusión continua",
          "dose": "0.05 a 0.3 mcg/kg/min en bomba",
          "route": "IV / IO periférica o central",
          "notes": "Vasopresor de elección en Shock Caliente pediátrico (vasodilatación periférica)."
        },
        {
          "drug": "Hidrocortisona",
          "dose": "1 a 2 mg/kg cada 6 horas (máx 200 mg/día)",
          "route": "IV / IO",
          "notes": "Indicada en shock séptico refractario a catecolaminas a dosis altas."
        },
        {
          "drug": "Dextrosa al 10%",
          "dose": "2 a 5 ml/kg en bolo",
          "route": "IV / IO",
          "notes": "Tratamiento inmediato si glucemia < 60 mg/dl."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "\"Hora de Oro\": Antibióticos y fluidos en los primeros 60 minutos de reconocimiento. Cada hora de retraso en antimicrobianos incrementa la mortalidad pediátrica un 8-10%.",
      "goldStandard": "Acceso vascular/IO precoz + Expansión con cristaloides 10-20 ml/kg + Antibióticos de amplio espectro en < 60 min + Inotrópicos tempranos si shock refractario a fluidos.",
      "alternativeReperfusion": "Monitoreo invasivo de PAM y saturación venosa central de O2 (ScvO2 > 70%) en UCIP.",
      "contraindications": [
        "Sobrecarga masiva de volumen a ciegas sin reevaluación clínica continua (riesgo de edema pulmonar agudo y empeoramiento de oxigenación).",
        "Demorar el acceso vascular por insistir en punciones venosas periféricas difíciles en lugar de colocar vía intraósea."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "Reversión del shock en > 80% con resucitación guiada por metas en la primera hora.",
      "survivalAt24h": "Sobrevida a las 24 horas: 85-92% en centros con UCIP de alta complejidad.",
      "survivalAt7d": "Sobrevida a los 7 días: 80-88% en sepsis comunitaria tratada precozmente.",
      "survivalAt1y": "Sobrevida global: 80-85%. Hasta un 20-30% de los sobrevivientes de shock séptico severo presentan secuelas funcionales, cognitivas o amputaciones por necrosis periférica.",
      "immediateComplications": [
        "Coagulación Intravascular Diseminada (CID) con trombosis microvascular y sangrado masivo.",
        "Distrés Respiratorio Agudo Pediátrico (PARDS) por fuga capilar pulmonar.",
        "Falla Renal Aguda oligúrica que requiere terapia de reemplazo renal (diálisis peritoneal o hemofiltración)."
      ],
      "mediateAndLongTermComplications": [
        "Necrosis acral de dedos y extremidades por isquemia periférica que requiere amputación.",
        "Déficit neurológico o retraso en el neurodesarrollo post-encefalopatía séptica.",
        "Inmunoparálisis post-séptica con riesgo elevado de infecciones nosocomiales secundarias."
      ]
    },
    "actionCopyTemplate": "PACIENTE PEDIÁTRICO CON SOSPECHA DE SEPSIS / SHOCK SÉPTICO (CÓDIGO SEPSIS). Edad: ___ meses/años. Peso: ___ kg. Presentación: [Fiebre ___°C / Hipotermia] + Taquicardia + Relleno capilar ___ seg + [Shock frío / Shock caliente]. Conducta: Acceso [IV / IO] + Expansión SF 0.9% ___ ml (___ ml/kg) + Cultivos + Antibiótico: [Ceftriaxona ___ mg / Vancomicina ___ mg] en primera hora. [Inotrópico: Adrenalina / Noradrenalina a ___ mcg/kg/min]. Derivación inmediata a UCIP."
  },
  {
    "id": "convulsion-status-pediatrico",
    "title": "Crisis Convulsiva Febril y Status Epiléptico Pediátrico",
    "shortTitle": "Convulsión y Status Epiléptico Pediátrico",
    "category": "Pediatría",
    "cie10": "R56.0 (Convulsiones febriles) / G41.9 (Estado de mal epiléptico)",
    "severity": "Crítica / Código Rojo",
    "summary": "Emergencia neurológica definida como una crisis convulsiva continua que dura > 5 minutos (tiempo T1) o crisis repetidas sin recuperación de la conciencia entre ellas. En lactantes de 6 meses a 5 años la causa más frecuente son las convulsiones febriles, pero ante crisis prolongadas se debe actuar como status epiléptico para prevenir daño neuronal irreversible (tiempo T2 = 30 min).",
    "prehospitalManifestations": {
      "setting": "Hogar, escuela, vía pública o ambulancia.",
      "keySigns": [
        "Crisis tónico-clónica generalizada activa con movimientos involuntarios rítmicos de las 4 extremidades y rigidez.",
        "Pérdida súbita de la conciencia con desviación de la mirada conjugada (hacia arriba o lateral).",
        "Trismus mandibular, sialorrea espumosa y cianosis peribucal transitoria por apnea/espasmo de la musculatura respiratoria.",
        "Fiebre elevada en contexto de cuadro infeccioso intercurrente (en convulsión febril simple o compleja).",
        "Estado postictal prolongado con estupor profundo, hipotonía o déficit focal motor transitorio (Parálisis de Todd)."
      ],
      "highSuspicionRedFlags": [
        "Crisis que supera los 5 minutos de duración (indicación formal de tratamiento farmacológico de rescate).",
        "Crisis focal o asimétrica (movimientos que inician en un solo hemicuerpo o extremidad).",
        "Múltiples crisis en un mismo episodio (< 24 horas) sin recuperación interictal del sensorio.",
        "Lactante menor de 6 meses o niño con signos meníngeos (rigidez de nuca, fontanela abombada, petequias)."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Cronometrar la duración exacta de la crisis desde el inicio.",
        "2. Vía aérea y soporte: Posición de seguridad (decúbito lateral), aspiración suave de secreciones, O2 al 100% por máscara con reservorio. NUNCA FORZAR LA APERTURA BUCAL NI INTRODUCIR OBJETOS.",
        "3. Glucemia capilar inmediata: descartar y tratar hipoglucemia (< 60 mg/dl).",
        "4. Si la crisis dura > 5 minutos (Fase 1): Administrar Benzodiacepina de primera línea por vía no invasiva o IV.",
        "5. Si la crisis persiste > 10-15 minutos (Fase 2): Administrar anticonvulsivante de segunda línea IV."
      ],
      "electrocardiogram": [
        "Monitoreo cardíaco continuo durante la infusión de anticonvulsivantes (especialmente con fenitoína por riesgo de bradicardia y prolongación del QT)."
      ],
      "biomarkersAndLabs": [
        "Glucemia capilar, ionograma sérico (sodio, potasio, calcio iónico, magnesio).",
        "Gases en sangre: acidosis láctica transitoria post-ictal.",
        "Punción Lumbar (PL): indicada en menores de 6-12 meses con fiebre y primera crisis, sospecha de meningitis o estado postictal prolongado no aclarado tras estabilización.",
        "Tomografía computada de encéfalo (TAC): indicada ante sospecha de traumatismo de cráneo, focalidad neurológica persistente o hipertensión endocraneana."
      ],
      "differentialDiagnosis": [
        "Convulsión febril simple (generalizada, < 15 min, única en 24h, niño de 6m-5a).",
        "Meningitis bacteriana / Encefalitis viral (herpes simple, enterovirus).",
        "Intoxicación accidental (antihistamínicos, antidepresivos, monóxido de carbono, hipoglucemiantes).",
        "Síncope febril o espasmo del sollozo / crisis anóxicas reflejas."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. Garantizar permeabilidad de vía aérea y administrar O2.",
        "2. Si no hay vía venosa y la crisis dura > 5 min: Administrar MIDAZOLAM INTRANASAL (0.2 mg/kg) con dispositivo atomizador, O Midazolam Bucal (0.2 mg/kg), O DIAZEPAM RECTAL (0.5 mg/kg).",
        "3. Si hay vía venosa permeable: Diazepam IV 0.2-0.3 mg/kg lento (en 2-3 min) o Lorazepam IV 0.1 mg/kg.",
        "4. Control térmico: Paracetamol o Ibuprofeno rectal si fiebre alta y medidas físicas (desabrigar).",
        "5. Traslado urgente monitoreado."
      ],
      "emergencyRoomShockRoom": [
        "1. Si la crisis persiste a los 10-15 min tras la primera dosis de benzodiacepina: Repetir una segunda dosis de benzodiacepina.",
        "2. Si persiste a los 15-20 min: Iniciar Anticonvulsivante de Segunda Línea IV: LEVETIRACETAM IV (50-60 mg/kg en 10 min) O ÁCIDO VALPROICO IV (40 mg/kg en 10 min) O FENITOÍNA IV (20 mg/kg en 20 min).",
        "3. Si la crisis persiste > 30-40 min (Status Epiléptico Refractario - Fase 3): Intubación Orotraqueal de secuencia rápida, ventilación mecánica e inducción de coma farmacológico con infusión continua de Midazolam o Propofol en UCIP con monitoreo EEG continuo."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Midazolam Intranasal (MAD) o Bucal",
          "dose": "0.2 mg/kg (máx 10 mg)",
          "route": "Intranasal con atomizador / Mucosa bucal",
          "notes": "Fármaco y vía de 1ª elección prehospitalaria: rápida absorción transmucosa sin necesidad de vía venosa."
        },
        {
          "drug": "Diazepam Rectal",
          "dose": "0.5 mg/kg (5 mg en < 5 años / 10 mg en > 5 años)",
          "route": "Rectal con cánula",
          "notes": "Alternativa eficaz si no se dispone de midazolam intranasal."
        },
        {
          "drug": "Diazepam IV",
          "dose": "0.2 a 0.3 mg/kg (máx 10 mg) lento en 2-3 min",
          "route": "IV lenta",
          "notes": "Administrar diluido o puro en vena de buen calibre. Vigilar depresión respiratoria."
        },
        {
          "drug": "Lorazepam IV",
          "dose": "0.1 mg/kg (máx 4 mg) en 2 minutos",
          "route": "IV",
          "notes": "Benzodiacepina de elección hospitalaria por mayor duración de acción anticonvulsiva."
        },
        {
          "drug": "Levetiracetam IV",
          "dose": "40 a 60 mg/kg (máx 3000 mg) en 10-15 min diluido en SF",
          "route": "IV en infusión",
          "notes": "Anticonvulsivante de 2ª línea preferido: excelente perfil de seguridad cardiovascular y neurológica."
        },
        {
          "drug": "Ácido Valproico IV",
          "dose": "40 mg/kg (máx 3000 mg) en 10 min",
          "route": "IV en infusión",
          "notes": "Excelente opción de 2ª línea. Contraindicado en sospecha de hepatopatía o enfermedad mitocondrial."
        },
        {
          "drug": "Fenitoína (Difenilhidantoína) IV",
          "dose": "20 mg/kg (máx 1000 mg) diluido solo en SF a pasar en 20-30 min",
          "route": "IV exclusiva (NUNCA en dextrosa por precipitación)",
          "notes": "Monitoreo estricto de ECG y TA durante toda la infusión por riesgo de arritmias."
        },
        {
          "drug": "Dextrosa al 10%",
          "dose": "2 a 5 ml/kg en bolo",
          "route": "IV / IO",
          "notes": "Si glucemia < 60 mg/dl."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "T1 (5 minutos): Iniciar benzodiacepinas. T2 (30 minutos): Inicio de daño neuronal irreversible y refractariedad farmacológica si no se frena la crisis.",
      "goldStandard": "Midazolam intranasal/IV precoz (< 5 min) + Levetiracetam/Valproato IV si persiste > 15 min.",
      "alternativeReperfusion": "Anestesia general con infusión de Midazolam / Ketamina / Tiopental en UCIP.",
      "contraindications": [
        "Administrar más de 2 dosis de benzodiacepinas consecutivas en el ámbito prehospitalario sin soporte de vía aérea (riesgo crítico de paro respiratorio acumulativo).",
        "Fenitoína diluida en soluciones glucosadas (precipita inmediatamente)."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "Control de la crisis en > 90% de los pacientes tratados dentro de los primeros 15 minutos.",
      "survivalAt24h": "Sobrevida > 98% en status convulsivo febril o idiopático.",
      "survivalAt7d": "Excelente recuperación neurológica en convulsiones febriles típicas.",
      "survivalAt1y": "Sobrevida > 99%. Riesgo de epilepsia posterior en convulsión febril simple es similar a la población general (~1-2%); en convulsión febril compleja asciende al 4-10%.",
      "immediateComplications": [
        "Depresión respiratoria e hipoxemia severa post-benzodiacepinas que requiere ventilación con BVM o IOT.",
        "Broncoaspiración de contenido gástrico durante la crisis.",
        "Rabdomiólisis e hipertermia maligna en crisis continuas > 30-60 min."
      ],
      "mediateAndLongTermComplications": [
        "Daño neuronal selectivo en hipocampo y corteza temporal con esclerosis mesial temporal y epilepsia refractaria.",
        "Déficit cognitivo o conductual post-status prolongado."
      ]
    },
    "actionCopyTemplate": "PACIENTE PEDIÁTRICO CON CRISIS CONVULSIVA / STATUS EPILÉPTICO. Edad: ___ meses/años. Peso: ___ kg. Tipo de crisis: [Tónico-clónica generalizada / Focal / Febril]. Duración total: ___ minutos. Glucemia: ___ mg/dl. Conducta: O2 + Posición lateral + 1ª Línea: [Midazolam intranasal ___ mg / Diazepam EV ___ mg] a los ___ min. [2ª Línea: Levetiracetam EV ___ mg en 10 min]. Cese de crisis: [Sí / No]. Estado postictal: [En recuperación / Requiere derivación UCIP]."
  },
  {
    "id": "deshidratacion-shock-pediatrico",
    "title": "Deshidratación Grave y Shock Hipovolémico por Gastroenteritis Aguda",
    "shortTitle": "Deshidratación Grave y Shock por Diarrea",
    "category": "Pediatría",
    "cie10": "E86.0 (Deshidratación) / A09 (Gastroenteritis aguda)",
    "severity": "Crítica / Código Rojo",
    "summary": "Pérdida crítica de agua y electrolitos secundaria a diarrea aguda y vómitos profusos, con déficit ponderal > 10% y colapso circulatorio. Constituye una de las principales causas de morbimortalidad infantil prevenible en el mundo. Requiere rescate volumétrico rápido con cristaloides isotónicos.",
    "prehospitalManifestations": {
      "setting": "Hogar, sala de primeros auxilios o ambulancia.",
      "keySigns": [
        "Historia de diarrea líquida profusa (\"en agua de arroz\" o de alta frecuencia > 5-10/día) y vómitos incoercibles.",
        "Signo del pliegue cutáneo marcadamente pastoso: el pliegue pellizcado en el abdomen tarda > 2 segundos en desaparecer (\"signo del lienzo húmedo\").",
        "Ojos profundamente hundidos, mucosas yugales y lengua secas como papel de lija, y llanto totalmente sin lágrimas.",
        "Fontanela anterior marcadamente deprimida / hundida en lactantes.",
        "Compromiso circulatorio / shock hipovolémico: pulso radial filiforme o no palpable, taquicardia extrema, extremidades frías, relleno capilar > 3 segundos y anuria comprobada > 6-8 horas."
      ],
      "highSuspicionRedFlags": [
        "Lactante letárgico, comatoso o que no responde a los estímulos de los padres.",
        "Respiración profunda y rápida sin sibilancias (respiración acidótica de Kussmaul por acidosis metabólica severa).",
        "Convulsiones en contexto de deshidratación hipernatrémica (Na+ > 150 mEq/L) o hiponatrémica severa (Na+ < 120 mEq/L).",
        "Llenado capilar > 4 segundos con frialdad hasta codos y rodillas."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Evaluar grado de deshidratación según criterios clínicos de la OMS / AEPED: Leve (< 5%), Moderada (5-10%), Grave con Shock (> 10%).",
        "2. Medir peso exacto o estimar según edad si no se dispone de balanza: [Edad en años + 4] x 2.",
        "3. Evaluar sensorio, patrón ventilatorio, pulsos periféricos y centrales, presión arterial y temperatura diferencial.",
        "4. Distinguir si el paciente está en Shock Hipovolémico (Fase de rescate urgente) o Deshidratación grave sin shock (Plan de rehidratación rápida EV o Plan B de SRO)."
      ],
      "electrocardiogram": [
        "Taquicardia sinusal. Monitorear alteraciones del potasio: Ondas T aplanadas y onda U prominente en hipopotasemia; ondas T picudas y simétricas con QRS ancho en hiperpotasemia por anuria."
      ],
      "biomarkersAndLabs": [
        "Ionograma sérico urgente: Na+, K+, Cl- (fundamental para clasificar en deshidratación Isonatrémica 135-145 mEq/L, Hiponatrémica < 130 mEq/L o Hipernatrémica > 150 mEq/L).",
        "Estado Ácido-Base (EAB): evaluar pH, bicarbonato y exceso de base (acidosis metabólica con anión gap aumentado).",
        "Función renal: Urea y Creatinina (diferenciar insuficiencia renal prerrenal por hipovolemia vs daño parenquimatoso intrínseco).",
        "Glucemia y Densidad urinaria."
      ],
      "differentialDiagnosis": [
        "Cetoacidosis diabética de debut (hiperglucemia, polidipsia/poliuria previa, aliento cetónico, dolor abdominal).",
        "Sepsis grave / Shock séptico con foco gastrointestinal o peritonitis.",
        "Invaginación intestinal o abdomen agudo obstructivo (heces en \"jalea de grosella\", vómitos biliares).",
        "Insuficiencia suprarrenal aguda (crisis addisoniana / hiperplasia suprarrenal congénita con hiponatremia e hiperpotasemia)."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. Si el paciente presenta signos de SHOCK HIPOVOLÉMICO: Canalizar vía venosa periférica o COLOCAR VÍA INTRAÓSEA (IO) TIBIAL INMEDIATA.",
        "2. Administrar BOLO DE RESCATE con Solución Fisiológica 0.9% o Ringer Lactato: 20 ml/kg IV/IO en 15 a 20 minutos.",
        "3. Si no hay shock y el paciente deglute sin vómitos incoercibles: Iniciar Sales de Rehidratación Oral (SRO fórmula OMS) a tomas pequeñas con jeringa/cuchara (5 ml cada 2-3 min).",
        "4. Mantener abrigado para evitar hipotermia durante la reposición de fluidos.",
        "5. Traslado urgente."
      ],
      "emergencyRoomShockRoom": [
        "1. Fase 1 - Rescate de Shock: Si el shock persiste tras el primer bolo, repetir un 2° o 3° bolo de SF 0.9% a 20 ml/kg hasta recuperar pulsos periféricos y relleno capilar < 2 s (máx 60 ml/kg).",
        "2. Fase 2 - Rehidratación Rápida Parenteral (Plan OMS/SAP): 100 ml/kg de Solución Polielectrolítica o SF 0.9% con glucosado:\n   - Lactantes < 12 meses: 30 ml/kg en 1 hora + 70 ml/kg en 5 horas.\n   - Niños > 12 meses: 30 ml/kg en 30 minutos + 70 ml/kg en 2.5 horas.",
        "3. Control de Vómitos: Ondansetrón 0.15 mg/kg VO/IV dosis única si los vómitos impiden el pasaje a SRO.",
        "4. Pasaje precoz a Vía Oral: En cuanto el paciente recupere la conciencia y se estabilice hemodinámicamente, iniciar SRO por boca y reiniciar lactancia materna / alimentación habitual."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Solución Fisiológica 0.9% o Ringer Lactato",
          "dose": "20 ml/kg en bolo rápido (15-20 min)",
          "route": "IV / Intraósea (IO)",
          "notes": "Expansión isotónica obligatoria para restaurar la volemia eficaz y revertir el shock."
        },
        {
          "drug": "Ondansetrón",
          "dose": "0.15 mg/kg (máx 8 mg) dosis única",
          "route": "Vía Oral / IV lenta",
          "notes": "Antiemético de elección: reduce significativamente el fracaso de la rehidratación oral y la necesidad de internación."
        },
        {
          "drug": "Sales de Rehidratación Oral (SRO OMS baja osmolaridad)",
          "dose": "50 a 100 ml/kg en 4 horas (Plan B)",
          "route": "Vía Oral fraccionada con jeringa o cuchara",
          "notes": "Terapia de elección estándar para deshidratación moderada y mantenimiento."
        },
        {
          "drug": "Sulfato de Zinc",
          "dose": "10 mg/día (< 6 meses) o 20 mg/día (> 6 meses) durante 14 días",
          "route": "Vía Oral",
          "notes": "Recomendación OMS para acortar la duración de la diarrea y prevenir nuevos episodios en los meses siguientes."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "Reversión del shock en < 30 a 60 minutos para evitar necrosis tubular aguda renal, trombosis venosa de la vena renal y fallo multiorgánico.",
      "goldStandard": "Bolo de cristaloides isotónicos 20 ml/kg para shock + Transición inmediata a Sales de Rehidratación Oral (SRO) de baja osmolaridad.",
      "alternativeReperfusion": "Rehidratación por gastroclisis (SRO infundida por sonda nasogástrica a 20 ml/kg/h) si no hay accesos venosos y el shock ha sido compensado.",
      "contraindications": [
        "Soluciones hipotónicas sin sodio (como Dextrosa 5% pura) en bolo rápido de rescate (provoca hiponatremia dilucional aguda y edema cerebral convulsivo).",
        "Antidiarreicos / Antiespasmódicos / Loperamida en niños (contraindicados por riesgo de íleo paralítico, megacolon tóxico y letargia)."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "Reversión completa del shock y recuperación de la diuresis en > 95% con terapia de fluidos reglada.",
      "survivalAt24h": "Sobrevida > 99.8% con protocolo de rehidratación oral/parenteral.",
      "survivalAt7d": "Resolución de la gastroenteritis en 3 a 5 días.",
      "survivalAt1y": "Sobrevida > 99.9% sin secuelas orgánicas.",
      "immediateComplications": [
        "Insuficiencia Renal Aguda prerrenal o necrosis tubular aguda por hipoperfusión prolongada.",
        "Edema cerebral o mielinólisis póntica por corrección excesivamente rápida de deshidratación hipernatrémica (> 0.5 mEq/L/hora).",
        "Acidosis metabólica refractaria con hipopotasemia severa."
      ],
      "mediateAndLongTermComplications": [
        "Desnutrición aguda secundaria por suspensión indebida de la alimentación.",
        "Intolerancia transitoria a la lactosa secundaria al daño del ribete en cepillo del enterocito."
      ]
    },
    "actionCopyTemplate": "PACIENTE PEDIÁTRICO CON DESHIDRATACIÓN GRAVE / SHOCK HIPOVOLÉMICO POR GEA. Edad: ___ meses/años. Peso: ___ kg. Grado de deshidratación: > 10% (Grave con Shock). Signos: Pliegue pastoso > 2s + Ojos hundidos + Taquicardia + Relleno capilar ___ s + Anuria. Conducta: Acceso [IV / IO] + Expansión con SF 0.9% 20 ml/kg (___ ml) en 20 min. Reevaluación: [Pulsos presentes / Requiere 2° bolo]. Pase a Plan de rehidratación rápida EV y SRO."
  },
  {
    "id": "anafilaxia-pediatrica",
    "title": "Anafilaxia Pediátrica y Shock Anafiláctico",
    "shortTitle": "Anafilaxia Pediátrica / Shock Alérgico",
    "category": "Pediatría",
    "cie10": "T78.2 (Shock anafiláctico) / T78.0 (Anafilaxia por alimentos)",
    "severity": "Crítica / Código Rojo",
    "summary": "Reacción alérgica multisistémica grave, aguda y potencialmente mortal que afecta predominantemente la vía aérea, la respiración o la circulación tras la exposición a un alérgeno (alimentos como leche/huevo/maní, picaduras de himenópteros, medicamentos o látex). La ADRENALINA INTRAMUSCULAR INMEDIATA es el único tratamiento salvavidas de primera línea.",
    "prehospitalManifestations": {
      "setting": "Hogar, fiesta infantil, comedor escolar, vía pública o ambulancia.",
      "keySigns": [
        "Compromiso cutáneo-mucoso agudo de rápida evolución (en minutos): Urticaria generalizada con habones pruriginosos, eritema difuso y angioedema de párpados, labios, lengua o úvula.",
        "Compromiso respiratorio: Estridor laríngeo, disfonía / voz ronca, broncoespasmo severo con sibilancias espiratorias, tos perruna paroxística o sensación de \"cierre de garganta\".",
        "Compromiso hemodinámico / cardiovascular: Hipotensión arterial para la edad, síncope, mareos intensos, palidez súbita, diaforesis, hipotonía y colapso circulatorio.",
        "Síntomas gastrointestinales súbitos: Dolor abdominal cólico intenso, náuseas, vómitos repetidos en chorro o diarrea líquida inmediata tras ingesta del alérgeno.",
        "Lactantes: Irritabilidad extrema súbita, llanto inconsolable con somnolencia posterior, regurgitación masiva y letargia con hipotonía."
      ],
      "highSuspicionRedFlags": [
        "Disfonía progresiva o estridor tras picadura de abeja/avispa o ingesta de alimento sospechoso.",
        "Hipotensión arterial o colapso hemodinámico tras administración de antibióticos (betalactámicos) o vacunas.",
        "Antecedente de anafilaxia previa o asma mal controlada (mayor riesgo de asfixia fatal).",
        "Retraso en la administración de adrenalina > 10 minutos desde el inicio de los síntomas sistémicos."
      ]
    },
    "diagnosticAlgorithm": {
      "initialSteps": [
        "1. Reconocimiento clínico inmediato según criterios de la World Allergy Organization (WAO): Reacción de inicio rápido (minutos a horas) con afectación de piel/mucosas + al menos UN síntoma respiratorio O cardiovascular O gastrointestinal severo; O compromiso respiratorio/cardiovascular aislado tras exposición a alérgeno conocido.",
        "2. NO DEMORAR EL TRATAMIENTO con pruebas de laboratorio ni esperas observacionales: el diagnóstico es 100% clínico.",
        "3. Suspender inmediatamente la exposición al alérgeno desencadenante (detener infusión de fármaco, retirar aguijón raspando sin comprimir el saco de veneno).",
        "4. Posición del paciente: Decúbito supino con elevación de miembros inferiores a 45° (posición de Trendelenburg o de shock). ¡NUNCA PONER AL NIÑO DE PIE NI SENTARLO BRUSCAMENTE! (riesgo de síndrome de la vena cava vacía y paro cardíaco fulminante). Si vomita, colocar en decúbito lateral."
      ],
      "electrocardiogram": [
        "Taquicardia sinusal compensadora. En shock severo: aplanamiento de onda T, infradesnivel del ST por hipoperfusión coronaria o arritmias ventriculares."
      ],
      "biomarkersAndLabs": [
        "No se requieren para la urgencia. En etapa post-estabilización: Triptasa sérica total (tomar muestra entre 30 min y 2 horas del inicio; confirma activación de mastocitos)."
      ],
      "differentialDiagnosis": [
        "Crisis asmática aislada sin componente alérgico cutáneo/gastrointestinal.",
        "Obstrucción de vía aérea por cuerpo extraño (sin urticaria/angioedema).",
        "Síncope vasovagal (bradicardia, palidez sin urticaria ni broncoespasmo; recuperación rápida al acostar al paciente).",
        "Laringitis aguda viral (Crup) o epiglotitis.",
        "Urticaria aguda aislada sin compromiso respiratorio ni hemodinámico."
      ]
    },
    "management": {
      "prehospitalAmbulance": [
        "1. ADRENALINA INTRAMUSCULAR INMEDIATA: 0.01 mg/kg (0.01 ml/kg de ampolla 1:1000 sin diluir) en el tercio medio de la cara anterolateral del muslo (vasto lateral). Máx 0.3 mg en niños < 30 kg; máx 0.5 mg en adolescentes/adultos > 30 kg.",
        "2. Oxígeno al 100% por máscara con reservorio a 10-15 L/min.",
        "3. Posición supina con piernas elevadas.",
        "4. Si no hay mejoría clínica a los 5-15 minutos: REPETIR UNA SEGUNDA DOSIS DE ADRENALINA IM en el otro muslo.",
        "5. Canalizar vía venosa periférica o IO: Administrar bolo de SF 0.9% 10-20 ml/kg si hay hipotensión o mala perfusión.",
        "6. Traslado urgente monitoreado."
      ],
      "emergencyRoomShockRoom": [
        "1. Si el shock o el broncoespasmo persisten tras 2 dosis de Adrenalina IM: Iniciar infusión continua de ADRENALINA IV (0.05 a 0.3 mcg/kg/min) en bomba de infusión.",
        "2. Manejo avanzado de la vía aérea: Si hay estridor progresivo por angioedema de glotis, intubación orotraqueal PRECOZ por el operador más experimentado antes de que el edema cierre totalmente la luz laríngea.",
        "3. Fármacos de Segunda Línea (coadyuvantes para piel y prevención de bifásica): Antihistamínicos H1 (Difenhidramina 1 mg/kg IV) + Corticoides sistémicos (Hidrocortisona 5-10 mg/kg IV o Metilprednisolona 1-2 mg/kg IV) + Salbutamol inhalado para broncoespasmo.",
        "4. Observación hospitalaria obligatoria: Mínimo 6 a 12 horas (o hasta 24h en shock severo) por riesgo de Reacción Bifásica (reaparición de síntomas anafilácticos sin nueva exposición al alérgeno en hasta un 15-20% de los pacientes)."
      ],
      "initialPharmacotherapy": [
        {
          "drug": "Adrenalina (Epinefrina) 1:1000 (1 mg/ml sin diluir)",
          "dose": "0.01 mg/kg (0.01 ml/kg). Máx: 0.3 mg (< 30 kg) / 0.5 mg (> 30 kg)",
          "route": "Intramuscular profunda en cara anterolateral del muslo",
          "notes": "FÁRMACO SALVAVIDAS DE 1ª LÍNEA. Administrar de inmediato. Repetir cada 5-15 min si respuesta insuficiente."
        },
        {
          "drug": "Solución Fisiológica 0.9%",
          "dose": "10 a 20 ml/kg en bolo rápido",
          "route": "IV / Intraósea (IO)",
          "notes": "En hipotensión o colapso circulatorio. Puede repetirse hasta 40 ml/kg."
        },
        {
          "drug": "Difenhidramina (Antihistamínico H1)",
          "dose": "1 mg/kg (máx 50 mg)",
          "route": "IV lenta / IM",
          "notes": "Fármaco de 2ª línea: alivia el prurito y la urticaria. NO revierte la obstrucción de vía aérea ni el shock."
        },
        {
          "drug": "Hidrocortisona IV",
          "dose": "5 a 10 mg/kg (máx 200 mg)",
          "route": "IV lenta",
          "notes": "Fármaco de 2ª línea: inicio de acción tardío (4-6h); ayuda a prevenir reacciones bifásicas tardías."
        },
        {
          "drug": "Metilprednisolona IV",
          "dose": "1 a 2 mg/kg (máx 60 mg)",
          "route": "IV lenta",
          "notes": "Alternativa glucocorticoide a la hidrocortisona."
        },
        {
          "drug": "Salbutamol MDI con aerocámara",
          "dose": "4 a 8 puffs",
          "route": "Inhalatoria",
          "notes": "Tratamiento coadyuvante si persisten sibilancias y broncoespasmo tras la adrenalina."
        },
        {
          "drug": "Adrenalina en infusión continua IV",
          "dose": "0.05 a 0.3 mcg/kg/min en bomba",
          "route": "IV / IO continua",
          "notes": "Indicada en shock anafiláctico refractario a dosis repetidas de adrenalina IM."
        }
      ]
    },
    "therapeuticWindow": {
      "timeframe": "TIEMPO CRÍTICO: Adrenalina IM en los primeros 5 a 10 minutos de inicio del cuadro. El retraso en la administración de adrenalina es la causa principal de muerte por anafilaxia.",
      "goldStandard": "Adrenalina 0.01 mg/kg IM en cara anterolateral del muslo + Posición supina con miembros elevados + Expansión con SF 0.9% en shock.",
      "alternativeReperfusion": "Adrenalina en infusión IV continua + Intubación endotraqueal precoz o cricotiroidotomía quirúrgica si obstrucción glótica total.",
      "contraindications": [
        "NO EXISTEN CONTRAINDICACIONES ABSOLUTAS para la administración de adrenalina en una anafilaxia activa.",
        "Nunca usar adrenalina subcutánea (absorción lenta y errática) ni adrenalina IV en bolo directo sin diluir (riesgo de arritmias ventriculares y hemorragia cerebral)."
      ]
    },
    "evidenceAndPrognosis": {
      "survivalAt6h": "Sobrevida > 99% cuando la adrenalina se administra dentro de los primeros 10-15 minutos.",
      "survivalAt24h": "Sobrevida > 99.8% tras período de observación para vigilar reacción bifásica.",
      "survivalAt7d": "Recuperación completa sin secuelas orgánicas.",
      "survivalAt1y": "Excelente pronóstico vital; indicación mandatoria de prescripción y entrenamiento familiar en el uso de autoinyector de adrenalina (EpiPen / Jext).",
      "immediateComplications": [
        "Asfixia por edema de glotis y laringoespasmo refractario.",
        "Paro cardiorrespiratorio hipóxico o por colapso circulatorio distributivo.",
        "Reacción anafiláctica bifásica en las primeras 4 a 12 horas."
      ],
      "mediateAndLongTermComplications": [
        "Encefalopatía anóxica en caso de parada respiratoria prolongada antes de recibir adrenalina.",
        "Ansiedad y fobia alimentaria familiar post-evento grave (requiere apoyo psicológico y alergológico)."
      ]
    },
    "actionCopyTemplate": "PACIENTE PEDIÁTRICO CON ANAFILAXIA / SHOCK ANAFILÁCTICO. Edad: ___ años. Peso: ___ kg. Alérgeno sospechoso: [Alimento / Fármaco / Picadura / Desconocido]. Compromiso: [Urticaria generalizada + Angioedema + Estridor / Broncoespasmo / Hipotensión / Vómitos]. Conducta INMEDIATA: Adrenalina IM (1:1000) 0.01 mg/kg = ___ mg en cara anterolateral del muslo a las ___ hs. Posición supina con miembros elevados + O2 100% + [SF 0.9% ___ ml EV]. Fármacos 2ª línea: [Difenhidramina ___ mg + Hidrocortisona ___ mg EV]. Respuesta: [Favorable / Requiere 2ª dosis adrenalina a los 10 min]. Paciente en observación estricta por 6-12h."
  }
];
