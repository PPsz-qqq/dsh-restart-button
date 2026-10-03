/**
 * dsh-restart-button — Host half.
 *
 * Two authenticated Fetch routes on the shared `/api` channel (Host/Origin fence
 * and browser authentication are applied by `ctx.connection` before they run):
 *
 *   GET  api/restart-button.status   what this runtime can restart, whether work is running
 *   POST api/restart-button.restart  restart the whole client
 *
 * Desktop (Windows): this Host is the Node-mode child of the Electron main process.
 * A detached PowerShell helper (restart-desktop.ps1) verifies both processes and
 * suspends the Electron main process; the Host then disconnects its IPC channel,
 * which runs the desktop Host's own graceful quit path (sessions flushed, plugins
 * disposed) and exits. The helper ends the frozen shell, waits for the Web port
 * and starts the application again with its original arguments.
 *
 * Web (`dsh web`): a detached Node helper (relaunch-web.mjs) waits while this
 * process exits through the launcher's bounded `appExit(0)`, then starts the same
 * command line again.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader-visible plugin name. */
export const name = 'restart-button'
/** The Fetch-route registry is the only hard dependency. */
export const inject = ['connection']

export const STATUS_PATH = '/api/restart-button.status'
export const RESTART_PATH = '/api/restart-button.restart'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
export const DESKTOP_HELPER = join(LIB_DIR, 'restart-desktop.ps1')
export const WEB_HELPER = join(LIB_DIR, 'relaunch-web.mjs')
export const DETACH_LAUNCHER = join(LIB_DIR, 'detach.mjs')
const CONFIRM_POLICIES = new Set(['when-busy', 'always', 'never'])
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(LIB_DIR, '..', 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
})()

/**
 * Which restart strategy this process supports.
 * @param proc - the Node process object (replaceable by tests).
 * @returns 'desktop' for the Windows Electron Host, 'web' for a plain Node server, else 'unsupported'.
 */
export function detectMode(proc = process) {
  if (proc.versions?.electron !== undefined) {
    const ipc = typeof proc.send === 'function' && proc.connected === true
    return proc.platform === 'win32' && ipc && Number.isSafeInteger(proc.ppid) && proc.ppid > 0 ? 'desktop' : 'unsupported'
  }
  return 'web'
}

/** Restart log file under the DSH home (`~/.dsh/logs/restart-button.log`). */
export function logFilePath(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'logs', 'restart-button.log')
}

function stamp() {
  const d = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** Append-only logger that never throws. */
export function createLogger(file) {
  return (message) => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `[${stamp()}] [host ${process.pid}] ${message}\n`)
    } catch {}
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Environment for helpers and the relaunched application: the current one minus
 * Electron's Node-mode switch (an inherited ELECTRON_RUN_AS_NODE would start the
 * desktop executable as a bare Node runtime instead of the application).
 */
export function relaunchEnvironment(env = process.env, extra = {}) {
  const next = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') continue
    next[key] = value
  }
  return { ...next, ...extra }
}

/**
 * Whether restarting now would interrupt work: a running or queued Agent turn or a
 * running background job (same rule the desktop shell uses for its quit prompt).
 */
export function hasActiveTasks(ctx) {
  try {
    const agents = ctx.get('agents')
    const jobs = ctx.get('jobs')
    if (agents === undefined) return false
    const live = agents.list()
    const busyAgent = live.some((agent) => agent.status === 'running' || (agent.inbox?.nextTurn?.length ?? 0) > 0 || (agent.inbox?.nextStep?.length ?? 0) > 0)
    if (busyAgent) return true
    if (jobs === undefined) return false
    return [undefined, ...live.map((agent) => agent.id)].some((id) => jobs.list(id).some((job) => job.status === 'running' || job.status === 'stopping'))
  } catch {
    return false
  }
}

/**
 * Start one detached helper and expose its status file.
 * @returns `wait(predicate, timeoutMs)` resolving to the first matching status, or
 *   `undefined` on timeout; a spawn failure resolves to `failed: <reason>`.
 */
