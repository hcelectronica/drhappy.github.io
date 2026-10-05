# Piloto administrativo de videoconsulta Dr Happy

Servicio independiente de la aplicacion principal, para pruebas tecnicas sin datos
clinicos. Dos participantes, admision manual, audio/video separados y chat WebRTC
con confirmacion. No graba, no transcribe y no envia medios a Sofia.

## Despliegue en Hostinger

Reemplazar **solo la aplicacion de video.drhappy.com.ar**, no drhappy.com.ar.
El ZIP debe contener package.json, package-lock.json, server.mjs, videoServer.mjs,
index.html, client.js, brand-mark.svg y este documento directamente en su raiz. No subir node_modules,
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
- Las funciones Supabase video-access y video-handoff deben estar desplegadas con verify_jwt=false:
  la propia funcion valida la sesion profesional y el permiso is_admin.
- No copiar SUPABASE_SERVICE_ROLE_KEY al hosting: permanece en Supabase.

PUBLIC_ORIGIN y SUPABASE_URL permiten otros despliegues. PUBLIC_ORIGIN debe
ser HTTPS, sin ruta ni barra final. Solo se permite HTTP para loopback local.

## Uso

1. Administrador: desde la app, tocar Videoconsulta para entrar automaticamente
   con la cuenta actual, incluso si ingreso con Google. No pide otra contrasena.
   Abrir directamente el subdominio conserva el login con usuario/email y
   contrasena de Dr Happy (no de Hostinger); el login directo no incluye OAuth.
   Solo cuentas con is_admin=true y activas.
2. Elegir duracion entera de 1 a 120 minutos (40 por defecto), crear sala y copiar
   invitacion. Crear y Entrar son pasos separados, juntos sobre el video.
   Aceptar prueba y entrar; los dispositivos pueden seguir apagados.
3. Invitado: abrir el enlace privado, aceptar prueba y entrar.
   No necesita cuenta; no puede crear salas ni admitir/finalizar.
4. Administrador: Admitir invitado. Antes de ese paso no hay medios ni chat remotos.
5. Finalizar sala revoca ambos enlaces y apaga dispositivos. Cerrar sesion tambien
   finaliza todas las salas creadas en esa sesion.

Usar auriculares y dos dispositivos; una misma camara puede estar ocupada si
se intenta usar desde dos navegadores. Los iconos de microfono y camara activan
cada dispositivo de forma independiente antes y durante la llamada. Es posible
entrar con ambos apagados, sin pedir permisos ni capturar dispositivos, y usar
el chat despues de la admision. Activar audio o video despues no requiere nueva
admision ni reinicia el temporizador. Tambien se puede entrar solo con audio o video.
Silenciar microfono deshabilita su pista (no libera el permiso de captura);
apagar camara detiene la pista y libera el dispositivo. Salir/finalizar apaga
ambos. Un error de un dispositivo no apaga el otro.

El campo de minutos ocupa una sola linea junto a Crear/Entrar; queda bloqueado
una vez creada la sala. Durante la llamada se ocultan los controles de creacion
y la duracion sigue visible en el reloj. Crear otra requiere finalizar la sala
anterior. Salir y Finalizar para ambos quedan sobre el video durante la llamada,
accesibles aunque el chat este abierto. La invitacion queda plegada al entrar y se puede volver a desplegar
para copiarla o compartirla con el menu del dispositivo cuando este disponible.
El enlace nuevo tiene formato https://video.drhappy.com.ar/#p= seguido de
22 caracteres: 128 bits aleatorios, no un numero de sala predecible. No usa un
acortador externo ni agrega pasos para el paciente. Su hash se guarda en
memoria y conserva admision manual, vencimiento, comprobacion administrativa y
revocacion. El secreto queda en el fragmento, no en la ruta ni en las consultas
que llegan a los logs HTTP. Cookies administrativas y pases de acceso automatico
conservan su longitud original. El cliente tambien reconoce #invite= de versiones
anteriores; desplegar/reiniciar el servicio igualmente revoca las salas anteriores.

