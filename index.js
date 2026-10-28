import { createStore } from './radar/store.js'
import { runScan, buildDigest, resolvePanelUrl, effectiveLookbackDays } from './radar/scan.js'
import { createJournalCache, QUALITY_TIERS, paperQuality } from './radar/quality.js'
import { sendMail, textToHtml, digestToHtml } from './radar/mail.js'
import { SOURCE_LABELS, collectFromSource, shouldSpread } from './radar/sources.js'
import { Config, validateConfig } from './radar/config.js'
import { computeStats } from './radar/stats.js'
import { buildLibrary } from './radar/library.js'
import { normalizeSummaryDepth, summaryDepthOptions } from './radar/summarize.js'
import path from 'node:path'

export const name = 'dsh-research-radar'

export { Config }

export const inject = ['webServer', 'llm', 'tools', 'timer', 'agentDefaultModel']

const API_PREFIX = '/api/dsh-research-radar'
const CLIENT_MARKER = 'x-dsh-research-radar'
const TICK_MS = 5 * 60 * 1000

/* ------------------------------ HTTP 小工具 ------------------------------ */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body, 'utf8'))
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return false
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
}

function readBody(req, limitBytes = 1024 * 512) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function maskMailSettings(mail) {
  return { ...mail, pass: mail.pass === '' ? '' : '********' }
}

