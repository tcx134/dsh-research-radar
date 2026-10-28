import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  JOURNAL_CACHE_DAYS,
  QUALITY_TIERS,
  citationPercentileScore,
  citationScore,
  createJournalCache,
  fetchJournalMetrics,
  journalScore,
  normalizeIssn,
  paperQuality,
  quartileOf,
  resolveIssnsByDoi,
} from '../radar/quality.js'

test('normalizeIssn 认得出各种写法，认不出返回空串', () => {
  assert.equal(normalizeIssn('02638231'), '0263-8231')
  assert.equal(normalizeIssn('0263-8231'), '0263-8231')
  assert.equal(normalizeIssn('0263 8231'), '0263-8231')
  assert.equal(normalizeIssn('ISSN 0263-8231'), '0263-8231')
  // 末位校验位可以是 X
  assert.equal(normalizeIssn('1234567X'), '1234-567X')
  assert.equal(normalizeIssn('0263-823'), '')
  assert.equal(normalizeIssn(''), '')
  assert.equal(normalizeIssn(null), '')
  assert.equal(normalizeIssn(undefined), '')
})

test('journalScore 用对数曲线，工程领域好刊不会被误判成低质量', () => {
  // 线性映射会把 IF 5 打成 25 分、IF 8.5 打成 42 分，好刊全变「低质量」。
  // 对数曲线下 IF 1→29、3→58、5→75、8.5→94、10→100。
  assert.equal(journalScore({ twoYearMeanCitedness: 1 }), 29)
  assert.equal(journalScore({ twoYearMeanCitedness: 3 }), 58)
  assert.equal(journalScore({ twoYearMeanCitedness: 5 }), 75)
  assert.equal(journalScore({ twoYearMeanCitedness: 8.512 }), 94)
  assert.equal(journalScore({ twoYearMeanCitedness: 10 }), 100)
  // 超过 10 封顶，不能溢出
  assert.equal(journalScore({ twoYearMeanCitedness: 50 }), 100)
  // 没有影响因子时用 h 指数兜底，且不超过 60
  assert.equal(journalScore({ twoYearMeanCitedness: null, hIndex: 200 }), 60)
  assert.equal(journalScore({ twoYearMeanCitedness: 0, hIndex: 100 }), 30)
  // 什么都没有就是 0
  assert.equal(journalScore(null), 0)
  assert.equal(journalScore({}), 0)
})

test('citationScore 按年化被引算，新论文不因为 0 被引被判死', () => {
  const now = Date.parse('2026-10-01T00:00:00Z')
  assert.equal(citationScore(0, '2020-01-01', now), 0)
  // 5 年被引 100 次 = 每年 20 次，打满
  assert.equal(citationScore(100, '2021-10-01', now), 100)
  // 刚发表 1 个月就有 2 次被引，年化很高（说明热门），但不超过 100
  assert.ok(citationScore(2, '2026-09-01', now) > 0)
  assert.ok(citationScore(2, '2026-09-01', now) <= 100)
  // 坏时间戳按 3 年算，不崩
  assert.ok(citationScore(10, 'not-a-date', now) > 0)
  assert.equal(citationScore(-1, '2020-01-01', now), 0)
  assert.equal(citationScore('abc', '2020-01-01', now), 0)
})

test('paperQuality 综合期刊与被引给出档位与可读理由', () => {
  const journals = new Map([
    ['0263-8231', { twoYearMeanCitedness: 8.512, hIndex: 154, isCore: true }],
    ['2073-8994', { twoYearMeanCitedness: 2.6, hIndex: 40, isCore: true }],
    ['1580-2949', { twoYearMeanCitedness: 0.6, hIndex: 30, isCore: true }],
  ])
  const now = Date.parse('2026-10-01T00:00:00Z')

  const high = paperQuality(
    { issn: '0263-8231', citations: 30, publishedAt: '2025-03-01', openAccess: true },
    { journals, now },
  )
  assert.equal(high.tier, 'high')
  assert.ok(high.score >= 60)
  assert.equal(high.impactFactor, 8.512)
  assert.ok(high.reasons.includes('期刊影响因子 8.5'))
  assert.ok(high.reasons.includes('被引 30 次'))
  assert.ok(high.reasons.includes('开放获取（可抓全文）'))
  assert.ok(high.reasons.includes('核心期刊'))

  const medium = paperQuality({ issn: '2073-8994', citations: 6, publishedAt: '2025-06-01' }, { journals, now })
  assert.equal(medium.tier, 'medium')

  const low = paperQuality({ issn: '1580-2949', citations: 5, publishedAt: '2024-01-01' }, { journals, now })
  assert.equal(low.tier, 'low')

  // 期刊查不到 + 没被引 = 待评估，而不是「低质量」
  const unknown = paperQuality({ issn: '', citations: 0, publishedAt: '2026-10-01' }, { journals, now })
  assert.equal(unknown.tier, 'unknown')
  assert.equal(unknown.score, 0)
  assert.deepEqual(unknown.reasons, ['未识别到期刊'])
})

