export interface ClinicalProtocol {
  id: string
  title: string
  shortTitle: string
  category: 'Cardiovascular' | 'Neurológico' | 'Respiratorio' | 'Trauma' | 'Infeccioso / Shock' | 'Inmunológico / Alergia' | 'Metabólico' | 'Toxicología'
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
  }
]
