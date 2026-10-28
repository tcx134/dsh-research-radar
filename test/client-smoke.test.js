/**
 * 客户端半边的渲染冒烟测试。
 *
 * client.js 是浏览器 bundle（`window.__ModuleLoader__.load` + `require('react')`），
 * 不能在 Node 里直接 import。这里用一个极小的 React 替身（createElement /
 * useState / useEffect / useCallback）把 factory 跑起来，再把返回的元素树
 * 展开成文本、找到按钮并模拟点击，验证：
 *   1. 首屏能渲染出论文卡片，不抛错；
 *   2. 已读 / 收藏筛选会带上正确的查询参数重新拉取；
 *   3. 点「标为已读」「收藏」会发出正确的 POST /item；
 *   4. 「加载更多」会用正确的 offset 拉下一页。
 *
 * 它挡不住样式问题，但能挡住「改了 client.js 之后面板直接白屏」这类事故。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const CLIENT_PATH = new URL('../client.js', import.meta.url)

/**
 * 极简 React 替身：只实现 client.js 用到的那几个 hook。
 *
 * hook 槽位按「组件函数」分帧，而不是全局一个游标：client.js 里的 Panel 会在
 * 自己的渲染里嵌 TopicForm / ItemCard / RankList 这些子组件，共用一个游标会让
 * 子组件的 useState 落到 Panel 的槽位上，表单状态就串了。
 * 这里用 Map<组件函数, {slots, cursor}> 给每种组件一个独立帧（测试里每种
 * 组件只有一个实例，够用）。
 */
function makeReact() {
  const frames = new Map()
  let current = null

  const ROOT = Symbol('root')
  const frameOf = (key) => {
    if (!frames.has(key)) frames.set(key, { slots: [], cursor: 0 })
    return frames.get(key)
  }
  const frame = () => current || frameOf(ROOT)

  const sameDeps = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }
    },
    useState(initial) {
      const f = frame()
      const index = f.cursor++
      if (index >= f.slots.length) {
        f.slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = f.slots[index]
      const set = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        slot.dirty = true
      }
      return [slot.value, set]
    },
    useEffect(fn, deps) {
      const f = frame()
      const index = f.cursor++
      const prev = f.slots[index]
      if (prev === undefined) {
        f.slots[index] = { deps, cleanup: fn() }
        return
      }
      if (deps === undefined || !sameDeps(prev.deps, deps)) {
        if (typeof prev.cleanup === 'function') prev.cleanup()
        prev.deps = deps
        prev.cleanup = fn()
      }
    },
    useCallback(fn, deps) {
      const f = frame()
      const index = f.cursor++
      const prev = f.slots[index]
      if (prev === undefined) {
        f.slots[index] = { deps, fn }
        return fn
      }
      if (deps === undefined || !sameDeps(prev.deps, deps)) {
        prev.deps = deps
        prev.fn = fn
      }
      return prev.fn
    },
  }

  return {
    React,
    /** 开始渲染根组件：游标归零。 */
    beginRender() {
      frameOf(ROOT).cursor = 0
      current = frameOf(ROOT)
    },
    /** 以某个子组件自己的帧执行一次渲染。 */
    withFrame(type, fn) {
      const prev = current
      const f = frameOf(type)
      f.cursor = 0
      current = f
      try {
        return fn()
      } finally {
        current = prev
      }
    },
    isDirty: () => [...frames.values()].some((f) => f.slots.some((s) => s && s.dirty === true)),
    clearDirty() {
      for (const f of frames.values()) for (const s of f.slots) if (s) s.dirty = false
    },
  }
}

/** 当前用于展开子组件的 mini（loadClient 里设置）。 */
let activeMini = null

/** 把元素树里的文本拼起来（用于断言面板真的画出了内容）。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node.type === 'function') {
    return textOf(activeMini.withFrame(node.type, () => node.type(node.props || {})))
  }
  return node.children.map(textOf).join(' ')
}


/** 深度优先找所有满足条件的元素。 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  if (typeof node.type === 'function') {
    findAll(activeMini.withFrame(node.type, () => node.type(node.props || {})), predicate, out)
    return out
  }
  findAll(node.children, predicate, out)
  return out
}

/** client.js 会用 document.createElement 插一段 <style>，这里给个最小替身。 */
function fakeDocument(lang) {
  const head = { children: [], append: (node) => head.children.push(node) }
  return {
    documentElement: { lang },
    head,
    createElement: (tag) => ({ tag, dataset: {}, textContent: '', remove() {} }),
  }
}

/**
 * 按可见文本找按钮。
 *
 * 用「整词」而不是 includes：面板里既有「标为已读」也有「全部标为已读」，
 * 用 includes 会先命中后者。计数徽标（`未读 1`）和星标前缀（`★ 取消收藏`）
 * 会让文本多出前后缀，所以额外允许「label + 空格开头」与「空格 + label 结尾」。
 */
const buttonByText = (tree, label) =>
  findAll(
    tree,
    (el) =>
      el.type === 'button' &&
      (() => {
        const text = textOf(el).trim()
        return text === label || text.startsWith(`${label} `) || text.endsWith(` ${label}`)
      })(),
  )[0] || null

/**
 * 按可见文本找复选框（`<label>文字<input type=checkbox></label>` 结构）。
 *
 * 语言过滤和数据库选择都是这种结构，文本在 input 之后，所以 textOf 会带前导空格。
 */