test('paperQuality 不传期刊表也能用（退化成只看被引与 OA）', () => {
  const q = paperQuality({ issn: '0263-8231', citations: 50, publishedAt: '2022-01-01', openAccess: true })
  assert.ok(Number.isFinite(q.score))
  assert.equal(q.impactFactor, null)
  assert.ok(QUALITY_TIERS.includes(q.tier))
})

test('paperQuality 对脏输入安全', () => {
  for (const input of [null, undefined, {}, { citations: 'x' }, { issn: 123, citations: null }]) {
    const q = paperQuality(input)
    assert.ok(Number.isFinite(q.score), `score 必须是数字：${JSON.stringify(input)}`)
    assert.ok(QUALITY_TIERS.includes(q.tier))
  }
})

test('quartileOf 把被引百分位分成 Q1–Q4，没有百分位返回 null', () => {
  assert.equal(quartileOf(96), 'Q1')
  assert.equal(quartileOf(90), 'Q1')
  assert.equal(quartileOf(75), 'Q1')
  assert.equal(quartileOf(74), 'Q2')
  assert.equal(quartileOf(50), 'Q2')
  assert.equal(quartileOf(49), 'Q3')
  assert.equal(quartileOf(25), 'Q3')
  assert.equal(quartileOf(24), 'Q4')
  assert.equal(quartileOf(0), 'Q4')
  // `Number(null) === 0`、`Number('') === 0`，不先挡掉就会把每篇新论文标成 Q4
  for (const missing of [null, undefined, '', 'abc', NaN]) {
    assert.equal(quartileOf(missing), null, `${String(missing)} 应该没有分区`)
  }
})

test('citationPercentileScore 直接沿用百分位，缺信号时是 null 而不是 0', () => {
  assert.equal(citationPercentileScore(96), 96)
  assert.equal(citationPercentileScore(50), 50)
  assert.equal(citationPercentileScore(0), 0)
  // null 不能变成 0：0 分等于「被引排最后」，会让没算过百分位的新论文被判死
  for (const missing of [null, undefined, '', 'abc']) {
    assert.equal(citationPercentileScore(missing), null)
  }
})

test('有百分位时优先用百分位，跨学科可比', () => {
  const now = Date.parse('2026-10-01T00:00:00Z')
  // 同一篇论文（同样 5 次被引、同样 2025 年发表），有百分位时按百分位算
  const top = paperQuality({ citations: 5, publishedAt: '2025-01-01', citationPercentile: 90 }, { now })
  const mid = paperQuality({ citations: 5, publishedAt: '2025-01-01', citationPercentile: 40 }, { now })
  assert.ok(top.score > mid.score, `前 10% 应该高于前 60%：${top.score} vs ${mid.score}`)
  assert.equal(top.quartile, 'Q1')
  assert.equal(mid.quartile, 'Q3')
  assert.ok(top.reasons.some((r) => r.includes('Q1')))
  assert.ok(top.reasons.some((r) => r.includes('被引前 10%')))
})

test('缺一个信号时用中性先验补权重，不让「没证据」压过「有证据」', () => {
  const journals = new Map([['0263-8231', { twoYearMeanCitedness: 8.512, hIndex: 154, isCore: true }]])
  const now = Date.parse('2026-10-01T00:00:00Z')
  // 顶刊 + 刚发表（还没算百分位）不该拿到比「顶刊 + 前 45%」更高的分
  const fresh = paperQuality({ issn: '0263-8231', citations: 0, publishedAt: '2026-09-01' }, { journals, now })
  const decent = paperQuality(
    { issn: '0263-8231', citations: 3, publishedAt: '2026-05-01', citationPercentile: 55 },
    { journals, now },
  )
  assert.ok(fresh.score <= decent.score, `没证据(${fresh.score}) 不该高于中等证据(${decent.score})`)
  assert.equal(fresh.quartile, null)

  // 缺期刊信号时同理：不能被「只按被引算」推到顶刊论文前面
  const noJournal = paperQuality({ citations: 5, publishedAt: '2026-01-01', citationPercentile: 90 }, { journals, now })
  const topJournal = paperQuality(
    { issn: '0263-8231', citations: 3, publishedAt: '2026-05-01', citationPercentile: 55 },
    { journals, now },
  )
  assert.ok(noJournal.score < 90, `缺期刊信号不该拿满分附近：${noJournal.score}`)
  assert.ok(Number.isFinite(topJournal.score))
})

test('两个信号都没有时是 unknown 且 0 分，不是「中等 50 分」', () => {
  const q = paperQuality({ issn: '', citations: 0, publishedAt: '2026-10-01', openAccess: true })
  assert.equal(q.tier, 'unknown')
  // 中性先验只在另一个信号存在时补权重；两个都没有还报 50 分会让人以为这是篇中等论文
  assert.equal(q.score, 0)
  assert.equal(q.quartile, null)
  assert.equal(q.citationPercentile, null)
})

