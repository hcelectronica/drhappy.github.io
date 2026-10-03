# Dr Happy - Modelo de Historia Clínica Digital

Web app base en React + TypeScript para:
- Login de profesionales.
- Gestión de pacientes y fichas clínicas.
- Adjuntos (imágenes, PDF, DOCX).
- Registro de atenciones con fecha, reflexión profesional y firma digital.
- Importación masiva de padrón desde Excel.
- Comunidad médica con mensajería privada asíncrona.

## Documentos clínicos

Desde la ficha del paciente, **Emitir certificado** permite elegir entre un certificado médico y una orden de estudios complementarios. En la orden se busca entre estudios frecuentes codificados o se agrega uno en texto libre; el profesional debe indicar el motivo clínico, puede añadir observaciones y revisar el borrador antes de emitir. Si el contenido no cabe en el PDF, se informa el error antes de guardar la orden. Ambos documentos se guardan en la historia clínica con firma, PDF y QR; las órdenes se identifican como tales en el historial, la descarga y el envío.

La selección de `src/studyCatalog.ts` contiene procedimientos activos cuyos códigos y términos preferidos en español se verificaron en [Snowstorm Test del Ministerio de Salud](https://snowstorm-test.msal.gob.ar/swagger-ui.html) (rama MAIN). **No es el catálogo completo ni una certificación de pertenencia a la Extensión Argentina de SNOMED CT**. El texto libre no se codifica. Para incorporar una edición argentina completa se requiere acceso a su distribución/licencia o un servidor de terminología configurado para esa edición.

## Turneras y pacientes

Los horarios de consultorio (turnos manuales), la turnera gratuita y la turnera particular se configuran por separado; ninguna impone un límite horario a las otras. El cupo de una reserva pública se libera al cancelar el turno desde la agenda, incluso para los enlaces de turnos antiguos. La cancelación y la confirmación tardía de pagos se coordinan en la base de datos mediante `20261002010000_cancel_public_booking_appointment.sql`; aplicar esa migración antes de desplegar `public-booking` y `mercadopago-patient-webhook`.

Para médicos y psicólogos, un turno gratuito no crea una ficha clínica hasta que el profesional lo atiende. Para odontólogos, las reservas pendientes crean una ficha dental provisoria cuando se sincroniza su espacio de trabajo. «Atender» permite completar la ficha antes de la fecha del turno. Las fichas y los turnos se vinculan únicamente por DNI o por un ID de ficha ya vinculado y coherente con el DNI; compartir nombre, email o teléfono no identifica a un paciente. Si se cancela el selector nativo de compartir, no se abre WhatsApp automáticamente.

## Suscripciones, Sofía y recordatorios

Todos los planes pagos habilitan las mismas herramientas: 30 días ($15.000), 180 días ($78.000) o 365 días ($120.000). «Suscripción activa» abre «Mi suscripción» con el último período comprado, vencimiento, consumo de Sofía e historial de pagos. Una nueva compra suma días al vencimiento vigente; un pago de Mercado Pago se aplica una sola vez. Las activaciones administrativas anteriores pueden no tener una compra identificada.

Sofía incluye 100 consultas por mes calendario de Argentina en cualquier plan pago y 3 consultas en total durante la prueba de 7 días. Comprar más tiempo no reinicia el cupo. Una pregunta con varias llamadas internas cuenta como una consulta; confirmar una acción pendiente no consume otra pregunta. Las solicitudes concurrentes reservan cupo en la base antes de invocar la IA. Los fallos sin tokens registrados liberan la reserva; las solicitudes que ya consumieron tokens cuentan y conservan su consumo. Los tokens de entrada/salida se muestran como información, no como un límite adicional.

Los recordatorios automáticos se ejecutan una vez por día a las 22:00 de Argentina (01:00 UTC), para los turnos del día siguiente. No se envían recordatorios de 24 ni de 2 horas. Se excluyen cancelados, atendidos, pendientes de confirmación y reservas creadas después del corte. Los envíos se registran fuera de la agenda; un envío con resultado incierto no se reintenta automáticamente para evitar duplicados y requiere revisión. Un correo aceptado por SMTP no garantiza su llegada a la bandeja de entrada.

Aplicar `20261003010000_subscription_account_and_nightly_reminders.sql` y desplegar `subscription-account`, `mercadopago-webhook`, `ai-assistant` y `send-appointment-reminders`. La migración reemplaza la tarea de cinco minutos por el envío nocturno. El webhook debe aceptar notificaciones sin JWT de Mercado Pago; valida cada pago consultando al proveedor. Los precios del checkout siguen configurados en los secrets `MP_*_PRICE_ARS`.

## Ficha odontológica

Los profesionales con especialidad odontológica acceden a una ficha de dos caras en lugar del formulario médico extenso. El anverso contiene los datos básicos, odontograma FDI permanente y temporal, registros por superficie, referencias y observaciones. El reverso reúne tratamientos, presupuesto al paciente, costo interno y cuenta con debe/haber/saldo. El giro permite cambiar de cara sin salir del paciente.

Las invitaciones y reservas generan fichas provisorias. «Guardar cambios» conserva la ficha sin marcar un turno como atendido; «Guardar atención» confirma la ficha y, si se abrió desde un turno vinculado, registra la atención. Los registros clínicos anteriores, certificados y órdenes se conservan y pueden consultarse.

Un presupuesto propuesto no genera deuda. Al aceptarlo, su importe se proyecta en el balance de pagos; los pagos registrados se descuentan del mismo tratamiento. El costo interno nunca se suma a la deuda. Los registros odontológicos del balance se modifican desde su ficha, no como copias independientes. «Mercado Pago» es el medio de un pago registrado manualmente: esta ficha no inicia ni confirma cobros automáticos. La anotación de consentimiento no reemplaza un documento firmado.

El guardado remoto conserva revisiones, verifica propiedad y especialidad, controla concurrencia e impide alterar pagos ya guardados. Ante un conflicto, los cambios permanecen en pantalla y se puede cargar la última ficha guardada con confirmación de descarte.

Aplicar `20261004010000_dental_records.sql` antes de desplegar `dental-records` y `workspace-data`, y luego publicar el frontend. `dental-records` valida la sesión profesional propia (`x-drhappy-session`); sus tablas y funciones de escritura no están disponibles para clientes anónimos.

## Ejecutar

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
