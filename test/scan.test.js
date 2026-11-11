import test from 'node:test'
import assert from 'node:assert/strict'

import { mapLimit, resolvePanelUrl, effectiveLookbackDays, runScan, backfillQuality, ensureIssns, retryFailedSummaries, backfillPercentiles } from '../radar/scan.js'
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

/**
 * 真实库的形态：`citationPercentile` 是后加的字段，`backfillQuality` 的判据是
 * 「有没有 ISSN」，ISSN 补齐后就不再重算 —— 于是 40 篇的百分位全是 null、
 * `quality.quartile` 全空，面板上一个分区徽章都显示不出来。上游其实有数据。
 */
async function storeWithMissingPercentile(t) {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [],
    items: [
      {
        id: 'openalex:10.1016/j.ijthermalsci.2023.108796',
        title: 'Thermal contact resistance of metal rubber',
        doi: '10.1016/j.ijthermalsci.2023.108796',
        issn: '1290-0729',
        venue: 'International Journal of Thermal Sciences',
        publishedAt: '2023-08-01',
        citations: 14,
        // 旧分数：按被引算过，但没有百分位 → quartile 是 null
        quality: {
          score: 68,
          tier: 'high',
          reasons: ['期刊影响因子 5.0', '被引 14 次'],
          impactFactor: 5.0,
          journalHIndex: 120,
          citationPercentile: null,
          quartile: null,
        },
        discoveredAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'openalex:10.3390/ma19214680',
        title: 'A brand new metal rubber paper',
        doi: '10.3390/ma19214680',
        publishedAt: '2026-10-01',
        citations: 0,
        quality: null,
        discoveredAt: '2026-10-02T00:00:00.000Z',
      },
      {
        // 没有 DOI：连查都没法查，必须原样放过
        id: 'rss:no-doi',
        title: 'No DOI at all',
        citations: 3,
        discoveredAt: '2026-10-03T00:00:00.000Z',
      },
    ],
    seen: {},
    settings: {},
  })
  return { dir, store: createStore({}, { dataDir: dir }) }
}

test('backfillPercentiles 给老论文补上被引百分位，并据此更新分区', async (t) => {
  const { store } = await storeWithMissingPercentile(t)
  const journals = new Map([
    ['1290-0729', { name: 'International Journal of Thermal Sciences', twoYearMeanCitedness: 5.0, hIndex: 120 }],
  ])
  const filled = await backfillPercentiles(store, {
    journals,
    percentileResolver: async (dois) => {
      // 只有两篇有 DOI 会被查；太新那篇上游返回不到
      assert.deepEqual(dois.slice().sort(), ['10.1016/j.ijthermalsci.2023.108796', '10.3390/ma19214680'])
      return { '10.1016/j.ijthermalsci.2023.108796': 99 }
    },
  })
  assert.equal(filled, 1)

  const state = await store.load()
  const [hot, fresh, noDoi] = state.items
  // 百分位落盘，分区跟着变成 Q1（面板读的是 quality 里那份）
  assert.equal(hot.citationPercentile, 99)
  assert.equal(hot.quality.quartile, 'Q1')
  assert.equal(hot.quality.citationPercentile, 99)
  assert.ok(hot.quality.reasons.some((reason) => /^Q1（被引前 1%）$/.test(reason)))
  // 期刊信号不能被这次重算弄丢
  assert.equal(hot.quality.impactFactor, 5.0)
  // 查不到的那篇：百分位保持 null，绝不能写成 0（那会变成 Q4）
  assert.equal(fresh.citationPercentile, null)
  // 没 DOI 的那篇完全没动
  assert.equal(noDoi.citationPercentile, null)
  assert.equal(noDoi.citationPercentileAt, '')
})

test('backfillPercentiles 给查不到的条目也打时间戳，避免每轮重查', async (t) => {
  const { store } = await storeWithMissingPercentile(t)
  let calls = 0
  const first = await backfillPercentiles(store, {
    percentileResolver: async () => {
      calls += 1
      return {}
    },
  })
  assert.equal(first, 0)
  assert.equal(calls, 1)

  const state = await store.load()
  for (const item of state.items) {
    if (String(item.doi ?? '') === '') {
      assert.equal(item.citationPercentileAt, '')
    } else {
      // 查询失败的条目也要有戳，否则最新论文每轮都被重新查一遍
      assert.ok(typeof item.citationPercentileAt === 'string' && item.citationPercentileAt !== '')
    }
  }

  // 30 天窗口内再跑一次：一个请求都不该发
  assert.equal(
    await backfillPercentiles(store, {
      percentileResolver: async () => {
        calls += 1
        return {}
      },
    }),
    0,
  )
  assert.equal(calls, 1)
})

