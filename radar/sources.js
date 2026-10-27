/**
 * 订阅源适配器。
 *
 * 每个源实现 fetchXxx({ query, max, api }) -> Promise<RawItem[]>
 * RawItem = { id, source, title, authors, publishedAt, url, abstract, venue, doi, citations, matchedIn }
 *
 * 结构化查询维度（query）：
 *   keywords[]     标题/摘要关键词（同维度内 OR）
 *   authors[]      作者名（同维度内 OR）
 *   venues[]       期刊 / 会议名（同维度内 OR）
 *   institutions[] 机构 / 单位（同维度内 OR）
 *   exclude[]      排除词（命中即丢弃）
 * 不同维度之间是 AND —— 也就是「作者=Li 且 摘要含 metal rubber 且 期刊类型=journal」。
 */

const UA = 'dsh-research-radar/1.0 (research monitoring; contact: local)'
const TIMEOUT_MS = 30000

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

/** 全局节流：同一进程内两次外网抓取至少间隔 MIN_GAP_MS，避免被上游限流。 */
const MIN_GAP_MS = 1100
let lastRequestAt = 0
let gate = Promise.resolve()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function throttle() {
  const next = gate.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
  })
  gate = next.catch(() => {})
  return next
}

/** 429 / 5xx 是上游限流或抖动，退避重试比直接失败更有用。 */
const RETRYABLE = new Set([429, 500, 502, 503, 504])
const RETRY_DELAYS = [4000, 9000, 18000]

async function getText(url, headers = {}) {
  let lastError
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    await throttle()
    const { signal, done } = withTimeout(TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal,
        headers: {
          'user-agent': UA,
          accept: 'application/atom+xml, application/xml, text/xml, application/json, */*',
          ...headers,
        },
        redirect: 'follow',
      })
      const text = await res.text()
      if (res.ok) return text
      lastError = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
      if (!RETRYABLE.has(res.status) || attempt === RETRY_DELAYS.length) throw lastError
    } catch (error) {
      if (error === lastError) throw error
      lastError = error
      if (attempt === RETRY_DELAYS.length) throw error
    } finally {
      done()
    }
    await sleep(RETRY_DELAYS[attempt])
  }
  throw lastError ?? new Error(`request failed: ${url}`)
}

