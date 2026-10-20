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
