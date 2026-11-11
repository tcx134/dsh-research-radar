import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SUMMARY_DEPTHS,
  DEFAULT_SUMMARY_DEPTH,
  SummaryError,
  describeFinish,
  extractJsonObject,
  normalizeSummaryDepth,
  summaryDepthSpec,
  summaryDepthOptions,
  buildSystemPrompt,
  buildUserMessage,
  summarizePaper,
} from '../radar/summarize.js'

const paper = {
  title: 'A boundary-coupled frictional hysteresis model for metal rubber',
  abstract: 'x'.repeat(5000),
  authors: ['Li Y', 'Wang Z'],
  venue: 'Mechanical Systems and Signal Processing',
  source: 'openalex',
  publishedAt: '2026-09-01',
  url: 'https://doi.org/10.1016/j.ymssp.2026.1',
  matchedIn: '标题',
}

const topic = { name: '金属橡胶', keywords: ['metal rubber'] }

/** 造一个只会吐出固定 JSON 的 llm 桩，顺便记下调用参数。 */
function llmStub(payload, calls) {
  return {
    stream(options) {
      calls.push(options)
      return (async function* () {
        yield { type: 'text-delta', text: JSON.stringify(payload) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function ctxStub(llm) {
  return {
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  }
}

test('normalizeSummaryDepth 只接受三档，非法值退回默认档', () => {
  assert.deepEqual(SUMMARY_DEPTHS, ['brief', 'standard', 'deep'])
  assert.equal(DEFAULT_SUMMARY_DEPTH, 'standard')
  assert.equal(normalizeSummaryDepth('brief'), 'brief')
  assert.equal(normalizeSummaryDepth(' deep '), 'deep')
  assert.equal(normalizeSummaryDepth('DEEP'), 'standard')
  assert.equal(normalizeSummaryDepth(''), 'standard')
  assert.equal(normalizeSummaryDepth(null), 'standard')
  assert.equal(normalizeSummaryDepth(3), 'standard')
})

test('summaryDepthSpec 逐档收窄字段数与预算', () => {
  const brief = summaryDepthSpec('brief')
  const standard = summaryDepthSpec('standard')
  const deep = summaryDepthSpec('deep')

  assert.deepEqual(brief.fields, ['tldr', 'innovation', 'tags'])
  assert.ok(!brief.fields.includes('limitations'))
  assert.ok(standard.fields.includes('method'))
  assert.ok(!standard.fields.includes('limitations'))
  assert.ok(deep.fields.includes('limitations'))

  // 三档必须严格递增，否则「省 token」没有意义
  assert.ok(brief.abstractChars < standard.abstractChars)
  assert.ok(standard.abstractChars < deep.abstractChars)
  assert.ok(brief.maxTokens < standard.maxTokens)
  assert.ok(standard.maxTokens < deep.maxTokens)
})

test('summaryDepthOptions 给出面板要用的档位说明', () => {
  const options = summaryDepthOptions()
  assert.deepEqual(
    options.map((o) => o.key),
    ['brief', 'standard', 'deep'],
  )
  const brief = options[0]
  assert.equal(brief.fields, 3)
  // approxTokens 现在按「拿到全文」的预算算（全文才是长的那一头），
  // 所以是 fullTextChars + maxTokens 而不是摘要长度。
  assert.equal(brief.approxTokens, brief.fullTextChars + brief.maxTokens)
  assert.ok(brief.approxTokens < options[2].approxTokens)
})

test('buildSystemPrompt 只列当前档位的字段', () => {
  const brief = buildSystemPrompt('brief')
  assert.match(brief, /只输出下面 3 个字段/)
  assert.match(brief, /tldr/)
  assert.match(brief, /tags/)
  assert.doesNotMatch(brief, /limitations/)

  const deep = buildSystemPrompt('deep')
  assert.match(deep, /只输出下面 8 个字段/)
  assert.match(deep, /limitations/)
  assert.match(deep, /relevance/)
})

test('buildUserMessage 按档位截断摘要', () => {
  const brief = buildUserMessage(paper, topic, summaryDepthSpec('brief').abstractChars)
  const deep = buildUserMessage(paper, topic, summaryDepthSpec('deep').abstractChars)
  assert.ok(brief.length < deep.length)
  assert.match(brief, /摘要已截断/)
  assert.doesNotMatch(deep, /摘要已截断/)
})

test('summarizePaper 精简档只喂短摘要、只要三个字段', async () => {
  const calls = []
  const ctx = ctxStub(
    llmStub({ tldr: '提出边界耦合摩擦迟滞模型', innovation: '统一准静态与动态', tags: ['金属橡胶', '迟滞'] }, calls),
  )
  const summary = await summarizePaper(ctx, {}, paper, topic, undefined, 'brief')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].maxTokens, summaryDepthSpec('brief').maxTokens)
  assert.match(calls[0].system, /只输出下面 3 个字段/)
  const userText = calls[0].messages[0].content[0].text
  assert.ok(userText.length < 2000, '精简档不该把 5000 字摘要全喂进去')

  assert.equal(summary.depth, 'brief')
  assert.equal(summary.tldr, '提出边界耦合摩擦迟滞模型')
  assert.deepEqual(summary.tags, ['金属橡胶', '迟滞'])
  // 精简档没要的字段不该出现（面板按缺字段隐藏，节省渲染）
  assert.equal(summary.method, undefined)
  assert.equal(summary.limitations, undefined)
})

test('summarizePaper 深度档要全字段，缺的填「摘要未提及」', async () => {
  const calls = []
  const ctx = ctxStub(
    llmStub({ tldr: '一句话', problem: '问题', method: '方法', findings: '结论', innovation: '创新' }, calls),
  )
  const summary = await summarizePaper(ctx, {}, paper, topic, undefined, 'deep')

  assert.equal(calls[0].maxTokens, summaryDepthSpec('deep').maxTokens)
  assert.equal(summary.depth, 'deep')
  assert.equal(summary.limitations, '摘要未提及')
  assert.equal(summary.relevance, '摘要未提及')
  assert.deepEqual(summary.tags, [])
})

test('summarizePaper 不传深度时用默认档', async () => {
  const calls = []
  const ctx = ctxStub(llmStub({ tldr: '一句话' }, calls))
  const summary = await summarizePaper(ctx, {}, paper, topic)
  assert.equal(summary.depth, 'standard')
  assert.equal(calls[0].maxTokens, summaryDepthSpec('standard').maxTokens)
})

// ---------------------------------------------------------------------------
// 解析容错：模型经常不老实（前面加废话、用中文标点、尾逗号、甚至整段不给 JSON）。
// 下面两条「真实失败样本」直接抄自用户库里的 summaryError，改坏了解析器就会红。
// ---------------------------------------------------------------------------

test('extractJsonObject 认得代码围栏、前后废话与中文标点', () => {
  // 前后带废话 + ```json 围栏
  assert.deepEqual(
    extractJsonObject('好的，以下是结果：\n```json\n{"tldr": "一句话", "tags": ["甲", "乙"]}\n```\n希望有帮助。'),
    { tldr: '一句话', tags: ['甲', '乙'] },
  )

  // 中文引号 + 中文冒号 + 尾逗号
  assert.deepEqual(extractJsonObject('{“tldr”：“一句话”，“innovation”：“新方法”，}'), {
    tldr: '一句话',
    innovation: '新方法',
  })

  // 字符串内部裸换行（模型把长句折行了）
  const wrapped = '{"tldr": "第一行\n第二行", "method": "建模"}'
  assert.deepEqual(extractJsonObject(wrapped), { tldr: '第一行\n第二行', method: '建模' })

  // 前面有 { 但不是 JSON 的情形，要能找到真正那个对象
  assert.deepEqual(extractJsonObject('集合 {a, b} 的结果是 {"tldr":"x"}'), { tldr: 'x' })

  // 外面套了数组：模型偶尔会这么包一层，里面那个对象仍是我们想要的
  assert.deepEqual(extractJsonObject('[{"tldr":"x"}]'), { tldr: 'x' })
  assert.equal(extractJsonObject(''), null)
  assert.equal(extractJsonObject('完全不是 JSON 也没有小标题'), null)
})

test('extractJsonObject 在模型整段写 Markdown 时按小标题降级提取', () => {
  // 这条是用户库里那条真实报错的前半段（openalex:10.3390/ma19214680）
  const markdown = [
    '以下按“文献卡片/综述素材”整理这篇论文，便于后续纳入金属橡胶（MR/EMWM）方向综述。',
    '',
    '## 1. 基本信息',
    '- **中文标题**：新型丝网复合弹性多孔金属材料在低频激励下的动态力学性能',
    '- **英文标题**：Dynamic Mechanical Properties of a Novel Wire-Mesh Composite',
    '',
    '## 2. 研究问题',
    '低频重载工况下金属橡胶的刚度衰减机理尚不清楚。',
    '',
    '## 3. 方法与技术路线',
    '采用准静态压缩与动态扫频试验，结合细观网丝接触模型。',
    '',
    '## 4. 主要结论',
    '孔隙率与丝径比是控制低频刚度的主因。',
    '',
    '## 5. 创新点',
    '首次把丝网拓扑参数纳入迟滞模型。',
    '',
    '## 6. 局限与展望',
    '未考虑温度效应。',
    '',
    '## 7. 关键词',
    '金属橡胶, 丝网, 低频隔振, 迟滞',
  ].join('\n')

  const salvaged = extractJsonObject(markdown)
  assert.ok(salvaged !== null, '整段 Markdown 不该直接判失败')
  assert.equal(salvaged.__salvaged, true)
  assert.match(salvaged.problem, /刚度衰减机理/)
  assert.match(salvaged.method, /准静态压缩/)
  assert.match(salvaged.findings, /孔隙率与丝径比/)
  assert.match(salvaged.innovation, /丝网拓扑参数/)
  assert.match(salvaged.limitations, /温度效应/)
  assert.deepEqual(salvaged.tags, ['金属橡胶', '丝网', '低频隔振', '迟滞'])
})

test('降级提取会清掉标签里的 Markdown 星号与模型自我说明', () => {
  // 真实样本：模型把标签写成「metal rubber、MR、EMWM（摘要中明确出现"metal rubber"）」，
  // 直接按逗号+空白切会得到 `*`、`metal`、`rubber`、`摘要中明确出现` 这些垃圾
  const markdown = [
    '## 1. 主要结论',
    '1. **激励幅值增大**：动态刚度和能量耗散提高，损耗因子适度下降。',
    '2. **材料密度增大**：刚度上升，隔振频带右移。',
    '',
    '## 2. 关键词/标签',
    'metal rubber、MR、EMWM（摘要中明确出现"metal rubber"），丝网拓扑',
  ].join('\n')
  const salvaged = extractJsonObject(markdown)
  assert.ok(salvaged !== null)
  assert.deepEqual(salvaged.tags, ['metal rubber', 'MR', 'EMWM', '丝网拓扑'])
  // 只有符号/只有数字的不算标签
  const junk = extractJsonObject('## 关键词\n*、-、1、**、、迟滞')
  assert.deepEqual(junk.tags, ['迟滞'])
})

test('降级提取认得不出「一句话结论」时，用 findings 第一句顶上 tldr', () => {
  // 真实样本里 tldr 与 method 都空着、findings 却很完整；
  // 而面板卡片顶上显示的就是 tldr，不兜底用户看到的是「摘要未提及」
  const markdown = [
    '## 1. 主要结论',
    '1. **激励幅值增大**：动态刚度和能量耗散提高，损耗因子适度下降。',
    '2. **材料密度增大**：刚度上升，隔振频带右移。',
  ].join('\n')
  const salvaged = extractJsonObject(markdown)
  assert.ok(salvaged !== null)
  assert.equal(salvaged.tldr, '激励幅值增大：动态刚度和能量耗散提高，损耗因子适度下降。')
  // 兜底来的 tldr 仍然要打 salvaged 标记，面板照样能提示「降级提取」
  assert.equal(salvaged.__salvaged, true)
})

test('降级提取连 findings 都没有时，不编造 tldr', () => {
  const salvaged = extractJsonObject('## 1. 研究问题\n低频重载工况下刚度衰减机理不清楚。')
  assert.ok(salvaged !== null)
  assert.equal(salvaged.tldr, undefined)
  assert.match(salvaged.problem, /刚度衰减机理/)
})

test('describeFinish 把 failure 里的状态码与错误码读出来，并判断是否值得重试', () => {
  // 真实报错「LLM 调用未正常结束：error」背后的形状
  const rateLimited = describeFinish({
    kind: 'error',
    failure: { message: 'Rate limit exceeded', code: 'rate_limit', status: 429, providerRetryAfterMs: 12000 },
  })
  assert.equal(rateLimited.kind, 'error')
  assert.equal(rateLimited.message, 'Rate limit exceeded')
  assert.equal(rateLimited.retryable, true)
  assert.match(rateLimited.detail, /rate_limit/)
  assert.match(rateLimited.detail, /HTTP 429/)
  assert.match(rateLimited.detail, /12 秒后重试/)

  // 配置错（模型名不存在）—— 重试没有意义
  const badModel = describeFinish({ kind: 'error', failure: { message: 'model not found', code: 'invalid_request', status: 404 } })
  assert.equal(badModel.retryable, false)
  assert.match(badModel.detail, /HTTP 404/)

  // 没有 failure 的老形状不能崩
  const bare = describeFinish({ kind: 'error' })
  assert.equal(bare.kind, 'error')
  assert.equal(bare.message, 'error')
  assert.equal(bare.retryable, false)

  // 正常结束
  assert.equal(describeFinish({ kind: 'stop' }).kind, 'stop')
  assert.equal(describeFinish(null).kind, '')
  assert.equal(describeFinish('stop').kind, 'stop')
})

test('summarizePaper 遇到限流这类瞬时错误会标成可重试', async () => {
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'overloaded', code: 'overloaded', status: 503 } } }
      })()
    },
  })

  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic),
    (error) => {
      assert.ok(error instanceof SummaryError)
      assert.equal(error.code, 'llm-transient')
      assert.equal(error.retryable, true)
      assert.match(error.message, /overloaded/)
      assert.match(error.detail, /HTTP 503/)
      return true
    },
  )
})