const checkboxByText = (tree, label) => {
  const labelEl = findAll(tree, (el) => el.type === 'label' && textOf(el).trim() === label)[0]
  if (labelEl === undefined) return null
  return (
    findAll(labelEl, (el) => el.type === 'input' && el.props && el.props.type === 'checkbox')[0] || null
  )
}

/** 载入 client.js，返回 { apply, Panel }。 */
async function loadClient(React, lang = 'zh', mini = null, workspace = undefined) {
  activeMini = mini || activeMini
  const source = await readFile(CLIENT_PATH, 'utf8')
  let factory = null
  const g = globalThis
  const prevWindow = g.window
  g.window = { __ModuleLoader__: { load: (record) => { factory = record.factory } } }
  // document 留到测试结束（Panel 首次渲染时会读 documentElement.lang）
  g.document = fakeDocument(lang)
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', source)(g.window, g.document)
  } finally {
    g.window = prevWindow
  }
  assert.equal(typeof factory, 'function', 'client.js 应该通过 __ModuleLoader__.load 注册 factory')

  const mod = factory((id) => {
    if (id === 'react') return React
    throw new Error(`未预期的 require(${id})`)
  })
  assert.deepEqual(mod.inject, ['slots', 'locale'])

  let Panel = null
  const workspaceCalls = []
  const ctx = {
    effect: (fn) => { fn() },
    locale: { register: () => {}, bind: () => (key) => key },
    slots: {
      inject: (name, fn) => fn(),
      register: (descriptor, component) => {
        if (descriptor.name === 'main') Panel = component
        return () => {}
      },
    },
    // Client 服务只从 ctx 取；面板的「精读」按钮走 uiWorkspace.startSession
    get: (name) =>
      name === 'uiWorkspace'
        ? workspace === undefined
          ? { startSession: (workspaceId, options) => { workspaceCalls.push({ workspaceId, options }) } }
          : workspace
        : undefined,
  }
  mod.apply(ctx)
  assert.equal(typeof Panel, 'function', '应该注册 main 槽位的 Panel 组件')
  return { Panel, workspaceCalls }
}

function sampleState() {
  return {
    topics: [{ id: 't-a', name: '金属橡胶' }],
    items: [
      {
        id: 'openalex:W1',
        topicId: 't-a',
        topicName: '金属橡胶',
        source: 'openalex',
        title: 'A frictional hysteresis model for metal rubber',
        authors: ['Zhang San', 'Li Si'],
        publishedAt: '2026-09-01',
        url: 'https://example.org/w1',
        venue: 'Mechanical Systems and Signal Processing',
        doi: '10.1016/j.ymssp.2026.1',
        citations: 7,
        openAccess: true,
        matchedIn: '标题',
        score: 13,
        read: false,
        starred: true,
        discoveredAt: '2026-10-20T10:00:00.000Z',
        quality: {
          score: 79,
          tier: 'high',
          impactFactor: 8.5127,
          journalHIndex: 154,
          quartile: 'Q1',
          citationPercentile: 92,
          reasons: ['期刊影响因子 8.5', '被引前 8%（Q1）', '被引 7 次', '开放获取（可抓全文）'],
        },
        summary: {
          tldr: '提出一种金属橡胶摩擦滞回模型。',
          problem: '现有模型在动态载荷下失准。',
          method: '边界耦合 + 实验标定。',
          findings: '误差降低 38%。',
          innovation: '统一准静态与动态。',
          limitations: '摘要未提及',
          relevance: '与减振设计直接相关。',
          tags: ['金属橡胶', '滞回'],
          basis: 'fulltext',
        },
      },
      {
        id: 'crossref:10.1/x',
        topicId: 't-a',
        topicName: '金属橡胶',
        source: 'crossref',
        title: 'Multiscale fretting damage of metal rubber',
        authors: ['Wang Wu'],
        publishedAt: '2026-08-15',
        url: 'https://example.org/w2',
        venue: 'Wear',
        doi: '',
        citations: 0,
        openAccess: false,
        matchedIn: '摘要',
        score: 10,
        read: true,
        starred: false,
        discoveredAt: '2026-10-20T09:00:00.000Z',
        summary: null,
        summaryError: 'LLM 未返回可解析的 JSON',
      },
    ],
    page: { total: 2, offset: 0, limit: 50, hasMore: true },
    counts: { all: 2, unread: 1, starred: 1, highQuality: 1, fullText: 1 },
    settings: {
      scan: {
        enabled: true,
        intervalHours: 12,
        maxPerTopic: 8,
        summarize: true,
        summaryDepth: 'standard',
        lookbackDays: 30,
        lastScanAt: null,
        lastScanNew: 0,
      },
      api: { mailto: '', openalexKey: '' },
      mail: { enabled: false, host: '', port: 465, secure: true, user: '', pass: '', from: '', to: '', lastSentAt: null },
      rss: [],
    },
    sources: {},
    summaryDepths: [
      { key: 'brief', fields: 3, abstractChars: 1500, maxTokens: 350, approxTokens: 1850 },
      { key: 'standard', fields: 7, abstractChars: 4000, maxTokens: 1000, approxTokens: 5000 },
      { key: 'deep', fields: 8, abstractChars: 6000, maxTokens: 1600, approxTokens: 7600 },
    ],
    status: {
      scanning: false,
      lastError: '',
      storePath: '/tmp/state.json',
      scanIntervalHours: 12,
      effectiveLookbackDays: 3,
    },
  }
}