El chat empieza minimizado debajo del video y se habilita al conectar despues
de la admision. Recibir mensajes no lo abre ni mueve la pagina: muestra contador
y aviso accesible. Al abrirlo se borra el contador. El panel flotante tiene
altura limitada y scroll interno; no cambia el tamano ni la posicion del video
ni agrega altura al documento. Minimizar/Escape devuelve el foco al boton.
Se reajusta al cambiar pantalla o teclado; si el teclado reduce mucho el area
visible, el panel puede superponerse temporalmente para mantener el editor
accesible, sin redimensionar el video por abrir/cerrar el chat.
Cada sala nueva elimina de la interfaz los mensajes y pendientes de lectura de
la anterior. No se conserva historial al recargar ni se persisten mensajes.

El acceso automatico requiere la migracion 20261005010000_video_handoff.sql y
la funcion video-handoff. La app abre una pestana sin opener y solicita un pase
aleatorio de 256 bits valido 60 segundos. La base guarda solo su hash; emitir
otro reemplaza el pendiente. El canje elimina el pase atomicamente y verifica
de nuevo la sesion de origen y el permiso administrativo. No se envia por URL
la contrasena ni el token permanente de la app. El fragmento se elimina al
cargar y el servidor de video intercambia el pase por una nueva sesion
profesional, que guarda exclusivamente en memoria, y una cookie HttpOnly.
Si vence o se reutiliza, se informa el error y se debe volver a abrir desde la
app. No se concede acceso ante fallos del servicio de autorizacion.
Si la misma cuenta ya tiene sesion de video vigente, se conserva su cookie y
sus salas; abrir otra cuenta revoca las salas de la sesion anterior. El cierre
de sesion de la app y el de video son independientes: cerrar la app no termina
automaticamente una llamada existente. La sesion local de video dura tres
horas y reiniciar el servidor la revoca.

El recuadro muestra la marca Dr. H modelo 08 durante la espera o si el otro
participante tiene la camara apagada, con animacion suave que respeta reducir
movimiento. No es una simulacion de video remoto. La vista propia esta espejada
y puede arrastrarse dentro del recuadro con mouse o dedo, o moverse con flechas
al enfocarla. Se limita a los bordes y al area sobre los controles para no
taparlos, y se reajusta al cambiar el tamano de pantalla.

WebRTC negocia audio y video sendrecv al admitir aun si una pista no esta
activada; replaceTrack permite agregar/quitar camara o agregar microfono sin
renegociar la sala. El canal privado comunica el estado de camara para ocultar
el ultimo frame cuando se apaga. No modifica permisos, duracion ni STUN/TURN.
No publicar invitaciones. Hay hasta 30 minutos de espera desde la creacion para
la primera admision. Esa espera no consume la duracion elegida. La consulta
empieza con la primera admision, no con la activacion de la camara ni cuando
termina de conectar WebRTC. El reloj continua durante desconexiones y reingresos;
readmitir no lo reinicia. Ambos participantes ven el tiempo restante y un aviso
cuando quedan 5 minutos o menos. Al cumplir la duracion se cierra la sala,
se apagan dispositivos y se revocan ambos accesos en el servidor.
Para cambiar la duracion se necesita una sala nueva.
Se quita el fragmento de la barra de direcciones al cargar; recargar requiere
volver a abrir el enlace. El token administrativo de sala requiere tambien
la cookie HttpOnly del propietario. Sesion administrativa de video: tres horas.
El permiso real se sigue revalidando en Supabase. Si la sesion local restante
no cubre la espera maxima mas la duracion solicitada, se informa que hay que
volver a iniciar sesion; no se crea una sala que se cortaria prematuramente.
Los cronometros del navegador usan el tiempo restante enviado por el servidor
y un reloj monotono para no depender de la fecha configurada en el dispositivo.

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
Comprueba enlaces cortos, entrada sin dispositivos y activacion posterior,
toolbar a 360/390/768/1280 px, panel debajo del video para ambos roles,
geometria invariable al desplegar chat, contador, scroll interno y foco.
La aceptacion final por Internet requiere dos dispositivos en redes diferentes
con medios reales; no puede inferirse de las pruebas locales.
