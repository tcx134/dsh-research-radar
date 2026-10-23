import { collectFromSource, shouldSpread } from './sources.js'
import { summarizePaper, normalizeSummaryDepth } from './summarize.js'
import { sendMail, digestToHtml } from './mail.js'
import { dedupeKeys } from './dedupe.js'

// 论文库上限。这是「书架」的容量，不再是滚动窗口 —— 回溯检索捞回来的老论文
// 必须留得住，否则库永远只有最近几天的货。按实测每篇约 4KB（含结构化摘要），
// 1000 篇约 4MB，state.json 单文件读写仍然很快。
const MAX_ITEMS_KEPT = 1000
const MAX_TOPICS = 20
/** 摘要并发的默认路数。LLM 服务通常有速率限制，别开太大。 */
const SUMMARY_CONCURRENCY = 3
const DAY_MS = 24 * 60 * 60 * 1000
/**
 * 增量窗口的下限（天）。
 *
 * 为什么是 30 而不是 2：这里的窗口是按**出版日期**过滤的，而论文从发表到被
 * OpenAlex / Crossref 收录常有几天到几周的延迟。窗口只有 2–3 天时，一篇
 * 出版日期在 10-20、到 10-25 才进索引的论文，每次扫描的窗口都从「今天往回 3 天」
 * 开始算，永远够不到它 —— **延迟收录的论文会被永久漏掉**。
 *
 * 放宽到 30 天不增加请求数（每页条数由 max*4 决定，与窗口无关），重复抓到的
 * 论文靠 `seen` 去重直接丢掉，代价只是本地多过滤几条。
 */
const MIN_LOOKBACK_DAYS = 30

function nowIso() {
  return new Date().toISOString()
}

/**
 * 本次扫描实际要用多大的时间窗口（缺陷 #1 之外的配额优化）。
 *
 * 配置里的 `scan.lookbackDays`（默认 30 天）是**上限**：距离上次扫描只过了几小时
 * 就没必要再扫 30 天 —— 那样每次都会把同一批论文重新拉一遍，白烧 OpenAlex 的
 * 共享配额（无 key 时全网只有 $0.10/天），然后靠 `seen` 去重全部丢掉。
 *
 * 规则：
 *   - 从没扫过 / 时间戳坏了 / 上次扫描在未来（改过系统时间）→ 用配置值，宁多勿漏；
 *   - 距上次已超过配置值（比如插件停了两周）→ 也用配置值，不无限往前追；
 *   - 否则 → `间隔天数 + MIN_LOOKBACK_DAYS` 的滑动窗口，且不小于 `MIN_LOOKBACK_DAYS`。
 *
 * 下限是 30 天而不是 2 天，原因见 `MIN_LOOKBACK_DAYS` 的注释（收录延迟）。
 *
 * @param {string|null|undefined} lastScanAt ISO 时间串
 * @param {number} configuredDays 配置的 lookbackDays
 * @param {number} [now] 毫秒时间戳，测试用
 * @returns {number} 实际窗口天数（整数，1–3650）
 */
export function effectiveLookbackDays(lastScanAt, configuredDays, now = Date.now()) {
  const raw =
    configuredDays === null || configuredDays === undefined || configuredDays === ''
      ? NaN
      : Number(configuredDays)
  // 上限放到 3650 天（10 年）：用户可以把窗口设成「最近三年」做回溯检索。
  const configured = Number.isFinite(raw) ? Math.min(3650, Math.max(1, Math.round(raw))) : 30
  if (configured <= MIN_LOOKBACK_DAYS) return configured
  const last = Date.parse(String(lastScanAt ?? ''))
  if (!Number.isFinite(last)) return configured
  const gapDays = Math.ceil((now - last) / DAY_MS)
  if (!Number.isFinite(gapDays) || gapDays < 0) return configured
  return Math.min(configured, Math.max(MIN_LOOKBACK_DAYS, gapDays + MIN_LOOKBACK_DAYS))
}

/**
 * 生成「在面板中查看」的带令牌 URL。
 *
 * `connection` 服务不一定在（测试 stub、headless 环境），拿不到就返回空串，
 * 邮件里就不渲染那个按钮 —— 宁可少一个按钮，也不要抛错把整次扫描搞挂。
 * @param {object} ctx
 * @returns {string}
 */
