import test from 'node:test'
import assert from 'node:assert/strict'

import { mapLimit, resolvePanelUrl, effectiveLookbackDays, runScan } from '../radar/scan.js'
import { createStore } from '../radar/store.js'
import { tempDir, seedState } from './helpers.js'

test('mapLimit 结果顺序与输入一致', async () => {
  const out = await mapLimit([3, 1, 2], 2, async (n) => {
    await new Promise((resolve) => setTimeout(resolve, n * 5))
    return n * 10
  })
  assert.deepEqual(out, [30, 10, 20])
})

test('mapLimit 的并发数不超过 limit', async () => {
  let running = 0
  let peak = 0
  await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running -= 1
  })
  assert.equal(peak, 3)
})

test('mapLimit 对空数组直接返回空数组', async () => {
  let called = 0
  const out = await mapLimit([], 3, async () => {
    called += 1
  })
  assert.deepEqual(out, [])
  assert.equal(called, 0)
})

test('mapLimit 把 limit 夹到合法区间', async () => {
  assert.deepEqual(
    await mapLimit([1, 2], 0, async (n) => n),
    [1, 2],
  )
  assert.deepEqual(
    await mapLimit([1, 2], 999, async (n) => n),
    [1, 2],
  )
})

test('mapLimit 收到非数组时返回空数组', async () => {
  assert.deepEqual(await mapLimit(null, 2, async () => 1), [])
})

test('mapLimit 里单个任务抛错会向上冒（由调用方决定是否捕获）', async () => {
  await assert.rejects(
    mapLimit([1, 2], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    }),
    /boom/,
  )
})

/** 造一个带 get() 的 ctx 桩，模拟 Cordis 的服务查询。 */
function ctxWith(services) {
  return {
    get(name) {
      return services[name]
    },
  }
}

test('resolvePanelUrl 从 ctx.get 拿到 connection 时生成带令牌 URL', () => {
  const ctx = ctxWith({
    webServer: { port: 61819, protocol: 'http:' },
    connection: { authenticatedUrl: (base) => `${base}/?token=abc` },
  })
  assert.equal(resolvePanelUrl(ctx), 'http://127.0.0.1:61819/?token=abc')
  // protocol 缺失时退回 "http:"（host 的拼法是 `${protocol}//host:port`）
  const bare = ctxWith({
    webServer: { port: 61819 },
    connection: { authenticatedUrl: (base) => base },
  })
  assert.equal(resolvePanelUrl(bare), 'http://127.0.0.1:61819')
})

test('resolvePanelUrl 在服务缺失或端口未知时返回空串而不是抛错', () => {
  assert.equal(resolvePanelUrl(null), '')
  assert.equal(resolvePanelUrl({}), '')
  assert.equal(resolvePanelUrl(ctxWith({ connection: { authenticatedUrl: () => 'x' } })), '')
  assert.equal(
    resolvePanelUrl(ctxWith({ webServer: { port: 0 }, connection: { authenticatedUrl: () => 'x' } })),
    '',
  )
  assert.equal(resolvePanelUrl(ctxWith({ webServer: { port: 1 }, connection: {} })), '')
})

test('resolvePanelUrl 兼容 authenticatedUrl 抛错的实现', () => {
  const ctx = ctxWith({
    webServer: { port: 1, protocol: 'http' },
    connection: {
      authenticatedUrl() {
        throw new Error('boom')
      },
    },
  })
  assert.equal(resolvePanelUrl(ctx), '')
})

const NOW = Date.parse('2026-10-21T12:00:00Z')
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()

test('effectiveLookbackDays 没有上次扫描记录时用配置值', () => {
  assert.equal(effectiveLookbackDays(null, 30, NOW), 30)
  assert.equal(effectiveLookbackDays(undefined, 30, NOW), 30)
  assert.equal(effectiveLookbackDays('', 30, NOW), 30)
  assert.equal(effectiveLookbackDays('not-a-date', 30, NOW), 30)
})

test('effectiveLookbackDays 刚扫过 1 小时 → 窗口收窄到 3 天', () => {
  // 1 小时前扫过：ceil(1/24)=1，1+2=3，但不超过配置的 30 → 3
  assert.equal(effectiveLookbackDays(iso(3600e3), 30, NOW), 3)
  // 配置本身就很小（3 天）时不能再放大
  assert.equal(effectiveLookbackDays(iso(3600e3), 3, NOW), 3)
})

test('effectiveLookbackDays 隔了 10 天 → 12 天窗口', () => {
  assert.equal(effectiveLookbackDays(iso(10 * 86400e3), 30, NOW), 12)
})

test('effectiveLookbackDays 隔了很久或时间戳在未来时退回配置值', () => {
  assert.equal(effectiveLookbackDays(iso(100 * 86400e3), 30, NOW), 30)
  // 系统时间被改过（lastScanAt 在未来）→ 不能算出负数窗口
  assert.equal(effectiveLookbackDays(iso(-86400e3), 30, NOW), 30)
})