test('summarizePaper 遇到完全无法解析的输出时报 unparsable 且不重试', async () => {
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '这篇论文我觉得挺有意思的，但没有小标题也没有 JSON。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })

  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic),
    (error) => {
      assert.ok(error instanceof SummaryError)
      assert.equal(error.code, 'unparsable')
      assert.equal(error.retryable, false)
      assert.match(error.message, /没有返回可解析的摘要/)
      return true
    },
  )
})

test('推理模型只吐思考过程时，报错要说清原因而不是留空预览', async () => {
  // deepseek-reasoner 一类：reasoning-delta 有内容，text-delta 一个字都没有。
  // 旧实现的报错是「LLM 没有返回可解析的摘要（前 160 字：）」—— 括号里空的，
  // 用户看不出是模型坏了还是我们配置错了。
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'reasoning-delta', text: '用户想要一篇论文的摘要，我先读摘要……' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })

  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic, undefined, 'standard'),
    (error) => {
      assert.ok(error instanceof SummaryError)
      assert.equal(error.code, 'unparsable')
      assert.match(error.message, /只输出了思考过程/)
      assert.match(error.message, /maxTokens=1000/, '要点明当前档位的输出上限')
      // 药方必须往「加大预算」方向：brief 的 maxTokens 反而更小
      assert.match(error.message, /提到 deep/)
      assert.doesNotMatch(error.message, /降到 brief/)
      assert.match(error.detail, /reasoning-only/)
      assert.match(error.detail, /reasoningChars=\d+/)
      return true
    },
  )
})

