import test from 'node:test'
import assert from 'node:assert/strict'

import { selectFresh } from '../radar/scan.js'
import { dedupeKeys } from '../radar/dedupe.js'

function candidate(item) {
  return { keys: dedupeKeys(item), item }
}

test('同一篇论文从 OpenAlex 与 Crossref 各来一次时只保留一条', () => {
  const openalex = {
    id: 'openalex:W4389000001',
    source: 'openalex',
    doi: 'https://doi.org/10.1016/j.jsv.2024.118000',
    title: 'Metal Rubber Isolator',
    publishedAt: '2024-05-18',
    score: 12,
    citations: 7,
    openAccess: true,
  }
  const crossref = {
    id: 'crossref:10.1016/j.jsv.2024.118000',
    source: 'crossref',
    doi: '10.1016/J.JSV.2024.118000',
    title: 'Metal rubber isolator',
    publishedAt: '2024-05-01',
    score: 10,
  }
  const fresh = selectFresh([candidate(crossref), candidate(openalex)])
  assert.equal(fresh.length, 1)
  // 留下的是分数更高、信息更全的 OpenAlex 那条
  assert.equal(fresh[0].id, 'openalex:W4389000001')
})

test('跨方向命中同一篇论文时只保留一条', () => {
  const item = {
    id: 'openalex:W1',
    source: 'openalex',
    doi: '10.1016/j.jsv.2024.1',
    title: 'Metal Rubber Damper',
    publishedAt: '2024-01-01',
    score: 8,
    topicId: 't-a',
  }
  const fresh = selectFresh([candidate({ ...item, topicId: 't-a' }), candidate({ ...item, topicId: 't-b' })])
  assert.equal(fresh.length, 1)
})

test('seen 里已有的键会被跳过（含只有 DOI 键命中的情况）', () => {
  const item = {
    id: 'openalex:W1',
    source: 'openalex',
    doi: '10.1016/j.jsv.2024.1',
    title: 'Metal Rubber Damper',
    publishedAt: '2024-01-01',
    score: 8,
  }
  const seen = { 'doi:10.1016/j.jsv.2024.1': '2024-05-01T00:00:00.000Z' }
  assert.deepEqual(selectFresh([candidate(item)], seen), [])
})

test('seen 里只有标题键命中时也算重复', () => {
  const item = { id: 'rss:x', source: 'rss', title: 'Metal Rubber Bearings', publishedAt: '2023-09-01', score: 6 }
  const seen = { 't:metalrubberbearings|2023': '2024-05-01T00:00:00.000Z' }
  assert.deepEqual(selectFresh([candidate(item)], seen), [])
})

test('结果按 score 降序、再按出版日期降序', () => {
  const items = [
    { id: 'a', source: 'rss', title: 'low', publishedAt: '2024-05-01', score: 2 },
    { id: 'b', source: 'rss', title: 'high-old', publishedAt: '2023-01-01', score: 9 },
    { id: 'c', source: 'rss', title: 'high-new', publishedAt: '2024-05-01', score: 9 },
  ]
  assert.deepEqual(
    selectFresh(items.map(candidate)).map((i) => i.id),
    ['c', 'b', 'a'],
  )
})

test('没有键的脏候选被丢掉', () => {
  const fresh = selectFresh([
    { keys: [], item: { id: '' } },
    null,
    candidate({ id: 'rss:ok', source: 'rss', title: 'ok', publishedAt: '2024-01-01', score: 1 }),
  ])
  assert.deepEqual(
    fresh.map((i) => i.id),
    ['rss:ok'],
  )
})

test('seen 为空或非法时正常工作', () => {
  const items = [candidate({ id: 'rss:a', source: 'rss', title: 'a', publishedAt: '2024-01-01', score: 1 })]
  assert.equal(selectFresh(items, {}).length, 1)
  assert.equal(selectFresh(items, null).length, 1)
  assert.equal(selectFresh(items, undefined).length, 1)
})

test('输入不是数组时返回空数组', () => {
  assert.deepEqual(selectFresh(null), [])
  assert.deepEqual(selectFresh(undefined), [])
})
