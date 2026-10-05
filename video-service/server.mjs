import { createVideoServer } from './videoServer.mjs'

const port = Number(process.env.PORT || 5194)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT invalido.')
const app = createVideoServer()
app.server.listen(port, process.env.PORT ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Dr Happy video: puerto ${port}. Piloto administrativo, sin grabacion ni Sofia.`)
})
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => app.close().then(() => process.exit(0)))
