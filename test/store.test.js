import test from 'node:test'
import assert from 'node:assert/strict'

import { pruneSeen, defaultSettings, SEEN_MAX_AGE_DAYS, SEEN_MAX_ENTRIES } from '../radar/store.js'

const DAY = 86400000
const NOW = Date.parse('2024-06-01T00:00:00.000Z')

function iso(daysAgo) {
  return new Date(NOW - daysAgo * DAY).toISOString()
}

test('默认保留策略是 180 天', () => {
  assert.equal(SEEN_MAX_AGE_DAYS, 180)
  assert.ok(SEEN_MAX_ENTRIES >= 5000)
})

test('超过 180 天的记录被删除，边界内的保留', () => {
  const seen = {
    'doi:old': iso(200),
    'doi:edge': iso(179),
    'doi:new': iso(1),
  }
  const { seen: next, removed } = pruneSeen(seen, { now: NOW })
  assert.equal(removed, 1)
  assert.deepEqual(Object.keys(next).sort(), ['doi:edge', 'doi:new'])
})

test('时间戳解析不出来的按最旧处理，会被清掉', () => {
  const { seen: next, removed } = pruneSeen({ 'doi:bad': 'not-a-date' }, { now: NOW })
  assert.equal(removed, 1)
  assert.deepEqual(next, {})
})

test('keepKeys 里的键即使超龄也永不删除', () => {
  const seen = { 'doi:old-but-in-items': iso(400), 'doi:old': iso(400) }
  const { seen: next, removed } = pruneSeen(seen, {
    now: NOW,
    keepKeys: ['doi:old-but-in-items'],
  })
  assert.equal(removed, 1)
  assert.deepEqual(Object.keys(next), ['doi:old-but-in-items'])
})

test('超过条数上限时按时间从新到旧截断', () => {
  const seen = {}
  for (let i = 0; i < 10; i += 1) seen[`doi:k${i}`] = iso(i)
  const { seen: next, removed } = pruneSeen(seen, { now: NOW, maxEntries: 3 })
  assert.equal(removed, 7)
  assert.deepEqual(Object.keys(next).sort(), ['doi:k0', 'doi:k1', 'doi:k2'])
})

test('keepKeys 不占用条数上限以外的名额时仍被保留', () => {
  const seen = { 'doi:kept': iso(150), 'doi:k0': iso(0), 'doi:k1': iso(1) }
  const { seen: next } = pruneSeen(seen, { now: NOW, maxEntries: 1, keepKeys: ['doi:kept'] })
  // 上限 1 条：keepKeys 无条件保留，剩下的名额按新旧只留 doi:k0
  assert.deepEqual(Object.keys(next).sort(), ['doi:k0', 'doi:kept'])
})

test('剪枝是幂等的', () => {
  const seen = { 'doi:a': iso(1), 'doi:b': iso(200) }
  const first = pruneSeen(seen, { now: NOW })
  const second = pruneSeen(first.seen, { now: NOW })
  assert.equal(second.removed, 0)
  assert.deepEqual(second.seen, first.seen)
})

test('输入不是对象时安全返回空字典', () => {
  assert.deepEqual(pruneSeen(null).seen, {})
  assert.deepEqual(pruneSeen(undefined).seen, {})
})

test('defaultSettings 的 scan 默认值没被改坏', () => {
  const d = defaultSettings()
  assert.equal(d.scan.intervalHours, 12)
  assert.equal(d.scan.maxPerTopic, 8)
  assert.equal(d.scan.lookbackDays, 30)
  assert.equal(d.scan.summarize, true)
  assert.equal(d.scan.summaryDepth, 'standard')
  assert.equal(d.mail.enabled, false)
  assert.equal(d.mail.port, 465)
  assert.deepEqual(d.rss, [])
})
