import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrateSeenKey, dedupeKeys } from './dedupe.js'

/**
 * `seen` 去重字典的保留策略：只留最近 180 天、最多 20000 条。
 * 条数上限按「键」算而不是按论文算 —— 每篇论文会写入 1–3 个规范化键
 * （arxiv / doi / 标题+年份），20000 条大约对应 7000–10000 篇论文。
 */
export const SEEN_MAX_AGE_DAYS = 180
export const SEEN_MAX_ENTRIES = 20000

/** 默认设置。任何缺失字段都会在读取时被补齐。 */
export function defaultSettings() {
  return {
    scan: {
      enabled: true,
      intervalHours: 12,
      maxPerTopic: 8,
      summarize: true,
      lookbackDays: 30,
      lastScanAt: null,
      lastScanNew: 0,
    },
    api: {
      mailto: '',
      openalexKey: '',
    },
    mail: {
      enabled: false,
      host: '',
      port: 465,
      secure: true,
      user: '',
      pass: '',
      from: '',
      to: '',
      lastSentAt: null,
    },
    rss: [],
  }
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function asBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** 把字符串（逗号/分号/换行分隔）或数组统一成去空字符串数组。 */
function asStringList(value, max = 30) {
  const list = Array.isArray(value)
    ? value.map((v) => asString(v).trim())
    : asString(value)
        .split(/[,，;；\n]/)
        .map((v) => v.trim())
  const seen = new Set()
  const out = []
  for (const entry of list) {
    if (entry === '') continue
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
    if (out.length >= max) break
  }
  return out
}

const KNOWN_SOURCES = new Set(['openalex', 'crossref', 'pubmed', 'arxiv', 'biorxiv', 'rss'])

/** 语言过滤支持的值。空数组 = 不限语言。 */
export const KNOWN_LANGUAGES = ['zh', 'en']

/**
 * 把用户勾选的语言整理成「下发给数据库的过滤条件」。
 *
 * 语义上「中英文都勾」等价于「不限语言」，所以这里直接折成空数组 ——
 * 否则 OpenAlex 会拼出 `language:zh|en`，反而把德语 / 法语论文排除掉，
 * 比不勾更严格，不符合用户「我全都要」的直觉。
 */
function normalizeLanguages(value) {
  const list = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  const unique = [...new Set(list.map((v) => v.trim().toLowerCase()).filter((v) => KNOWN_LANGUAGES.includes(v)))]
  return unique.length >= KNOWN_LANGUAGES.length ? [] : unique
}

/**
 * 手改 state.json 时可能漏掉 id。用名称生成稳定的 id，
 * 保证同一份文件每次加载得到同一个值，不会让 items 的 topicId 失联。
 */
function deriveTopicId(name) {
  let hash = 5381
  for (let i = 0; i < name.length; i += 1) hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0
  return `t-${(hash >>> 0).toString(36)}`
}

function normalizeTopic(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const name = asString(raw.name).trim()
  if (name === '') return null
  const id = asString(raw.id).trim() || deriveTopicId(name)
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((s) => typeof s === 'string' && KNOWN_SOURCES.has(s))
    : ['openalex']
  return {
    id,
    name,
    keywords: asStringList(raw.keywords, 20),
    authors: asStringList(raw.authors, 20),
    venues: asStringList(raw.venues, 10),
    institutions: asStringList(raw.institutions, 10),
    exclude: asStringList(raw.exclude, 20),
    matchMode: raw.matchMode === 'all' ? 'all' : 'any',
    strict: asBool(raw.strict, true),
    sources: sources.length > 0 ? sources : ['openalex'],
    // 空数组 = 不限语言（老数据没有这个字段，读出来就是「不限」，行为不变）
    languages: normalizeLanguages(raw.languages),
    enabled: asBool(raw.enabled, true),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  }
}

function normalizeItem(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = asString(raw.id).trim()
  if (id === '') return null
  return {
    id,
    topicId: asString(raw.topicId),
    topicName: asString(raw.topicName),
    source: asString(raw.source),
    title: asString(raw.title),
    authors: Array.isArray(raw.authors) ? raw.authors.map((a) => asString(a)) : [],
    publishedAt: asString(raw.publishedAt),
    url: asString(raw.url),
    abstract: asString(raw.abstract),
    venue: asString(raw.venue),
    doi: asString(raw.doi),
    citations: asNumber(raw.citations, 0),
    openAccess: asBool(raw.openAccess, false),
    matchedIn: asString(raw.matchedIn),
    score: asNumber(raw.score, 0),
    summary: raw.summary && typeof raw.summary === 'object' ? raw.summary : null,
    summaryError: asString(raw.summaryError),
    discoveredAt: asString(raw.discoveredAt, new Date().toISOString()),
    read: asBool(raw.read, false),
    starred: asBool(raw.starred, false),
  }
}

/**
 * 清理 `seen` 去重字典（缺陷 #2：以前永不清理，state.json 会无限增长）。
 *
 * 规则：
 *   1. `keepKeys` 里的键永不删除 —— 它们属于仍留在 `items` 里的论文，
 *      删掉的话同一篇论文会被重新推一遍。
 *   2. 超过 `maxAgeDays` 天的记录丢弃（时间戳解析不出来的按最旧处理）。
 *   3. 剩下的按时间戳从新到旧排序，只保留前 `maxEntries` 条。
 *
 * @param {Record<string,string>} seen 原字典（key -> discoveredAt ISO 字符串）
 * @param {{ keepKeys?: Iterable<string>, maxAgeDays?: number, maxEntries?: number, now?: number }} [options]
 * @returns {{ seen: Record<string,string>, removed: number }}
 */
export function pruneSeen(seen, options = {}) {
  const source = seen !== null && typeof seen === 'object' ? seen : {}
  const maxAgeDays = Number.isFinite(Number(options.maxAgeDays)) ? Number(options.maxAgeDays) : SEEN_MAX_AGE_DAYS
  const maxEntries = Number.isFinite(Number(options.maxEntries)) ? Number(options.maxEntries) : SEEN_MAX_ENTRIES
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const keep = new Set()
  if (options.keepKeys !== undefined && options.keepKeys !== null) {
    for (const key of options.keepKeys) keep.add(String(key))
  }

  const cutoff = now - maxAgeDays * 86400000
  const entries = []
  for (const [key, value] of Object.entries(source)) {
    const text = typeof value === 'string' ? value : ''
    const at = Date.parse(text)
    entries.push({ key, value: text, at: Number.isFinite(at) ? at : 0 })
  }
  // 从新到旧，保证「保留最近 N 条」是确定性的
  entries.sort((a, b) => (b.at === a.at ? a.key.localeCompare(b.key) : b.at - a.at))

  const next = {}
  let removed = 0
  let kept = 0
  for (const entry of entries) {
    if (keep.has(entry.key)) {
      next[entry.key] = entry.value
      kept += 1
      continue
    }
    if (entry.at < cutoff || kept >= maxEntries) {
      removed += 1
      continue
    }
    next[entry.key] = entry.value
    kept += 1
  }
  return { seen: next, removed }
}

function normalize(raw) {
  const base = {
    version: 1,
    topics: [],
    items: [],
    seen: {},
    settings: defaultSettings(),
  }
  if (raw === null || typeof raw !== 'object') return base

  base.topics = Array.isArray(raw.topics) ? raw.topics.map(normalizeTopic).filter(Boolean) : []
  base.items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : []

  if (raw.seen !== null && typeof raw.seen === 'object') {
    for (const [key, value] of Object.entries(raw.seen)) {
      // 旧版直接存 item.id（形如 openalex:10.xxx），新版存规范键；
      // 这里迁移成 `id:openalex:10.xxx`，否则升级后历史论文会被重推一遍。
      const migrated = migrateSeenKey(key)
      if (migrated === '') continue
      base.seen[migrated] = asString(value)
    }
  }

  const s = raw.settings !== null && typeof raw.settings === 'object' ? raw.settings : {}
  const d = defaultSettings()
  const scan = s.scan !== null && typeof s.scan === 'object' ? s.scan : {}
  const api = s.api !== null && typeof s.api === 'object' ? s.api : {}
  const mail = s.mail !== null && typeof s.mail === 'object' ? s.mail : {}

  base.settings = {
    scan: {
      enabled: asBool(scan.enabled, d.scan.enabled),
      intervalHours: Math.min(168, Math.max(1, asNumber(scan.intervalHours, d.scan.intervalHours))),
      maxPerTopic: Math.min(30, Math.max(1, asNumber(scan.maxPerTopic, d.scan.maxPerTopic))),
      summarize: asBool(scan.summarize, d.scan.summarize),
      lookbackDays: Math.min(3650, Math.max(1, asNumber(scan.lookbackDays, d.scan.lookbackDays))),
      lastScanAt: typeof scan.lastScanAt === 'string' ? scan.lastScanAt : null,
      lastScanNew: asNumber(scan.lastScanNew, 0),
    },
    api: {
      mailto: asString(api.mailto),
      openalexKey: asString(api.openalexKey),
    },
    mail: {
      enabled: asBool(mail.enabled, d.mail.enabled),
      host: asString(mail.host),
      port: Math.min(65535, Math.max(1, asNumber(mail.port, d.mail.port))),
      secure: asBool(mail.secure, d.mail.secure),
      user: asString(mail.user),
      pass: asString(mail.pass),
      from: asString(mail.from),
      to: asString(mail.to),
      lastSentAt: typeof mail.lastSentAt === 'string' ? mail.lastSentAt : null,
    },
    rss: Array.isArray(s.rss)
      ? s.rss
          .map((u) => asString(u).trim())
          .filter((u) => /^https?:\/\//i.test(u))
          .slice(0, 20)
      : [],
  }

  return base
}

/**
 * 解析 DSH 的 home 目录。Web 进程未必注入 DSH_HOME，因此再退一步用
 * ~/.dsh（Harness 的默认 home），最后才退到系统临时目录。
 */
export function resolveDshHome() {
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    return process.env.DSH_HOME
  }
  try {
    const home = os.homedir()
    if (typeof home === 'string' && home !== '') return path.join(home, '.dsh')
  } catch {
    /* ignore */
  }
  return path.join(os.tmpdir(), 'dsh-home')
}

/**
 * 状态持久化。数据落在 DSH_HOME 下的私有目录里，插件卸载后仍保留。
 */
export function createStore(ctx, config) {
  const baseDir =
    (config !== null && typeof config === 'object' ? asString(config.dataDir) : '') ||
    path.join(resolveDshHome(), 'research-radar')
  const file = path.join(baseDir, 'state.json')

  let state = null
  let loading = null
  let queue = Promise.resolve()

  async function load() {
    if (state !== null) return state
    if (loading !== null) return loading
    loading = (async () => {
      try {
        const raw = await fsp.readFile(file, 'utf8')
        state = normalize(JSON.parse(raw))
      } catch {
        state = normalize(null)
      }
      return state
    })()
    return loading
  }

  async function persist() {
    const snapshot = JSON.stringify(state, null, 2)
    queue = queue.then(async () => {
      await fsp.mkdir(baseDir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await fsp.writeFile(tmp, snapshot, 'utf8')
      await fsp.rename(tmp, file)
    })
    return queue
  }

  /** 按当前 items 做一次 seen 剪枝（就地修改 state）。 */
  function pruneSeenInPlace() {
    const keepKeys = new Set()
    for (const item of state.items) {
      for (const key of dedupeKeys(item)) keepKeys.add(key)
    }
    const result = pruneSeen(state.seen, { keepKeys })
    state.seen = result.seen
    return result.removed
  }

  return {
    path: file,
    load,
    get: () => state,
    pruneSeen: async () => {
      await load()
      const removed = pruneSeenInPlace()
      if (removed > 0) await persist()
      return removed
    },
    async mutate(fn) {
      await load()
      const result = await fn(state)
      // 每次写盘顺带剪枝，避免 seen 无限增长（缺陷 #2）
      pruneSeenInPlace()
      await persist()
      return result
    },
  }
}
