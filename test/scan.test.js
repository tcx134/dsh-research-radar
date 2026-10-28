import test from 'node:test'
import assert from 'node:assert/strict'

import { mapLimit, resolvePanelUrl, effectiveLookbackDays, runScan, backfillQuality, ensureIssns } from '../radar/scan.js'
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

test('effectiveLookbackDays 刚扫过也不低于 30 天下限', () => {
  // 下限是 30 天（收录延迟），不是 2 天：1 小时前扫过也给 30 天，
  // 否则出版日期在 10-20、10-25 才进索引的论文会被永久漏掉。
  assert.equal(effectiveLookbackDays(iso(3600e3), 30, NOW), 30)
  assert.equal(effectiveLookbackDays(iso(3600e3), 3, NOW), 3)
  // 配置比下限还小时，尊重配置（用户明确只要 3 天）
  assert.equal(effectiveLookbackDays(iso(3600e3), 10, NOW), 10)
})

test('effectiveLookbackDays 隔了 10 天 → 40 天窗口（10 + 30 下限）', () => {
  assert.equal(effectiveLookbackDays(iso(10 * 86400e3), 30, NOW), 30)
  assert.equal(effectiveLookbackDays(iso(10 * 86400e3), 365, NOW), 40)
})

test('effectiveLookbackDays 隔了很久或时间戳在未来时退回配置值', () => {
  assert.equal(effectiveLookbackDays(iso(100 * 86400e3), 30, NOW), 30)
  // 系统时间被改过（lastScanAt 在未来）→ 不能算出负数窗口
  assert.equal(effectiveLookbackDays(iso(-86400e3), 30, NOW), 30)
})

