// Client half rendered with real React 18 in jsdom against a scripted fake Host.
// The DSH primitives are replaced by small stand-ins with the same props.
// Needs react@18, react-dom@18 and jsdom installed in a folder named by RB_CLIENT_DEPS:
//   RB_CLIENT_DEPS=<dir> node test/client.test.cjs
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join } = require('node:path')

const depsDir = process.env.RB_CLIENT_DEPS
if (!depsDir) throw new Error('set RB_CLIENT_DEPS to a folder with react@18, react-dom@18 and jsdom installed')
const requireDep = createRequire(join(depsDir, 'package.json'))
const { JSDOM } = requireDep('jsdom')
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:19387/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = requireDep('react')
const ReactDOM = requireDep('react-dom')
const { createRoot } = requireDep('react-dom/client')
const jsxRuntime = requireDep('react/jsx-runtime')
const { act } = React

// ---------------------------------------------------------------- primitives stand-ins
const h = React.createElement
const ui = {
  Button: React.forwardRef(function Button({ variant, size, icon, ...rest }, ref) {
    return h('button', { ref, type: 'button', 'data-variant': variant, ...rest })
  }),
  Tooltip({ label, children }) {
    return React.cloneElement(children, { 'data-tooltip': typeof label === 'function' ? label() : label })
  },
  Modal({ open, title, description, children, footer }) {
    if (!open) return null
    return h('div', { role: 'dialog', 'data-title': title }, h('h2', null, title), description ? h('p', null, description) : null, children, h('footer', null, footer))
  },
  IconRefreshOutlineRegular: () => h('svg', { 'data-icon': 'refresh' }),
  IconWarningOutlineRegular: () => h('svg', { 'data-icon': 'warning' }),
}

// ---------------------------------------------------------------- load the bundle
let registration
dom.window.__ModuleLoader__ = { load: (r) => (registration = r) }
new Function(readFileSync(join(__dirname, '..', 'lib', 'client.js'), 'utf8'))()
const modules = { react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': ReactDOM, '@deepseek-ai/dsh-client-ui-primitives': ui }
const plugin = registration.factory((id) => {
  if (!(id in modules)) throw new Error(`unexpected require ${id}`)
  return modules[id]
})

// ---------------------------------------------------------------- fake Host
const host = {
  status: null,
  requests: [],
  replies: {},
  reset(status) {
    this.status = { ok: true, version: 'test', bootId: 'boot-1', mode: 'desktop', supported: true, confirm: 'when-busy', activeTasks: false, busySessions: [], runtime: { uptimeSec: 2 * 3600 + 13 * 60, rssBytes: 812 * 1024 * 1024 }, restart: null, scheduled: null, pendingPlugins: [], resume: null, logFile: 'C:/log/restart-button.log', ...status }
    this.requests = []
    this.replies = {}
  },
}
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : undefined
  host.requests.push({ url, method: init.method ?? 'GET', body })
  let reply = { ok: true }
  if (url.endsWith('restart-button.status')) reply = host.status
  else if (url.endsWith('restart-button.restart')) {
    reply = host.replies.restart ?? { ok: true, id: 'r1', mode: host.status.mode, bootId: host.status.bootId }
    if (reply.scheduled) host.status = { ...host.status, scheduled: { since: Date.now(), activeSessionId: body.activeSessionId ?? null } }
  } else if (url.endsWith('restart-button.cancel')) {
    host.status = { ...host.status, scheduled: null }
    reply = { ok: true, cancelled: true }
  }
  return { ok: true, status: 200, json: async () => reply }
}

