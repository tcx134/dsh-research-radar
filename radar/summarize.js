/**
 * 论文结构化摘要：调用 Harness 已配置的 LLM，输出
 * { tldr, problem, method, findings, innovation, limitations, relevance, tags }
 *
 * 解析深度可调（`scan.summaryDepth`）：`brief` 只要一句话+创新点，token 最省；
 * `standard` 是默认档；`deep` 输出全部字段。字段越少，喂进去的摘要也越短。
 */

/**
 * 摘要链路的错误类型。
 *
 * 为什么要单独一类：调用方（scan.js）需要区分「换个时间再试可能会好」
 * 和「再试一万次也一样」，否则只能一律盲重试 —— 既浪费 token（一篇 12000
 * 字全文的输入不便宜），又会让真正的配置问题（比如模型名写错）拖很久。
 *
 * `detail` 保留上游给的原始信息（HTTP 状态码、error code、失败原因），
 * 面板上只显示一行摘要，日志里能查全。
 */
export class SummaryError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SummaryError'
    this.code = String(options.code ?? 'summary-failed')
    this.retryable = options.retryable === true
    this.detail = options.detail === undefined || options.detail === null ? '' : String(options.detail)
  }
}

/** 这些 HTTP 状态码/错误码是瞬时的，重试有意义。 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])
const RETRYABLE_CODES = new Set([
  'rate_limit',
  'rate_limit_exceeded',
  'overloaded',
  'timeout',
  'timed_out',
  'network_error',
  'server_error',
  'unavailable',
  'internal_error',
  'econnreset',
  'etimedout',
  'und_err_connect_timeout',
  'und_err_headers_timeout',
  'und_err_socket',
])

/**
 * 从 `finish` chunk 的 reason 里读出可用的失败信息。
 *
 * `FinishReason` 是 `{ kind: 'stop' } | { kind: 'tool-calls' } | { kind: 'max-tokens' }
 * | { kind: 'aborted', failure } | { kind: 'error', failure }`，
 * `failure` 是 `{ message, code, status?, providerRetryAfterMs?, ... }`。
 * 旧实现只取了 `reason.kind`，于是面板上永远只有一句「LLM 调用未正常结束：error」——
 * 状态码、上游错误码全丢了，这类报错根本没法排查。
 */
export function describeFinish(reason) {
  const kind = reason !== null && typeof reason === 'object' ? String(reason.kind ?? '') : String(reason ?? '')
  const failure = reason !== null && typeof reason === 'object' && reason.failure !== null && typeof reason.failure === 'object' ? reason.failure : null
  if (failure === null) return { kind, message: kind, retryable: false, detail: '' }

  const status = Number(failure.status)
  const code = String(failure.code ?? '')
  const rawMessage = typeof failure.message === 'string' && failure.message.trim() !== '' ? failure.message.trim() : code || kind
  const retryable = (Number.isFinite(status) && RETRYABLE_STATUS.has(status)) || RETRYABLE_CODES.has(code.toLowerCase())
  const bits = []
  if (code !== '') bits.push(code)
  if (Number.isFinite(status) && status > 0) bits.push(`HTTP ${status}`)
  if (Number.isFinite(Number(failure.providerRetryAfterMs))) bits.push(`建议 ${Math.round(Number(failure.providerRetryAfterMs) / 1000)} 秒后重试`)
  return { kind, message: rawMessage, retryable, detail: bits.join(' / ') }
}

/** 解析深度档位，从最省 token 到最详细。 */
export const SUMMARY_DEPTHS = ['brief', 'standard', 'deep']
export const DEFAULT_SUMMARY_DEPTH = 'standard'

/** 每个字段给 LLM 的说明。 */
const FIELD_SPECS = {
  tldr: '   tldr       —— 一句话结论（不超过 60 字）',
  problem: '   problem    —— 论文要解决的问题',
  method: '   method     —— 科研方法/技术路线（核心步骤）',
  findings: '   findings   —— 主要内容与实验结论',
  innovation: '   innovation —— 创新点（相对已有工作的差异）',
  limitations: '   limitations—— 局限或未解决的问题',
  relevance: '   relevance  —— 与用户研究方向的关系（为何值得关注）',
  tags: '   tags       —— 3-6 个主题标签',
}

/**
 * 各档位的字段与预算。`abstractChars` 是喂给模型的摘要截断长度，
 * `maxTokens` 是输出上限 —— 两处一起收窄才真的省 token。
 *
 * `fullTextChars` 是拿到全文时的正文预算。全文比摘要长一个数量级，
 * 但它是唯一能写出 method / findings / limitations 的信息源，所以
 * 即使最省的 brief 档也留 4000 字给全文 —— 只喂 1500 字摘要的话，
 * 「创新点」基本只能靠猜。
 */
const DEPTH_SPECS = {
  brief: {
    fields: ['tldr', 'innovation', 'tags'],
    abstractChars: 1500,
    fullTextChars: 4000,
    maxTokens: 350,
  },
  standard: {
    fields: ['tldr', 'problem', 'method', 'findings', 'innovation', 'relevance', 'tags'],
    abstractChars: 4000,
    fullTextChars: 12000,
    maxTokens: 1000,
  },
  deep: {
    fields: ['tldr', 'problem', 'method', 'findings', 'innovation', 'limitations', 'relevance', 'tags'],
    abstractChars: 6000,
    fullTextChars: 20000,
    maxTokens: 1600,
  },
}