test('effectiveLookbackDays 对非法配置值有兜底', () => {
  assert.equal(effectiveLookbackDays(iso(3600e3), 0, NOW), 1)
  assert.equal(effectiveLookbackDays(iso(3600e3), -5, NOW), 1)
  assert.equal(effectiveLookbackDays(iso(3600e3), 999, NOW), 31)
  assert.equal(effectiveLookbackDays(iso(3600e3), 'abc', NOW), 30)
  assert.equal(effectiveLookbackDays(iso(3600e3), null, NOW), 30)
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

test('runScan 不传 lookbackDays 时按方向自己的上次扫描时间算窗口', async (t) => {
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
  // 2 小时前扫过 → ceil(2/24)=1 → 1+30(下限)=31，但不超过配置的 30 → 30
  assert.equal(result.lookbackDays, 30)
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

/** 一个只含一篇论文的 RSS，用来在不发真网络请求的情况下喂 runScan。 */
const FEED_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Metal rubber isolator design</title>
<link>https://example.org/paper</link>
<description>We study metal rubber isolators.</description>
<pubDate>Wed, 21 Oct 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`

/**
 * 关掉全文抓取时，扫描不应该去碰 doi.org / 出版社站点。
 * 这条同时守住「settings.scan.fullText 真的接到了 runScan 上」和
 * 「关掉之后确实省掉了那几次网络请求」。
 */
test('runScan 按设置决定是否抓全文', async (t) => {
  const original = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/rss+xml']]),
      text: async () => FEED_XML,
    }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const off = await storeWithTopic(t, {
    settings: { rss: ['https://example.org/feed.xml'], scan: { summarize: false, fullText: false } },
  })
  const offResult = await runScan({}, {}, off.store, {})
  assert.equal(offResult.newItems.length, 1)
  assert.equal(offResult.fullTextCount, 0)
  // 只取了 RSS，没有为了全文再发任何请求
  assert.equal(requested.filter((u) => u.includes('doi.org')).length, 0)
  assert.equal(requested.length, 1)
})

/** 老库：两条论文没有 quality（升级前入库的），一条已经有了。 */
async function storeWithOldItems(t) {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [],
    items: [
      {
        id: 'openalex:old-1',
        title: 'Metal rubber isolator',
        issn: '0263-8231',
        publishedAt: '2024-05-01',
        citations: 30,
        openAccess: true,
        discoveredAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'openalex:old-2',
        title: 'Metal rubber damper',
        issn: '0000-0000',
        publishedAt: '2025-01-01',
        citations: 0,
        discoveredAt: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'openalex:done',
        title: 'Already scored',
        quality: { score: 42, tier: 'medium' },
        discoveredAt: '2026-10-03T00:00:00.000Z',
      },
    ],
    seen: {},
    settings: {},
  })
  return { dir, store: createStore({}, { dataDir: dir }) }
}

test('backfillQuality 给缺质量分的老论文补上并落盘', async (t) => {
  const { store } = await storeWithOldItems(t)
  const filled = await backfillQuality(store, { journals: null })
  assert.equal(filled, 2)

  const state = await store.load()
  const byId = new Map(state.items.map((item) => [item.id, item]))
  // 没有期刊指标时只看被引，但仍然是有效分数（不是 null）
  assert.equal(typeof byId.get('openalex:old-1').quality.score, 'number')
  assert.equal(typeof byId.get('openalex:old-2').quality.tier, 'string')
  // 已经有的那条不能被覆盖
  assert.equal(byId.get('openalex:done').quality.score, 42)
})

test('backfillQuality 幂等：跑第二次什么都不做', async (t) => {
  const { store } = await storeWithOldItems(t)
  assert.equal(await backfillQuality(store, {}), 2)
  assert.equal(await backfillQuality(store, {}), 0)
})

test('backfillQuality 会用期刊缓存里的影响因子', async (t) => {
  const { store } = await storeWithOldItems(t)
  const journals = new Map([
    ['0263-8231', { name: 'Thin-Walled Structures', twoYearMeanCitedness: 8.51, hIndex: 154 }],
  ])
  await backfillQuality(store, { journals })
  const state = await store.load()
  const item = state.items.find((entry) => entry.id === 'openalex:old-1')
  assert.equal(item.quality.impactFactor, 8.51)
  assert.equal(item.quality.tier, 'high')
  assert.ok(item.quality.reasons.some((reason) => reason.includes('影响因子')))
})

test('backfillQuality 遇到空库返回 0', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, { version: 1, topics: [], items: [], seen: {}, settings: {} })
  const store = createStore({}, { dataDir: dir })
  assert.equal(await backfillQuality(store, {}), 0)
})

/** 老库：只有 DOI、没有 ISSN（升级前入库的真实形态）。 */
async function storeWithDoiOnly(t) {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [],
    items: [
      {
        id: 'crossref:10.1016/j.tws.2026.115741',
        title: 'Metal rubber isolator',
        doi: '10.1016/j.tws.2026.115741',
        venue: 'Thin-Walled Structures',
        publishedAt: '2025-05-01',
        citations: 12,
        discoveredAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    seen: {},
    settings: {},
  })
  return { dir, store: createStore({}, { dataDir: dir }) }
}

test('ensureIssns 用 DOI 给缺 ISSN 的论文补上期刊编号', async () => {
  const items = [
    { id: 'a', doi: '10.1016/j.tws.2026.115741' },
    { id: 'b', doi: 'https://doi.org/10.3390/polym1613045' },
    { id: 'c', doi: '', issn: '1234-567X' },
    { id: 'd' },
  ]
  const asked = []
  const filled = await ensureIssns(items, {
    issnResolver: async (dois) => {
      asked.push(...dois)
      return {
        '10.1016/j.tws.2026.115741': '0263-8231',
        '10.3390/polym1613045': '2073-4360',
      }
    },
  })
  // 只有前两条需要补（第三条已有 ISSN、第四条没 DOI）
  assert.deepEqual(asked, ['10.1016/j.tws.2026.115741', 'https://doi.org/10.3390/polym1613045'])
  assert.equal(filled, 2)
  assert.equal(items[0].issn, '0263-8231')
  assert.equal(items[1].issn, '2073-4360')
  assert.equal(items[2].issn, '1234-567X')
  assert.equal(items[3].issn, undefined)
})

test('ensureIssns 全部有序号时不发请求', async () => {
  let called = 0
  const filled = await ensureIssns(
    [
      { id: 'a', issn: '0263-8231' },
      { id: 'b', issn: '2073-4360' },
    ],
    {
      issnResolver: async () => {
        called += 1
        return {}
      },
    },
  )
  assert.equal(filled, 0)
  assert.equal(called, 0)
})

test('ensureIssns 上游抛错时安全返回 0', async () => {
  const items = [{ id: 'a', doi: '10.1/x' }]
  const filled = await ensureIssns(items, {
    issnResolver: async () => {
      throw new Error('network down')
    },
  })
  assert.equal(filled, 0)
  assert.equal(items[0].issn, undefined)
})

test('backfillQuality 会给缺 ISSN 的老论文补 ISSN 并落盘', async (t) => {
  const { store } = await storeWithDoiOnly(t)
  const journals = new Map([
    ['0263-8231', { name: 'Thin-Walled Structures', twoYearMeanCitedness: 8.51, hIndex: 154 }],
  ])
  await backfillQuality(store, {
    journals,
    issnResolver: async () => ({ '10.1016/j.tws.2026.115741': '0263-8231' }),
  })

  const state = await store.load()
  const item = state.items[0]
  // ISSN 补上了，而且写进了 state（下次不用重查）
  assert.equal(item.issn, '0263-8231')
  // 有了 ISSN 才能查到影响因子，质量分才是真的高
  assert.equal(item.quality.impactFactor, 8.51)
  assert.equal(item.quality.tier, 'high')
})

/**
 * 用户库里的真实形态：论文在「影响因子」上线前扫进来，`quality` 已经算过
 * 但那轮没有 ISSN，只能按被引打分。这种也必须重算，否则影响因子永远补不上。
 */
test('backfillQuality 会重算「有分数但缺 ISSN」的论文', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [],
    items: [
      {
        id: 'crossref:10.1016/j.tws.2025.1',
        title: 'Metal rubber isolator',
        doi: '10.1016/j.tws.2025.1',
        publishedAt: '2025-05-01',
        citations: 0,
        // 旧分数：只按被引算过，没有期刊信号
        quality: { score: 42, tier: 'medium', reasons: ['被引 0 次'], impactFactor: null },
        discoveredAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    seen: {},
    settings: {},
  })
  const store = createStore({}, { dataDir: dir })
  const journals = new Map([['0263-8231', { twoYearMeanCitedness: 8.51, hIndex: 154 }]])

  const filled = await backfillQuality(store, {
    journals,
    issnResolver: async () => ({ '10.1016/j.tws.2025.1': '0263-8231' }),
  })
  assert.equal(filled, 1)

  const state = await store.load()
  const item = state.items[0]
  assert.equal(item.issn, '0263-8231')
  assert.equal(item.quality.impactFactor, 8.51)
  assert.equal(item.quality.tier, 'high')
  assert.ok(item.quality.score > 42, `重算后分数应高于旧的 42，实际 ${item.quality.score}`)
})

test('backfillQuality 不会因为补不到 ISSN 就抹掉已有分数', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [],
    items: [
      {
        id: 'crossref:10.1/unknown',
        title: 'Unknown venue paper',
        doi: '10.1/unknown',
        citations: 5,
        quality: { score: 42, tier: 'medium', impactFactor: null },
        discoveredAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    seen: {},
    settings: {},
  })
  const store = createStore({}, { dataDir: dir })
  // 反查什么都查不到
  assert.equal(await backfillQuality(store, { issnResolver: async () => ({}) }), 0)
  const state = await store.load()
  assert.equal(state.items[0].quality.score, 42)
  assert.equal(state.items[0].issn ?? '', '')
})