function launchHelper(command, args, options) {
  const statusFile = options.statusFile
  let spawnFailure
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: options.cwd,
    env: options.env,
  })
  child.once('error', (error) => {
    spawnFailure = `failed: could not start helper: ${messageOf(error)}`
  })
  child.unref()
  const read = () => {
    if (spawnFailure !== undefined) return spawnFailure
    try {
      return readFileSync(statusFile, 'utf8').trim()
    } catch {
      return undefined
    }
  }
  const wait = (predicate, timeoutMs) =>
    new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs
      const tick = () => {
        const value = read()
        if (value !== undefined && (value.startsWith('failed') || predicate(value))) return resolve(value)
        if (Date.now() >= deadline) return resolve(undefined)
        setTimeout(tick, 100)
      }
      tick()
    })
  return { child, statusFile, wait }
}

function defaultPowerShell(env = process.env) {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Desktop strategy, first half: start restart-desktop.ps1 and wait until it has
 * verified the process pair. The returned `ready` promise settles once the shell is
 * frozen (`ready …`) or the helper failed.
 * @param options - process ids, executable, Web port, log file, and test seams.
 */
export async function beginDesktopRestart(options) {
  const id = options.id ?? randomUUID()
  const statusFile = join(options.tmpDir ?? tmpdir(), `dsh-restart-button-${id}.status`)
  const spec = {
    mainPid: options.mainPid,
    hostPid: options.hostPid,
    exe: options.exe,
    port: options.port ?? 0,
    statusFile,
    logFile: options.logFile,
    startDelayMs: options.startDelayMs ?? 700,
    // The desktop shell itself escalates after 10s + 5s when a Host will not stop.
    hostExitTimeoutSec: options.hostExitTimeoutSec ?? 15,
    dryRun: options.dryRun === true,
  }
  // -EncodedCommand is not subject to the script execution policy; the bootstrap
  // compiles the shipped helper file and runs it in this one process.
  const bootstrap = "$ErrorActionPreference='Stop'; & ([ScriptBlock]::Create([IO.File]::ReadAllText($env:DSH_RESTART_SCRIPT, [Text.Encoding]::UTF8)))"
  const powershell = {
    command: options.powershell ?? defaultPowerShell(),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')],
  }
  // PowerShell cannot run detached (no console), so a detached Node-mode launcher
  // starts it with a hidden console; see detach.mjs.
  const helper = launchHelper(options.node ?? process.execPath, [DETACH_LAUNCHER], {
    statusFile,
    cwd: dirname(options.exe),
    env: relaunchEnvironment(process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      DSH_RESTART_EXEC: JSON.stringify(powershell),
      DSH_RESTART_SCRIPT: options.script ?? DESKTOP_HELPER,
      DSH_RESTART_SPEC: JSON.stringify(spec),
    }),
  })
  const verified = await helper.wait((value) => value === 'verified' || value.startsWith('dryrun'), options.verifyTimeoutMs ?? 30000)
  if (verified === undefined) throw new Error('restart helper did not report within the time limit')
  if (verified.startsWith('failed')) throw new Error(verified.replace(/^failed:\s*/, ''))
  return {
    id,
    statusFile,
    verified,
    ready: spec.dryRun ? Promise.resolve(verified) : helper.wait((value) => value.startsWith('ready'), options.readyTimeoutMs ?? 20000),
  }
}

/**
 * Web strategy, first half: start relaunch-web.mjs and wait until it is running.
 */
export async function beginWebRestart(options) {
  const id = options.id ?? randomUUID()
  const statusFile = join(options.tmpDir ?? tmpdir(), `dsh-restart-button-${id}.status`)
  const spec = {
    waitPid: options.waitPid ?? process.pid,
    command: options.command ?? process.execPath,
    args: options.args ?? [...process.execArgv, ...process.argv.slice(1)],
    cwd: options.cwd ?? process.cwd(),
    port: options.port ?? 0,
    statusFile,
    logFile: options.logFile,
    serverLogFile: options.serverLogFile ?? join(dirname(options.logFile), 'restart-button-web-server.log'),
    waitTimeoutMs: options.waitTimeoutMs ?? 30000,
  }
  const helper = launchHelper(options.node ?? process.execPath, [options.script ?? WEB_HELPER], {
    statusFile,
    cwd: spec.cwd,
    env: relaunchEnvironment(process.env, { DSH_RESTART_SPEC: JSON.stringify(spec) }),
  })
  const ready = await helper.wait((value) => value === 'ready', options.verifyTimeoutMs ?? 15000)
  if (ready === undefined) throw new Error('relaunch helper did not report within the time limit')
  if (ready.startsWith('failed')) throw new Error(ready.replace(/^failed:\s*/, ''))
  return { id, statusFile }
}