function decodeXml(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function stripTags(text) {
  return decodeXml(String(text).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function pick(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = re.exec(block)
  return m === null ? '' : decodeXml(m[1]).trim()
}

function pickAll(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  const out = []
  let m
  while ((m = re.exec(block)) !== null) out.push(decodeXml(m[1]).trim())
  return out
}

function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']*)["'][^>]*>`, 'i')
  const m = re.exec(block)
  return m === null ? '' : decodeXml(m[1]).trim()
}

function splitBlocks(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  const out = []
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

function normalizeId(value) {
  return String(value).trim().toLowerCase()
}

/* ------------------------------ 查询规范化 ------------------------------- */

function asList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v !== '')
  if (typeof value === 'string') {
    return value
      .split(/[,，;；\n]/)
      .map((v) => v.trim())
      .filter((v) => v !== '')
  }
  return []
}

export function normalizeQuery(topic) {
  const keywords = asList(topic?.keywords)
  return {
    keywords,
    authors: asList(topic?.authors),
    venues: asList(topic?.venues),
    institutions: asList(topic?.institutions),
    exclude: asList(topic?.exclude),
    // 'any' = 关键词之间是「或」，'all' = 必须同时命中
    matchMode: topic?.matchMode === 'all' ? 'all' : 'any',
    // strict = 只保留命中「主要关键词」的结果，用来压掉 MR 这类短缩写的误命中
    strict: topic?.strict !== false,
    // 语言白名单（zh / en）。空数组 = 不限语言。
    // 中英文都勾在 store 层已折成空数组，这里再兜一次，避免直接传对象绕过。
    languages: normalizeLanguages(asList(topic?.languages)),
    strong: strongKeywords(keywords),
  }
}

const LANGUAGE_NAMES = { zh: '中文', en: '英文' }

/** zh / en 白名单归一化；两个都选等价于不限语言（返回空数组）。 */
function normalizeLanguages(list) {
  const unique = [...new Set(list.map((v) => String(v).trim().toLowerCase()).filter((v) => v === 'zh' || v === 'en'))]
  return unique.length >= 2 ? [] : unique
}

/** 给面板 / 邮件展示用：把语言白名单说成人话。 */
export function describeLanguages(languages) {
  const list = Array.isArray(languages) ? languages : []
  if (list.length === 0) return ''
  return list.map((code) => LANGUAGE_NAMES[code] ?? code).join('、')
}

/**
 * 「主要关键词」= 多词短语、带连字符，或长度 >= 6 的实词。
 * 短缩写（MR / AI / EMWM）单独出现时歧义太大，不足以判定相关性 ——
 * 只有当它和一个明确词一起被关注时，才把明确词当成真正的检索意图。
 */
function strongKeywords(keywords) {
  return keywords.filter((kw) => kw.includes(' ') || kw.includes('-') || kw.length >= 6)
}

/** 供测试使用：主要关键词判定是「金属橡胶 vs 磁共振」的核心逻辑，需要能单测。 */
export { strongKeywords }

export function isEmptyQuery(query) {
  return (
    query.keywords.length === 0 &&
    query.authors.length === 0 &&
    query.venues.length === 0 &&
    query.institutions.length === 0
  )
}

/** 去掉会破坏检索语法的字符，并把内部空白压成单空格。 */
function cleanPhrase(value) {
  return String(value)
    .replace(/["\\:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ------------------------- 命中判定与相关性排序 -------------------------- */

/**
 * 把文本折叠成「可直接做子串比较」的形式：小写 + 各类连字符/下划线/斜杠→空格 + 压空白。
 *
 * 为什么必须折叠：论文标题里 `metal rubber` 经常写成 `metal-rubber`、
 * `Metal–Rubber`（en dash）、`metal_rubber`。原来的字面匹配会把它们全部判成
 * 「没命中主要关键词」，strict 一开就整条丢掉。实测某个方向 50 条候选里有 13 条
 * （26%）是这种变体 —— 这是「检索得太少」最主要的假阴性来源。
 */
function foldText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212_/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesPhrase(haystack, phrase) {
  const needle = foldText(phrase)
  if (needle === '') return false
  return haystack.includes(needle)
}

/**
 * 给一条记录算命中信息：哪些维度在标题 / 摘要里命中。
 * 用于 (a) 本地过滤（服务端未过滤的源），(b) 面板上告诉用户「为什么推给我」。
 *
 * 注意：haystack 每篇只折叠一次（摘要可能有 6000 字，逐关键词折叠太浪费）。
 */
export function scoreItem(item, query) {
  const title = foldText(item.title)
  const abstract = foldText(item.abstract)
  const venue = foldText(item.venue)
  const authors = foldText((Array.isArray(item.authors) ? item.authors : []).join(' '))

  const hit = { title: [], abstract: [], author: [], venue: [] }
  for (const kw of query.keywords) {
    if (includesPhrase(title, kw)) hit.title.push(kw)
    else if (includesPhrase(abstract, kw)) hit.abstract.push(kw)
  }
  for (const name of query.authors) {
    if (includesPhrase(authors, name)) hit.author.push(name)
  }
  for (const name of query.venues) {
    if (includesPhrase(venue, name)) hit.venue.push(name)
  }

  const parts = []
  if (hit.title.length > 0) parts.push(`标题:${hit.title.join('/')}`)
  if (hit.abstract.length > 0) parts.push(`摘要:${hit.abstract.join('/')}`)
  if (hit.author.length > 0) parts.push(`作者:${hit.author.join('/')}`)
  if (hit.venue.length > 0) parts.push(`期刊:${hit.venue.join('/')}`)

  // 「实词命中」= 命中的关键词里至少有一个是主要关键词（多词短语 / 长词）。
  // 只命中 MR、AI 这类短缩写的结果不算真正相关。
  const hitKeywords = [...hit.title, ...hit.abstract]
  const strongHit = hitKeywords.filter((kw) => query.strong.includes(kw))

  let score = 0
  score += hit.title.length * 6
  score += hit.abstract.length * 2
  score += hit.author.length * 4
  score += hit.venue.length * 3
  score += strongHit.length * 4
  if (item.openAccess === true) score += 1

  return { matchedIn: parts.join(' '), score, strongHit, hitKeywords }
}

/**
 * 猜一条记录的语言（zh / en），认不出来返回 ''。
 *
 * 只在源自己不做语言过滤时才用得上（Crossref 没有 language filter，
 * arXiv / bioRxiv / RSS 更是纯本地过滤）。判据很土但够用：
 *   - 标题 / 摘要里中日韩统一表意文字占「有效字符」的比例 >= 20% → 中文；
 *     阈值取 20% 是因为中文期刊的英文标题 + 中文摘要很常见，反过来也常见；
 *   - 有拉丁字母但几乎没有汉字 → 英文；
 *   - 都没有（纯符号 / 纯数字）→ 认不出来，交给「不限语言」放行。
 */
export function detectLanguage(item) {
  const text = `${item?.title ?? ''} ${item?.abstract ?? ''}`
  if (text.trim() === '') return ''
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  const total = cjk + latin
  if (total === 0) return ''
  if (cjk / total >= 0.2) return 'zh'
  if (latin > 0) return 'en'
  return ''
}

/** 语言白名单不匹配 → 丢弃。认不出语言的记录一律放行，宁可多推也不误杀。 */
function isWrongLanguage(item, query) {
  const allow = Array.isArray(query.languages) ? query.languages : []
  if (allow.length === 0) return false
  const guess = detectLanguage(item)
  if (guess === '') return false
  return !allow.includes(guess)
}

/** 排除词命中（标题或摘要）→ 丢弃。同样走折叠，`metal-rubber` 也能被 `metal rubber` 排除。 */
function isExcluded(item, query) {
  if (query.exclude.length === 0) return false
  const haystack = foldText(`${item.title ?? ''} ${item.abstract ?? ''}`)
  return query.exclude.some((word) => includesPhrase(haystack, word))
}

/**
 * 宽窗口下按年份分层取样。
 *
 * 为什么需要：热点方向（实测「perovskite solar cell」三年内 18993 条命中）
 * 如果只按「相关度 + 日期倒序」截断，max 条配额会被最近几天的论文占满 ——
 * 用户把窗口调到 3 年，看到的还是上周的论文，「时间范围选择」形同虚设。
 * 分层轮转保证窗口内每个年份都有代表，年份内部仍按相关度 / 被引 / 日期排序。
 *
 * @param {object[]} items 已打分、已按相关度排序的条目
 * @param {number} max 要保留的条数
 */
export function spreadByYear(items, max) {
  const list = Array.isArray(items) ? items.filter((i) => i !== null && typeof i === 'object') : []
  if (list.length === 0) return []
  const limit = Math.max(1, Math.trunc(Number(max) || 1))
  if (list.length <= limit) return list.slice(0, limit)

  const buckets = new Map()
  for (const item of list) {
    const year = String(item.publishedAt ?? '').slice(0, 4) || '未知'
    if (!buckets.has(year)) buckets.set(year, [])
    buckets.get(year).push(item)
  }
  // 年份从新到旧（'未知' 排最后），同一年里相关度高 → 被引多 → 日期新
  const years = [...buckets.keys()].sort((a, b) => {
    if (a === '未知') return 1
    if (b === '未知') return -1
    return b.localeCompare(a)
  })
  for (const year of years) {
    buckets.get(year).sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0)
      if ((b.citations ?? 0) !== (a.citations ?? 0)) return (b.citations ?? 0) - (a.citations ?? 0)
      return String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))
    })
  }

  const out = []
  for (let round = 0; out.length < limit; round += 1) {
    let picked = false
    for (const year of years) {
      const bucket = buckets.get(year)
      if (round >= bucket.length) continue
      out.push(bucket[round])
      picked = true
      if (out.length >= limit) break
    }
    if (!picked) break
  }
  return out
}

/**
 * 统一的本地后处理：排除词过滤 + 严格相关性判定 + 命中打分 + 排序 + 截断。
 *
 * 相关性判定（strict=true 时）：
 *   - 有主要关键词（多词短语 / 长词）时，必须命中至少一个主要关键词；
 *   - 若方向还配了作者 / 期刊 / 单位，命中这些维度同样算相关（这类维度本身就是强约束）；
 *   - 只有短缩写（MR、AI）命中的结果直接丢弃 —— 这是「搜金属橡胶却推来磁共振」的根因。
 * matchMode='all' 时额外要求所有关键词都命中。
 *
 * `spread=true`（宽窗口回溯）时改用按年份分层取样，避免 max 条配额被最近几天占满。
 */
function finalize(items, query, max, localFilter, spread = false) {
  const seen = new Set()
  const out = []
  const hasStrong = query.strong.length > 0
  const hasFacet = query.authors.length > 0 || query.venues.length > 0 || query.institutions.length > 0
  for (const item of items) {
    if (item === null || typeof item.id !== 'string' || item.id === '') continue
    if (seen.has(item.id)) continue
    if (isWrongLanguage(item, query)) continue
    if (isExcluded(item, query)) continue
    const { matchedIn, score, strongHit, hitKeywords } = scoreItem(item, query)
    if (query.matchMode === 'all' && query.keywords.length > 1) {
      const hitSet = new Set(hitKeywords.map((kw) => kw.toLowerCase()))
      const all = query.keywords.every((kw) => hitSet.has(kw.toLowerCase()))
      if (!all) continue
    }
    if (query.strict && query.keywords.length > 0) {
      const facetHit = matchedIn.includes('作者:') || matchedIn.includes('期刊:')
      if (hasStrong && strongHit.length === 0 && !(hasFacet && facetHit)) continue
      if (!hasStrong && matchedIn === '') continue
    } else if (localFilter && query.keywords.length > 0 && matchedIn === '') {
      continue
    }
    seen.add(item.id)
    out.push({ ...item, matchedIn, score })
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))
  })
  if (spread) return spreadByYear(out, max)
  return out.slice(0, Math.max(1, max))
}

/** 供测试使用：本地过滤 + 严格相关性判定是「推给我的文章不相关」的根因所在。 */
export { finalize, isExcluded }
export { getText, mailtoParam, stripTags, decodeXml }

/* -------------------------------- OpenAlex ------------------------------- */

/** 期刊名 → OpenAlex source id 的缓存（一次扫描里多次用到同一期刊时省请求）。 */
const venueIdCache = new Map()

async function resolveVenueIds(venues, api) {
  const ids = []
  for (const venue of venues) {
    const key = normalizeId(venue)
    if (venueIdCache.has(key)) {
      const cached = venueIdCache.get(key)
      if (cached !== '') ids.push(cached)
      continue
    }
    try {
      const url =
        'https://api.openalex.org/sources?search=' +
        encodeURIComponent(venue) +
        '&per-page=1' +
        mailtoParam(api)
      const payload = JSON.parse(await getText(url))
      const row = Array.isArray(payload?.results) ? payload.results[0] : null
      const id = typeof row?.id === 'string' ? row.id.split('/').pop() : ''
      venueIdCache.set(key, id)
      if (id !== '') ids.push(id)
    } catch {
      venueIdCache.set(key, '')
    }
  }
  return ids
}

function mailtoParam(api) {
  const mail = typeof api?.mailto === 'string' && api.mailto !== '' ? api.mailto : 'radar@example.com'
  const key = typeof api?.openalexKey === 'string' && api.openalexKey !== '' ? api.openalexKey : ''
  return `&mailto=${encodeURIComponent(mail)}${key === '' ? '' : `&api_key=${encodeURIComponent(key)}`}`
}

/**
 * OpenAlex 的 `cited_by_percentile_year` 是 `{min, max}`（有时是数字），
 * 表示「同年同领域被引排在第 X 百分位」。取上限 `max` —— 下限偏保守。
 * 论文太新还没算出来时是 `null`，这时返回 `null` 而不是 0：
 * 「没算出来」和「排位 0」是两回事，后者会把新论文误判成没人看。
 */
function percentileOf(value) {
  if (value === null || typeof value !== 'object') return null
  const max = Number(value.max)
  if (Number.isFinite(max)) return Math.max(0, Math.min(100, max))
  const min = Number(value.min)
  return Number.isFinite(min) ? Math.max(0, Math.min(100, min)) : null
}

/** OpenAlex 的摘要以倒排索引形式返回，这里还原成正常句子。 */
export function invertAbstract(index) {
  if (index === null || typeof index !== 'object') return ''
  const slots = []
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0) slots[pos] = word
    }
  }
  return slots.filter((w) => typeof w === 'string').join(' ')
}

/**
 * 真正下发给数据库的关键词。
 * 有主要关键词时只下发主要关键词 —— 把 MR / AI 这类短缩写一起 OR 进去，
 * 会让磁共振、人工智能的论文占满 max 配额，用户想要的主题反而被挤掉。
 * 短缩写仍然参与本地打分与命中说明，只是不单独作为检索意图。
 */
function serverKeywords(query) {
  return query.strong.length > 0 ? query.strong : query.keywords
}

function openAlexFilter(query, venueIds, lookbackDays) {
  const parts = []
  const keywords = serverKeywords(query)
  if (keywords.length > 0) {
    const terms = keywords.map((kw) => `"${cleanPhrase(kw)}"`).filter((t) => t !== '""')
    if (terms.length > 0) parts.push(`title_and_abstract.search:${terms.join('|')}`)
  }
  if (query.authors.length > 0) {
    const terms = query.authors.map((a) => `"${cleanPhrase(a)}"`).filter((t) => t !== '""')
    if (terms.length > 0) parts.push(`raw_author_name.search:${terms.join('|')}`)
  }
  if (venueIds.length > 0) {
    parts.push(`primary_location.source.id:${venueIds.join('|')}`)
  }
  if (query.institutions.length > 0) {
    const terms = query.institutions.map((i) => `"${cleanPhrase(i)}"`).filter((t) => t !== '""')
    if (terms.length > 0) parts.push(`raw_affiliation_strings.search:${terms.join('|')}`)
  }
  // 语言过滤（P2-10 中文文献）：OpenAlex 有 language 字段，竖线是同维 OR。
  // 实测 language:zh|en 的 count 正好等于 zh + en 之和，说明语法有效。
  if (Array.isArray(query.languages) && query.languages.length > 0) {
    parts.push(`language:${query.languages.join('|')}`)
  }
  const today = new Date().toISOString().slice(0, 10)
  // 上限卡在今天：OpenAlex 里存在出版日期填到未来的脏数据，不卡会一直推「未来论文」。
  parts.push(`to_publication_date:${today}`)
  if (lookbackDays > 0) {
    const from = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10)
    parts.push(`from_publication_date:${from}`)
  }
  return parts.join(',')
}

/**
 * OpenAlex 的 filter 不能整体 encodeURIComponent —— 编码后 `:` 和值里的 `%20`
 * 会被二次转义，服务端解析成空值，count 直接变 0。这里只转义真正会破坏
 * URL 的字符，保留 filter 语法的原貌。
 */
function encodeFilter(filter) {
  return filter.replace(/#/g, '%23').replace(/&/g, '%26').replace(/\+/g, '%2B')
}

/**
 * 窗口超过这个天数就算「宽窗口」。宽窗口下单按时间倒序取样会被最近几天
 * 的论文占满整个配额（实测「钙钛矿太阳能电池」三年内 18993 条命中，
 * 前 32 条全是 10 月 19–20 号的），把窗口调大等于没调。
 */
const WIDE_WINDOW_DAYS = 90

/** 这个窗口要不要按年份摊开配额（回溯 / 试检索大窗口时用）。 */
export function shouldSpread(lookbackDays) {
  const days = Number(lookbackDays)
  return Number.isFinite(days) && days > WIDE_WINDOW_DAYS
}

/** 取一页 OpenAlex works。`sort` 支持 `publication_date:desc` / `cited_by_count:desc`。 */
async function fetchOpenAlexPage({ filter, perPage, sort, api }) {
  const url =
    'https://api.openalex.org/works?filter=' +
    encodeFilter(filter) +
    `&per-page=${perPage}&sort=${sort}&select=id,doi,title,display_name,publication_date,publication_year,authorships,primary_location,abstract_inverted_index,cited_by_count,cited_by_percentile_year,open_access,type` +
    mailtoParam(api)
  const payload = JSON.parse(await getText(url))
  return Array.isArray(payload?.results) ? payload.results : []
}

export async function fetchOpenAlex({ query, max, api, lookbackDays = 30 }) {
  const venueIds = await resolveVenueIds(query.venues, api)
  if (query.venues.length > 0 && venueIds.length === 0) {
    throw new Error(`期刊名未能在 OpenAlex 中解析：${query.venues.join('、')}`)
  }
  const filter = openAlexFilter(query, venueIds, lookbackDays)
  if (filter === '') throw new Error('研究方向至少要填关键词 / 作者 / 期刊 / 单位之一')
  const perPage = Math.min(100, Math.max(10, max * 4))
  // 宽窗口两路取样：一路按时间倒序拿最新的，一路按被引倒序拿窗口内绕不开的经典。
  // 两路合并去重后交给 finalize 打分筛选，既不会只剩「昨天的论文」，
  // 也不会把用户想看的近期工作挤掉（本地打分里时间和相关度都参与排序）。
  // 代价是宽窗口多一次请求，所以只在窗口 > 90 天时才这么做。
  const sorts = shouldSpread(lookbackDays)
    ? ['publication_date:desc', 'cited_by_count:desc']
    : ['publication_date:desc']
  const works = []
  const seenWorkIds = new Set()
  for (const sort of sorts) {
    const page = await fetchOpenAlexPage({ filter, perPage, sort, api })
    for (const work of page) {
      const key = String(work?.id ?? '')
      if (key !== '') {
        if (seenWorkIds.has(key)) continue
        seenWorkIds.add(key)
      }
      works.push(work)
    }
  }
  const results = works
  const items = results.map((work) => {
    const doi = String(work?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '')
    const authors = Array.isArray(work?.authorships)
      ? work.authorships.map((a) => String(a?.author?.display_name ?? '').trim()).filter(Boolean)
      : []
    const venue = String(work?.primary_location?.source?.display_name ?? '')
    // 期刊 ISSN 是查「期刊影响因子 / h 指数」的钥匙，没有它就只能靠标题猜刊名。
    const issn = String(work?.primary_location?.source?.issn_l ?? '')
    // 开放获取论文的 PDF 直链 —— 有了它就能抓全文，而不是只喂摘要。
    const oaPdfUrl = String(work?.best_oa_location?.pdf_url ?? '')
    const id = String(work?.id ?? '').split('/').pop()
    return {
      id: `openalex:${normalizeId(doi !== '' ? doi : id)}`,
      source: 'openalex',
      title: stripTags(work?.title ?? work?.display_name ?? ''),
      authors,
      publishedAt: String(work?.publication_date ?? ''),
      url: doi !== '' ? `https://doi.org/${doi}` : String(work?.id ?? ''),
      abstract: invertAbstract(work?.abstract_inverted_index),
      venue,
      issn,
      doi,
      citations: Number.isFinite(work?.cited_by_count) ? work.cited_by_count : 0,
      // 被引在同年度同领域里的百分位（0–100）。原始被引数在不同学科之间没法比，
      // 百分位可以 —— 工程类被引 10 次可能已是前 5%，生物类 10 次只是中游。
      citationPercentile: percentileOf(work?.cited_by_percentile_year),
      openAccess: work?.open_access?.is_oa === true,
      oaPdfUrl,
    }
  })

  // OpenAlex 约有三分之一的记录没有摘要（版权限制），摘要缺失时回落到
  // Crossref 按 DOI 批量补齐 —— 没有摘要 LLM 就只能瞎猜，摘要质量是这个
  // 插件的核心，所以这一步值得多花一次请求。
  const missing = items.filter((i) => i.abstract === '' && i.doi !== '')
  if (missing.length > 0) {
    try {
      const abstracts = await fetchCrossrefAbstracts(
        missing.map((i) => i.doi),
        api,
      )
      for (const item of items) {
        if (item.abstract !== '') continue
        const filled = abstracts.get(normalizeId(item.doi))
        if (typeof filled === 'string' && filled !== '') item.abstract = filled
      }
    } catch {
      /* 补摘要失败不影响主流程 */
    }
  }

  return items
}

