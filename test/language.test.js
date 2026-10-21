import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeQuery, finalize, detectLanguage, describeLanguages } from '../radar/sources.js'
import { createStore } from '../radar/store.js'
import { tempDir } from './helpers.js'

/* ------------------------------ normalizeQuery ---------------------------- */

test('normalizeQuery 默认不限语言（空数组）', () => {
  const q = normalizeQuery({ keywords: ['metal rubber'] })
  assert.deepEqual(q.languages, [])
})

test('normalizeQuery 保留单个语言，并忽略未知值', () => {
  assert.deepEqual(normalizeQuery({ keywords: ['x'], languages: ['zh'] }).languages, ['zh'])
  assert.deepEqual(normalizeQuery({ keywords: ['x'], languages: ['en'] }).languages, ['en'])
  // 大小写 / 空白 / 脏值都归一
  assert.deepEqual(normalizeQuery({ keywords: ['x'], languages: [' ZH ', 'fr', 3, null] }).languages, ['zh'])
})

test('中英文都选等价于不限语言', () => {
  const q = normalizeQuery({ keywords: ['x'], languages: ['zh', 'en'] })
  assert.deepEqual(q.languages, [])
  const q2 = normalizeQuery({ keywords: ['x'], languages: ['en', 'zh', 'en'] })
  assert.deepEqual(q2.languages, [])
})

test('describeLanguages 给人话，空数组返回空串', () => {
  assert.equal(describeLanguages([]), '')
  assert.equal(describeLanguages(['zh']), '中文')
  assert.equal(describeLanguages(['zh', 'en']), '中文、英文')
})

/* ------------------------------ detectLanguage ---------------------------- */

test('detectLanguage 认出中文标题', () => {
  assert.equal(detectLanguage({ title: '金属橡胶隔振器的动态特性研究' }), 'zh')
})

test('detectLanguage 认出英文标题', () => {
  assert.equal(detectLanguage({ title: 'Dynamic properties of metal rubber isolators' }), 'en')
})

test('detectLanguage 中英混排时按汉字占比判定（中文摘要 + 英文标题）', () => {
  const item = {
    title: 'Dynamic properties of metal rubber isolators',
    abstract: '本文研究了金属橡胶隔振器在不同振幅下的动态特性，建立了统一的迟滞模型并进行实验验证。',
  }
  assert.equal(detectLanguage(item), 'zh')
})

test('detectLanguage 对空内容 / 纯符号返回空串（认不出来）', () => {
  assert.equal(detectLanguage({}), '')
  assert.equal(detectLanguage(null), '')
  assert.equal(detectLanguage({ title: '   ' }), '')
  assert.equal(detectLanguage({ title: '123 456 --- 789' }), '')
})

/* -------------------------------- finalize -------------------------------- */

function metalRubber(extra = {}) {
  // strict: false —— 这几组用例只考察语言过滤，相关性判定由 finalize.test.js 覆盖
  return normalizeQuery({ keywords: ['metal rubber'], matchMode: 'any', strict: false, ...extra })
}

function paper(id, title, extra = {}) {
  return { id, title, abstract: '', authors: [], venue: '', publishedAt: '2024-05-01', ...extra }
}

test('languages=[zh] 时丢弃英文论文，保留中文论文', () => {
  const items = [
    paper('zh', '金属橡胶隔振器迟滞模型'),
    paper('en', 'Metal rubber hysteresis model'),
  ]
  const out = finalize(items, metalRubber({ languages: ['zh'] }), 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['zh'],
  )
})

test('languages=[en] 时丢弃中文论文', () => {
  const items = [
    paper('zh', '金属橡胶隔振器迟滞模型'),
    paper('en', 'Metal rubber hysteresis model'),
  ]
  const out = finalize(items, metalRubber({ languages: ['en'] }), 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['en'],
  )
})

test('不限语言时中英文都保留', () => {
  const items = [
    paper('zh', '金属橡胶隔振器迟滞模型'),
    paper('en', 'Metal rubber hysteresis model'),
  ]
  const out = finalize(items, metalRubber(), 10, false)
  assert.deepEqual(
    out.map((i) => i.id).sort(),
    ['en', 'zh'],
  )
})

test('认不出语言的条目在限定语言时也放行（宁可多推不误杀）', () => {
  const items = [paper('nolang', 'Metal Rubber 123', { abstract: '' }), paper('zh', '金属橡胶隔振器')]
  // 造一条纯符号标题：认不出语言
  items.push(paper('symbol', '———', { abstract: '' }))
  const out = finalize(items, metalRubber({ languages: ['zh'] }), 10, false)
  const ids = out.map((i) => i.id).sort()
  // 'Metal Rubber 123' 有拉丁字母 → en，被丢掉；'———' 认不出来 → 放行
  assert.deepEqual(ids, ['symbol', 'zh'])
})

test('语言过滤与 strict 判定叠加生效', () => {
  const items = [
    // 命中主要关键词，但语言是中文 → 被语言过滤丢掉
    paper('zh-strong', '金属橡胶隔振器（Metal Rubber）'),
    // 只命中短缩写，本来就该被 strict 丢掉
    paper('en-short', 'MR imaging of the knee'),
  ]
  const query = normalizeQuery({
    keywords: ['metal rubber', 'MR'],
    languages: ['en'],
    strict: true,
  })
  // 一条死于语言、一条死于 strict
  assert.deepEqual(finalize(items, query, 10, false), [])
})

/* ------------------------------ store 持久化 ------------------------------ */

test('store 把 languages 归一化后落盘（中英文都选 → 空数组）', async (t) => {
  const dir = await tempDir(t)
  const store = createStore({}, { dataDir: dir })
  await store.mutate((state) => {
    state.topics.push({
      id: 't-zh',
      name: '中文金属橡胶',
      keywords: ['金属橡胶'],
      sources: ['openalex'],
      languages: ['zh'],
    })
    state.topics.push({
      id: 't-both',
      name: '中英文',
      keywords: ['metal rubber'],
      sources: ['openalex'],
      languages: ['zh', 'en'],
    })
    state.topics.push({
      id: 't-legacy',
      name: '老数据没有这个字段',
      keywords: ['metal rubber'],
      sources: ['openalex'],
    })
  })
  const reloaded = await createStore({}, { dataDir: dir }).load()
  const byId = Object.fromEntries(reloaded.topics.map((topic) => [topic.id, topic]))
  assert.deepEqual(byId['t-zh'].languages, ['zh'])
  assert.deepEqual(byId['t-both'].languages, [])
  assert.deepEqual(byId['t-legacy'].languages, [])
})
