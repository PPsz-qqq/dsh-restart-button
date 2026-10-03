// Stand-in for the Electron main process: spawns the "Host" over IPC exactly like
// DesktopHostProcess does (non-detached, so libuv puts it in this process's
// kill-on-close job) and records whether it ever observes the Host closing.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dir = process.env.RB_TEST_DIR
const ev = (message) => appendFileSync(join(dir, 'events.log'), `${new Date().toISOString()} main(${process.pid}) ${message}\n`)

if (existsSync(join(dir, 'gen1.started'))) {
  ev(`RELAUNCHED argv=${JSON.stringify(process.argv.slice(1))} ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE ?? '<unset>'} DSH_RESTART_SPEC=${process.env.DSH_RESTART_SPEC === undefined ? '<unset>' : 'LEAKED'}`)
  writeFileSync(join(dir, 'relaunched'), String(process.pid))
  process.exit(0)
}
writeFileSync(join(dir, 'gen1.started'), String(process.pid))
ev('start')
const child = spawn(process.execPath, [join(here, 'dummy-host.mjs')], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
child.on('close', (code) => ev(`SAW HOST CLOSE code=${code} (would show the crash dialog)`))
setInterval(() => {}, 1000)