test('effectiveLookbackDays 对非法配置值有兜底', () => {
  assert.equal(effectiveLookbackDays(iso(3600e3), 0, NOW), 1)
  assert.equal(effectiveLookbackDays(iso(3600e3), -5, NOW), 1)
  assert.equal(effectiveLookbackDays(iso(3600e3), 999, NOW), 3)
  assert.equal(effectiveLookbackDays(iso(3600e3), 'abc', NOW), 3)
  assert.equal(effectiveLookbackDays(iso(3600e3), null, NOW), 3)
})

/**
 * 造一个只订 rss、但没配任何 feed 的方向：runScan 不会发网络请求，
 * 只会产生一条「未配置 RSS 订阅地址」的抓取错误，适合验证编排逻辑。
 */
async function storeWithTopic(t, extra = {}) {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [
      {
        id: 't-a',
        name: '测试方向',
        keywords: ['metal rubber'],
        sources: ['rss'],
        enabled: true,
        ...(extra.topic ?? {}),
      },
    ],
    items: [],
    seen: {},
    settings: { rss: [], ...(extra.settings ?? {}) },
  })
  const store = createStore({}, { dataDir: dir })
  return { dir, store }
}

test('runScan 把增量窗口传给抓取层，并记在 result 上', async (t) => {
  const { store } = await storeWithTopic(t)
  const result = await runScan({}, {}, store, { lookbackDays: 7 })
  assert.equal(result.lookbackDays, 7)
  assert.deepEqual(result.scannedTopics, [{ id: 't-a', name: '测试方向', lookbackDays: 7 }])
  // 没有配 feed，只应有一条 rss 抓取错误；不应有 summary 错误（没有候选论文）
  assert.deepEqual(
    result.errors.map((e) => e.source),
    ['rss'],
  )
  assert.equal(result.newItems.length, 0)
})

test('runScan 不传 lookbackDays 时按方向自己的上次扫描时间自动收窄', async (t) => {
  const recent = new Date(Date.now() - 2 * 3600e3).toISOString()
  const { store } = await storeWithTopic(t, {
    topic: { lastScanAt: recent },
    settings: {
      scan: {
        enabled: true,
        intervalHours: 12,
        maxPerTopic: 8,
        summarize: true,
        lookbackDays: 30,
        lastScanAt: recent,
        lastScanNew: 0,
      },
    },
  })
  const result = await runScan({}, {}, store, {})
  // 2 小时前扫过 → ceil(2/24)=1 → 1+2=3 天
  assert.equal(result.lookbackDays, 3)
  assert.ok(result.lookbackDays < 30)
})

test('新方向首次扫描用完整窗口，不被全局 lastScanAt 收窄', async (t) => {
  const recent = new Date(Date.now() - 2 * 3600e3).toISOString()
  const { store } = await storeWithTopic(t, {
    // 方向自己没有 lastScanAt（刚建的），全局 lastScanAt 却是 2 小时前
    settings: {
      scan: {
        enabled: true,
        intervalHours: 12,
        maxPerTopic: 8,
        summarize: true,
        lookbackDays: 30,
        lastScanAt: recent,
        lastScanNew: 0,
      },
    },
  })
  const result = await runScan({}, {}, store, {})
  // 必须用配置的 30 天，否则「刚加的方向只能看到最近 3 天」
  assert.equal(result.lookbackDays, 30)
  assert.equal(result.scannedTopics[0].lookbackDays, 30)
})

test('runScan 把扫描时间写到方向自己的 lastScanAt 上', async (t) => {
  const { store } = await storeWithTopic(t)
  await store.load()
  assert.equal(store.get().topics[0].lastScanAt, '')
  await runScan({}, {}, store, {})
  const saved = store.get()
  assert.ok(saved.topics[0].lastScanAt !== '')
  assert.ok(Number.isFinite(Date.parse(saved.topics[0].lastScanAt)))
})

test('runScan 把解析深度记在 result 上（默认 standard，可配 brief/deep）', async (t) => {
  const scanSettings = (summaryDepth) => ({
    scan: {
      enabled: true,
      intervalHours: 12,
      maxPerTopic: 8,
      summarize: true,
      lookbackDays: 30,
      lastScanAt: null,
      lastScanNew: 0,
      ...(summaryDepth === undefined ? {} : { summaryDepth }),
    },
  })

  const plain = await storeWithTopic(t, { settings: scanSettings(undefined) })
  const defaultResult = await runScan({}, {}, plain.store, {})
  assert.equal(defaultResult.summaryDepth, 'standard')

  const brief = await storeWithTopic(t, { settings: scanSettings('brief') })
  assert.equal((await runScan({}, {}, brief.store, {})).summaryDepth, 'brief')

  const deep = await storeWithTopic(t, { settings: scanSettings('deep') })
  assert.equal((await runScan({}, {}, deep.store, {})).summaryDepth, 'deep')

  // 非法档位在 store 归一化阶段就退回默认档，runScan 不会拿到脏值
  const bogus = await storeWithTopic(t, { settings: scanSettings('ultra') })
  assert.equal((await runScan({}, {}, bogus.store, {})).summaryDepth, 'standard')

  // options.summaryDepth 可临时覆盖设置（Agent 一次性精读时用）
  const override = await storeWithTopic(t, { settings: scanSettings('brief') })
  assert.equal((await runScan({}, {}, override.store, { summaryDepth: 'deep' })).summaryDepth, 'deep')
})