/** 装一个假的 fetch，记录每次请求，按 URL 返回可配置的载荷。 */
function installFetch(handler) {
  const calls = []
  const prev = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    const payload = await handler(String(url), init)
    return {
      ok: payload.ok !== false,
      status: payload.ok === false ? 400 : 200,
      json: async () => payload.body,
    }
  }
  return { calls, restore: () => { globalThis.fetch = prev } }
}

/**
 * 渲染一次面板，并等首刷（useEffect 里的 refresh）落地后再渲染一次。
 *
 * 假 React 的 state 存在闭包里，setState 之后必须重新调用组件函数才会画出
 * 新内容 —— 真实 React 由调度器负责这件事，这里手动重渲染。
 */
async function mount(mini, Panel) {
  activeMini = mini
  mini.beginRender()
  Panel({})
  await new Promise((resolve) => setTimeout(resolve, 0))
  mini.beginRender()
  return Panel({})
}

test('面板首屏渲染出论文卡片、筛选条与摘要字段', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    const tree = await mount(mini, Panel)
    let text = textOf(tree)
    assert.match(text, /A frictional hysteresis model for metal rubber/)
    assert.match(text, /Multiscale fretting damage of metal rubber/)
    // 卡片默认只露「一句话结论」+ 质量徽章，六段细节收在「展开细节」后面。
    // 这是「UI 更直接」的核心：列表页一屏能扫完，不用读六段文字。
    assert.match(text, /提出一种金属橡胶摩擦滞回模型/)
    assert.doesNotMatch(text, /误差降低 38%/)
    assert.match(text, /展开细节/)
    buttonByText(tree, '展开细节').props.onClick()
    mini.beginRender()
    text = textOf(Panel({}))
    // 展开后才看得到结构化摘要的细节字段
    assert.match(text, /误差降低 38%/)
    // 「摘要未提及」的字段不应该占位
    assert.doesNotMatch(text, /摘要未提及/)
    // 摘要失败回退
    assert.match(text, /LLM 未返回可解析的 JSON/)
    // 收藏星标与未读点
    assert.match(text, /★/)
    // 质量徽章：没给 quality 的条目显示「待评估」
    assert.match(text, /待评估/)
    // 有 quality 的条目显示「高质量 · 79」与影响因子
    assert.match(text, /高质量 · 79/)
    assert.match(text, /影响因子 8\.5/)
    // 分区徽章：用户明确要看「几区」，独立于质量分显示（Q1 绿、Q4 灰）
    assert.match(text, /Q1/)
    const quartileChip = findAll(tree, (el) => typeof el.props?.className === 'string' && el.props.className.includes('drr-quartile-q1'))[0]
    assert.ok(quartileChip !== undefined, 'Q1 应该带 drr-quartile-q1 样式')
    // 没算过百分位的条目不该硬塞 Q4（`Number(null) === 0` 会把它标成末档）
    assert.doesNotMatch(text, /Q4/)
    // 「凭什么给这个分」默认收起，点质量徽章才展开
    assert.doesNotMatch(text, /期刊影响因子 8\.5/)
    buttonByText(tree, '高质量 · 79').props.onClick()
    mini.beginRender()
    text = textOf(Panel({}))
    assert.match(text, /依据: 期刊影响因子 8\.5 · 被引前 8%（Q1） · 被引 7 次 · 开放获取（可抓全文）/)
    // 顶部状态条把「上次扫描 / 本次窗口 / 读过全文」摆在列表上方
    assert.match(text, /上次扫描：/)
    assert.match(text, /本次窗口 3 天/)
    assert.match(text, /已读全文 1/)
    // 筛选条带计数
    assert.match(text, /全部\s*2/)
    assert.match(text, /未读\s*1/)
    assert.match(text, /收藏\s*1/)
    // 加载更多
    assert.match(text, /加载更多 \(2\/2\)/)
  } finally {
    fetchStub.restore()
  }
})

test('useEffect 触发首刷，并带上默认分页参数', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    await mount(mini, Panel)
    // useEffect 里的 refresh() 是异步的，等一轮微任务
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(fetchStub.calls.length, 1)
    assert.equal(fetchStub.calls[0].method, 'GET')
    assert.match(fetchStub.calls[0].url, /\/api\/dsh-research-radar\/state\?/)
    assert.match(fetchStub.calls[0].url, /limit=50/)
    assert.match(fetchStub.calls[0].url, /offset=0/)
    assert.doesNotMatch(fetchStub.calls[0].url, /filter=/)
  } finally {
    fetchStub.restore()
  }
})

test('点「未读」筛选会用 filter=unread 重新拉取', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch((url) => ({
    body: url.includes('filter=unread')
      ? { ...sampleState(), items: [sampleState().items[0]], page: { total: 1, offset: 0, limit: 50, hasMore: false } }
      : sampleState(),
  }))
  try {
    let tree = await mount(mini, Panel)
    const unreadButton = buttonByText(tree, '未读')
    assert.ok(unreadButton, '应该渲染出「未读」筛选按钮')
    unreadButton.props.onClick()
    tree = await mount(mini, Panel)
    const filtered = fetchStub.calls.filter((c) => c.url.includes('filter=unread'))
    assert.equal(filtered.length, 1, '切换筛选后应该带 filter=unread 拉一次')
    // 过滤后只剩一条未读卡片，已读那条不该再出现
    const text = textOf(tree)
    assert.match(text, /A frictional hysteresis model for metal rubber/)
    assert.doesNotMatch(text, /Multiscale fretting damage of metal rubber/)
  } finally {
    fetchStub.restore()
  }
})

