import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 建一个临时数据目录，测试结束自动删掉。
 * @param {{ after: (fn: () => unknown) => void }} t node:test 的上下文
 * @returns {Promise<string>}
 */
export async function tempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drr-test-'))
  t.after(() => fsp.rm(dir, { recursive: true, force: true }))
  return dir
}

/** 最小可用的 host ctx 桩：只实现 index.js 真正用到的接口。 */
export function makeCtx() {
  const disposers = []
  const registered = { routes: [], tools: [] }
  return {
    registered,
    logger: { info() {}, warn() {}, error() {} },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => dispose?.()
    },
    webServer: {
      register(route) {
        registered.routes.push(route)
        return () => {}
      },
    },
    tools: {
      register(tool) {
        registered.tools.push(tool)
        return () => {}
      },
    },
    timer: {
      interval(fn, ms) {
        registered.timerMs = ms
        return () => {}
      },
    },
    llm: { stream: async () => ({}) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    disposeAll() {
      for (const dispose of disposers) dispose()
    },
  }
}

/** 用假 req/res 调一次路由，返回 {status, body}。 */
export async function call(ctx, { method = 'GET', url = '/', headers = {}, body = null }) {
  const route = ctx.registered.routes[0]
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:61819', 'x-dsh-research-radar': '1', ...headers },
    on(event, handler) {
      if (event === 'data' && body !== null) handler(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') handler()
      return req
    },
    destroy() {},
  }
  const res = {
    statusCode: 0,
    headers: {},
    payload: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    end(chunk) {
      this.payload += chunk ?? ''
    },
  }
  await route.handler(req, res)
  return { status: res.statusCode, body: res.payload === '' ? null : JSON.parse(res.payload) }
}

/**
 * 往数据目录里预置一份 state.json（绕过 store 的写入队列，直接落盘）。
 * @param {string} dir
 * @param {object} state
 */
export async function seedState(dir, state) {
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8')
}