/**
 * 用 Crossref 的批量 DOI 过滤补齐摘要。Crossref 的摘要覆盖率也不高，
 * 但和 OpenAlex 互补，能多捞回一部分。
 * @returns {Promise<Map<string,string>>} doi(小写) -> 纯文本摘要
 */
async function fetchCrossrefAbstracts(dois, api) {
  const out = new Map()
  const unique = [...new Set(dois.map((d) => String(d).trim()).filter(Boolean))].slice(0, 40)
  if (unique.length === 0) return out
  const mail = typeof api?.mailto === 'string' && api.mailto !== '' ? api.mailto : 'radar@example.com'
  const params = new URLSearchParams()
  params.set('filter', unique.map((d) => `doi:${d}`).join(','))
  params.set('select', 'DOI,abstract')
  params.set('rows', String(unique.length))
  params.set('mailto', mail)
  const payload = JSON.parse(await getText(`https://api.crossref.org/works?${params.toString()}`))
  const rows = Array.isArray(payload?.message?.items) ? payload.message.items : []
  for (const row of rows) {
    const doi = normalizeId(row?.DOI ?? '')
    const abstract = stripTags(row?.abstract ?? '')
    if (doi !== '' && abstract !== '') out.set(doi, abstract)
  }
  return out
}

/* -------------------------------- Crossref ------------------------------- */

