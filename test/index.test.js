import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { name, inject, apply } from '../index.js'

async function tempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drr-index-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))
  return dir
}

/** 最小可用的 host ctx 桩：只实现 index.js 真正用到的接口。 */
function makeCtx() {
  const disposers = []
  const registered = { routes: [], tools: [] }
  return {
    registered,
    logger: { info() {}, warn() {}, error() {} },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => dispose?.()
    },
    webServer: {
      register(route) {
        registered.routes.push(route)
        return () => {}
      },
    },
    tools: {
      register(tool) {
        registered.tools.push(tool)
        return () => {}
      },
    },
    timer: {
      interval(fn, ms) {
        registered.timerMs = ms
        return () => {}
      },
    },
    llm: { stream: async () => ({}) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    disposeAll() {
      for (const dispose of disposers) dispose()
    },
  }
}

test('插件导出 name / inject / apply', () => {
  assert.equal(name, 'dsh-research-radar')
  assert.ok(Array.isArray(inject))
  assert.equal(typeof apply, 'function')
})

test('apply 注册了 HTTP 路由、Agent 工具与定时器，不抛错', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  assert.equal(ctx.registered.routes.length, 1)
  assert.equal(ctx.registered.routes[0].kind, 'prefix')
  assert.equal(ctx.registered.routes[0].path, '/api/dsh-research-radar')
  assert.equal(typeof ctx.registered.routes[0].handler, 'function')
  assert.equal(ctx.registered.tools.length, 1)
  assert.equal(ctx.registered.tools[0].name, 'research_radar')
  assert.deepEqual(ctx.registered.tools[0].parameters.required, ['action'])
  assert.equal(ctx.registered.timerMs, 5 * 60 * 1000)
  ctx.disposeAll()
})

/** 用假 req/res 调一次路由，返回 {status, body}。 */
async function call(ctx, { method = 'GET', url = '/', headers = {}, body = null }) {
  const route = ctx.registered.routes[0]
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:61819', 'x-dsh-research-radar': '1', ...headers },
    on(event, handler) {
      if (event === 'data' && body !== null) handler(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') handler()
      return req
    },
    destroy() {},
  }
  const res = {
    statusCode: 0,
    headers: {},
    payload: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    end(chunk) {
      this.payload += chunk ?? ''
    },
  }
  await route.handler(req, res)
  return { status: res.statusCode, body: res.payload === '' ? null : JSON.parse(res.payload) }
}

test('GET /state 返回默认结构与源清单', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const { status, body } = await call(ctx, { url: '/api/dsh-research-radar/state' })
  assert.equal(status, 200)
  assert.deepEqual(body.topics, [])
  assert.deepEqual(body.items, [])
  assert.equal(body.settings.mail.enabled, false)
  assert.equal(body.settings.scan.lookbackDays, 30)
  assert.deepEqual(Object.keys(body.sources).sort(), [
    'arxiv',
    'biorxiv',
    'crossref',
    'openalex',
    'pubmed',
    'rss',
  ])
  assert.equal(body.status.scanning, false)
  ctx.disposeAll()
})

test('GET /stats 返回趋势统计，days/topicId 生效', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const seeded = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/topics',
    headers: { 'content-type': 'application/json' },
    body: { op: 'upsert', topic: { id: 't-a', name: '金属橡胶', keywords: ['metal rubber'] } },
  })
  assert.equal(seeded.status, 200)
  ctx.disposeAll()

  // 直接往落盘的 state.json 里塞两条论文（时间窗口内 / 窗口外）
  const store = await import('../radar/store.js')
  const s = store.createStore({}, { dataDir: dir })
  await s.mutate((state) => {
    state.items = [
      {
        id: 'openalex:W1',
        topicId: 't-a',
        topicName: '金属橡胶',
        source: 'openalex',
        title: 'A metal rubber model',
        venue: 'Wear',
        authors: ['Li Y'],
        discoveredAt: new Date().toISOString(),
        read: false,
        starred: true,
        summary: { tldr: 'x', tags: ['金属橡胶'] },
      },
      {
        id: 'openalex:W2',
        topicId: 't-a',
        topicName: '金属橡胶',
        source: 'openalex',
        title: 'Old paper',
        venue: 'Wear',
        authors: ['Wang H'],
        discoveredAt: new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
        read: true,
        starred: false,
        summary: null,
      },
    ]
  })

  const ctx2 = makeCtx()
  apply(ctx2, { dataDir: dir })
  const { status, body } = await call(ctx2, { url: '/api/dsh-research-radar/stats?days=30' })
  assert.equal(status, 200)
  assert.equal(body.windowDays, 30)
  assert.equal(body.total, 1)
  assert.equal(body.starredCount, 1)
  assert.equal(body.readCount, 0)
  assert.equal(body.summarizedCount, 1)
  assert.equal(body.bySource[0].key, 'openalex')
  assert.equal(body.bySource[0].label, 'OpenAlex（SCI 期刊综合库）')
  assert.deepEqual(body.byTag, [{ key: '金属橡胶', count: 1 }])
  assert.equal(body.weeklyPeak, 1)

  const wide = await call(ctx2, { url: '/api/dsh-research-radar/stats?days=500' })
  assert.equal(wide.body.total, 2)

  const other = await call(ctx2, { url: '/api/dsh-research-radar/stats?topicId=t-zzz' })
  assert.equal(other.body.total, 0)
  ctx2.disposeAll()
})

