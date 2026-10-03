/**
 * dsh-restart-button — detached launcher.
 *
 * Windows PowerShell exits immediately when it is started with DETACHED_PROCESS
 * (Node's `detached: true`), because its console host has no console to attach
 * to. A non-detached child, however, is placed in the parent's kill-on-close job
 * object and would die together with the Host it is supposed to outlive.
 *
 * This script runs detached (the runtime is the Host's own executable: Node, or
 * Electron with ELECTRON_RUN_AS_NODE=1) and starts the command from
 * `DSH_RESTART_EXEC` ({ command, args }) as an ordinary child with a hidden
 * console, then waits for it. Its own wiring variables are removed first, so
 * nothing leaks into the restarted application.
 */
import { spawn } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'

const exec = JSON.parse(process.env.DSH_RESTART_EXEC ?? '{}')
delete process.env.DSH_RESTART_EXEC
delete process.env.ELECTRON_RUN_AS_NODE

function reportFailure(message) {
  try {
    const { statusFile } = JSON.parse(process.env.DSH_RESTART_SPEC ?? '{}')
    if (typeof statusFile !== 'string') return
    const tmp = `${statusFile}.${process.pid}.tmp`
    writeFileSync(tmp, `failed: ${message}`)
    renameSync(tmp, statusFile)
  } catch {}
}

if (typeof exec.command !== 'string' || !Array.isArray(exec.args)) {
  reportFailure('invalid launcher spec')
  process.exit(2)
}

const child = spawn(exec.command, exec.args, { stdio: 'ignore', windowsHide: true, env: process.env })
child.once('error', (error) => {
  reportFailure(`could not start ${exec.command}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
child.once('exit', (code) => {
  process.exit(code ?? 0)
})
