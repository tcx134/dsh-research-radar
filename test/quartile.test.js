import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  JOURNAL_QUARTILES,
  createJournalCache,
  fetchSubfieldThresholds,
  paperQuality,
  quartileFromImpactFactor,
} from '../radar/quality.js'

test('JOURNAL_QUARTILES 从高到低', () => {
  assert.deepEqual(JOURNAL_QUARTILES, ['Q1', 'Q2', 'Q3', 'Q4'])
})

test('quartileFromImpactFactor 按子学科内的 IF 分位判 Q1–Q4', () => {
  // 实测阈值：Mechanical Engineering 有 IF 的核心期刊 2373 本，
  // 第 25%/50%/75% 名的影响因子分别是 4.77 / 2.51 / 1.29
  const thresholds = { q1: 4.77, q2: 2.51, q3: 1.29, total: 2373 }
  // MSSP 的 IF 11.24 在 Civil and Structural Engineering 排 3.2%，是 Q1
  assert.equal(quartileFromImpactFactor(11.24, thresholds), 'Q1')
  // 正好等于阈值算进更高一档，跟着「前 25%」的字面意思走
  assert.equal(quartileFromImpactFactor(4.77, thresholds), 'Q1')
  assert.equal(quartileFromImpactFactor(4.76, thresholds), 'Q2')
  assert.equal(quartileFromImpactFactor(2.51, thresholds), 'Q2')
  assert.equal(quartileFromImpactFactor(2.5, thresholds), 'Q3')
  assert.equal(quartileFromImpactFactor(1.29, thresholds), 'Q3')
  assert.equal(quartileFromImpactFactor(1.28, thresholds), 'Q4')
  assert.equal(quartileFromImpactFactor(0.1, thresholds), 'Q4')
})

test('quartileFromImpactFactor 缺数据时返回 null，绝不硬塞 Q4', () => {
  const thresholds = { q1: 4.77, q2: 2.51, q3: 1.29, total: 2373 }
  // 没有影响因子（会议录、丛书、中文刊都常见）——`Number(null)` 是 0，
  // 不显式挡的话每本都会被判 Q4
  for (const missing of [null, undefined, '', 'abc', Number.NaN]) {
    assert.equal(quartileFromImpactFactor(missing, thresholds), null, `IF=${String(missing)} 应该没有分区`)
  }
  // 没有阈值（子学科还没算过，或者上游挂了）
  for (const missing of [null, undefined, {}, { q1: 4.77 }, { q1: 4.77, q2: 2.51 }]) {
    assert.equal(quartileFromImpactFactor(11.24, missing), null)
  }
  // 阈值是 null 也不能拿来判
  assert.equal(quartileFromImpactFactor(11.24, { q1: null, q2: 2.51, q3: 1.29 }), null)
})

test('有期刊分区时档位由分区决定，同一个分数不再混档', () => {
  const now = Date.parse('2026-11-18T00:00:00Z')
  const journals = new Map([
    ['1111-1111', { twoYearMeanCitedness: 9, hIndex: 200, isCore: true, subfieldId: '2210', name: 'Q1 刊' }],
    ['2222-2222', { twoYearMeanCitedness: 1, hIndex: 20, isCore: true, subfieldId: '2210', name: 'Q4 刊' }],
  ])
  const thresholds = { 2210: { q1: 4.77, q2: 2.51, q3: 1.29, total: 2373 } }
  const fresh = { citations: 0, publishedAt: '2026-10-01' }

  const q1 = paperQuality({ ...fresh, issn: '1111-1111' }, { journals, thresholds, now })
  const q4 = paperQuality({ ...fresh, issn: '2222-2222' }, { journals, thresholds, now })
  assert.equal(q1.journalQuartile, 'Q1')
  assert.equal(q1.tier, 'high')
  assert.equal(q4.journalQuartile, 'Q4')
  assert.equal(q4.tier, 'low')
  // 刚发表、0 被引也照样有分区 —— 这是「按刊分区」相对「按被引百分位」的关键区别
  assert.equal(q1.quartile, null)
  assert.ok(q1.score > q4.score)
  // 理由里要写清是哪个刊的分区，不要只丢一个 Q1
  assert.ok(q1.reasons.some((r) => r.includes('Q1') && r.includes('Q1 刊')))
  assert.equal(q1.subfieldId, '2210')
})

test('没有阈值时退化成按分数分档，不会把所有人都判成 Q4', () => {
  const now = Date.parse('2026-11-18T00:00:00Z')
  const journals = new Map([
    ['1111-1111', { twoYearMeanCitedness: 9, hIndex: 200, isCore: true, subfieldId: '2210' }],
  ])
  const q = paperQuality({ issn: '1111-1111', citations: 0, publishedAt: '2026-10-01' }, { journals, now })
  assert.equal(q.journalQuartile, null)
  // 期刊信号在、被引信号缺 → 用中性先验，分数够高就是 high
  assert.equal(q.tier, 'high')
})

test('期刊没有 subfield 时判不出分区，但分数照算', () => {
  const now = Date.parse('2026-11-18T00:00:00Z')
  const journals = new Map([['3333-3333', { twoYearMeanCitedness: 9, hIndex: 200, isCore: true }]])
  const thresholds = { 2210: { q1: 4.77, q2: 2.51, q3: 1.29, total: 2373 } }
  const q = paperQuality({ issn: '3333-3333', citations: 0, publishedAt: '2026-10-01' }, { journals, thresholds, now })
  assert.equal(q.subfieldId, '')
  assert.equal(q.journalQuartile, null)
  assert.ok(Number.isFinite(q.score))
})

