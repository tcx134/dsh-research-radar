/**
 * 论文结构化摘要：调用 Harness 已配置的 LLM，输出
 * { tldr, problem, method, findings, innovation, limitations, relevance, tags }
 */

const SYSTEM_PROMPT = [
  '你是一位严谨的科研助理，负责把论文摘要整理成结构化中文情报。',
  '要求：',
  '1. 只依据给出的标题与摘要判断，不要编造摘要中没有的实验结果、数据集或数字。',
  '2. 若摘要信息不足以判断某一项，请写「摘要未提及」，不要猜测。',
  '3. 严格输出一个 JSON 对象，不要输出 Markdown 代码块、解释或任何前后缀文字。',
  '4. JSON 字段如下，全部为字符串，除 tags 为字符串数组：',
  '   tldr       —— 一句话结论（不超过 60 字）',
  '   problem    —— 论文要解决的问题',
  '   method     —— 科研方法/技术路线（核心步骤）',
  '   findings   —— 主要内容与实验结论',
  '   innovation —— 创新点（相对已有工作的差异）',
  '   limitations—— 局限或未解决的问题',
  '   relevance  —— 与用户研究方向的关系（为何值得关注）',
  '   tags       —— 3-6 个主题标签',
].join('\n')

const MAX_ABSTRACT_CHARS = 6000
const MAX_OUTPUT_TOKENS = 1600

function truncate(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n…（摘要已截断）`
}

function buildUserMessage(item, topic) {
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
  lines.push('', '摘要：', truncate(item.abstract || '（该源未提供摘要）', MAX_ABSTRACT_CHARS))
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

function normalizeSummary(raw) {
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : []
  return {
    tldr: asField(raw.tldr),
    problem: asField(raw.problem),
    method: asField(raw.method),
    findings: asField(raw.findings),
    innovation: asField(raw.innovation),
    limitations: asField(raw.limitations),
    relevance: asField(raw.relevance),
    tags,
  }
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
 * @returns {Promise<object>} 结构化摘要
 */
export async function summarizePaper(ctx, config, item, topic, signal) {
  const route = resolveModel(ctx, config)
  if (route === null) {
    throw new Error('未找到可用的 LLM 路由（agentDefaultModel 不可用，且未在插件配置里指定 llmProvider/llmModel）')
  }

  const messages = [
    {
      id: globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: buildUserMessage(item, topic) }],
      source: { kind: 'plugin', plugin: 'dsh-research-radar' },
    },
  ]

  let collected = ''
  let finishReason = null

  const stream = ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    messages,
    system: SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: MAX_OUTPUT_TOKENS,
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

  const summary = normalizeSummary(parsed)
  summary.model = `${route.provider}/${route.model}`
  summary.createdAt = new Date().toISOString()
  return summary
}