test('思考过程不会被当成正文，也不会被 JSON 解析器误用', async () => {
  // 思考里常出现花括号（比如模型自己在草拟 JSON），绝不能让它变成"解析成功"。
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'reasoning-delta', text: '我打算这样写：{"tldr":"草稿","tags":[]}' }
        yield { type: 'reasoning-delta', text: '……再确认一下字段。' }
        yield { type: 'text-delta', text: '{"tldr":"正式结论","tags":["金属橡胶"]}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })

  const summary = await summarizePaper(ctx, {}, paper, topic, undefined, 'brief')
  assert.equal(summary.tldr, '正式结论')
  assert.deepEqual(summary.tags, ['金属橡胶'])
})

test('只有 block-end 给 reasoning 时也能识别出「只想了没写」', async () => {
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'block-end', block: { type: 'reasoning', text: '只思考，不输出。' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })

  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic, undefined, 'brief'),
    (error) => {
      assert.match(error.message, /只输出了思考过程/)
      assert.match(error.message, /maxTokens=350/)
      return true
    },
  )
})

test('summarizePaper 输出被 max-tokens 截断但还能解析时保留结果并标 truncated', async () => {
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '{"tldr":"一句话","method":"建模"' }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      })()
    },
  })

  // 缺右括号 → 解析不了，但错误信息要说明是「被截断」而不是「没听懂格式」
  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic),
    (error) => {
      assert.equal(error.code, 'truncated')
      assert.match(error.message, /输出被截断/)
      return true
    },
  )

  // 完整但被标 max-tokens：结果可用，加 truncated 标记
  const okCtx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '{"tldr":"一句话","method":"建模"}' }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      })()
    },
  })
  const summary = await summarizePaper(okCtx, {}, paper, topic)
  assert.equal(summary.tldr, '一句话')
  assert.equal(summary.truncated, true)
  assert.equal(summary.salvaged, undefined)
})