test('fetchSubfieldThresholds 用「总数 + 三个分位」四次请求算出阈值', async (t) => {
  const original = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    const parsed = new URL(String(url))
    const page = parsed.searchParams.get('page')
    if (page === null) {
      // 第一次只问总数
      return { ok: true, status: 200, text: async () => JSON.stringify({ meta: { count: 1000 } }) }
    }
    // page=250 → 第 25% 名；500 → 50%；750 → 75%
    const ifByRank = { 250: 4.77, 500: 2.51, 750: 1.29 }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ results: [{ summary_stats: { '2yr_mean_citedness': ifByRank[Number(page)] } }] }),
    }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const out = await fetchSubfieldThresholds(['2210'], {})
  assert.deepEqual(out['2210'], { q1: 4.77, q2: 2.51, q3: 1.29, total: 1000 })
  assert.equal(urls.length, 4)
  // 分母必须只算「有影响因子」的核心期刊，否则 75% 分位对应的 IF 会是 0
  const filter = decodeURIComponent(new URL(urls[0]).searchParams.get('filter'))
  assert.ok(filter.includes('is_core:true'))
  assert.ok(filter.includes('summary_stats.2yr_mean_citedness:>0'))
  assert.ok(filter.includes('topics.subfield.id:2210'))
  // 排序字段必须是 2yr_mean_citedness（two_year_ 报 400）
  assert.equal(new URL(urls[1]).searchParams.get('sort'), 'summary_stats.2yr_mean_citedness:desc')
})

test('fetchSubfieldThresholds 上游报错时返回空对象，不抛错', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => '{"error":"bad"}' })
  t.after(() => {
    globalThis.fetch = original
  })
  assert.deepEqual(await fetchSubfieldThresholds(['2210'], {}), {})
})

test('期刊缓存把子学科阈值一起存盘，且过期的才重算', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drr-thresholds-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))
  const original = globalThis.fetch
  let requests = 0
  globalThis.fetch = async (url) => {
    requests += 1
    const parsed = new URL(String(url))
    const page = parsed.searchParams.get('page')
    const body =
      page === null
        ? { meta: { count: 1000 } }
        : {
            results: [
              { summary_stats: { '2yr_mean_citedness': page === '250' ? 4.77 : page === '500' ? 2.51 : 1.29 } },
            ],
          }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const now = Date.parse('2026-11-18T00:00:00Z')
  const cache = createJournalCache({ dir })
  assert.equal(await cache.ensureThresholds(['2210'], {}, now), 1)
  assert.equal(requests, 4)
  assert.equal(cache.thresholds()['2210'].q1, 4.77)

  // 有效期内不再请求
  assert.equal(await cache.ensureThresholds(['2210'], {}, now + 86400000), 0)
  assert.equal(requests, 4)

  // 落盘后新建实例也能读到（version 2 起跟期刊指标共用一个文件）
  const raw = JSON.parse(await fsp.readFile(path.join(dir, 'journals.json'), 'utf8'))
  assert.equal(raw.version, 2)
  assert.equal(raw.thresholds['2210'].q2, 2.51)
  const reopened = createJournalCache({ dir })
  await reopened.load()
  assert.equal(reopened.thresholds()['2210'].q3, 1.29)
})

/**
 * 真实场景：升级前写下的期刊缓存里根本没有 `subfieldId`（实测用户库 28 本刊
 * 全是这样），而它们的时间戳还在 30 天窗口内 —— 只按时间判新鲜的话永远不会
 * 重抓，于是「期刊分区」这条路静默失效，用户看到的还是旧的按综合分切的档位。
 */
test('缓存项缺 subfieldId 时要重抓，哪怕时间戳还在有效期内', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drr-subfield-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))
  const fresh = new Date('2026-11-17T00:00:00Z').toISOString()
  await fsp.writeFile(
    path.join(dir, 'journals.json'),
    JSON.stringify({
      version: 1,
      entries: {
        '0263-8231': { name: 'Thin-Walled Structures', twoYearMeanCitedness: 8.94, hIndex: 150, fetchedAt: fresh },
        '9999-0000': { name: '', twoYearMeanCitedness: null, hIndex: null, fetchedAt: fresh, missing: true },
      },
    }),
    'utf8',
  )
  const original = globalThis.fetch
  const asked = []
  globalThis.fetch = async (url) => {
    asked.push(String(url))
    const body = {
      results: [
        {
          issn_l: '0263-8231',
          display_name: 'Thin-Walled Structures',
          summary_stats: { '2yr_mean_citedness': 8.94, h_index: 150 },
          topics: [{ subfield: { id: 'https://openalex.org/subfields/2205', display_name: 'Civil' } }],
          type: 'journal',
          is_core: true,
          is_in_doaj: false,
          works_count: 9000,
        },
      ],
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const now = Date.parse('2026-11-18T00:00:00Z')
  const cache = createJournalCache({ dir })
  // 只重抓缺 subfieldId 的那本；`missing: true` 那本查不到就别再白试
  assert.equal(await cache.ensure(['0263-8231', '9999-0000'], {}, now), 1)
  assert.equal(asked.length, 1)
  assert.equal(cache.get('0263-8231').subfieldId, '2205')
  // 补齐之后再跑就是命中缓存
  assert.equal(await cache.ensure(['0263-8231'], {}, now), 0)
})
