# Plan de identidad y autorización

## Estado actual auditado

- El login propio valida usuario y contraseña en `auth-professional`.
- El frontend recibe el perfil y guarda `professionalId` en `localStorage`.
- `ai-assistant` recibe `professionalId` en el body y lo usa como identidad.
- Varias Edge Functions reciben `userId`, `requesterId` o `professionalId` desde el cliente.
- Google usa una sesión real de Supabase Auth.
- El login propio y Google no comparten actualmente una identidad verificable común.

## Objetivo

Toda Edge Function sensible debe obtener la identidad desde una prueba verificable del backend, nunca desde un ID libre enviado por el navegador.

## Diseño por etapas

1. Mantener el login actual y agregar una sesión corta firmada por `auth-professional` para el login propio.
2. Guardar el token solo en `sessionStorage` durante la primera transición; no usarlo como dato de autorización fuera del backend.
3. En cada Edge Function, validar el token y obtener el `professionalId` desde sus claims.
4. Para Google, validar el bearer token de Supabase Auth y resolver el profesional por email/provider identity.
5. Unificar ambos caminos en un helper compartido de identidad.
6. Reemplazar gradualmente `body.professionalId`, `body.requesterId` y `body.userId` por la identidad validada.
7. Agregar pruebas negativas antes de cerrar RLS.

## Reglas

- No aceptar un ID del body como prueba de identidad.
- No guardar contraseñas, tokens completos ni historias clínicas en logs.
- No modificar RLS sensible hasta que las funciones usen identidad validada.
- No publicar producción hasta pasar build, pruebas de login normal, Google, Sofía, agenda y pruebas de aislamiento.

## Riesgos de transición

- Invalidar sesiones existentes al cambiar el contrato.
- Diferencias entre usuarios creados con contraseña y usuarios Google.
- Funciones públicas que deben seguir sin sesión para reservar turnos.
- Necesidad de rotar el secreto de firma si se expone.
