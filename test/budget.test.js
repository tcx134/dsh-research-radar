/**
 * 检索预算：OpenAlex 的检索接口对无 API key 的请求按 IP 共享每日免费额度，
 * 用完后当天不再恢复。
 *
 * 这里钉三件事：
 *   1. 「预算用尽」的 429 不重试（否则每路白等 31 秒，一次扫描被拖长到两分钟）；
 *   2. 不能被 `catch { continue }` 静默吞掉 —— 用户只会看到「怎么又没搜到」；
 *   3. 报错要说清是预算问题、并给出「配 API key」这条出路。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { collectFromSource } from '../radar/sources.js'

const BUDGET_BODY = JSON.stringify({
  error: 'Rate limit exceeded',
  message:
    "Insufficient budget. This request has no API key, so it counts against the free daily budget shared by everyone on your network's IP address, and that budget is used up ($0.0005 remaining; resets at midnight UTC).",
  reason: 'daily_budget',
  retryAfter: 60279,
})

const topic = {
  name: '金属橡胶',
  keywords: ['metal rubber'],
  sources: ['openalex'],
  matchMode: 'any',
  strict: true,
  languages: [],
}

/** 所有请求都回「预算用尽」的 429，并记录被发了多少次。 */
function installBudgetExhausted() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => BUDGET_BODY,
    }
  }
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

test('检索预算用尽时不重试：一路只发一次请求', async () => {
  const stub = installBudgetExhausted()
  try {
    await collectFromSource({
      source: 'openalex',
      topic,
      max: 10,
      rss: [],
      api: {},
      lookbackDays: 30,
    })
    // 两路（短语 + 相关度）各一次。旧代码每路会重试到 4 次，共 8 次、
    // 白等 3 × 31 秒。
    assert.equal(stub.calls.length, 2, `期望 2 次请求（两路各一次），实际 ${stub.calls.length} 次`)
  } finally {
    stub.restore()
  }
})

test('预算用尽要报出来，不能静默变成「没有新论文」', async () => {
  const stub = installBudgetExhausted()
  try {
    const out = await collectFromSource({
      source: 'openalex',
      topic,
      max: 10,
      rss: [],
      api: {},
      lookbackDays: 30,
    })
    assert.deepEqual(out.items, [])
    const messages = out.errors.map((e) => e.message).join('\n')
    assert.match(messages, /检索预算已用尽/)
    assert.match(messages, /API key/)
    assert.match(messages, /所有检索通道都失败了/)
    assert.ok(out.errors.every((e) => e.source === 'openalex'))
  } finally {
    stub.restore()
  }
})

test('只有相关度那一路被限流时，仍然返回短语路的结果并提示召回变少', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const text = String(url)
    calls.push(text)
    // 相关度路带 search=，回 429；短语路回一条真结果。
    if (text.includes('search=')) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => BUDGET_BODY,
      }
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          meta: { count: 1 },
          results: [
            {
              id: 'https://openalex.org/W123',
              doi: 'https://doi.org/10.1/x',
              title: 'Metal rubber isolator fatigue',
              publication_date: '2026-11-01',
              authorships: [],
              primary_location: { source: { display_name: 'MSSP', issn_l: '0888-3270' } },
              abstract_inverted_index: null,
              cited_by_count: 0,
              cited_by_percentile_year: null,
              open_access: { is_oa: false },
            },
          ],
        }),
    }
  }
  try {
    const out = await collectFromSource({
      source: 'openalex',
      topic,
      max: 10,
      rss: [],
      api: {},
      lookbackDays: 30,
    })
    assert.equal(out.items.length, 1, '短语路的结果不该被另一路失败连累')
    const messages = out.errors.map((e) => e.message).join('\n')
    assert.match(messages, /检索预算已用尽/)
    assert.doesNotMatch(messages, /所有检索通道都失败了/)
  } finally {
    globalThis.fetch = original
  }
})

test('普通限流（搜索集群负载高）仍然重试，不会当成预算用尽', async () => {
  const calls = []
  const original = globalThis.fetch
  let searchHits = 0
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const isSearch = String(url).includes('search=')
    if (isSearch) searchHits += 1
    // 相关度路前两次 429「集群忙碌」，第三次成功 —— 这种值得重试。
    if (isSearch && searchHits <= 2) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () =>
          JSON.stringify({
            error: 'Rate limit exceeded',
            message:
              'Anonymous search is temporarily rate-limited while the search cluster is under elevated load. Please retry in 10s',
            retryAfter: 10,
          }),
      }
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ meta: { count: 0 }, results: [] }),
    }
  }
  try {
    await collectFromSource({
      source: 'openalex',
      topic,
      max: 10,
      rss: [],
      api: {},
      lookbackDays: 30,
    })
    const searchCalls = calls.filter((c) => c.includes('search=')).length
    assert.ok(searchCalls >= 3, `相关度路应当重试（期望 ≥3 次，实际 ${searchCalls} 次）`)
  } finally {
    globalThis.fetch = original
  }
})
