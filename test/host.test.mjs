// Host half without a DSH runtime: a fake context records the routes, fake agents and
// jobs drive the activity rules, and fake restart starters stand in for the helpers.
// Run: node test/host.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANCEL_PATH, RESTART_PATH, RESUME_ACK_PATH, STATUS_PATH, analyzeActivity, createRestartButton, reconcilePlugins } from '../lib/index.js'

const root = mkdtempSync(join(tmpdir(), 'rb-host-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let passed = 0
async function test(name, body) {
  await body()
  passed++
  console.log(`ok - ${name}`)
}

function agentsOf(spec) {
  // spec: [{ id, parent?, status?, queued? }]
  const all = spec.map((a) => ({ id: a.id, status: a.status ?? 'idle', inbox: { nextTurn: a.queued ? ['m'] : [], nextStep: [] } }))
  const parent = Object.fromEntries(spec.filter((a) => a.parent).map((a) => [a.id, a.parent]))
  return {
    all,
    service: {
      list: () => [...all],
      roots: () => all.filter((a) => parent[a.id] === undefined),
      isOwnedBy: (id, owner) => parent[id] === owner.id,
    },
  }
}

function fakeCtx({ agents, jobs = { list: () => [] }, profileDir, appExit }) {
  const routes = new Map()
  const listeners = new Map()
  const disposers = []
  return {
    routes,
    emit(name, ...args) {
      for (const fn of listeners.get(name) ?? []) fn(...args)
    },
    get(name) {
      return { agents, jobs, appExit, profileContext: profileDir ? { dir: profileDir } : undefined, webServer: { port: 3999 } }[name]
    },
    on(name, fn) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn])
      return () => {}
    },
    effect(fn) {
      disposers.push(fn())
    },
    dispose() {
      for (const d of disposers) d?.()
    },
    connection: { fetch: { register: (route) => routes.set(route.path, route) } },
  }
}

async function call(ctx, path, body) {
  const route = ctx.routes.get(path)
  const init = body === undefined ? { method: route.methods[0] } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await route.fetch(new Request(`http://127.0.0.1${path}`, init))
  return { status: response.status, body: await response.json() }
}

function setup(name, { agents, mode = 'web', profileDir, record } = {}) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const recordFile = join(dir, 'last-restart.json')
  if (record) writeFileSync(recordFile, JSON.stringify(record))
  const calls = { web: [], desktop: [], exit: [], disconnect: 0 }
  let releaseReady
  const ctx = fakeCtx({ agents, profileDir, appExit: (code) => calls.exit.push(code) })
  createRestartButton(ctx, {}, {
    detectMode: () => mode,
    logFile: () => join(dir, 'restart.log'),
    recordFile: () => recordFile,
    processState: () => (setup.state[name] ??= { bootId: `boot-${name}`, startedAt: Date.now() - 5000, plugins: undefined, resume: undefined, resumeLoaded: false }),
    beginWebRestart: async (options) => {
      calls.web.push(options)
      return { id: options.id }
    },
    beginDesktopRestart: async (options) => {
      calls.desktop.push(options)
      return { verified: 'verified', ready: new Promise((resolve) => (releaseReady = resolve)) }
    },
    disconnect: () => calls.disconnect++,
    scheduleCheckMs: 20,
    scheduledStartDelayMs: 10,
  })
  return { ctx, calls, recordFile, dir, ready: (value) => releaseReady(value) }
}
setup.state = {}

await test('activity: busy sub-agents count for their root, idle roots do not', async () => {
  const { service } = agentsOf([
    { id: 'A', status: 'running' },
    { id: 'B' },
    { id: 'C', parent: 'B', status: 'running' },
    { id: 'D' },
    { id: 'E', queued: true },
  ])
  const jobs = { list: (id) => (id === 'D' ? [{ status: 'running' }] : []) }
  const activity = analyzeActivity({ get: (name) => ({ agents: service, jobs })[name] })
  assert.equal(activity.activeTasks, true)
  assert.deepEqual(activity.busySessions, ['A', 'B', 'D', 'E'])
  assert.deepEqual(analyzeActivity({ get: (name) => ({ agents: agentsOf([{ id: 'X' }]).service })[name] }), { activeTasks: false, busySessions: [] })
})

