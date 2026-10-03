/**
 * dsh-restart-button — Host half.
 *
 * Authenticated Fetch routes on the shared `/api` channel (Host/Origin fence and
 * browser authentication are applied by `ctx.connection` before they run):
 *
 *   GET  api/restart-button.status      runtime facts, running work, pending plugin
 *                                       updates, scheduled restart, post-restart resume
 *   POST api/restart-button.restart     restart now, or `{ when: 'idle' }` once work ends
 *   POST api/restart-button.cancel      cancel a scheduled restart
 *   POST api/restart-button.resume-ack  forget the post-restart resume record
 *
 * Before restarting, the Host writes `~/.dsh/restart-button/last-restart.json`
 * (the Session the person was looking at and the Sessions the restart interrupts);
 * the next Host offers it once through `status.resume`.
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
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader-visible plugin name. */
export const name = 'restart-button'
/** The Fetch-route registry is the only hard dependency. */
export const inject = ['connection']

export const STATUS_PATH = '/api/restart-button.status'
export const RESTART_PATH = '/api/restart-button.restart'
export const CANCEL_PATH = '/api/restart-button.cancel'
export const RESUME_ACK_PATH = '/api/restart-button.resume-ack'

/** A resume record older than this is not offered after start-up. */
const RECORD_MAX_AGE_MS = 10 * 60 * 1000
/** A scheduled restart fires after this many consecutive idle checks… */
const IDLE_CHECKS_BEFORE_RESTART = 3
/** …taken at this interval. */
const SCHEDULE_CHECK_MS = 1000
/** Grace between a scheduled restart firing and the shell freezing, so open pages can show the cover. */
const SCHEDULED_START_DELAY_MS = 1500
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/

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

function dshHome(env = process.env) {
  return typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
}

/** Restart log file under the DSH home (`~/.dsh/logs/restart-button.log`). */
export function logFilePath(env = process.env) {
  return join(dshHome(env), 'logs', 'restart-button.log')
}

/** Resume record handed from one Host to the next (`~/.dsh/restart-button/last-restart.json`). */
export function recordFilePath(env = process.env) {
  return join(dshHome(env), 'restart-button', 'last-restart.json')
}

/**
 * Facts that belong to the process rather than to one plugin activation, so a
 * plugin reload neither changes the boot id (which pages use to recognise a new
 * server) nor forgets which plugin versions were loaded at start.
 */
