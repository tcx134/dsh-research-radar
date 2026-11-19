/**
 * 上游给了 Retry-After 就照它等，别用固定退避。
 *
 * 实测 OpenAlex 的「搜索集群负载高」会写 retry-after: 37，而固定退避只等 31 秒，
 * 于是每次都抢在解禁前重试，三次全废 —— 白白把扫描拖长一分多钟还是失败。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectFromSource,
  retryAfterMs,
  nextWait,
  resetRateLimit,
  MAX_RETRY_AFTER_MS,
} from '../radar/sources.js'

const topic = {
  name: '金属橡胶',
  keywords: ['metal rubber'],
  sources: ['openalex'],
  matchMode: 'any',
  strict: true,
  languages: [],
}

const CLUSTER_BUSY = JSON.stringify({
  error: 'Rate limit exceeded',
  message:
    'Anonymous search is temporarily rate-limited while the search cluster is under elevated load. Please retry in 37s',
  retryAfter: 37,
})

const fakeRes = (headers) => ({
  ok: false,
  status: 429,
  statusText: 'Too Many Requests',
  headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? headers : null) },
  text: async () => CLUSTER_BUSY,
})

test('retryAfterMs 按响应头换算，过大时封顶，脏值当没给', () => {
  assert.equal(retryAfterMs(fakeRes('37')), 37000)
  assert.equal(retryAfterMs(fakeRes('2')), 2000)
  // 一小时不可能真等，封顶到 45 秒。
  assert.equal(retryAfterMs(fakeRes('3600')), MAX_RETRY_AFTER_MS)
  // 没给 / 给脏了 / 非正数 —— 都当没给，走固定退避。
  assert.equal(retryAfterMs({ headers: { get: () => null } }), 0)
  assert.equal(retryAfterMs(fakeRes('abc')), 0)
  assert.equal(retryAfterMs(fakeRes('0')), 0)
  assert.equal(retryAfterMs(undefined), 0)
})

test('429 带 Retry-After 时按它等，不按固定退避', async () => {
  const original = globalThis.fetch
  resetRateLimit()
  const searchTimes = []
  let searchHits = 0
  globalThis.fetch = async (url) => {
    const isSearch = String(url).includes('search=')
    if (isSearch) {
      searchHits += 1
      searchTimes.push(Date.now())
    }
    // 相关度路第一次 429（retry-after 2 秒），第二次成功。
    if (isSearch && searchHits === 1) return fakeRes('2')
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
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
    assert.ok(searchTimes.length >= 2, `相关度路应当重试一次，实际 ${searchTimes.length} 次`)
    // 第一次固定退避是 4000ms；上游说 2 秒，就该是 2 秒左右而不是 4 秒。
    const gap = searchTimes[1] - searchTimes[0]
    assert.ok(gap < 3500, `应当按 Retry-After 等约 2 秒，实际等了 ${gap}ms`)
    assert.ok(gap >= 1800, `等得太短了：${gap}ms`)
  } finally {
    globalThis.fetch = original
    resetRateLimit()
  }
})

test('一路等完仍被拦之后，后面的路不再排队重等一遍', async () => {
  const original = globalThis.fetch
  resetRateLimit()
  const times = []
  globalThis.fetch = async (url) => {
    const isSearch = String(url).includes('search=')
    times.push({ at: Date.now(), isSearch })
    if (isSearch) return fakeRes('2')
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
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
    const searchTimes = times.filter((t) => t.isSearch).map((t) => t.at)
    const plainTimes = times.filter((t) => !t.isSearch).map((t) => t.at)
    assert.ok(searchTimes.length >= 2, '相关度路应当重试过')
    // 通道顺序是「短语路 → 相关度路」。短语路把等待预算耗光之后，
    // 相关度路应当立刻发出去，而不是又从头睡一遍 Retry-After。
    const lastPlain = plainTimes[plainTimes.length - 1]
    const firstSearch = searchTimes[0]
    assert.ok(lastPlain < firstSearch, '短语路先发')
    const gap = firstSearch - lastPlain
    assert.ok(gap < 1500, `相关度路不该再等一轮，实际隔了 ${gap}ms`)
  } finally {
    globalThis.fetch = original
    resetRateLimit()
  }
})

test('总等待封顶：连等两次 40 秒就放弃，不把扫描挂住', () => {
  // 上游每次都要求等 40 秒：等一次（40s）还在总上限 45s 内，第二次就超了。
  assert.equal(nextWait(0, 40000, 0), 40000)
  assert.equal(nextWait(1, 40000, 40000), -1, '第二次再等就超上限，必须放弃')
  // 没给 Retry-After 时走固定退避，但同样受总额约束。
  assert.equal(nextWait(0, 0, 0), 4000)
  assert.equal(nextWait(1, 0, 4000), 9000)
  assert.equal(nextWait(2, 0, 13000), 18000)
  assert.equal(nextWait(3, 0, 31000), -1, '没有第四次退避了')
  assert.equal(nextWait(0, 0, 40000), 4000, '44000 还在 45 秒内，可以再等一次')
  assert.equal(nextWait(1, 0, 42000), -1, '42000+9000 超上限，放弃')
})