await test('plugins: loaded code is cached for the process; only never-seen packages load live', async () => {
  const loaded = new Map([['a', { spec: '^1', version: '1.0.0' }], ['b', { spec: '1', version: '1.0.0' }]])
  // in-place update of a
  assert.deepEqual(reconcilePlugins(loaded, new Map([['a', { spec: '^1', version: '1.1.0' }], ['b', { spec: '1', version: '1.0.0' }]])), [{ name: 'a', from: '1.0.0', to: '1.1.0' }])
  // b removed, then installed again at a new version: its old Host module is still cached
  assert.deepEqual(reconcilePlugins(loaded, new Map([['a', { spec: '^1', version: '1.1.0' }]])), [{ name: 'a', from: '1.0.0', to: '1.1.0' }])
  assert.deepEqual(reconcilePlugins(loaded, new Map([['a', { spec: '^1', version: '1.1.0' }], ['b', { spec: '2', version: '2.0.0' }]])), [{ name: 'a', from: '1.0.0', to: '1.1.0' }, { name: 'b', from: '1.0.0', to: '2.0.0' }])
  // b reinstalled at the loaded version is fine again; a brand-new package loads live
  assert.deepEqual(reconcilePlugins(loaded, new Map([['a', { spec: '^1', version: '1.0.0' }], ['b', { spec: '1', version: '1.0.0' }], ['c', { spec: '3', version: '3.0.0' }]])), [])
})

await test('status: runtime, activity, pending plugins from a real profile layout', async () => {
  const profileDir = join(root, 'profile')
  const writePkg = (pkg, version) => {
    mkdirSync(join(profileDir, 'node_modules', ...pkg.split('/')), { recursive: true })
    writeFileSync(join(profileDir, 'node_modules', ...pkg.split('/'), 'package.json'), JSON.stringify({ name: pkg, version }))
  }
  const writeManifest = (deps) => writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: deps }))
  writePkg('dsh-better-sidebar', '0.24.1')
  writePkg('@scope/tool', '1.0.0')
  writeManifest({ 'dsh-better-sidebar': '0.24.1', '@scope/tool': '^1.0.0' })
  const { ctx } = setup('status', { agents: agentsOf([{ id: 'S1', status: 'running' }]).service, profileDir })
  let { status, body } = await call(ctx, STATUS_PATH)
  assert.equal(status, 200)
  assert.equal(body.bootId, 'boot-status')
  assert.equal(body.mode, 'web')
  assert.equal(body.supported, true)
  assert.equal(body.activeTasks, true)
  assert.deepEqual(body.busySessions, ['S1'])
  assert.ok(body.runtime.uptimeSec >= 0 && body.runtime.rssBytes > 0)
  assert.deepEqual(body.pendingPlugins, [])
  assert.equal(body.scheduled, null)
  assert.equal(body.resume, null)
  writePkg('dsh-better-sidebar', '0.25.0')
  writeManifest({ 'dsh-better-sidebar': '0.25.0', '@scope/tool': '^1.0.0' })
  ctx.emit('plugin-manager/changed', { reason: 'install' })
  ;({ body } = await call(ctx, STATUS_PATH))
  assert.deepEqual(body.pendingPlugins, [{ name: 'dsh-better-sidebar', from: '0.24.1', to: '0.25.0' }])
})

await test('restart now: writes the resume record and exits through appExit (web)', async () => {
  const { ctx, calls, recordFile } = setup('now', { agents: agentsOf([{ id: 'R1', status: 'running' }, { id: 'R2' }]).service })
  const { status, body } = await call(ctx, RESTART_PATH, { activeSessionId: 'session-open-1' })
  assert.equal(status, 202)
  assert.equal(body.ok, true)
  assert.equal(calls.web.length, 1)
  const record = JSON.parse(readFileSync(recordFile, 'utf8'))
  assert.equal(record.activeSessionId, 'session-open-1')
  assert.deepEqual(record.interrupted, ['R1'])
  assert.equal(record.fromPid, process.pid)
  await sleep(350)
  assert.deepEqual(calls.exit, [0])
  assert.equal((await call(ctx, RESTART_PATH, {})).status, 409, 'second restart is refused while one is in progress')
})

await test('restart requires a JSON body; bad session ids are dropped', async () => {
  const { ctx, recordFile } = setup('json', { agents: agentsOf([]).service })
  const route = ctx.routes.get(RESTART_PATH)
  const response = await route.fetch(new Request('http://127.0.0.1/x', { method: 'POST', body: 'when=now' }))
  assert.equal(response.status, 415)
  await call(ctx, RESTART_PATH, { activeSessionId: '../../etc/passwd' })
  assert.equal(JSON.parse(readFileSync(recordFile, 'utf8')).activeSessionId, null)
})

