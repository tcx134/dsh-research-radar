/**
 * 全文获取：能拿到全文就别只喂摘要。
 *
 * 为什么值得做：摘要只有 200–300 词，`method` / `findings` / `limitations`
 * 这几个字段靠摘要根本写不出来，模型只能写「摘要未提及」——用户看到的就是
 * 一堆空壳。全文哪怕只截 12000 字，也够把方法、数据、结论讲清楚。
 *
 * 四条路线，按「拿到全文的概率 × 速度」排序：
 *   1. **arXiv** —— `/html/<id>` 是结构化 HTML，最快最干净；
 *   2. **Europe PMC** —— 按 DOI 查 PMCID，再取 `fullTextXML`，生物医学/材料类
 *      开放获取论文覆盖很好，XML 里 `<body>` 就是正文；
 *   3. **OA PDF** —— OpenAlex 的 `best_oa_location.pdf_url`，直接下载 PDF 抽文本；
 *   4. **出版社 PDF** —— 解析 DOI 到落地页，找 `citation_pdf_url` 元数据，或对
 *      已知支持 `/pdf` 后缀的域名直接拼。OpenAlex 的 `pdf_url` 经常是 null，
 *      但出版社页面本身是能下 PDF 的，这条路线覆盖率高（实测 MDPI 有效）。
 *
 * 全部失败就返回 null，调用方回退到摘要 —— 拿不到全文不是错误。
 */

import { inflateSync } from 'node:zlib'

/**
 * 单次全文抓取的总预算（毫秒）。超过就放弃，别把一次扫描拖到十分钟。
 *
 * 这个预算**跨所有路线共享**：`fetchFullText` 会把剩余时间传给每个路线，
 * 时间用光就立刻返回 null。实测一篇拿不到全文的论文，四条路线各卡 25 秒
 * 能把单篇拖到 100 秒以上，所以必须共用一份预算。
 */
export const FULLTEXT_TIMEOUT_MS = 20000

/** PDF 最多下载多大（字节）。超过说明不是正常论文，或者是个合集。 */
const MAX_PDF_BYTES = 12 * 1024 * 1024

/** 提取出来的正文低于这个长度就当失败（多半是扫描件或字体编码 PDF）。 */
const MIN_TEXT_CHARS = 800

/** Europe PMC 的公开 REST 端点。 */
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest'

/**
 * 从 arXiv 的 id / url / doi 里认出 arXiv 编号。
 * 支持 `arxiv:1706.03762`、`https://arxiv.org/abs/1706.03762v7`、
 * `10.48550/arXiv.1706.03762`。
 */