test('点「标为已读」与「取消收藏」发出正确的 POST /item', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    const tree = await mount(mini, Panel)
    fetchStub.calls.length = 0

    const readButton = buttonByText(tree, '标为已读')
    assert.ok(readButton, '未读卡片应该有「标为已读」按钮')
    readButton.props.onClick()
    await new Promise((r) => setTimeout(r, 0))

    const unstarButton = buttonByText(tree, '取消收藏')
    assert.ok(unstarButton, '已收藏卡片应该有「取消收藏」按钮')
    unstarButton.props.onClick()
    await new Promise((r) => setTimeout(r, 0))

    const posts = fetchStub.calls.filter((c) => c.method === 'POST')
    assert.equal(posts.length, 2)
    assert.match(posts[0].url, /\/api\/dsh-research-radar\/item$/)
    assert.deepEqual(posts[0].body, { id: 'openalex:W1', read: true })
    assert.deepEqual(posts[1].body, { id: 'openalex:W1', starred: false })
  } finally {
    fetchStub.restore()
  }
})

test('「加载更多」用当前条数作为 offset', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch((url) => ({
    body: url.includes('offset=2')
      ? {
          ...sampleState(),
          items: [{ ...sampleState().items[0], id: 'openalex:W3', title: 'Third paper on metal rubber' }],
          page: { total: 3, offset: 2, limit: 50, hasMore: false },
        }
      : sampleState(),
  }))
  try {
    let tree = await mount(mini, Panel)
    const moreButton = buttonByText(tree, '加载更多')
    assert.ok(moreButton)
    moreButton.props.onClick()
    await new Promise((r) => setTimeout(r, 0))
    const page2 = fetchStub.calls.filter((c) => c.url.includes('offset=2'))
    assert.equal(page2.length, 1, '加载更多应该用 offset=2')
    tree = await mount(mini, Panel)
    const text = textOf(tree)
    assert.match(text, /Third paper on metal rubber/)
    assert.match(text, /没有更多了/)
  } finally {
    fetchStub.restore()
  }
})

test('「精读」按钮把论文提示词塞进新会话，并把该条标为已读', async () => {
  const mini = makeReact()
  const { Panel, workspaceCalls } = await loadClient(mini.React)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    const tree = await mount(mini, Panel)
    fetchStub.calls.length = 0

    const deepButton = buttonByText(tree, '精读')
    assert.ok(deepButton, '每张卡片都应该有「精读」按钮')
    deepButton.props.onClick()
    await new Promise((r) => setTimeout(r, 0))

    assert.equal(workspaceCalls.length, 1, '应该调用一次 uiWorkspace.startSession')
    const { workspaceId, options } = workspaceCalls[0]
    assert.equal(workspaceId, undefined, '不指定工作区，交给默认/最近工作区')
    assert.equal(options.clearPreviousDraft, false, '不该清掉用户已输入的草稿')
    const prompt = options.prompt
    assert.match(prompt, /A frictional hysteresis model for metal rubber/)
    assert.match(prompt, /10\.1016\/j\.ymssp\.2026\.1/)
    assert.match(prompt, /金属橡胶/, '提示词里要带方向名')
    assert.match(prompt, /https:\/\/example\.org\/w1/)
    assert.match(prompt, /不要编造/, '必须明确禁止编造')

    const posts = fetchStub.calls.filter((c) => c.method === 'POST')
    assert.equal(posts.length, 1, '精读后应顺手标为已读')
    assert.deepEqual(posts[0].body, { id: 'openalex:W1', read: true })
  } finally {
    fetchStub.restore()
  }
})

test('uiWorkspace 不可用时「精读」给出错误提示而不是崩掉', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React, 'zh', mini, null)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    const tree = await mount(mini, Panel)
    const deepButton = buttonByText(tree, '精读')
    assert.ok(deepButton)
    deepButton.props.onClick()
    await new Promise((r) => setTimeout(r, 0))
    const after = await mount(mini, Panel)
    assert.match(textOf(after), /无法发起精读/, '应该提示失败原因')
    const posts = fetchStub.calls.filter((c) => c.method === 'POST')
    assert.equal(posts.length, 0, '精读失败时不该标为已读')
  } finally {
    fetchStub.restore()
  }
})