export function resolvePanelUrl(ctx) {
  try {
    if (ctx === null || typeof ctx !== 'object') return ''
    // 用 ctx.get('connection') 而不是 ctx.connection：对象级 inject 会把整个
    // apply 推迟到服务就绪之后（桌面端的注入表是启动时一次性收集的），而
    // ctx.get 拿到的是「当前有没有」这个事实，不需要声明依赖。
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection
    if (connection === null || typeof connection !== 'object') return ''
    if (typeof connection.authenticatedUrl !== 'function') return ''
    const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer
    const port = webServer === null || typeof webServer !== 'object' ? null : webServer.port
    if (port === null || port === undefined || Number(port) <= 0) return ''
    // webServer.protocol 形如 "http:" / "https:"（自带冒号），拼法照抄 host 的
    // `${protocol}//127.0.0.1:${port}`。
    const protocol = typeof webServer.protocol === 'string' && webServer.protocol !== '' ? webServer.protocol : 'http:'
    const url = connection.authenticatedUrl(`${protocol}//127.0.0.1:${String(port)}`)
    return typeof url === 'string' ? url : ''
  } catch {
    return ''
  }
}

function topicLabel(topic) {
  return topic.name || topic.id
}

/**
 * 限流并发：最多 `limit` 个任务同时跑，结果顺序与输入一致。
 * 单个任务抛错不会中断整批 —— 交给 `fn` 自己捕获（摘要是「单篇失败只记
 * summaryError」，不能让一篇挂掉整次扫描）。
 * @template T, R
 * @param {T[]} list
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(list, limit, fn) {
  const items = Array.isArray(list) ? list : []
  const size = Math.max(1, Math.min(Number(limit) || 1, items.length || 1))
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: size }, () => worker()))
  return results
}

/** 单篇摘要：失败重试一次，仍失败就只记 summaryError，不抛。 */
async function summarizeOne(ctx, config, item, topic, depth) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      item.summary = await summarizePaper(ctx, config, item, topic, undefined, depth)
      item.summaryError = ''
      return null
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }
  item.summaryError = String(lastError?.message ?? lastError)
  return item.summaryError
}

/**
 * 从本次抓到的候选里挑出真正要入库的新论文（缺陷 #1 的修复核心）。
 *
 * 同一篇论文会在三个层面重复出现，只按 `item.id` 判重是挡不住的：
 *   1. 跨源：OpenAlex 的 `openalex:10.1016/...` 与 Crossref 的 `crossref:10.1016/...`；
 *   2. 跨方向：两个方向的关键词都命中了同一篇；
 *   3. 跨版本：arXiv 预印本与它后来的期刊版。
 * 所以按规范化键（DOI / arXiv 编号 / 标题+年份）判重，并先按相关度排序再挑，
 * 保证留下的是信息最全的那条（OpenAlex 带引用数与开放获取标记）。
 *
 * @param {{ keys: string[], item: object }[]} candidates
 * @param {Record<string, string>} [seen] 历史已推送过的键
 * @returns {object[]} 按相关度降序的新论文
 */
export function selectFresh(candidates, seen = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) => candidate !== null && typeof candidate === 'object' && candidate.item !== null && typeof candidate.item === 'object',
  )
  list.sort((a, b) => {
    if (b.item.score !== a.item.score) return b.item.score - a.item.score
    return String(b.item.publishedAt ?? '').localeCompare(String(a.item.publishedAt ?? ''))
  })
  const known = seen !== null && typeof seen === 'object' ? seen : {}
  const claimed = new Set()
  const fresh = []
  for (const candidate of list) {
    const keys = Array.isArray(candidate.keys) ? candidate.keys : dedupeKeys(candidate.item)
    if (keys.length === 0) continue
    if (keys.some((key) => Object.prototype.hasOwnProperty.call(known, key))) continue
    if (keys.some((key) => claimed.has(key))) continue
    for (const key of keys) claimed.add(key)
    fresh.push(candidate.item)
  }
  return fresh
}

/**
 * 组织一封摘要邮件正文。
 */