test('backfillPercentiles 过了刷新窗口会重新查一次（被引涨了百分位会变）', async (t) => {
  const { store } = await storeWithMissingPercentile(t)
  const now = Date.parse('2026-11-10T00:00:00.000Z')
  await backfillPercentiles(store, {
    now,
    percentileResolver: async () => ({ '10.1016/j.ijthermalsci.2023.108796': 90 }),
  })
  // 窗口内：不查
  let calls = 0
  await backfillPercentiles(store, {
    now: now + 10 * 24 * 60 * 60 * 1000,
    percentileResolver: async () => {
      calls += 1
      return {}
    },
  })
  assert.equal(calls, 0)
  // 超过 30 天：重查，且这次百分位涨了
  await backfillPercentiles(store, {
    now: now + 40 * 24 * 60 * 60 * 1000,
    percentileResolver: async () => {
      calls += 1
      return { '10.1016/j.ijthermalsci.2023.108796': 99 }
    },
  })
  assert.equal(calls, 1)
  const state = await store.load()
  assert.equal(state.items[0].citationPercentile, 99)
})

test('backfillPercentiles 没有期刊指标时不把已有质量分降档', async (t) => {
  const { store } = await storeWithMissingPercentile(t)
  // journals 传 null：paperQuality 会把期刊信号当成「没收录」，整篇重算会把
  // 顶刊论文从 high 打成 medium。这种情况只能改分区相关字段。
  await backfillPercentiles(store, {
    journals: null,
    percentileResolver: async () => ({ '10.1016/j.ijthermalsci.2023.108796': 99 }),
  })
  const state = await store.load()
  const hot = state.items[0]
  assert.equal(hot.citationPercentile, 99)
  assert.equal(hot.quality.quartile, 'Q1')
  assert.equal(hot.quality.tier, 'high')
  assert.equal(hot.quality.score, 68)
  assert.equal(hot.quality.impactFactor, 5.0)
  // 理由里旧的「被引 14 次」要留着，不要被这次更新冲掉
  assert.ok(hot.quality.reasons.includes('被引 14 次'))
})

test('backfillPercentiles 空库与上游抛错都安全返回 0', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, { version: 1, topics: [], items: [], seen: {}, settings: {} })
  const store = createStore({}, { dataDir: dir })
  assert.equal(await backfillPercentiles(store, {}), 0)

  const second = await storeWithMissingPercentile(t)
  assert.equal(
    await backfillPercentiles(second.store, {
      percentileResolver: async () => {
        throw new Error('network down')
      },
    }),
    0,
  )
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

// ---------------------------------------------------------------------------
// 历史失败重试：一篇论文入库后 seen 会永远跳过它，所以「摘要失败」不自愈。
// 解析器变强之后必须有一条路把旧记录救回来，否则用户只能手动清空重抓。
// ---------------------------------------------------------------------------

