import test from 'node:test'
import assert from 'node:assert/strict'

import { buildLibrary, freshnessOf, yearOf } from '../radar/library.js'

/** 2026-10-22 作为「现在」，所有新鲜度判定都相对它算。 */
const NOW = Date.parse('2026-10-22T00:00:00.000Z')

function paper(id, extra = {}) {
  return {
    id,
    title: `论文 ${id}`,
    authors: ['Li Y', 'Wang X', 'Zhao Q', 'Sun Z'],
    venue: 'Wear',
    publishedAt: '2026-01-01',
    source: 'openalex',
    topicId: 't-a',
    topicName: '金属橡胶',
    url: `https://example.org/${id}`,
    doi: '',
    citations: 0,
    read: false,
    starred: false,
    summary: null,
    discoveredAt: '2026-10-20T00:00:00.000Z',
    ...extra,
  }
}

test('yearOf 只认开头四位数字', () => {
  assert.equal(yearOf('2024-05-01'), '2024')
  assert.equal(yearOf('2024'), '2024')
  assert.equal(yearOf('2024/05/01'), '2024')
  assert.equal(yearOf('May 2024'), '')
  assert.equal(yearOf('20-05'), '')
  assert.equal(yearOf(''), '')
  assert.equal(yearOf(null), '')
  assert.equal(yearOf(undefined), '')
})

test('freshnessOf 按 90 天 / 365 天分新、近期、老', () => {
  assert.equal(freshnessOf({ publishedAt: '2026-10-20' }, NOW), 'new')
  assert.equal(freshnessOf({ publishedAt: '2026-08-01' }, NOW), 'new') // 82 天
  assert.equal(freshnessOf({ publishedAt: '2026-06-01' }, NOW), 'recent') // 143 天
  assert.equal(freshnessOf({ publishedAt: '2025-11-01' }, NOW), 'recent') // 355 天
  assert.equal(freshnessOf({ publishedAt: '2025-01-01' }, NOW), 'old') // 659 天
  assert.equal(freshnessOf({ publishedAt: '' }, NOW), 'unknown')
  assert.equal(freshnessOf({}, NOW), 'unknown')
  assert.equal(freshnessOf(null, NOW), 'unknown')
  // 未来时间（在线优先发表）也算新，不能因为差值为负就判成老论文
  assert.equal(freshnessOf({ publishedAt: '2027-01-01' }, NOW), 'new')
})

test('默认按发表年份分架，年份从新到旧', () => {
  const lib = buildLibrary(
    [
      paper('a', { publishedAt: '2023-05-01' }),
      paper('b', { publishedAt: '2026-03-01' }),
      paper('c', { publishedAt: '2024-07-01' }),
      paper('d', { publishedAt: '2026-09-01' }),
    ],
    { now: NOW },
  )
  assert.equal(lib.groupBy, 'year')
  assert.equal(lib.total, 4)
  assert.deepEqual(
    lib.groups.map((g) => [g.key, g.count]),
    [
      ['2026', 2],
      ['2024', 1],
      ['2023', 1],
    ],
  )
})

test('没日期的论文归到「未知」架且排在最后', () => {
  const lib = buildLibrary(
    [paper('a', { publishedAt: '2024-01-01' }), paper('b', { publishedAt: '' })],
    { now: NOW },
  )
  assert.deepEqual(
    lib.groups.map((g) => g.key),
    ['2024', '未知'],
  )
  assert.equal(lib.groups[1].items[0].id, 'b')
})

test('架内按发表时间倒序，同日按被引数再按发现时间', () => {
  const lib = buildLibrary(
    [
      paper('old', { publishedAt: '2025-01-01' }),
      paper('same-low', { publishedAt: '2025-06-01', citations: 2 }),
      paper('same-high', { publishedAt: '2025-06-01', citations: 40 }),
      paper('same-tie-late', { publishedAt: '2025-06-01', citations: 40, discoveredAt: '2026-10-21T00:00:00.000Z' }),
      paper('newest', { publishedAt: '2025-12-01' }),
    ],
    { now: NOW },
  )
  assert.deepEqual(
    lib.groups[0].items.map((row) => row.id),
    ['newest', 'same-tie-late', 'same-high', 'same-low', 'old'],
  )
})

