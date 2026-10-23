import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeQuery, finalize, isExcluded, spreadByYear, shouldSpread } from '../radar/sources.js'

function metalRubber(extra = {}) {
  return normalizeQuery({
    keywords: ['metal rubber', 'MR', 'EMWM'],
    sources: ['openalex', 'crossref'],
    matchMode: 'any',
    strict: true,
    ...extra,
  })
}

function paper(id, title, extra = {}) {
  return { id, title, abstract: '', authors: [], venue: '', publishedAt: '2024-05-01', ...extra }
}

test('strict 下丢弃只命中短缩写的磁共振论文（用户实测的核心诉求）', () => {
  const items = [
    paper('a', 'Metal Rubber Vibration Isolator for Ships'),
    paper('b', 'MR Imaging of the Knee Joint'),
    paper('c', 'EMWM Based Damper'),
    paper('d', 'Metal Rubber Bearings: A Review'),
  ]
  const out = finalize(items, metalRubber(), 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['a', 'd'],
  )
})

test('strict 下主要关键词命中的排在短缩写命中之前', () => {
  const items = [
    paper('short', 'EMWM damper design'),
    paper('strong', 'Metal Rubber damper design'),
  ]
  const out = finalize(items, metalRubber(), 10, false)
  assert.equal(out[0].id, 'strong')
})

test('配了作者维度时，作者命中可以救回没有主要关键词命中的论文', () => {
  const q = metalRubber({ authors: ['Li Wei'] })
  const items = [paper('byAuthor', 'A damper study', { authors: ['Li Wei'] })]
  const out = finalize(items, q, 10, false)
  assert.equal(out.length, 1)
  assert.match(out[0].matchedIn, /作者:Li Wei/)
})

test('没有主要关键词时，任何命中都算相关', () => {
  const q = normalizeQuery({ keywords: ['MR'], strict: true })
  const out = finalize([paper('a', 'MR imaging')], q, 10, false)
  assert.equal(out.length, 1)
})

test('strict=false 且 localFilter=false 时不做本地相关性过滤', () => {
  const q = metalRubber({ strict: false })
  const out = finalize([paper('a', 'Totally unrelated paper')], q, 10, false)
  assert.equal(out.length, 1)
  assert.equal(out[0].score, 0)
})

test('localFilter=true 时即使 strict=false 也要求有命中', () => {
  const q = metalRubber({ strict: false })
  const out = finalize([paper('a', 'Totally unrelated paper')], q, 10, true)
  assert.equal(out.length, 0)
})

test('排除词命中即丢弃', () => {
  const q = metalRubber({ exclude: ['graphene'] })
  assert.equal(isExcluded(paper('a', 'Metal rubber with graphene filler'), q), true)
  assert.equal(isExcluded(paper('b', 'Metal rubber isolator'), q), false)
  const out = finalize([paper('a', 'Metal rubber with graphene filler'), paper('b', 'Metal rubber isolator')], q, 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['b'],
  )
})

test('matchMode=all 要求所有关键词都命中', () => {
  const q = normalizeQuery({ keywords: ['metal rubber', 'damper'], matchMode: 'all' })
  assert.equal(finalize([paper('a', 'metal rubber isolator')], q, 10, false).length, 0)
  assert.equal(finalize([paper('b', 'metal rubber damper')], q, 10, false).length, 1)
})

test('finalize 按 id 去重并按 max 截断', () => {
  const q = metalRubber()
  const items = [paper('a', 'metal rubber 1'), paper('a', 'metal rubber 1'), paper('b', 'metal rubber 2')]
  const out = finalize(items, q, 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['a', 'b'],
  )
  assert.equal(finalize(items, q, 1, false).length, 1)
})

test('finalize 丢掉没有 id 的脏条目', () => {
  const q = metalRubber()
  const out = finalize([{ title: 'metal rubber' }, null, paper('ok', 'metal rubber')], q, 10, false)
  assert.deepEqual(
    out.map((i) => i.id),
    ['ok'],
  )
})

test('finalize 同分时按出版日期从新到旧', () => {
  const q = metalRubber()
  const out = finalize(
    [
      paper('old', 'metal rubber', { publishedAt: '2023-01-01' }),
      paper('new', 'metal rubber', { publishedAt: '2024-05-01' }),
    ],
    q,
    10,
    false,
  )
  assert.deepEqual(
    out.map((i) => i.id),
    ['new', 'old'],
  )
})

/* ------------------- 宽窗口回溯：按年份摊开配额（spread） ------------------ */

test('spreadByYear 让每一年都有代表，而不是全被最近几天占满', () => {
  // 模拟热点方向：2026 年有一堆，老论文埋在下面
  const items = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, publishedAt: `2026-10-${String(i + 1).padStart(2, '0')}` })),
    { id: 'y25', publishedAt: '2025-05-01' },
    { id: 'y24', publishedAt: '2024-05-01' },
    { id: 'y23', publishedAt: '2023-05-01' },
  ]
  const out = spreadByYear(items, 4)
  assert.equal(out.length, 4)
  const years = out.map((i) => i.publishedAt.slice(0, 4)).sort()
  assert.deepEqual(years, ['2023', '2024', '2025', '2026'])
})