export function arxivIdOf(item) {
  const candidates = [item?.id, item?.url, item?.doi]
  for (const raw of candidates) {
    const text = String(raw ?? '')
    if (text === '') continue
    const abs = /arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/[0-9]{7})(?:v[0-9]+)?/i.exec(text)
    if (abs !== null) return abs[1]
    const prefixed = /arxiv[.:]([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?/i.exec(text)
    if (prefixed !== null) return prefixed[1]
  }
  return ''
}

/** HTML / XML → 纯文本。保留段落边界，去掉脚本样式与多余空白。 */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<math[\s\S]*?<\/math>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|li|h[1-6]|tr|figcaption|caption)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    // 剩下的命名实体（&middot; &ndash; &hellip; 之类）统一清掉，
    // 留着会污染正文可读性检查
    .replace(/&[a-zA-Z][a-zA-Z0-9]{1,10};/g, ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    // 标签替换成空格后，换行后面会残留前导空格（`</p><p>` → `\n Second`），
    // 清掉它，否则按行切段落时每行都带一个空格
    .replace(/ *\n */g, '\n')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

/**
 * 从 Europe PMC 的 `fullTextXML` 里抽正文。
 * 只取 `<body>`，跳过 `<ref-list>`（参考文献列表占一半篇幅，没有信息量）。
 */
export function extractPmcBody(xml) {
  const text = String(xml ?? '')
  const start = text.indexOf('<body')
  if (start === -1) return ''
  const end = text.indexOf('</body>', start)
  const body = end === -1 ? text.slice(start) : text.slice(start, end)
  // 去掉参考文献、致谢、利益冲突等对摘要没有帮助的段落
  const cleaned = body
    .replace(/<ref-list[\s\S]*?<\/ref-list>/gi, ' ')
    .replace(/<back[\s\S]*?<\/back>/gi, ' ')
    .replace(/<ack[\s\S]*?<\/ack>/gi, ' ')
    .replace(/<fn-group[\s\S]*?<\/fn-group>/gi, ' ')
  return htmlToText(cleaned)
}

/**
 * 从 PDF 字节里抽文本。**不依赖任何外部库** —— 只处理最常见的情况：
 * FlateDecode 压缩的 content stream，里面用 `Tj` / `TJ` 操作符画字。
 *
 * 已知限制：字体带自定义编码（CID）的 PDF 会抽出乱码，所以下面有一个
 * 「可读性检查」，乱码直接判失败，回退到摘要。这是有意的取舍：
 * 抽不出干净文本时，宁可不喂全文，也不要喂一堆乱码污染摘要。
 */
export function pdfToText(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return ''

  const pieces = []
  let pos = 0
  while (pos < buf.length) {
    const streamAt = buf.indexOf('stream', pos)
    if (streamAt === -1) break
    const endAt = buf.indexOf('endstream', streamAt)
    if (endAt === -1) break
    let start = streamAt + 6
    if (buf[start] === 0x0d) start += 1
    if (buf[start] === 0x0a) start += 1
    const raw = buf.subarray(start, endAt)
    pos = endAt + 9
    let chunk
    try {
      chunk = inflateSync(raw).toString('latin1')
    } catch {
      // 未压缩的 stream 直接当文本读
      chunk = raw.toString('latin1')
    }
    if (!/\bT[Jj]\b/.test(chunk)) continue
    const parsed = parsePdfContent(chunk)
    if (parsed.trim() !== '') pieces.push(parsed)
  }

  return pieces
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 解析 content stream 里的文本绘制指令，尽量还原成带空格的连续正文。
 *
 * 为什么不能只把所有 `(...)` 串起来：PDF 里单词之间的空格常常不是字符，
 * 而是 `TJ` 数组里的**字距微调**。典型的一行是
 * `[(Received:)-310(27)-250(February)-250(2026)]TJ`
 * 直接把字符串拼起来会得到 `Received:27February2026`（所有空格都没了），
 * 拼进摘要提示词里等于给模型一段没法读的东西。
 *
 * 所以这里按 `TJ` 数组逐元素解析：负数且绝对值较大的调整量（<= -100）
 * 视为词间空格，小的调整量直接忽略；`Td`/`TD`/`T*`/`ET` 视为换行。
 */
function parsePdfContent(stream) {
  const out = []
  let index = 0
  const textRe = /\[((?:\\.|[^\]\\])*)\]\s*TJ|\(((?:\\.|[^)\\])*)\)\s*Tj|(-?[\d.]+)\s+T[dD]|\bT\*|\bET\b/g
  let match
  const decode = (raw) =>
    raw
      .replace(/\\([nrtbf])/g, (_, ch) => ({ n: '\n', r: '\n', t: ' ', b: '', f: '' })[ch] ?? '')
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\(.)/g, '$1')

  while ((match = textRe.exec(stream)) !== null) {
    if (match[1] !== undefined) {
      // TJ 数组：元素是字符串或数字，数字是字距调整
      const inner = match[1]
      const partRe = /\(((?:\\.|[^)\\])*)\)|(-?[\d.]+)/g
      let part
      while ((part = partRe.exec(inner)) !== null) {
        if (part[1] !== undefined) {
          out.push(decode(part[1]))
        } else if (part[2] !== undefined) {
          const adjust = Number(part[2])
          // 大的负调整量是词间空格（-250 / -310 是 PDF 里的常见值）
          if (Number.isFinite(adjust) && adjust <= -100) out.push(' ')
        }
      }
    } else if (match[2] !== undefined) {
      out.push(decode(match[2]))
    } else {
      // 换行类指令
      out.push('\n')
    }
    index += 1
    if (index > 200000) break
  }
  return out.join('')
}

