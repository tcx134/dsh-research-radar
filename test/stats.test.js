import test from 'node:test'
import assert from 'node:assert/strict'

import { computeStats, weekStart, DEFAULT_STATS_DAYS, MAX_STATS_DAYS } from '../radar/stats.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-21T12:00:00Z')

/** 造一条论文，默认是 1 天前发现的。 */
function paper(over = {}) {
  return {
    id: over.id ?? `p-${Math.random().toString(36).slice(2)}`,
    topicId: over.topicId ?? 't-a',
    topicName: over.topicName ?? '金属橡胶',
    source: over.source ?? 'openalex',
    venue: over.venue ?? 'Mechanical Systems and Signal Processing',
    authors: over.authors ?? ['Li Y', 'Wang H'],
    discoveredAt: over.discoveredAt ?? new Date(NOW - DAY).toISOString(),
    read: over.read ?? false,
    starred: over.starred ?? false,
    summary: over.summary === undefined ? null : over.summary,
  }
}

test('weekStart 把任意一天归到那一周的周一（UTC）', () => {
  // 2026-10-21 是周三 → 周一 2026-10-19
  assert.equal(weekStart('2026-10-21T12:00:00Z'), '2026-10-19')
  // 周一本身
  assert.equal(weekStart('2026-10-19T00:00:00Z'), '2026-10-19')
  // 周日 2026-10-25 → 仍属于 10-19 那一周
  assert.equal(weekStart('2026-10-25T23:59:59Z'), '2026-10-19')
  // 下周一
  assert.equal(weekStart('2026-10-26T00:00:00Z'), '2026-10-26')
  assert.equal(weekStart('bogus'), null)
  assert.equal(weekStart(null), null)
})

test('computeStats 默认窗口 90 天，窗口外的条目被排除', () => {
  const items = [
    paper({ discoveredAt: new Date(NOW - DAY).toISOString() }),
    paper({ discoveredAt: new Date(NOW - 200 * DAY).toISOString() }),
  ]
  const stats = computeStats(items, { now: NOW })
  assert.equal(stats.windowDays, DEFAULT_STATS_DAYS)
  assert.equal(stats.total, 1)
})

test('computeStats 的 days 会被夹到 1–730', () => {
  assert.equal(computeStats([], { days: 0, now: NOW }).windowDays, 1)
  assert.equal(computeStats([], { days: 99999, now: NOW }).windowDays, MAX_STATS_DAYS)
  assert.equal(computeStats([], { days: 'abc', now: NOW }).windowDays, DEFAULT_STATS_DAYS)
  assert.equal(computeStats([], { days: null, now: NOW }).windowDays, DEFAULT_STATS_DAYS)
  assert.equal(computeStats([], { days: 30, now: NOW }).windowDays, 30)
})

test('computeStats 按方向过滤', () => {
  const items = [
    paper({ topicId: 't-a' }),
    paper({ topicId: 't-b', topicName: '另一个方向' }),
  ]
  const stats = computeStats(items, { now: NOW, topicId: 't-b' })
  assert.equal(stats.total, 1)
  assert.equal(stats.byTopic[0].key, 't-b')
  assert.equal(stats.byTopic[0].label, '另一个方向')
})

test('computeStats 统计已读 / 收藏 / 已摘要数量', () => {
  const items = [
    paper({ read: true, starred: true, summary: { tldr: 'x', tags: ['金属橡胶'] } }),
    paper({ read: false, starred: false, summary: { tldr: 'y', tags: [] } }),
    paper({ read: false, starred: true, summary: null }),
  ]
  const stats = computeStats(items, { now: NOW })
  assert.equal(stats.total, 3)
  assert.equal(stats.readCount, 1)
  assert.equal(stats.starredCount, 2)
  assert.equal(stats.summarizedCount, 2)
})

test('computeStats 的时间序列补齐空周', () => {
  const items = [
    paper({ discoveredAt: '2026-10-06T00:00:00Z' }), // 周一
    paper({ discoveredAt: '2026-10-21T00:00:00Z' }), // 周三，属于 10-19 那周
  ]
  const stats = computeStats(items, { now: NOW })
  assert.deepEqual(stats.weeks, [
    { week: '2026-10-05', count: 1 },
    { week: '2026-10-12', count: 0 },
    { week: '2026-10-19', count: 1 },
  ])
  assert.equal(stats.weeklyPeak, 1)
})

test('computeStats 的榜单按次数降序、同次数按名字排', () => {
  const items = [
    paper({ source: 'openalex', venue: 'Wear', authors: ['A'], summary: { tags: ['t1', 't2'] } }),
    paper({ source: 'openalex', venue: 'Wear', authors: ['A'], summary: { tags: ['t1'] } }),
    paper({ source: 'crossref', venue: 'Thin-Walled Structures', authors: ['B'], summary: null }),
  ]
  const stats = computeStats(items, { now: NOW, sourceLabels: { openalex: 'OpenAlex', crossref: 'Crossref' } })
  assert.deepEqual(stats.bySource, [
    { key: 'openalex', count: 2, label: 'OpenAlex' },
    { key: 'crossref', count: 1, label: 'Crossref' },
  ])
  assert.deepEqual(stats.byVenue, [
    { key: 'Wear', count: 2 },
    { key: 'Thin-Walled Structures', count: 1 },
  ])
  assert.deepEqual(stats.byAuthor, [
    { key: 'A', count: 2 },
    { key: 'B', count: 1 },
  ])
  assert.deepEqual(stats.byTag, [
    { key: 't1', count: 2 },
    { key: 't2', count: 1 },
  ])
})

test('computeStats 的 topLimit 可调且被夹取', () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    paper({ venue: `V${String(i).padStart(2, '0')}` }),
  )
  assert.equal(computeStats(items, { now: NOW }).byVenue.length, 8)
  assert.equal(computeStats(items, { now: NOW, topLimit: 3 }).byVenue.length, 3)
  assert.equal(computeStats(items, { now: NOW, topLimit: 0 }).byVenue.length, 1)
  assert.equal(computeStats(items, { now: NOW, topLimit: 999 }).byVenue.length, 12)
})

test('computeStats 对脏数据安全', () => {
  const stats = computeStats([null, 'x', 1, paper({ discoveredAt: 'bad' })], { now: NOW })
  assert.equal(stats.total, 0)
  assert.deepEqual(stats.weeks, [])
  assert.equal(computeStats(null, { now: NOW }).total, 0)
  assert.equal(computeStats(undefined, { now: NOW }).total, 0)
})

test('computeStats 跳过空 venue / 空作者 / 空标签', () => {
  const items = [
    paper({ venue: '', authors: ['', '  ', 'Li Y'], summary: { tags: ['', '  ', 'ok'] } }),
  ]
  const stats = computeStats(items, { now: NOW })
  assert.deepEqual(stats.byVenue, [])
  assert.deepEqual(stats.byAuthor, [{ key: 'Li Y', count: 1 }])
  assert.deepEqual(stats.byTag, [{ key: 'ok', count: 1 }])
})

test('computeStats 不统计未来时间戳的条目', () => {
  const items = [paper({ discoveredAt: new Date(NOW + 2 * DAY).toISOString() })]
  assert.equal(computeStats(items, { now: NOW }).total, 0)
})
