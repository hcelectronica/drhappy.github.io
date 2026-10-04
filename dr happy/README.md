# Dr Happy - Modelo de Historia Clínica Digital

Web app base en React + TypeScript para:
- Login de profesionales.
- Gestión de pacientes y fichas clínicas.
- Adjuntos (imágenes, PDF, DOCX).
- Registro de atenciones con fecha, reflexión profesional y firma digital.
- Importación masiva de padrón desde Excel.
- Comunidad médica con mensajería privada asíncrona.

## Identidad visual

El modelo 08 (monograma Dr. H con sonrisa, sin caduceo) es la identidad principal. `public/brand-mark.svg` es el original vectorial; `BrandMark` muestra su copia `public/favicon.svg` en el acceso, la cabecera y la bienvenida. Los iconos PNG de 192/512 px, el icono maskable y el Apple touch icon usan el mismo diseño. La variante maskable deja el monograma dentro de la zona segura central para recortes circulares.

Las referencias de instalación llevan la versión `drh-08` para renovar los iconos sin cambiar el nombre, el inicio ni el ámbito de la PWA. El navegador puede actualizar una instalación existente, pero no se garantiza una renovación inmediata del icono del sistema; si permanece el anterior, volver a añadir el acceso o reinstalar la PWA. Esto no borra la cuenta ni sus datos en la nube. No borrar los datos del sitio.

El inicio público ofrece «Instalar app» en celulares sin exigir una sesión. Si el navegador emite `beforeinstallprompt`, el botón abre su diálogo nativo; de lo contrario muestra instrucciones (Safari y Compartir en iPhone/iPad, menú de instalación en Android). El aviso automático se puede posponer siete días, pero el botón público sigue disponible. No se ofrece al abrir la PWA en modo standalone ni después de una instalación confirmada en esa visita. No es posible instalar sin confirmación del usuario ni detectar todos los accesos directos instalados desde una pestaña del navegador.

## Carga del inicio público

El título SEO y las vistas previas al compartir usan «Dr Happy | Historia clínica digital y Turnos», sin restringir la marca a odontología. La descripción incluye odontograma, turnos, Sofía IA y la prueba de 7 días. Google puede elegir otro título o fragmento y necesita volver a rastrear la portada para reflejar los cambios.

Los primeros flyers son Atención médica (para médicos), Odontograma, Turnera y Ambulancia; Sofía y las demás herramientas continúan debajo. El flyer dental reproduce una demostración ilustrativa de 12 segundos al pasar el mouse o tocarlo: cursor, selección de la pieza 36, ampliación y marcas por superficie en rojo y azul. La demostración ocupa el recuadro completo sin cambiar su tamaño, abrir ventanas, consultar pacientes ni guardar datos. Al retirar el mouse, perder el foco o presionar Escape vuelve la promoción; otro toque reinicia la secuencia. Esta demostración activada por el visitante reproduce la secuencia completa incluso con «reducir movimiento»; las demás animaciones de la app conservan esa preferencia.

El acceso comienza plegado en «Iniciar sesión» y despliega el formulario al tocarlo. Recuperación y confirmación de email se muestran automáticamente cuando corresponden. «Crear usuario» abre todos los campos del registro en dos columnas, sin scroll interno del formulario; el fondo del modal admite desplazamiento únicamente si la pantalla o el teclado reducen el espacio disponible. El envío sigue usando el circuito de confirmación por código de email.

La cabecera pública muestra el logo, el nombre y el eslogan. En móvil se usa una composición horizontal compacta; la instalación se ofrece en una tarjeta fija superior, cerrable durante la visita, sin un modal automático antes del login. «Más opciones» conserva instalación, compartir y soporte. El login móvil coloca usuario y contraseña uno debajo del otro, con «Iniciar sesión» y «Google» juntos en una fila de botones compactos (área táctil mínima de 44 px), y evita repetir la marca de la cabecera. Google conserva el nombre accesible «Iniciar sesión con Google». Los formularios de registro, recuperación y confirmación de email mantienen sus funciones.

El inicio muestra la oferta y el formulario de acceso sin la espera de la bienvenida animada. La restauración de una sesión guardada sigue validando la identidad antes de mostrar el espacio clínico. Diagnósticos, vademécum y noticias se cargan solo con un profesional autenticado; el catálogo CIE-10 empaquetado se importa bajo demanda, sin consultar un archivo público inexistente. Los lectores DOCX, PDF y de códigos se importan al usar esas herramientas. Estos cambios reducen la carga inicial, pero no garantizan la aprobación de Google Ads.