test('关系网页拉 /graph 并画出主题节点、连线与空档', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const graphBody = {
    nodes: [
      { id: 'topic:t-a', label: '金属橡胶', weight: 9, recent: 6, tier: 'high', fresh: true },
      { id: '本构模型', label: '本构模型', weight: 4, recent: 1, tier: 'medium', fresh: false },
      { id: '隔振器', label: '隔振器', weight: 4, recent: 3, tier: 'medium', fresh: true },
      { id: '干摩擦', label: '干摩擦', weight: 2, recent: 2, tier: 'low', fresh: true },
    ],
    edges: [
      { source: 'topic:t-a', target: '本构模型', weight: 4, recent: 2 },
      { source: 'topic:t-a', target: '隔振器', weight: 3, recent: 2 },
    ],
    gaps: [
      { a: '本构模型', b: '隔振器', aLabel: '本构模型', bLabel: '隔振器', score: 6.1, aWeight: 4, bWeight: 4 },
    ],
    stats: { papers: 12, taggedPapers: 12, nodeCount: 4, edgeCount: 2, density: 0.333 },
  }
  const fetchStub = installFetch((url) => ({
    body: url.includes('/graph') ? graphBody : sampleState(),
  }))
  try {
    let tree = await mount(mini, Panel)
    const graphTab = buttonByText(tree, '关系网')
    assert.ok(graphTab, '应该渲染出「关系网」标签页')
    graphTab.props.onClick()
    tree = await mount(mini, Panel)

    const graphCalls = fetchStub.calls.filter((c) => c.url.includes('/graph'))
    assert.equal(graphCalls.length, 1, '打开关系网页应该拉一次 /graph')
    // 默认窗口是 1 年
    assert.match(graphCalls[0].url, /days=365/)

    const text = textOf(tree)
    assert.match(text, /金属橡胶/)
    assert.match(text, /本构模型/)
    assert.match(text, /隔振器/)
    // 统计数字：4 个主题 / 2 条关联 / 密度 0.333
    assert.match(text, /4/)
    assert.match(text, /0\.333/)
    // 空档清单：两个很热但没连过线的主题
    assert.match(text, /可能存在的新方向/)
    assert.match(text, /本构模型 × 隔振器/)

    // SVG 真的画出来了：4 个圆、2 条线
    const dots = findAll(tree, (el) => el.type === 'circle')
    assert.equal(dots.length, 4)
    const lines = findAll(tree, (el) => el.type === 'line')
    assert.equal(lines.length, 2)
    // 每个点都落在画布内（确定性布局不能把点甩出边界）
    for (const dot of dots) {
      assert.ok(dot.props.cx >= 0 && dot.props.cx <= 720, `圆点 x 越界: ${dot.props.cx}`)
      assert.ok(dot.props.cy >= 0 && dot.props.cy <= 420, `圆点 y 越界: ${dot.props.cy}`)
      assert.ok(dot.props.r > 0, '圆点半径应该为正')
    }
    // 「新出现」的主题带高亮描边类
    const fresh = findAll(tree, (el) => String(el.props?.className || '').includes('drr-g-fresh'))
    assert.equal(fresh.length, 3, '三条 fresh 的主题应该带高亮类')
  } finally {
    fetchStub.restore()
  }
})

test('关系网点和「可能存在的新方向」都能点，切换时间范围会重新拉', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const graphBody = {
    nodes: [
      { id: 'a', label: '甲甲', weight: 5, recent: 2, tier: 'high', fresh: false },
      { id: 'b', label: '乙乙', weight: 4, recent: 1, tier: 'medium', fresh: false },
      { id: 'c', label: '丙丙', weight: 3, recent: 1, tier: 'low', fresh: false },
    ],
    edges: [{ source: 'a', target: 'b', weight: 2, recent: 1 }],
    gaps: [{ a: 'b', b: 'c', aLabel: '乙乙', bLabel: '丙丙', score: 4, aWeight: 4, bWeight: 3 }],
    stats: { papers: 8, taggedPapers: 8, nodeCount: 3, edgeCount: 1, density: 0.333 },
  }
  const fetchStub = installFetch((url) => ({
    body: url.includes('/graph') ? graphBody : sampleState(),
  }))
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '关系网').props.onClick()
    tree = await mount(mini, Panel)

    // 点节点 → 聚焦，非邻居变淡
    const nodeGroup = findAll(tree, (el) => el.type === 'g' && String(el.props?.className || '').includes('drr-g-node'))[0]
    assert.ok(nodeGroup, '应该渲染出可点的主题节点')
    nodeGroup.props.onClick()
    tree = await mount(mini, Panel)
    let text = textOf(tree)
    assert.match(text, /看全部/, '聚焦后应该出现「看全部」按钮')
    const dimmed = findAll(tree, (el) => String(el.props?.className || '').includes('drr-g-dim'))
    assert.ok(dimmed.length >= 1, '非邻居节点应该变淡')

    // 点空档里的主题按钮也能聚焦
    buttonByText(tree, '丙丙').props.onClick()
    tree = await mount(mini, Panel)
    // 取消聚焦
    buttonByText(tree, '看全部').props.onClick()
    tree = await mount(mini, Panel)
    assert.doesNotMatch(textOf(tree), /看全部/)

    // 切成「全部」时间范围 → 重新拉一次，且不带 days
    const before = fetchStub.calls.filter((c) => c.url.includes('/graph')).length
    buttonByText(tree, '全部').props.onClick()
    tree = await mount(mini, Panel)
    const graphCalls = fetchStub.calls.filter((c) => c.url.includes('/graph'))
    assert.equal(graphCalls.length, before + 1, '切换时间范围应该重新拉 /graph')
    assert.doesNotMatch(graphCalls[graphCalls.length - 1].url, /days=/)
  } finally {
    fetchStub.restore()
  }
})

test('关系网加载失败时给出错误提示而不是白屏', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch((url) => {
    if (url.includes('/graph')) return { ok: false, body: {} }
    return { body: sampleState() }
  })
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '关系网').props.onClick()
    tree = await mount(mini, Panel)
    assert.match(textOf(tree), /关系网加载失败/)
  } finally {
    fetchStub.restore()
  }
})