test('所有字段都是占位符的空壳摘要要报错，不能当成功存下来', async () => {
  // 真实样本 crossref:10.3390/app162110732：被 max-tokens 截断后，
  // 补救轮原样吐了个骨架 JSON，六个字段全是「摘要未提及」、tags 为空。
  // 旧代码把它当成功（truncated + repaired），面板上显示成一张有摘要的卡，
  // 点开全是同一句话，而且进不了重试队列。
  const hollow = {
    tldr: '摘要未提及',
    problem: '摘要未提及',
    method: '摘要未提及',
    findings: '摘要未提及',
    innovation: '摘要未提及',
    relevance: '摘要未提及',
    tags: [],
  }
  const ctx = ctxStub(llmStub(hollow, []))

  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic),
    (error) => {
      assert.equal(error.code, 'unparsable')
      assert.equal(error.retryable, true)
      assert.match(error.message, /没有任何有效内容/)
      assert.match(error.message, /摘要未提及/)
      assert.match(error.detail, /hollow/)
      return true
    },
  )
})

test('空壳摘要若还伴随输出截断，报 truncated 并指向提高深度', async () => {
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield {
          type: 'text-delta',
          text: '{"tldr":"摘要未提及","problem":"摘要未提及","method":"摘要未提及"}',
        }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      })()
    },
  })

  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic),
    (error) => {
      assert.equal(error.code, 'truncated')
      assert.equal(error.retryable, true)
      assert.match(error.message, /截断/)
      // 各档 maxTokens 是 brief 350 < standard 1000 < deep 1600，降档只会更糟
      assert.match(error.message, /提到 deep/)
      assert.doesNotMatch(error.message, /降一档|降低.*深度/)
      return true
    },
  )
})

