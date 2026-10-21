import assert from 'node:assert/strict'
import test from 'node:test'

import { Config, CONFIG_LOCALES, validateConfig } from '../radar/config.js'

test('Config 暴露 Standard Schema v1 接口', () => {
  assert.equal(Config['~standard'].version, 1)
  assert.equal(typeof Config['~standard'].validate, 'function')
  // DSH loader 只调用 validate，返回 {value} 或 {issues}
  const ok = Config['~standard'].validate({})
  assert.ok('value' in ok)
  const bad = Config['~standard'].validate({ locale: 'fr' })
  assert.ok('issues' in bad)
})

test('缺省配置回填默认值', () => {
  const result = validateConfig(undefined)
  assert.equal(result.value.dataDir, '')
  assert.equal(result.value.llmProvider, '')
  assert.equal(result.value.llmModel, '')
  assert.equal(result.value.locale, 'zh')
})

test('字符串字段会 trim，空串保持空串', () => {
  const result = validateConfig({ dataDir: '  /tmp/radar  ', llmProvider: ' deepseek ', llmModel: '' })
  assert.equal(result.value.dataDir, '/tmp/radar')
  assert.equal(result.value.llmProvider, 'deepseek')
  assert.equal(result.value.llmModel, '')
})

test('locale 只接受 zh / en', () => {
  assert.deepEqual(CONFIG_LOCALES, ['zh', 'en'])
  assert.equal(validateConfig({ locale: 'en' }).value.locale, 'en')
  assert.equal(validateConfig({ locale: 'zh' }).value.locale, 'zh')
  const bad = validateConfig({ locale: 'fr' })
  assert.equal(bad.value, undefined)
  assert.equal(bad.issues.length, 1)
  assert.equal(bad.issues[0].path[0], 'locale')
})

test('类型不对时报可读的中文错误', () => {
  const result = validateConfig({ dataDir: 42 })
  assert.equal(result.issues[0].path[0], 'dataDir')
  assert.match(result.issues[0].message, /必须是字符串/)
})

test('未知字段被忽略而不是报错（profile 里可能残留旧字段）', () => {
  const result = validateConfig({ dataDir: '/x', legacyThing: true, another: [1, 2] })
  assert.equal(result.value.dataDir, '/x')
  assert.equal('legacyThing' in result.value, false)
})

test('非对象 config 报错', () => {
  assert.ok('issues' in validateConfig('nope'))
  assert.ok('issues' in validateConfig([1, 2]))
})

test('fields / defaultOf 给文档与兜底用', () => {
  assert.ok(Array.isArray(Config.fields))
  assert.equal(Config.fields.length, 4)
  assert.deepEqual(Config.fields.find((f) => f.key === 'locale').enum, ['zh', 'en'])
  assert.equal(Config.defaultOf('locale'), 'zh')
  assert.equal(Config.defaultOf('nope'), undefined)
})