test('关系网没有空档时，用两种不同的话说明原因', async () => {
  const base = {
    nodes: [
      { id: '甲', label: '甲', weight: 4, recent: 4, tier: 'high', fresh: true },
      { id: '乙', label: '乙', weight: 4, recent: 4, tier: 'high', fresh: true },
    ],
    edges: [{ source: '甲', target: '乙', weight: 4, recent: 4 }],
    gaps: [],
    stats: { papers: 8, taggedPapers: 8, nodeCount: 2, edgeCount: 1, density: 1, hubCount: 2, hubMinWeight: 3 },
  }
  // 每次都要重新挂载：/graph 只在 graphDays / topicFilter 变化时才重拉，
  // 只改 body 再 mount 不会触发请求，会读到上一次的结果。
  const render = async (graphBody) => {
    const mini = makeReact()
    const { Panel } = await loadClient(mini.React)
    const fetchStub = installFetch((url) => ({ body: url.includes('/graph') ? graphBody : sampleState() }))
    try {
      let tree = await mount(mini, Panel)
      buttonByText(tree, '关系网').props.onClick()
      tree = await mount(mini, Panel)
      return textOf(tree)
    } finally {
      fetchStub.restore()
    }
  }

  // ① 主题够多、但都已经连起来了 → 这是好消息，不是没数据
  const dense = await render(base)
  assert.match(dense, /连线已经比较密/)
  assert.doesNotMatch(dense, /够热的主题太少/)

  // ② 够热的主题不足两个 → 说明是样本不够，别让用户以为功能坏了
  const thin = await render({ ...base, stats: { ...base.stats, hubCount: 1 } })
  assert.match(thin, /够热的主题太少/)
  assert.match(thin, /至少要出现在这么多篇论文里 3 篇/, '要把门槛说清楚，别只说「不够」')
  assert.doesNotMatch(thin, /连线已经比较密/)
})

test('趋势页会拉 /stats 并渲染周柱状图与榜单', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const statsBody = {
    windowDays: 90,
    topicId: '',
    total: 12,
    readCount: 5,
    starredCount: 3,
    summarizedCount: 11,
    weeks: [
      { week: '2026-10-05', count: 2 },
      { week: '2026-10-12', count: 0 },
      { week: '2026-10-19', count: 10 },
    ],
    weeklyPeak: 10,
    bySource: [{ key: 'openalex', count: 9, label: 'OpenAlex（SCI 期刊综合库）' }],
    byVenue: [{ key: 'Wear', count: 4 }],
    byAuthor: [{ key: 'Li Y', count: 3 }],
    byTopic: [{ key: 't-a', count: 12, label: '金属橡胶' }],
    byTag: [{ key: '滞回', count: 6 }],
  }
  const fetchStub = installFetch((url) => ({
    body: url.includes('/stats') ? statsBody : sampleState(),
  }))
  try {
    let tree = await mount(mini, Panel)
    const statsTab = buttonByText(tree, '趋势')
    assert.ok(statsTab, '应该渲染出「趋势」标签页')
    statsTab.props.onClick()
    tree = await mount(mini, Panel)

    const statsCalls = fetchStub.calls.filter((c) => c.url.includes('/stats'))
    assert.equal(statsCalls.length, 1, '打开趋势页应该拉一次 /stats')
    assert.match(statsCalls[0].url, /days=90/)

    const text = textOf(tree)
    assert.match(text, /12\s*论文总数/)
    assert.match(text, /5\s*已读/)
    assert.match(text, /3\s*已收藏/)
    assert.match(text, /11\s*已摘要/)
    assert.match(text, /每周新增/)
    assert.match(text, /2026-10-05/)
    assert.match(text, /2026-10-19/)
    // 榜单：来源用 label、期刊 / 作者 / 标签用原名
    assert.match(text, /OpenAlex（SCI 期刊综合库）/)
    assert.match(text, /Wear/)
    assert.match(text, /Li Y/)
    assert.match(text, /滞回/)
    // 柱状图应该真的画出来（3 周 → 3 根）
    const bars = findAll(tree, (el) => el.props && el.props.className === 'drr-bar')
    assert.equal(bars.length, 3)
  } finally {
    fetchStub.restore()
  }
})

test('趋势页在窗口内没有数据时给出空态提示', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch((url) => ({
    body: url.includes('/stats')
      ? {
          windowDays: 30,
          topicId: '',
          total: 0,
          readCount: 0,
          starredCount: 0,
          summarizedCount: 0,
          weeks: [],
          weeklyPeak: 0,
          bySource: [],
          byVenue: [],
          byAuthor: [],
          byTopic: [],
          byTag: [],
        }
      : sampleState(),
  }))
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '趋势').props.onClick()
    tree = await mount(mini, Panel)
    assert.match(textOf(tree), /这个窗口内还没有数据/)
  } finally {
    fetchStub.restore()
  }
})

