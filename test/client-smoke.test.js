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
        summary: {
          tldr: '提出一种金属橡胶摩擦滞回模型。',
          problem: '现有模型在动态载荷下失准。',
          method: '边界耦合 + 实验标定。',
          findings: '误差降低 38%。',
          innovation: '统一准静态与动态。',
          limitations: '摘要未提及',
          relevance: '与减振设计直接相关。',
          tags: ['金属橡胶', '滞回'],
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
    counts: { all: 2, unread: 1, starred: 1 },
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
    const text = textOf(tree)
    assert.match(text, /A frictional hysteresis model for metal rubber/)
    assert.match(text, /Multiscale fretting damage of metal rubber/)
    // 结构化摘要字段
    assert.match(text, /提出一种金属橡胶摩擦滞回模型/)
    assert.match(text, /误差降低 38%/)
    // 「摘要未提及」的字段不应该占位
    assert.doesNotMatch(text, /摘要未提及/)
    // 摘要失败回退
    assert.match(text, /LLM 未返回可解析的 JSON/)
    // 收藏星标与未读点
    assert.match(text, /★/)
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