test('tldr 是占位符但 findings 有内容时，用 findings 第一句顶上并标记来源', async () => {
  // 真实样本 crossref:10.3390/app162110732 重做后的形状：problem/method 大段真内容，
  // tldr 和 findings 里的 tldr 位是「摘要未提及」。面板卡片顶上显示的就是 tldr，
  // 留空等于给用户一张「没有一句话结论」的卡。
  const partial = {
    tldr: '摘要未提及',
    problem: '金属橡胶隔振器的迟滞行为有明显方向依赖性。',
    method: '采用方向特定建模策略。',
    findings: '垂向刚度随激励幅值增大而下降。后续还有别的结论。',
    innovation: '摘要未提及',
    relevance: '摘要未提及',
    tags: [],
  }
  const summary = await summarizePaper(ctxStub(llmStub(partial, [])), {}, paper, topic)
  assert.equal(summary.tldr, '垂向刚度随激励幅值增大而下降。')
  assert.equal(summary.tldrDerived, true)
  assert.equal(summary.findings, '垂向刚度随激励幅值增大而下降。后续还有别的结论。')
})

test('tldr 与 findings 都是占位符时报错，别留一张没有结论的卡', async () => {
  const noTldr = {
    tldr: '摘要未提及',
    problem: '金属橡胶隔振器的迟滞行为有明显方向依赖性。',
    method: '采用方向特定建模策略。',
    findings: '摘要未提及',
    innovation: '摘要未提及',
    relevance: '摘要未提及',
    tags: [],
  }
  await assert.rejects(
    () => summarizePaper(ctxStub(llmStub(noTldr, [])), {}, paper, topic),
    (error) => {
      assert.equal(error.code, 'unparsable')
      assert.equal(error.retryable, true)
      assert.match(error.message, /没有一句话结论/)
      assert.match(error.detail, /no-tldr/)
      return true
    },
  )
})