test('论文库页按年份分架渲染，标出老论文与计数', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const libraryBody = {
    groupBy: 'year',
    topicId: '',
    total: 5,
    groups: [
      {
        key: '2026',
        label: '2026',
        count: 2,
        oldCount: 0,
        unreadCount: 1,
        items: [
          {
            id: 'openalex:W1',
            title: 'Fresh metal rubber model',
            authors: ['Li Y'],
            authorCount: 1,
            venue: 'Wear',
            publishedAt: '2026-10-01',
            url: 'https://example.org/1',
            citations: 3,
            read: false,
            starred: false,
            hasSummary: true,
            summaryDepth: 'brief',
            freshness: 'new',
            ageDays: 21,
          },
          {
            id: 'openalex:W2',
            title: 'Another fresh one',
            authors: ['Wang H'],
            authorCount: 1,
            venue: 'MSSP',
            publishedAt: '2026-09-01',
            url: 'https://example.org/2',
            citations: 0,
            read: true,
            starred: false,
            hasSummary: false,
            summaryDepth: '',
            freshness: 'new',
            ageDays: 51,
          },
        ],
      },
      {
        key: '2023',
        label: '2023',
        count: 3,
        oldCount: 3,
        unreadCount: 2,
        items: [
          {
            id: 'openalex:W3',
            title: 'Backfilled classic paper',
            authors: ['Zhang Q'],
            authorCount: 1,
            venue: 'JSV',
            publishedAt: '2023-04-01',
            url: 'https://example.org/3',
            citations: 1398,
            read: false,
            starred: true,
            hasSummary: false,
            summaryDepth: '',
            freshness: 'old',
            ageDays: 1300,
          },
        ],
      },
    ],
    summary: {
      oldestYear: '2023',
      newestYear: '2026',
      oldCount: 3,
      newCount: 2,
      unreadCount: 3,
      starredCount: 1,
      summarizedCount: 2,
    },
  }
  const fetchStub = installFetch((url) => ({
    body: url.includes('/library') ? libraryBody : sampleState(),
  }))
  try {
    let tree = await mount(mini, Panel)
    const libTab = buttonByText(tree, '论文库')
    assert.ok(libTab, '应该渲染出「论文库」标签页')
    libTab.props.onClick()
    tree = await mount(mini, Panel)

    const libCalls = fetchStub.calls.filter((c) => c.url.includes('/library'))
    assert.equal(libCalls.length, 1, '打开论文库应该拉一次 /library')
    assert.match(libCalls[0].url, /groupBy=year/)

    const text = textOf(tree)
    // 两个年份架都在，老论文架有角标
    assert.match(text, /2026/)
    assert.match(text, /2023/)
    assert.match(text, /Backfilled classic paper/)
    assert.match(text, /Fresh metal rubber model/)
    // 顶部数字卡：总数 5、覆盖年份 2023–2026、老论文 3
    assert.match(text, /5\s*库内论文/)
    assert.match(text, /2023–2026\s*覆盖年份/)
    assert.match(text, /3\s*老论文/)
    // 每架有篇数与「老论文 N」角标
    assert.match(text, /3\s*篇/)
    assert.match(text, /老论文\s*3/)
    // 引文数写出来了
    assert.match(text, /引 1398/)
    // 架子元素真的画出来了
    const shelves = findAll(tree, (el) => el.props && el.props.className === 'drr-shelf')
    assert.equal(shelves.length, 2)
    // 老论文行有 old 角标
    const marks = findAll(tree, (el) => el.props && String(el.props.className || '').includes('drr-book-mark-old'))
    assert.ok(marks.length >= 1, '老论文应该有 old 角标')
  } finally {
    fetchStub.restore()
  }
})

test('论文库可以切到按方向分架，并在空库时给提示', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const topicLib = {
    groupBy: 'topic',
    topicId: '',
    total: 1,
    groups: [
      {
        key: 't-a',
        label: '金属橡胶',
        count: 1,
        oldCount: 0,
        unreadCount: 1,
        items: [
          {
            id: 'openalex:W9',
            title: 'Topic shelf paper',
            authors: [],
            authorCount: 0,
            venue: 'Wear',
            publishedAt: '2026-10-10',
            url: 'https://example.org/9',
            citations: 0,
            read: false,
            starred: false,
            hasSummary: true,
            summaryDepth: 'standard',
            freshness: 'new',
            ageDays: 12,
          },
        ],
      },
    ],
    summary: {
      oldestYear: '2026',
      newestYear: '2026',
      oldCount: 0,
      newCount: 1,
      unreadCount: 1,
      starredCount: 0,
      summarizedCount: 1,
    },
  }
  const emptyLib = {
    groupBy: 'year',
    topicId: '',
    total: 0,
    groups: [],
    summary: {
      oldestYear: '',
      newestYear: '',
      oldCount: 0,
      newCount: 0,
      unreadCount: 0,
      starredCount: 0,
      summarizedCount: 0,
    },
  }
  let useEmpty = false
  const fetchStub = installFetch((url) => {
    if (url.includes('/library')) {
      return { body: useEmpty ? emptyLib : url.includes('groupBy=topic') ? topicLib : topicLib }
    }
    return { body: sampleState() }
  })
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '论文库').props.onClick()
    tree = await mount(mini, Panel)
    assert.match(textOf(tree), /Topic shelf paper/)
    assert.match(textOf(tree), /金属橡胶/)

    // 切「按方向」应该重新拉一次带 groupBy=topic
    const before = fetchStub.calls.filter((c) => c.url.includes('/library')).length
    buttonByText(tree, '按方向').props.onClick()
    tree = await mount(mini, Panel)
    const after = fetchStub.calls.filter((c) => c.url.includes('/library'))
    assert.equal(after.length, before + 1)
    assert.match(after[after.length - 1].url, /groupBy=topic/)

    // 空库给提示
    useEmpty = true
    buttonByText(tree, '按年份').props.onClick()
    tree = await mount(mini, Panel)
    assert.match(textOf(tree), /论文库还是空的/)
  } finally {
    fetchStub.restore()
  }
})

test('方向表单能勾选文献语言，并随 upsert 一起提交', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '研究方向').props.onClick()
    tree = await mount(mini, Panel)
    buttonByText(tree, '添加方向').props.onClick()
    tree = await mount(mini, Panel)

    const nameInput = findAll(
      tree,
      (el) => el.type === 'input' && el.props && el.props.className === 'drr-input',
    )[0]
    assert.ok(nameInput, '方向表单应该有名称输入框')
    nameInput.props.onChange({ target: { value: '中文金属橡胶' } })

    const zhBox = checkboxByText(tree, '中文文献')
    assert.ok(zhBox, '方向表单里应该有「中文文献」复选框')
    zhBox.props.onChange({ target: { checked: true } })
    tree = await mount(mini, Panel)

    fetchStub.calls.length = 0
    buttonByText(tree, '保存').props.onClick()
    await new Promise((r) => setTimeout(r, 0))

    const post = fetchStub.calls.find((c) => c.method === 'POST' && c.url.endsWith('/topics'))
    assert.ok(post, '保存方向应该 POST /topics')
    assert.equal(post.body.topic.name, '中文金属橡胶')
    assert.deepEqual(post.body.topic.languages, ['zh'])
  } finally {
    fetchStub.restore()
  }
})