/**
 * 判断抽出来的文本像不像正常英文/中文论文正文。
 * 乱码的特征：字母比例极低、大量替换字符、或者全是没有空格的怪串。
 */
export function looksLikeProse(text) {
  const value = String(text ?? '')
  if (value.length < MIN_TEXT_CHARS) return false
  const letters = (value.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length
  const spaces = (value.match(/\s/g) ?? []).length
  if (letters / value.length < 0.45) return false
  if (spaces / value.length < 0.08) return false
  // 常见英文虚词能出现在正文里，说明不是乱码
  return /\b(the|and|of|to|in|is|we|this|with)\b/i.test(value)
}

/**
 * 去掉正文开头的版权 / 授权 / 致谢等噪声段落。
 *
 * arXiv 的 HTML 版正文第一段常年是「Provided proper attribution is provided,
 * Google hereby grants permission to reproduce the tables and figures…」，
 * 后面还有 arXiv 自己的「Report issue / View PDF」导航条。这些内容占了头部
 * 预算却不含任何论文信息 —— 而 `condenseText` 恰恰把头部当宝贝保下来。
 */
export function stripLeadingBoilerplate(text) {
  const lines = String(text ?? '').split('\n')
  const noise = [
    /^provided proper attribution/i,
    /hereby grants permission to reproduce/i,
    /^copyright\s*(©|\(c\)|\d{4})/i,
    /^©\s*\d{4}/,
    /^all rights reserved/i,
    /^this (article|paper|work) is licensed/i,
    /^creative commons/i,
    /^arxiv:\d{4}\.\d{4,5}/i,
    /^report issue/i,
    /^view pdf/i,
    /^view tex source/i,
    /^back to top/i,
    /^skip to (main )?content/i,
  ]
  let start = 0
  while (start < lines.length) {
    const line = lines[start].trim()
    if (line === '') {
      start += 1
      continue
    }
    if (noise.some((pattern) => pattern.test(line))) {
      start += 1
      continue
    }
    break
  }
  // 一行都没删就原样返回，避免多一次字符串拷贝
  return start === 0 ? String(text ?? '') : lines.slice(start).join('\n')
}

/**
 * 把长正文压到预算内。策略：**保头保尾**。
 *
 * 论文的信息分布很不均匀：开头是引言（问题是什么），结尾是结论（做出了什么），
 * 中间的方法与实验最长但可读性最低。所以按 55% 头 + 45% 尾切，
 * 中间插一句「已省略 N 字」，模型知道这里被截过，不会以为论文没写。
 */
export function condenseText(text, maxChars) {
  const value = stripLeadingBoilerplate(String(text ?? '').trim())
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.round(Number(maxChars)) : 12000
  if (value.length <= limit) return value
  const headChars = Math.round(limit * 0.55)
  const tailChars = limit - headChars
  const head = value.slice(0, headChars)
  const tail = tailChars > 0 ? value.slice(-tailChars) : ''
  const omitted = value.length - head.length - tail.length
  return `${head}\n\n……（正文中段已省略 ${omitted} 字）……\n\n${tail}`
}

/**
 * 出版社站点普遍会拒绝带插件标识的 UA（`dsh-research-radar/1.0` 直接被 403），
 * 所以抓落地页和 PDF 时用一个普通浏览器 UA。这是读公开 OA 全文的必要条件，
 * 不涉及任何绕过登录或付费墙的行为。
 */
/**
 * 浏览器 UA。**版本号要跟着更新**：实测 IOP（`iopscience.iop.org`）对
 * `Chrome/120.0.0.0` 返回 14KB 的拦截页，对 `Chrome/131` 才给 3.6MB 的 PDF ——
 * 同一个 URL、同一份 headers，只差版本号。老 UA 会被当成爬虫。
 */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * 备用 UA。有些站点按 UA 放行，第一个被拦就换一个再试 —— 比单一的「最新 UA
 * 一定行」更耐时间，也不用每次发布都追版本号。
 */
const ALT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

/**
 * 全文抓取专用的取文本函数。
 *
 * 为什么不用 sources.js 里的 `getText`：那个是给检索 API 用的，带 1.1 秒全局
 * 节流 + 30 秒超时 + 4/9/18 秒退避重试。全文抓取面对的是出版社站点，慢和 4xx
 * 都是常态，套那套策略单篇能跑到 60 秒以上（实测 64.5 秒）。这里改成：
 * 硬超时、不重试、不节流 —— 拿不到就算了，回退摘要。
 */
async function getTextFast(url, { timeoutMs = FULLTEXT_TIMEOUT_MS, accept = 'text/html,*/*' } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': BROWSER_UA, accept },
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/** 带超时的 fetch，返回 Buffer；非 2xx 或超限返回 null。 */
async function fetchBinary(url, { timeoutMs = FULLTEXT_TIMEOUT_MS, maxBytes = MAX_PDF_BYTES, accept = 'application/pdf,*/*', userAgent = 'dsh-research-radar/1.0 (full-text reader)' } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': userAgent, accept },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const length = Number(res.headers.get('content-length'))
    if (Number.isFinite(length) && length > maxBytes) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > maxBytes) return null
    return buffer
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 看着像不像一个 PDF（`%PDF` 魔数）。拦截页常以 200 + HTML 返回。 */
function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 4 && buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')
}

/**
 * 下载 PDF，并**确认下到的真的是 PDF**。
 *
 * 两个坑都在这一段里解决：
 * 1. 订阅制 / 反爬的出版社对「像爬虫」的 UA 会返回 **200 + HTML 拦截页**，
 *    状态码是成功的，所以不能只看 `res.ok`，必须验 `%PDF` 魔数。
 * 2. 有的站点按 UA 版本号区别对待（实测 IOP 对 `Chrome/120.0.0.0` 返回
 *    14KB 拦截页、对 `Chrome/131` 返回 3.6MB 正常 PDF）。所以第一个 UA
 *    拿不到 PDF 时换一个再试一次，比死守一个 UA 稳。
 */
async function downloadPdf(url, options = {}) {
  for (const userAgent of [options.userAgent ?? BROWSER_UA, ALT_UA]) {
    const buffer = await fetchBinary(url, { ...options, accept: 'application/pdf,*/*', userAgent })
    if (looksLikePdf(buffer)) return buffer
  }
  return null
}

/** 走 arXiv 的 HTML 全文。 */
async function viaArxiv(item, options) {
  const id = arxivIdOf(item)
  if (id === '') return null
  const html = await getTextFast(`https://arxiv.org/html/${id}`, { accept: 'text/html', timeoutMs: options.timeoutMs })
  if (typeof html !== 'string' || html === '') return null
  // arXiv 的 HTML 版正文在 <article> 里，但页面后面还有页脚导航，
  // 必须按 </article> 截断，否则结论之后会混进版权与「Accessibility」之类的垃圾。
  const start = html.indexOf('<article')
  if (start === -1) return null
  const end = html.indexOf('</article>', start)
  const body = end === -1 ? html.slice(start) : html.slice(start, end)
  const text = htmlToText(body)
  if (!looksLikeProse(text)) return null
  return { text, source: 'arxiv-html', url: `https://arxiv.org/html/${id}`, chars: text.length }
}

/** 走 Europe PMC 的全文 XML。 */
async function viaEuropePmc(item, options) {
  const doi = String(item?.doi ?? '').trim()
  if (doi === '') return null
  let payload
  try {
    const raw = await getTextFast(
      `${EPMC}/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=lite`,
      { accept: 'application/json', timeoutMs: options.timeoutMs },
    )
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  const record = payload?.resultList?.result?.[0]
  const pmcid = String(record?.pmcid ?? '')
  if (!/^PMC\d+$/i.test(pmcid)) return null
  let xml
  try {
    xml = await getTextFast(`${EPMC}/${pmcid}/fullTextXML`, { accept: 'application/xml', timeoutMs: options.timeoutMs })
  } catch {
    return null
  }
  const text = extractPmcBody(xml)
  if (!looksLikeProse(text)) return null
  return { text, source: 'europepmc', url: `https://europepmc.org/article/PMC/${pmcid.slice(3)}`, chars: text.length }
}

/** 走 OpenAlex 给的 OA PDF 地址。 */
async function viaOaPdf(item, options) {
  const pdfUrl = String(item?.oaPdfUrl ?? '').trim()
  if (!/^https?:\/\//i.test(pdfUrl)) return null
  const buffer = await downloadPdf(pdfUrl, options)
  if (buffer === null) return null
  const text = pdfToText(buffer)
  if (!looksLikeProse(text)) return null
  return { text, source: 'oa-pdf', url: pdfUrl, chars: text.length }
}

/**
 * 这些出版社的 OA 文章，落地页地址后面直接接 `/pdf` 就是 PDF 直链。
 * 实测 MDPI 有效（`https://www.mdpi.com/2076-3417/16/6/3047/pdf` → 8MB PDF）。
 * 只列确定支持这种写法的，其余靠落地页里的 `citation_pdf_url` 元数据。
 */
const PDF_SUFFIX_HOSTS = [
  'www.mdpi.com',
  'mdpi.com',
  'www.frontiersin.org',
  'journals.plos.org',
  'www.hindawi.com',
  'onlinelibrary.wiley.com',
  'www.nature.com',
  'link.springer.com',
]

/**
 * 这些是纯订阅制出版社的落地页域名，页面里既没有 `citation_pdf_url`，
 * 也拿不到 PDF。识别到就直接放弃，省掉后面那次必然失败的下载尝试。
 *
 * 注意 Elsevier 的 `linkinghub.elsevier.com` 是所有 `10.1016/*` 的跳转目标，
 * 它返回 200 但页面只有个壳，正文要登录才有 —— 这就是「DOI 是 OA 标记
 * 但实际下不到」的典型情况。
 */
const CLOSED_HOSTS = [
  'linkinghub.elsevier.com',
  'www.sciencedirect.com',
  'ieeexplore.ieee.org',
  'dl.acm.org',
  'pubs.acs.org',
  'www.tandfonline.com',
  'ascelibrary.org',
  'asmedigitalcollection.asme.org',
]

/**
 * 反爬 / 人机验证页的特征。命中就说明「这条路线走不通」，不是「这次失败」——
 * 再试几次也是同一个验证页，只会白烧掉整个预算。
 *
 * 实测 IOP（`iopscience.iop.org`）会 302 到
 * `validate.perfdrive.com/…` 的 Radware Bot Manager Captcha 页，
 * 状态码是 **200**、HTML 有 14KB，看不出任何错误。
 */
const CHALLENGE_PATTERNS = [
  /Radware Bot Manager Captcha/i,
  /validate\.perfdrive\.com/i,
  /cf-browser-verification|cf_chl_opt|Just a moment\.\.\./i,
  /<title>\s*Access Denied/i,
  /captcha/i,
]

/** 页面看起来是不是反爬 / 验证码页。 */
function looksLikeChallenge(finalUrl, html) {
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(finalUrl))) return true
  // 只在 HTML 不长时用内容判断：正常论文落地页有大量正文，不会命中这些词
  if (html.length < 40000 && CHALLENGE_PATTERNS.some((pattern) => pattern.test(html))) return true
  return false
}

/** 把 DOI 解析成出版社落地页地址（跟随跳转后的最终 URL）。失败重试一次。 */
async function resolveDoiLanding(doi, options) {
  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) ? Number(options.timeoutMs) : FULLTEXT_TIMEOUT_MS
  const attempt = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 12000))
    try {
      const res = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml' },
      })
      const finalUrl = res.url
      // 落地页 HTML 顺手拿回来，省一次请求（Elsevier 之类会 200 但只有壳页）
      let html = ''
      try {
        html = await res.text()
      } catch {
        html = ''
      }
      return { finalUrl, html }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const first = await attempt()
  if (first !== null) return first
  // doi.org 对本机网络偶发连不上（实测同一 DOI 有时 5ms 就 fetch failed），
  // 隔一下再试一次能救回相当一部分。
  await new Promise((resolve) => setTimeout(resolve, 1200))
  return attempt()
}

