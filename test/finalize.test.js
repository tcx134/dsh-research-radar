import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeQuery, finalize, isExcluded } from '../radar/sources.js'

function metalRubber(extra = {}) {
  return normalizeQuery({
    keywords: ['metal rubber', 'MR', 'EMWM'],
    sources: ['openalex', 'crossref'],
    matchMode: 'any',
    strict: true,
    ...extra,
  })
}

function paper(id, title, extra = {}) {
  return { id, title, abstract: '', authors: [], venue: '', publishedAt: '2024-05-01', ...extra }
}

test('strict 下丢弃只命中短缩写的磁共振论文（用户实测的核心诉求）', () => {
  const items = [
    paper('a', 'Metal Rubber Vibration Isolator for Ships'),
    paper('b', 'MR Imaging of the Knee Joint'),
    paper('c', 'EMWM Based Damper'),
    paper('d', 'Metal Rubber Bearings: A Review'),
  ]
  const out = finalize(items, metalRubber(), 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['a', 'd'],
  )
})

test('strict 下主要关键词命中的排在短缩写命中之前', () => {
  const items = [
    paper('short', 'EMWM damper design'),
    paper('strong', 'Metal Rubber damper design'),
  ]
  const out = finalize(items, metalRubber(), 10, false)
  assert.equal(out[0].id, 'strong')
})

test('配了作者维度时，作者命中可以救回没有主要关键词命中的论文', () => {
  const q = metalRubber({ authors: ['Li Wei'] })
  const items = [paper('byAuthor', 'A damper study', { authors: ['Li Wei'] })]
  const out = finalize(items, q, 10, false)
  assert.equal(out.length, 1)
  assert.match(out[0].matchedIn, /作者:Li Wei/)
})

test('没有主要关键词时，任何命中都算相关', () => {
  const q = normalizeQuery({ keywords: ['MR'], strict: true })
  const out = finalize([paper('a', 'MR imaging')], q, 10, false)
  assert.equal(out.length, 1)
})

test('strict=false 且 localFilter=false 时不做本地相关性过滤', () => {
  const q = metalRubber({ strict: false })
  const out = finalize([paper('a', 'Totally unrelated paper')], q, 10, false)
  assert.equal(out.length, 1)
  assert.equal(out[0].score, 0)
})

test('localFilter=true 时即使 strict=false 也要求有命中', () => {
  const q = metalRubber({ strict: false })
  const out = finalize([paper('a', 'Totally unrelated paper')], q, 10, true)
  assert.equal(out.length, 0)
})

test('排除词命中即丢弃', () => {
  const q = metalRubber({ exclude: ['graphene'] })
  assert.equal(isExcluded(paper('a', 'Metal rubber with graphene filler'), q), true)
  assert.equal(isExcluded(paper('b', 'Metal rubber isolator'), q), false)
  const out = finalize([paper('a', 'Metal rubber with graphene filler'), paper('b', 'Metal rubber isolator')], q, 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['b'],
  )
})

test('matchMode=all 要求所有关键词都命中', () => {
  const q = normalizeQuery({ keywords: ['metal rubber', 'damper'], matchMode: 'all' })
  assert.equal(finalize([paper('a', 'metal rubber isolator')], q, 10, false).length, 0)
  assert.equal(finalize([paper('b', 'metal rubber damper')], q, 10, false).length, 1)
})

test('finalize 按 id 去重并按 max 截断', () => {
  const q = metalRubber()
  const items = [paper('a', 'metal rubber 1'), paper('a', 'metal rubber 1'), paper('b', 'metal rubber 2')]
  const out = finalize(items, q, 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['a', 'b'],
  )
  assert.equal(finalize(items, q, 1, false).length, 1)
})

test('finalize 丢掉没有 id 的脏条目', () => {
  const q = metalRubber()
  const out = finalize([{ title: 'metal rubber' }, null, paper('ok', 'metal rubber')], q, 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['ok'],
  )
})

test('finalize 同分时按出版日期从新到旧', () => {
  const q = metalRubber()
  const out = finalize(
    [
      paper('old', 'metal rubber', { publishedAt: '2023-01-01' }),
      paper('new', 'metal rubber', { publishedAt: '2024-05-01' }),
    ],
    q,
    10,
    false,
  )
  assert.deepEqual(
    out.map((i) => i.id),
    ['new', 'old'],
  )
})
