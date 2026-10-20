import { collectFromSource } from './sources.js'
import { summarizePaper } from './summarize.js'
import { sendMail, textToHtml } from './mail.js'

const MAX_ITEMS_KEPT = 500
const MAX_TOPICS = 20

function nowIso() {
  return new Date().toISOString()
}

function topicLabel(topic) {
  return topic.name || topic.id
}

/**
 * 组织一封摘要邮件正文。
 */
export function buildDigest(items, topics) {
  const byTopic = new Map()
  for (const item of items) {
    const key = item.topicId || 'unknown'
    if (!byTopic.has(key)) byTopic.set(key, [])
    byTopic.get(key).push(item)
  }
  const topicNames = new Map(topics.map((t) => [t.id, topicLabel(t)]))
  const lines = []
  lines.push(`本次共发现 ${items.length} 篇新论文。`)
  lines.push('')

  for (const [topicId, group] of byTopic) {
    lines.push(`■ ${topicNames.get(topicId) ?? topicId}（${group.length} 篇）`)
    lines.push('')
    for (const item of group) {
      lines.push(`· ${item.title}`)
      const meta = [item.venue, item.source, item.publishedAt ? item.publishedAt.slice(0, 10) : '']
        .filter(Boolean)
        .join(' · ')
      if (meta !== '') lines.push(`  ${meta}`)
      if (item.authors.length > 0) lines.push(`  作者：${item.authors.slice(0, 6).join(', ')}`)
      if (item.matchedIn) lines.push(`  命中：${item.matchedIn}`)
      lines.push(`  链接：${item.url}`)
      const s = item.summary
      if (s !== null && typeof s === 'object') {
        if (s.tldr) lines.push(`  一句话：${s.tldr}`)
        if (s.problem) lines.push(`  问题：${s.problem}`)
        if (s.method) lines.push(`  方法：${s.method}`)
        if (s.findings) lines.push(`  内容与结论：${s.findings}`)
        if (s.innovation) lines.push(`  创新点：${s.innovation}`)
        if (s.limitations) lines.push(`  局限：${s.limitations}`)
        if (s.relevance) lines.push(`  相关性：${s.relevance}`)
        if (Array.isArray(s.tags) && s.tags.length > 0) lines.push(`  标签：${s.tags.join('、')}`)
      } else if (item.summaryError) {
        lines.push(`  （摘要生成失败：${item.summaryError}）`)
        if (item.abstract) lines.push(`  原始摘要：${item.abstract.slice(0, 800)}`)
      } else if (item.abstract) {
        lines.push(`  摘要：${item.abstract.slice(0, 800)}`)
      }
      lines.push('')
    }
  }
  lines.push('—— 由 DSH 研究前沿雷达自动生成')
  return lines.join('\n')
}

/**
 * 执行一次扫描。
 * @param {object} ctx Harness host context
 * @param {object} config 插件配置
 * @param {object} store createStore 返回的 store
 * @param {{ topicIds?: string[], reason?: string }} options
 */
export async function runScan(ctx, config, store, options = {}) {
  const startedAt = nowIso()
  const state = await store.load()
  const settings = state.settings
  const requested = Array.isArray(options.topicIds) ? options.topicIds : null

  const targets = state.topics
    .filter((t) => t.enabled)
    .filter((t) => requested === null || requested.includes(t.id))
    .slice(0, MAX_TOPICS)

  const result = {
    startedAt,
    finishedAt: null,
    reason: options.reason ?? 'manual',
    scannedTopics: [],
    newItems: [],
    errors: [],
    mail: null,
  }

  if (targets.length === 0) {
    result.finishedAt = nowIso()
    result.errors.push({ source: 'topics', message: '没有启用的研究方向，请先在面板里添加' })
    return result
  }

  const fresh = []
  for (const topic of targets) {
    result.scannedTopics.push({ id: topic.id, name: topicLabel(topic) })
    for (const source of topic.sources) {
      const { items, errors } = await collectFromSource({
        source,
        topic,
        max: settings.scan.maxPerTopic,
        rss: settings.rss,
        api: settings.api,
        lookbackDays: settings.scan.lookbackDays,
      })
      for (const error of errors) {
        result.errors.push({ topic: topicLabel(topic), ...error })
      }
      for (const raw of items) {
        if (raw === null || typeof raw.id !== 'string' || raw.id === '') continue
        if (Object.prototype.hasOwnProperty.call(state.seen, raw.id)) continue
        if (fresh.some((f) => f.id === raw.id)) continue
        fresh.push({
          ...raw,
          topicId: topic.id,
          topicName: topicLabel(topic),
          discoveredAt: nowIso(),
          read: false,
          summary: null,
          summaryError: '',
        })
      }
    }
  }

  // 跨方向去重后按相关度重排，保证最贴题的排在最前面
  fresh.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))
  })

  // 逐篇生成结构化摘要（失败不阻断其它论文；单篇最多重试一次）
  if (settings.scan.summarize && fresh.length > 0) {
    for (const item of fresh) {
      const topic = targets.find((t) => t.id === item.topicId) ?? {}
      let lastError = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          item.summary = await summarizePaper(ctx, config, item, topic, undefined)
          item.summaryError = ''
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2500))
        }
      }
      if (lastError !== null) {
        item.summaryError = String(lastError?.message ?? lastError)
        result.errors.push({ topic: item.topicName, source: 'summary', message: item.summaryError })
      }
    }
  }

  await store.mutate((draft) => {
    for (const item of fresh) {
      draft.items.unshift(item)
      draft.seen[item.id] = item.discoveredAt
    }
    if (draft.items.length > MAX_ITEMS_KEPT) {
      draft.items = draft.items.slice(0, MAX_ITEMS_KEPT)
    }
    draft.settings.scan.lastScanAt = nowIso()
    draft.settings.scan.lastScanNew = fresh.length
  })

  result.newItems = fresh
  result.finishedAt = nowIso()

  // 邮件推送
  if (settings.mail.enabled && fresh.length > 0) {
    try {
      const text = buildDigest(fresh, state.topics)
      const info = await sendMail(settings.mail, {
        to: String(settings.mail.to ?? '')
          .split(/[,;\s]+/)
          .filter(Boolean),
        subject: `[研究前沿雷达] ${fresh.length} 篇新论文 · ${new Date().toLocaleDateString('zh-CN')}`,
        text,
        html: textToHtml(text),
      })
      result.mail = { ok: true, recipients: info.recipients }
      await store.mutate((draft) => {
        draft.settings.mail.lastSentAt = nowIso()
      })
    } catch (error) {
      result.mail = { ok: false, message: String(error?.message ?? error) }
      result.errors.push({ source: 'mail', message: result.mail.message })
    }
  } else if (settings.mail.enabled) {
    result.mail = { ok: true, skipped: '本次没有新论文' }
  }

  return result
}