function crossrefDate(item) {
  const parts = item?.published?.['date-parts']?.[0] ?? item?.issued?.['date-parts']?.[0]
  if (!Array.isArray(parts) || parts.length === 0) return ''
  const [y, m = 1, d = 1] = parts
  if (!Number.isFinite(y)) return ''
  const mm = String(Number(m)).padStart(2, '0')
  const dd = String(Number(d)).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

export async function fetchCrossref({ query, max, api, lookbackDays = 30 }) {
  if (isEmptyQuery(query)) throw new Error('研究方向至少要填关键词 / 作者 / 期刊 / 单位之一')
  const params = new URLSearchParams()
  if (query.keywords.length > 0) params.set('query.bibliographic', serverKeywords(query).join(' '))
  if (query.authors.length > 0) params.set('query.author', query.authors.join(' '))
  if (query.venues.length > 0) params.set('query.container-title', query.venues.join(' '))
  if (query.institutions.length > 0) params.set('query.affiliation', query.institutions.join(' '))
  const filters = ['type:journal-article']
  if (lookbackDays > 0) {
    filters.push(`from-pub-date:${new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10)}`)
  }
  // Crossref 里有把出版日期填到明年的记录，卡一个上限避免推「未来论文」。
  filters.push(`until-pub-date:${new Date().toISOString().slice(0, 10)}`)
  params.set('filter', filters.join(','))
  // 按相关度排序，不按出版日期排序。
  //
  // 为什么：Crossref 的 `query.bibliographic` 是全文模糊匹配，`metal rubber` 会
  // 命中一切含 metal / rubber 的文章（实测 15 万条）。如果再加 `sort=published`
  // 倒序，取回的前 80 条全是最新发表的、和关键词毫不相干的文章，本地 strict
  // 一过滤就剩 0 条 —— 这正是「检索得太少」的第二个根因。
  // 换成默认的相关度排序后，同样 80 条里有 34 条标题真的含 metal rubber。
  // 时间范围由上面的 from-pub-date / until-pub-date filter 保证。
  params.set('rows', String(Math.min(100, Math.max(20, max * 8))))
  params.set(
    'select',
    'DOI,title,container-title,ISSN,published,author,abstract,is-referenced-by-count,URL',
  )
  const mail = typeof api?.mailto === 'string' && api.mailto !== '' ? api.mailto : 'radar@example.com'
  params.set('mailto', mail)
  const payload = JSON.parse(await getText(`https://api.crossref.org/works?${params.toString()}`))
  const rows = Array.isArray(payload?.message?.items) ? payload.message.items : []
  return rows.map((row) => {
    const doi = String(row?.DOI ?? '')
    const authors = Array.isArray(row?.author)
      ? row.author
          .map((a) => [a?.given, a?.family].filter(Boolean).join(' ').trim() || String(a?.name ?? ''))
          .filter(Boolean)
      : []
    return {
      id: `crossref:${normalizeId(doi !== '' ? doi : String(row?.title?.[0] ?? ''))}`,
      source: 'crossref',
      title: stripTags(Array.isArray(row?.title) ? row.title[0] ?? '' : ''),
      authors,
      publishedAt: crossrefDate(row),
      url: doi !== '' ? `https://doi.org/${doi}` : String(row?.URL ?? ''),
      abstract: stripTags(row?.abstract ?? ''),
      venue: String(row?.['container-title']?.[0] ?? ''),
      issn: Array.isArray(row?.ISSN) ? String(row.ISSN[0] ?? '') : String(row?.ISSN ?? ''),
      doi,
      citations: Number.isFinite(row?.['is-referenced-by-count']) ? row['is-referenced-by-count'] : 0,
    }
  })
}

/* --------------------------------- PubMed -------------------------------- */

function pubmedTerm(query) {
  const clauses = []
  const keywords = serverKeywords(query)
  if (keywords.length > 0) {
    clauses.push(`(${keywords.map((kw) => `"${cleanPhrase(kw)}"[tiab]`).join(' OR ')})`)
  }
  if (query.authors.length > 0) {
    clauses.push(`(${query.authors.map((a) => `"${cleanPhrase(a)}"[au]`).join(' OR ')})`)
  }
  if (query.venues.length > 0) {
    clauses.push(`(${query.venues.map((v) => `"${cleanPhrase(v)}"[ta]`).join(' OR ')})`)
  }
  if (query.institutions.length > 0) {
    clauses.push(`(${query.institutions.map((i) => `"${cleanPhrase(i)}"[ad]`).join(' OR ')})`)
  }
  // 语言过滤：PubMed 用 chi[la] / eng[la]，竖线在这里无效，必须显式 OR。
  if (Array.isArray(query.languages) && query.languages.length > 0) {
    const tags = query.languages.map((code) => (code === 'zh' ? 'chi[la]' : 'eng[la]'))
    clauses.push(`(${tags.join(' OR ')})`)
  }
  let term = clauses.join(' AND ')
  if (query.exclude.length > 0) {
    term += ` NOT (${query.exclude.map((w) => `"${cleanPhrase(w)}"[tiab]`).join(' OR ')})`
  }
  return term
}

function pubmedDate(block) {
  const dateBlock = pick(block, 'PubDate')
  if (dateBlock === '') return ''
  const year = Number(pick(dateBlock, 'Year'))
  if (!Number.isFinite(year) || year <= 0) return ''
  const monthName = pick(dateBlock, 'Month')
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  let month = Number(monthName)
  if (!Number.isFinite(month) || month <= 0) {
    const idx = months.indexOf(monthName.slice(0, 3).toLowerCase())
    month = idx >= 0 ? idx + 1 : 1
  }
  const day = Number(pick(dateBlock, 'Day')) || 1
  return `${year}-${String(Math.min(12, Math.max(1, month))).padStart(2, '0')}-${String(Math.min(31, Math.max(1, day))).padStart(2, '0')}`
}

/**
 * PubMed 的出版日期窗口。E-utilities 用 `mindate`/`maxdate` + `datetype=pdat`
 * 表达，格式是 `YYYY/MM/DD`。以前 `fetchPubmed` 完全忽略 `lookbackDays`，
 * 会把几年前的老论文也当成新论文推出来（缺陷 #4）。
 */
function pubmedDateRange(lookbackDays) {
  const days = Number(lookbackDays)
  if (!Number.isFinite(days) || days <= 0) return null
  const fmt = (d) =>
    `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
  const now = new Date()
  // 上限卡今天：PubMed 里也有提前登记出版日期的记录
  return { min: fmt(new Date(now.getTime() - days * 86400000)), max: fmt(now) }
}

export async function fetchPubmed({ query, max, lookbackDays = 30 }) {
  if (isEmptyQuery(query)) throw new Error('研究方向至少要填关键词 / 作者 / 期刊 / 单位之一')
  const term = pubmedTerm(query)
  const retmax = Math.min(50, Math.max(5, max * 3))
  const range = pubmedDateRange(lookbackDays)
  const dateParams =
    range === null
      ? ''
      : `&datetype=pdat&mindate=${encodeURIComponent(range.min)}&maxdate=${encodeURIComponent(range.max)}`
  const searchUrl =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=date' +
    `&retmax=${retmax}&term=${encodeURIComponent(term)}${dateParams}`
  const search = JSON.parse(await getText(searchUrl))
  const ids = Array.isArray(search?.esearchresult?.idlist) ? search.esearchresult.idlist : []
  if (ids.length === 0) return []

  const fetchUrl =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml' +
    `&id=${encodeURIComponent(ids.join(','))}`
  const xml = await getText(fetchUrl)
  const items = []
  for (const block of splitBlocks(xml, 'PubmedArticle')) {
    const pmid = pick(block, 'PMID')
    const title = stripTags(pick(block, 'ArticleTitle'))
    if (pmid === '' || title === '') continue
    const doiMatch = /<ELocationID[^>]*EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/i.exec(block)
    const doiValue = doiMatch !== null ? decodeXml(doiMatch[1]).trim() : ''
    const abstractParts = pickAll(block, 'AbstractText').map((t) => stripTags(t))
    const authors = []
    for (const authorBlock of splitBlocks(block, 'Author')) {
      const name = [pick(authorBlock, 'LastName'), pick(authorBlock, 'ForeName')]
        .map((v) => stripTags(v))
        .filter(Boolean)
        .join(' ')
      if (name !== '') authors.push(name)
    }
    items.push({
      id: `pubmed:${normalizeId(pmid)}`,
      source: 'pubmed',
      title,
      authors,
      publishedAt: pubmedDate(block),
      url: doiValue !== '' ? `https://doi.org/${doiValue}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      abstract: abstractParts.join(' '),
      venue: stripTags(pick(pick(block, 'Journal'), 'Title')),
      doi: doiValue,
    })
  }
  return items
}

