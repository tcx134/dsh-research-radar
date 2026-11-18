import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { apply, paginateItems, parseQuartiles } from '../index.js'
import { call, makeCtx, seedState, tempDir } from './helpers.js'

/**
 * 造 n 条论文，期刊分区按索引分配：
 * 0–2 是 Q1、3–5 是 Q2、6–7 是 Q3、8 是 Q4，最后一条没有分区。
 *
 * 分区放在 `quality.journalQuartile`，因为面板与筛选看的就是这个字段
 * （`quality.tier` 是由它推出来的档位，两者不是一回事）。
 */
const QUADS = ['Q1', 'Q1', 'Q1', 'Q2', 'Q2', 'Q2', 'Q3', 'Q3', 'Q4']

function papers(n) {
  return Array.from({ length: n }, (_, index) => {
    const quartile = index === n - 1 ? null : QUADS[index % QUADS.length]
    return {
      id: `openalex:W${index}`,
      topicId: 't-a',
      topicName: '方向A',
      source: 'openalex',
      title: `Paper ${index}`,
      publishedAt: '2026-09-01',
      discoveredAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
      issn: '',
      quality: {
        score: 80,
        tier: quartile === 'Q1' ? 'high' : quartile === null ? 'medium' : 'low',
        reasons: [],
        journalQuartile: quartile,
      },
    }
  })
}

/** 写一份带期刊指标的缓存，让 publicState 能现算分区。 */
async function seedJournalCache(dir, entries) {
  const fsp = await import('node:fs/promises')
  await fsp.writeFile(
    path.join(dir, 'journals.json'),
    JSON.stringify({ version: 2, entries, thresholds: { 2210: { q1: 4.77, q2: 2.51, q3: 1.29, total: 2373 } } }),
    'utf8',
  )
}

test('parseQuartiles 解析多选，空与非法值都当成「不限」', () => {
  assert.deepEqual([...parseQuartiles('Q1,Q2')], ['Q1', 'Q2'])
  assert.deepEqual([...parseQuartiles('q1, q3')], ['Q1', 'Q3'])
  // 数组形式也接受（URL 里同名参数出现多次时 searchParams.getAll 会给数组）
  assert.deepEqual([...parseQuartiles(['Q1', 'Q4'])], ['Q1', 'Q4'])
  for (const empty of ['', null, undefined, 'nonsense', 'Q5', ',,,']) {
    assert.equal(parseQuartiles(empty).size, 0, `${String(empty)} 应该是不限`)
  }
  // 混着非法值的合法值要留下
  assert.deepEqual([...parseQuartiles('Q2,abc')], ['Q2'])
})

test('paginateItems 支持按期刊分区多选筛选', () => {
  const all = papers(10)
  const q1 = paginateItems(all, { quartiles: 'Q1' })
  assert.equal(q1.total, 3)
  assert.ok(q1.items.every((i) => i.quality.journalQuartile === 'Q1'))

  const both = paginateItems(all, { quartiles: 'Q1,Q3' })
  assert.equal(both.total, 5)
  assert.ok(both.items.every((i) => ['Q1', 'Q3'].includes(i.quality.journalQuartile)))

  // 不传 = 不限，连没有分区的那条也在
  assert.equal(paginateItems(all).total, 10)
  // 勾了分区之后，没有分区的论文不显示（用户明确只想看某几档）
  const q4 = paginateItems(all, { quartiles: 'Q4' })
  assert.equal(q4.total, 1)
  assert.equal(q4.items[0].id, 'openalex:W8')
  // 没有分区的那条（W9）在勾任何分区时都不出现
  assert.equal(
    paginateItems(all, { quartiles: 'Q1,Q2,Q3,Q4' }).items.some((i) => i.id === 'openalex:W9'),
    false,
  )
})

test('分区筛选与其它筛选条件叠加生效', () => {
  const all = papers(10).map((item, index) => ({ ...item, read: index < 5 }))
  const page = paginateItems(all, { quartiles: 'Q1,Q2', filter: 'unread' })
  // Q1/Q2 是 index 0–5，其中 index >= 5 的才算未读
  assert.ok(page.items.every((i) => i.read !== true))
  assert.ok(page.items.every((i) => ['Q1', 'Q2'].includes(i.quality.journalQuartile)))
  assert.equal(page.total, 1)
})

