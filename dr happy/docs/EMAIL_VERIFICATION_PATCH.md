# PARCHE LOGIN - verificacion de email (stand-by)

Etiqueta de trabajo: `PARCHE LOGIN`

El flujo de registro con confirmacion por codigo esta activo en el entorno de desarrollo para pruebas. Produccion permanece sin cambios.

## Incluye

- Migracion `20260922010000_prepare_professional_email_verification.sql`.
- Edge Function `auth-email-verification` con acciones `register`, `verify` y `resend`.
- Wrapper cliente `src/emailVerificationService.ts`.
- Codigo aleatorio criptograficamente seguro de seis digitos; solo se guarda su hash con pepper en el servidor.
- Vigencia de 15 minutos, maximo de 5 intentos por codigo y consumo unico, con actualizacion atomica.
- Registro, desafio y permiso de reenvio creados en una transaccion SQL; las cuentas nuevas no pueden iniciar sesion hasta verificar, sin modificar el estado administrativo `active`.
- Reenvio autorizado con un token aleatorio guardado como hash, espera de 60 segundos y maximo de 5 reenvios en 24 horas.
- Si falla el correo, la cuenta pendiente puede recuperarse desde el mismo navegador y reintentar el envio.
- Sesion creada solo despues de verificar el email; tambien se comprueba que la fila de sesion se haya guardado.
- El login existente consulta los nuevos campos y bloquea solo cuentas marcadas como pendientes cuando el flag de servidor esta activo. Las cuentas anteriores quedan fuera de ese requisito.
- Pantalla de codigo integrada en `App.tsx`; permite reanudar el registro pendiente despues de recargar o cerrar la pestaña.
- Google OAuth requiere una identidad del proveedor `google` cuya direccion coincida con el email validado por Supabase y tenga `email_verified: true`; no confia en el email enviado por el navegador.
- Una cuenta Google nueva queda marcada como verificada al crear el perfil cuando el flag esta activo. Si coincide con una cuenta manual pendiente, la identidad Google verificada completa esa confirmacion; una cuenta administrativa inactiva no se reactiva.
- El fallback de autenticacion de las Edge Functions aplica la misma prueba Google y bloquea perfiles pendientes, para evitar saltarse la verificacion por otra ruta.

## Estado

La Edge Function de verificacion requiere el secret `ENABLE_EMAIL_VERIFICATION=true` y `EMAIL_VERIFICATION_PEPPER`. El cliente local requiere `VITE_ENABLE_EMAIL_VERIFICATION=true` al iniciar Vite. Ambos estan habilitados unicamente en desarrollo.

Con los flags apagados, el frontend sigue usando el alta actual y `auth-professional` no consulta columnas nuevas. El login Google aun exige un email confirmado por su identidad de proveedor. Al activar el flag del servidor, el alta legacy devuelve `EMAIL_VERIFICATION_REQUIRED`; esto evita saltar el paso de confirmacion.


Estado actual: las seis migraciones pendientes fueron aplicadas al proyecto Supabase `stzsobirxdivbgqxwkhc`; el pepper fue generado y guardado como secret; el flag backend esta activo; se desplegaron `auth-email-verification`, `auth-professional` y las funciones que comparten el guard de sesion. Ambas carpetas locales apuntan al mismo ref Supabase, por lo que backend y base son compartidos, no hay un proyecto Supabase de desarrollo separado. La app local corre en `http://127.0.0.1:5173/`; el cliente de produccion se publica desde `origin/main` y `.env.production` habilita el panel de codigo en el build.
Diagnostico del primer envio real: Hostinger SMTP respondio `535 5.7.8 authentication failed`. El email de destino no es el problema. Configurar `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM_EMAIL` con una casilla vigente; no volver a usar `turnos@drhappy.com.ar`. No guardar ni compartir contraseñas en el repositorio o el chat. Hasta corregir esos secrets, los codigos no se entregan y la interfaz informa que el servidor de correo rechazo el envio.

## Pruebas pendientes

1. Configurar los secrets `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM_EMAIL` para una casilla activa; repetir una prueba de entrega y confirmar el mensaje en la casilla.
2. Probar alta real, codigo incorrecto, quinto intento, expiracion, reenvio/cooldown/limite, email duplicado, cierre/reapertura del navegador y recuperacion tras fallo.
3. Probar login Google con una cuenta real y confirmar que una identidad sin email verificado se rechaza.
4. Probar login de cuentas existentes y verificar que el envio de bienvenida siga sin bloquear el alta.
5. Mantener el resto de cambios locales del checkout `PRODUCCION` fuera de esta publicacion; no se han mezclado con el parche de login.

No replicar migraciones, secrets, flags ni funciones a produccion sin autorizacion explicita.