/** 造一个只有「摘要失败」老论文的库 + 一个只会返回固定内容的 llm 桩。 */
async function storeWithFailedItems(t, text, reason = { kind: 'stop' }) {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [{ id: 't1', name: '金属橡胶', keywords: ['metal rubber'], sources: ['openalex'] }],
    items: [
      {
        id: 'openalex:f1',
        title: 'Failed by markdown',
        topicId: 't1',
        summary: null,
        summaryError: 'LLM 未返回可解析的 JSON（前 200 字：以下按文献卡片整理…）',
        summaryErrorCode: 'unparsable',
        discoveredAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'openalex:f2',
        title: 'Failed by config',
        topicId: 't1',
        summary: null,
        summaryError: '未找到可用的 LLM 路由',
        summaryErrorCode: 'no-route',
        discoveredAt: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'openalex:ok',
        title: 'Already summarized',
        topicId: 't1',
        summary: { tldr: '已有', tags: [] },
        summaryError: '',
        discoveredAt: '2026-10-03T00:00:00.000Z',
      },
    ],
    seen: {},
    settings: {},
  })
  const store = createStore({}, { dataDir: dir })
  const ctx = {
    llm: {
      stream() {
        return (async function* () {
          yield { type: 'text-delta', text }
          yield { type: 'finish', reason }
        })()
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  }
  return { store, ctx }
}

test('retryFailedSummaries 把可重试的历史失败救回来，跳过配置类失败', async (t) => {
  const { store, ctx } = await storeWithFailedItems(t, '{"tldr":"救回来了","tags":["金属橡胶"]}')

  const ok = await retryFailedSummaries(store, { ctx, config: {}, fullText: false })
  assert.equal(ok, 1)

  const state = await store.load()
  const byId = new Map(state.items.map((item) => [item.id, item]))
  // 救回来的：摘要有了，错误清空，错误码也删掉（否则面板还会显示红字）
  assert.equal(byId.get('openalex:f1').summary.tldr, '救回来了')
  assert.equal(byId.get('openalex:f1').summaryError, '')
  assert.equal(byId.get('openalex:f1').summaryErrorCode, undefined)
  // no-route 是配置错，重试只会白烧 token —— 不该动它
  assert.equal(byId.get('openalex:f2').summary, null)
  assert.equal(byId.get('openalex:f2').summaryErrorCode, 'no-route')
  // 已经有摘要的不碰
  assert.equal(byId.get('openalex:ok').summary.tldr, '已有')
})

test('retryFailedSummaries 又失败时把新的失败原因写回，下次按新原因判断', async (t) => {
  const { store, ctx } = await storeWithFailedItems(t, '这篇论文挺有意思但没有 JSON')
  const ok = await retryFailedSummaries(store, { ctx, config: {}, fullText: false })
  assert.equal(ok, 0)

  const state = await store.load()
  const item = state.items.find((entry) => entry.id === 'openalex:f1')
  assert.equal(item.summary, null)
  // 仍然是 unparsable，但错误文案换成了这次的输出预览
  assert.equal(item.summaryErrorCode, 'unparsable')
  assert.match(item.summaryError, /没有返回可解析的摘要/)
})

test('retryFailedSummaries 没有待重试的条目时直接返回 0，不发请求', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [],
    items: [{ id: 'a', title: 'ok', summary: { tldr: 'x', tags: [] }, summaryError: '' }],
    seen: {},
    settings: {},
  })
  const store = createStore({}, { dataDir: dir })
  let called = 0
  const ctx = {
    llm: {
      stream() {
        called += 1
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  }
  assert.equal(await retryFailedSummaries(store, { ctx, config: {} }), 0)
  assert.equal(called, 0)
})

test('retryFailedSummaries 尊重 limit，一次不会把历史欠账全部重跑', async (t) => {
  const { store, ctx } = await storeWithFailedItems(t, '{"tldr":"x"}')
  // limit=1 只处理第一篇（f1）；f2 是 no-route 本来就不该重试
  const ok = await retryFailedSummaries(store, { ctx, config: {}, fullText: false, limit: 1 })
  assert.equal(ok, 1)
})

test('retryFailedSummaries 缺少 llm 服务时安全返回 0', async (t) => {
  const { store } = await storeWithFailedItems(t, '{}')
  assert.equal(await retryFailedSummaries(store, {}), 0)
  assert.equal(await retryFailedSummaries(store, { ctx: {} }), 0)
})

test('retryFailedSummaries 支持按 id 定点重试，只动指定的那一篇', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [{ id: 't1', name: '金属橡胶', keywords: ['metal rubber'], sources: ['openalex'] }],
    items: [
      { id: 'a', title: 'A', topicId: 't1', summary: null, summaryError: '坏了 a', summaryErrorCode: 'unparsable' },
      { id: 'b', title: 'B', topicId: 't1', summary: null, summaryError: '坏了 b', summaryErrorCode: 'unparsable' },
    ],
    seen: {},
    settings: {},
  })
  const store = createStore({}, { dataDir: dir })
  let calls = 0
  const ctx = {
    llm: {
      stream() {
        calls += 1
        return (async function* () {
          yield { type: 'text-delta', text: '{"tldr":"定点救回","tags":[]}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  }

  // 只点名 b，a 必须原封不动
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, fullText: false, itemId: 'b' }), 1)
  assert.equal(calls, 1)
  const state = await store.load()
  const byId = new Map(state.items.map((entry) => [entry.id, entry]))
  assert.equal(byId.get('b').summary.tldr, '定点救回')
  assert.equal(byId.get('b').summaryError, '')
  assert.equal(byId.get('a').summary, null)
  assert.equal(byId.get('a').summaryErrorCode, 'unparsable')
})

test('retryFailedSummaries 点名的 id 不在可重试范围时安静返回 0', async (t) => {
  const { store, ctx } = await storeWithFailedItems(t, '{"tldr":"x"}')
  // 不存在的 id / 配置类失败的 id / 已有摘要的 id 都不该触发调用
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, itemId: 'nope' }), 0)
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, itemId: 'openalex:f2' }), 0)
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, itemId: 'openalex:ok' }), 0)
})