await test('when idle: schedules while busy, fires after work ends, cancel works', async () => {
  const agents = agentsOf([{ id: 'W1', status: 'running' }])
  const { ctx, calls, recordFile } = setup('idle', { agents: agents.service })
  let { status, body } = await call(ctx, RESTART_PATH, { when: 'idle', activeSessionId: 'W1' })
  assert.equal(status, 202)
  assert.equal(body.scheduled, true)
  ;({ body } = await call(ctx, STATUS_PATH))
  assert.equal(body.scheduled.activeSessionId, 'W1')
  assert.deepEqual((await call(ctx, CANCEL_PATH, {})).body, { ok: true, cancelled: true })
  assert.equal((await call(ctx, STATUS_PATH)).body.scheduled, null)
  await call(ctx, RESTART_PATH, { when: 'idle', activeSessionId: 'W1' })
  await sleep(100)
  assert.equal(calls.web.length, 0, 'still busy, nothing started')
  agents.all[0].status = 'idle'
  await sleep(200)
  assert.equal(calls.web.length, 1, 'started after three idle checks')
  assert.equal((await call(ctx, STATUS_PATH)).body.restart.reason, 'idle')
  assert.equal(JSON.parse(readFileSync(recordFile, 'utf8')).activeSessionId, 'W1')
})

await test('when idle with nothing running restarts at once', async () => {
  const { ctx, calls } = setup('idle-now', { agents: agentsOf([]).service })
  const { body } = await call(ctx, RESTART_PATH, { when: 'idle' })
  assert.equal(body.scheduled, undefined)
  assert.equal(calls.web.length, 1)
})

await test('desktop: disconnects only after the helper reports ready', async () => {
  const { ctx, calls, ready } = setup('desktop', { agents: agentsOf([]).service, mode: 'desktop' })
  assert.equal((await call(ctx, RESTART_PATH, {})).status, 202)
  assert.equal(calls.desktop.length, 1)
  assert.equal(calls.disconnect, 0)
  ready('ready suspended')
  await sleep(100)
  assert.equal(calls.disconnect, 1)
  assert.equal((await call(ctx, STATUS_PATH)).body.restart.state, 'handoff')
})

await test('desktop: helper failure clears the resume record and reports failed', async () => {
  const { ctx, recordFile, ready } = setup('desktop-fail', { agents: agentsOf([]).service, mode: 'desktop' })
  await call(ctx, RESTART_PATH, {})
  assert.ok(existsSync(recordFile))
  ready('failed: OpenProcess denied')
  await sleep(50)
  assert.equal(existsSync(recordFile), false)
  const { body } = await call(ctx, STATUS_PATH)
  assert.equal(body.restart.state, 'failed')
  assert.equal(body.restart.error, 'OpenProcess denied')
})

await test('resume: a fresh record from another process is offered once and acknowledged', async () => {
  const record = { version: 1, id: 'r-1', at: Date.now() - 1000, fromPid: process.pid + 1, activeSessionId: 'open-1', interrupted: ['a', 'b', 'a', 'bad id!'] }
  const { ctx, recordFile } = setup('resume', { agents: agentsOf([]).service, record })
  let { body } = await call(ctx, STATUS_PATH)
  assert.deepEqual(body.resume, { id: 'r-1', at: record.at, activeSessionId: 'open-1', interrupted: ['a', 'b'] })
  await call(ctx, RESUME_ACK_PATH, { id: 'r-1', action: 'continue' })
  ;({ body } = await call(ctx, STATUS_PATH))
  assert.equal(body.resume, null)
  assert.equal(existsSync(recordFile), false)
})

await test('resume: stale records are discarded, unacknowledged ones merge into the next restart', async () => {
  const stale = setup('stale', { agents: agentsOf([]).service, record: { version: 1, id: 'old', at: Date.now() - 3600_000, fromPid: process.pid + 1, interrupted: ['x'] } })
  assert.equal((await call(stale.ctx, STATUS_PATH)).body.resume, null)
  assert.equal(existsSync(stale.recordFile), false)
  const merge = setup('merge', { agents: agentsOf([{ id: 'new', status: 'running' }]).service, record: { version: 1, id: 'prev', at: Date.now(), fromPid: process.pid + 1, activeSessionId: 'keep', interrupted: ['old'] } })
  await call(merge.ctx, RESTART_PATH, {})
  const written = JSON.parse(readFileSync(merge.recordFile, 'utf8'))
  assert.deepEqual(written.interrupted, ['old', 'new'])
  assert.equal(written.activeSessionId, 'keep')
})

await test('unsupported runtimes refuse to restart', async () => {
  const { ctx } = setup('unsupported', { agents: agentsOf([]).service, mode: 'unsupported' })
  const { body } = await call(ctx, STATUS_PATH)
  assert.equal(body.supported, false)
  assert.equal((await call(ctx, RESTART_PATH, {})).status, 409)
})

rmSync(root, { recursive: true, force: true })
console.log(`\n${passed} host tests passed`)
