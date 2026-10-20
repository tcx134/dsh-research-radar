import { createStore } from './radar/store.js'
import { runScan, buildDigest } from './radar/scan.js'
import { sendMail, textToHtml } from './radar/mail.js'
import { SOURCE_LABELS, collectFromSource } from './radar/sources.js'

export const name = 'dsh-research-radar'

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

/* --------------------------------- 主逻辑 -------------------------------- */

export function apply(ctx, config) {
  const pluginConfig = config !== null && typeof config === 'object' ? config : {}
  const store = createStore(ctx, pluginConfig)
  let scanRunning = false
  let lastError = ''

  async function publicState() {
    const state = await store.load()
    return {
      topics: state.topics,
      items: state.items.slice(0, 200),
      settings: { ...state.settings, mail: maskMailSettings(state.settings.mail) },
      sources: SOURCE_LABELS,
      status: {
        scanning: scanRunning,
        lastError,
        storePath: store.path,
        scanIntervalHours: state.settings.scan.intervalHours,
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
      const result = await runScan(ctx, pluginConfig, store, options ?? {})
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
            sendJson(res, 200, await publicState())
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
                    enabled: payload.enabled !== false,
                    createdAt: new Date().toISOString(),
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
                  state.settings.scan.maxPerTopic = Math.min(30, Math.max(1, Number(scan.maxPerTopic)))
                }
                if (Number.isFinite(Number(scan.lookbackDays))) {
                  state.settings.scan.lookbackDays = Math.min(3650, Math.max(1, Number(scan.lookbackDays)))
                }
                if (typeof scan.summarize === 'boolean') state.settings.scan.summarize = scan.summarize
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
            for (const source of sources) {
              const { items, errors: errs } = await collectFromSource({
                source,
                topic,
                max,
                rss: state.settings.rss,
                api: state.settings.api,
                lookbackDays,
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
            const result = await doScan({ reason: 'manual', topicIds })
            sendJson(res, 200, {
              ok: true,
              newCount: result.newItems.length,
              errors: result.errors,
              mail: result.mail,
              items: result.newItems,
              state: await publicState(),
            })
            return
          }

          if (action === 'item') {
            const id = String(body.id ?? '')
            await store.mutate((state) => {
              const item = state.items.find((i) => i.id === id)
              if (item === undefined) throw new Error('未找到该论文')
              if (typeof body.read === 'boolean') item.read = body.read
            })
            sendJson(res, 200, { ok: true })
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
            const text = buildDigest(state.items.slice(0, 5), state.topics)
            sendJson(res, 200, { ok: true, text })
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
        '研究前沿雷达：管理用户关注的研究方向，扫描并抓取最新论文，用 LLM 生成结构化摘要（方法/内容/创新点），可发送邮件摘要。研究方向支持多维度检索：keywords（标题/摘要关键词）、authors（作者）、venues（期刊）、institutions（单位）、exclude（排除词），不同维度之间是 AND。action 取值：status（查看配置与最新论文）、list_topics、add_topic（新增/更新方向）、remove_topic、scan（立即扫描）、send_digest（把已抓取内容发邮件）。',
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
          topicId: { type: 'string', description: 'remove_topic 时的方向 id 或名称' },
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
          const topics = await store.mutate((state) => {
            const existing = state.topics.find((t) => t.name === name)
            if (existing !== undefined) {
              existing.keywords = keywords
              existing.authors = authors
              existing.venues = venues
              existing.institutions = institutions
              existing.exclude = exclude
              existing.sources = finalSources
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
              enabled: true,
              createdAt: new Date().toISOString(),
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
          const result = await doScan({ reason: 'agent' })
          return {
            ok: true,
            newCount: result.newItems.length,
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
          const text = buildDigest(state.items.slice(0, 10), state.topics)
          const info = await sendMail(state.settings.mail, {
            to: recipients,
            subject: '[研究前沿雷达] 摘要汇总',
            text,
            html: textToHtml(text),
          })
          return { ok: true, recipients: info.recipients }
        }
        throw new Error(`未知 action: ${action}`)
      },
    }),
  )

  ctx.logger?.info?.('dsh-research-radar 已加载')
}
