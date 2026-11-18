/**
 * 检索召回：验证「多通道取样」真的发出去了。
 *
 * 这里的断言全是「请求长什么样」，不是「返回了什么」—— 因为召回不足的根因
 * 就在请求本身：
 *   1. 只用「短语子句 + 出版日期倒序」一路时，召回被卡死在短语的字面匹配上
 *      （实测主题 metal rubber 180 天窗口只有 37 条，而相关度检索有 8975 条候选）；
 *   2. Crossref 用 `type:journal-article` 过滤时会议论文全被挡掉，而会议论文
 *      对工程类主题是重要首发来源。
 * 精度由本地 `finalize()` 的 strict 过滤兜底，所以放宽远端召回是安全的。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { fetchCrossref, fetchOpenAlex, normalizeQuery } from '../radar/sources.js'

/** 记录所有发出的 URL；按 URL 前缀决定回什么假数据。 */
function installFetch() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const text = String(url)
    calls.push(text)
    const body = text.includes('api.crossref.org')
      ? { message: { items: [] } }
      : { meta: { count: 0 }, results: [] }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(body),
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

test('OpenAlex 会额外发一路相关度检索，关键词走 search= 而不是短语子句', async () => {
  const stub = installFetch()
  try {
    await fetchOpenAlex({ query: normalizeQuery(topic), max: 5, api: {}, lookbackDays: 180 })
    const works = stub.calls.filter((url) => url.includes('api.openalex.org/works'))
    assert.ok(works.length >= 2, `至少要两路，实际 ${works.length} 路`)

    const relevance = works.filter((url) => url.includes('search=') && url.includes('relevance_score'))
    assert.equal(relevance.length, 1, '应该正好一路相关度检索')

    const url = relevance[0]
    // 关键词走 search= 而不是 filter 里的 search 子句
    assert.match(url, /search=metal(\+|%20)rubber/)
    // 相关度那一路的 filter 不能再带关键词短语子句，否则等于又回到字面匹配
    assert.doesNotMatch(url, /title_and_abstract\.search/)
    // 但硬性范围还得留着
    assert.match(url, /from_publication_date:/)
  } finally {
    stub.restore()
  }
})

test('精确短语那一路还在（保证「昨天刚发的」不会因相关度低掉出）', async () => {
  const stub = installFetch()
  try {
    await fetchOpenAlex({ query: normalizeQuery(topic), max: 5, api: {}, lookbackDays: 180 })
    const works = stub.calls.filter((url) => url.includes('api.openalex.org/works'))
    const phrase = works.filter((url) => url.includes('title_and_abstract.search') && url.includes('sort=publication_date'))
    assert.equal(phrase.length, 1, '精确短语 + 最新优先这一路必须保留')
    // 有引号才叫短语匹配（filter 里的引号原样保留，`encodeFilter` 只转 `#&+`）
    assert.match(phrase[0], /title_and_abstract\.search:"metal rubber"/)
  } finally {
    stub.restore()
  }
})

test('窗口足够宽时才补一路「被引最高」，窄窗口不浪费请求', async () => {
  const stub = installFetch()
  try {
    await fetchOpenAlex({ query: normalizeQuery(topic), max: 5, api: {}, lookbackDays: 30 })
    const narrow = stub.calls.filter((url) => url.includes('sort=cited_by_count')).length
    assert.equal(narrow, 0, '30 天窗口不该发被引排序那一路')
  } finally {
    stub.restore()
  }
  const wide = installFetch()
  try {
    await fetchOpenAlex({ query: normalizeQuery(topic), max: 5, api: {}, lookbackDays: 365 })
    const count = wide.calls.filter((url) => url.includes('sort=cited_by_count')).length
    assert.equal(count, 1, '365 天窗口应该补一路被引排序')
  } finally {
    wide.restore()
  }
})

test('Crossref 分别请求期刊论文与会议论文再合并', async () => {
  const stub = installFetch()
  try {
    await fetchCrossref({ query: normalizeQuery(topic), max: 5, api: {}, lookbackDays: 90 })
    const calls = stub.calls.filter((url) => url.includes('api.crossref.org/works'))
    assert.equal(calls.length, 2, '期刊论文与会议论文要分两次请求')

    const joined = decodeURIComponent(calls.join('\n'))
    assert.match(joined, /type:journal-article/)
    assert.match(joined, /type:proceedings-article/)
    // 同一次请求里只出现一个 type：`type:a,b` 只生效第一个，`type:a|b` 直接 400
    for (const url of calls) {
      const types = decodeURIComponent(url).match(/type:[a-z-]+/g) ?? []
      assert.equal(types.length, 1, `一次请求只能带一个 type：${decodeURIComponent(url)}`)
    }
  } finally {
    stub.restore()
  }
})

test('Crossref 不带关键词时不发空查询', async () => {
  const stub = installFetch()
  try {
    await assert.rejects(
      fetchCrossref({
        query: normalizeQuery({ name: 'x', keywords: [], authors: [], venues: [], institutions: [] }),
        max: 5,
        api: {},
      }),
    )
    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})