/** 把任意输入归一成合法档位，非法值退回默认档。 */
export function normalizeSummaryDepth(value) {
  if (typeof value !== 'string') return DEFAULT_SUMMARY_DEPTH
  const trimmed = value.trim()
  return SUMMARY_DEPTHS.includes(trimmed) ? trimmed : DEFAULT_SUMMARY_DEPTH
}

/** 取某档位的预算与字段表（返回的是内部对象，只读用）。 */
export function summaryDepthSpec(value) {
  return DEPTH_SPECS[normalizeSummaryDepth(value)]
}

/**
 * 给面板用的档位说明：每档的字段数、摘要截断长度、输出上限，
 * 以及一个粗略的 token 量级（输入按 1 汉字 ≈ 1 token 估，仅用于给用户
 * 一个「精简档大概能省多少」的相对感觉，不是精确计费）。
 */
export function summaryDepthOptions() {
  return SUMMARY_DEPTHS.map((key) => {
    const spec = DEPTH_SPECS[key]
    return {
      key,
      fields: spec.fields.length,
      abstractChars: spec.abstractChars,
      fullTextChars: spec.fullTextChars,
      maxTokens: spec.maxTokens,
      // 拿到全文时输入会长很多，这个数按全文预算算更接近真实开销
      approxTokens: spec.fullTextChars + spec.maxTokens,
    }
  })
}

/**
 * 按档位拼 system prompt —— 字段越少，模型越不容易写长。
 *
 * `hasFullText` 决定两处措辞：有全文时要求「基于正文」并且鼓励引用具体
 * 方法/数字；只有摘要时必须强调「摘要未提及」而不是编造。这是全文功能
 * 能不能真的提升质量的关节点 —— 不区分的话模型会把摘要当全文猜。
 *
 * 关于格式约束的位置：用户库里出现过「模型写了一整篇 Markdown 文献卡片」
 * 的真实案例。分析那条样本，问题是**输出格式要求排在最后、且淹没在中文
 * 长段里**。所以这里把 JSON 要求提到最前面并给出字面样例 —— 模型对开头
 * 的格式指令更敏感。
 */
export function buildSystemPrompt(depth, hasFullText = false) {
  const spec = summaryDepthSpec(depth)
  const source = hasFullText
    ? '你拿到的是论文**正文**（可能截断过中段），请基于正文作答。'
    : '你拿到的是论文**摘要**，信息有限。'
  const shape = `{"${spec.fields[0]}": "...", ${spec.fields
    .slice(1, 3)
    .filter((field) => field !== 'tags')
    .map((field) => `"${field}": "..."`)
    .join(', ')}${spec.fields.includes('tags') ? ', "tags": ["...", "..."]' : ''}}`
  const lines = [
    '你是一位严谨的科研助理，负责把论文整理成结构化中文情报。',
    '',
    '【输出格式】只输出一个 JSON 对象，第一个字符必须是 {，最后一个字符必须是 }。',
    '不要写标题、不要写「以下按…整理」这类开场白、不要用 Markdown 标题或列表、不要用代码块包裹、不要在 JSON 前后加任何说明。',
    `形状示例（字段值请换成真实内容）：${shape}`,
    '',
    `信息来源：${source}`,
    '要求：',
    hasFullText
      ? '1. 方法、实验设置、数据与结论必须来自正文；正文里没有的内容不要补。'
      : '1. 只依据给出的标题与摘要判断，不要编造摘要中没有的实验结果、数据集或数字。',
    hasFullText
      ? '2. 正文被省略了中段时，不要假设省略部分说了什么；关键信息缺失就写「正文未提及」。'
      : '2. 若摘要信息不足以判断某一项，请写「摘要未提及」，不要猜测。',
    hasFullText
      ? '3. 尽量写出具体的方法名、关键参数、样本量或量化结论（原文有就给数字），不要泛泛而谈。'
      : '3. 只复述摘要里明确说过的内容，不要用常识补齐。',
    `4. 只输出下面 ${spec.fields.length} 个字段，全部为字符串，除 tags 为字符串数组：`,
    ...spec.fields.map((field) => FIELD_SPECS[field]),
  ]
  return lines.join('\n')
}

/**
 * 把「模型写了一篇 Markdown」掰回 JSON 的补救提示。
 *
 * 关键在于**不重新喂全文**：只需要模型自己刚才那几百字，让它转成 JSON 就行。
 * 一次 12000 字全文的输入是几十倍的成本，而这里只需要它做格式转换。
 */
export function buildRepairPrompt(depth) {
  const spec = summaryDepthSpec(depth)
  return [
    '你刚才的输出不是 JSON。请把它转换成 JSON 对象，不要新增内容、不要删减事实。',
    '只输出 JSON，第一个字符必须是 {，最后一个字符必须是 }，不要代码块、不要任何说明文字。',
    `必须包含这些字段：${spec.fields.join(', ')}（tags 为字符串数组，其余为字符串）。`,
    '原文里找不到的字段填「摘要未提及」，不要编。',
  ].join('\n')
}