test('GET /state 按期刊分区筛选，并在 counts 里报每档篇数', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [{ id: 't-a', name: '方向A', keywords: ['metal rubber'] }],
    items: papers(10),
    seen: {},
    settings: {},
  })
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })

  const all = await call(ctx, { url: '/api/dsh-research-radar/state?limit=100' })
  assert.equal(all.status, 200)
  // Q1/Q2/Q3 各 3/3/2 篇（索引 0–7），索引 8 是 Q4，索引 9 没有分区
  assert.deepEqual(all.body.counts.quartiles, { Q1: 3, Q2: 3, Q3: 2, Q4: 1, none: 1 })
  // 面板要知道有哪几档可以勾
  assert.deepEqual(all.body.journalQuartiles, ['Q1', 'Q2', 'Q3', 'Q4'])

  const q2 = await call(ctx, { url: '/api/dsh-research-radar/state?limit=100&quartiles=Q2' })
  assert.equal(q2.body.page.total, 3)
  assert.ok(q2.body.items.every((i) => i.quality.journalQuartile === 'Q2'))

  const multi = await call(ctx, { url: '/api/dsh-research-radar/state?limit=100&quartiles=Q1,Q4' })
  assert.equal(multi.body.page.total, 4)

  // 非法分区不能把列表清空
  const broken = await call(ctx, { url: '/api/dsh-research-radar/state?limit=100&quartiles=Q9' })
  assert.equal(broken.body.page.total, 10)
  ctx.disposeAll()
})

test('老论文的 quality 里没有 journalQuartile 时，面板会按缓存现算补上', async (t) => {
  const dir = await tempDir(t)
  // 库里存的是老格式：有 quality 但没有 journalQuartile（分区是后加的字段）
  await seedState(dir, {
    version: 1,
    topics: [{ id: 't-a', name: '方向A' }],
    items: [
      {
        id: 'openalex:W1',
        topicId: 't-a',
        title: '老论文',
        issn: '1111-1111',
        publishedAt: '2026-09-01',
        discoveredAt: '2026-09-01T00:00:00.000Z',
        quality: { score: 72, tier: 'high', reasons: ['旧数据'] },
      },
    ],
    seen: {},
    settings: {},
  })
  // 期刊指标在缓存里，子学科是 2210（阈值 q1=4.77）
  await seedJournalCache(dir, {
    '1111-1111': { name: 'Q1 刊', twoYearMeanCitedness: 9, hIndex: 200, isCore: true, subfieldId: '2210' },
  })
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })

  const { body } = await call(ctx, { url: '/api/dsh-research-radar/state?limit=10' })
  assert.equal(body.items[0].quality.journalQuartile, 'Q1')
  // 现算出来的档位也要跟着分区走
  assert.equal(body.items[0].quality.tier, 'high')
  assert.equal(body.counts.quartiles.Q1, 1)
  ctx.disposeAll()
})

test('没有子学科阈值时不清掉老论文已有的分数', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, {
    version: 1,
    topics: [{ id: 't-a', name: '方向A' }],
    items: [
      {
        id: 'openalex:W1',
        topicId: 't-a',
        title: '老论文',
        issn: '1111-1111',
        publishedAt: '2026-09-01',
        discoveredAt: '2026-09-01T00:00:00.000Z',
        quality: { score: 72, tier: 'high', reasons: ['旧数据'] },
      },
    ],
    seen: {},
    settings: {},
  })
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })

  const { body } = await call(ctx, { url: '/api/dsh-research-radar/state?limit=10' })
  // 阈值还没算过 → 判不出分区，保留原来的分数，不能降级成「无期刊指标」重算
  assert.equal(body.items[0].quality.score, 72)
  assert.deepEqual(body.items[0].quality.reasons, ['旧数据'])
  assert.equal(body.counts.quartiles.none, 1)
  ctx.disposeAll()
})

test('fullText 默认关，老 state 里的 true 会被一次性关掉，之后用户还能自己打开', async (t) => {
  const dir = await tempDir(t)
  // 老 state：显式存着 fullText: true，且没有迁移标记
  await seedState(dir, {
    version: 1,
    topics: [],
    items: [],
    seen: {},
    settings: { scan: { fullText: true } },
  })
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const off = await call(ctx, { url: '/api/dsh-research-radar/state' })
  assert.equal(off.body.settings.scan.fullText, false)
  // 迁移标记要落盘，否则每次读都会把用户打开的开关又关掉
  assert.equal(off.body.settings.scan.fullTextMigrated, true)

  const on = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/settings',
    headers: { 'content-type': 'application/json' },
    body: { settings: { scan: { fullText: true } } },
  })
  assert.equal(on.body.state.settings.scan.fullText, true)
  ctx.disposeAll()

  // 重新 apply 一次，用户的选择要被尊重（不能又被迁移关掉）
  const second = makeCtx()
  apply(second, { dataDir: dir })
  const again = await call(second, { url: '/api/dsh-research-radar/state' })
  assert.equal(again.body.settings.scan.fullText, true)
  second.disposeAll()
})
