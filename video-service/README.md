# Videoconsulta Dr Happy

Servicio independiente de la aplicacion principal para videoconsultas. Dos
participantes, admision manual, audio/video separados y chat WebRTC con
confirmacion. Transcripcion experimental opcional, procesada solo dentro del
navegador del profesional (ver "Transcripcion local").

## Despliegue en Hostinger

Reemplazar **solo la aplicacion de video.drhappy.com.ar**, no drhappy.com.ar.
El ZIP debe contener package.json, package-lock.json, server.mjs, videoServer.mjs,
index.html, client.js, transcription.js, brand-mark.svg y este documento directamente en su raiz. No subir node_modules,
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
- No requiere variables para la configuracion basica.
- Las funciones Supabase video-access y video-handoff deben estar desplegadas con verify_jwt=false:
  la propia funcion valida la sesion y el acceso medico durante prueba vigente o suscripcion activa, respetando el modulo attention; conserva administradores y excluye odontologia.
- No copiar SUPABASE_SERVICE_ROLE_KEY al hosting: permanece en Supabase.

PUBLIC_ORIGIN y SUPABASE_URL permiten otros despliegues. PUBLIC_ORIGIN debe
ser HTTPS, sin ruta ni barra final. Solo se permite HTTP para loopback local.

## Uso

La version 12 agrega **Enviar por email** en el panel del enlace privado,
sin envio automatico al crear la sala. El destinatario se resuelve en Supabase
desde la ficha guardada del paciente o, si esta no tiene email, el turno asociado.
No se acepta un destinatario ni enlace arbitrario desde el navegador.
Falta de email valido, sala vencida y errores se informan sin simular exito.
La confirmacion significa aceptacion del servicio de correo, no entrega al buzon.
El paciente no necesita cuenta; sigue requiriendo admision y la invitacion vence
igual que el enlace copiado. No guardar ni imprimir el enlace privado en logs.

Antes de subir el ZIP v12 aplicar `20261007010000_video_invitation_email.sql`
y desplegar `video-consultations` en Supabase con verify_jwt=false. El envio
reutiliza `send-email`; las credenciales SMTP siguen exclusivamente en Supabase.
Una reserva atomica en la base limita a un intento de correo por sala,
incluso ante solicitudes simultaneas o respuestas perdidas. Si un envio queda
sin confirmacion no se reenvia automaticamente: verificar con el paciente
y usar Copiar/Compartir. La reserva no almacena el enlace ni el email.

1. Profesional habilitado: desde la app, tocar Videoconsulta para entrar automaticamente
   con la cuenta actual, incluso si ingreso con Google. No pide otra contrasena.
   Abrir directamente el subdominio conserva el login con usuario/email y
   contrasena de Dr Happy (no de Hostinger); el login directo no incluye OAuth.
   Medicos con prueba de 7 dias o suscripcion vigente y attention habilitado, o administradores activos. La politica se revalida en video-access, video-handoff y video-consultations; la migracion 20261010010000_medical_tools_full_access.sql actualiza el pase de un solo uso. El login directo consulta video-access en lugar de decidir por is_admin en Node.
2. Elegir paciente de la lista propia y, si corresponde, un turno asociado.
   Elegir duracion entera de 1 a 120 minutos (40 por defecto), crear sala y
   copiar invitacion. Crear y Entrar son pasos separados, juntos sobre el video.
   Los dispositivos pueden seguir apagados.
3. Invitado: abrir el enlace privado y entrar.
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
La lista de pacientes y turnos se obtiene solo para la cuenta profesional
autorizada. Los fragmentos de apertura desde la app pueden incluir identificadores
de paciente y turno; se consumen al cargar y no se incorporan al enlace privado
que recibe el invitado. La pantalla amplia el video usando el espacio disponible.
En moviles apaisados reduce margenes y controles; si Safari no ofrece pantalla
completa nativa, "Ampliar vista" expande la pagina y mantiene sus controles.
Camara y microfono se activan individualmente y solo se envian despues de admitir.
La interfaz carga `GET /api/patients` (`{patients:[{id,name}],appointments:[{id,patientId,label}]}`)
y crea salas con `POST /api/rooms` (`{durationMinutes,patientId,appointmentId?}`).
La lista no se solicita para el rol paciente. El nombre devuelto en los metadatos
de la sala solo se muestra en la vista profesional.
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
En pantalla completa se amplia toda la sala (estado, admision, reloj,
Salir/Finalizar, medios y chat), no solo el elemento video. El boton de chat
queda anclado a una esquina; su panel se limita al contenedor de pantalla
completa y al visual viewport, sin tapar los controles de medios cuando caben.
El modo ampliado de pagina usa el mismo contenedor. Escape lo cierra, minimiza
el chat y restaura el scroll y el foco anteriores.
En horizontal de poca altura (por ejemplo 844x390), ambos modos ajustan la
sala al alto visible sin scroll: ocultan encabezado, seleccion, enlace y ayuda;
durante la llamada admitida ocultan tambien identidad, espera y estado. El
escenario ocupa el alto restante y puede bajar de 220 px; Salir/Finalizar, chat,
medios y Activar audio quedan visibles. El teclado del chat puede superponerse.
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
servicio. Para un despliegue clinico implementar credenciales TURN temporales.