/* ---------------------------------- arXiv --------------------------------- */

function arxivQueryFor(query) {
  // arXiv 的检索是布尔匹配，没有相关度排序，所以策略是「宽召回 + 本地严格过滤」：
  // 关键词之间用 OR（用 AND 时多关键词经常直接 0 命中），作者维度再 AND 上去。
  const clauses = []
  const keywordParts = serverKeywords(query)
    .map((kw) => cleanPhrase(kw))
    .filter((kw) => kw !== '')
    .map((kw) => `(ti:"${kw}" OR abs:"${kw}")`)
  if (keywordParts.length > 0) clauses.push(`(${keywordParts.join(' OR ')})`)
  const authorParts = query.authors
    .map((a) => cleanPhrase(a))
    .filter((a) => a !== '')
    .map((a) => `au:"${a}"`)
  if (authorParts.length > 0) clauses.push(`(${authorParts.join(' OR ')})`)
  if (clauses.length === 0) return 'cat:cs.AI'
  return clauses.join(' AND ')
}

function parseArxivFeed(xml) {
  const entries = splitBlocks(xml, 'entry')
  const items = []
  for (const entry of entries) {
    const rawId = pick(entry, 'id')
    const title = stripTags(pick(entry, 'title'))
    if (rawId === '' || title === '') continue
    const absMatch = /abs\/([^/\s]+)/.exec(rawId)
    const key = absMatch === null ? normalizeId(rawId) : normalizeId(absMatch[1])
    const authors = pickAll(entry, 'name').map((n) => stripTags(n)).filter(Boolean)
    const published = pick(entry, 'published') || pick(entry, 'updated')
    const summary = stripTags(pick(entry, 'summary'))
    const linkRe = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i
    const linkMatch = linkRe.exec(entry)
    const url = linkMatch !== null ? decodeXml(linkMatch[1]) : rawId
    items.push({
      id: `arxiv:${key}`,
      source: 'arxiv',
      title,
      authors,
      publishedAt: published,
      url,
      abstract: summary,
      venue: 'arXiv',
    })
  }
  return items
}

