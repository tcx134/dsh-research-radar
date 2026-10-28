/**
 * 研究关系网：把论文的标签共现画成一张图，回答两个问题 ——
 *   1. 这个领域的研究重点是什么（哪些概念反复一起出现）；
 *   2. 可能存在的新方向在哪（哪些强概念之间**还没有**连边）。
 *
 * 为什么能回答第 2 个：标签来自每篇论文的结构化摘要（`summary.tags`），
 * 两个标签在同一篇论文里出现一次，就连一条边。于是「一直被一起研究」的组合
 * 边很粗，「从来没被一起研究过」的两个强主题之间就是空的 —— 那条空档正是
 * 可以做的交叉方向。这不是模型编出来的建议，是从已有文献结构里量出来的。
 *
 * 全部是纯函数，不碰 IO，方便单测。
 */

/** 图上最多画多少个标签节点（再多就看不清了）。 */
export const MAX_NODES = 28
/** 边最多保留多少条（按权重从高到低）。 */
export const MAX_EDGES = 90
/** 「强主题」的门槛：至少出现在这么多篇论文里，才值得当作可能的新方向端点。 */
export const HUB_MIN_WEIGHT = 3
/** 最多提示几组「还没交叉过的强主题」。 */
export const GAP_LIMIT = 5

/** 标签归一：去首尾空白、压内部空白、小写化用于比对（显示仍用原文）。 */
function tagKey(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** 时间戳转毫秒，失败返回 NaN。 */
function timeOf(value) {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : NaN
}

/**
 * 从论文列表构建关系网。
 *
 * @param {object[]} items 论文（读 `summary.tags`、`publishedAt`、`discoveredAt`、`quality`）
 * @param {object} [options]
 * @param {object[]} [options.topics] 研究方向（用 name + keywords 把同一概念的不同写法并成一个节点）
 * @param {string} [options.topicId] 只看某个方向的论文（空 = 全部）
 * @param {number|string} [options.days] 只看最近多少天发表的论文（空 = 不限）
 * @param {number} [options.maxNodes] 节点上限
 * @param {number} [options.maxEdges] 边上限
 * @param {number} [options.now] 当前时间（毫秒），用于判断「近期」
 * @param {number} [options.recentDays] 多少天内算近期，默认 180
 * @returns {{nodes: object[], edges: object[], gaps: object[], stats: object}}
 */
export function buildGraph(items, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const maxNodes = Math.max(1, Math.round(Number(options.maxNodes) || MAX_NODES))
  const maxEdges = Math.max(1, Math.round(Number(options.maxEdges) || MAX_EDGES))
  const recentMs = Math.max(1, Number(options.recentDays) || 180) * 86400000
  const topicId = String(options.topicId ?? '')
  // days 用和别处一样的挡 null 写法：Number(null) 是 0，会把窗口夹成一天
  const rawDays = options.days === null || options.days === undefined || options.days === '' ? NaN : Number(options.days)
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(3650, Math.round(rawDays)) : null
  const since = days === null ? null : now - days * 86400000

  const list = (Array.isArray(items) ? items : []).filter(
    (item) => item !== null && typeof item === 'object' && (topicId === '' || item.topicId === topicId),
  )

  // 方向名 / 方向关键词 → 方向节点 id。
  //
  // 为什么需要这一步：摘要里的标签是模型按论文内容生成的，同一概念会写成
  // 中文也可能写成英文（用户库里 `金属橡胶` 29 篇、`metal rubber` 6 篇，
  // 其实是同一件事）。不合并的话图上会有两个「最热的点」，还会算出一条
  // 「金属橡胶 × metal rubber」的假空白方向 —— 这个建议毫无意义。
  // 方向的 name + keywords 正好是「这个方向叫什么」的权威说法，用它归一最稳。
  const topicAlias = new Map()
  const topics = Array.isArray(options.topics) ? options.topics : []
  for (const topic of topics) {
    if (topic === null || typeof topic !== 'object') continue
    const id = String(topic.id ?? '')
    if (id === '') continue
    const name = String(topic.name ?? '').trim()
    if (name === '') continue
    topicAlias.set(tagKey(name), { id: `topic:${id}`, label: name })
    for (const keyword of Array.isArray(topic.keywords) ? topic.keywords : []) {
      const key = tagKey(keyword)
      if (key !== '') topicAlias.set(key, { id: `topic:${id}`, label: name })
    }
  }

  /** 显示名：同一个 key 可能被写成不同大小写，取第一次出现的写法。 */
  const display = new Map()
  /** key -> { weight, recent, papers:Set, tier:最高质量档 } */
  const nodes = new Map()
  /** "a\u0000b" -> { a, b, weight, recent } */
  const edges = new Map()
  /** 真的进了窗口的论文（stats 的分母用它，不是原始数组长度） */
  const used = []

  for (const item of list) {
    const time = timeOf(item.publishedAt ?? item.discoveredAt)
    // 时间过滤放在最前面：被窗口挡掉的论文连标签都不该进图，
    // 否则节点权重会掺进窗口外的论文，看得出来的「重点」就不准了。
    // days 限定的是「论文发表时间」，没有日期的老数据不算进窗口。
    if (since !== null && !(Number.isFinite(time) && time >= since)) continue
    used.push(item)

    const summary = item.summary !== null && typeof item.summary === 'object' ? item.summary : null
    const tags = summary !== null && Array.isArray(summary.tags) ? summary.tags : []
    const keys = []
    for (const raw of tags) {
      // 只认字符串：tags 是模型生成的，偶尔会混进 null / 数字 / 对象，
      // `String({})` 会得到 "[object Object]" 这种节点，画上去纯属污染。
      if (typeof raw !== 'string') continue
      const key = tagKey(raw)
      // 太短的标签（单字）几乎一定是噪声，画上去只会糊成一团
      if (key.length < 2) continue
      // 命中方向名/关键词的标签并到方向节点上
      const alias = topicAlias.get(key)
      const nodeKey = alias === undefined ? key : alias.id
      if (!keys.includes(nodeKey)) keys.push(nodeKey)
      if (!display.has(nodeKey)) {
        display.set(nodeKey, alias === undefined ? String(raw).replace(/\s+/g, ' ').trim() : alias.label)
      }
    }
    if (keys.length === 0) continue

    const isRecent = Number.isFinite(time) && now - time <= recentMs
    const tier = item.quality !== null && typeof item.quality === 'object' ? item.quality.tier : ''
    const score = item.quality !== null && typeof item.quality === 'object' ? Number(item.quality.score) : NaN

    for (const key of keys) {
      let node = nodes.get(key)
      if (node === undefined) {
        node = { weight: 0, recent: 0, papers: 0, bestScore: -1, tier: '' }
        nodes.set(key, node)
      }
      node.weight += 1
      node.papers += 1
      if (isRecent) node.recent += 1
      // 节点也带上「它最好的那篇论文有多好」，画图时据此调大小与颜色
      if (Number.isFinite(score) && score > node.bestScore) {
        node.bestScore = score
        node.tier = typeof tier === 'string' ? tier : ''
      }
    }

    // 同一篇论文里的标签两两连边
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const a = keys[i] < keys[j] ? keys[i] : keys[j]
        const b = keys[i] < keys[j] ? keys[j] : keys[i]
        const id = `${a}\u0000${b}`
        let edge = edges.get(id)
        if (edge === undefined) {
          edge = { a, b, weight: 0, recent: 0 }
          edges.set(id, edge)
        }
        edge.weight += 1
        if (isRecent) edge.recent += 1
      }
    }
  }

  // 只留权重最高的若干节点；边要两端都在才能画
  const ranked = [...nodes.entries()].sort((x, y) => y[1].weight - x[1].weight || x[0].localeCompare(y[0])).slice(0, maxNodes)
  const kept = new Set(ranked.map(([key]) => key))

  const nodeList = ranked.map(([key, node]) => ({
    id: key,
    label: display.get(key) ?? key,
    weight: node.weight,
    recent: node.recent,
    tier: node.tier,
    // 「新出现」= 一半以上出现在近期；用来在图上把新话题标亮
    fresh: node.weight > 0 && node.recent / node.weight >= 0.5,
  }))

  const edgeList = [...edges.values()]
    .filter((edge) => kept.has(edge.a) && kept.has(edge.b))
    .sort((x, y) => y.weight - x.weight || `${x.a}|${x.b}`.localeCompare(`${y.a}|${y.b}`))
    .slice(0, maxEdges)
    .map((edge) => ({ source: edge.a, target: edge.b, weight: edge.weight, recent: edge.recent }))

  // ---- 「可能存在的新方向」----
  // 两个都很强的主题，如果从来没在同一篇论文里出现过，说明这两个方向还没被交叉研究。
  // 这不是模型编的建议，是从标签共现矩阵里量出来的空格子。
  const hubs = nodeList.filter((node) => node.weight >= HUB_MIN_WEIGHT)
  // 注意：这里要用「截断前」的边集合。edgeList 被 maxEdges 砍过，
  // 用砍过的去判断「连过边没有」会把被砍掉的那批误当成空白方向。
  const linked = new Set()
  for (const edge of edges.values()) {
    if (kept.has(edge.a) && kept.has(edge.b)) linked.add(`${edge.a}\u0000${edge.b}`)
  }
  const gaps = []
  for (let i = 0; i < hubs.length; i += 1) {
    for (let j = i + 1; j < hubs.length; j += 1) {
      const a = hubs[i]
      const b = hubs[j]
      const id = a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`
      if (linked.has(id)) continue
      // 两边都热，交叉的价值才高：用权重的几何平均当成「缺口大小」
      gaps.push({
        a: a.id,
        b: b.id,
        aLabel: a.label,
        bLabel: b.label,
        // 分数只用来排序：两边都重、又都新，越值得提
        score: Math.sqrt(a.weight * b.weight) + Math.min(a.recent, b.recent),
        aWeight: a.weight,
        bWeight: b.weight,
      })
    }
  }
  gaps.sort((x, y) => y.score - x.score || x.aLabel.localeCompare(y.aLabel))

  return {
    nodes: nodeList,
    edges: edgeList,
    gaps: gaps.slice(0, GAP_LIMIT),
    stats: {
      papers: used.length,
      // 有摘要的才算「有标签的论文」，分母用它更诚实
      taggedPapers: used.filter((item) => item.summary !== null && typeof item.summary === 'object').length,
      nodeCount: nodeList.length,
      edgeCount: edgeList.length,
      // 密度：已连边 / 最多可能连边。低密度 = 主题之间还很散
      density:
        nodeList.length > 1
          ? Math.round((edgeList.length / ((nodeList.length * (nodeList.length - 1)) / 2)) * 1000) / 1000
          : 0,
    },
  }
}