import net from 'node:net'
import tls from 'node:tls'
import os from 'node:os'
import crypto from 'node:crypto'

/**
 * 零依赖 SMTP 客户端。
 * 支持：隐式 TLS(465) / STARTTLS(587) / 明文(25，仅内网)，AUTH LOGIN 与 AUTH PLAIN。
 */

const SMTP_TIMEOUT_MS = 30000

class SmtpConnection {
  constructor(socket) {
    this.socket = socket
    this.buffer = ''
    this.waiters = []
    this.closed = false
    this.error = null
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      this.buffer += chunk
      this.#drain()
    })
    socket.on('error', (error) => {
      this.error = error
      this.closed = true
      this.#drain()
    })
    socket.on('close', () => {
      this.closed = true
      this.#drain()
    })
  }

  #drain() {
    while (this.waiters.length > 0) {
      const reply = this.#takeReply()
      if (reply === null) break
      const waiter = this.waiters.shift()
      waiter.resolve(reply)
    }
    if (this.closed && this.waiters.length > 0) {
      const waiters = this.waiters.splice(0)
      for (const waiter of waiters) {
        waiter.reject(this.error ?? new Error('SMTP 连接已关闭'))
      }
    }
  }

  /** 读取一个完整的多行响应（形如 "250-XXX\r\n250 YYY\r\n"） */
  #takeReply() {
    let offset = 0
    for (;;) {
      const index = this.buffer.indexOf('\n', offset)
      if (index === -1) return null
      const line = this.buffer.slice(offset, index).replace(/\r$/, '')
      if (line.length >= 4 && line[3] === ' ') {
        const full = this.buffer.slice(0, index + 1)
        this.buffer = this.buffer.slice(index + 1)
        const code = Number(line.slice(0, 3))
        return { code, lines: full.split(/\r?\n/).filter((l) => l !== ''), text: line.slice(4) }
      }
      offset = index + 1
    }
  }

  read() {
    const reply = this.#takeReply()
    if (reply !== null) return Promise.resolve(reply)
    if (this.closed) return Promise.reject(this.error ?? new Error('SMTP 连接已关闭'))
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  write(line) {
    if (this.closed) return Promise.reject(new Error('SMTP 连接已关闭'))
    return new Promise((resolve, reject) => {
      this.socket.write(line, (error) => (error ? reject(error) : resolve()))
    })
  }

  async command(line, expect) {
    await this.write(`${line}\r\n`)
    const reply = await this.read()
    if (expect !== undefined && reply.code !== expect) {
      throw new Error(`SMTP 命令失败 [${line.split(' ')[0]}]: ${reply.code} ${reply.text}`)
    }
    return reply
  }

  close() {
    try {
      this.socket.end()
    } catch {
      /* ignore */
    }
  }

  destroy() {
    try {
      this.socket.destroy()
    } catch {
      /* ignore */
    }
  }
}

function connectSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    const options = { host, port, servername: host }
    const socket = secure
      ? tls.connect({ ...options, rejectUnauthorized: false })
      : net.connect(options)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`连接 ${host}:${port} 超时`))
    }, SMTP_TIMEOUT_MS)
    const readyEvent = secure ? 'secureConnect' : 'connect'
    socket.once(readyEvent, () => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      reject(error)
    })
  })
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername: host, rejectUnauthorized: false }, () => resolve(secured))
    secured.once('error', reject)
  })
}

function base64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function encodeHeaderValue(value) {
  const text = String(value ?? '')
  if (/^[\x20-\x7e]*$/.test(text)) return text
  return `=?UTF-8?B?${base64(text)}?=`
}

function foldHeader(name, value) {
  const text = `${name}: ${value}`
  if (text.length <= 76) return text
  const parts = []
  let rest = text
  let first = true
  while (rest.length > 0) {
    const limit = first ? 76 : 75
    if (rest.length <= limit) {
      parts.push(rest)
      break
    }
    let cut = rest.lastIndexOf(' ', limit)
    if (cut <= 0) cut = limit
    parts.push(rest.slice(0, cut))
    rest = ` ${rest.slice(cut).trimStart()}`
    first = false
  }
  return parts.join('\r\n')
}

