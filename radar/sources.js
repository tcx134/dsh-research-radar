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
    strong: strongKeywords(keywords),
  }
}

/**
 * 「主要关键词」= 多词短语、带连字符，或长度 >= 6 的实词。
 * 短缩写（MR / AI / EMWM）单独出现时歧义太大，不足以判定相关性 ——
 * 只有当它和一个明确词一起被关注时，才把明确词当成真正的检索意图。
 */
function strongKeywords(keywords) {
  return keywords.filter((kw) => kw.includes(' ') || kw.includes('-') || kw.length >= 6)
}

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

function includesPhrase(haystack, phrase) {
  const needle = phrase.toLowerCase()
  if (needle === '') return false
  return haystack.includes(needle)
}

/**
 * 给一条记录算命中信息：哪些维度在标题 / 摘要里命中。
 * 用于 (a) 本地过滤（服务端未过滤的源），(b) 面板上告诉用户「为什么推给我」。
 */
export function scoreItem(item, query) {
  const title = String(item.title ?? '').toLowerCase()
  const abstract = String(item.abstract ?? '').toLowerCase()
  const venue = String(item.venue ?? '').toLowerCase()
  const authors = (Array.isArray(item.authors) ? item.authors : []).join(' ').toLowerCase()

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

/** 排除词命中（标题或摘要）→ 丢弃。 */
function isExcluded(item, query) {
  if (query.exclude.length === 0) return false
  const haystack = `${item.title ?? ''} ${item.abstract ?? ''}`.toLowerCase()
  return query.exclude.some((word) => word !== '' && haystack.includes(word.toLowerCase()))
}

/**
 * 统一的本地后处理：排除词过滤 + 严格相关性判定 + 命中打分 + 排序 + 截断。
 *
 * 相关性判定（strict=true 时）：
 *   - 有主要关键词（多词短语 / 长词）时，必须命中至少一个主要关键词；
 *   - 若方向还配了作者 / 期刊 / 单位，命中这些维度同样算相关（这类维度本身就是强约束）；
 *   - 只有短缩写（MR、AI）命中的结果直接丢弃 —— 这是「搜金属橡胶却推来磁共振」的根因。
 * matchMode='all' 时额外要求所有关键词都命中。
 */
function finalize(items, query, max, localFilter) {
  const seen = new Set()
  const out = []
  const hasStrong = query.strong.length > 0
  const hasFacet = query.authors.length > 0 || query.venues.length > 0 || query.institutions.length > 0
  for (const item of items) {
    if (item === null || typeof item.id !== 'string' || item.id === '') continue
    if (seen.has(item.id)) continue
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
  return out.slice(0, Math.max(1, max))
}

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

export async function fetchOpenAlex({ query, max, api, lookbackDays = 30 }) {
  const venueIds = await resolveVenueIds(query.venues, api)
  if (query.venues.length > 0 && venueIds.length === 0) {
    throw new Error(`期刊名未能在 OpenAlex 中解析：${query.venues.join('、')}`)
  }
  const filter = openAlexFilter(query, venueIds, lookbackDays)
  if (filter === '') throw new Error('研究方向至少要填关键词 / 作者 / 期刊 / 单位之一')
  const perPage = Math.min(100, Math.max(10, max * 4))
  const url =
    'https://api.openalex.org/works?filter=' +
    encodeFilter(filter) +
    `&per-page=${perPage}&sort=publication_date:desc&select=id,doi,title,display_name,publication_date,publication_year,authorships,primary_location,abstract_inverted_index,cited_by_count,open_access,type` +
    mailtoParam(api)
  const payload = JSON.parse(await getText(url))
  const results = Array.isArray(payload?.results) ? payload.results : []
  const items = results.map((work) => {
    const doi = String(work?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '')
    const authors = Array.isArray(work?.authorships)
      ? work.authorships.map((a) => String(a?.author?.display_name ?? '').trim()).filter(Boolean)
      : []
    const venue = String(work?.primary_location?.source?.display_name ?? '')
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
      doi,
      citations: Number.isFinite(work?.cited_by_count) ? work.cited_by_count : 0,
      openAccess: work?.open_access?.is_oa === true,
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
  params.set('rows', String(Math.min(100, Math.max(10, max * 4))))
  params.set('sort', 'published')
  params.set('order', 'desc')
  params.set(
    'select',
    'DOI,title,container-title,published,author,abstract,is-referenced-by-count,URL',
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

export async function fetchPubmed({ query, max }) {
  if (isEmptyQuery(query)) throw new Error('研究方向至少要填关键词 / 作者 / 期刊 / 单位之一')
  const term = pubmedTerm(query)
  const retmax = Math.min(50, Math.max(5, max * 3))
  const searchUrl =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=date' +
    `&retmax=${retmax}&term=${encodeURIComponent(term)}`
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

export async function fetchBiorxiv({ query, max }) {
  // bioRxiv 官方 API 不提供关键词检索，先取最近窗口，再本地过滤。
  const now = new Date()
  const start = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30)
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
  const keywords = query.keywords.map((k) => k.toLowerCase())
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
 * @param {{ source: string, topic: object, max: number, rss: string[], api?: object, lookbackDays?: number }} request
 * @returns {Promise<{ items: object[], errors: {source: string, message: string}[] }>}
 */
export async function collectFromSource({ source, topic, max, rss, api, lookbackDays = 30 }) {
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

  return { items: finalize(items, query, max, LOCAL_FILTER_SOURCES.has(source)), errors }
}