function processState() {
  const key = Symbol.for('dsh-restart-button/process-state')
  globalThis[key] ??= {
    bootId: randomUUID(),
    startedAt: Date.now() - Math.round(process.uptime() * 1000),
    plugins: undefined,
    resume: undefined,
    resumeLoaded: false,
  }
  return globalThis[key]
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
 * What restarting now would interrupt: running or queued Agent turns and running
 * background jobs (the rule the desktop shell uses for its quit prompt), plus the
 * top-level Sessions that own that work — a busy sub-agent counts for its root.
 * @returns `activeTasks` and the busy root Session ids.
 */
export function analyzeActivity(ctx) {
  const result = { activeTasks: false, busySessions: [] }
  try {
    const agents = ctx.get('agents')
    if (agents === undefined) return result
    const jobs = ctx.get('jobs')
    const live = agents.list()
    const runningJob = (job) => job.status === 'running' || job.status === 'stopping'
    const busy = (agent) =>
      agent.status === 'running' ||
      (agent.inbox?.nextTurn?.length ?? 0) > 0 ||
      (agent.inbox?.nextStep?.length ?? 0) > 0 ||
      (jobs?.list(agent.id).some(runningJob) ?? false)
    const owned = (id, owner) => {
      try {
        return agents.isOwnedBy(id, owner) === true
      } catch {
        return false
      }
    }
    const roots = typeof agents.roots === 'function' ? agents.roots() : live
    for (const root of roots) {
      const queue = [root]
      const seen = new Set([String(root.id)])
      let found = false
      while (queue.length > 0 && !found) {
        const agent = queue.shift()
        if (busy(agent)) found = true
        else
          for (const child of live) {
            if (seen.has(String(child.id)) || !owned(child.id, agent)) continue
            seen.add(String(child.id))
            queue.push(child)
          }
      }
      if (found) result.busySessions.push(String(root.id))
    }
    result.activeTasks = result.busySessions.length > 0 || live.some(busy) || (jobs?.list(undefined).some(runningJob) ?? false)
  } catch {}
  return result
}

/** Whether restarting now would interrupt work. */
export function hasActiveTasks(ctx) {
  return analyzeActivity(ctx).activeTasks
}

/**
 * The profile's installed plugin packages: name → { spec, version }.
 * @param profileDir - profile directory (its package.json and hoisted node_modules).
 */
export function readProfilePlugins(profileDir) {
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const plugins = new Map()
  for (const [pkg, spec] of Object.entries(manifest.dependencies ?? {})) {
    let version = null
    try {
      version = JSON.parse(readFileSync(join(profileDir, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8')).version ?? null
    } catch {}
    plugins.set(pkg, { spec: String(spec), version })
  }
  return plugins
}

/**
 * Track which plugin versions the running process has loaded and report those that
 * changed on disk underneath it. Node caches an ES module by its file URL for the
 * life of the process, so once a package's Host half has been imported, neither an
 * in-place update nor a remove-and-install brings its new code in; only a package
 * this process has never seen is loaded live. Removed packages therefore keep their
 * loaded entry.
 * @param loaded - name → loaded { spec, version }; updated in place.
 * @param current - the profile's packages now.
 * @returns the packages whose on-disk copy differs from the loaded one.
 */
export function reconcilePlugins(loaded, current) {
  for (const [pkg, info] of current) if (!loaded.has(pkg)) loaded.set(pkg, info)
  const pending = []
  for (const [pkg, info] of current) {
    const was = loaded.get(pkg)
    if (was.spec !== info.spec || was.version !== info.version) pending.push({ name: pkg, from: was.version, to: info.version })
  }
  return pending
}

function readRecord(file) {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'))
    return typeof record === 'object' && record !== null && record.version === 1 ? record : undefined
  } catch {
    return undefined
  }
}

function writeRecord(file, record) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(record, null, 2))
  renameSync(tmp, file)
}

function removeRecord(file, id) {
  const record = readRecord(file)
  if (record !== undefined && (id === undefined || record.id === id)) rmSync(file, { force: true })
}

/** The part of a record a page needs to restore what the restart interrupted. */
function resumeView(record) {
  const ids = Array.isArray(record.interrupted) ? record.interrupted.filter((id) => typeof id === 'string' && SESSION_ID.test(id)) : []
  return {
    id: String(record.id),
    at: Number(record.at),
    activeSessionId: typeof record.activeSessionId === 'string' && SESSION_ID.test(record.activeSessionId) ? record.activeSessionId : null,
    interrupted: [...new Set(ids)],
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

/** A JSON body forces a CORS preflight for any cross-site attempt, on top of the Connection fence. */
function isJsonRequest(request) {
  return /^application\/json\b/i.test(request.headers.get('content-type') ?? '')
}

async function readJsonBody(request) {
  try {
    const value = await request.json()
    return typeof value === 'object' && value !== null ? value : {}
  } catch {
    return {}
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Collaborators `createRestartButton` uses; tests replace them. */
const DEFAULT_DEPS = {
  detectMode: () => detectMode(),
  beginDesktopRestart,
  beginWebRestart,
  disconnect: () => {
    if (process.connected) process.disconnect()
  },
  logFile: () => logFilePath(),
  recordFile: () => recordFilePath(),
  processState,
  now: () => Date.now(),
  scheduleCheckMs: SCHEDULE_CHECK_MS,
  scheduledStartDelayMs: SCHEDULED_START_DELAY_MS,
}

/**
 * Register the routes.
 * @param ctx - Host plugin context.
 * @param config - `{ confirm?: 'when-busy' | 'always' | 'never' }`: when the page asks before
 *   restarting (default: only while work is running).
 */
export function apply(ctx, config = {}) {
  createRestartButton(ctx, config)
}

/**
 * The plugin body behind {@link apply}, with replaceable collaborators.
 * @param ctx - Host plugin context.
 * @param config - plugin configuration.
 * @param overrides - test seams for {@link DEFAULT_DEPS}.
 */
export function createRestartButton(ctx, config = {}, overrides = {}) {
  const deps = { ...DEFAULT_DEPS, ...overrides }
  const logFile = deps.logFile()
  const recordFile = deps.recordFile()
  const log = createLogger(logFile)
  const proc = deps.processState()
  const confirm = CONFIRM_POLICIES.has(config?.confirm) ? config.confirm : 'when-busy'
  let disposed = false
  /** @type {{ id: string, state: 'pending' | 'handoff' | 'failed', reason?: string, error?: string, startedAt: number } | undefined} */
  let current
  /** @type {{ since: number, activeSessionId?: string, idleChecks: number, timer?: ReturnType<typeof setInterval> } | undefined} */
  let scheduled

  const appExit = () => {
    const exit = ctx.get('appExit')
    return typeof exit === 'function' ? exit : undefined
  }
  const modeNow = () => {
    const mode = deps.detectMode()
    return mode === 'web' && appExit() === undefined ? 'unsupported' : mode
  }
  const webPort = () => {
    const port = ctx.get('webServer')?.port
    return Number.isSafeInteger(port) && port > 0 ? port : 0
  }
  const inProgress = () => current !== undefined && current.state !== 'failed'
  const fail = (error) => {
    current = { ...(current ?? { id: 'none', startedAt: deps.now() }), state: 'failed', error: messageOf(error) }
    log(`restart failed: ${messageOf(error)}`)
  }

  // ---- plugin versions loaded by this process vs. on disk
  const scanPlugins = () => {
    const dir = ctx.get('profileContext')?.dir
    if (typeof dir !== 'string') return []
    try {
      const now = readProfilePlugins(dir)
      if (proc.plugins === undefined) {
        proc.plugins = now
        return []
      }
      return reconcilePlugins(proc.plugins, now)
    } catch {
      return []
    }
  }
  scanPlugins()
  ctx.on('plugin-manager/changed', () => {
    const pending = scanPlugins()
    if (pending.length > 0) log(`plugin updates wait for a restart: ${pending.map((p) => `${p.name} ${p.from} -> ${p.to}`).join(', ')}`)
  })

  // ---- what the previous Host left for this one
  if (!proc.resumeLoaded) {
    proc.resumeLoaded = true
    const record = readRecord(recordFile)
    if (record !== undefined && record.fromPid !== process.pid) {
      if (deps.now() - Number(record.at) < RECORD_MAX_AGE_MS) {
        proc.resume = resumeView(record)
        log(`resume record ${proc.resume.id}: open ${proc.resume.activeSessionId ?? '-'}, interrupted [${proc.resume.interrupted.join(', ')}]`)
      } else {
        removeRecord(recordFile, record.id)
      }
    }
  }

  // ---- restarting
  const startRestart = async ({ reason, activeSessionId, delayMs = 0 }) => {
    const mode = modeNow()
    if (mode === 'unsupported') throw new Error(`restart is not supported in this runtime (${process.platform}${process.versions.electron ? ', electron' : ''})`)
    const id = randomUUID()
    current = { id, state: 'pending', reason, startedAt: deps.now() }
    const previous = proc.resume
    const interrupted = [...new Set([...(previous?.interrupted ?? []), ...analyzeActivity(ctx).busySessions])]
    const record = {
      version: 1,
      id,
      at: deps.now(),
      fromPid: process.pid,
      fromBootId: proc.bootId,
      mode,
      reason,
      activeSessionId: activeSessionId ?? previous?.activeSessionId ?? null,
      interrupted,
    }
    try {
      writeRecord(recordFile, record)
    } catch (error) {
      log(`could not write the resume record: ${messageOf(error)}`)
    }
    log(`restart ${id} requested (${reason}, mode ${mode}, pid ${process.pid}, ppid ${process.ppid}, version ${VERSION}); open ${record.activeSessionId ?? '-'}, interrupting [${interrupted.join(', ')}]`)
    try {
      if (delayMs > 0) await delay(delayMs)
      if (mode === 'desktop') {
        const run = await deps.beginDesktopRestart({ id, mainPid: process.ppid, hostPid: process.pid, exe: process.execPath, port: webPort(), logFile })
        log(`restart ${id}: helper verified the desktop processes`)
        run.ready.then((status) => {
          if (status?.startsWith('ready')) {
            current = { ...current, state: 'handoff' }
            log(`restart ${id}: ${status}; disconnecting from the desktop shell for a graceful shutdown`)
            setTimeout(() => {
              try {
                deps.disconnect()
              } catch (error) {
                log(`disconnect failed: ${messageOf(error)}`)
              }
            }, 50)
          } else {
            fail(status === undefined ? 'restart helper stopped reporting' : status.replace(/^failed:\s*/, ''))
            removeRecord(recordFile, id)
          }
        })
      } else {
        await deps.beginWebRestart({ id, port: webPort(), logFile })
        current = { ...current, state: 'handoff' }
        log(`restart ${id}: relaunch helper is waiting; shutting down`)
        setTimeout(() => {
          if (!disposed) appExit()?.(0)
        }, 300)
      }
      return { id, mode }
    } catch (error) {
      fail(error)
      removeRecord(recordFile, id)
      throw error
    }
  }

  // ---- restart once running work has finished
  const cancelSchedule = (why) => {
    if (scheduled === undefined) return false
    clearInterval(scheduled.timer)
    scheduled = undefined
    log(`scheduled restart cancelled (${why})`)
    return true
  }
  const schedule = ({ activeSessionId }) => {
    if (scheduled !== undefined) {
      if (activeSessionId !== undefined) scheduled.activeSessionId = activeSessionId
      return scheduled
    }
    const entry = { since: deps.now(), activeSessionId, idleChecks: 0, timer: undefined }
    entry.timer = setInterval(() => {
      if (disposed || scheduled !== entry) return
      entry.idleChecks = analyzeActivity(ctx).activeTasks ? 0 : entry.idleChecks + 1
      if (entry.idleChecks < IDLE_CHECKS_BEFORE_RESTART) return
      clearInterval(entry.timer)
      scheduled = undefined
      if (inProgress()) return
      log('running work finished; starting the scheduled restart')
      startRestart({ reason: 'idle', activeSessionId: entry.activeSessionId, delayMs: deps.scheduledStartDelayMs }).catch(() => {})
    }, deps.scheduleCheckMs)
    scheduled = entry
    log(`restart scheduled for when running work finishes (open ${activeSessionId ?? '-'})`)
    return entry
  }

  ctx.effect(() => () => {
    disposed = true
    cancelSchedule('plugin unloaded')
  }, 'restart-button: lifecycle')

  // ---- routes
  ctx.connection.fetch.register({
    path: STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const mode = modeNow()
      const activity = analyzeActivity(ctx)
      const memory = process.memoryUsage()
      return json(200, {
        ok: true,
        version: VERSION,
        bootId: proc.bootId,
        pid: process.pid,
        platform: process.platform,
        mode,
        supported: mode !== 'unsupported',
        confirm,
        activeTasks: activity.activeTasks,
        busySessions: activity.busySessions,
        runtime: {
          startedAt: proc.startedAt,
          uptimeSec: Math.round(process.uptime()),
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
        },
        restart: current ?? null,
        scheduled: scheduled === undefined ? null : { since: scheduled.since, activeSessionId: scheduled.activeSessionId ?? null },
        pendingPlugins: scanPlugins(),
        resume: proc.resume ?? null,
        logFile,
      })
    },
  })

  ctx.connection.fetch.register({
    path: RESTART_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (!isJsonRequest(request)) return json(415, { ok: false, error: 'content-type must be application/json', logFile })
      const body = await readJsonBody(request)
      const activeSessionId = typeof body.activeSessionId === 'string' && SESSION_ID.test(body.activeSessionId) ? body.activeSessionId : undefined
      if (inProgress()) return json(409, { ok: false, error: 'a restart is already in progress', restart: current, logFile })
      const mode = modeNow()
      if (mode === 'unsupported') {
        return json(409, { ok: false, error: `restart is not supported in this runtime (${process.platform}${process.versions.electron ? ', electron' : ''})`, logFile })
      }
      if (body.when === 'idle' && analyzeActivity(ctx).activeTasks) {
        const entry = schedule({ activeSessionId })
        return json(202, { ok: true, scheduled: true, since: entry.since, mode, bootId: proc.bootId, logFile })
      }
      cancelSchedule('superseded by an immediate restart')
      try {
        const { id } = await startRestart({ reason: body.when === 'idle' ? 'idle' : 'button', activeSessionId })
        return json(202, { ok: true, id, mode, bootId: proc.bootId, logFile })
      } catch (error) {
        return json(500, { ok: false, error: messageOf(error), logFile })
      }
    },
  })

  ctx.connection.fetch.register({
    path: CANCEL_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (!isJsonRequest(request)) return json(415, { ok: false, error: 'content-type must be application/json' })
      return json(200, { ok: true, cancelled: cancelSchedule('cancelled from the page') })
    },
  })

  ctx.connection.fetch.register({
    path: RESUME_ACK_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (!isJsonRequest(request)) return json(415, { ok: false, error: 'content-type must be application/json' })
      const body = await readJsonBody(request)
      const resume = proc.resume
      if (resume !== undefined && (body.id === undefined || body.id === resume.id)) {
        proc.resume = undefined
        removeRecord(recordFile, resume.id)
        log(`resume record ${resume.id} handled (${typeof body.action === 'string' ? body.action.slice(0, 40) : 'ack'})`)
      }
      return json(200, { ok: true })
    },
  })

  log(`restart-button ${VERSION} active (pid ${process.pid}, mode ${modeNow()})`)
}