test('fetchJournalMetrics 批量查 ISSN 并跳过查不到的', async (t) => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const payload = {
      results: [
        {
          id: 'https://openalex.org/S1',
          display_name: 'Thin-Walled Structures',
          issn_l: '0263-8231',
          summary_stats: { '2yr_mean_citedness': 8.5, h_index: 154, i10_index: 7765 },
          works_count: 12375,
          is_core: true,
          is_in_doaj: false,
          type: 'journal',
        },
      ],
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const out = await fetchJournalMetrics(['02638231', '0263-8231', '', '9999-9999'], { mailto: 'a@b.c' })
  // 重复的 ISSN 只查一次
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes('issn%3A0263-8231%7C9999-9999'))
  assert.ok(calls[0].includes('mailto=a%40b.c'))
  assert.deepEqual(Object.keys(out), ['0263-8231'])
  assert.equal(out['0263-8231'].twoYearMeanCitedness, 8.5)
  assert.equal(out['0263-8231'].hIndex, 154)
  assert.equal(out['0263-8231'].isCore, true)
})

test('fetchJournalMetrics 上游报错时返回空对象而不是抛错', async (t) => {
  const original = globalThis.fetch
  // 用 404（不可重试）而不是网络错误 —— 网络错误会走 4s/9s/18s 退避，
  // 单测里白等 30 秒没有意义。
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => '',
  })
  t.after(() => {
    globalThis.fetch = original
  })
  const out = await fetchJournalMetrics(['0263-8231'], {})
  assert.deepEqual(out, {})
})

test('期刊缓存：命中缓存不重复请求，过期才刷新，查不到的也记一笔', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drr-q-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))

  const original = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    const payload = {
      results: [
        {
          display_name: 'Thin-Walled Structures',
          issn_l: '0263-8231',
          summary_stats: { '2yr_mean_citedness': 8.5, h_index: 154 },
          is_core: true,
        },
      ],
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const cache = createJournalCache({ dir })
  const now = Date.parse('2026-10-01T00:00:00Z')

  assert.equal(await cache.ensure(['0263-8231', '9999-9999'], {}, now), 2)
  assert.equal(requests, 1)
  assert.equal(cache.get('0263-8231').twoYearMeanCitedness, 8.5)
  // 查不到的 ISSN 也进缓存（标记 missing），避免每轮扫描重试冷门期刊
  assert.equal(cache.get('9999-9999').missing, true)

  // 缓存有效期内不再请求
  assert.equal(await cache.ensure(['0263-8231'], {}, now + 86400000), 0)
  assert.equal(requests, 1)

  // 超过缓存期要刷新
  const expired = now + (JOURNAL_CACHE_DAYS + 1) * 86400000
  assert.equal(await cache.ensure(['0263-8231'], {}, expired), 1)
  assert.equal(requests, 2)

  // 缓存确实落盘了（新建一个 cache 实例能读到）
  const raw = JSON.parse(await fsp.readFile(path.join(dir, 'journals.json'), 'utf8'))
  assert.equal(raw.version, 1)
  assert.ok(raw.entries['0263-8231'].fetchedAt)

  // asMap 给出可直接喂给 paperQuality 的 Map
  const map = cache.asMap()
  assert.equal(map.get('0263-8231').hIndex, 154)
})

test('resolveIssnsByDoi 用一次请求查回多个 DOI 的 ISSN', async (t) => {
  const original = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    const payload = {
      results: [
        {
          doi: 'https://doi.org/10.1016/j.tws.2026.115741',
          primary_location: { source: { issn_l: '0263-8231' } },
        },
        {
          // DOI 回来时大小写混杂，也要能对上
          doi: 'https://doi.org/10.3390/POLYM1613045',
          primary_location: { source: { issn_l: '2073-4360' } },
        },
      ],
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const out = await resolveIssnsByDoi(
    [
      '10.1016/j.tws.2026.115741',
      'https://doi.org/10.3390/polym1613045',
      'doi:10.1016/j.tws.2026.115741',
      '',
      null,
    ],
    {},
  )
  assert.deepEqual(out, {
    '10.1016/j.tws.2026.115741': '0263-8231',
    '10.3390/polym1613045': '2073-4360',
  })
  // 去重后只剩两个 DOI，且 OR 查询只能写一次字段前缀（`doi:a|b`）
  assert.equal(urls.length, 1)
  const filter = decodeURIComponent(new URL(urls[0]).searchParams.get('filter'))
  assert.ok(filter.startsWith('doi:'))
  assert.equal(filter.split('doi:').length, 2)
})

test('resolveIssnsByDoi 上游报错时返回空对象，不抛错', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => '{"error":"bad"}' })
  t.after(() => {
    globalThis.fetch = original
  })
  assert.deepEqual(await resolveIssnsByDoi(['10.1/x'], {}), {})
})
