/**
 * 论文库（书架）——把「检索到过的论文」按年份 / 方向分门别类地摆出来。
 *
 * 和「最新论文」页签的区别：
 * - 最新论文 = 按发现时间倒序的流水，只回答「这轮扫到了什么」；
 * - 论文库   = 按**发表年份**归架的全量书架，回答「我手上到底有哪些、哪些是老论文」。
 *
 * 回溯检索（把窗口拉到 3 年、10 年）之后，一堆 2023/2024 的论文混在流水里很难看，
 * 书架按年份分层就能一眼看出「这一年收了多少、哪些是补回来的老货」。
 */

/** 一年按 365 天算，用于「老论文」判定。 */
const YEAR_DAYS = 365
/** 90 天内算「新」，超过一年算「老」。 */
const FRESH_DAYS = 90

/** 日期字符串转毫秒，失败返回 NaN。 */
function timeOf(value) {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : NaN
}

/** 发表年份，取不到返回 ''。 */
export function yearOf(publishedAt) {
  const text = String(publishedAt ?? '').trim()
  if (text.length < 4) return ''
  const head = text.slice(0, 4)
  return /^\d{4}$/.test(head) ? head : ''
}

/**
 * 新鲜度：`new`（90 天内）/ `recent`（一年内）/ `old`（一年以上）/ `unknown`（没日期）。
 * 面板用它在书架上打「新」「老论文」角标。
 */
export function freshnessOf(item, now = Date.now()) {
  const at = timeOf(item?.publishedAt)
  if (!Number.isFinite(at)) return 'unknown'
  const days = Math.floor((now - at) / 86400000)
  if (days < 0) return 'new'
  if (days <= FRESH_DAYS) return 'new'
  if (days <= YEAR_DAYS) return 'recent'
  return 'old'
}

/** 书架上一行需要的最小信息（不带宽摘要，500 条也不会撑爆）。 */
function compactItem(item, now) {
  const at = timeOf(item.publishedAt)
  return {
    id: item.id,
    title: item.title,
    authors: Array.isArray(item.authors) ? item.authors.slice(0, 3) : [],
    authorCount: Array.isArray(item.authors) ? item.authors.length : 0,
    venue: item.venue,
    publishedAt: item.publishedAt,
    source: item.source,
    topicId: item.topicId,
    topicName: item.topicName,
    url: item.url,
    doi: item.doi,
    citations: item.citations,
    read: item.read === true,
    starred: item.starred === true,
    // 质量分与档位（书架上打徽章、按质量排都用它）
    qualityScore: Number.isFinite(Number(item.quality?.score)) ? Number(item.quality.score) : null,
    qualityTier: typeof item.quality?.tier === 'string' ? item.quality.tier : '',
    impactFactor: Number.isFinite(Number(item.quality?.impactFactor)) ? Number(item.quality.impactFactor) : null,
    // 有没有生成过结构化摘要（有摘要的卡片才能「精读」，书架上标一下）
    hasSummary: item.summary !== null && typeof item.summary === 'object',
    summaryDepth: item.summary?.depth ?? '',
    // 摘要是基于全文还是仅摘要 —— 书架上一眼看出哪些读透了
    summaryBasis: item.summary?.basis ?? '',
    discoveredAt: item.discoveredAt,
    // 从发表到现在过了多少天（老论文判定与排序都用它）
    ageDays: Number.isFinite(at) ? Math.floor((now - at) / 86400000) : null,
    freshness: freshnessOf(item, now),
  }
}

/**
 * 组织书架。
 *
 * @param {object[]} items 全量论文（state.items）
 * @param {object} [options]
 * @param {'year'|'topic'} [options.groupBy='year'] 按发表年份还是按研究方向分架
 * @param {string} [options.topicId=''] 只看某个方向
 * @param {number} [options.now] 便于测试注入当前时间
 * @param {(topicId: string) => string} [options.topicLabel] 方向 id → 显示名
 * @returns {{groupBy: string, topicId: string, total: number, groups: object[], summary: object}}
 */
export function buildLibrary(items, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const groupBy = options.groupBy === 'topic' ? 'topic' : 'year'
  const topicId = typeof options.topicId === 'string' ? options.topicId : ''
  const label = typeof options.topicLabel === 'function' ? options.topicLabel : null

  const source = (Array.isArray(items) ? items : []).filter(
    (item) => item !== null && typeof item === 'object' && String(item.id ?? '') !== '',
  )
  const scoped = topicId === '' ? source : source.filter((item) => item.topicId === topicId)
  const rows = scoped.map((item) => compactItem(item, now))

  // 分桶。年份书架里没日期的归「未知」，排在最后；方向书架里没方向的归「未分类」。
  const buckets = new Map()
  for (const row of rows) {
    const key = groupBy === 'year' ? yearOf(row.publishedAt) || '未知' : row.topicId || '未分类'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }

  const groups = []
  for (const [key, list] of buckets) {
    // 架内按发表时间倒序；同一天按被引数、再按发现时间兜底，保证顺序稳定
    list.sort((a, b) => {
      const byDate = String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))
      if (byDate !== 0) return byDate
      if ((b.citations ?? 0) !== (a.citations ?? 0)) return (b.citations ?? 0) - (a.citations ?? 0)
      return String(b.discoveredAt ?? '').localeCompare(String(a.discoveredAt ?? ''))
    })
    groups.push({
      key,
      // 方向书架用中文名当标题，年份书架标题就是年份
      label:
        groupBy === 'year'
          ? key
          : (label !== null ? label(key) : '') || list[0]?.topicName || key,
      count: list.length,
      oldCount: list.filter((row) => row.freshness === 'old').length,
      unreadCount: list.filter((row) => row.read !== true).length,
      items: list,
    })
  }

  groups.sort((a, b) => {
    if (groupBy === 'year') {
      if (a.key === '未知') return 1
      if (b.key === '未知') return -1
      return b.key.localeCompare(a.key)
    }
    // 方向书架按篇数从多到少
    return b.count - a.count
  })

  const years = rows.map((row) => yearOf(row.publishedAt)).filter((year) => year !== '')
  years.sort()
  return {
    groupBy,
    topicId,
    total: rows.length,
    groups,
    summary: {
      // 手上最早 / 最新一篇的年份，面板顶部用来回答「我这库有多深」
      oldestYear: years[0] ?? '',
      newestYear: years[years.length - 1] ?? '',
      oldCount: rows.filter((row) => row.freshness === 'old').length,
      newCount: rows.filter((row) => row.freshness === 'new').length,
      unreadCount: rows.filter((row) => row.read !== true).length,
      starredCount: rows.filter((row) => row.starred === true).length,
      summarizedCount: rows.filter((row) => row.hasSummary).length,
      // 「这个库里有多少篇是值得读的、多少篇读到了全文」
      highQualityCount: rows.filter((row) => row.qualityTier === 'high').length,
      fullTextCount: rows.filter((row) => row.summaryBasis === 'fulltext').length,
    },
  }
}
