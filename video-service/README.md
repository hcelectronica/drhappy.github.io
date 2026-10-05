# Piloto administrativo de videoconsulta Dr Happy

Servicio independiente de la aplicacion principal, para pruebas tecnicas sin datos
clinicos. Dos participantes, admision manual, audio/video separados y chat WebRTC
con confirmacion. No graba, no transcribe y no envia medios a Sofia.

## Despliegue en Hostinger

Reemplazar **solo la aplicacion de video.drhappy.com.ar**, no drhappy.com.ar.
El ZIP debe contener package.json, package-lock.json, server.mjs, videoServer.mjs,
index.html, client.js y este documento directamente en su raiz. No subir node_modules,
tests, archivos .env ni claves privilegiadas.

- Framework: Other. Node: 22 o 24.
- Entrada: server.mjs. Inicio: npm start.
- server.mjs llama listen() directamente, tambien cuando Hostinger lo importa
  desde su wrapper. La fabrica sin efectos de inicio vive en videoServer.mjs;
  no usar ese modulo como archivo de entrada.
- Sin build ni directorio dist. Hostinger instala dependencies.
- Usa el PORT asignado por Hostinger.
- El origen predeterminado es https://video.drhappy.com.ar.
- Supabase predeterminado: proyecto Dr Happy stzsobirxdivbgqxwkhc.
- No requiere variables para esta primera prueba.
- La funcion Supabase video-access debe estar desplegada con verify_jwt=false:
  la propia funcion valida la sesion profesional y el permiso is_admin.
- No copiar SUPABASE_SERVICE_ROLE_KEY al hosting: permanece en Supabase.

PUBLIC_ORIGIN y SUPABASE_URL permiten otros despliegues. PUBLIC_ORIGIN debe
ser HTTPS, sin ruta ni barra final. Solo se permite HTTP para loopback local.

## Uso

1. Administrador: abrir el subdominio e iniciar sesion con usuario/email y
   contrasena de Dr Happy. No es la contrasena de Hostinger. Solo cuentas con
   is_admin=true y activas. Las cuentas exclusivamente Google necesitan una
   contrasena definida en Dr Happy; no se incluye OAuth en este piloto.
2. Crear sala y copiar invitacion. Aceptar prueba, activar dispositivos y entrar.
3. Invitado: abrir el enlace privado, aceptar prueba, activar dispositivos y entrar.
   No necesita cuenta; no puede crear salas ni admitir/finalizar.
4. Administrador: Admitir invitado. Antes de ese paso no hay medios ni chat remotos.
5. Finalizar sala revoca ambos enlaces y apaga dispositivos. Cerrar sesion tambien
   finaliza todas las salas creadas en esa sesion.

Usar auriculares y dos dispositivos; una misma camara puede estar ocupada si
se intenta usar desde dos navegadores. Existe entrada solo con microfono.
No publicar invitaciones. Duran 30 minutos como maximo; son acceso al piloto.
Se quita el fragmento de la barra de direcciones al cargar; recargar requiere
volver a abrir el enlace. El token administrativo de sala requiere tambien
la cookie HttpOnly del propietario. Sesion de video: una hora.

## Redes y TURN

Por defecto usa STUN gratuito de Google (stun.l.google.com:19302).
STUN recibe informacion de red, no audio/video. WebRTC cifra los medios.
Sin TURN no se garantiza conectar redes moviles, corporativas o NAT restrictivo.
Socket.IO conectado no equivale a audio/video conectado.

Para un TURN propio o contratado, configurar ICE_SERVERS_JSON en Hostinger:

```json
[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:TU_HOST:3478","turns:TU_HOST:5349"],"username":"TU_USUARIO_DE_PRUEBA","credential":"TU_CREDENCIAL_DE_PRUEBA"}]
```

No usar esos valores de ejemplo en produccion. No subir credenciales al repo
ni compartirlas por chat. El servidor entrega la configuracion solo a
participantes autorizados. Los participantes WebRTC pueden ver las credenciales
TURN que usan: limitar cuota y vigencia, utilizar una cuenta exclusiva del
piloto. Para uso clinico implementar credenciales TURN temporales.

## Limites deliberados

Salas y sesiones en memoria: reinicios/despliegues revocan acceso. Una instancia
Node, no replicas. Hasta 30 salas, 3 por sesion, y limites de conexiones,
solicitudes, mensajes y SDP. No persistencia de chat.

Supabase revalida permiso al crear, conectar, obtener ICE y realizar controles
administrativos. Salas activas se revalidan cada 30 segundos; si no puede
validarse el permiso se cierran, sin permitir continuar por defecto.
Desconexion de senalizacion corta medios y requiere readmision al reconectar.
Fallo de medios apaga dispositivos e informa si falta TURN; no simula exito.

Esta aceptacion tecnica no sustituye consentimiento informado, politica de
privacidad ni evaluacion legal/clinica. No habilitar aun atencion real.

## Desarrollo y pruebas

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:browser
$env:PUBLIC_ORIGIN='http://127.0.0.1:5194'
npm.cmd start
```

Pruebas de servidor inyectan adaptadores de autorizacion exclusivamente desde
el runner. El servidor desplegable no contiene un modo de omitir autenticacion.
La prueba de navegador usa Edge aislado y dispositivos sinteticos para verificar
frames WebRTC reales, chat, admision, reingreso, cierre y vista movil.
La aceptacion final por Internet requiere dos dispositivos en redes diferentes
con medios reales; no puede inferirse de las pruebas locales.
