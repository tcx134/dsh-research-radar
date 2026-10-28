import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGraph, MAX_NODES, HUB_MIN_WEIGHT, GAP_LIMIT } from '../radar/graph.js'

/** 造一篇带标签的论文。 */
function paper(id, tags, extra = {}) {
  return {
    id,
    title: `paper ${id}`,
    publishedAt: '2026-05-01',
    discoveredAt: '2026-05-02',
    quality: { score: 60, tier: 'medium' },
    summary: { tags },
    ...extra,
  }
}

test('标签共现连成边，权重是同时出现的论文数', () => {
  const g = buildGraph([
    paper('a', ['本构模型', '隔振器']),
    paper('b', ['本构模型', '隔振器']),
    paper('c', ['本构模型', '疲劳']),
  ])
  const edge = g.edges.find((e) => e.source === '本构模型' && e.target === '隔振器')
  assert.equal(edge.weight, 2)
  assert.equal(g.nodes.find((n) => n.id === '本构模型').weight, 3)
})

test('同一篇论文里的重复标签只算一次，不会自己连自己', () => {
  const g = buildGraph([paper('a', ['金属橡胶', '金属橡胶', ' 金属橡胶 '])])
  assert.equal(g.nodes.length, 1)
  assert.equal(g.nodes[0].weight, 1)
  assert.equal(g.edges.length, 0)
})

test('方向名与关键词把同一概念的不同写法并成一个节点', () => {
  // 用户库里的真实情况：中文标签 29 篇、英文标签 6 篇，其实是同一件事。
  // 不合并的话图上会冒出「金属橡胶 × metal rubber」这种毫无意义的「新方向」。
  const topics = [{ id: 't1', name: '金属橡胶', keywords: ['metal rubber', 'MR'] }]
  const g = buildGraph(
    [paper('a', ['金属橡胶']), paper('b', ['metal rubber']), paper('c', ['Metal Rubber'])],
    { topics },
  )
  assert.equal(g.nodes.length, 1)
  assert.equal(g.nodes[0].id, 'topic:t1')
  assert.equal(g.nodes[0].label, '金属橡胶')
  assert.equal(g.nodes[0].weight, 3)
  assert.equal(g.gaps.length, 0)
})

test('合并之后不再产生「自己是自己」的假空白方向', () => {
  const topics = [{ id: 't1', name: '金属橡胶', keywords: ['metal rubber'] }]
  const g = buildGraph([paper('a', ['金属橡胶', '本构模型']), paper('b', ['metal rubber', '本构模型'])], { topics })
  // 两条边折叠成同一条自环之外的边，且不存在 topic:t1 与自己的 gap
  assert.equal(g.gaps.length, 0)
  assert.ok(g.edges.every((e) => e.source !== e.target))
})

test('单字标签被丢掉（噪声，画上去只会糊成一团）', () => {
  const g = buildGraph([paper('a', ['铁', '金属橡胶'])])
  assert.equal(g.nodes.length, 1)
  assert.equal(g.nodes[0].id, '金属橡胶')
})

test('节点数超过上限时只留权重最高的', () => {
  const tags = []
  for (let i = 0; i < MAX_NODES + 10; i += 1) tags.push(`tag${i}`)
  const g = buildGraph([paper('a', tags)])
  assert.equal(g.nodes.length, MAX_NODES)
  // 留下的边两端必须在节点里
  const kept = new Set(g.nodes.map((n) => n.id))
  assert.ok(g.edges.every((e) => kept.has(e.source) && kept.has(e.target)))
})

test('「新方向」只从够强的主题之间找，且排除已经连过边的', () => {
  const g = buildGraph([
    paper('a', ['甲乙', '乙丙']),
    paper('b', ['甲乙']),
    paper('c', ['甲乙']),
    paper('d', ['乙丙']),
    paper('e', ['乙丙']),
    paper('f', ['丙丁']),
    paper('g', ['丙丁']),
    paper('h', ['丙丁']),
  ])
  // 甲乙 与 丙丁 没连过边且都够强 → 应该被提出来
  const pairs = g.gaps.map((gap) => [gap.aLabel, gap.bLabel].sort().join('×'))
  assert.ok(pairs.includes(['甲乙', '丙丁'].sort().join('×')))
  // 甲乙 与 乙丙 已经连过边，不该出现在缺口里
  assert.ok(!pairs.includes(['甲乙', '乙丙'].sort().join('×')))
})