// ---------------------------------------------------------------- fake browser context
const zhDict = {}
const opened = []
const prompts = []
const sessionRows = {
  'sess-open': { id: 'sess-open', title: '为客户端添加一键重启插件', retainedBy: { mainView: 1 } },
  'sess-a': { id: 'sess-a', title: '论文阅读', retainedBy: {} },
  'sess-b': { id: 'sess-b', title: '', blank: true, retainedBy: {} },
}
const services = {
  uiWorkspace: { openSession: (id) => opened.push(id) },
  sessions: {
    list: { getSnapshot: () => ({ byId: sessionRows }) },
    using: async (id, options, operation) => {
      assert.equal(options.source, 'controllerOperation')
      return operation({
        ready: Promise.resolve({
          session: {
            prompt: async (content, mode) => {
              prompts.push({ id, text: content[0].text, mode })
              return { ok: true, value: { accepted: true } }
            },
          },
        }),
      })
    },
  },
}
const translate = (key, params = {}) => String(zhDict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`)
const registered = {}
const disposers = []
const ctx = {
  get: (name) => services[name],
  effect: (fn) => disposers.push(fn()),
  locale: {
    register: (ns, dicts) => {
      Object.assign(zhDict, dicts.zh)
      assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort(), 'zh and en dictionaries carry the same keys')
      return () => {}
    },
    bind: () => translate,
  },
  slots: {
    inject: (name, callback) => callback(),
    register: (options, component) => {
      registered[options.name] = component
      return () => {}
    },
  },
}
const useSessions = (selector) => selector({ byId: sessionRows })

// ---------------------------------------------------------------- harness
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function flush(ms = 30) {
  await act(async () => {
    await sleep(ms)
  })
}
async function mountPlugin(status) {
  host.reset(status)
  for (const dispose of disposers.splice(0)) if (typeof dispose === 'function') dispose()
  opened.length = 0
  prompts.length = 0
  dom.window.localStorage.clear()
  dom.window.sessionStorage.clear()
  document.body.innerHTML = '<div id="header"></div><div id="layer"></div>'
  plugin.apply(ctx)
  const Header = registered['conversation.session.header.utilities']
  const Layer = registered['shell.overlay']
  const roots = [createRoot(document.getElementById('header')), createRoot(document.getElementById('layer'))]
  await act(async () => {
    roots[0].render(h(Header, { t: translate, sessionId: 'sess-open' }))
    roots[1].render(h(Layer, { t: translate, useSessions }))
  })
  await flush()
  return { unmount: () => act(() => roots.forEach((root) => root.unmount())) }
}
const $ = (selector) => document.querySelector(selector)
const button = () => $('[data-dsh-restart-button]')
const click = (element) => act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
const byText = (text) => [...document.querySelectorAll('button')].find((el) => el.textContent === text)
let passed = 0
async function test(name, body) {
  await body()
  passed++
  console.log(`ok - ${name}`)
}

;(async () => {
  await test('tooltip shows runtime facts and attention lines', async () => {
    const app = await mountPlugin({ activeTasks: true, busySessions: ['sess-a', 'sess-b'], pendingPlugins: [{ name: 'dsh-better-sidebar', from: '0.24.1', to: '0.25.0' }] })
    const tip = button().getAttribute('data-tooltip').split('\n')
    assert.deepEqual(tip, ['重启 DeepSeek Harness', '已运行 2 小时 13 分钟 · Host 内存 812 MB', '2 个会话正在运行', '1 个插件更新需重启生效'])
    assert.ok(button().querySelector('.dshRestartBadge[data-kind=attention]'), 'attention dot for a pending plugin update')
    await app.unmount()
  })

  await test('idle: one click restarts, reports the open session, shows the cover', async () => {
    const app = await mountPlugin({})
    await click(button())
    await flush()
    const post = host.requests.find((r) => r.url.endsWith('restart-button.restart'))
    assert.deepEqual({ when: post.body.when, activeSessionId: post.body.activeSessionId }, { when: 'now', activeSessionId: 'sess-open' })
    assert.ok($('[data-dsh-restart-overlay]'), 'restarting cover is shown')
    assert.equal(button().getAttribute('data-busy'), 'true')
    await app.unmount()
  })

  await test('busy: confirm offers "restart when done", which schedules; the scheduled menu cancels', async () => {
    const app = await mountPlugin({ activeTasks: true, busySessions: ['sess-a'] })
    host.replies.restart = { ok: true, scheduled: true, since: Date.now(), mode: 'desktop', bootId: 'boot-1' }
    await click(button())
    await flush()
    const dialog = $('[role=dialog]')
    assert.equal(dialog.getAttribute('data-title'), '重启 DeepSeek Harness？')
    assert.match(dialog.textContent, /1 个会话正在运行/)
    assert.match(dialog.textContent, /正在运行：论文阅读/)
    assert.deepEqual([...dialog.querySelectorAll('footer button')].map((b) => b.textContent), ['取消', '跑完后重启', '立即重启'])
    await click($('[data-dsh-restart-when-idle]'))
    await flush()
    assert.equal(host.requests.find((r) => r.url.endsWith('restart-button.restart')).body.when, 'idle')
    assert.equal($('[role=dialog]'), null, 'dialog closes after scheduling')
    assert.equal(button().getAttribute('data-scheduled'), 'true')
    assert.match(button().getAttribute('data-tooltip'), /已安排：任务完成后自动重启/)
    await click(button())
    await flush()
    assert.equal($('[role=dialog]').getAttribute('data-title'), '已安排重启')
    await click($('[data-dsh-restart-cancel-scheduled]'))
    await flush()
    assert.ok(host.requests.some((r) => r.url.endsWith('restart-button.cancel')))
    assert.equal(button().getAttribute('data-scheduled'), null)
    await app.unmount()
  })

  await test('an older Host without scheduling only gets "cancel" and "restart now"', async () => {
    const app = await mountPlugin({ activeTasks: true, busySessions: ['sess-a'] })
    delete host.status.scheduled
    await click(button())
    await flush()
    assert.deepEqual([...$('[role=dialog]').querySelectorAll('footer button')].map((b) => b.textContent), ['取消', '立即重启'])
    await app.unmount()
  })

  await test('a scheduled restart started by the Host shows the cover on the next poll', async () => {
    const app = await mountPlugin({ scheduled: { since: Date.now(), activeSessionId: 'sess-open' } })
    host.status = { ...host.status, scheduled: null, restart: { id: 'r9', state: 'pending', reason: 'idle', startedAt: Date.now() } }
    await flush(1200)
    assert.ok($('[data-dsh-restart-overlay]'), 'cover appears once the Host reports the restart')
    await app.unmount()
  })

  await test('after a restart: reopens the session, offers to continue interrupted ones', async () => {
    const app = await mountPlugin({ resume: { id: 'res-1', at: Date.now(), activeSessionId: 'sess-open', interrupted: ['sess-a', 'sess-b'] } })
    await flush(50)
    assert.deepEqual(opened, ['sess-open'])
    const card = $('[data-dsh-restart-notice=resume]')
    assert.ok(card, 'resume card is shown')
    assert.deepEqual([...card.querySelectorAll('.dshRestartLink')].map((el) => el.textContent), ['论文阅读', '未命名会话'])
    await click([...card.querySelectorAll('.dshRestartLink')][0])
    assert.deepEqual(opened, ['sess-open', 'sess-a'])
    await click(byText('全部继续'))
    await flush(50)
    assert.deepEqual(prompts, [{ id: 'sess-a', text: '继续', mode: 'queue' }, { id: 'sess-b', text: '继续', mode: 'queue' }])
    assert.deepEqual(host.requests.find((r) => r.url.endsWith('resume-ack')).body, { id: 'res-1', action: 'continue' })
    assert.equal($('[data-dsh-restart-notice=resume]'), null)
    await app.unmount()
  })

  await test('after a restart with nothing interrupted: reopens the session and acknowledges silently', async () => {
    const app = await mountPlugin({ resume: { id: 'res-2', at: Date.now(), activeSessionId: 'sess-a', interrupted: [] } })
    await flush(50)
    assert.deepEqual(opened, ['sess-a'])
    assert.equal($('[data-dsh-restart-notice=resume]'), null)
    assert.deepEqual(host.requests.find((r) => r.url.endsWith('resume-ack')).body, { id: 'res-2', action: 'opened' })
    await app.unmount()
  })

  await test('pending plugin update card: "later" silences exactly that set', async () => {
    const pending = [{ name: 'dsh-better-sidebar', from: '0.24.1', to: '0.25.0' }]
    const app = await mountPlugin({ pendingPlugins: pending })
    const card = $('[data-dsh-restart-notice=plugins]')
    assert.ok(card)
    assert.match(card.textContent, /dsh-better-sidebar\s+0\.24\.1 → 0\.25\.0/)
    await click(byText('稍后'))
    assert.equal($('[data-dsh-restart-notice=plugins]'), null)
    assert.equal(dom.window.localStorage.getItem('dsh-restart-button:dismissed-plugins'), 'dsh-better-sidebar@0.25.0')
    await app.unmount()
  })

  await test('unsupported runtimes hide the button', async () => {
    const app = await mountPlugin({ supported: false, mode: 'unsupported' })
    assert.equal(button(), null)
    await app.unmount()
  })

  for (const dispose of disposers.splice(0)) if (typeof dispose === 'function') dispose()
  console.log(`\n${passed} client tests passed`)
  process.exit(0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
