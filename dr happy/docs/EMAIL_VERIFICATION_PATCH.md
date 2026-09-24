# PARCHE LOGIN - verificacion de email (stand-by)

Etiqueta de trabajo: `PARCHE LOGIN`

Este parche prepara el registro de profesionales con confirmacion por codigo, pero queda deliberadamente desactivado y no modifica el login actual.

## Incluye

- Migracion `20260922010000_prepare_professional_email_verification.sql`.
- Edge Function `auth-email-verification` con acciones `register`, `verify` y `resend`.
- Wrapper cliente `src/emailVerificationService.ts`.
- Codigo de seis digitos generado y hasheado solo en servidor.
- Expiracion de 15 minutos, maximo de 5 intentos y consumo unico.
- Sesion creada solo despues de verificar el email.

## Estado

La funcion requiere el secret `ENABLE_EMAIL_VERIFICATION=true`. Si no esta definido, devuelve `EMAIL_VERIFICATION_DISABLED`. No esta conectada a `App.tsx` ni reemplaza `auth-professional`.

## Activacion futura

1. Aplicar la migracion en desarrollo y verificar que los usuarios existentes mantengan acceso.
2. Configurar `EMAIL_VERIFICATION_PEPPER` y `ENABLE_EMAIL_VERIFICATION=true` solo en desarrollo.
3. Desplegar `auth-email-verification`.
4. Integrar el formulario de registro y pantalla de codigo en `App.tsx`.
5. Probar reenvio, expiracion, limite de intentos, email duplicado y cierre de sesion.
6. Migrar los usuarios existentes de forma gradual; no bloquear cuentas antiguas sin una pantalla de verificacion.
7. Repetir en produccion solo despues de validar el flujo completo.

No ejecutar `supabase db push` ni desplegar esta funcion como parte de este parche stand-by.