export async function fetchArxiv({ query, max }) {
  const search = arxivQueryFor(query)
  const perPage = Math.min(100, Math.max(10, max * 3))
  const url =
    'https://export.arxiv.org/api/query?search_query=' +
    encodeURIComponent(search) +
    `&start=0&max_results=${perPage}&sortBy=submittedDate&sortOrder=descending`
  const xml = await getText(url)
  return parseArxivFeed(xml)
}

/* --------------------------------- bioRxiv -------------------------------- */

export async function fetchBiorxiv({ query, max, lookbackDays = 30 }) {
  // bioRxiv 官方 API 不提供关键词检索，先取最近窗口，再本地过滤。
  // 窗口跟其它源一样走 lookbackDays（之前写死 30 天，增量扫描时白抓一堆旧论文）。
  const days = Number.isFinite(Number(lookbackDays)) && Number(lookbackDays) > 0 ? Math.round(Number(lookbackDays)) : 30
  const now = new Date()
  const start = new Date(now.getTime() - 1000 * 60 * 60 * 24 * Math.min(days, 180))
  const fmt = (d) => d.toISOString().slice(0, 10)
  const url = `https://api.biorxiv.org/details/biorxiv/${fmt(start)}/${fmt(now)}/0/json`
  const text = await getText(url)
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('bioRxiv 返回了非 JSON 内容')
  }
  const collection = Array.isArray(payload.collection) ? payload.collection : []
  return collection.map((row) => {
    const doi = String(row.doi ?? '').trim()
    return {
      id: `biorxiv:${normalizeId(doi || row.title)}`,
      source: 'biorxiv',
      title: stripTags(row.title ?? ''),
      authors: String(row.authors ?? '')
        .split(/[;；]/)
        .map((a) => a.trim())
        .filter(Boolean),
      publishedAt: String(row.date ?? ''),
      url: doi === '' ? 'https://www.biorxiv.org/' : `https://doi.org/${doi}`,
      abstract: stripTags(row.abstract ?? ''),
      venue: 'bioRxiv',
      doi,
    }
  })
}