Validar con `npm run build` y `node tests/mobile-session.browser.mjs` contra el servidor local (`TEST_APP_ORIGIN` permite probar el build). La prueba comprueba cargas clínicas tras restaurar sesión y su ausencia al volver al inicio público.

## Documentos clínicos

Desde la ficha del paciente, **Emitir certificado** permite elegir entre un certificado médico y una orden de estudios complementarios. En la orden se busca entre estudios frecuentes codificados o se agrega uno en texto libre; el profesional debe indicar el motivo clínico, puede añadir observaciones y revisar el borrador antes de emitir. Si el contenido no cabe en el PDF, se informa el error antes de guardar la orden. Ambos documentos se guardan en la historia clínica con firma, PDF y QR; las órdenes se identifican como tales en el historial, la descarga y el envío.

La selección de `src/studyCatalog.ts` contiene procedimientos activos cuyos códigos y términos preferidos en español se verificaron en [Snowstorm Test del Ministerio de Salud](https://snowstorm-test.msal.gob.ar/swagger-ui.html) (rama MAIN). **No es el catálogo completo ni una certificación de pertenencia a la Extensión Argentina de SNOMED CT**. El texto libre no se codifica. Para incorporar una edición argentina completa se requiere acceso a su distribución/licencia o un servidor de terminología configurado para esa edición.

### Ficha en papel

En la ficha del paciente (también al crearlo), **📷 Subir ficha papel** adjunta fotos o PDF de la historia clínica en papel. Las fotos se reducen a JPEG (lado mayor de 1800 px) y los PDF admiten hasta 6 MB. En un paciente ya guardado se guardan al instante; en un paciente nuevo o con la ficha en edición, al tocar «Guardar ficha».

**✨ Transcribir con Sofía** usa el modo `paper-record-transcription` de `ai-assistant` (sin herramientas, hasta 4000 tokens de salida) y consume una consulta de Sofía. La transcripción es literal, marca lo dudoso como `[ilegible]` o `[¿palabra?]` y no agrega diagnósticos. El profesional la revisa y edita antes de guardarla. Si Sofía responde que la ficha es ilegible, queda guardada solo como foto. Las fichas y sus transcripciones se ven en la vista clínica y se incluyen en la impresión de la historia.

## Turneras y pacientes

Los horarios de consultorio (turnos manuales), la turnera gratuita y la turnera particular se configuran por separado; ninguna impone un límite horario a las otras. El cupo de una reserva pública se libera al cancelar el turno desde la agenda, incluso para los enlaces de turnos antiguos. La cancelación y la confirmación tardía de pagos se coordinan en la base de datos mediante `20261002010000_cancel_public_booking_appointment.sql`; aplicar esa migración antes de desplegar `public-booking` y `mercadopago-patient-webhook`.

Para médicos y psicólogos, un turno gratuito no crea una ficha clínica hasta que el profesional lo atiende. Para odontólogos, las reservas pendientes crean una ficha dental provisoria cuando se sincroniza su espacio de trabajo. «Atender» permite completar la ficha antes de la fecha del turno. Las fichas y los turnos se vinculan únicamente por DNI o por un ID de ficha ya vinculado y coherente con el DNI; compartir nombre, email o teléfono no identifica a un paciente. Si se cancela el selector nativo de compartir, no se abre WhatsApp automáticamente.

## Suscripciones, Sofía y recordatorios

### Notificaciones por email

Los envíos usan `send-email` y requieren SMTP configurado en Supabase. La presencia de una función en el código no confirma su despliegue, la ejecución del cron ni la llegada a la bandeja de entrada.

El aviso administrativo de alta incluye nombre, contacto, usuario, especialidad, matrícula, ID y origen, sin contraseña ni DNI. El destinatario es fijo en el servidor. Si falla SMTP, el alta se conserva, se registra el fallo y la respuesta incluye `adminEmailSent: false`; no hay reintento automático ni envío en cada login. Desplegar `auth-professional` y `auth-email-verification` con `_shared/adminRegistrationEmail.ts`, preservando sus valores JWT. No requiere migración ni frontend. Validar con `node --test tests/admin-registration-email.test.mjs` y `deno check` de ambos handlers.

| Acción | Destinatario | Condición |
| --- | --- | --- |
| Registro profesional | Profesional | Bienvenida al completar el alta; verificación de dirección solo si `VITE_ENABLE_EMAIL_VERIFICATION=true`. |
| Nuevo profesional | Administración (`alan.moodie@hotmail.com`) | Aviso servidor después de crear una cuenta por formulario, Google o formulario con verificación pendiente. No se repite por login, reenvío de código o confirmación. |
| Recuperación / cambio de contraseña | Profesional | Solicitud de recuperación o cambio completado. |
| Comunicado administrativo | Profesionales seleccionados | Envío manual desde administración. |
| Turno manual | Paciente | Email válido y opción de enviar confirmación seleccionada; también disponible el reenvío manual. |
| Reserva pública gratuita | Paciente | Confirmación al reservar; la particular envía instrucciones de pago y confirma al aprobar Mercado Pago. |
| Recordatorio de turno | Paciente | Cron nocturno a las 22:00 de Argentina, para turnos válidos del día siguiente. |
| Acciones de Sofía | Paciente | Confirmación, cancelación, reprogramación, aviso de pago o recordatorio solicitado, según la acción y disponibilidad de email. |
| Saldo pendiente | Paciente | Recordatorio manual desde balance o solicitado a Sofía. |
| Certificado / orden | Destinatario elegido por el profesional | Envío manual del documento emitido. |
| Baja de cuenta | Profesional | Archivo legal, según el recorrido de eliminación. |
| Registro por invitación | Profesional | Nuevo envío real guardado mediante «Invitar paciente», sin crear un turno. |
| Reserva por link de turnera | Profesional | Reserva guardada desde agenda pública gratuita/particular o enlace antiguo de turnos libres. |

Los dos últimos avisos se generan en el servidor, aunque la app del profesional esté cerrada. El asunto distingue «Nuevo registro por invitación» de «Nueva solicitud de turno por turnera». Incluyen origen, nombre y contacto; las reservas agregan fecha, hora, lugar y estado. Una particular pendiente de pago nunca se anuncia como confirmada. No se afirma que sea una persona nueva en la base: un paciente existente también puede usar los links. No se envían datos clínicos, DNI ni fecha de nacimiento.

El destinatario se consulta en el perfil guardado del profesional y, si no tiene dirección, en su cuenta; no se toma del formulario público. Los avisos se ejecutan después del guardado, no al abrir un link ni al importar la ficha. Si falla el envío, la respuesta informa `professionalEmailSent: false` y se registra el error con el identificador del evento, sin perder el registro ni inducir al paciente a reservar de nuevo. No hay reintentos automáticos ni garantía de recepción SMTP. El aviso inicial de una particular informa que falta pagar; no se agrega un segundo aviso al profesional desde el webhook de pago.

Para activar estos avisos, desplegar `patient-invite` y `public-booking` con su helper compartido. Mantienen `verify_jwt=false`: las acciones públicas validan el enlace y las privadas validan la sesión profesional dentro de la función. No requiere migraciones ni cambios en el frontend ni en las credenciales SMTP existentes. Validar con `node --test tests/professional-registration-email.test.mjs tests/registration-handlers.test.mjs tests/nightly-reminder.test.mjs` y `deno check --node-modules-dir=none supabase/functions/patient-invite/index.ts supabase/functions/public-booking/index.ts`. Las pruebas de handlers cubren invitaciones guardadas/rechazadas, bots, turnera gratuita, particular pendiente de pago, enlaces antiguos y fallos de correo sin perder las reservas.

Todos los planes pagos habilitan las mismas herramientas: 30 días ($15.000), 180 días ($78.000) o 365 días ($120.000). «Suscripción activa» abre «Mi suscripción» con el último período comprado, vencimiento, consumo de Sofía e historial de pagos. Una nueva compra suma días al vencimiento vigente; un pago de Mercado Pago se aplica una sola vez. Las activaciones administrativas anteriores pueden no tener una compra identificada.

Sofía incluye 100 consultas por mes calendario de Argentina en cualquier plan pago y 3 consultas en total durante la prueba de 7 días. Comprar más tiempo no reinicia el cupo. Una pregunta con varias llamadas internas cuenta como una consulta; confirmar una acción pendiente no consume otra pregunta. Las solicitudes concurrentes reservan cupo en la base antes de invocar la IA. Los fallos sin tokens registrados liberan la reserva; las solicitudes que ya consumieron tokens cuentan y conservan su consumo. Los tokens de entrada/salida se muestran como información, no como un límite adicional.

Los recordatorios automáticos se ejecutan una vez por día a las 22:00 de Argentina (01:00 UTC), para los turnos del día siguiente. No se envían recordatorios de 24 ni de 2 horas. Se excluyen cancelados, atendidos, pendientes de confirmación y reservas creadas después del corte. Los envíos se registran fuera de la agenda; un envío con resultado incierto no se reintenta automáticamente para evitar duplicados y requiere revisión. Un correo aceptado por SMTP no garantiza su llegada a la bandeja de entrada.

Aplicar `20261003010000_subscription_account_and_nightly_reminders.sql` y desplegar `subscription-account`, `mercadopago-webhook`, `ai-assistant` y `send-appointment-reminders`. La migración reemplaza la tarea de cinco minutos por el envío nocturno. El webhook debe aceptar notificaciones sin JWT de Mercado Pago; valida cada pago consultando al proveedor. Los precios del checkout siguen configurados en los secrets `MP_*_PRICE_ARS`.

## Ficha odontológica

Los profesionales con especialidad odontológica acceden a una ficha de dos caras en lugar del formulario médico extenso. El anverso contiene los datos básicos, odontograma FDI permanente y temporal, registros por superficie, referencias y observaciones. El reverso reúne tratamientos, presupuesto al paciente, costo interno y cuenta con debe/haber/saldo. El giro permite cambiar de cara sin salir del paciente, con una transición 3D de 0,8 segundos tanto desde las pestañas como desde el botón «Girar». Si el dispositivo solicita movimiento reducido, el cambio es inmediato.

En celulares (hasta 600 px), el odontograma completo entra en el ancho disponible. Tocarlo abre una ampliación centrada en la zona elegida; allí se selecciona la pieza y se vuelve al mismo editor individual. No se divide en cuadrantes ni se modifica el registro clínico. El botón de giro se muestra arriba. En el reverso, las mismas filas de tratamientos y movimientos se presentan como tarjetas verticales con etiquetas explícitas, manteniendo las acciones y los importes. La presentación de escritorio no cambia.

La cara inactiva no extiende el scroll de la ficha móvil; se conserva el espacio inferior necesario para la navegación. La impresión también está disponible en la barra de acciones de escritorio. El listado público de herramientas presenta el odontograma con un ícono dental y explica sus registros por superficie, finanzas integradas, uso móvil y PDF a color.

Las demás tarjetas públicas incluyen ilustraciones SVG propias, con el mismo estilo de trazo y color: ambulancia, estetoscopio, calendario, historia clínica, certificado, invitación, libro clínico y balance. En celulares pequeños se reorganizan para no superponerse al texto. Sofía y Mercado Pago conservan sus imágenes de identidad.

El botón móvil «Imprimir / PDF» prepara ambas caras en color mediante la impresión del navegador: elegir «Guardar como PDF» o una impresora en color. Incluye todos los dientes, marcas, observaciones, consentimiento, tratamientos, costos y movimientos, junto con paciente, profesional y fecha de emisión. Primero deben guardarse los cambios para evitar diferencias con la ficha y el balance. La ficha habitual reúne anverso y reverso en una sola página A4, aproximadamente media página por cara: el anverso combina odontograma y notas en dos columnas, y el reverso conserva las tablas y totales compactos. Las fichas extensas continúan en páginas adicionales sin recortar datos ni reducir progresivamente la letra. Los formularios de carga y controles de edición no se imprimen. El PDF se genera localmente, sin enviar datos a un servicio externo; la configuración de color de la impresora depende del dispositivo.

Las invitaciones y reservas generan fichas provisorias. «Guardar cambios» conserva la ficha sin marcar un turno como atendido; «Guardar atención» confirma la ficha y, si se abrió desde un turno vinculado, registra la atención. Los registros clínicos anteriores, certificados y órdenes se conservan y pueden consultarse.

Un presupuesto propuesto no genera deuda. Al aceptarlo, su importe se proyecta en el balance de pagos; los pagos registrados se descuentan del mismo tratamiento. El costo interno nunca se suma a la deuda. Los registros odontológicos del balance se modifican desde su ficha, no como copias independientes. «Mercado Pago» es el medio de un pago registrado manualmente: esta ficha no inicia ni confirma cobros automáticos. La anotación de consentimiento no reemplaza un documento firmado.

El guardado remoto conserva revisiones, verifica propiedad y especialidad, controla concurrencia e impide alterar pagos ya guardados. Ante un conflicto, los cambios permanecen en pantalla y se puede cargar la última ficha guardada con confirmación de descarte.

Para odontólogos, «Eliminar paciente» mueve la ficha a **Pacientes eliminados**, incluso si tiene atenciones confirmadas o pagos. Es la primera etapa: deja de aparecer en las listas activas y puede restaurarse. «Confirmar eliminación» pide una segunda confirmación y mueve la ficha al **Archivo confirmado**, sin restauración desde la app. Ambas etapas conservan íntegros la historia, las revisiones, los documentos, el presupuesto, los cobros, los costos y los saldos; las estadísticas y el balance siguen incluyéndolos. Desde el archivo o el balance se consulta la ficha en modo de solo lectura y se imprime el mismo PDF. No se pueden agregar atenciones, pagos o certificados mientras esté archivada.

Primero deben cancelarse los turnos futuros pendientes. Una nueva invitación o turno del mismo DNI no reactiva ni duplica una ficha archivada: se informa que debe revisarse el archivo. El servidor conserva las identidades ante guardados de sesiones antiguas y rechaza cambios clínicos a fichas archivadas. Las otras especialidades mantienen su comportamiento anterior.

Aplicar `20261004030000_dental_patient_archive.sql` antes de desplegar la nueva versión de `workspace-data` y el frontend. Las escrituras del archivo se realizan mediante RPC validada por sesión y propiedad; no hay eliminación física de pacientes ni de movimientos. `tests/dental-patient-archive.sql` comprueba el ciclo completo con datos ficticios dentro de una transacción que finaliza en `ROLLBACK`.

Aplicar `20261004010000_dental_records.sql` antes de desplegar `dental-records` y `workspace-data`, y luego publicar el frontend. `dental-records` valida la sesión profesional propia (`x-drhappy-session`); sus tablas y funciones de escritura no están disponibles para clientes anónimos.

`20261004020000_dental_internal_cost_format.sql` corrige únicamente el formato monetario del costo interno en las notas del balance, también para registros existentes, sin alterar presupuestos, pagos ni saldos.

Para odontólogos, el balance agrupa todas las intervenciones por ID de paciente en una sola tarjeta, con totales y tratamientos desplegables. Los filtros «Con saldo» y «Saldados» clasifican la cuenta completa; buscar una intervención encuentra al paciente sin ocultar otros movimientos de su cuenta. Los tratamientos saldados se conservan, no se eliminan. Las acciones de pago, recordatorio y consulta siguen disponibles en el detalle de cada intervención.

Las estadísticas incluyen un resumen financiero acumulado. Para odontólogos muestra únicamente presupuestos aceptados o realizados de sus fichas, cobros, deuda y costos internos registrados; no cuenta propuestas pendientes ni intervenciones manuales. El balance por paciente sigue incluyendo todos sus movimientos. Los costos no representan gastos efectivamente pagados y un costo ausente se distingue de un costo cero. Para las demás especialidades se conserva la lista de intervenciones y el resumen financiero usa los importes del balance.

## Ejecutar

### Restauración de sesión móvil y cambio de cuenta

La sesión profesional se conserva en un registro local ligado al ID de la cuenta y se restaura al reabrir la app, aunque el navegador haya perdido `sessionStorage`. Los servicios usan ese mismo registro y descartan respuestas pendientes de una cuenta anterior. Cambiar de cuenta en otra pestaña obliga a recargar la vista. El plazo del servidor sigue siendo de 12 horas; cerrar o minimizar la app no cierra la sesión por sí mismo.

Al restaurar se valida primero la identidad del servidor y luego se carga su espacio de trabajo. No se sobrescribe el perfil profesional con una copia local durante el inicio. Una sesión profesional inválida no puede continuar como una cuenta distinta de Google. «Cerrar sesión» borra inmediatamente la sesión local y bloquea el reingreso automático, aunque la desconexión de Google demore o falle. Los permisos de administrador y las cuentas existentes no se modifican.

`node --test tests/professional-session.test.mjs` verifica persistencia, pérdida del almacenamiento temporal, cambio de identidad, respuestas tardías y rechazo del fallback a otra cuenta.

Con Vite en `http://127.0.0.1:5175`, `node tests/mobile-session.browser.mjs` recorre la app real en un navegador aislado a 390 px con servicios simulados: recuperación sin `sessionStorage`, reanudación, recarga, cambio entre dos cuentas con respuestas demoradas, dos logins superpuestos y cierre explícito. No consulta ni modifica usuarios reales. `TEST_APP_ORIGIN` y `EDGE_EXECUTABLE` permiten cambiar servidor y navegador. Para publicar la corrección del servidor deben desplegarse las funciones que importan `_shared/professionalSession.ts`; el cambio no requiere una migración ni cambia los plazos de las sesiones.

### Avisos de errores

Los errores de acciones, acceso, turneras, certificados, invitaciones, suscripciones, soporte y ficha dental se anuncian mediante un toast global, visible sin volver al inicio ni hacer scroll. Se puede cerrar manualmente y desaparece después de 12 segundos; el tiempo se pausa al pasar el puntero o enfocar sus controles. Repetir una acción con el mismo error vuelve a mostrar el aviso y reinicia su tiempo, sin duplicarlo. Los errores diferentes pueden coexistir. Los mensajes junto a formularios y las acciones de reintento se conservan; los antiguos avisos rojos generales de la cabecera se reemplazan por el toast. Se respeta la preferencia de movimiento reducido y se anuncia el mensaje a lectores de pantalla.

Con Vite en `http://127.0.0.1:5175`, ejecutar `node tests/error-notifications.browser.mjs` para verificar el error real de impresión dental y el ciclo de los avisos en Edge aislado, sin datos reales. `TEST_APP_ORIGIN` permite cambiar el servidor; `EDGE_EXECUTABLE`, la ruta al navegador compatible con Chromium.

### Diseño de ficha odontológica (no habilitado en producción)

Con el servidor de desarrollo abierto, `/dental-design` muestra una demostración interactiva basada en el anverso y reverso de la ficha dental: odontograma FDI permanente/temporal, referencias, trabajos, presupuesto al paciente, costo interno y cuenta con debe/haber/saldo. Usa datos ficticios y un borrador local independiente (`drhappy-dental-design-preview-v1`); no invoca servicios ni modifica pacientes, turnos o balances reales. La ruta no se habilita en el build de producción.

La demostración no procesa pagos de Mercado Pago ni certifica consentimientos. Es independiente de las fichas odontológicas reales disponibles al ingresar con una cuenta de odontólogo.

```bash
npm install
npm run dev
```

## Usuario base

- Usuario: `admin`
- Contraseña: `admin`

El modo operativo usa Supabase. No se publican usuarios, contraseñas ni pacientes demo dentro de `public`.

## Comunidad compartida (Supabase)

Para que los nuevos profesionales y mensajes de comunidad se compartan entre distintos dispositivos, configura Supabase.

1. Crea un proyecto en Supabase.
2. Crea estas tablas en SQL Editor:

```sql
create extension if not exists pgcrypto;

create table if not exists professionals (
  id text primary key default gen_random_uuid()::text,
  username text not null unique,
  password text not null,
  full_name text not null,
  specialty text not null,
  license_number text not null,
  email text not null unique,
  network_memberships_json jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists community_messages (
  id text primary key default gen_random_uuid()::text,
  sender_id text not null references professionals(id) on delete cascade,
  recipient_id text not null references professionals(id) on delete cascade,
  text text,
  attachments_json jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null default now()
);

create table if not exists user_workspaces (
  user_id text primary key references professionals(id) on delete cascade,
  profile_json jsonb not null default '{}'::jsonb,
  patients_json jsonb not null default '[]'::jsonb,
  appointments_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists password_recovery_challenges (
  user_id text primary key references professionals(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists deleted_user_archives (
  id text primary key default gen_random_uuid()::text,
  deleted_user_id text not null,
  deleted_username text not null,
  deleted_full_name text not null,
  deleted_email text not null,
  deleted_at timestamptz not null default now(),
  deleted_by_user_id text not null,
  deleted_by_user_name text not null,
  patient_count integer not null default 0,
  appointment_count integer not null default 0,
  archive_json jsonb not null default '{}'::jsonb
);

alter table professionals enable row level security;
alter table community_messages enable row level security;
alter table user_workspaces enable row level security;
alter table password_recovery_challenges enable row level security;
alter table deleted_user_archives enable row level security;

drop policy if exists "professionals read write" on professionals;
create policy "professionals read write" on professionals
for all to public using (true) with check (true);

drop policy if exists "community read write" on community_messages;
create policy "community read write" on community_messages
for all to public using (true) with check (true);

drop policy if exists "workspaces read write" on user_workspaces;
create policy "workspaces read write" on user_workspaces
for all to public using (true) with check (true);

drop policy if exists "password recovery read write" on password_recovery_challenges;
create policy "password recovery read write" on password_recovery_challenges
for all to public using (true) with check (true);

drop policy if exists "deleted user archives read write" on deleted_user_archives;
create policy "deleted user archives read write" on deleted_user_archives
for all to public using (true) with check (true);

create index if not exists community_messages_recipient_sent_idx
  on community_messages (recipient_id, sent_at desc);

create index if not exists community_messages_pair_sent_idx
  on community_messages (sender_id, recipient_id, sent_at desc);

insert into professionals (
  id,
  username,
  password,
  full_name,
  specialty,
  license_number,
  email,
  network_memberships_json,
  active
)
values (
  'admin-general',
  'admin',
  'admin',
  'Administrador General',
  'Administración Clínica',
  'ADM 0001',
  'admin@drhappy.local',
  '[]'::jsonb,
  true
)
on conflict (id) do update
set username = excluded.username,
    password = excluded.password,
    full_name = excluded.full_name,
    specialty = excluded.specialty,
    license_number = excluded.license_number,
    email = excluded.email,
    network_memberships_json = excluded.network_memberships_json,
    active = excluded.active;

insert into user_workspaces (
  user_id,
  profile_json,
  patients_json,
  appointments_json
)
values (
  'admin-general',
  jsonb_build_object(
    'fullName', 'Administrador General',
    'specialty', 'Administración Clínica',
    'licenseNumber', 'ADM 0001',
    'email', 'admin@drhappy.local',
    'phone', '',
    'signatureText', 'Validado digitalmente por profesional de la salud.',
    'communitySeenMessageIds', jsonb_build_array()
  ),
  '[]'::jsonb,
  '[]'::jsonb
)
on conflict (user_id) do nothing;
```

Si tu tabla `professionals` ya existe, ejecuta además esta migración:

```sql
alter table professionals
add column if not exists network_memberships_json jsonb not null default '[]'::jsonb;

alter table professionals
add column if not exists active boolean not null default true;

alter table professionals
add column if not exists trial_started_at timestamptz;

alter table professionals
add column if not exists subscription_status text;

alter table professionals
add column if not exists subscription_expires_at timestamptz;

create table if not exists password_recovery_challenges (
  user_id text primary key references professionals(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists deleted_user_archives (
  id text primary key default gen_random_uuid()::text,
  deleted_user_id text not null,
  deleted_username text not null,
  deleted_full_name text not null,
  deleted_email text not null,
  deleted_at timestamptz not null default now(),
  deleted_by_user_id text not null,
  deleted_by_user_name text not null,
  patient_count integer not null default 0,
  appointment_count integer not null default 0,
  archive_json jsonb not null default '{}'::jsonb
);

alter table password_recovery_challenges enable row level security;
alter table deleted_user_archives enable row level security;

drop policy if exists "password recovery read write" on password_recovery_challenges;
create policy "password recovery read write" on password_recovery_challenges
for all to public using (true) with check (true);

drop policy if exists "deleted user archives read write" on deleted_user_archives;
create policy "deleted user archives read write" on deleted_user_archives
for all to public using (true) with check (true);
```

3. Crea un archivo `.env.local` con:

```bash
VITE_SUPABASE_URL=tu_url_de_supabase
VITE_SUPABASE_ANON_KEY=tu_anon_key
```

Si no configuras esas variables, la app sigue funcionando en modo local (`localStorage`).

Con Supabase activo, los datos persistentes de negocio quedan en SQL:
- profesionales
- trial y suscripciones
- estado activo/inactivo
- redes de trabajo
- mensajes privados
- recuperación de contraseña
- archivos legales por usuarios eliminados
- base personal del profesional (perfil, pacientes, turnos y mensajes vistos)

El navegador conserva solamente estado local auxiliar:
- sesión iniciada
- tema visual
- caché temporal para acelerar carga o migraciones previas

La sesión profesional se restaura al recargar o reabrir la app en el mismo origen y dispositivo, siempre que el navegador conserve los datos del sitio y no hayan pasado 12 horas desde el inicio de sesión. Cerrar sesión o desactivar la cuenta invalida el acceso; `www.drhappy.com.ar` y `drhappy.com.ar` mantienen almacenamientos distintos.

## Suscripción con MercadoPago

La app ya puede iniciar el checkout mensual desde el botón **Suscribirme** si despliegas las Edge Functions de Supabase.

### Secrets requeridos en Supabase

```bash
MP_ACCESS_TOKEN=tu_access_token_de_mercadopago
APP_BASE_URL=https://hcelectronica.github.io/drhappy.github.io/
MP_BACK_URL_SUCCESS=https://hcelectronica.github.io/drhappy.github.io/
MP_BACK_URL_PENDING=https://hcelectronica.github.io/drhappy.github.io/
MP_BACK_URL_FAILURE=https://hcelectronica.github.io/drhappy.github.io/
MP_MONTHLY_PRICE_ARS=15000
MP_SEMIANNUAL_PRICE_ARS=78000
MP_ANNUAL_PRICE_ARS=120000
```

### Deploy de Edge Functions

Desde la carpeta del proyecto:

```bash
supabase functions deploy create-mercadopago-checkout
supabase functions deploy mercadopago-webhook
supabase functions deploy fetch-medical-news
```

### Webhook de MercadoPago

Configura el webhook de la aplicación/aprobación de pagos apuntando a:

```text
https://stzsobirxdivbgqxwkhc.supabase.co/functions/v1/mercadopago-webhook
```

### Cómo funciona

1. El usuario toca **Suscribirme**.
2. La app invoca `create-mercadopago-checkout`.
3. La function crea una preferencia de Checkout Pro en MercadoPago.
4. MercadoPago envía el webhook a `mercadopago-webhook`.
5. Si el pago está aprobado, se actualiza `professionals.subscription_status = 'active'`
   y `professionals.subscription_expires_at` según el plan elegido:
   - mensual: 30 días
   - semestral: 180 días
   - anual: 365 días

## Catálogos locales

- [especialidades-medicas.csv](</C:/Users/alanm/OneDrive/Desktop/drhappy.github.io/dr happy/especialidades-medicas.csv>): base de especialidades con autocompletado por aproximación para alta y perfil.
- [vademecum.xlsx](</C:/Users/alanm/OneDrive/Desktop/drhappy.github.io/dr happy/public/vademecum.xlsx>): base actual del Vademécum visible en **Herramientas**. La app lee la primera hoja del Excel y busca por aproximación desde 4 letras, mostrando hasta 7 sugerencias por vez.

## Noticias médicas en inicio

La pantalla de inicio consume la Edge Function `fetch-medical-news`, que agrega noticias desde fuentes oficiales de la OMS y del Ministerio de Salud de la Nación, incluyendo imagen destacada, para mostrarlas dentro de la app en rotación automática. Ademas, se sumaron tarjetas fijas/manuales para NEJM, The Lancet, JAMA Network, The BMJ, Revista Argentina de Medicina y Salud Provincia porque varios de esos sitios bloquean el scraping automatico o no exponen un feed publico estable.

## Importación de padrón (Excel)

Desde la sección de pacientes podés subir un `.xlsx`, `.xls` o `.csv`.

Columnas reconocidas (con variaciones):
- Apellido (`apellido`, `apellidos`, `lastname`)
- Nombre (`nombre`, `nombres`, `firstname`)
- DNI (`dni`, `documento`)
- Obra social (`obrasocial`, `cobertura`, `seguro`)
- Fecha de nacimiento (`fechadenacimiento`, `nacimiento`, `birthdate`)

El sistema agrega o actualiza pacientes automáticamente por DNI.