export function buildDigest(items, topics) {
  const byTopic = new Map()
  for (const item of items) {
    const key = item.topicId || 'unknown'
    if (!byTopic.has(key)) byTopic.set(key, [])
    byTopic.get(key).push(item)
  }
  const topicNames = new Map(topics.map((t) => [t.id, topicLabel(t)]))
  const lines = []
  lines.push(`本次共发现 ${items.length} 篇新论文。`)
  lines.push('')

  for (const [topicId, group] of byTopic) {
    lines.push(`■ ${topicNames.get(topicId) ?? topicId}（${group.length} 篇）`)
    lines.push('')
    for (const item of group) {
      lines.push(`· ${item.title}`)
      const meta = [item.venue, item.source, item.publishedAt ? item.publishedAt.slice(0, 10) : '']
        .filter(Boolean)
        .join(' · ')
      if (meta !== '') lines.push(`  ${meta}`)
      if (item.authors.length > 0) lines.push(`  作者：${item.authors.slice(0, 6).join(', ')}`)
      if (item.matchedIn) lines.push(`  命中：${item.matchedIn}`)
      lines.push(`  链接：${item.url}`)
      const s = item.summary
      if (s !== null && typeof s === 'object') {
        if (s.tldr) lines.push(`  一句话：${s.tldr}`)
        if (s.problem) lines.push(`  问题：${s.problem}`)
        if (s.method) lines.push(`  方法：${s.method}`)
        if (s.findings) lines.push(`  内容与结论：${s.findings}`)
        if (s.innovation) lines.push(`  创新点：${s.innovation}`)
        if (s.limitations) lines.push(`  局限：${s.limitations}`)
        if (s.relevance) lines.push(`  相关性：${s.relevance}`)
        if (Array.isArray(s.tags) && s.tags.length > 0) lines.push(`  标签：${s.tags.join('、')}`)
      } else if (item.summaryError) {
        lines.push(`  （摘要生成失败：${item.summaryError}）`)
        if (item.abstract) lines.push(`  原始摘要：${item.abstract.slice(0, 800)}`)
      } else if (item.abstract) {
        lines.push(`  摘要：${item.abstract.slice(0, 800)}`)
      }
      lines.push('')
    }
  }
  lines.push('—— 由 DSH 研究前沿雷达自动生成')
  return lines.join('\n')
}

/**
 * 执行一次扫描。
 * @param {object} ctx Harness host context
 * @param {object} config 插件配置
 * @param {object} store createStore 返回的 store
 * @param {{ topicIds?: string[], reason?: string }} options
 */