/**
 * 降级提取（salvaged）与截断（truncated）算「成功」，`summaryError` 是空的。
 * 但用户看着「降级提取」徽章想换深度/换模型重做一次时，旧判据（必须 summaryError 非空）
 * 让面板上的「重新总结」点了也白点。这里固化成两条边界：
 *   1. 点名那一篇 → 允许重做；
 *   2. 全量自动重试（不点名）→ 仍然只救失败的，不去无脑重跑已成功的结果。
 */
async function storeWithRedoableItems(t, text) {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [{ id: 't1', name: '金属橡胶', keywords: ['metal rubber'], sources: ['openalex'] }],
    items: [
      {
        id: 'openalex:salvaged',
        title: 'Salvaged summary',
        topicId: 't1',
        summary: { tldr: '拆出来的结论', tags: ['metal rubber'], salvaged: true },
        summaryError: '',
        discoveredAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'openalex:truncated',
        title: 'Truncated summary',
        topicId: 't1',
        summary: { tldr: '被截断的结论', tags: [], truncated: true },
        summaryError: '',
        discoveredAt: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'openalex:clean',
        title: 'Good summary',
        topicId: 't1',
        summary: { tldr: '好好的', tags: [] },
        summaryError: '',
        discoveredAt: '2026-10-03T00:00:00.000Z',
      },
    ],
    seen: {},
    settings: {},
  })
  const store = createStore({}, { dataDir: dir })
  let calls = 0
  const ctx = {
    llm: {
      stream() {
        calls += 1
        return (async function* () {
          yield { type: 'text-delta', text }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  }
  return { store, ctx, calls: () => calls }
}

test('retryFailedSummaries 点名时可以重做「降级提取」的摘要', async (t) => {
  const { store, ctx, calls } = await storeWithRedoableItems(t, '{"tldr":"重做成功","tags":[]}')
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, fullText: false, itemId: 'openalex:salvaged' }), 1)
  assert.equal(calls(), 1)
  const byId = new Map((await store.load()).items.map((entry) => [entry.id, entry]))
  assert.equal(byId.get('openalex:salvaged').summary.tldr, '重做成功')
  assert.equal(byId.get('openalex:salvaged').summary.salvaged, undefined)
  // 其余两条一点都不该动
  assert.equal(byId.get('openalex:truncated').summary.tldr, '被截断的结论')
  assert.equal(byId.get('openalex:clean').summary.tldr, '好好的')
})

test('retryFailedSummaries 点名时可以重做「输出被截断」的摘要', async (t) => {
  const { store, ctx, calls } = await storeWithRedoableItems(t, '{"tldr":"截断重做","tags":[]}')
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, fullText: false, itemId: 'openalex:truncated' }), 1)
  assert.equal(calls(), 1)
  const byId = new Map((await store.load()).items.map((entry) => [entry.id, entry]))
  assert.equal(byId.get('openalex:truncated').summary.tldr, '截断重做')
  assert.equal(byId.get('openalex:truncated').summary.truncated, undefined)
})

test('全量自动重试不会去重跑已经成功（含降级/截断）的摘要', async (t) => {
  const { store, ctx, calls } = await storeWithRedoableItems(t, '{"tldr":"不该被调用","tags":[]}')
  // 一篇失败的都没有 → 一次模型调用都不该发
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, fullText: false }), 0)
  assert.equal(calls(), 0)
})

test('重做已成功的摘要时这次失败，不能把旧摘要写回去当成功', async (t) => {
  // 模型这次一个字都没吐出来 → summarizePaper 抛 unparsable
  const { store, ctx, calls } = await storeWithRedoableItems(t, '')
  assert.equal(await retryFailedSummaries(store, { ctx, config: {}, fullText: false, itemId: 'openalex:salvaged' }), 0)
  assert.equal(calls(), 1) // 「一个字都没吐」属于不可重试的失败，summarizeOne 只调一次
  const target = (await store.load()).items.find((entry) => entry.id === 'openalex:salvaged')
  // 旧摘要必须原样留着（不能被空值或半成品覆盖），但错误状态要如实记上
  assert.equal(target.summary.tldr, '拆出来的结论')
  assert.notEqual(target.summaryError, '')
  assert.equal(target.summaryErrorCode, 'unparsable')
})

test('重做失败时不该把 summaryError 清空（用户要能看到还是失败了）', async (t) => {
  const { store, ctx } = await storeWithRedoableItems(t, '')
  await retryFailedSummaries(store, { ctx, config: {}, fullText: false, itemId: 'openalex:truncated' })
  const target = (await store.load()).items.find((entry) => entry.id === 'openalex:truncated')
  // 旧结果（标记 truncated 的摘要）保留，同时挂上新错误
  assert.equal(target.summary.truncated, true)
  assert.match(target.summaryError, /没有返回可解析的摘要/)
})