import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SUMMARY_DEPTHS,
  DEFAULT_SUMMARY_DEPTH,
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