test('中英文都勾选时提交空数组（后端语义 = 不限语言）', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '研究方向').props.onClick()
    tree = await mount(mini, Panel)
    buttonByText(tree, '添加方向').props.onClick()
    tree = await mount(mini, Panel)

    findAll(tree, (el) => el.type === 'input' && el.props && el.props.className === 'drr-input')[0]
      .props.onChange({ target: { value: '中英文都要' } })
    checkboxByText(tree, '中文文献').props.onChange({ target: { checked: true } })
    tree = await mount(mini, Panel)
    checkboxByText(tree, '英文文献').props.onChange({ target: { checked: true } })
    tree = await mount(mini, Panel)

    fetchStub.calls.length = 0
    buttonByText(tree, '保存').props.onClick()
    await new Promise((r) => setTimeout(r, 0))

    const post = fetchStub.calls.find((c) => c.method === 'POST' && c.url.endsWith('/topics'))
    assert.deepEqual(post.body.topic.languages, [])
  } finally {
    fetchStub.restore()
  }
})

test('方向列表展示语言过滤，编辑时复选框回填', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const state = sampleState()
  state.topics = [
    {
      id: 't-a',
      name: '金属橡胶',
      keywords: ['metal rubber'],
      sources: ['openalex'],
      languages: ['zh'],
    },
  ]
  const fetchStub = installFetch(() => ({ body: state }))
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '研究方向').props.onClick()
    tree = await mount(mini, Panel)
    assert.match(textOf(tree), /文献语言：中文文献/)

    buttonByText(tree, '编辑').props.onClick()
    tree = await mount(mini, Panel)
    const zhBox = checkboxByText(tree, '中文文献')
    const enBox = checkboxByText(tree, '英文文献')
    assert.ok(zhBox && enBox)
    assert.equal(zhBox.props.checked, true, '已有 languages:[zh] 时中文应勾上')
    assert.equal(enBox.props.checked, false)
  } finally {
    fetchStub.restore()
  }
})

test('英文语言环境下界面文案切换成英文', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React, 'en-US')
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    const tree = await mount(mini, Panel)
    const text = textOf(tree)
    assert.match(text, /Load more/)
    assert.match(text, /Unread/)
    assert.match(text, /Starred/)
  } finally {
    fetchStub.restore()
  }
})

test('设置页能选时间范围预设与解析深度，并随 settings 一起提交', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch(() => ({ body: sampleState() }))
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '设置').props.onClick()
    tree = await mount(mini, Panel)

    // 时间范围预设：点「1 年」应把 lookbackDays 改成 365
    buttonByText(tree, '1 年').props.onClick()
    tree = await mount(mini, Panel)
    assert.equal(buttonByText(tree, '1 年').props.className, 'drr-seg-on')

    // 解析深度：默认 standard 高亮，点「精简」切到 brief
    assert.equal(buttonByText(tree, '标准 · 5k').props.className, 'drr-seg-on')
    buttonByText(tree, '精简 · 1.9k').props.onClick()
    tree = await mount(mini, Panel)

    fetchStub.calls.length = 0
    buttonByText(tree, '保存').props.onClick()
    await new Promise((r) => setTimeout(r, 0))

    const post = fetchStub.calls.find((c) => c.method === 'POST' && c.url.endsWith('/settings'))
    assert.ok(post, '保存设置应该 POST /settings')
    assert.equal(post.body.settings.scan.lookbackDays, 365)
    assert.equal(post.body.settings.scan.summaryDepth, 'brief')
  } finally {
    fetchStub.restore()
  }
})

test('「回溯检索」用当前窗口强制扫描，不被增量窗口收窄', async () => {
  const mini = makeReact()
  const { Panel } = await loadClient(mini.React)
  const fetchStub = installFetch((url) => {
    if (url.includes('/scan')) {
      return { body: { ok: true, newCount: 2, lookbackDays: 730, summaryDepth: 'standard', errors: [], mail: null, items: [], state: sampleState() } }
    }
    return { body: sampleState() }
  })
  try {
    let tree = await mount(mini, Panel)
    buttonByText(tree, '设置').props.onClick()
    tree = await mount(mini, Panel)
    buttonByText(tree, '2 年').props.onClick()
    tree = await mount(mini, Panel)

    fetchStub.calls.length = 0
    buttonByText(tree, '回溯检索').props.onClick()
    await new Promise((r) => setTimeout(r, 0))

    const post = fetchStub.calls.find((c) => c.method === 'POST' && c.url.endsWith('/scan'))
    assert.ok(post, '回溯检索应该 POST /scan')
    assert.equal(post.body.lookbackDays, 730)

    // 结果提示里要带上「实际窗口 + 解析深度」，否则窗口被增量收窄时用户会以为坏了
    tree = await mount(mini, Panel)
    const note = textOf(tree)
    assert.ok(note.includes('本次窗口 730 天'), `提示里应报告实际窗口，实际：${note.slice(0, 200)}`)
    assert.ok(note.includes('解析深度 标准'), '提示里应报告解析深度')
  } finally {
    fetchStub.restore()
  }
})