/**
 * 走出版社自己的 PDF：解析 DOI → 落地页 → 找 `citation_pdf_url` 元数据，
 * 或者对已知支持 `/pdf` 后缀的域名直接拼。
 *
 * 这是全文覆盖率最高的一条路：OpenAlex 的 `best_oa_location.pdf_url` 经常是
 * null（只给了 DOI 落地页），但出版社页面本身是能下 PDF 的。
 */
async function viaPublisherPdf(item, options) {
  const doi = String(item?.doi ?? '').trim()
  if (doi === '') return null
  const landing = await resolveDoiLanding(doi, options)
  if (landing === null) return null
  const { finalUrl, html } = landing

  let host = ''
  try {
    host = new URL(finalUrl).host.toLowerCase()
  } catch {
    host = ''
  }
  // 纯订阅制出版社：落地页没有 PDF，别再浪费一次下载
  if (CLOSED_HOSTS.includes(host)) return null
  // 撞上反爬验证页：这条路线对这篇论文就是走不通，别再浪费一次下载
  if (looksLikeChallenge(finalUrl, html)) return null

  // 1) 落地页里的 citation_pdf_url（HighWire / OJS / 大部分期刊平台都有）
  let pdfUrl = ''
  const metaMatch = /<meta[^>]*name=["']citation_pdf_url["'][^>]*content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']citation_pdf_url["']/i.exec(html)
  if (metaMatch !== null) {
    try {
      pdfUrl = new URL(metaMatch[1], finalUrl).toString()
    } catch {
      pdfUrl = ''
    }
  }

  // 2) 已知域名直接拼 `/pdf`
  if (pdfUrl === '' && PDF_SUFFIX_HOSTS.includes(host) && !/\.pdf(\?|$)/i.test(finalUrl)) {
    pdfUrl = `${finalUrl.replace(/\/+$/, '')}/pdf`
  }
  if (!/^https?:\/\//i.test(pdfUrl)) return null

  const buffer = await downloadPdf(pdfUrl, { ...options, userAgent: BROWSER_UA })
  if (buffer === null) return null
  const text = pdfToText(buffer)
  if (!looksLikeProse(text)) return null
  return { text, source: 'publisher-pdf', url: pdfUrl, chars: text.length }
}

/**
 * 抓一篇论文的全文。
 *
 * @param {object} item 论文（用到 doi / id / url / oaPdfUrl）
 * @param {{ routes?: string[], timeoutMs?: number }} [options]
 * @returns {Promise<{text:string, source:string, url:string, chars:number}|null>}
 *   拿不到返回 null（不是错误，调用方回退摘要）
 */
export async function fetchFullText(item, options = {}) {
  const routes = Array.isArray(options.routes) && options.routes.length > 0
    ? options.routes
    : ['arxiv', 'europepmc', 'oa-pdf', 'publisher-pdf']
  const handlers = {
    arxiv: viaArxiv,
    europepmc: viaEuropePmc,
    'oa-pdf': viaOaPdf,
    'publisher-pdf': viaPublisherPdf,
  }
  const totalMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : FULLTEXT_TIMEOUT_MS
  const deadline = Date.now() + totalMs

  for (const route of routes) {
    const handler = handlers[route]
    if (handler === undefined) continue
    const remaining = deadline - Date.now()
    // 剩不到 2 秒就没必要再开一条路线了：连一次 HEAD 都跑不完
    if (remaining < 2000) return null
    const result = await handler(item, { ...options, timeoutMs: remaining })
    if (result !== null) return result
  }
  return null
}
