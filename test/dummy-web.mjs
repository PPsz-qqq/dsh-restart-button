// Stand-in for a `dsh web` server: runs the plugin's web restart entry point,
// then shuts down the way appExit(0) does; the relaunched copy records itself.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { beginWebRestart } from '../lib/index.js'

const dir = process.env.RB_TEST_DIR
const port = Number(process.env.RB_TEST_PORT)
const ev = (message) => appendFileSync(join(dir, 'events.log'), `${new Date().toISOString()} web(${process.pid}) ${message}\n`)

if (existsSync(join(dir, 'gen1.started'))) {
  ev(`RELAUNCHED argv=${JSON.stringify(process.argv.slice(1))} cwd=${process.cwd()} DSH_RESTART_SPEC=${process.env.DSH_RESTART_SPEC === undefined ? '<unset>' : 'LEAKED'}`)
  writeFileSync(join(dir, 'relaunched'), String(process.pid))
  process.exit(0)
}
writeFileSync(join(dir, 'gen1.started'), String(process.pid))
const server = createServer(() => {}).listen(port, '127.0.0.1')
ev(`start, listening on ${port}`)
try {
  await beginWebRestart({ port, logFile: join(dir, 'restart.log'), tmpDir: dir, serverLogFile: join(dir, 'server.log') })
  ev('helper ready; graceful shutdown')
  setTimeout(() => {
    server.close()
    ev('server closed; exiting')
  }, 800)
} catch (error) {
  ev(`ERROR ${error?.stack ?? error}`)
  server.close()
}