test('summary 给出覆盖年份与各种计数', () => {
  const lib = buildLibrary(
    [
      paper('a', { publishedAt: '2022-01-01', read: true, starred: true, summary: { tldr: 'x' } }),
      paper('b', { publishedAt: '2026-09-01' }),
      paper('c', { publishedAt: '' }),
    ],
    { now: NOW },
  )
  assert.equal(lib.summary.oldestYear, '2022')
  assert.equal(lib.summary.newestYear, '2026')
  assert.equal(lib.summary.oldCount, 1) // 只有 2022 那条超过一年
  assert.equal(lib.summary.newCount, 1) // 2026-09-01 在 90 天内
  assert.equal(lib.summary.unreadCount, 2)
  assert.equal(lib.summary.starredCount, 1)
  assert.equal(lib.summary.summarizedCount, 1)
})

test('架上的行只带精简字段，不带宽摘要原文', () => {
  const lib = buildLibrary(
    [paper('a', { abstract: 'x'.repeat(5000), summary: { tldr: '一句话', depth: 'brief' } })],
    { now: NOW },
  )
  const row = lib.groups[0].items[0]
  assert.equal(row.abstract, undefined)
  assert.equal(row.summary, undefined)
  assert.equal(row.hasSummary, true)
  assert.equal(row.summaryDepth, 'brief')
  assert.equal(row.authors.length, 3) // 只留前三位，但要报告总人数
  assert.equal(row.authorCount, 4)
  assert.equal(row.ageDays, 294)
  assert.equal(row.freshness, 'recent')
})

test('按方向分架时用中文方向名当标题，篇数从多到少', () => {
  const names = new Map([
    ['t-a', '金属橡胶'],
    ['t-b', '钙钛矿'],
  ])
  const lib = buildLibrary(
    [
      paper('a1', { topicId: 't-a' }),
      paper('a2', { topicId: 't-a' }),
      paper('b1', { topicId: 't-b', topicName: '钙钛矿' }),
    ],
    { groupBy: 'topic', now: NOW, topicLabel: (id) => names.get(id) ?? '' },
  )
  assert.equal(lib.groupBy, 'topic')
  assert.deepEqual(
    lib.groups.map((g) => [g.key, g.label, g.count]),
    [
      ['t-a', '金属橡胶', 2],
      ['t-b', '钙钛矿', 1],
    ],
  )
})

test('按方向分架时没有方向的归「未分类」', () => {
  const lib = buildLibrary([paper('a', { topicId: '' })], { groupBy: 'topic', now: NOW })
  assert.equal(lib.groups[0].key, '未分类')
  assert.equal(lib.groups[0].count, 1)
})

test('topicId 过滤只保留该方向的论文', () => {
  const lib = buildLibrary(
    [paper('a', { topicId: 't-a' }), paper('b', { topicId: 't-b' })],
    { topicId: 't-a', now: NOW },
  )
  assert.equal(lib.total, 1)
  assert.equal(lib.groups.length, 1)
  assert.equal(lib.groups[0].items[0].id, 'a')
})

test('脏数据安全：null / 非对象 / 没 id 都被丢掉', () => {
  assert.deepEqual(buildLibrary(null).groups, [])
  assert.deepEqual(buildLibrary(undefined).groups, [])
  assert.deepEqual(buildLibrary([]).groups, [])
  const lib = buildLibrary([null, 1, 'x', paper('ok'), { title: '没有 id' }], { now: NOW })
  assert.equal(lib.total, 1)
  assert.equal(lib.groups[0].items[0].id, 'ok')
})

test('空库不炸，summary 全 0、年份为空串', () => {
  const lib = buildLibrary([], { now: NOW })
  assert.equal(lib.total, 0)
  assert.deepEqual(lib.groups, [])
  assert.equal(lib.summary.oldestYear, '')
  assert.equal(lib.summary.newestYear, '')
  assert.equal(lib.summary.oldCount, 0)
  assert.equal(lib.summary.summarizedCount, 0)
})

test('每架报告老论文数与未读数', () => {
  const lib = buildLibrary(
    [
      paper('a', { publishedAt: '2022-01-01' }),
      paper('b', { publishedAt: '2022-06-01', read: true }),
      paper('c', { publishedAt: '2026-09-01' }),
    ],
    { now: NOW },
  )
  const shelf2022 = lib.groups.find((g) => g.key === '2022')
  assert.equal(shelf2022.count, 2)
  assert.equal(shelf2022.oldCount, 2)
  assert.equal(shelf2022.unreadCount, 1)
  const shelf2026 = lib.groups.find((g) => g.key === '2026')
  assert.equal(shelf2026.oldCount, 0)
  assert.equal(shelf2026.unreadCount, 1)
})