/* ----------------------------- 通用 RSS / Atom ---------------------------- */

function parseRssFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000))
  const blocks = isAtom ? splitBlocks(xml, 'entry') : splitBlocks(xml, 'item')
  const items = []
  for (const block of blocks) {
    const title = stripTags(pick(block, 'title'))
    if (title === '') continue
    let url = ''
    if (isAtom) {
      const m = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block)
      url = m !== null ? decodeXml(m[1]) : pickAttr(block, 'link', 'href')
    } else {
      url = pick(block, 'link')
    }
    const guid = pick(block, 'guid') || pick(block, 'id') || url || title
    const published =
      pick(block, 'published') || pick(block, 'pubDate') || pick(block, 'updated') || pick(block, 'dc:date')
    const summary =
      stripTags(pick(block, 'description')) ||
      stripTags(pick(block, 'summary')) ||
      stripTags(pick(block, 'content'))
    const author = stripTags(pick(block, 'author') || pick(block, 'dc:creator'))
    items.push({
      id: `rss:${normalizeId(guid)}`,
      source: 'rss',
      title,
      authors: author === '' ? [] : [author],
      publishedAt: published,
      url,
      abstract: summary,
      venue: '',
    })
  }
  return items
}

export async function fetchRss({ feedUrl, query, max }) {
  const xml = await getText(feedUrl)
  const all = parseRssFeed(xml)
  const keywords = query.keywords.map((k) => k.toLowerCase())
  if (keywords.length === 0) return all
  return all.filter((item) => {
    const haystack = `${item.title} ${item.abstract}`.toLowerCase()
    return keywords.some((kw) => kw !== '' && haystack.includes(kw))
  })
}