function json(status, body) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * Register the status and restart routes.
 * @param ctx - Host plugin context.
 * @param config - `{ confirm?: 'when-busy' | 'always' | 'never' }`; when the client asks
 *   for confirmation before restarting (default: only while tasks are running).
 */
export function apply(ctx, config = {}) {
  const logFile = logFilePath()
  const log = createLogger(logFile)
  const bootId = randomUUID()
  const confirm = CONFIRM_POLICIES.has(config?.confirm) ? config.confirm : 'when-busy'
  let disposed = false
  /** @type {{ id: string, state: 'pending' | 'handoff' | 'failed', error?: string, startedAt: number } | undefined} */
  let current
  ctx.effect(() => () => {
    disposed = true
  }, 'restart-button: lifecycle')

  const appExit = () => {
    const exit = ctx.get('appExit')
    return typeof exit === 'function' ? exit : undefined
  }
  const modeNow = () => {
    const mode = detectMode()
    return mode === 'web' && appExit() === undefined ? 'unsupported' : mode
  }
  const webPort = () => {
    const port = ctx.get('webServer')?.port
    return Number.isSafeInteger(port) && port > 0 ? port : 0
  }
  const fail = (error) => {
    current = { ...(current ?? { id: 'none', startedAt: Date.now() }), state: 'failed', error: messageOf(error) }
    log(`restart failed: ${messageOf(error)}`)
  }

  ctx.connection.fetch.register({
    path: STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const mode = modeNow()
      return json(200, {
        ok: true,
        version: VERSION,
        bootId,
        pid: process.pid,
        platform: process.platform,
        mode,
        supported: mode !== 'unsupported',
        activeTasks: hasActiveTasks(ctx),
        confirm,
        restart: current ?? null,
        logFile,
      })
    },
  })

  ctx.connection.fetch.register({
    path: RESTART_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      // A JSON body forces a CORS preflight for any cross-site attempt, on top of the
      // Connection fence that already admitted this request.
      if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
        return json(415, { ok: false, error: 'content-type must be application/json', logFile })
      }
      if (current !== undefined && current.state !== 'failed') {
        return json(409, { ok: false, error: 'a restart is already in progress', restart: current, logFile })
      }
      const mode = modeNow()
      if (mode === 'unsupported') {
        return json(409, { ok: false, error: `restart is not supported in this runtime (${process.platform}${process.versions.electron ? ', electron' : ''})`, logFile })
      }
      const id = randomUUID()
      current = { id, state: 'pending', startedAt: Date.now() }
      log(`restart ${id} requested (mode ${mode}, pid ${process.pid}, ppid ${process.ppid}, version ${VERSION})`)
      try {
        if (mode === 'desktop') {
          const run = await beginDesktopRestart({ id, mainPid: process.ppid, hostPid: process.pid, exe: process.execPath, port: webPort(), logFile })
          log(`restart ${id}: helper verified the desktop processes`)
          run.ready.then((status) => {
            if (status?.startsWith('ready')) {
              current = { ...current, state: 'handoff' }
              log(`restart ${id}: ${status}; disconnecting from the desktop shell for a graceful shutdown`)
              setTimeout(() => {
                try {
                  if (process.connected) process.disconnect()
                } catch (error) {
                  log(`disconnect failed: ${messageOf(error)}`)
                }
              }, 50)
            } else {
              fail(status === undefined ? 'restart helper stopped reporting' : status.replace(/^failed:\s*/, ''))
            }
          })
        } else {
          await beginWebRestart({ id, port: webPort(), logFile })
          current = { ...current, state: 'handoff' }
          log(`restart ${id}: relaunch helper is waiting; shutting down`)
          setTimeout(() => {
            if (!disposed) appExit()?.(0)
          }, 300)
        }
        return json(202, { ok: true, id, mode, bootId, logFile })
      } catch (error) {
        fail(error)
        return json(500, { ok: false, error: messageOf(error), logFile })
      }
    },
  })
}