test('spreadByYear 年份内按相关度、被引、日期排序', () => {
  const items = [
    { id: 'low', publishedAt: '2024-01-01', score: 5, citations: 0 },
    { id: 'hot', publishedAt: '2024-06-01', score: 5, citations: 900 },
    { id: 'top', publishedAt: '2024-03-01', score: 9, citations: 1 },
    // 多塞一条别的年份，避免走到「条数够用就原样返回」的短路
    { id: 'other', publishedAt: '2025-01-01', score: 1, citations: 0 },
  ]
  assert.deepEqual(
    spreadByYear(items, 3).map((i) => i.id),
    ['other', 'top', 'hot'],
  )
})

test('spreadByYear 条数够用时原样返回（不重排）', () => {
  const items = [
    { id: 'a', publishedAt: '2026-01-01' },
    { id: 'b', publishedAt: '2025-01-01' },
  ]
  assert.deepEqual(
    spreadByYear(items, 5).map((i) => i.id),
    ['a', 'b'],
  )
})

test('spreadByYear 对脏数据安全', () => {
  assert.deepEqual(spreadByYear(null, 3), [])
  assert.deepEqual(spreadByYear([], 3), [])
  assert.deepEqual(spreadByYear([null, 1, 'x'], 3), [])
  // 没有日期归到「未知」年份，排在最后但不丢
  const out = spreadByYear([{ id: 'a', publishedAt: '' }, { id: 'b', publishedAt: '2026-01-01' }], 2)
  assert.deepEqual(out.map((i) => i.id).sort(), ['a', 'b'])
})

test('finalize 在 spread 模式下把老论文带出来（时间范围选择的实际效果）', () => {
  const q = metalRubber()
  const items = [
    ...Array.from({ length: 12 }, (_, i) =>
      paper(`n${i}`, 'metal rubber', { publishedAt: `2026-10-${String(i + 1).padStart(2, '0')}` }),
    ),
    paper('old', 'metal rubber', { publishedAt: '2023-04-01' }),
  ]
  // 不开 spread：8 条配额全被 2026 年占满
  const plain = finalize(items, q, 8, false)
  assert.equal(plain.filter((i) => i.publishedAt.startsWith('2023')).length, 0)
  // 开 spread：2023 那条一定进得来
  const spread = finalize(items, q, 8, false, true)
  assert.equal(spread.length, 8)
  assert.equal(spread.filter((i) => i.publishedAt.startsWith('2023')).length, 1)
})

test('shouldSpread 只在窗口超过 90 天时为真', () => {
  assert.equal(shouldSpread(30), false)
  assert.equal(shouldSpread(90), false)
  assert.equal(shouldSpread(91), true)
  assert.equal(shouldSpread(1095), true)
  // 脏值一律不摊开（日常扫描走的就是这条路）
  assert.equal(shouldSpread(null), false)
  assert.equal(shouldSpread(undefined), false)
  assert.equal(shouldSpread('abc'), false)
  assert.equal(shouldSpread(0), false)
})

/* --------------------- 连字符变体折叠（「检索得太少」主因） --------------------- */

test('标题写成 metal-rubber / metal–rubber 时仍算命中主要关键词', () => {
  // 实测某方向 50 条候选里有 13 条（26%）是这种变体，原来全被 strict 丢掉
  const items = [
    paper('a', 'Hysteretic modeling of a metal-rubber dynamic vibration absorber'),
    paper('b', 'Air-Coupled Ultrasonic Imaging for Metal–Rubber Debonding Detection'),
    paper('c', 'Ultrasonic monitoring of metal_rubber barrier degradation'),
    paper('d', 'Metal / Rubber bonded structures under cyclic loading'),
  ]
  const out = finalize(items, metalRubber(), 10, false)
  assert.deepEqual(
    out.map((i) => i.id).sort(),
    ['a', 'b', 'c', 'd'],
    '四种连字符写法都应该被识别成 metal rubber',
  )
})

test('摘要里的连字符变体同样算命中（56% 的条目只有标题没有摘要）', () => {
  const item = paper('x', 'A study on vibration isolation', {
    abstract: 'This paper investigates metal–rubber components used in ship isolators.',
  })
  const out = finalize([item], metalRubber(), 10, false)
  assert.equal(out.length, 1)
  assert.match(out[0].matchedIn, /摘要:metal rubber/)
})

test('折叠不会把不相关论文放进来（MR 仍然不能单独过 strict）', () => {
  const items = [
    paper('mr', 'MR Imaging of the Knee'),
    paper('hyphen', 'metal-rubber isolator'),
  ]
  const out = finalize(items, metalRubber(), 10, false)
  assert.deepEqual(out.map((i) => i.id), ['hyphen'])
})

test('排除词也走折叠，能排除连字符写法', () => {
  const q = metalRubber({ exclude: ['metal rubber'] })
  const items = [paper('a', 'metal-rubber isolator'), paper('b', 'metal rubber isolator')]
  assert.deepEqual(finalize(items, q, 10, false), [])
  // 排除词本身不受 strict 影响，只看有没有出现
  assert.equal(isExcluded(paper('c', 'Metal–Rubber composite'), q), true)
})