/* -------------------------------- 调度入口 ------------------------------- */

export const SOURCE_LABELS = {
  openalex: 'OpenAlex（SCI 期刊综合库）',
  crossref: 'Crossref（全学科 DOI）',
  pubmed: 'PubMed（生物医学）',
  arxiv: 'arXiv（预印本）',
  biorxiv: 'bioRxiv（生命科学预印本）',
  rss: 'RSS / Atom 自定义源',
}

/**
 * 这些源在服务端只做「模糊相关度」检索（Crossref 的 query.bibliographic 会把
 * 只是词形相近的论文也返回），必须靠本地命中判定来筛掉不相关的。
 * arXiv / PubMed / OpenAlex 的服务端过滤已经是精确的布尔检索，本地只做排除词。
 */
const LOCAL_FILTER_SOURCES = new Set(['biorxiv', 'rss', 'crossref'])

/**
 * 抓取一个源。
 * `spread=true` 用于宽窗口回溯：把 max 条配额按年份摊开，避免全被最近几天占满。
 * @param {{ source: string, topic: object, max: number, rss: string[], api?: object, lookbackDays?: number, spread?: boolean }} request
 * @returns {Promise<{ items: object[], errors: {source: string, message: string}[] }>}
 */
export async function collectFromSource({
  source,
  topic,
  max,
  rss,
  api,
  lookbackDays = 30,
  spread = false,
}) {
  const errors = []
  const query = normalizeQuery(topic)
  const base = { source, max, api, lookbackDays }
  let items = []

  try {
    if (source === 'openalex') {
      items = await fetchOpenAlex({ ...base, query })
    } else if (source === 'crossref') {
      items = await fetchCrossref({ ...base, query })
    } else if (source === 'pubmed') {
      items = await fetchPubmed({ ...base, query })
    } else if (source === 'arxiv') {
      items = await fetchArxiv({ ...base, query })
    } else if (source === 'biorxiv') {
      items = await fetchBiorxiv({ ...base, query })
    } else if (source === 'rss') {
      const feeds = Array.isArray(rss) ? rss : []
      if (feeds.length === 0) {
        errors.push({ source: 'rss', message: '未配置 RSS 订阅地址' })
      }
      for (const feedUrl of feeds) {
        try {
          const got = await fetchRss({ feedUrl, query, max })
          items = items.concat(got)
        } catch (error) {
          errors.push({ source: `rss:${feedUrl}`, message: String(error?.message ?? error) })
        }
      }
    } else {
      errors.push({ source, message: `未知订阅源: ${source}` })
      return { items: [], errors }
    }
  } catch (error) {
    errors.push({ source, message: String(error?.message ?? error) })
    return { items: [], errors }
  }

  return { items: finalize(items, query, max, LOCAL_FILTER_SOURCES.has(source), spread), errors }
}
