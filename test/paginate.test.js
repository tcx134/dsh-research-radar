import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, paginateItems } from '../index.js'
import { call, makeCtx, seedState, tempDir } from './helpers.js'

/** 造 n 条论文，read / starred 按索引交错。 */
function papers(n, overrides = () => ({})) {
  return Array.from({ length: n }, (_, index) => ({
    id: `openalex:W${index}`,
    topicId: index % 2 === 0 ? 't-a' : 't-b',
    topicName: index % 2 === 0 ? '方向A' : '方向B',
    source: 'openalex',
    title: `Paper ${index}`,
    publishedAt: '2026-09-01',
    discoveredAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
    read: index % 3 === 0,
    starred: index % 5 === 0,
    ...overrides(index),
  }))
}

test('paginateItems 默认返回第一页并报告总数', () => {
  const page = paginateItems(papers(120))
  assert.equal(page.items.length, 50)
  assert.equal(page.total, 120)
  assert.equal(page.offset, 0)
  assert.equal(page.hasMore, true)
})

test('paginateItems 翻到最后一页时 hasMore 为 false', () => {
  const page = paginateItems(papers(120), { limit: '50', offset: '100' })
  assert.equal(page.items.length, 20)
  assert.equal(page.hasMore, false)
  assert.equal(page.items[0].id, 'openalex:W100')
})

test('paginateItems 支持 unread / starred 筛选', () => {
  const all = papers(30)
  const unread = paginateItems(all, { filter: 'unread' })
  assert.equal(unread.total, all.filter((i) => i.read !== true).length)
  assert.ok(unread.items.every((i) => i.read !== true))
  const starred = paginateItems(all, { filter: 'starred' })
  assert.equal(starred.total, all.filter((i) => i.starred === true).length)
  assert.ok(starred.items.every((i) => i.starred === true))
})

test('paginateItems 支持按方向过滤', () => {
  const page = paginateItems(papers(20), { topicId: 't-b' })
  assert.equal(page.total, 10)
  assert.ok(page.items.every((i) => i.topicId === 't-b'))
})

test('paginateItems 把非法参数夹回安全范围', () => {
  const page = paginateItems(papers(10), { limit: '99999', offset: '-5', filter: 'nonsense' })
  assert.equal(page.limit, 500)
  assert.equal(page.offset, 0)
  assert.equal(page.total, 10)
  const zero = paginateItems(papers(10), { limit: '0' })
  assert.equal(zero.limit, 1)
  const nan = paginateItems(papers(10), { limit: 'abc', offset: 'abc' })
  assert.equal(nan.limit, 50)
  assert.equal(nan.offset, 0)
  // Number(null) === 0，查询参数缺失时不能被夹成 1
  const absent = paginateItems(papers(120), { limit: null, offset: null })
  assert.equal(absent.limit, 50)
  assert.equal(absent.items.length, 50)
})

test('paginateItems 对脏输入安全', () => {
  assert.deepEqual(paginateItems(null).items, [])
  assert.deepEqual(paginateItems([null, 1, 'x', papers(1)[0]]).total, 1)
})

test('GET /state 支持 limit / offset / topicId / filter 与 counts', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, { version: 1, topics: [{ id: 't-a', name: '方向A' }], items: papers(120), seen: {}, settings: {} })
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })

  const first = await call(ctx, { url: '/api/dsh-research-radar/state?limit=10' })
  assert.equal(first.status, 200)
  assert.equal(first.body.items.length, 10)
  assert.equal(first.body.page.total, 120)
  assert.equal(first.body.page.hasMore, true)
  assert.equal(first.body.counts.all, 120)
  assert.equal(first.body.counts.unread, 120 - 40)

  const second = await call(ctx, { url: '/api/dsh-research-radar/state?limit=10&offset=10' })
  assert.equal(second.body.items[0].id, 'openalex:W10')
  assert.equal(second.body.page.offset, 10)

  const unread = await call(ctx, { url: '/api/dsh-research-radar/state?filter=unread&limit=100' })
  assert.ok(unread.body.items.every((i) => i.read !== true))
  assert.equal(unread.body.page.total, unread.body.counts.unread)

  const starred = await call(ctx, { url: '/api/dsh-research-radar/state?filter=starred' })
  assert.ok(starred.body.items.every((i) => i.starred === true))

  const topic = await call(ctx, { url: '/api/dsh-research-radar/state?topicId=t-b&limit=100' })
  assert.ok(topic.body.items.every((i) => i.topicId === 't-b'))
  ctx.disposeAll()
})

test('POST /item 同时支持 read 与 starred', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, { version: 1, topics: [], items: papers(3), seen: {}, settings: {} })
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })

  const starred = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/item',
    headers: { 'content-type': 'application/json' },
    body: { id: 'openalex:W1', starred: true },
  })
  assert.equal(starred.status, 200)
  assert.equal(starred.body.item.starred, true)
  assert.equal(starred.body.item.read, false)

  const read = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/item',
    headers: { 'content-type': 'application/json' },
    body: { id: 'openalex:W1', read: true },
  })
  assert.equal(read.body.item.read, true)
  // 只改 read 不能把 starred 冲掉
  assert.equal(read.body.item.starred, true)

  const both = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/item',
    headers: { 'content-type': 'application/json' },
    body: { id: 'openalex:W1', read: false, starred: false },
  })
  assert.equal(both.body.item.read, false)
  assert.equal(both.body.item.starred, false)

  const noField = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/item',
    headers: { 'content-type': 'application/json' },
    body: { id: 'openalex:W1' },
  })
  assert.equal(noField.status, 400)

  const missing = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/item',
    headers: { 'content-type': 'application/json' },
    body: { id: 'nope', read: true },
  })
  assert.equal(missing.status, 400)
  ctx.disposeAll()
})

test('POST /mark-all-read 把未读全部标记并返回新状态', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, { version: 1, topics: [], items: papers(10), seen: {}, settings: {} })
  const ctx = makeCtx()
  apply(ctx, { dataDir: dir })
  const { status, body } = await call(ctx, {
    method: 'POST',
    url: '/api/dsh-research-radar/mark-all-read',
    headers: { 'content-type': 'application/json' },
    body: {},
  })
  assert.equal(status, 200)
  assert.equal(body.marked, 10 - 4)
  assert.equal(body.state.counts.unread, 0)
  ctx.disposeAll()
})

test('收藏状态会落盘，重启后仍然存在', async (t) => {
  const dir = await tempDir(t)
  await seedState(dir, { version: 1, topics: [], items: papers(3), seen: {}, settings: {} })
  const first = makeCtx()
  apply(first, { dataDir: dir })
  await call(first, {
    method: 'POST',
    url: '/api/dsh-research-radar/item',
    headers: { 'content-type': 'application/json' },
    body: { id: 'openalex:W2', starred: true },
  })
  first.disposeAll()

  const second = makeCtx()
  apply(second, { dataDir: dir })
  const state = await call(second, { url: '/api/dsh-research-radar/state' })
  const target = state.body.items.find((i) => i.id === 'openalex:W2')
  assert.equal(target.starred, true)
  second.disposeAll()
})
