/**
 * 趋势与统计（P2 第 11 条）。
 *
 * 面板每次只拿一页（50 条），前端算不了全量统计，所以统计在 Host 侧算好再下发。
 * 这里全部是纯函数，不碰 IO，方便单测。
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 统计窗口的默认值与上下限（天）。 */
export const DEFAULT_STATS_DAYS = 90
export const MAX_STATS_DAYS = 730
/** 每个榜单最多返回多少条。 */
export const TOP_LIMIT = 8

/**
 * 把时间戳归一到「所在那一周的周一」。
 * 用周一而不是周日，是因为中文语境里「这周」通常指周一到周日。
 * @param {string} iso
 * @returns {string|null} `YYYY-MM-DD`，解析不出来返回 null
 */
export function weekStart(iso) {
  const time = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(time)) return null
  const date = new Date(time)
  // getUTCDay(): 周日是 0。换算成「距本周一几天」：周日要退 6 天。
  const offset = (date.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - offset * DAY_MS)
  return monday.toISOString().slice(0, 10)
}

/** 两个 `YYYY-MM-DD` 之间相差几周（同周返回 0）。 */
function weeksBetween(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`)
  const to = Date.parse(`${toKey}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.round((to - from) / (7 * DAY_MS))
}

/**
 * 按 key 计数并取前 N 名。
 * @param {Map<string, number>} map
 * @param {number} limit
 * @param {(key: string) => object} [decorate] 给每个条目补充额外字段
 */
function topEntries(map, limit, decorate) {
  return [...map.entries()]
    .filter(([key, count]) => key !== '' && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count, ...(decorate ? decorate(key) : {}) }))
}

function bump(map, key, by = 1) {
  const name = String(key ?? '').trim()
  if (name === '') return
  map.set(name, (map.get(name) ?? 0) + by)
}

/**
 * 统计一批论文。
 *
 * @param {object[]} items 全量条目（`state.items`）
 * @param {{
 *   days?: number,
 *   topicId?: string,
 *   now?: number,
 *   topLimit?: number,
 *   sourceLabels?: Record<string, string>,
 * }} [options]
 * @returns {{
 *   windowDays: number,
 *   topicId: string,
 *   total: number,
 *   readCount: number,
 *   starredCount: number,
 *   summarizedCount: number,
 *   weeks: { week: string, count: number }[],
 *   weeklyPeak: number,
 *   bySource: { key: string, label: string, count: number }[],
 *   byVenue: { key: string, count: number }[],
 *   byAuthor: { key: string, count: number }[],
 *   byTopic: { key: string, label: string, count: number }[],
 *   byTag: { key: string, count: number }[],
 * }}
 */
export function computeStats(items, options = {}) {
  const list = Array.isArray(items) ? items.filter((i) => i !== null && typeof i === 'object') : []
  // 注意 Number(null) === 0、Number('') === 0：不先把「没传」挡掉，days 会被夹成 1，
  // 统计窗口就只剩一天（clampInt 在同一处踩过两次）。
  const rawDays =
    options.days === null || options.days === undefined || options.days === '' ? NaN : Number(options.days)
  const days = Number.isFinite(rawDays)
    ? Math.min(MAX_STATS_DAYS, Math.max(1, Math.round(rawDays)))
    : DEFAULT_STATS_DAYS
  const rawTop = options.topLimit
  const topLimit =
    rawTop === null || rawTop === undefined || rawTop === ''
      ? TOP_LIMIT
      : Number.isFinite(Number(rawTop))
        ? Math.max(1, Math.min(50, Math.round(Number(rawTop))))
        : TOP_LIMIT
  const topicId = typeof options.topicId === 'string' ? options.topicId : ''
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const sourceLabels = options.sourceLabels !== null && typeof options.sourceLabels === 'object' ? options.sourceLabels : {}
  const since = now - days * DAY_MS

  const inWindow = list.filter((item) => {
    if (topicId !== '' && item.topicId !== topicId) return false
    const time = Date.parse(String(item.discoveredAt ?? ''))
    // 时间戳坏掉的条目仍算进总数，但不进时间序列 —— 宁可少画一根柱子，
    // 也不要把它塞到「本周」制造假峰值。
    if (!Number.isFinite(time)) return false
    return time >= since && time <= now
  })

  const weekCounts = new Map()
  const bySource = new Map()
  const byVenue = new Map()
  const byAuthor = new Map()
  const byTopic = new Map()
  const topicNames = new Map()
  const byTag = new Map()
  let readCount = 0
  let starredCount = 0
  let summarizedCount = 0

  for (const item of inWindow) {
    if (item.read === true) readCount += 1
    if (item.starred === true) starredCount += 1
    const summary = item.summary
    if (summary !== null && typeof summary === 'object') {
      summarizedCount += 1
      if (Array.isArray(summary.tags)) {
        for (const tag of summary.tags) bump(byTag, tag)
      }
    }
    const week = weekStart(item.discoveredAt)
    if (week !== null) bump(weekCounts, week)
    bump(bySource, item.source)
    bump(byVenue, item.venue)
    if (Array.isArray(item.authors)) {
      for (const author of item.authors) bump(byAuthor, author)
    }
    if (typeof item.topicId === 'string' && item.topicId !== '') {
      bump(byTopic, item.topicId)
      if (typeof item.topicName === 'string' && item.topicName !== '') {
        topicNames.set(item.topicId, item.topicName)
      }
    }
  }

  // 时间序列补齐空周，前端画柱状图时不用再判断断档
  const sortedWeeks = [...weekCounts.keys()].sort()
  const weeks = []
  if (sortedWeeks.length > 0) {
    const first = sortedWeeks[0]
    const last = sortedWeeks[sortedWeeks.length - 1]
    const span = Math.min(weeksBetween(first, last), MAX_STATS_DAYS / 7)
    for (let index = 0; index <= span; index += 1) {
      const key = new Date(Date.parse(`${first}T00:00:00Z`) + index * 7 * DAY_MS).toISOString().slice(0, 10)
      weeks.push({ week: key, count: weekCounts.get(key) ?? 0 })
    }
  }

  return {
    windowDays: days,
    topicId,
    total: inWindow.length,
    readCount,
    starredCount,
    summarizedCount,
    weeks,
    weeklyPeak: weeks.reduce((max, w) => Math.max(max, w.count), 0),
    bySource: topEntries(bySource, topLimit, (key) => ({ label: sourceLabels[key] ?? key })),
    byVenue: topEntries(byVenue, topLimit),
    byAuthor: topEntries(byAuthor, topLimit),
    byTopic: topEntries(byTopic, topLimit, (key) => ({ label: topicNames.get(key) ?? key })),
    byTag: topEntries(byTag, topLimit),
  }
}