export async function runScan(ctx, config, store, options = {}) {
  const startedAt = nowIso()
  const state = await store.load()
  const settings = state.settings
  const requested = Array.isArray(options.topicIds) ? options.topicIds : null

  const targets = state.topics
    .filter((t) => t.enabled)
    .filter((t) => requested === null || requested.includes(t.id))
    .slice(0, MAX_TOPICS)

  const result = {
    startedAt,
    finishedAt: null,
    reason: options.reason ?? 'manual',
    scannedTopics: [],
    newItems: [],
    errors: [],
    mail: null,
    /** 本次实际使用的抓取窗口（天），下面会按上次扫描时间算出来。 */
    lookbackDays: null,
    /** 本次摘要用的解析深度（brief / standard / deep）。 */
    summaryDepth: null,
  }

  if (targets.length === 0) {
    result.finishedAt = nowIso()
    result.errors.push({ source: 'topics', message: '没有启用的研究方向，请先在面板里添加' })
    return result
  }

  /**
   * 本次扫描实际使用的时间窗口。上一次扫描之后只过了几小时的话，没必要再扫
   * 30 天 —— 那些论文全在 `seen` 里，重扫只是白烧配额。规则见
   * `effectiveLookbackDays()`。`options.lookbackDays` 可强制指定（测试用）。
   *
   * **按方向各算一份**：`lastScanAt` 记在方向上，所以刚新建的方向没有历史，
   * 首次扫描必须用完整的配置窗口（否则「刚加的方向只能看到最近 2 天」）。
   * `result.lookbackDays` 取所有方向里的最大值，只用于对外报告。
   */
  const configuredLookback = settings.scan.lookbackDays
  const forcedLookback =
    Number.isFinite(Number(options.lookbackDays)) && Number(options.lookbackDays) > 0
      ? Math.round(Number(options.lookbackDays))
      : null
  const lookbackFor = (topic) =>
    forcedLookback ?? effectiveLookbackDays(topic.lastScanAt, configuredLookback)

  /**
   * 本次扫描抓到的全部候选（尚未去重）。同一篇论文可能被多个源、多个方向各抓
   * 一次，先都收进来，再按 score 从高到低挑代表 —— 这样留下的是信息最全的那条
   * （OpenAlex 带引用数和开放获取标记，通常比 Crossref 那条更好）。
   * @type {{ item: object, keys: string[] }[]}
   */
  const candidates = []
  const scannedTopicIds = []
  const usedLookbacks = []
  for (const topic of targets) {
    const topicLookback = lookbackFor(topic)
    usedLookbacks.push(topicLookback)
    result.scannedTopics.push({ id: topic.id, name: topicLabel(topic), lookbackDays: topicLookback })
    scannedTopicIds.push(topic.id)
    for (const source of topic.sources) {
      const { items, errors } = await collectFromSource({
        source,
        topic,
        max: settings.scan.maxPerTopic,
        rss: settings.rss,
        api: settings.api,
        lookbackDays: topicLookback,
        // 大窗口按年份摊开配额，否则 max 条全被最近几天占满，用户选了「3 年」
        // 看到的还是上周的论文。判断依据是实际窗口而不是「是不是回溯」——
        // 新方向首次扫描用的是完整配置窗口（可能 3 年），同样需要摊开。
        spread: shouldSpread(topicLookback),
      })
      for (const error of errors) {
        result.errors.push({ topic: topicLabel(topic), ...error })
      }
      for (const raw of items) {
        if (raw === null || typeof raw.id !== 'string' || raw.id === '') continue
        // 跨源去重（缺陷 #1）：同一篇论文在不同库里 id 不同，必须按 DOI /
        // arXiv 编号 / 规范化标题+年份 判重，否则面板和邮件里会重复出现。
        const keys = dedupeKeys(raw)
        if (keys.length === 0) continue
        if (keys.some((key) => Object.prototype.hasOwnProperty.call(state.seen, key))) continue
        candidates.push({
          keys,
          item: {
            ...raw,
            topicId: topic.id,
            topicName: topicLabel(topic),
            discoveredAt: nowIso(),
            read: false,
            summary: null,
            summaryError: '',
          },
        })
      }
    }
  }

  // 相关度从高到低排序 + 按规范化键去重，挑出真正要入库的新论文
  const fresh = selectFresh(candidates, state.seen)
  // 对外报告用最宽的那个窗口（各方向可能不同：新方向 30 天，老方向 3 天）
  result.lookbackDays = usedLookbacks.length > 0 ? Math.max(...usedLookbacks) : null

  // 逐篇生成结构化摘要（限流并发；失败不阻断其它论文，单篇最多重试一次）
  // 解析深度决定字段数、摘要截断长度和输出上限，直接关系到每次扫描烧多少 token
  // options.summaryDepth 可临时覆盖设置（Agent 一次性精读某批论文时用）
  const depth = normalizeSummaryDepth(options.summaryDepth ?? settings.scan.summaryDepth)
  result.summaryDepth = depth
  if (settings.scan.summarize && fresh.length > 0) {
    const topicById = new Map(targets.map((t) => [t.id, t]))
    const failures = await mapLimit(fresh, SUMMARY_CONCURRENCY, (item) =>
      summarizeOne(ctx, config, item, topicById.get(item.topicId) ?? {}, depth),
    )
    for (let index = 0; index < failures.length; index += 1) {
      if (failures[index] === null) continue
      result.errors.push({ topic: fresh[index].topicName, source: 'summary', message: failures[index] })
    }
  }

  await store.mutate((draft) => {
    for (const item of fresh) {
      draft.items.unshift(item)
      // 存全部规范化键（doi / arxiv / 标题+年份 / id），这样下次从另一个源
      // 抓到同一篇论文时，任意一个键命中就能判重。
      for (const key of dedupeKeys(item)) draft.seen[key] = item.discoveredAt
    }
    if (draft.items.length > MAX_ITEMS_KEPT) {
      draft.items = draft.items.slice(0, MAX_ITEMS_KEPT)
    }
    const scannedAt = nowIso()
    // 增量窗口按方向记：刚加的方向下次才收窄，不会因为别的方向扫过就被一起收窄
    for (const topic of draft.topics) {
      if (scannedTopicIds.includes(topic.id)) topic.lastScanAt = scannedAt
    }
    draft.settings.scan.lastScanAt = scannedAt
    draft.settings.scan.lastScanNew = fresh.length
  })

  result.newItems = fresh
  result.finishedAt = nowIso()

  // 邮件推送
  if (settings.mail.enabled && fresh.length > 0) {
    try {
      const locale =
        options.locale === 'en' || options.locale === 'zh'
          ? options.locale
          : config !== null && typeof config === 'object' && config.locale === 'en'
            ? 'en'
            : 'zh'
      const text = buildDigest(fresh, state.topics)
      const html = digestToHtml(fresh, state.topics, {
        panelUrl: resolvePanelUrl(ctx),
        locale,
      })
      const info = await sendMail(settings.mail, {
        to: String(settings.mail.to ?? '')
          .split(/[,;\s]+/)
          .filter(Boolean),
        subject:
          locale === 'en'
            ? `[Research Radar] ${fresh.length} new papers · ${new Date().toISOString().slice(0, 10)}`
            : `[研究前沿雷达] ${fresh.length} 篇新论文 · ${new Date().toLocaleDateString('zh-CN')}`,
        text,
        html,
      })
      result.mail = { ok: true, recipients: info.recipients }
      await store.mutate((draft) => {
        draft.settings.mail.lastSentAt = nowIso()
      })
    } catch (error) {
      result.mail = { ok: false, message: String(error?.message ?? error) }
      result.errors.push({ source: 'mail', message: result.mail.message })
    }
  } else if (settings.mail.enabled) {
    result.mail = { ok: true, skipped: '本次没有新论文' }
  }

  return result
}