test('只有引导语的悬空 tldr 不算结论，用 findings 第一句顶上', async () => {
  // 真实样本 openalex:10.3390/ma19214680 在 deep 档重做后：模型刚写完
  // 「摘要给出的规律可以归纳为：」就被 max-tokens 打断，紧跟的列表一项都没出来。
  // 这不是占位符、也不是空，旧代码因为「非空」就收下了 —— 面板上那张卡的第一行
  // 就是一句没说完的话，等于没有结论。
  const dangling = {
    tldr: '摘要给出的规律可以归纳为：',
    problem: '摘要未提及',
    method: '摘要未提及',
    findings: '压波纹金属橡胶的等效斜撑模型能预测垂向刚度随振幅下降的趋势。',
    innovation: '提出压波纹几何的等效斜撑模型。',
    relevance: '摘要未提及',
    tags: [],
  }
  const summary = await summarizePaper(ctxStub(llmStub(dangling, [])), {}, paper, topic)
  assert.equal(summary.tldr, '压波纹金属橡胶的等效斜撑模型能预测垂向刚度随振幅下降的趋势。')
  assert.equal(summary.tldrDerived, true)
})

test('tldr 与 findings 都说到一半就断了，要报错而不是收下', async () => {
  const cut = {
    tldr: '摘要给出的规律可以归纳为：',
    problem: '摘要未提及',
    method: '摘要未提及',
    findings: '摘要给出的规律可以归纳为：',
    innovation: '提出将压波纹',
    relevance: '摘要未提及',
    tags: [],
  }
  await assert.rejects(
    () => summarizePaper(ctxStub(llmStub(cut, [])), {}, paper, topic),
    (error) => {
      assert.equal(error.code, 'unparsable')
      assert.equal(error.retryable, true)
      assert.match(error.message, /没有一句话结论/)
      // 报错要能对上卡片第一行的样子：这条是「只有引导语就断了」，
      // 不是「全是摘要未提及」，文案不能混着说
      assert.match(error.message, /只有引导语就断了/)
      assert.doesNotMatch(error.message, /都是「摘要未提及」/)
      return true
    },
  )
})

test('以冒号/逗号/破折号收尾的 tldr 都算说到一半', async () => {
  for (const tail of ['主要包括：', '结果主要有，', '结论是—']) {
    const dangling = {
      tldr: tail,
      problem: '摘要未提及',
      method: '摘要未提及',
      findings: '阻尼随振幅增大而上升。',
      innovation: '摘要未提及',
      relevance: '摘要未提及',
      tags: [],
    }
    const summary = await summarizePaper(ctxStub(llmStub(dangling, [])), {}, paper, topic)
    // 都被判定为「没说完」→ 换成 findings 第一句
    assert.equal(summary.tldr, '阻尼随振幅增大而上升。')
    assert.equal(summary.tldrDerived, true)
  }
})

test('正常 JSON 路径里的噪音标签也要清掉（「摘要命中 MR」不是标签）', async () => {
  // 模型偶尔会把自我说明塞进 tags：语法合法、字段齐全，面板上却挂着一个
  // 毫无意义的胶囊。降级提取路径早就在清洗，JSON 路径之前漏了。
  const noisy = {
    tldr: '提出考虑丝网接触的迟滞模型',
    problem: '摘要未提及',
    method: '摘要未提及',
    findings: '摘要未提及',
    innovation: '摘要未提及',
    relevance: '摘要未提及',
    tags: ['摘要命中 MR', '**metal rubber**', '*', 'MR', 'mr', 'EMWM', 'metal rubber'],
  }
  const summary = await summarizePaper(ctxStub(llmStub(noisy, [])), {}, paper, topic)
  assert.deepEqual(summary.tags, ['metal rubber', 'MR', 'EMWM'])
})

