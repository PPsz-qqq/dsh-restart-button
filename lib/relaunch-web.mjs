/**
 * dsh-restart-button — relaunch helper for `dsh web` (any platform).
 *
 * Started detached by the plugin's Host half with the spec as JSON in
 * `DSH_RESTART_SPEC`: { waitPid, command, args, cwd, port, statusFile, logFile,
 * serverLogFile, waitTimeoutMs }. It reports "ready", waits for the old server
 * process to finish its graceful shutdown (terminating it after waitTimeoutMs),
 * waits until nothing answers on the Web port, and starts the same command line
 * again, detached, appending its output to serverLogFile.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname } from 'node:path'

const spec = JSON.parse(process.env.DSH_RESTART_SPEC ?? '{}')
delete process.env.DSH_RESTART_SPEC

function stamp() {
  const d = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function log(message) {
  try {
    mkdirSync(dirname(spec.logFile), { recursive: true })
    appendFileSync(spec.logFile, `[${stamp()}] [web-helper ${process.pid}] ${message}\n`)
  } catch {}
}

function setStatus(value) {
  try {
    const tmp = `${spec.statusFile}.${process.pid}.tmp`
    writeFileSync(tmp, value)
    renameSync(tmp, spec.statusFile)
  } catch (error) {
    log(`could not write status "${value}": ${String(error)}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await sleep(100)
  }
  return !alive(pid)
}

/**
 * Whether something accepts connections on the loopback port. A listening server
 * accepts at once; a closed port is refused (on Windows only after ~2s of SYN
 * retries), so a probe that neither connects nor fails within 3s counts as free.
 */
function listening(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const done = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(3000, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

async function main() {
  if (!Number.isSafeInteger(spec.waitPid) || typeof spec.command !== 'string' || !Array.isArray(spec.args)) {
    throw new Error('invalid relaunch spec')
  }
  log(`start: wait for pid ${spec.waitPid}, then run ${JSON.stringify([spec.command, ...spec.args])} in ${spec.cwd}`)
  setStatus('ready')

  if (await waitGone(spec.waitPid, spec.waitTimeoutMs ?? 30000)) {
    log('server process exited')
  } else {
    log('server process still running; terminating it')
    try {
      process.kill(spec.waitPid)
    } catch {}
    await waitGone(spec.waitPid, 5000)
  }

  if (Number.isSafeInteger(spec.port) && spec.port > 0) {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && (await listening(spec.port))) await sleep(250)
    log(`port ${spec.port} ${(await listening(spec.port)) ? 'is still in use; starting anyway' : 'is free'}`)
  }

  mkdirSync(dirname(spec.serverLogFile), { recursive: true })
  const out = openSync(spec.serverLogFile, 'a')
  try {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: process.env,
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    })
    child.once('error', (error) => log(`relaunch failed: ${String(error)}`))
    log(`relaunched as pid ${child.pid}; output goes to ${spec.serverLogFile}`)
    child.unref()
  } finally {
    closeSync(out)
  }
  await sleep(500)
  rmSync(spec.statusFile, { force: true })
  log('restart complete')
}

main().catch((error) => {
  log(`restart failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  setStatus(`failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