/** 把前端传来的字符串（逗号/换行分隔）或数组统一成去空、去重的字符串数组。 */
function toStringList(value, max = 30) {
  const list = Array.isArray(value)
    ? value.map((v) => String(v).trim())
    : String(value ?? '')
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

const KNOWN_SOURCES = new Set(Object.keys(SOURCE_LABELS))

/** 语言过滤支持的值（空数组 = 不限语言）。 */
const KNOWN_LANGUAGES = new Set(['zh', 'en'])

/**
 * 整理方向里的语言白名单。
 * 中英文都选 = 不限语言（折成空数组），这样不会比不选更严格。
 */
function toLanguageList(value) {
  const list = Array.isArray(value) ? value : []
  const unique = [...new Set(list.map((v) => String(v).trim().toLowerCase()).filter((v) => KNOWN_LANGUAGES.has(v)))]
  return unique.length >= KNOWN_LANGUAGES.size ? [] : unique
}

/** `/state` 默认返回多少条论文（缺陷 #6：以前硬截 200 条，更早的再也看不到）。 */
const DEFAULT_ITEM_LIMIT = 50
const MAX_ITEM_LIMIT = 500

/** 条目筛选条件。`high` / `fulltext` 是给「只看值得读的」用的。 */
const ITEM_FILTERS = new Set(['all', 'unread', 'starred', 'high', 'fulltext'])

/**
 * 排序方式：
 *   - `recent`：按发现时间倒序（默认，适合「每天看新到的」）；
 *   - `quality`：按质量分倒序，同分再按发现时间（适合「这周该读哪几篇」）。
 */
const ITEM_SORTS = new Set(['recent', 'quality'])

function clampInt(value, fallback, min, max) {
  // 注意 Number(null) === 0：查询参数缺失时必须走 fallback，否则 limit 会被
  // 夹成 1（踩过一次：/state 不带参数只返回一条论文）。
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * 按筛选条件从全部条目里切出一页。
 *
 * 分页与筛选放在服务端做（而不是像以前那样 `slice(0, 200)` 后让前端全量
 * 过滤），这样论文攒到几千条时面板也不会卡。
 * @param {object[]} all 全部条目（按 discoveredAt 倒序）
 * @param {{ limit?: string|number, offset?: string|number, topicId?: string, filter?: string }} query
 * @returns {{ items: object[], total: number, offset: number, limit: number, hasMore: boolean }}
 */
export function paginateItems(all, query = {}) {
  const source = Array.isArray(all) ? all : []
  const topicId = String(query.topicId ?? '')
  const filter = ITEM_FILTERS.has(String(query.filter ?? '')) ? String(query.filter) : 'all'
  const sort = ITEM_SORTS.has(String(query.sort ?? '')) ? String(query.sort) : 'recent'
  let filtered = source.filter((item) => {
    if (item === null || typeof item !== 'object') return false
    if (topicId !== '' && item.topicId !== topicId) return false
    if (filter === 'unread') return item.read !== true
    if (filter === 'starred') return item.starred === true
    // 「值得读」= 高质量（顶刊 / 高被引 / 开放获取）
    if (filter === 'high') return item.quality?.tier === 'high'
    // 「有全文」= 摘要是基于全文写的（不是只喂了摘要）
    if (filter === 'fulltext') return item.summary?.basis === 'fulltext'
    return true
  })
  if (sort === 'quality') {
    // 复制一份再排 —— store 里的数组顺序是「发现顺序」，seen 剪枝依赖它
    filtered = [...filtered].sort((a, b) => {
      const qa = Number(a?.quality?.score ?? -1)
      const qb = Number(b?.quality?.score ?? -1)
      if (qb !== qa) return qb - qa
      return String(b?.discoveredAt ?? '').localeCompare(String(a?.discoveredAt ?? ''))
    })
  }
  const limit = clampInt(query.limit, DEFAULT_ITEM_LIMIT, 1, MAX_ITEM_LIMIT)
  const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const page = filtered.slice(offset, offset + limit)
  return {
    items: page,
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + page.length < filtered.length,
  }
}

/* --------------------------------- 主逻辑 -------------------------------- */

export function apply(ctx, config) {
  // loader 会先按 Config 校验，但直接 apply（测试 / 老版本 loader）时不会，
  // 这里再兜一次默认值，保证 dataDir / locale 之类总有确定的值。
  const validated = validateConfig(config)
  const pluginConfig =
    'value' in validated && validated.value !== undefined
      ? validated.value
      : config !== null && typeof config === 'object'
        ? config
        : {}
  const store = createStore(ctx, pluginConfig)
  // 期刊指标缓存（影响因子 / h 指数）跟 state.json 放同一个目录
  const journalCache = createJournalCache({ dir: path.dirname(store.path) })
  let scanRunning = false
  let lastError = ''

  /**
   * 给一条论文取质量分。
   *
   * 质量分是后加的功能，升级前入库的论文 `quality` 是 null，面板上会全是「待评估」。
   * 这里用**磁盘上已有的**期刊指标现算一个兜底值（只读、不发网络请求、不写 state）：
   * 老论文的期刊绝大部分在前几轮扫描里已经缓存过，够用；真缺指标的也会在下一次
   * `runScan` 的 `backfillQuality` 里补上并落盘。
   */
  function qualityOf(item, journals) {
    if (item.quality !== null && typeof item.quality === 'object') return item.quality
    return paperQuality(item, { journals })
  }

  /**
   * 组装面板要的状态。`query` 支持 limit / offset / topicId / filter，
   * 不传时按默认第一页返回。
   */
  async function publicState(query = {}) {
    const state = await store.load()
    // 老论文缺 quality 时要用期刊缓存现算，先把缓存读进来（只读一次，失败也不阻断）
    try {
      await journalCache.load()
    } catch {
      /* 缓存读不到就退化成只看被引 */
    }
    const journals = journalCache.asMap()
    const withQuality = state.items.map((item) => {
      const quality = qualityOf(item, journals)
      return quality === item.quality ? item : { ...item, quality }
    })
    const page = paginateItems(withQuality, query)
    // 增量窗口按方向算（radar/scan.js 里 lastScanAt 记在方向上）。面板只需要一个
    // 代表性数字，取所有启用方向里最宽的那个 —— 也就是「这次最多往回看多少天」。
    const enabledTopics = state.topics.filter((t) => t.enabled !== false)
    const windows = enabledTopics.map((t) =>
      effectiveLookbackDays(t.lastScanAt, state.settings.scan.lookbackDays),
    )
    return {
      topics: state.topics,
      items: page.items,
      page: { total: page.total, offset: page.offset, limit: page.limit, hasMore: page.hasMore },
      counts: {
        all: state.items.length,
        unread: state.items.filter((i) => i.read !== true).length,
        starred: state.items.filter((i) => i.starred === true).length,
        // 高质量论文数 —— 面板顶部直接显示「这周有 N 篇值得读」
        highQuality: withQuality.filter((i) => i.quality?.tier === 'high').length,
        fullText: state.items.filter((i) => i.summary?.basis === 'fulltext').length,
      },
      settings: { ...state.settings, mail: maskMailSettings(state.settings.mail) },
      sources: SOURCE_LABELS,
      // 质量档位（面板的筛选与徽章用）
      qualityTiers: QUALITY_TIERS,
      // 解析深度可选档位（面板设置页直接渲染成选择器，带每档的预算说明）
      summaryDepths: summaryDepthOptions(),
      status: {
        scanning: scanRunning,
        lastError,
        storePath: store.path,
        scanIntervalHours: state.settings.scan.intervalHours,
        // 下次扫描实际会用多大的窗口（增量窗口，见 radar/scan.js 的
        // effectiveLookbackDays）。面板把它显示出来，方便确认优化生效。
        effectiveLookbackDays:
          windows.length > 0 ? Math.max(...windows) : effectiveLookbackDays(null, state.settings.scan.lookbackDays),
      },
    }
  }

  async function doScan(options) {
    if (scanRunning) {
      const error = new Error('已有扫描正在进行中')
      error.code = 'busy'
      throw error
    }
    scanRunning = true
    try {
      // 期刊指标（影响因子 / h 指数）缓存 30 天，runScan 里会按本次新抓到的
      // ISSN 再 ensure 一次（老论文的 ISSN 预热不到新抓到的期刊）。
      const result = await runScan(ctx, pluginConfig, store, { ...(options ?? {}), journalCache })
      if (result.errors.length > 0) {
        lastError = result.errors.map((e) => `${e.source}: ${e.message}`).join('; ')
      } else {
        lastError = ''
      }
      return result
    } finally {
      scanRunning = false
    }
  }

  /* --------------------------- 定时扫描（按需 tick） -------------------------- */

  ctx.effect(() =>
    ctx.timer.interval(() => {
      void (async () => {
        try {
          const state = await store.load()
          const scan = state.settings.scan
          if (!scan.enabled) return
          if (state.topics.filter((t) => t.enabled).length === 0) return
          const last = scan.lastScanAt === null ? 0 : Date.parse(scan.lastScanAt)
          const elapsed = Date.now() - (Number.isFinite(last) ? last : 0)
          if (elapsed < scan.intervalHours * 3600 * 1000) return
          await doScan({ reason: 'scheduled' })
        } catch (error) {
          lastError = String(error?.message ?? error)
        }
      })()
    }, TICK_MS),
  )

  /* ------------------------------- HTTP 路由 ------------------------------- */

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        try {
          if (!isLoopbackHost(req.headers.host)) {
            sendJson(res, 403, { error: 'forbidden host' })
            return
          }
          const marker = req.headers[CLIENT_MARKER]
          if (typeof marker !== 'string' || marker === '') {
            sendJson(res, 403, { error: 'missing client marker' })
            return
          }

          const url = new URL(req.url ?? '/', 'http://localhost')
          const action = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '')
          const method = req.method ?? 'GET'

          if (method === 'GET' && action === 'state') {
            sendJson(
              res,
              200,
              await publicState({
                limit: url.searchParams.get('limit'),
                offset: url.searchParams.get('offset'),
                topicId: url.searchParams.get('topicId') ?? '',
                filter: url.searchParams.get('filter') ?? '',
                sort: url.searchParams.get('sort') ?? '',
              }),
            )
            return
          }

          if (method === 'GET' && action === 'stats') {
            const state = await store.load()
            sendJson(
              res,
              200,
              computeStats(state.items, {
                days: url.searchParams.get('days'),
                topicId: url.searchParams.get('topicId') ?? '',
                sourceLabels: SOURCE_LABELS,
              }),            )
            return
          }

          // 论文库（书架）：把检索到的全部论文按发表年份 / 方向分架。
          // 和 /state 的区别是它不按发现时间分页，而是回答「我手上都有哪些、哪些是老论文」。
          if (method === 'GET' && action === 'library') {
            const state = await store.load()
            const names = new Map(state.topics.map((t) => [t.id, t.name]))
            sendJson(
              res,
              200,
              buildLibrary(state.items, {
                groupBy: url.searchParams.get('groupBy') === 'topic' ? 'topic' : 'year',
                topicId: url.searchParams.get('topicId') ?? '',
                topicLabel: (id) => names.get(id) ?? '',
              }),
            )
            return
          }

          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          if (String(req.headers['content-type'] ?? '').toLowerCase().indexOf('application/json') !== 0) {
            sendJson(res, 415, { error: 'content-type must be application/json' })
            return
          }

          const body = await readBody(req)

          if (action === 'topics') {
            const op = String(body.op ?? '')
            const payload = body.topic ?? {}
            const updated = await store.mutate((state) => {
              if (op === 'delete') {
                const id = String(payload.id ?? '')
                state.topics = state.topics.filter((t) => t.id !== id)
                return state.topics
              }
              if (op === 'upsert') {
                const id = String(payload.id ?? '').trim() || `t-${Date.now().toString(36)}`
                const name = String(payload.name ?? '').trim()
                if (name === '') throw new Error('研究方向名称不能为空')
                const keywords = toStringList(payload.keywords, 20)
                const authors = toStringList(payload.authors, 20)
                const venues = toStringList(payload.venues, 10)
                const institutions = toStringList(payload.institutions, 10)
                const exclude = toStringList(payload.exclude, 20)
                if (
                  keywords.length === 0 &&
                  authors.length === 0 &&
                  venues.length === 0 &&
                  institutions.length === 0
                ) {
                  throw new Error('至少填写关键词 / 作者 / 期刊 / 单位中的一项')
                }
                const sources = Array.isArray(payload.sources)
                  ? payload.sources.filter((s) => typeof s === 'string' && KNOWN_SOURCES.has(s))
                  : ['openalex']
                const finalSources = sources.length > 0 ? sources : ['openalex']
                const languages = toLanguageList(payload.languages)
                const matchMode = payload.matchMode === 'all' ? 'all' : 'any'
                const strict = payload.strict !== false
                const existing = state.topics.find((t) => t.id === id)
                if (existing === undefined) {
                  state.topics.push({
                    id,
                    name,
                    keywords,
                    authors,
                    venues,
                    institutions,
                    exclude,
                    matchMode,
                    strict,
                    sources: finalSources,
                    languages,
                    enabled: payload.enabled !== false,
                    createdAt: new Date().toISOString(),
                    // 空串 = 从没扫过 → 首次扫描用完整窗口（增量窗口见 radar/scan.js）
                    lastScanAt: '',
                  })
                } else {
                  existing.name = name
                  existing.keywords = keywords
                  existing.authors = authors
                  existing.venues = venues
                  existing.institutions = institutions
                  existing.exclude = exclude
                  existing.matchMode = matchMode
                  existing.strict = strict
                  existing.sources = finalSources
                  existing.languages = languages
                  existing.enabled = payload.enabled !== false
                }
                return state.topics
              }
              throw new Error(`未知操作: ${op}`)
            })
            sendJson(res, 200, { ok: true, topics: updated })
            return
          }

          if (action === 'settings') {
            const patch = body.settings ?? {}
            await store.mutate((state) => {
              if (patch.scan !== null && typeof patch.scan === 'object') {
                const scan = patch.scan
                if (typeof scan.enabled === 'boolean') state.settings.scan.enabled = scan.enabled
                if (Number.isFinite(Number(scan.intervalHours))) {
                  state.settings.scan.intervalHours = Math.min(168, Math.max(1, Number(scan.intervalHours)))
                }
                if (Number.isFinite(Number(scan.maxPerTopic))) {
                  state.settings.scan.maxPerTopic = Math.min(50, Math.max(1, Number(scan.maxPerTopic)))
                }
                if (Number.isFinite(Number(scan.lookbackDays))) {
                  state.settings.scan.lookbackDays = Math.min(3650, Math.max(1, Number(scan.lookbackDays)))
                }
                if (typeof scan.summarize === 'boolean') state.settings.scan.summarize = scan.summarize
                // 抓全文再总结（默认开）。关掉能显著加快扫描，但摘要字段会更空。
                if (typeof scan.fullText === 'boolean') state.settings.scan.fullText = scan.fullText
                // 解析深度决定每次摘要烧多少 token，非法值退回默认档
                if (typeof scan.summaryDepth === 'string') {
                  state.settings.scan.summaryDepth = normalizeSummaryDepth(scan.summaryDepth)
                }
              }
              if (patch.api !== null && typeof patch.api === 'object') {
                const api = patch.api
                if (typeof api.mailto === 'string') state.settings.api.mailto = api.mailto.trim()
                if (typeof api.openalexKey === 'string') state.settings.api.openalexKey = api.openalexKey.trim()
              }
              if (patch.mail !== null && typeof patch.mail === 'object') {
                const mail = patch.mail
                if (typeof mail.enabled === 'boolean') state.settings.mail.enabled = mail.enabled
                if (typeof mail.host === 'string') state.settings.mail.host = mail.host.trim()
                if (Number.isFinite(Number(mail.port))) {
                  state.settings.mail.port = Math.min(65535, Math.max(1, Number(mail.port)))
                }
                if (typeof mail.secure === 'boolean') state.settings.mail.secure = mail.secure
                if (typeof mail.user === 'string') state.settings.mail.user = mail.user.trim()
                if (typeof mail.pass === 'string' && mail.pass !== '********') {
                  state.settings.mail.pass = mail.pass
                }
                if (typeof mail.from === 'string') state.settings.mail.from = mail.from.trim()
                if (typeof mail.to === 'string') state.settings.mail.to = mail.to.trim()
              }
              if (Array.isArray(patch.rss)) {
                state.settings.rss = patch.rss
                  .map((u) => String(u).trim())
                  .filter((u) => /^https?:\/\//i.test(u))
                  .slice(0, 20)
              }
            })
            sendJson(res, 200, { ok: true, state: await publicState() })
            return
          }

          if (action === 'preview') {
            // 试检索：不写库、不去重、不生成摘要，只验证「这个方向能不能搜到对的文章」。
            const topic = body.topic ?? {}
            const state = await store.load()
            const max = Math.min(20, Math.max(1, Number(body.max ?? 5) || 5))
            const sources =
              Array.isArray(topic.sources) && topic.sources.length > 0
                ? topic.sources.filter((s) => KNOWN_SOURCES.has(s))
                : ['openalex']
            const lookbackDays = Math.min(
              3650,
              Math.max(1, Number(body.lookbackDays ?? state.settings.scan.lookbackDays) || 30),
            )
            const found = []
            const errors = []
            // 大窗口试检索同样按年份摊开，否则「试检索」看到的和「回溯检索」看到的不是一回事
            const spread = shouldSpread(lookbackDays)
            for (const source of sources) {
              const { items, errors: errs } = await collectFromSource({
                source,
                topic,
                max,
                rss: state.settings.rss,
                api: state.settings.api,
                lookbackDays,
                spread,
              })
              found.push(...items)
              errors.push(...errs)
            }
            found.sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score
              return String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))
            })
            sendJson(res, 200, { ok: true, items: found.slice(0, max * sources.length), errors })
            return
          }

          if (action === 'scan') {
            const topicIds = Array.isArray(body.topicIds) ? body.topicIds.map(String) : undefined
            // lookbackDays 传了就强制用这个窗口（回溯检索：忽略增量窗口，一次捞够）
            const forced = Number(body.lookbackDays)
            const lookbackDays =
              Number.isFinite(forced) && forced > 0 ? Math.min(3650, Math.round(forced)) : undefined
            const result = await doScan({ reason: 'manual', topicIds, lookbackDays })
            sendJson(res, 200, {
              ok: true,
              newCount: result.newItems.length,
              // 本次实际使用的回溯窗口（增量抓取可能比配置值窄），面板会显示出来
              lookbackDays: result.lookbackDays ?? null,
              // 本次用的解析深度（brief / standard / deep），面板会显示出来
              summaryDepth: result.summaryDepth ?? null,
              errors: result.errors,
              mail: result.mail,
              items: result.newItems,
              state: await publicState(),
            })
            return
          }

          if (action === 'item') {
            const id = String(body.id ?? '')
            if (typeof body.read !== 'boolean' && typeof body.starred !== 'boolean') {
              throw new Error('需要提供 read 或 starred 布尔值')
            }
            const updated = await store.mutate((state) => {
              const item = state.items.find((i) => i.id === id)
              if (item === undefined) throw new Error('未找到该论文')
              if (typeof body.read === 'boolean') item.read = body.read
              if (typeof body.starred === 'boolean') item.starred = body.starred
              return { read: item.read === true, starred: item.starred === true }
            })
            sendJson(res, 200, { ok: true, item: { id, ...updated } })
            return
          }

          if (action === 'mark-all-read') {
            const changed = await store.mutate((state) => {
              let count = 0
              for (const item of state.items) {
                if (item.read !== true) {
                  item.read = true
                  count += 1
                }
              }
              return count
            })
            sendJson(res, 200, { ok: true, marked: changed, state: await publicState() })
            return
          }

          if (action === 'clear-items') {
            await store.mutate((state) => {
              state.items = []
            })
            sendJson(res, 200, { ok: true })
            return
          }

          if (action === 'test-mail') {
            const state = await store.load()
            const mail = state.settings.mail
            const recipients = String(mail.to ?? '')
              .split(/[,;\s]+/)
              .filter(Boolean)
            if (recipients.length === 0) throw new Error('请先填写收件人')
            const text = `这是一封来自「研究前沿雷达」的测试邮件。\n\n如果你收到了它，说明 SMTP 配置可用。\n\n发送时间：${new Date().toLocaleString('zh-CN')}`
            const info = await sendMail(mail, {
              to: recipients,
              subject: '[研究前沿雷达] 测试邮件',
              text,
              html: textToHtml(text),
            })
            await store.mutate((draft) => {
              draft.settings.mail.lastSentAt = new Date().toISOString()
            })
            sendJson(res, 200, { ok: true, recipients: info.recipients })
            return
          }

          if (action === 'preview-mail') {
            const state = await store.load()
            const picked = state.items.slice(0, 5)
            const text = buildDigest(picked, state.topics)
            sendJson(res, 200, {
              ok: true,
              text,
              html: digestToHtml(picked, state.topics, { panelUrl: resolvePanelUrl(ctx) }),
            })
            return
          }

          sendJson(res, 404, { error: `未知接口: ${action}` })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    }),
  )

  /* ------------------------------- Agent 工具 ------------------------------ */

  ctx.effect(() =>
    ctx.tools.register({
      name: 'research_radar',
      description:
        '研究前沿雷达：管理用户关注的研究方向，扫描并抓取最新论文，用 LLM 生成结构化摘要（方法/内容/创新点），可发送邮件摘要。研究方向支持多维度检索：keywords（标题/摘要关键词）、authors（作者）、venues（期刊）、institutions（单位）、exclude（排除词），不同维度之间是 AND。action 取值：status（查看配置与最新论文）、list_topics、add_topic（新增/更新方向）、remove_topic、scan（立即扫描，可用 lookbackDays 回溯若干天、summaryDepth 控制解析深度省 token）、send_digest（把已抓取内容发邮件）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'list_topics', 'add_topic', 'remove_topic', 'scan', 'send_digest'],
            description: '要执行的操作',
          },
          name: { type: 'string', description: 'add_topic 时的研究方向名称' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '标题/摘要关键词（短语用英文双引号在源站做精确匹配）',
          },
          authors: { type: 'array', items: { type: 'string' }, description: '关注的作者名' },
          venues: { type: 'array', items: { type: 'string' }, description: '关注的期刊/会议名' },
          institutions: { type: 'array', items: { type: 'string' }, description: '关注的机构/单位' },
          exclude: { type: 'array', items: { type: 'string' }, description: '排除词，命中即丢弃' },
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['openalex', 'crossref', 'pubmed', 'arxiv', 'biorxiv', 'rss'] },
            description: 'add_topic 时使用的订阅源；材料/工程/物理等学科建议 openalex',
          },
          languages: {
            type: 'array',
            items: { type: 'string', enum: ['zh', 'en'] },
            description:
              'add_topic 时的语言过滤：zh（中文文献）/ en（英文文献）。留空或两项都传 = 不限语言',
          },
          topicId: { type: 'string', description: 'remove_topic 时的方向 id 或名称' },
          lookbackDays: {
            type: 'number',
            description:
              'scan 时强制使用的回溯窗口（天，1–3650）。不传则用增量窗口；想回溯捞老论文就传大一点（如 365 或 1095）',
          },
          summaryDepth: {
            type: 'string',
            enum: ['brief', 'standard', 'deep'],
            description:
              'scan 时的解析深度：brief（一句话+创新点，最省 token）/ standard / deep（全字段含局限）。不传用当前设置',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render(_args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        },
      },
      async execute(args) {
        const action = String(args?.action ?? 'status')
        if (action === 'status') {
          const state = await publicState()
          return {
            topics: state.topics.map((t) => ({
              id: t.id,
              name: t.name,
              keywords: t.keywords,
              authors: t.authors,
              venues: t.venues,
              institutions: t.institutions,
              sources: t.sources,
              languages: t.languages ?? [],
            })),
            latest: state.items.slice(0, 5).map((i) => ({
              title: i.title,
              url: i.url,
              venue: i.venue,
              matchedIn: i.matchedIn,
              tldr: i.summary?.tldr ?? null,
              discoveredAt: i.discoveredAt,
            })),
            status: state.status,
          }
        }
        if (action === 'list_topics') {
          const state = await store.load()
          return { topics: state.topics }
        }
        if (action === 'add_topic') {
          const name = String(args?.name ?? '').trim()
          const keywords = toStringList(args?.keywords, 20)
          const authors = toStringList(args?.authors, 20)
          const venues = toStringList(args?.venues, 10)
          const institutions = toStringList(args?.institutions, 10)
          const exclude = toStringList(args?.exclude, 20)
          if (
            name === '' ||
            (keywords.length === 0 && authors.length === 0 && venues.length === 0 && institutions.length === 0)
          ) {
            throw new Error('需要 name，以及 keywords / authors / venues / institutions 中至少一项')
          }
          const sources =
            Array.isArray(args?.sources) && args.sources.length > 0
              ? args.sources.filter((s) => KNOWN_SOURCES.has(s))
              : ['openalex']
          const finalSources = sources.length > 0 ? sources : ['openalex']
          const languages = toLanguageList(args?.languages)
          const topics = await store.mutate((state) => {
            const existing = state.topics.find((t) => t.name === name)
            if (existing !== undefined) {
              existing.keywords = keywords
              existing.authors = authors
              existing.venues = venues
              existing.institutions = institutions
              existing.exclude = exclude
              existing.sources = finalSources
              existing.languages = languages
              existing.enabled = true
              return state.topics
            }
            state.topics.push({
              id: `t-${Date.now().toString(36)}`,
              name,
              keywords,
              authors,
              venues,
              institutions,
              exclude,
              sources: finalSources,
              languages,
              enabled: true,
              createdAt: new Date().toISOString(),
              lastScanAt: '',
            })
            return state.topics
          })
          return { ok: true, topics }
        }
        if (action === 'remove_topic') {
          const id = String(args?.topicId ?? '')
          const topics = await store.mutate((state) => {
            state.topics = state.topics.filter((t) => t.id !== id && t.name !== id)
            return state.topics
          })
          return { ok: true, topics }
        }
        if (action === 'scan') {
          const forced = Number(args?.lookbackDays)
          const lookbackDays =
            Number.isFinite(forced) && forced > 0 ? Math.min(3650, Math.round(forced)) : undefined
          const result = await doScan({
            reason: 'agent',
            lookbackDays,
            summaryDepth: typeof args?.summaryDepth === 'string' ? args.summaryDepth : undefined,
          })
          return {
            ok: true,
            newCount: result.newItems.length,
            lookbackDays: result.lookbackDays ?? null,
            // 本次用的解析深度（brief / standard / deep）
            summaryDepth: result.summaryDepth ?? null,
            errors: result.errors,
            items: result.newItems.map((i) => ({
              title: i.title,
              url: i.url,
              summary: i.summary,
              summaryError: i.summaryError,
            })),
          }
        }
        if (action === 'send_digest') {
          const state = await store.load()
          if (!state.settings.mail.enabled) throw new Error('邮件推送未启用，请先在面板里开启并配置 SMTP')
          const recipients = String(state.settings.mail.to ?? '')
            .split(/[,;\s]+/)
            .filter(Boolean)
          const picked = state.items.slice(0, 10)
          const text = buildDigest(picked, state.topics)
          const info = await sendMail(state.settings.mail, {
            to: recipients,
            subject: '[研究前沿雷达] 摘要汇总',
            text,
            html: digestToHtml(picked, state.topics, { panelUrl: resolvePanelUrl(ctx) }),
          })
          return { ok: true, recipients: info.recipients }
        }
        throw new Error(`未知 action: ${action}`)
      },
    }),
  )

  ctx.logger?.info?.('dsh-research-radar 已加载')
}