function truncate(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n…（摘要已截断）`
}

/**
 * 拼 user 消息。
 *
 * @param {object} item 论文
 * @param {object} topic 方向
 * @param {number} abstractChars 摘要截断长度（由解析深度决定）
 * @param {{text:string, source:string, url:string}|null} [fullText]
 *   抓到的全文；有全文时正文替代摘要成为主体，摘要仍保留在开头
 *   （摘要最浓缩，模型先读它再读正文效果更好）
 */
export function buildUserMessage(item, topic, abstractChars = DEPTH_SPECS.deep.abstractChars, fullText = null) {
  const interests = []
  if (Array.isArray(topic.keywords) && topic.keywords.length > 0) interests.push(`关键词：${topic.keywords.join('、')}`)
  if (Array.isArray(topic.authors) && topic.authors.length > 0) interests.push(`关注作者：${topic.authors.join('、')}`)
  if (Array.isArray(topic.venues) && topic.venues.length > 0) interests.push(`关注期刊：${topic.venues.join('、')}`)
  if (Array.isArray(topic.institutions) && topic.institutions.length > 0)
    interests.push(`关注单位：${topic.institutions.join('、')}`)

  const lines = [
    `用户研究方向：${topic.name}`,
    ...interests,
    '',
    `论文标题：${item.title}`,
    `期刊/来源：${item.venue || item.source || '未知'}`,
    `发布/提交时间：${item.publishedAt || '未知'}`,
    `作者：${item.authors.length > 0 ? item.authors.slice(0, 10).join(', ') : '未知'}`,
    `链接：${item.url}`,
  ]
  if (item.matchedIn) lines.push(`检索命中：${item.matchedIn}`)
  if (fullText !== null && typeof fullText.text === 'string' && fullText.text !== '') {
    lines.push(
      '',
      `摘要（供参考）：`,
      truncate(item.abstract || '（该源未提供摘要）', Math.min(abstractChars, 2000)),
      '',
      `正文（来源：${fullText.source}）：`,
      fullText.text,
    )
  } else {
    lines.push('', '摘要：', truncate(item.abstract || '（该源未提供摘要）', abstractChars))
  }
  return lines.join('\n')
}

function stripCodeFence(text) {
  let value = String(text ?? '').trim()
  if (value.startsWith('```')) {
    value = value.replace(/^```[a-zA-Z]*\s*/, '')
    const end = value.lastIndexOf('```')
    if (end !== -1) value = value.slice(0, end)
  }
  return value.trim()
}

/**
 * 把模型常用的一些「近似 JSON」写法掰回标准 JSON。
 *
 * 实测踩到的几种（都来自真实失败样本）：
 *   - 中文标点：`“key”：“value”`、`‘value’`；
 *   - 尾逗号：`{ ..., }`；
 *   - 字符串里直接换行（模型把长句折行了），JSON 里这是非法的；
 *   - BOM 与全角空格。
 *
 * 这些都是「看着像 JSON、JSON.parse 直接抛」的情形，只在解析失败后才用，
 * 所以不必担心把合法 JSON 改坏。
 */
