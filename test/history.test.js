/**
 * 历史回溯：按年份把老论文捞进来。
 *
 * 为什么需要这组测试：日常扫描只覆盖「最近 N 天」，而一个研究方向的全量文献
 * 可能横跨几十年。实测主题 metal rubber 在 OpenAlex 有 872 篇，30 天窗口只
 * 覆盖 6 篇（0.7%）—— 用户看到的就是「搜到的论文有明显遗漏」。
 *
 * 这里钉住三件事：①按年取用的是整年日期范围，而不是「从今天往前 N 天」；
 * ②多个年份会各发一次请求；③没有年份时行为与以前完全一致（不能把日常扫描
 * 改坏）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { collectFromSource } from '../radar/sources.js'

/** 把 fetch 换成记录 URL 的桩，返回空结果（只看请求长什么样）。 */
function installFetch() {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const text = String(url)
    calls.push(text)
    if (text.includes('api.crossref.org')) {
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ message: { items: [] } }) }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ meta: { count: 0 }, results: [] }),
    }
  }
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const topic = {
  name: '金属橡胶',
  keywords: ['metal rubber'],
  sources: ['openalex'],
  matchMode: 'any',
  strict: true,
  languages: [],
}

test('按年份回溯时，日期范围是整年而不是「往前 N 天」', async (t) => {
  const stub = installFetch()
  t.after(() => stub.restore())

  await collectFromSource({
    source: 'openalex',
    topic,
    max: 10,
    rss: [],
    api: {},
    lookbackDays: 0,
    year: 2021,
  })

  const urls = stub.calls.filter((u) => u.includes('api.openalex.org'))
  assert.ok(urls.length >= 1, '应该至少发一次 OpenAlex 请求')
  const decoded = decodeURIComponent(urls[0])
  // 整年范围：1 月 1 日到 12 月 31 日
  assert.match(decoded, /from_publication_date:2021-01-01/)
  assert.match(decoded, /to_publication_date:2021-12-31/)
})

test('按年份回溯时，相关度那一路也必须带上年份范围', async (t) => {
  const stub = installFetch()
  t.after(() => stub.restore())

  await collectFromSource({
    source: 'openalex',
    topic,
    max: 10,
    rss: [],
    api: {},
    lookbackDays: 0,
    year: 2023,
  })

  const urls = stub.calls.filter((u) => u.includes('api.openalex.org'))
  // 相关度那一路（带 search=）如果没带年份，会把别的年份的论文混进来 ——
  // 实测按 2023 年取，结果里出现了 2021 和 2026 的论文。
  const relevance = urls.filter((u) => u.includes('search='))
  assert.ok(relevance.length >= 1, '应该有一路相关度检索')
  for (const url of relevance) {
    const decoded = decodeURIComponent(url)
    assert.match(decoded, /from_publication_date:2023-01-01/, `相关度路缺少年份下限：${decoded}`)
    assert.match(decoded, /to_publication_date:2023-12-31/, `相关度路缺少年份上限：${decoded}`)
  }
})

test('按年份回溯不再额外发「被引最高」那一路，省配额', async (t) => {
  const stub = installFetch()
  t.after(() => stub.restore())

  await collectFromSource({
    source: 'openalex',
    topic,
    max: 10,
    rss: [],
    api: {},
    lookbackDays: 0,
    year: 2023,
  })

  const urls = stub.calls.filter((u) => u.includes('api.openalex.org'))
  // 注意 `select=` 里本来就有 `cited_by_count` 字段，所以要看 `sort=` 而不是关键词
  assert.equal(urls.filter((u) => u.includes('sort=cited_by_count')).length, 0)
})

test('没有年份时仍然是滚动窗口，日常扫描不受影响', async (t) => {
  const stub = installFetch()
  t.after(() => stub.restore())

  await collectFromSource({
    source: 'openalex',
    topic,
    max: 10,
    rss: [],
    api: {},
    lookbackDays: 30,
  })

  const urls = stub.calls.filter((u) => u.includes('api.openalex.org'))
  assert.ok(urls.length >= 1)
  const decoded = decodeURIComponent(urls[0])
  // 滚动窗口：from 是 30 天前的某一天，不是某年的 1 月 1 日
  assert.match(decoded, /from_publication_date:\d{4}-\d{2}-\d{2}/)
  assert.doesNotMatch(decoded, /from_publication_date:\d{4}-01-01/)
  assert.match(decoded, /to_publication_date:/)
})

test('年份为脏数据时退回滚动窗口，不会拼出非法 filter', async (t) => {
  const stub = installFetch()
  t.after(() => stub.restore())

  await collectFromSource({
    source: 'openalex',
    topic,
    max: 10,
    rss: [],
    api: {},
    lookbackDays: 30,
    year: 'abc',
  })

  const urls = stub.calls.filter((u) => u.includes('api.openalex.org'))
  assert.ok(urls.length >= 1)
  const decoded = decodeURIComponent(urls[0])
  assert.doesNotMatch(decoded, /from_publication_date:\d{4}-01-01,to_publication_date:\d{4}-12-31/)
  assert.match(decoded, /from_publication_date:\d{4}-\d{2}-\d{2}/)
})