/** 按 RFC 2045 做 base64 正文编码，每行 76 字符 */
function base64Body(text) {
  const encoded = Buffer.from(String(text), 'utf8').toString('base64')
  const lines = []
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76))
  return lines.join('\r\n')
}

function messageIdFor(fromAddress) {
  const domain = String(fromAddress).split('@')[1] || 'localhost'
  return `<${crypto.randomUUID()}@${domain}>`
}

function dotStuff(body) {
  return String(body)
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n')
}

/**
 * 把纯文本渲染成简单 HTML（保留段落与换行）。
 * 仅作为 `digestToHtml` 不可用时的兜底。
 */
export function textToHtml(text) {
  const escape = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px 0">${escape(block).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:720px;margin:0 auto;padding:16px">${paragraphs}</body></html>`
}

/* --------------------------- 卡片式邮件 HTML ---------------------------- */

/**
 * 邮件里的颜色写死成十六进制：Outlook / QQ 邮箱 / 网易邮箱都不支持 CSS 变量，
 * 部分客户端连 `grid` 和 `flex` 都不支持，所以布局只能用 table + 内联样式。
 * 配色对齐面板的浅色主题（强调色 #4176e6，不用近黑的 brand-primary）。
 */
const MAIL_COLORS = {
  accent: '#4176e6',
  accentSoft: '#edf3fe',
  border: '#e3e5e8',
  cardBg: '#ffffff',
  pageBg: '#f5f6f7',
  text: '#0f1115',
  muted: '#6b7280',
  faint: '#9aa0a6',
  tagBg: '#f1f3f5',
  okBg: '#e6faed',
}

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 只允许 http/https，防止摘要里出现 javascript: 之类的链接被当成按钮。 */
function safeUrl(value) {
  const url = String(value ?? '').trim()
  return /^https?:\/\//i.test(url) ? url : ''
}

function chipHtml(text, { color = MAIL_COLORS.muted, bg = MAIL_COLORS.tagBg, bold = false } = {}) {
  const label = String(text ?? '').trim()
  if (label === '') return ''
  return `<span style="display:inline-block;padding:1px 8px;margin:0 4px 4px 0;border-radius:4px;background:${bg};color:${color};font-size:11px;line-height:18px;${bold ? 'font-weight:600;' : ''}">${escapeHtml(label)}</span>`
}

/** 一行「字段名 / 字段值」，窄屏也不会挤成一团。 */
function fieldRowHtml(label, value) {
  const text = String(value ?? '').trim()
  if (text === '' || text === '摘要未提及') return ''
  return `<tr><td style="padding:5px 0;vertical-align:top;width:76px;font-size:11px;line-height:18px;color:${MAIL_COLORS.faint};font-weight:600;letter-spacing:.3px;">${escapeHtml(label)}</td><td style="padding:5px 0;vertical-align:top;font-size:13px;line-height:20px;color:${MAIL_COLORS.text};">${escapeHtml(text)}</td></tr>`
}

/**
 * 单篇论文的卡片。摘要字段顺序与面板一致（一句话 / 问题 / 方法 / 内容与结论 /
 * 创新点 / 局限 / 相关性 / 标签）。
 */
function paperCardHtml(item, t) {
  const summary = item.summary !== null && typeof item.summary === 'object' ? item.summary : null
  const chips = [
    item.topicName ? chipHtml(item.topicName, { color: MAIL_COLORS.accent, bg: MAIL_COLORS.accentSoft, bold: true }) : '',
    item.venue ? chipHtml(item.venue) : '',
    item.publishedAt ? chipHtml(String(item.publishedAt).slice(0, 10)) : '',
    item.source ? chipHtml(item.source) : '',
    item.openAccess === true ? chipHtml(t('open_access'), { color: MAIL_COLORS.text, bg: MAIL_COLORS.okBg, bold: true }) : '',
    item.matchedIn ? chipHtml(`${t('matched')} · ${item.matchedIn}`, { color: MAIL_COLORS.text, bg: MAIL_COLORS.okBg }) : '',
  ]
    .filter(Boolean)
    .join('')

  const title = escapeHtml(item.title || '(无标题)')
  const url = safeUrl(item.url)
  const titleHtml =
    url === ''
      ? `<div style="font-size:15px;font-weight:600;line-height:22px;color:${MAIL_COLORS.text};margin:2px 0 8px;">${title}</div>`
      : `<div style="font-size:15px;font-weight:600;line-height:22px;margin:2px 0 8px;"><a href="${escapeHtml(url)}" style="color:${MAIL_COLORS.text};text-decoration:none;">${title}</a></div>`

  const authors =
    Array.isArray(item.authors) && item.authors.length > 0
      ? `<div style="font-size:12px;line-height:18px;color:${MAIL_COLORS.muted};margin:0 0 10px;">${escapeHtml(
          item.authors.slice(0, 6).join(', ') + (item.authors.length > 6 ? ' 等' : ''),
        )}</div>`
      : ''

  let bodyHtml = ''
  if (summary !== null) {
    const tldr = String(summary.tldr ?? '').trim()
    const tldrHtml =
      tldr === '' || tldr === '摘要未提及'
        ? ''
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;"><tr><td style="border-left:2px solid ${MAIL_COLORS.accent};background:${MAIL_COLORS.accentSoft};border-radius:0 6px 6px 0;padding:9px 12px;font-size:13px;line-height:20px;color:${MAIL_COLORS.text};"><b style="color:${MAIL_COLORS.accent};font-weight:600;margin-right:6px;">${escapeHtml(t('tldr'))}</b>${escapeHtml(tldr)}</td></tr></table>`
    const rows = [
      fieldRowHtml(t('problem'), summary.problem),
      fieldRowHtml(t('method'), summary.method),
      fieldRowHtml(t('findings'), summary.findings),
      fieldRowHtml(t('innovation'), summary.innovation),
      fieldRowHtml(t('limitations'), summary.limitations),
      fieldRowHtml(t('relevance'), summary.relevance),
    ]
      .filter(Boolean)
      .join('')
    const tags =
      Array.isArray(summary.tags) && summary.tags.length > 0
        ? `<div style="margin:8px 0 0;">${summary.tags.map((tag) => chipHtml(tag)).join('')}</div>`
        : ''
    bodyHtml = tldrHtml + (rows === '' ? '' : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`) + tags
  } else if (item.summaryError) {
    bodyHtml = `<div style="font-size:12px;line-height:19px;color:${MAIL_COLORS.muted};margin:0 0 8px;"><b style="color:${MAIL_COLORS.text};">${escapeHtml(t('summary_failed'))}</b> ${escapeHtml(item.summaryError)}</div>${
      item.abstract
        ? `<div style="font-size:12px;line-height:19px;color:${MAIL_COLORS.muted};">${escapeHtml(String(item.abstract).slice(0, 600))}</div>`
        : ''
    }`
  } else {
    bodyHtml = `<div style="font-size:12px;line-height:19px;color:${MAIL_COLORS.muted};">${escapeHtml(
      item.abstract ? String(item.abstract).slice(0, 800) : t('no_abstract'),
    )}</div>`
  }

  const footBits = [
    Number(item.citations) > 0 ? `${t('cited')} ${Number(item.citations)}` : '',
    url === '' ? '' : `<a href="${escapeHtml(url)}" style="color:${MAIL_COLORS.accent};text-decoration:none;">${item.doi ? `DOI ${escapeHtml(item.doi)}` : '↗'}</a>`,
  ].filter(Boolean)

  const footHtml =
    footBits.length === 0
      ? ''
      : `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed ${MAIL_COLORS.border};font-size:11px;line-height:18px;color:${MAIL_COLORS.faint};">${footBits.join(' &nbsp;·&nbsp; ')}</div>`

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr><td style="border:1px solid ${MAIL_COLORS.border};border-left:3px solid ${MAIL_COLORS.accent};border-radius:10px;padding:14px 16px;background:${MAIL_COLORS.cardBg};">${chips === '' ? '' : `<div style="margin:0 0 6px;">${chips}</div>`}${titleHtml}${authors}${bodyHtml}${footHtml}</td></tr></table>`
}

/**
 * 把一次扫描的新论文渲染成卡片式 HTML 邮件。
 *
 * 用 table + 内联样式而不是 `div` + CSS 类：QQ 邮箱 / 网易邮箱 / Outlook
 * 会剥掉 `<style>` 标签，`flex`/`grid` 也不支持。
 *
 * @param {object[]} items 本次新论文
 * @param {object[]} topics 方向列表（用来分组标题）
 * @param {{ panelUrl?: string, locale?: string }} [options]
 */
export function digestToHtml(items, topics, options = {}) {
  const locale = options.locale === 'en' ? 'en' : 'zh'
  const dict =
    locale === 'en'
      ? {
          open_access: 'Open access',
          matched: 'Match',
          tldr: 'TL;DR',
          problem: 'Problem',
          method: 'Method',
          findings: 'Findings',
          innovation: 'Novelty',
          limitations: 'Limitations',
          relevance: 'Relevance',
          summary_failed: 'Summary failed:',
          no_abstract: 'No abstract available',
          cited: 'cited',
          intro: (n) => `${n} new paper${n === 1 ? '' : 's'} in this round.`,
          papers: (n) => `${n} paper${n === 1 ? '' : 's'}`,
          open_panel: 'Open the radar panel',
          footer: 'Generated automatically by DSH Research Radar.',
        }
      : {
          open_access: '开放获取',
          matched: '命中',
          tldr: '一句话',
          problem: '问题',
          method: '方法',
          findings: '内容与结论',
          innovation: '创新点',
          limitations: '局限',
          relevance: '相关性',
          summary_failed: '摘要生成失败：',
          no_abstract: '该库未提供摘要',
          cited: '被引',
          intro: (n) => `本次共发现 ${n} 篇新论文。`,
          papers: (n) => `${n} 篇`,
          open_panel: '在面板中查看',
          footer: '—— 由 DSH 研究前沿雷达自动生成',
        }
  const t = (key) => (typeof dict[key] === 'string' ? dict[key] : key)

  const list = Array.isArray(items) ? items : []
  const topicNames = new Map(
    (Array.isArray(topics) ? topics : []).map((topic) => [topic.id, topic.name || topic.id]),
  )
  const groups = new Map()
  for (const item of list) {
    const key = item.topicId || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  const panelUrl = safeUrl(options.panelUrl)
  const buttonHtml =
    panelUrl === ''
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr><td style="border-radius:6px;background:${MAIL_COLORS.accent};"><a href="${escapeHtml(panelUrl)}" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(dict.open_panel)}</a></td></tr></table>`

  const sections = []
  for (const [topicId, group] of groups) {
    const name = topicNames.get(topicId) ?? topicId
    sections.push(
      `<div style="font-size:12px;font-weight:700;letter-spacing:.5px;color:${MAIL_COLORS.accent};margin:0 0 10px;">${escapeHtml(name)} <span style="color:${MAIL_COLORS.faint};font-weight:500;">· ${escapeHtml(dict.papers(group.length))}</span></div>`,
    )
    for (const item of group) sections.push(paperCardHtml(item, t))
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>研究前沿雷达</title></head>
<body style="margin:0;padding:0;background:${MAIL_COLORS.pageBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${MAIL_COLORS.pageBg};padding:18px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;font-family:${FONT_STACK};">
<tr><td style="padding:0 0 14px;">
<div style="font-size:17px;font-weight:700;color:${MAIL_COLORS.text};line-height:24px;margin:0 0 4px;">研究前沿雷达</div>
<div style="font-size:12px;line-height:18px;color:${MAIL_COLORS.muted};">${escapeHtml(dict.intro(list.length))}</div>
</td></tr>
<tr><td>${buttonHtml}</td></tr>
<tr><td>${sections.join('\n')}</td></tr>
<tr><td style="padding:8px 0 0;font-size:11px;line-height:18px;color:${MAIL_COLORS.faint};">${escapeHtml(dict.footer)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}


/**
 * 发送一封 multipart/alternative 邮件。
 * @param {{host:string,port:number,secure:boolean,user:string,pass:string,from:string}} account
 * @param {{to:string[], subject:string, text:string, html?:string}} message
 */
export async function sendMail(account, message) {
  const host = String(account.host ?? '').trim()
  const port = Number(account.port) || 465
  const secure = account.secure !== false
  const user = String(account.user ?? '').trim()
  const pass = String(account.pass ?? '')
  const from = String(account.from ?? '').trim() || user

  if (host === '') throw new Error('未配置 SMTP 服务器地址')
  if (from === '') throw new Error('未配置发件人地址')
  const recipients = (Array.isArray(message.to) ? message.to : [])
    .map((r) => String(r).trim())
    .filter((r) => /^[^@\s]+@[^@\s]+$/.test(r))
  if (recipients.length === 0) throw new Error('未配置有效的收件人地址')

  const socket = await connectSocket({ host, port, secure })
  let conn = new SmtpConnection(socket)

  try {
    const greeting = await conn.read()
    if (greeting.code !== 220) {
      throw new Error(`SMTP 服务器拒绝连接: ${greeting.code} ${greeting.text}`)
    }

    let ehlo = await conn.command(`EHLO ${os.hostname() || 'localhost'}`)
    if (ehlo.code !== 250) {
      ehlo = await conn.command(`HELO ${os.hostname() || 'localhost'}`, 250)
    }
    let capabilities = ehlo.lines.join('\n').toUpperCase()

    if (!secure && capabilities.includes('STARTTLS')) {
      await conn.command('STARTTLS', 220)
      const secured = await upgradeToTls(conn.socket, host)
      conn.socket.removeAllListeners('data')
      conn.socket.removeAllListeners('error')
      conn.socket.removeAllListeners('close')
      conn = new SmtpConnection(secured)
      ehlo = await conn.command(`EHLO ${os.hostname() || 'localhost'}`, 250)
      capabilities = ehlo.lines.join('\n').toUpperCase()
    }

    if (user !== '' && pass !== '') {
      if (capabilities.includes('AUTH') && capabilities.includes('LOGIN')) {
        await conn.command('AUTH LOGIN', 334)
        await conn.command(base64(user), 334)
        await conn.command(base64(pass), 235)
      } else if (capabilities.includes('AUTH')) {
        await conn.command(`AUTH PLAIN ${base64(`\u0000${user}\u0000${pass}`)}`, 235)
      } else if (!secure) {
        throw new Error('SMTP 服务器不支持认证，且连接未加密；已拒绝发送明文凭据')
      }
    }

    await conn.command(`MAIL FROM:<${from}>`, 250)
    for (const recipient of recipients) {
      await conn.command(`RCPT TO:<${recipient}>`, 250)
    }
    await conn.command('DATA', 354)

    const textBody = String(message.text ?? '')
    const htmlBody = typeof message.html === 'string' && message.html !== '' ? message.html : null
    const boundary = `----dsh-radar-${crypto.randomUUID()}`
    const headers = [
      foldHeader('From', encodeHeaderValue(message.fromName ? `${message.fromName} <${from}>` : from)),
      foldHeader('To', recipients.join(', ')),
      foldHeader('Subject', encodeHeaderValue(message.subject ?? '研究前沿雷达')),
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageIdFor(from)}`,
      'MIME-Version: 1.0',
    ]

    let body
    if (htmlBody === null) {
      headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64')
      body = base64Body(textBody)
    } else {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
      body = [
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Body(textBody),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Body(htmlBody),
        `--${boundary}--`,
      ].join('\r\n')
    }

    const payload = `${dotStuff(`${headers.join('\r\n')}\r\n\r\n${body}`)}\r\n.`
    await conn.command(payload, 250)
    try {
      await conn.command('QUIT', 221)
    } catch {
      /* 服务器可能已断开，邮件已入队，忽略 */
    }
    conn.close()
    return { ok: true, recipients }
  } catch (error) {
    conn.destroy()
    throw error
  }
}
