import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeDoi,
  normalizeArxivId,
  normalizeTitle,
  normalizeYear,
  dedupeKeys,
  dedupeKey,
  isCanonicalKey,
  migrateSeenKey,
} from '../radar/dedupe.js'

test('normalizeDoi 去掉各种 DOI 前缀并小写', () => {
  assert.equal(normalizeDoi('10.1016/J.JSV.2024.118000'), '10.1016/j.jsv.2024.118000')
  assert.equal(normalizeDoi('https://doi.org/10.1016/j.jsv.2024.118000'), '10.1016/j.jsv.2024.118000')
  assert.equal(normalizeDoi('http://dx.doi.org/10.1016/j.jsv.2024.118000'), '10.1016/j.jsv.2024.118000')
  assert.equal(normalizeDoi('doi: 10.1016/j.jsv.2024.118000'), '10.1016/j.jsv.2024.118000')
  assert.equal(normalizeDoi('10.1016/j.jsv.2024.118000.'), '10.1016/j.jsv.2024.118000')
  assert.equal(normalizeDoi(''), '')
  assert.equal(normalizeDoi(null), '')
  assert.equal(normalizeDoi(undefined), '')
})

test('normalizeArxivId 去掉链接/前缀/.pdf/版本号', () => {
  assert.equal(normalizeArxivId('arXiv:2401.12345v2'), '2401.12345')
  assert.equal(normalizeArxivId('https://arxiv.org/abs/2401.12345'), '2401.12345')
  assert.equal(normalizeArxivId('https://arxiv.org/pdf/2401.12345v3.pdf'), '2401.12345')
  assert.equal(normalizeArxivId('hep-th/9901001'), 'hep-th/9901001')
  assert.equal(normalizeArxivId(''), '')
})

test('normalizeTitle 保留中文，只去掉标点与空白', () => {
  assert.equal(normalizeTitle('Metal Rubber: A Review.'), 'metalrubberareview')
  assert.equal(normalizeTitle('metal-rubber a review'), 'metalrubberareview')
  // 纯中文标题不能被抹成空串（用 [^a-z0-9] 就会出这个 bug）
  assert.equal(normalizeTitle('金属橡胶减振器研究'), '金属橡胶减振器研究')
  assert.equal(normalizeTitle('   '), '')
  assert.equal(normalizeTitle(null), '')
})

test('normalizeYear 取四位年份', () => {
  assert.equal(normalizeYear('2024-05-18'), '2024')
  assert.equal(normalizeYear('2024-05-18T00:00:00Z'), '2024')
  assert.equal(normalizeYear(''), '')
  assert.equal(normalizeYear(undefined), '')
})

test('同一篇论文在不同库里的记录得到相同的 DOI 键', () => {
  const openalex = {
    id: 'openalex:W4389000001',
    source: 'openalex',
    doi: 'https://doi.org/10.1016/j.jsv.2024.118000',
    title: 'Metal Rubber: A Review',
    publishedAt: '2024-05-18',
  }
  const crossref = {
    id: 'crossref:10.1016/j.jsv.2024.118000',
    source: 'crossref',
    doi: '10.1016/J.JSV.2024.118000',
    title: 'Metal rubber — a review',
    publishedAt: '2024-05-01',
  }
  assert.equal(dedupeKey(openalex), 'doi:10.1016/j.jsv.2024.118000')
  assert.equal(dedupeKey(crossref), 'doi:10.1016/j.jsv.2024.118000')
  assert.equal(dedupeKey(openalex), dedupeKey(crossref))
})

test('arXiv 预印本与它的期刊版通过 arXiv 编号合并', () => {
  const preprint = {
    id: 'arxiv:2401.12345',
    source: 'arxiv',
    title: 'A Study of Metal Rubber',
    publishedAt: '2024-01-20',
  }
  // OpenAlex 给 arXiv 预印本的 DOI 是 10.48550/arXiv.2401.12345
  const openalex = {
    id: 'openalex:W123',
    source: 'openalex',
    doi: 'https://doi.org/10.48550/arXiv.2401.12345',
    title: 'A Study of Metal Rubber',
    publishedAt: '2024-01-20',
  }
  assert.equal(dedupeKey(preprint), 'arxiv:2401.12345')
  assert.equal(dedupeKey(openalex), 'arxiv:2401.12345')
})

test('既无 DOI 也无 arXiv 编号时退回标题+年份', () => {
  const a = { id: 'rss:a', source: 'rss', title: 'Metal Rubber Bearings', publishedAt: '2023-09-01' }
  const b = { id: 'rss:b', source: 'rss', title: 'metal rubber bearings.', publishedAt: '2023-09-30' }
  const c = { id: 'rss:c', source: 'rss', title: 'Metal Rubber Bearings', publishedAt: '2024-09-01' }
  assert.equal(dedupeKey(a), 't:metalrubberbearings|2023')
  assert.equal(dedupeKey(a), dedupeKey(b))
  assert.notEqual(dedupeKey(a), dedupeKey(c))
})

test('完全没有可用标识时退回 id 键，且不会返回空串', () => {
  assert.deepEqual(dedupeKeys({ id: 'pubmed:38123456' }), ['id:pubmed:38123456'])
  assert.equal(dedupeKey({ id: 'pubmed:38123456' }), 'id:pubmed:38123456')
  assert.equal(dedupeKey({}), '')
  assert.equal(dedupeKey(null), '')
})

test('dedupeKeys 按强度排序且去重', () => {
  const keys = dedupeKeys({
    id: 'arxiv:2401.12345',
    source: 'arxiv',
    doi: '10.48550/arXiv.2401.12345',
    title: 'A Study of Metal Rubber',
    publishedAt: '2024-01-20',
  })
  assert.deepEqual(keys, [
    'arxiv:2401.12345',
    'doi:10.48550/arxiv.2401.12345',
    't:astudyofmetalrubber|2024',
    'id:arxiv:2401.12345',
  ])
})

test('isCanonicalKey / migrateSeenKey 处理旧版 state.json', () => {
  assert.equal(isCanonicalKey('doi:10.1016/x'), true)
  assert.equal(isCanonicalKey('id:openalex:W123'), true)
  assert.equal(isCanonicalKey('openalex:W123'), false)
  assert.equal(migrateSeenKey('openalex:W123'), 'id:openalex:w123')
  assert.equal(migrateSeenKey('doi:10.1016/X'), 'doi:10.1016/X')
  assert.equal(migrateSeenKey(''), '')
})
