import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import {
  arxivIdOf,
  condenseText,
  extractPmcBody,
  fetchFullText,
  htmlToText,
  looksLikeProse,
  pdfToText,
  stripLeadingBoilerplate,
} from '../radar/fulltext.js'

/** 造一段像模像样的英文正文，用来过 looksLikeProse。 */
function prose(times = 60) {
  return Array.from(
    { length: times },
    () => 'We present the method and the results of the experiment with this material.',
  ).join(' ')
}

/** 造一个只含一个 content stream 的最小 PDF，返回 ArrayBuffer（模拟 fetch 的 arrayBuffer）。 */
function minimalPdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g, '')}) Tj ET`
  const compressed = deflateSync(Buffer.from(content, 'latin1'))
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'latin1'),
    Buffer.from('1 0 obj\n<< /Length ' + String(compressed.length) + ' >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
    Buffer.from('%%EOF\n', 'latin1'),
  ])
  return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength)
}

test('arxivIdOf 从 id / url / doi 里认出 arXiv 编号', () => {
  assert.equal(arxivIdOf({ id: 'arxiv:1706.03762' }), '1706.03762')
  assert.equal(arxivIdOf({ url: 'https://arxiv.org/abs/2301.12345v2' }), '2301.12345')
  assert.equal(arxivIdOf({ url: 'https://arxiv.org/pdf/2301.12345' }), '2301.12345')
  assert.equal(arxivIdOf({ doi: '10.48550/arXiv.1706.03762' }), '1706.03762')
  assert.equal(arxivIdOf({ id: 'openalex:W123' }), '')
  assert.equal(arxivIdOf({}), '')
  assert.equal(arxivIdOf(null), '')
})

test('htmlToText 保留段落、去掉脚本与多余空白', () => {
  const html =
    '<html><head><style>.a{color:red}</style><script>var x=1</script></head>' +
    '<body><p>First paragraph.</p><p>Second   paragraph.</p><footer>Footer text</footer></body></html>'
  const text = htmlToText(html)
  assert.match(text, /First paragraph\./)
  assert.match(text, /Second paragraph\./)
  assert.doesNotMatch(text, /color:red/)
  assert.doesNotMatch(text, /var x=1/)
  // 段落之间要有换行，否则读起来是一坨
  assert.match(text, /First paragraph\.\nSecond paragraph\./)
})

test('htmlToText 处理实体与数学公式', () => {
  const text = htmlToText('<p>a &lt; b &amp;&amp; c &gt; d &nbsp; e &middot; f</p>')
  assert.match(text, /a < b && c > d/)
  // 命名实体要清掉，不能留 &middot; 污染可读性判断
  assert.doesNotMatch(text, /&middot;/)
})

test('extractPmcBody 只取 <body>，跳过参考文献', () => {
  const xml =
    '<article><front><title>Title</title></front>' +
    '<body><sec><p>Introduction paragraph with the method.</p></sec>' +
    '<sec><p>Results paragraph with the findings.</p></sec></body>' +
    '<ref-list><ref><mixed-citation>Ref one</mixed-citation></ref></ref-list>' +
    '<back><ack>Acknowledgements</ack></back></article>'
  const text = extractPmcBody(xml)
  assert.match(text, /Introduction paragraph/)
  assert.match(text, /Results paragraph/)
  // 参考文献列表占一半篇幅且没有信息量，必须剔掉
  assert.doesNotMatch(text, /Ref one/)
  assert.doesNotMatch(text, /Acknowledgements/)
  assert.equal(extractPmcBody('<article>no body here</article>'), '')
  assert.equal(extractPmcBody(null), '')
})

test('pdfToText 能从最小 PDF 里抽出文本', () => {
  // 造一个只有 content stream 的最小 PDF
  const content = 'BT /F1 12 Tf 72 720 Td (We present the method and the results of the experiment.) Tj ET'
  const compressed = deflateSync(Buffer.from(content, 'latin1'))
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'latin1'),
    Buffer.from('1 0 obj\n<< /Length ' + String(compressed.length) + ' >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
    Buffer.from('%%EOF\n', 'latin1'),
  ])
  const text = pdfToText(pdf)
  assert.match(text, /We present the method and the results of the experiment\./)
})

test('pdfToText 对非 PDF 与空输入安全返回空串', () => {
  assert.equal(pdfToText(Buffer.from('<html>not a pdf</html>', 'latin1')), '')
  assert.equal(pdfToText(Buffer.alloc(0)), '')
  assert.equal(pdfToText(null), '')
  // 声明是 PDF 但没有可解析的 stream
  assert.equal(pdfToText(Buffer.from('%PDF-1.4\nnothing here\n', 'latin1')), '')
})

test('looksLikeProse 能区分正常正文与乱码', () => {
  assert.equal(looksLikeProse(prose()), true)
  // 太短
  assert.equal(looksLikeProse('We present the method.'), false)
  // 字母比例太低（一堆符号与数字）
  assert.equal(looksLikeProse('12345 67890 !@#$% ^&*() 12345 67890 !@#$% ^&*()'.repeat(40)), false)
  // 没有空格的长串（PDF 字体编码乱码的典型症状）
  assert.equal(looksLikeProse('a'.repeat(2000)), false)
  // 有字母有空格但没有虚词 —— 不像英文句子
  assert.equal(looksLikeProse('xyz abcdef ghijkl mnopqr stuvwx yzabcd '.repeat(60)), false)
  assert.equal(looksLikeProse(null), false)
})

test('condenseText 保头保尾，中间标出省略字数', () => {
  const long = `${'A'.repeat(5000)}MIDDLE${'B'.repeat(5000)}`
  const out = condenseText(long, 1000)
  assert.ok(out.length < long.length)
  // 头尾都要保留 —— 论文的「问题」在开头，「结论」在结尾
  assert.match(out, /^A{400,}/)
  assert.match(out, /B{300,}$/)
  assert.match(out, /正文中段已省略 \d+ 字/)
  // 没超预算就原样返回
  assert.equal(condenseText('short text', 1000), 'short text')
  // 非法预算退回默认值而不是崩
  assert.ok(condenseText(long, null).length > 0)
  assert.ok(condenseText(long, -5).length > 0)
})

test('stripLeadingBoilerplate 去掉 arXiv 的版权与导航噪声', () => {
  const text = [
    'Provided proper attribution is provided, Google hereby grants permission to reproduce the tables and figures in this paper solely for use in journalistic or scholarly works.',
    '',
    'Attention Is All You Need',
    '',
    'Ashish Vaswani, Noam Shazeer',
    '',
    'Abstract: The dominant sequence transduction models are based on complex recurrent networks.',
  ].join('\n')
  const cleaned = stripLeadingBoilerplate(text)
  // 版权声明必须被剔掉 —— 它占了头部预算却不含论文信息
  assert.doesNotMatch(cleaned, /hereby grants permission/)
  assert.match(cleaned, /^Attention Is All You Need/)
  assert.match(cleaned, /Abstract: The dominant sequence/)

  // condenseText 走的是清洗后的文本
  const condensed = condenseText(text, 100)
  assert.doesNotMatch(condensed, /hereby grants permission/)

  // 没有噪声时原样返回，不能误删正文
  const plain = 'We present a new method for metal rubber.\nIt works well.'
  assert.equal(stripLeadingBoilerplate(plain), plain)
  assert.equal(stripLeadingBoilerplate(''), '')
  assert.equal(stripLeadingBoilerplate(null), '')
})

test('fetchFullText 依次尝试各条路线，拿不到就返回 null', async (t) => {
  const original = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    if (String(url).includes('arxiv.org')) {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => `<article><p>${prose()}</p></article><footer>junk</footer>`,
      }
    }
    return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const hit = await fetchFullText({ id: 'arxiv:1706.03762', url: 'https://arxiv.org/abs/1706.03762' })
  assert.notEqual(hit, null)
  assert.equal(hit.source, 'arxiv-html')
  assert.equal(hit.url, 'https://arxiv.org/html/1706.03762')
  assert.ok(hit.chars > 800)
  // 页脚不能被混进正文
  assert.doesNotMatch(hit.text, /junk/)

  // 什么都没有的条目直接返回 null，不发请求
  requested.length = 0
  assert.equal(await fetchFullText({ id: 'openalex:W1' }), null)
  assert.equal(requested.length, 0)
})

test('fetchFullText 支持限定路线', async (t) => {
  const original = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
  }
  t.after(() => {
    globalThis.fetch = original
  })
  const out = await fetchFullText(
    { id: 'arxiv:1706.03762', url: 'https://arxiv.org/abs/1706.03762', oaPdfUrl: 'https://example.org/x.pdf' },
    { routes: ['oa-pdf'] },
  )
  assert.equal(out, null)
  // 只打了 PDF 那个地址，没去碰 arXiv
  assert.equal(requested.length, 1)
  assert.match(requested[0], /example\.org\/x\.pdf/)
})

test('publisher-pdf 从 DOI 落地页的 citation_pdf_url 拿全文', async (t) => {
  const original = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    if (String(url).startsWith('https://doi.org/')) {
      return {
        ok: true,
        status: 200,
        url: 'https://www.mdpi.com/2076-3417/16/6/3047',
        headers: new Map([['content-type', 'text/html']]),
        text: async () =>
          `<html><head><meta name="citation_pdf_url" content="/2076-3417/16/6/3047/pdf"></head></html>`,
      }
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/pdf']]),
      arrayBuffer: async () => minimalPdf(prose()),
    }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const hit = await fetchFullText({ id: 'openalex:W1', doi: '10.3390/app16063047' }, { routes: ['publisher-pdf'] })
  assert.notEqual(hit, null)
  assert.equal(hit.source, 'publisher-pdf')
  // 相对路径要按落地页解析成绝对地址
  assert.equal(hit.url, 'https://www.mdpi.com/2076-3417/16/6/3047/pdf')
  assert.match(requested[0], /doi\.org\/10\.3390%2Fapp16063047/)
})

test('publisher-pdf 对已知支持 /pdf 后缀的域名直接拼', async (t) => {
  const original = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    if (String(url).startsWith('https://doi.org/')) {
      return {
        ok: true,
        status: 200,
        url: 'https://www.mdpi.com/2073-4360/17/3/345',
        headers: new Map(),
        text: async () => '<html><head></head></html>',
      }
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      arrayBuffer: async () => minimalPdf(prose()),
    }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const hit = await fetchFullText({ doi: '10.3390/polym17030345' }, { routes: ['publisher-pdf'] })
  assert.notEqual(hit, null)
  assert.equal(hit.url, 'https://www.mdpi.com/2073-4360/17/3/345/pdf')
})

test('publisher-pdf 认出订阅制出版社就不再下载', async (t) => {
  const original = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    return {
      ok: true,
      status: 200,
      url: 'https://linkinghub.elsevier.com/retrieve/pii/S026382312600711',
      headers: new Map(),
      text: async () => '<html><body>sign in to continue</body></html>',
    }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const hit = await fetchFullText({ doi: '10.1016/j.tws.2026.115191' }, { routes: ['publisher-pdf'] })
  assert.equal(hit, null)
  // 只解析了 DOI，没有再去下一趟必然失败的 PDF
  assert.equal(requested.length, 1)
})

test('fetchFullText 的总预算跨路线共享，用完就不再开新路线', async (t) => {
  const original = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    // 第一条路线就拖满预算
    await new Promise((resolve) => setTimeout(resolve, 60))
    return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
  }
  t.after(() => {
    globalThis.fetch = original
  })

  const started = Date.now()
  const out = await fetchFullText(
    { id: 'arxiv:1706.03762', url: 'https://arxiv.org/abs/1706.03762', doi: '10.1016/j.tws.2026.115191' },
    { timeoutMs: 80 },
  )
  assert.equal(out, null)
  // 80ms 预算用光后不应继续开 europepmc / oa-pdf / publisher-pdf
  assert.ok(requested.length <= 2, `实际发了 ${requested.length} 个请求`)
  assert.ok(Date.now() - started < 3000)
})