## Limites deliberados

Salas y sesiones en memoria: reinicios/despliegues revocan acceso. Una instancia
Node, no replicas. Hasta 30 salas, 3 por sesion, y limites de conexiones,
solicitudes, mensajes y SDP. No persistencia de chat.

Supabase revalida permiso al crear, conectar, obtener ICE y realizar controles
administrativos. Salas activas se revalidan cada 30 segundos; si no puede
validarse el permiso se cierran, sin permitir continuar por defecto.
Desconexion de senalizacion corta medios y requiere readmision al reconectar.
Fallo de medios apaga dispositivos e informa si falta TURN; no simula exito.

El uso del servicio no sustituye consentimiento informado, politica de
privacidad ni evaluacion legal/clinica. La transcripcion experimental exige
confirmar el consentimiento del paciente antes de iniciarse.

## Transcripcion local

Solo el profesional, ya admitido el paciente, ve el icono de transcripcion en
los controles del video. `transcription.js` usa el reconocimiento de voz del
navegador con `processLocally = true`: dos reconocedores, uno con el microfono
del profesional y otro con el audio recibido del paciente, cada fragmento con
hablante y tiempo desde el inicio. Si el navegador no ofrece reconocimiento en
espanol dentro del equipo, no transcribe: nunca recurre a servicios externos.
Chrome 139 o posterior en computadora puede descargar el paquete de espanol en
el primer uso; Edge, Safari/iPhone y Chrome en celulares hoy lo rechazan.

Mientras transcribe, el paciente ve un aviso. El texto no se muestra en
pantalla ni se guarda en el servidor: queda en memoria del navegador y el
navegador advierte antes de cerrar con texto pendiente. Cortar la conexion
detiene la transcripcion. Al detenerla, el profesional elige:

- **Finalizar sin resumir**: borra el texto del equipo y no usa consultas de Sofia.
- **Resumir con Sofia (usa 1 consulta)**: `POST /api/consultations/summary` envia
  ambos canales (con marcas `[mm:ss]`, hasta 100000 caracteres cada uno) a la
  funcion `video-consultations`, que reclama una consulta de Sofia y devuelve un
  borrador (motivo, resumen e indicaciones). El texto de la transcripcion no se
  guarda. El profesional lo corrige y `POST /api/consultations/save` lo agrega
  como evolucion `[VIDEOCONSULTA]` en la historia clinica del paciente, una sola
  vez por sala; o descarta el borrador y conserva la transcripcion.
- **Descargar** los dos .txt independientes (profesional y paciente), opcional.

Si Dr Happy estaba abierto, hay que recargarlo para ver la evolucion nueva; el
guardado de la app conserva las evoluciones de videoconsulta aunque tenga datos
viejos. `transcription.test.mjs` cubre la logica con un motor simulado y la
prueba de navegador cubre el flujo completo de la sala.

## Registro y ciclo de vida

Al crear una sala se guarda una consulta vinculada al paciente del profesional
y, opcionalmente, a su turno. Se persisten solo metadatos: identificadores,
duracion, estado y fechas. No se persisten audio, video, mensajes de chat ni
transcripciones. El nombre del paciente se muestra solo al profesional, nunca
se incorpora a la invitacion ni a los metadatos enviados al participante paciente.

El servidor guarda el evento de inicio antes de admitir y habilitar los medios.
Si falla el guardado, la admision no se confirma. Al finalizar manualmente,
guarda la finalizacion antes de confirmar la accion; un fallo se informa al
profesional, sin emitir una confirmacion de exito.

Otros cierres revocan primero el acceso y detienen la sala. El servidor intenta
guardar su estado hasta tres veces, con 300 ms entre reintentos, e informa los
fallos en sus logs. Las salas y credenciales activas siguen en memoria: un
reinicio no restaura llamadas. La base reconcilia consultas vencidas al listar
las consultas del profesional, usando sus fechas de espera/inicio y duracion;
esto permite cerrar registros pendientes tras interrupciones del servicio.
No equivale a una garantia de conectividad ni de entrega inmediata de cierres.

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
seleccion de paciente y turno, toolbar a 360/390/768/1280 px, video mayor que
la altura movil anterior a 390x844 y 844x390, pantalla completa nativa en Edge
con todos los controles de sala, chat con teclado (visual viewport simulado),
ajuste sin scroll a 844x390 en pantalla completa nativa (antes y despues de
admitir) y en modo ampliado, con video completo y controles clicables,
Escape en modo de pagina ampliada con restauracion de scroll y foco,
geometria invariable al desplegar chat, contador, scroll interno y foco.
Los campos y selectores usan al menos 16 px en pantallas moviles o con puntero
grueso para evitar el zoom de foco de Safari. Conservan min-width:0 y
max-width:100%; la etiqueta viewport no limita el zoom manual por pellizco.
La aceptacion final por Internet requiere dos dispositivos en redes diferentes
con medios reales; no puede inferirse de las pruebas locales.