test('只要有一个字段有真内容就不算空壳（别把模型写不出某几项当失败）', async () => {
  // 摘要本身可能确实没提方法，这种是「论文没写」而不是「模型没干活」，
  // 只有全部字段都是占位符才算空壳。
  const mostly = {
    tldr: '提出一种考虑丝网接触的迟滞模型',
    problem: '摘要未提及',
    method: '摘要未提及',
    findings: '摘要未提及',
    innovation: '摘要未提及',
    relevance: '摘要未提及',
    tags: [],
  }
  const summary = await summarizePaper(ctxStub(llmStub(mostly, [])), {}, paper, topic)
  assert.equal(summary.tldr, '提出一种考虑丝网接触的迟滞模型')
  assert.equal(summary.problem, '摘要未提及')
})

test('summarizePaper 降级提取成功时打 salvaged 标记', async () => {
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '## 研究问题\n刚度衰减机理不清楚。\n\n## 主要结论\n孔隙率是主因。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })
  const summary = await summarizePaper(ctx, {}, paper, topic)
  assert.equal(summary.salvaged, true)
  assert.match(summary.problem, /刚度衰减机理/)
  assert.match(summary.findings, /孔隙率是主因/)
  // 没提到的字段仍然要有兜底文案，面板才不用判空
  assert.equal(summary.method, '摘要未提及')
})

test('summarizePaper 在流里 throw 时按错误码判断能否重试', async () => {
  const ctx = ctxStub({
    stream() {
      return (async function* () {
        const error = new Error('socket hang up')
        error.code = 'ECONNRESET'
        throw error
      })()
    },
  })

  await assert.rejects(
    () => summarizePaper(ctx, {}, paper, topic),
    (error) => {
      assert.ok(error instanceof SummaryError)
      assert.equal(error.retryable, true)
      assert.equal(error.code, 'llm-transient')
      assert.match(error.detail, /ECONNRESET/)
      return true
    },
  )
})

test('summarizePaper 第一轮写成 Markdown 时用补救轮转成 JSON，且不重发全文', async () => {
  const calls = []
  const markdown = '## 研究问题\n刚度衰减机理不清楚。\n\n## 主要结论\n孔隙率是主因。'
  const ctx = ctxStub({
    stream(options) {
      calls.push(options)
      if (calls.length === 1) {
        return (async function* () {
          yield { type: 'text-delta', text: markdown }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', text: '{"problem":"刚度衰减机理不清楚","findings":"孔隙率是主因","tags":["金属橡胶"]}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })

  const summary = await summarizePaper(ctx, {}, paper, topic)
  assert.equal(calls.length, 2)
  // 关键：第二轮只喂模型自己那段输出，不能再喂 5000 字摘要/全文
  const repairText = calls[1].messages[0].content[0].text
  assert.ok(repairText.length < 600, `补救轮不该重发原文，实际 ${repairText.length} 字`)
  assert.match(repairText, /转换成 JSON/)
  assert.match(calls[1].system, /只输出 JSON/)

  assert.equal(summary.problem, '刚度衰减机理不清楚')
  assert.equal(summary.findings, '孔隙率是主因')
  // 补救成功 → 不打 salvaged（是真正的 JSON，不是硬拆的）
  assert.equal(summary.salvaged, undefined)
  assert.equal(summary.repaired, true)
})

test('summarizePaper 第一轮就是合法 JSON 时不做补救轮，省一次调用', async () => {
  const calls = []
  const ctx = ctxStub(llmStub({ tldr: '一句话' }, calls))
  const summary = await summarizePaper(ctx, {}, paper, topic)
  assert.equal(calls.length, 1)
  assert.equal(summary.tldr, '一句话')
  assert.equal(summary.repaired, undefined)
})
