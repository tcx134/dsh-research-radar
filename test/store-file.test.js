import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createStore, pruneSeen } from '../radar/store.js'

async function tempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drr-store-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))
  return dir
}

test('store 落盘后能读回，且 seen 在 mutate 时被剪枝', async (t) => {
  const dir = await tempDir(t)
  const store = createStore({}, { dataDir: dir })
  const old = new Date(Date.now() - 400 * 86400000).toISOString()
  await store.mutate((state) => {
    state.seen['doi:ancient'] = old
    state.seen['doi:fresh'] = new Date().toISOString()
    state.topics.push({
      id: 't-1',
      name: '金属橡胶',
      keywords: ['metal rubber'],
      authors: [],
      venues: [],
      institutions: [],
      exclude: [],
      matchMode: 'any',
      strict: true,
      sources: ['openalex'],
      enabled: true,
      createdAt: new Date().toISOString(),
    })
  })

  const raw = JSON.parse(await fsp.readFile(path.join(dir, 'state.json'), 'utf8'))
  // 400 天前的记录在写盘时就被剪掉了
  assert.equal(Object.prototype.hasOwnProperty.call(raw.seen, 'doi:ancient'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(raw.seen, 'doi:fresh'), true)
  assert.equal(raw.topics.length, 1)
  assert.deepEqual(raw.topics[0].keywords, ['metal rubber'])
})

test('旧版 state.json 里裸的 item.id 会被迁移成 id: 前缀', async (t) => {
  const dir = await tempDir(t)
  await fsp.writeFile(
    path.join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      topics: [],
      items: [],
      seen: { 'openalex:W4389000001': '2024-05-01T00:00:00.000Z', 'doi:10.1016/x': '2024-05-01T00:00:00.000Z' },
      settings: {},
    }),
    'utf8',
  )
  const store = createStore({}, { dataDir: dir })
  const state = await store.load()
  assert.equal(Object.prototype.hasOwnProperty.call(state.seen, 'id:openalex:w4389000001'), true)
  assert.equal(Object.prototype.hasOwnProperty.call(state.seen, 'doi:10.1016/x'), true)
  assert.equal(Object.prototype.hasOwnProperty.call(state.seen, 'openalex:W4389000001'), false)
})

test('items 里的论文对应的键不会被剪掉，即使超过 180 天', async (t) => {
  const dir = await tempDir(t)
  const ancient = new Date(Date.now() - 900 * 86400000).toISOString()
  const item = {
    id: 'openalex:W1',
    source: 'openalex',
    doi: '10.1016/j.jsv.2024.1',
    title: 'Metal Rubber Isolator',
    publishedAt: '2024-05-18',
    discoveredAt: ancient,
  }
  await fsp.writeFile(
    path.join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      topics: [],
      items: [item],
      seen: {
        'doi:10.1016/j.jsv.2024.1': ancient,
        'id:openalex:w1': ancient,
        'doi:not-in-items': ancient,
      },
      settings: {},
    }),
    'utf8',
  )
  const store = createStore({}, { dataDir: dir })
  await store.load()
  const removed = await store.pruneSeen()
  const state = store.get()
  assert.equal(removed, 1)
  // items 里这篇论文的 doi 键与 id 键都保留
  assert.equal(Object.prototype.hasOwnProperty.call(state.seen, 'doi:10.1016/j.jsv.2024.1'), true)
  assert.equal(Object.prototype.hasOwnProperty.call(state.seen, 'id:openalex:w1'), true)
  assert.equal(Object.prototype.hasOwnProperty.call(state.seen, 'doi:not-in-items'), false)
})

test('文件不存在时用默认设置，不抛错', async (t) => {
  const dir = await tempDir(t)
  const store = createStore({}, { dataDir: path.join(dir, 'nested', 'deeper') })
  const state = await store.load()
  assert.deepEqual(state.topics, [])
  assert.deepEqual(state.items, [])
  assert.deepEqual(state.seen, {})
  assert.equal(state.settings.scan.lookbackDays, 30)
})

test('坏 JSON 不会让插件崩溃，回退到默认状态', async (t) => {
  const dir = await tempDir(t)
  await fsp.writeFile(path.join(dir, 'state.json'), '{ this is not json', 'utf8')
  const store = createStore({}, { dataDir: dir })
  const state = await store.load()
  assert.deepEqual(state.items, [])
  assert.equal(state.settings.scan.intervalHours, 12)
})

test('pruneSeen 与 store.pruneSeen 的 keepKeys 语义一致', async (t) => {
  const dir = await tempDir(t)
  const ancient = new Date(Date.now() - 900 * 86400000).toISOString()
  const direct = pruneSeen({ 'doi:keep': ancient, 'doi:drop': ancient }, { keepKeys: ['doi:keep'] })
  assert.equal(direct.removed, 1)
  assert.deepEqual(Object.keys(direct.seen), ['doi:keep'])

  const store = createStore({}, { dataDir: dir })
  await store.mutate((state) => {
    state.seen['doi:keep'] = ancient
    state.seen['doi:drop'] = ancient
  })
  assert.deepEqual(Object.keys(store.get().seen), [])
})

test('老 state.json 没有 summaryDepth 时补默认档', async (t) => {
  const dir = await tempDir(t)
  await fsp.writeFile(
    path.join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      topics: [],
      items: [],
      seen: {},
      settings: { scan: { enabled: true, intervalHours: 6, maxPerTopic: 5, summarize: true, lookbackDays: 90 } },
    }),
    'utf8',
  )
  const store = createStore({}, { dataDir: dir })
  const state = await store.load()
  assert.equal(state.settings.scan.summaryDepth, 'standard')
  // 老配置里的其它字段不能被覆盖
  assert.equal(state.settings.scan.lookbackDays, 90)
  assert.equal(state.settings.scan.intervalHours, 6)
})

test('落盘的 summaryDepth 非法值会被归一成默认档', async (t) => {
  const dir = await tempDir(t)
  await fsp.writeFile(
    path.join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      topics: [],
      items: [],
      seen: {},
      settings: { scan: { summaryDepth: 'ultra' } },
    }),
    'utf8',
  )
  const store = createStore({}, { dataDir: dir })
  const state = await store.load()
  assert.equal(state.settings.scan.summaryDepth, 'standard')
})
