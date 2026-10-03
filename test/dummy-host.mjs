// Stand-in for the desktop Host: listens on a port, tears down "gracefully" on IPC
// disconnect (like dsh-desktop-host's process.once('disconnect', stop)), and runs
// the plugin's real desktop restart entry point against its parent.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { beginDesktopRestart } from '../lib/index.js'

const dir = process.env.RB_TEST_DIR
const port = Number(process.env.RB_TEST_PORT)
const ev = (message) => appendFileSync(join(dir, 'events.log'), `${new Date().toISOString()} host(${process.pid}) ${message}\n`)

const server = createServer(() => {}).listen(port, '127.0.0.1')
process.once('disconnect', () => {
  ev('disconnect -> graceful stop begins')
  setTimeout(() => {
    server.close()
    ev('graceful stop complete; exiting')
  }, 1200)
})
ev(`start (parent ${process.ppid}), listening on ${port}`)
try {
  const run = await beginDesktopRestart({
    mainPid: process.ppid,
    hostPid: process.pid,
    exe: process.execPath,
    port,
    logFile: join(dir, 'restart.log'),
    tmpDir: dir,
    startDelayMs: 300,
    dryRun: process.env.RB_TEST_DRYRUN === '1',
  })
  ev(`helper answered: ${run.verified}`)
  const status = await run.ready
  ev(`ready status: ${status}`)
  if (status?.startsWith('ready')) process.disconnect()
  else if (process.connected) process.disconnect()
} catch (error) {
  ev(`ERROR ${error?.stack ?? error}`)
  process.disconnect()
}