test('非 loopback Host 与缺少客户端标记都返回 403', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const wrongHost = await call(ctx, { url: '/api/dsh-research-radar/state', headers: { host: 'evil.com' } })
  assert.equal(wrongHost.status, 403)
  const noMarker = await call(ctx, {
    url: '/api/dsh-research-radar/state',
    headers: { 'x-dsh-research-radar': '' },
  })
  assert.equal(noMarker.status, 403)
  ctx.disposeAll()
})

test('POST 非 JSON content-type 返回 415', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const { status } = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/topics',
    headers: { 'content-type': 'text/plain' },
    body: {},
  })
  assert.equal(status, 415)
  ctx.disposeAll()
})

test('topics upsert 落盘，settings 脱敏密码，item 可标已读', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })

  const created = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/topics',
    headers: { 'content-type': 'application/json' },
    body: {
      op: 'upsert',
      topic: {
        name: '金属橡胶',
        keywords: ['metal rubber', 'MR', 'EMWM'],
        sources: ['openalex', 'crossref'],
      },
    },
  })
  assert.equal(created.status, 200)
  assert.equal(created.body.topics.length, 1)
  assert.deepEqual(created.body.topics[0].keywords, ['metal rubber', 'MR', 'EMWM'])
  assert.equal(created.body.topics[0].strict, true)

  const saved = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/settings',
    headers: { 'content-type': 'application/json' },
    body: {
      settings: {
        mail: { enabled: true, host: 'smtp.163.com', port: 465, secure: true, pass: 'secret' },
        scan: { maxPerTopic: 6 },
      },
    },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.state.settings.mail.pass, '********')
  assert.equal(saved.body.state.settings.mail.host, 'smtp.163.com')
  assert.equal(saved.body.state.settings.scan.maxPerTopic, 6)

  // 传回 ******** 表示「不改密码」，不能把真实密码覆盖成星号
  const keepPass = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/settings',
    headers: { 'content-type': 'application/json' },
    body: { settings: { mail: { pass: '********' } } },
  })
  assert.equal(keepPass.status, 200)
  const onDisk = JSON.parse(await fsp.readFile(path.join(dir, 'state.json'), 'utf8'))
  assert.equal(onDisk.settings.mail.pass, 'secret')
  ctx.disposeAll()
})

test('topics upsert 缺名称时返回 400，未知接口返回 404', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const bad = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/topics',
    headers: { 'content-type': 'application/json' },
    body: { op: 'upsert', topic: { name: '', keywords: ['x'] } },
  })
  assert.equal(bad.status, 400)
  const unknown = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/nope',
    headers: { 'content-type': 'application/json' },
    body: {},
  })
  assert.equal(unknown.status, 404)
  ctx.disposeAll()
})

test('没有启用方向时 scan 直接返回错误而不是抛异常', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const { status, body } = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/scan',
    headers: { 'content-type': 'application/json' },
    body: {},
  })
  assert.equal(status, 200)
  assert.equal(body.newCount, 0)
  assert.equal(body.errors.length, 1)
  assert.equal(body.errors[0].source, 'topics')
  ctx.disposeAll()
})

test('Agent 工具的 action 枚举与 output 渲染正常', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const tool = ctx.registered.tools[0]
  assert.deepEqual(tool.parameters.properties.action.enum, [
    'status',
    'list_topics',
    'add_topic',
    'remove_topic',
    'scan',
    'send_digest',
  ])
  const status = await tool.execute({ action: 'status' })
  assert.deepEqual(status.topics, [])
  const added = await tool.execute({ action: 'add_topic', name: '金属橡胶', keywords: ['metal rubber'] })
  assert.equal(added.topics.length, 1)
  const listed = await tool.execute({ action: 'list_topics' })
  assert.equal(listed.topics[0].name, '金属橡胶')
  const removed = await tool.execute({ action: 'remove_topic', topicId: '金属橡胶' })
  assert.deepEqual(removed.topics, [])
  const rendered = tool.output.render({}, { ok: true })
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /"ok": true/)
  ctx.disposeAll()
})

test('send_digest 在邮件未启用时报错而不是静默失败', async (t) => {
  const dir = await tempDir(t)
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const tool = ctx.registered.tools[0]
  await assert.rejects(tool.execute({ action: 'send_digest' }), /邮件推送未启用/)
  ctx.disposeAll()
})
