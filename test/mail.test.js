import assert from 'node:assert/strict'
import test from 'node:test'

import { digestToHtml, textToHtml } from '../radar/mail.js'

const TOPICS = [
  { id: 't-1', name: '金属橡胶' },
  { id: 't-2', name: '气动弹性' },
]

function paper(overrides = {}) {
  return {
    id: 'openalex:W1',
    topicId: 't-1',
    topicName: '金属橡胶',
    source: 'openalex',
    title: 'Metal rubber isolators for vibration damping',
    authors: ['Wang J.', 'Li M.'],
    publishedAt: '2026-09-01',
    url: 'https://doi.org/10.1016/j.jsv.2026.1',
    doi: '10.1016/j.jsv.2026.1',
    venue: 'Journal of Sound and Vibration',
    citations: 4,
    openAccess: true,
    matchedIn: '标题',
    score: 12,
    summary: {
      tldr: '提出一种新的金属橡胶隔振器设计方法。',
      problem: '宽频减振',
      method: '实验 + 有限元',
      findings: '隔振效率提升 18%',
      innovation: '多孔结构拓扑优化',
      limitations: '样本量小',
      relevance: '与方向高度相关',
      tags: ['金属橡胶', '隔振'],
    },
    summaryError: '',
    discoveredAt: '2026-10-21T00:00:00.000Z',
    read: false,
    ...overrides,
  }
}

test('digestToHtml 渲染卡片式邮件骨架', () => {
  const html = digestToHtml([paper()], TOPICS)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<table role="presentation"/)
  // 邮件客户端会剥掉 style 标签，所以样式必须内联
  assert.doesNotMatch(html, /<style/)
  assert.doesNotMatch(html, /class=/)
  // 卡片左侧强调色边
  assert.match(html, /border-left:3px solid #4176e6/)
})

test('digestToHtml 按方向分组并带上篇数', () => {
  const html = digestToHtml([paper(), paper({ id: 'openalex:W2', topicId: 't-2', topicName: '气动弹性' })], TOPICS)
  assert.match(html, /金属橡胶/)
  assert.match(html, /气动弹性/)
  assert.match(html, /· 1 篇/)
})

test('digestToHtml 输出结构化摘要字段与标签', () => {
  const html = digestToHtml([paper()], TOPICS)
  assert.match(html, /一句话/)
  assert.match(html, /提出一种新的金属橡胶隔振器设计方法。/)
  assert.match(html, /创新点/)
  assert.match(html, /多孔结构拓扑优化/)
  assert.match(html, /隔振/)
  // 「摘要未提及」不应该占位
  assert.doesNotMatch(html, /摘要未提及/)
})

test('digestToHtml 在摘要失败时回退到原始摘要', () => {
  const html = digestToHtml(
    [paper({ summary: null, summaryError: 'LLM 超时', abstract: 'Raw abstract text.' })],
    TOPICS,
  )
  assert.match(html, /摘要生成失败/)
  assert.match(html, /LLM 超时/)
  assert.match(html, /Raw abstract text\./)
})

test('digestToHtml 转义 HTML，防止摘要注入标签', () => {
  const html = digestToHtml(
    [paper({ title: '<script>alert(1)</script>', summary: { ...paper().summary, tldr: '<b>x</b>' } })],
    TOPICS,
  )
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
})

test('digestToHtml 拒绝 javascript: 链接', () => {
  const html = digestToHtml([paper({ url: 'javascript:alert(1)' })], TOPICS)
  assert.doesNotMatch(html, /javascript:/)
})

test('digestToHtml 只有合法 panelUrl 才渲染按钮', () => {
  const withUrl = digestToHtml([paper()], TOPICS, { panelUrl: 'http://127.0.0.1:61819/?token=abc' })
  assert.match(withUrl, /在面板中查看/)
  assert.match(withUrl, /token=abc/)
  const withoutUrl = digestToHtml([paper()], TOPICS, { panelUrl: 'ftp://x' })
  assert.doesNotMatch(withoutUrl, /在面板中查看/)
})

test('digestToHtml 英文 locale', () => {
  const html = digestToHtml([paper()], TOPICS, { locale: 'en' })
  assert.match(html, /TL;DR/)
  assert.match(html, /Novelty/)
  assert.match(html, /1 new paper in this round/)
})

test('digestToHtml 空列表不炸', () => {
  const html = digestToHtml([], TOPICS)
  assert.match(html, /0 篇新论文/)
  assert.equal(typeof html, 'string')
})

test('textToHtml 仍然可用作兜底', () => {
  const html = textToHtml('第一段\n\n第二段')
  assert.match(html, /<p style=/)
  assert.match(html, /第一段/)
})
