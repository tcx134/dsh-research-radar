/**
 * 订阅源适配器。
 * 每个源实现：fetchItems({ keywords, max }) -> Promise<RawItem[]>
 * RawItem = { id, source, title, authors, publishedAt, url, abstract }
 */

const UA = 'dsh-research-radar/1.0 (research monitoring; contact: local)'
const TIMEOUT_MS = 30000

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

/** 全局节流：同一进程内两次外网抓取至少间隔 MIN_GAP_MS，避免被上游限流。 */
const MIN_GAP_MS = 3200
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

/* ---------------------------------- arXiv --------------------------------- */

function arxivQueryFor(keywords) {
  // arXiv API 支持 ti: / abs: 前缀与 AND / OR 组合。
  // 每个关键词同时在标题与摘要中检索，组间用 OR 以扩大召回。
  const parts = keywords.map((kw) => {
    const safe = kw.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
    if (safe === '') return null
    return `(ti:"${safe}" OR abs:"${safe}")`
  })
  const valid = parts.filter(Boolean)
  if (valid.length === 0) return 'cat:cs.AI'
  return valid.join(' OR ')
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
    })
  }
  return items
}

export async function fetchArxiv({ keywords, max }) {
  const query = arxivQueryFor(keywords)
  const perPage = Math.min(100, Math.max(10, max * 3))
  const url =
    'https://export.arxiv.org/api/query?search_query=' +
    encodeURIComponent(query) +
    `&start=0&max_results=${perPage}&sortBy=submittedDate&sortOrder=descending`
  const xml = await getText(url)
  return parseArxivFeed(xml).slice(0, Math.max(1, max))
}

/* --------------------------------- bioRxiv -------------------------------- */

export async function fetchBiorxiv({ keywords, max }) {
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
  const lower = keywords.map((k) => k.toLowerCase())
  const matched = collection.filter((row) => {
    const haystack = `${row.title ?? ''} ${row.abstract ?? ''} ${row.category ?? ''}`.toLowerCase()
    return lower.some((kw) => kw !== '' && haystack.includes(kw))
  })
  return matched.slice(0, Math.max(1, max)).map((row) => {
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
    }
  })
}

/* ----------------------------- 通用 RSS / Atom ---------------------------- */

function parseRssFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000))
  const blocks = isAtom ? splitBlocks(xml, 'entry') : splitBlocks(xml, 'item')
  const items = []
  for (const block of blocks) {
    const title = stripTags(isAtom ? pick(block, 'title') : pick(block, 'title'))
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
    })
  }
  return items
}

export async function fetchRss({ feedUrl, keywords, max }) {
  const xml = await getText(feedUrl)
  const all = parseRssFeed(xml)
  const lower = keywords.map((k) => k.toLowerCase())
  const filtered =
    lower.length === 0
      ? all
      : all.filter((item) => {
          const haystack = `${item.title} ${item.abstract}`.toLowerCase()
          return lower.some((kw) => kw !== '' && haystack.includes(kw))
        })
  return filtered.slice(0, Math.max(1, max))
}

/* -------------------------------- 调度入口 ------------------------------- */

export const SOURCE_LABELS = {
  arxiv: 'arXiv',
  biorxiv: 'bioRxiv',
  rss: 'RSS',
}

/**
 * @param {{ source: string, keywords: string[], max: number, rss: string[] }} request
 * @returns {Promise<{ items: RawItem[], errors: {source: string, message: string}[] }>}
 */
export async function collectFromSource({ source, keywords, max, rss }) {
  const errors = []
  let items = []
  try {
    if (source === 'arxiv') {
      items = await fetchArxiv({ keywords, max })
    } else if (source === 'biorxiv') {
      items = await fetchBiorxiv({ keywords, max })
    } else if (source === 'rss') {
      const feeds = Array.isArray(rss) ? rss : []
      if (feeds.length === 0) {
        errors.push({ source: 'rss', message: '未配置 RSS 订阅地址' })
      }
      for (const feedUrl of feeds) {
        try {
          const got = await fetchRss({ feedUrl, keywords, max })
          items = items.concat(got)
        } catch (error) {
          errors.push({ source: `rss:${feedUrl}`, message: String(error?.message ?? error) })
        }
      }
    } else {
      errors.push({ source, message: `未知订阅源: ${source}` })
    }
  } catch (error) {
    errors.push({ source, message: String(error?.message ?? error) })
  }
  return { items, errors }
}