function relaxJson(text) {
  let value = String(text ?? '')
  // BOM 与全角空格
  value = value.replace(/^\uFEFF/, '').replace(/\u3000/g, ' ')
  // 中文引号 → 英文引号（只处理成对出现在 key/value 边界的那些）
  value = value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  // 全角冒号/逗号在 key: value 与元素分隔位置 → 半角
  value = value.replace(/(["'\]}\d])\s*：/g, '$1:').replace(/(["'\]}\d])\s*，/g, '$1,')
  // 尾逗号
  value = value.replace(/,(\s*[}\]])/g, '$1')
  // 字符串内部的裸换行 → \n（逐字符扫，只在字符串里替换）
  let out = ''
  let inString = false
  let quote = ''
  let escaped = false
  for (const ch of value) {
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (inString) {
      if (ch === quote) {
        inString = false
        out += ch
        continue
      }
      if (ch === '\n') {
        out += '\\n'
        continue
      }
      if (ch === '\r') continue
      if (ch === '\t') {
        out += '\\t'
        continue
      }
      out += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      out += ch
      continue
    }
    out += ch
  }
  // 单引号当字符串定界符的情况（整段都用 ' 包）
  return out
}

/**
 * 找出文本里**所有**配对完整的 `{...}`，逐个试解析。
 *
 * 不能只试第一个 `{`：模型常在前面写一句带花括号的说明
 * （「集合 {a, b} 的结果是 {...}」），第一个花括号块是垃圾，真 JSON 在后面。
 */
function findJsonObjects(text) {
  const found = []
  let from = 0
  while (from < text.length) {
    const start = text.indexOf('{', from)
    if (start === -1) break
    const balanced = balancedFrom(text, start)
    if (balanced !== null) found.push(balanced)
    from = start + 1
  }
  return found
}

/** 从指定位置按大括号配对切出一个完整对象（跳过字符串内的花括号）。 */
function balancedFrom(text, start) {
  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (inString) {
      if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function tryParse(candidate) {
  try {
    const value = JSON.parse(candidate)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** 字段名到中文标签的关键词表 —— 只在「模型整段没给 JSON」时救急用。 */
const SALVAGE_LABELS = {
  tldr: ['一句话', '结论摘要', '摘要', 'tldr', '概要', '核心结论'],
  problem: ['问题', '背景', '动机', 'problem', '研究目标'],
  method: ['方法', '技术路线', '建模', '实验设计', 'method', '手段'],
  findings: ['结论', '结果', '发现', '数据', 'findings', '主要内容'],
  innovation: ['创新', '贡献', '亮点', '差异', 'innovation', 'novelty'],
  limitations: ['局限', '不足', '未解决', '展望', 'limitation', 'future work'],
  relevance: ['相关性', '意义', '值得关注', '与方向', '方向', '关系', '启示', 'relevance'],
  tags: ['关键词', '标签', '关键字', 'tags', 'keywords'],
}

/**
 * 降级提取出来的标签要过一遍筛子。
 *
 * 真实样本里模型写的是
 * `**关键词/标签**：metal rubber、MR、EMWM（摘要中明确出现"metal rubber"）`，
 * 直接按逗号+空白切会得到 `*`、`metal`、`rubber`、`摘要中明确出现` 这种垃圾 ——
 * 一半是 Markdown 星号，一半是模型的自我说明，面板上一排全是噪音。
 */
const NOISE_TAG =
  /摘要(中|里|上)?(明确)?(出现|命中|提及)|^(关键词|标签|关键字|keywords?|tags)$|只(在|出现于|来自)摘要/i

/** 单个标签过筛子：去星号/引号/编号，丢掉噪音、纯符号与过长片段。 */
function sanitizeTagToken(piece) {
  const token = String(piece ?? '')
    .replace(/[（(][^）)]*[）)]/g, ' ') // 括号里通常是解释，不是标签
    .replace(/\*\*/g, '') // Markdown 加粗留下的星号
    .replace(/^[-*\d.、)）\s]+/, '')
    .replace(/["""'']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (token === '' || token.length > 16) return ''
  // 只剩符号或只有数字的不要（`*`、`-`、`1` 都不是标签）
  if (!/\p{L}/u.test(token)) return ''
  // 「摘要命中 MR」这类是模型对自己输出的旁白，不是论文的标签
  if (NOISE_TAG.test(token)) return ''
  return token
}

function cleanSalvagedTags(source) {
  const text = String(source ?? '')
  if (text.trim() === '') return []
  const seen = new Set()
  const out = []
  for (const piece of text.split(/[、,，;；|\n]+/)) {
    const token = sanitizeTagToken(piece)
    if (token === '') continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
    if (out.length >= 8) break
  }
  return out
}

/**
 * 模型走「正常 JSON」路径时 `tags` 是数组 —— 一样要过筛子。
 *
 * 真实样本 `crossref:10.3390/app162110732` 返回的是 `tags: ["摘要命中 MR"]`：
 * 语法合法、字段齐全，但那个「标签」是模型对自己输出的旁白。旧代码原样存下，
 * 面板上就挂着一个毫无意义的胶囊。
 */
function cleanTagList(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[、,，;；|\n]+/)
      : []
  const seen = new Set()
  const out = []
  for (const piece of list) {
    const token = sanitizeTagToken(piece)
    if (token === '') continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
    if (out.length >= 8) break
  }
  return out
}

/** 取一段文字的第一句，给降级提取的 `tldr` 兜底用。 */
function firstSentence(text) {
  const flat = String(text ?? '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-*\d.、)）\s]+/, '')
    .trim()
  if (flat === '') return ''
  const head = flat.split(/(?<=[。！？!?])/)[0] ?? flat
  const sentence = head.trim()
  if (sentence === '') return ''
  return sentence.length > 120 ? `${sentence.slice(0, 119)}…` : sentence
}

/**
 * 最后一道兜底：模型彻底没给 JSON，但写了一篇带小标题/加粗标签的 Markdown。
 *
 * 真实样本长这样：
 * ```
 * 以下按"文献卡片/综述素材"整理这篇论文…
 * ## 1. 基本信息
 * - **中文标题**：新型丝网复合弹性多孔金属材料…
 * ```
 * 直接报错会让用户看到一条红字什么都没得到；这里尽量把能认出来的段落
 * 塞进字段里，认不出的留空（后面统一填「摘要未提及」）。
 *
 * 返回的对象会带 `__salvaged: true`，方便调用方标注「这条是降级提取的」。
 */
function salvageFromMarkdown(text) {
  const body = stripCodeFence(text)
  if (body === '') return null
  // 先按小标题切段，段内再找 `**标签**：内容`
  const sections = []
  let current = { title: '', lines: [] }
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const heading = /^#{1,6}\s*(.+)$/.exec(line)
    if (heading !== null) {
      if (current.title !== '' || current.lines.length > 0) sections.push(current)
      current = { title: heading[1].replace(/^\d+[.、)]\s*/, '').trim(), lines: [] }
      continue
    }
    current.lines.push(line)
  }
  if (current.title !== '' || current.lines.length > 0) sections.push(current)

  const buckets = new Map()
  const push = (field, value) => {
    const text2 = String(value ?? '').trim()
    if (text2 === '') return
    buckets.set(field, buckets.has(field) ? `${buckets.get(field)}\n${text2}` : text2)
  }

  for (const section of sections) {
    for (const field of Object.keys(SALVAGE_LABELS)) {
      if (SALVAGE_LABELS[field].some((word) => section.title.toLowerCase().includes(word))) {
        push(field, section.lines.join('\n'))
      }
    }
    for (const line of section.lines) {
      const pair = /^[-*]?\s*\*{0,2}([^*：:]{2,24})\*{0,2}\s*[：:]\s*(.+)$/.exec(line)
      if (pair === null) continue
      const label = pair[1].toLowerCase()
      const field = Object.keys(SALVAGE_LABELS).find((key) => SALVAGE_LABELS[key].some((word) => label.includes(word)))
      if (field !== undefined) push(field, pair[2])
    }
  }
  if (buckets.size === 0) return null

  const object = {}
  for (const [field, value] of buckets) object[field] = value
  // 标签：从「关键词/标签」段里按逗号顿号切
  object.tags = cleanSalvagedTags(buckets.get('tags') ?? '')
  // 降级提取常常认不出「一句话结论」这一段的标题（模型写的是「文献卡片」，
  // 小标题五花八门），但几乎总能认出「结论/主要发现」。真实样本里 tldr 和
  // method 都空着、findings 却有完整三段 —— 而面板卡片顶上显示的就是 tldr，
  // 用户看到的标题成了「摘要未提及」。这里用 findings 的第一句顶上（不是编造，
  // 只是把模型自己写的第一句搬过来），并且仍然保留 salvaged 标记。
  //
  // 不用 problem 顶：那是「研究问题」，当结论显示会误导（用户以为作者得出了这个结论）。
  if (object.tldr === undefined) {
    const hint = firstSentence(object.findings ?? '')
    // 占位符与「说到一半就断了」都不能拿来顶（`firstSentence('摘要未提及')`
    // 返回的就是它自己，不挡会得到 tldr = "摘要未提及"）。
    if (hint !== '' && !isPlaceholder(hint) && !isDangling(hint)) object.tldr = hint
  }
  object.__salvaged = true
  return object
}

/**
 * 从模型输出里取结构化摘要。三层策略，从严到松：
 *   1. 去掉代码围栏后整体就是 JSON；
 *   2. 从中切出第一个配对完整的 `{...}`（前面常有「好的，以下是 JSON：」这类废话）；
 *   3. 把中文标点/尾逗号/裸换行修一遍再试；
 * 都不行时退回 Markdown 段落提取（带 `__salvaged` 标记）。
 */
export function extractJsonObject(text) {
  const raw = String(text ?? '')
  if (raw.trim() === '') return null
  const cleaned = stripCodeFence(raw)

  const strict = tryParse(cleaned)
  if (strict !== null) return strict

  const relaxed = relaxJson(cleaned)
  const relaxedStrict = tryParse(relaxed)
  if (relaxedStrict !== null) return relaxedStrict

  // 逐个试所有花括号块。取「最像摘要」的那个：含已知字段越多越优先，
  // 这样前面带 `{a, b}` 这类说明文字也不会抢走真正的结果。
  const candidates = [...findJsonObjects(cleaned), ...findJsonObjects(relaxed)]
    .map((chunk) => tryParse(chunk))
    .filter((value) => value !== null)
  if (candidates.length > 0) {
    let best = candidates[0]
    let bestHits = -1
    for (const candidate of candidates) {
      const hits = Object.keys(SALVAGE_LABELS).filter((field) => candidate[field] !== undefined).length
      if (hits > bestHits) {
        best = candidate
        bestHits = hits
      }
    }
    return best
  }

  // 走到这里说明没有合法 JSON。如果它本来就是「想写 JSON 但没写完」，
  // 就不要当 Markdown 去拆字段 —— 那样会把 `{"tldr":"一句话"` 里
  // 残缺的片段当成正式内容，用户看到的是断句。报「被截断」更诚实。
  if (cleaned.trimStart().startsWith('{')) return null

  return salvageFromMarkdown(cleaned)
}

function asField(value, fallback = '摘要未提及') {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? fallback : trimmed
  }
  if (Array.isArray(value)) {
    const joined = value.map((v) => String(v).trim()).filter(Boolean).join('；')
    return joined === '' ? fallback : joined
  }
  return fallback
}

/**
 * 摘要是「空壳」吗：所有正文字段都还是占位符。
 *
 * 真实样本 `crossref:10.3390/app162110732`：模型输出被 max-tokens 截断，
 * 补救轮又原样吐了个骨架 JSON —— 六个字段全是「摘要未提及」、tags 为空。
 * 旧代码把它当成功存下（`truncated: true` + `repaired: true`），
 * 面板上显示成一张「有摘要」的卡，点开全是同一句话，用户完全没法用。
 * 这种必须报错，才能进重试队列、也才能在面板上看到「重新总结」。
 */
function isHollowSummary(summary, fields) {
  const textFields = fields.filter((field) => field !== 'tags')
  if (textFields.length === 0) return false
  return textFields.every((field) => isPlaceholder(summary[field]))
}

/** 这个字段是空的 / 还是占位符吗。 */
function isPlaceholder(value) {
  const text = String(value ?? '').trim()
  return text === '' || text === '摘要未提及'
}

// 结尾是冒号 / 逗号 / 破折号，说明「还有下文」但正文被截掉了。
// 刻意不收 `…`：`firstSentence` 自己超 120 字时会补一个 `…`，
// 把它算成「断了」会连我们自己生成的兜底 tldr 一起判无效。
const DANGLING_TAIL = /[：:，,、；;—–-]$/
// 光有引导语、后面什么都没写。真实样本：`tldr = "摘要给出的规律可以归纳为："`
// （deep 档在列表第一项之前被 max-tokens 打断）—— 既不是占位符也不是结论，
// 旧代码因为「非空」就收下了，面板上等于一张没有结论的卡。
const LEAD_IN_ONLY = /(包括|如下|归纳为|体现在|主要有|分别是|可分为|以下几点|具体如下)$/

/** 这句话是不是「说到一半就断了」（只有引导语、没有实际内容）。 */
function isDangling(value) {
  const text = String(value ?? '')
    .replace(/\*+/g, '')
    .trim()
  if (text === '') return false
  return DANGLING_TAIL.test(text) || LEAD_IN_ONLY.test(text)
}

/**
 * 半残摘要：正文有内容，但「一句话结论」是占位符。
 *
 * 真实样本 `crossref:10.3390/app162110732` 重做后长这样：`problem` / `method`
 * 大段真内容，`tldr` 和 `findings` 却是「摘要未提及」。旧代码因为「不是全空」
 * 判成功 —— 但面板卡片顶上（`client.js` 的 `tldrLine`）显示的正是 `tldr`，
 * 用户看到的就是一张**没有一句话结论**的卡，等于白总结。
 *
 * 处理分两档：
 *   1. `findings` 有内容 → 拿它的第一句顶上（与 Markdown 降级路径同一条规则，
 *      并打 `tldrDerived` 标记，面板可以说明「来自主要发现」）；
 *   2. `findings` 也空 → 报错，让它进重试队列，而不是留一张只能看见问题与方法
 *      却不知道结论的卡。旧摘要不会被覆盖（`scan.js` 只在成功时写回）。
 *
 * 不用 `problem` 顶：那讲的是「要解决什么」，当结论显示会把研究目标误读成作者的结论。
 */
function deriveTldr(summary, fields) {
  // 没有 tldr 这一档（理论上不存在，DEPTH_SPECS 每档都有）就当没事
  if (!fields.includes('tldr')) return true
  // 占位符和「说到一半就断了」都不算有结论
  if (!isPlaceholder(summary.tldr) && !isDangling(summary.tldr)) return true
  const hint = firstSentence(summary.findings)
  // `firstSentence('摘要未提及')` 就是它自己 —— 占位符不能拿来顶
  if (hint === '' || isPlaceholder(hint) || isDangling(hint)) return false
  summary.tldr = hint
  summary.tldrDerived = true
  return true
}

function normalizeSummary(raw, depth) {
  const fields = summaryDepthSpec(depth).fields
  const tags = cleanTagList(raw.tags)
  const out = {}
  for (const field of fields) {
    if (field === 'tags') continue
    out[field] = asField(raw[field])
  }
  out.tags = tags
  return out
}

function resolveModel(ctx, config) {
  const fromConfig = config !== null && typeof config === 'object' ? config : {}
  if (typeof fromConfig.llmProvider === 'string' && typeof fromConfig.llmModel === 'string') {
    if (fromConfig.llmProvider !== '' && fromConfig.llmModel !== '') {
      return { provider: fromConfig.llmProvider, model: fromConfig.llmModel }
    }
  }
  try {
    const selection = ctx.agentDefaultModel.currentSelection()
    if (selection !== null && typeof selection === 'object') {
      const provider = typeof selection.provider === 'string' ? selection.provider : ''
      const model = typeof selection.model === 'string' ? selection.model : ''
      if (provider !== '' && model !== '') return { provider, model }
    }
  } catch {
    /* 服务不可用时落到下面的兜底 */
  }
  return null
}

/**
 * 跑一次 LLM 流式调用，把文本拼起来并留下 finish 信息。
 *
 * 抽出来是因为「补救轮」也要走完全一样的逻辑（含同样的错误归类），
 * 复制一遍迟早会改漏一边。
 */
async function runStream(ctx, options) {
  let collected = ''
  // 推理模型（deepseek-reasoner 一类）会先把思考过程以 `reasoning-delta` 吐出来，
  // 正文才在 `text-delta` 里。两者分开收：混进 collected 会让「前 160 字」
  // 全是思考过程、也会让 JSON 解析器在思考文本里乱找花括号。
  let reasoning = ''
  let finish = null
  try {
    const stream = ctx.llm.stream({
      provider: options.route.provider,
      model: options.route.model,
      messages: options.messages,
      system: options.system,
      temperature: 0.2,
      maxTokens: options.maxTokens,
      signal: options.signal,
    })

    for await (const chunk of stream) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        collected += chunk.text
      } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        reasoning += chunk.text
      } else if (chunk.type === 'block-end' && chunk.block !== null && typeof chunk.block === 'object') {
        // 有些适配器只在 block-end 给完整文本，text-delta 为空
        if (chunk.block.type === 'text' && typeof chunk.block.text === 'string' && collected.trim() === '') {
          collected = chunk.block.text
        } else if (chunk.block.type === 'reasoning' && typeof chunk.block.text === 'string' && reasoning.trim() === '') {
          reasoning = chunk.block.text
        }
      } else if (chunk.type === 'finish') {
        // 整块留下：`kind` 只是「怎么结束的」，失败时真正有用的是 failure
        finish = chunk.reason ?? null
      }
    }
  } catch (error) {
    // 适配器选择/分发/迭代失败本应是 finish chunk，但中间件、嵌套调用、
    // 清理逻辑的失败是直接 throw 的。这类错误里网络抖动与配置错误混在一起，
    // 只能按 code/status 猜 —— 猜错方向的代价是一律重试烧 token 或一律不重试。
    if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
      throw new SummaryError('摘要被取消', { code: 'aborted', retryable: false, detail: String(error.message ?? '') })
    }
    const status = Number(error?.status ?? error?.cause?.status)
    const code = String(error?.code ?? error?.cause?.code ?? '')
    const retryable = (Number.isFinite(status) && RETRYABLE_STATUS.has(status)) || RETRYABLE_CODES.has(code.toLowerCase())
    const detail = [code, Number.isFinite(status) && status > 0 ? `HTTP ${status}` : '', String(error?.message ?? '')]
      .filter((part) => part !== '')
      .join(' / ')
    throw new SummaryError(`LLM 调用失败：${String(error?.message ?? error ?? '未知错误')}`, {
      code: retryable ? 'llm-transient' : 'llm-failed',
      retryable,
      detail,
    })
  }
  return { collected, reasoning, finish }
}

function finishInfo(finish) {
  return finish === null ? { kind: '', message: '', retryable: false, detail: '' } : describeFinish(finish)
}

/**
 * `stop` 是正常结束；`max-tokens` 不算失败 —— 输出被截断时 JSON 往往仍可解析，
 * 解析层能救回来就救，救不回来再报「被截断」。旧实现把 max-tokens 也当失败
 * 直接抛，白白丢掉大量可用结果。
 */
function assertFinishOk(described) {
  const kind = described.kind
  if (kind === '' || kind === 'stop' || kind === 'max-tokens') return
  if (kind === 'aborted') {
    throw new SummaryError('摘要被取消', { code: 'aborted', retryable: false, detail: described.detail })
  }
  throw new SummaryError(`LLM 调用失败：${described.message}`, {
    code: described.retryable ? 'llm-transient' : 'llm-failed',
    retryable: described.retryable,
    detail: described.detail,
  })
}

/**
 * @param {object} ctx Harness host context
 * @param {object} config 插件配置
 * @param {object} item 论文
 * @param {object} topic 方向
 * @param {AbortSignal} [signal]
 * @param {'brief'|'standard'|'deep'} [depth] 解析深度（省 token 用），默认 standard
 * @param {{text:string, source:string, url:string, chars?:number}|null} [fullText]
 *   全文（已按预算压过）；null 表示只有摘要
 * @returns {Promise<object>} 结构化摘要
 */
export async function summarizePaper(ctx, config, item, topic, signal, depth = DEFAULT_SUMMARY_DEPTH, fullText = null) {
  const route = resolveModel(ctx, config)
  if (route === null) {
    // 配置问题：provider/model 都没解析出来，重试一万次也还是这句
    throw new SummaryError('未找到可用的 LLM 路由（agentDefaultModel 不可用，且未在插件配置里指定 llmProvider/llmModel）', {
      code: 'no-route',
      retryable: false,
    })
  }

  const level = normalizeSummaryDepth(depth)
  const spec = summaryDepthSpec(level)
  const hasFullText = fullText !== null && typeof fullText?.text === 'string' && fullText.text.trim() !== ''

  const first = await runStream(ctx, {
    route,
    system: buildSystemPrompt(level, hasFullText),
    messages: [
      {
        id: globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
        role: 'user',
        content: [{ type: 'text', text: buildUserMessage(item, topic, spec.abstractChars, hasFullText ? fullText : null) }],
        source: { kind: 'plugin', plugin: 'dsh-research-radar' },
      },
    ],
    maxTokens: spec.maxTokens,
    signal,
  })

  const described = finishInfo(first.finish)
  assertFinishOk(described)

  let parsed = extractJsonObject(first.collected)
  let repaired = false

  // 不是合法 JSON（或只是降级从 Markdown 里拆出来的）：让它把刚才那段转成 JSON。
  // 这一步只重发它自己那几百字（不是 12000 字全文），成本极低；
  // 实测那条「写成 Markdown 文献卡片」的样本正是靠这一步能救回来。
  // 而且修复后的结果比 salvage（按小标题硬拆）完整得多。
  if (parsed === null || parsed.__salvaged === true) {
    const previous = first.collected.trim()
    if (previous !== '') {
      try {
        const second = await runStream(ctx, {
          route,
          system: buildRepairPrompt(level),
          messages: [
            {
              id: globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-r`,
              role: 'user',
              content: [{ type: 'text', text: `把下面的内容转换成 JSON：\n\n${previous.slice(0, 6000)}` }],
              source: { kind: 'plugin', plugin: 'dsh-research-radar' },
            },
          ],
          maxTokens: spec.maxTokens,
          signal,
        })
        const secondDescribed = finishInfo(second.finish)
        const retried = extractJsonObject(second.collected)
        if (retried !== null) {
          parsed = retried
          repaired = true
          described.kind = secondDescribed.kind
        }
      } catch {
        // 补救失败就沿用第一次的结果/错误，别把原始失败信息盖掉
      }
    }
  }

  if (parsed === null) {
    const preview = stripCodeFence(first.collected).replace(/\s+/g, ' ').slice(0, 160)
    // 正文一个字都没有、只有思考过程：这是推理模型把 token 预算全花在
    // reasoning 上的典型症状（maxTokens 太小或模型没配 reasoningEffort）。
    // 直接说「没有返回可解析的摘要（前 160 字：）」等于什么都没说 ——
    // 实测用户看到这句只会来问「到底怎么了」。这里单独点明原因与药方。
    //
    // 药方必须往「加大预算」方向给：各档 maxTokens 是 brief 350 < standard 1000
    // < deep 1600，所以降到 brief 只会让思考更容易吃光预算、更没正文。
    const reasonPreview = first.reasoning.trim()
    if (first.collected.trim() === '' && reasonPreview !== '') {
      const nextLevel = level === 'deep' ? '' : level === 'brief' ? 'standard' : 'deep'
      throw new SummaryError(
        `模型只输出了思考过程，没有正文（思考 ${first.reasoning.length} 字，输出上限 maxTokens=${spec.maxTokens}）——` +
          `推理模型把预算花在思考上了，` +
          (nextLevel === ''
            ? `已经是最大档（deep），建议换一个非推理模型`
            : `可以换一个非推理模型，或把解析深度提到 ${nextLevel}（预算更大）`),
        {
          code: 'unparsable',
          retryable: false,
          detail: `reasoning-only depth=${level} reasoningChars=${first.reasoning.length} chars=0`,
        },
      )
    }
    throw new SummaryError(
      described.kind === 'max-tokens'
        ? `输出被截断，没拿到可解析的摘要（前 160 字：${preview}）`
        : `LLM 没有返回可解析的摘要（前 160 字：${preview}）`,
      {
        code: described.kind === 'max-tokens' ? 'truncated' : 'unparsable',
        retryable: false,
        detail: `depth=${level} chars=${first.collected.length}`,
      },
    )
  }

  const summary = normalizeSummary(parsed, level)
  const preview = stripCodeFence(first.collected).replace(/\s+/g, ' ').slice(0, 160)
  // 药方必须往「加大预算」方向给：各档 maxTokens 是 brief 350 < standard 1000 < deep 1600，
  // 建议「降一档」只会让模型更没空间写正文，所以统一成「换更大的输出上限 / 提高一档」。
  const budgetHint =
    described.kind === 'max-tokens'
      ? level === 'deep'
        ? `输出被 max-tokens=${spec.maxTokens} 截断了，已经是最大档（deep），建议换一个输出更长的模型`
        : `输出被 max-tokens=${spec.maxTokens} 截断了，可以换一个输出更长的模型，或把解析深度提到 ${
            level === 'brief' ? 'standard' : 'deep'
          }（预算更大）`
      : '可以换一个模型重试'

  // 解析成功但内容全是占位符 —— 等于没总结。不能当成功存下去，
  // 否则这张卡既进不了重试队列，面板也不会给「重新总结」的按钮。
  if (isHollowSummary(summary, spec.fields)) {
    throw new SummaryError(
      `模型返回的摘要里没有任何有效内容（${spec.fields.filter((f) => f !== 'tags').length} 个字段全是「摘要未提及」）——` +
        budgetHint,
      {
        code: described.kind === 'max-tokens' ? 'truncated' : 'unparsable',
        retryable: true,
        detail: `hollow depth=${level} tokens=${spec.maxTokens} chars=${first.collected.length} preview=${preview.slice(0, 60)}`,
      },
    )
  }
  // 正文有内容但「一句话结论」是占位符：先试着用 findings 的第一句顶上，
  // 顶不上就报错 —— 面板卡片顶上显示的就是 tldr，留空等于给用户一张无结论的卡。
  if (!deriveTldr(summary, spec.fields)) {
    // 说清 tldr 到底哪里不行：占位符、还是「只有引导语、正文被截断」。
    // 用户看到的报错要能对上卡片第一行的样子，否则不知道该改什么。
    const tldrState = isPlaceholder(summary.tldr)
      ? 'tldr 是占位符'
      : isDangling(summary.tldr)
        ? `tldr 只有引导语就断了：「${firstSentence(summary.tldr)}」`
        : 'tldr 是占位符'
    const findingsState = isPlaceholder(summary.findings)
      ? 'findings 也是空的'
      : 'findings 里也挑不出一句完整的话'
    throw new SummaryError(
      `模型给出了部分内容，但没有一句话结论（${tldrState}，${findingsState}）——${budgetHint}`,
      {
        code: described.kind === 'max-tokens' ? 'truncated' : 'unparsable',
        retryable: true,
        detail: `no-tldr depth=${level} tokens=${spec.maxTokens} chars=${first.collected.length} tldr=${JSON.stringify(String(summary.tldr).slice(0, 40))}`,
      },
    )
  }
  summary.model = `${route.provider}/${route.model}`
  summary.depth = level
  // 记录这次摘要是基于全文还是仅摘要 —— 面板与邮件都要显示，
  // 用户才知道「摘要未提及」到底是论文没写还是我们没读到
  summary.basis = hasFullText ? 'fulltext' : 'abstract'
  // 模型没按 JSON 输出、靠小标题降级提取出来的：保留但不假装是正常结果，
  // 面板会标一个「降级提取」，用户点开就能看出质量差别。
  if (parsed.__salvaged === true) summary.salvaged = true
  // 补救轮转换成功的：说明第一次没听话，但结果现在是完整的 JSON，
  // 标出来方便回溯「这个模型对格式指令不敏感」
  if (repaired) summary.repaired = true
  // 被 max-tokens 截断却仍解析成功：结果可用，但要标出来，否则用户会以为
  // 括号里的「…」是模型偷懒
  if (described.kind === 'max-tokens') summary.truncated = true
  if (hasFullText) {
    summary.fullTextSource = String(fullText.source ?? '')
    if (typeof fullText.url === 'string' && fullText.url !== '') summary.fullTextUrl = fullText.url
    if (Number.isFinite(Number(fullText.chars))) summary.fullTextChars = Number(fullText.chars)
  }
  summary.createdAt = new Date().toISOString()
  return summary
}
