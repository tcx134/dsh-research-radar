/**
 * 论文结构化摘要：调用 Harness 已配置的 LLM，输出
 * { tldr, problem, method, findings, innovation, limitations, relevance, tags }
 *
 * 解析深度可调（`scan.summaryDepth`）：`brief` 只要一句话+创新点，token 最省；
 * `standard` 是默认档；`deep` 输出全部字段。字段越少，喂进去的摘要也越短。
 */

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
 */
export function buildSystemPrompt(depth, hasFullText = false) {
  const spec = summaryDepthSpec(depth)
  const source = hasFullText
    ? '你拿到的是论文**正文**（可能截断过中段），请基于正文作答。'
    : '你拿到的是论文**摘要**，信息有限。'
  const lines = [
    '你是一位严谨的科研助理，负责把论文整理成结构化中文情报。',
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
    '4. 严格输出一个 JSON 对象，不要输出 Markdown 代码块、解释或任何前后缀文字。',
    `5. 只输出下面 ${spec.fields.length} 个字段，全部为字符串，除 tags 为字符串数组：`,
    ...spec.fields.map((field) => FIELD_SPECS[field]),
  ]
  return lines.join('\n')
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

function extractJsonObject(text) {
  const cleaned = stripCodeFence(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
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

function normalizeSummary(raw, depth) {
  const fields = summaryDepthSpec(depth).fields
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : []
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
    throw new Error('未找到可用的 LLM 路由（agentDefaultModel 不可用，且未在插件配置里指定 llmProvider/llmModel）')
  }

  const level = normalizeSummaryDepth(depth)
  const spec = summaryDepthSpec(level)
  const hasFullText = fullText !== null && typeof fullText?.text === 'string' && fullText.text.trim() !== ''
  const messages = [
    {
      id: globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: buildUserMessage(item, topic, spec.abstractChars, hasFullText ? fullText : null) }],
      source: { kind: 'plugin', plugin: 'dsh-research-radar' },
    },
  ]

  let collected = ''
  let finishReason = null

  const stream = ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    messages,
    system: buildSystemPrompt(level, hasFullText),
    temperature: 0.2,
    maxTokens: spec.maxTokens,
    signal,
  })

  for await (const chunk of stream) {
    if (chunk === null || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      collected += chunk.text
    } else if (chunk.type === 'block-end' && chunk.block !== null && typeof chunk.block === 'object') {
      if (chunk.block.type === 'text' && typeof chunk.block.text === 'string' && collected.trim() === '') {
        collected = chunk.block.text
      }
    } else if (chunk.type === 'finish') {
      finishReason = chunk.reason?.kind ?? chunk.reason ?? null
    }
  }

  if (finishReason !== null && finishReason !== 'stop' && finishReason !== 'max-tokens') {
    throw new Error(`LLM 调用未正常结束：${String(finishReason)}`)
  }

  const parsed = extractJsonObject(collected)
  if (parsed === null) {
    throw new Error(`LLM 未返回可解析的 JSON（前 200 字：${stripCodeFence(collected).slice(0, 200)}）`)
  }

  const summary = normalizeSummary(parsed, level)
  summary.model = `${route.provider}/${route.model}`
  summary.depth = level
  // 记录这次摘要是基于全文还是仅摘要 —— 面板与邮件都要显示，
  // 用户才知道「摘要未提及」到底是论文没写还是我们没读到
  summary.basis = hasFullText ? 'fulltext' : 'abstract'
  if (hasFullText) {
    summary.fullTextSource = String(fullText.source ?? '')
    if (typeof fullText.url === 'string' && fullText.url !== '') summary.fullTextUrl = fullText.url
    if (Number.isFinite(Number(fullText.chars))) summary.fullTextChars = Number(fullText.chars)
  }
  summary.createdAt = new Date().toISOString()
  return summary
}
