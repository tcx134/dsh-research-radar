import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeQuery,
  isEmptyQuery,
  scoreItem,
  invertAbstract,
  SOURCE_LABELS,
} from '../radar/sources.js'

/** 用户实盘配置：金属橡胶 */
function metalRubber() {
  return normalizeQuery({
    keywords: ['metal rubber', 'MR', 'EMWM'],
    sources: ['openalex', 'crossref'],
    matchMode: 'any',
    strict: true,
  })
}

test('normalizeQuery 把关键词切成主要关键词与短缩写', () => {
  const q = metalRubber()
  assert.deepEqual(q.keywords, ['metal rubber', 'MR', 'EMWM'])
  // 多词短语 / 长度 >= 6 才算主要关键词；MR、EMWM 是短缩写
  assert.deepEqual(q.strong, ['metal rubber'])
  assert.equal(q.matchMode, 'any')
  assert.equal(q.strict, true)
})

test('normalizeQuery 支持字符串形式的维度', () => {
  const q = normalizeQuery({ keywords: 'metal rubber, EMWM；减振', authors: 'Li Wei' })
  assert.deepEqual(q.keywords, ['metal rubber', 'EMWM', '减振'])
  assert.deepEqual(q.authors, ['Li Wei'])
  assert.deepEqual(q.venues, [])
  assert.deepEqual(q.institutions, [])
})

test('normalizeQuery 的默认值：strict 默认开，matchMode 默认 any', () => {
  const q = normalizeQuery({ keywords: ['a'] })
  assert.equal(q.strict, true)
  assert.equal(q.matchMode, 'any')
  assert.equal(normalizeQuery({ keywords: ['a'], strict: false }).strict, false)
  assert.equal(normalizeQuery({ keywords: ['a'], matchMode: 'all' }).matchMode, 'all')
})

test('isEmptyQuery 只看四个检索维度', () => {
  assert.equal(isEmptyQuery(normalizeQuery({})), true)
  assert.equal(isEmptyQuery(normalizeQuery({ keywords: ['x'] })), false)
  assert.equal(isEmptyQuery(normalizeQuery({ authors: ['Li'] })), false)
  assert.equal(isEmptyQuery(normalizeQuery({ venues: ['JSV'] })), false)
  assert.equal(isEmptyQuery(normalizeQuery({ institutions: ['Zhejiang University'] })), false)
})

test('scoreItem 命中标题的分最高，并说明命中在哪', () => {
  const q = metalRubber()
  const hit = scoreItem(
    { title: 'Metal Rubber Vibration Isolator', abstract: 'nothing relevant here' },
    q,
  )
  assert.deepEqual(hit.hitKeywords, ['metal rubber'])
  assert.deepEqual(hit.strongHit, ['metal rubber'])
  assert.match(hit.matchedIn, /标题:metal rubber/)
  // 标题命中 6 分 + 主要关键词 4 分
  assert.equal(hit.score, 10)
})

test('scoreItem 只命中短缩写时不算主要命中（磁共振误推的根因）', () => {
  const q = metalRubber()
  const hit = scoreItem({ title: 'MR Imaging of the Knee', abstract: 'magnetic resonance imaging' }, q)
  assert.deepEqual(hit.strongHit, [])
  assert.deepEqual(hit.hitKeywords, ['MR'])
  assert.equal(hit.score, 6)
})

test('scoreItem 摘要命中权重低于标题', () => {
  const q = metalRubber()
  const inTitle = scoreItem({ title: 'metal rubber review', abstract: '' }, q)
  const inAbstract = scoreItem({ title: 'A review', abstract: 'we study metal rubber' }, q)
  assert.ok(inTitle.score > inAbstract.score)
})

test('scoreItem 统计作者与期刊命中', () => {
  const q = normalizeQuery({ keywords: ['metal rubber'], authors: ['Li Wei'], venues: ['JSV'] })
  const hit = scoreItem(
    { title: 'metal rubber', authors: ['Li Wei', 'Zhang San'], venue: 'Journal of Sound and Vibration (JSV)' },
    q,
  )
  assert.deepEqual(hit.hitKeywords, ['metal rubber'])
  assert.match(hit.matchedIn, /作者:Li Wei/)
  assert.match(hit.matchedIn, /期刊:JSV/)
})

test('scoreItem 对开放获取加 1 分', () => {
  const q = normalizeQuery({ keywords: ['metal rubber'] })
  const closed = scoreItem({ title: 'metal rubber', openAccess: false }, q)
  const open = scoreItem({ title: 'metal rubber', openAccess: true }, q)
  assert.equal(open.score - closed.score, 1)
})

test('scoreItem 对空条目安全', () => {
  const hit = scoreItem({}, metalRubber())
  assert.equal(hit.matchedIn, '')
  assert.equal(hit.score, 0)
  assert.deepEqual(hit.hitKeywords, [])
})

test('invertAbstract 还原 OpenAlex 的倒排索引', () => {
  const index = { Metal: [0], rubber: [1], isolators: [2], 'for:': [3], ships: [4] }
  assert.equal(invertAbstract(index), 'Metal rubber isolators for: ships')
})

test('invertAbstract 对坏数据安全', () => {
  assert.equal(invertAbstract(null), '')
  assert.equal(invertAbstract({ a: 'not-an-array' }), '')
  assert.equal(invertAbstract({ a: [-1, 0], b: [1.5, 2] }), 'a b')
})

test('SOURCE_LABELS 覆盖六个源', () => {
  assert.deepEqual(Object.keys(SOURCE_LABELS).sort(), [
    'arxiv',
    'biorxiv',
    'crossref',
    'openalex',
    'pubmed',
    'rss',
  ])
})
