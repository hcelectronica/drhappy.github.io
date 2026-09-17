# Dr Happy Work Log

Registro operativo y de decisiones del endurecimiento de la aplicación.

## 2026-09-17

- Inicio del tramo de seguridad y estabilidad.
- Se detectó que varias funciones reciben IDs de usuario desde el cliente y los usan como identidad.
- Se detectaron políticas RLS permisivas con `USING (true)` en datos sensibles.
- Se decidió agregar observabilidad segura antes de modificar autenticación o RLS.
- Regla de seguridad: no registrar contraseñas, tokens, claves, historias clínicas ni contenido completo de pacientes.
- Se agregó `runtimeLogger.ts` con redacción de campos sensibles, buffer local limitado a 200 eventos y salida de consola.
- Se agregó `AppErrorBoundary.tsx` para capturar errores de renderizado y ofrecer recuperación visible.
- Se conectó captura global de `window.error` y `unhandledrejection` desde `main.tsx`.
- Validación: diagnósticos limpios y `npm run build` correcto en desarrollo.
- Auditoría de identidad: el login propio autentica en `auth-professional`, pero el resto de la sesión se basa en un `professionalId` del navegador; Sofía todavía no recibe una prueba criptográfica de identidad.
- Se creó `SECURITY_IDENTITY_PLAN.md` con la migración por etapas hacia identidad verificable.
- Se agregó la tabla `professional_sessions` con tokens opacos hasheados, expiración de 12 horas y revocación.
- `auth-professional` ahora entrega un token de sesión al login propio.
- `ai-assistant` ahora resuelve identidad desde `x-drhappy-session` o bearer de Supabase Auth; deja de confiar en `professionalId` del body.
- El cliente envía la sesión opaca a Sofía y la elimina al cerrar sesión.
- Migración aplicada y funciones `auth-professional`/`ai-assistant` desplegadas solo en Supabase de desarrollo.
- Validación: build frontend y diagnósticos limpios.
- Pendiente: probar login propio, Sofía, Google y aislamiento entre profesionales antes de tocar producción o RLS.
- Prueba negativa ejecutada contra `ai-assistant` sin sesión: respondió HTTP 401 (`UNAUTHORIZED_NO_AUTH_HEADER`).

## Formato de cada entrada

- Fecha y hora.
- Área afectada.
- Cambio realizado.
- Validación ejecutada.
- Resultado.
- Riesgo pendiente.
