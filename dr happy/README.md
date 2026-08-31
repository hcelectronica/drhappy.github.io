# Dr Happy - Modelo de Historia Clínica Digital

Web app base en React + TypeScript para:
- Login de profesionales.
- Gestión de pacientes y fichas clínicas.
- Adjuntos (imágenes, PDF, DOCX).
- Registro de atenciones con fecha, reflexión profesional y firma digital.
- Importación masiva de padrón desde Excel.
- Comunidad médica con mensajería privada asíncrona.

## Ejecutar

```bash
npm install
npm run dev
```

## Usuario base

- Usuario: `admin`
- Contraseña: `admin`

Los datos iniciales de usuarios están en `public/users.json` y la base local de pacientes en `public/patients.json`.

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