test('权重低于门槛的弱主题不参与「新方向」', () => {
  const g = buildGraph([
    paper('a', ['甲乙', '乙丙', '丙丁']),
    paper('b', ['甲乙']),
    paper('c', ['甲乙']),
    // 乙丙 / 丙丁 都只出现 1 次，达不到 HUB_MIN_WEIGHT
  ])
  assert.ok(HUB_MIN_WEIGHT > 1)
  const labels = g.gaps.flatMap((gap) => [gap.aLabel, gap.bLabel])
  assert.ok(!labels.includes('乙丙'))
  assert.ok(!labels.includes('丙丁'))
})

test('缺口数量有上限，按「两边都热」排序', () => {
  const items = []
  for (let i = 0; i < HUB_MIN_WEIGHT + 4; i += 1) items.push(paper(`hot${i}`, ['热']))
  for (let i = 0; i < 8; i += 1) items.push(paper(`x${i}`, [`词${i}`]))
  const g = buildGraph(items)
  assert.ok(g.gaps.length <= GAP_LIMIT)
})

test('近期论文占比过半的节点标成 fresh', () => {
  const now = Date.parse('2026-06-01T00:00:00Z')
  const g = buildGraph(
    [
      paper('a', ['新话题'], { publishedAt: '2026-05-20' }),
      paper('b', ['新话题'], { publishedAt: '2025-01-01' }),
    ],
    { now },
  )
  assert.equal(g.nodes[0].fresh, true)

  const g2 = buildGraph(
    [
      paper('a', ['老话题'], { publishedAt: '2023-05-20' }),
      paper('b', ['老话题'], { publishedAt: '2025-01-01' }),
    ],
    { now },
  )
  assert.equal(g2.nodes[0].fresh, false)
})

test('脏输入安全：null、非数组、没有摘要、tags 不是数组都跳过', () => {
  assert.deepEqual(buildGraph(null).nodes, [])
  assert.deepEqual(buildGraph(undefined).stats.papers, 0)
  assert.deepEqual(buildGraph([null, 1, 'x', { id: 'a' }]).nodes, [])
  assert.deepEqual(buildGraph([{ id: 'a', summary: null }]).nodes, [])
  assert.deepEqual(buildGraph([{ id: 'a', summary: { tags: 'not-an-array' } }]).nodes, [])
})

test('tags 里非字符串的元素被安全处理', () => {
  const g = buildGraph([paper('a', [null, 12, { x: 1 }, '金属橡胶'])])
  assert.equal(g.nodes.length, 1)
  assert.equal(g.nodes[0].id, '金属橡胶')
})

test('stats 里的密度与计数自洽', () => {
  const g = buildGraph([paper('a', ['甲乙', '乙丙']), paper('b', ['甲乙', '丙丁'])])
  assert.equal(g.stats.papers, 2)
  assert.equal(g.stats.taggedPapers, 2)
  assert.equal(g.stats.nodeCount, 3)
  assert.equal(g.stats.edgeCount, 2)
  // 3 个节点最多 3 条边，连了 2 条 → 2/3
  assert.equal(g.stats.density, 0.667)
})

test('没有标签的论文只计 papers，不计 taggedPapers', () => {
  const g = buildGraph([paper('a', ['甲乙', '乙丙']), { id: 'b', summary: null, publishedAt: '2026-01-01' }])
  assert.equal(g.stats.papers, 2)
  assert.equal(g.stats.taggedPapers, 1)
})

test('days 只保留窗口内发表的论文，没有日期的老数据不算进窗口', () => {
  const now = Date.parse('2026-06-01T00:00:00Z')
  const g = buildGraph(
    [
      paper('a', ['甲乙'], { publishedAt: '2026-05-20' }),
      paper('b', ['乙丙'], { publishedAt: '2024-01-01' }),
      paper('c', ['丙丁'], { publishedAt: '' }),
    ],
    { now, days: 90 },
  )
  assert.equal(g.stats.papers, 1)
  assert.deepEqual(g.nodes.map((n) => n.id), ['甲乙'])
})

test('topicId 只看指定方向；days 传空或脏值时不限时间', () => {
  const items = [
    paper('a', ['甲乙'], { topicId: 't1', publishedAt: '2020-01-01' }),
    paper('b', ['乙丙'], { topicId: 't2', publishedAt: '2026-05-01' }),
  ]
  assert.equal(buildGraph(items, { topicId: 't1' }).stats.papers, 1)
  assert.equal(buildGraph(items, { topicId: 't2' }).stats.papers, 1)
  assert.equal(buildGraph(items, { topicId: '' }).stats.papers, 2)
  // Number(null) === 0 会把窗口夹成一天，这里必须是「不限」
  assert.equal(buildGraph(items, { days: null }).stats.papers, 2)
  assert.equal(buildGraph(items, { days: '' }).stats.papers, 2)
  assert.equal(buildGraph(items, { days: 'abc' }).stats.papers, 2)
})