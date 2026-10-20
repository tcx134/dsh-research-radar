window.__ModuleLoader__.load({
  id: '@local/dsh-research-radar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-research-radar'
    const PANEL_ID = 'research-radar'
    const API = '/api/dsh-research-radar'

    const DICT = {
      zh: {
        title: '研究前沿雷达',
        subtitle: '按作者 / 期刊 / 单位 / 关键词监控最新论文，自动总结方法、内容与创新点',
        tab_items: '最新论文',
        tab_topics: '研究方向',
        tab_settings: '设置',
        scan_now: '立即扫描',
        scanning: '扫描中…',
        empty_items: '还没有抓取到论文。先在「研究方向」里配置一个方向，再点「立即扫描」。',
        empty_topics: '还没有研究方向。一个方向可以同时限定关键词、作者、期刊和单位。',
        add_topic: '添加方向',
        topic_name: '方向名称',
        topic_name_ph: '例如：金属橡胶减振',
        keywords: '关键词（标题 / 摘要）',
        keywords_ph: 'metal rubber, wire mesh damper\n多个词用逗号或换行分隔，词之间是「或」的关系',
        authors: '关注作者',
        authors_ph: 'Lagoudas, 王建国\n留空表示不限作者',
        venues: '关注期刊 / 会议',
        venues_ph: 'Journal of Sound and Vibration\n留空表示不限期刊',
        institutions: '关注单位',
        institutions_ph: 'Harbin Institute of Technology\n留空表示不限单位',
        exclude: '排除词',
        exclude_ph: 'bearing\n命中这些词的论文会被丢弃',
        topic_sources: '检索哪些数据库',
        sources_hint: '不同维度之间是「且」：关键词命中 + 作者命中 + 期刊命中 才会推送。建议主库选 OpenAlex。',
        match_mode: '多个关键词之间',
        match_any: '命中任意一个即可（推荐）',
        match_all: '必须全部命中（更严格，结果更少）',
        strict_mode: '只保留真正相关的论文（推荐）',
        strict_hint:
          '开启后会丢掉「只命中了 MR、AI 这类短缩写」的论文 —— 否则搜「金属橡胶」会被磁共振（MR）的文章淹没。多词短语和长词会被当作主要关键词。',
        save: '保存',
        cancel: '取消',
        edit: '编辑',
        remove: '删除',
        enabled: '启用',
        disabled: '停用',
        preview: '试检索',
        previewing: '试检索中…',
        preview_title: '试检索结果（不写入数据库）',
        preview_empty: '没有检索到结果，试着放宽关键词或换一个数据库。',
        scan_settings: '扫描设置',
        auto_scan: '启用定时扫描',
        interval_hours: '扫描间隔（小时）',
        max_per_topic: '每个方向每次最多抓取',
        lookback_days: '只看最近多少天内发表的',
        do_summarize: '用 LLM 生成结构化摘要',
        api_settings: '检索接口',
        api_mailto: '联系邮箱（OpenAlex / Crossref 推荐填写，可提高配额）',
        api_openalex_key: 'OpenAlex API Key（可选，留空用公共配额）',
        mail_settings: '邮件推送',
        mail_enabled: '启用邮件推送',
        smtp_host: 'SMTP 服务器',
        smtp_port: '端口',
        smtp_secure: '使用 SSL/TLS（465 端口）',
        smtp_user: '账号',
        smtp_pass: '密码 / 授权码',
        mail_from: '发件人',
        mail_to: '收件人（多个用逗号分隔）',
        test_mail: '发送测试邮件',
        rss_feeds: 'RSS 订阅地址（每行一个）',
        saved: '已保存',
        scan_done: '扫描完成',
        new_items: '篇新论文',
        no_new: '没有发现新论文',
        last_scan: '上次扫描',
        last_mail: '上次发送邮件',
        never: '从未',
        tldr: '一句话',
        problem: '问题',
        method: '方法',
        findings: '内容与结论',
        innovation: '创新点',
        limitations: '局限',
        relevance: '相关性',
        tags: '标签',
        authors_label: '作者',
        summary_failed: '摘要生成失败',
        abstract_only: '原始摘要（未生成结构化摘要）',
        clear_items: '清空已抓取',
        load_failed: '加载失败',
        summary_off: '未启用 LLM 摘要',
        filter_all: '全部方向',
        matched: '命中',
        cited: '被引',
        open_access: '开放获取',
        no_abstract: '该库未提供摘要',
        stats: '共 {n} 篇',
      },
      en: {
        title: 'Research Radar',
        subtitle: 'Track papers by author, venue, institution or keyword — with method, findings and novelty summaries',
        tab_items: 'Papers',
        tab_topics: 'Topics',
        tab_settings: 'Settings',
        scan_now: 'Scan now',
        scanning: 'Scanning…',
        empty_items: 'No papers yet. Configure a topic under "Topics", then press "Scan now".',
        empty_topics: 'No topics yet. A topic can constrain keywords, authors, venues and institutions at once.',
        add_topic: 'Add topic',
        topic_name: 'Topic name',
        topic_name_ph: 'e.g. Metal rubber vibration damping',
        keywords: 'Keywords (title / abstract)',
        keywords_ph: 'metal rubber, wire mesh damper\nComma or newline separated; terms are OR-ed',
        authors: 'Authors',
        authors_ph: 'Lagoudas\nLeave empty to ignore authors',
        venues: 'Venues / journals',
        venues_ph: 'Journal of Sound and Vibration\nLeave empty to ignore venues',
        institutions: 'Institutions',
        institutions_ph: 'Harbin Institute of Technology\nLeave empty to ignore institutions',
        exclude: 'Exclude words',
        exclude_ph: 'bearing\nPapers matching these are dropped',
        topic_sources: 'Databases',
        sources_hint: 'Dimensions are AND-ed: a paper must match keywords + authors + venues to be pushed. OpenAlex is the best default.',
        match_mode: 'Between multiple keywords',
        match_any: 'Match any keyword (recommended)',
        match_all: 'Match all keywords (stricter, fewer results)',
        strict_mode: 'Keep only genuinely relevant papers (recommended)',
        strict_hint:
          'Drops papers that only matched a short abbreviation such as MR or AI — otherwise a "metal rubber" topic is drowned by magnetic-resonance papers. Multi-word phrases and long words count as primary keywords.',
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        remove: 'Delete',
        enabled: 'Enabled',
        disabled: 'Disabled',
        preview: 'Test query',
        previewing: 'Querying…',
        preview_title: 'Test results (not saved)',
        preview_empty: 'No results. Try loosening the keywords or switching database.',
        scan_settings: 'Scan settings',
        auto_scan: 'Enable scheduled scanning',
        interval_hours: 'Interval (hours)',
        max_per_topic: 'Max items per topic',
        lookback_days: 'Only papers from the last N days',
        do_summarize: 'Generate structured summary with LLM',
        api_settings: 'Query APIs',
        api_mailto: 'Contact email (recommended for OpenAlex / Crossref quotas)',
        api_openalex_key: 'OpenAlex API key (optional)',
        mail_settings: 'Email delivery',
        mail_enabled: 'Enable email delivery',
        smtp_host: 'SMTP host',
        smtp_port: 'Port',
        smtp_secure: 'Use SSL/TLS (port 465)',
        smtp_user: 'Username',
        smtp_pass: 'Password / app token',
        mail_from: 'From',
        mail_to: 'To (comma separated)',
        test_mail: 'Send test email',
        rss_feeds: 'RSS feed URLs (one per line)',
        saved: 'Saved',
        scan_done: 'Scan finished',
        new_items: 'new papers',
        no_new: 'No new papers',
        last_scan: 'Last scan',
        last_mail: 'Last email',
        never: 'never',
        tldr: 'TL;DR',
        problem: 'Problem',
        method: 'Method',
        findings: 'Findings',
        innovation: 'Novelty',
        limitations: 'Limitations',
        relevance: 'Relevance',
        tags: 'Tags',
        authors_label: 'Authors',
        summary_failed: 'Summary failed',
        abstract_only: 'Raw abstract (no structured summary)',
        clear_items: 'Clear papers',
        load_failed: 'Failed to load',
        summary_off: 'LLM summary disabled',
        filter_all: 'All topics',
        matched: 'Matched',
        cited: 'cited',
        open_access: 'Open access',
        no_abstract: 'No abstract provided by this database',
        stats: '{n} papers',
      },
    }

    const CSS = `
.drr-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-base,#1a1a1a);font-size:13px}
.drr-head{display:flex;align-items:flex-start;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}
.drr-title{font-size:15px;font-weight:600;margin:0}
.drr-sub{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11.5px;margin:3px 0 0;line-height:1.5}
.drr-spacer{flex:1}
.drr-btn{appearance:none;border:1px solid var(--dsw-alias-border-l4,rgba(128,128,128,.28));background:var(--dsw-alias-bg-layer-1,#242424);color:inherit;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.drr-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.drr-btn:disabled{opacity:.5;cursor:default}
.drr-btn-primary{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.drr-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#43454a)}
.drr-btn-danger{color:var(--dsw-alias-state-error-primary,#e5534b)}
.drr-btn-sm{padding:3px 9px;font-size:11px}
.drr-tabs{display:flex;align-items:center;gap:4px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28))}
.drr-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit}
.drr-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.drr-tab-active{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.18));color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
.drr-count{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11px;margin-left:6px}
.drr-body{flex:1;min-height:0;overflow:auto;padding:16px 20px 48px}

.drr-card{position:relative;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28));border-left:3px solid var(--dsw-alias-link,#4176e6);border-radius:10px;padding:14px 16px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1,#242424);box-shadow:var(--dsw-shadow-lv1,0 2px 4px rgba(0,0,0,.06));transition:box-shadow .12s,border-color .12s}
.drr-card:hover{box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,.08));border-color:var(--dsw-alias-border-l4,rgba(128,128,128,.4))}
.drr-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.drr-card-title{font-size:14.5px;font-weight:600;line-height:1.5;margin:0 0 8px;letter-spacing:.1px}
.drr-card-title a{color:inherit;text-decoration:none}
.drr-card-title a:hover{color:var(--dsw-alias-link,#4176e6);text-decoration:underline}
.drr-authors{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11.5px;margin-bottom:10px;line-height:1.55}
.drr-tldr{background:var(--dsw-alias-markdown-placeholder,#f5f6f7);border-left:2px solid var(--dsw-alias-link,#4176e6);border-radius:0 6px 6px 0;padding:9px 12px;font-size:12.5px;line-height:1.65;margin-bottom:10px}
.drr-tldr b{color:var(--dsw-alias-link,#4176e6);font-weight:600;margin-right:6px}
.drr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:2px 22px;margin-bottom:8px}
.drr-field{margin:4px 0;line-height:1.65;font-size:12.5px}
.drr-field b{display:block;color:var(--dsw-alias-label-tertiary,#81858c);font-weight:600;font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;margin-bottom:2px}
.drr-tags{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0 0}
.drr-tag{display:inline-block;padding:1px 8px;border-radius:10px;background:var(--dsw-alias-markdown-tag,#f1f3f5);color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:10.5px;line-height:1.7}
.drr-chip{display:inline-block;padding:1px 8px;border-radius:4px;font-size:10.5px;line-height:1.8;background:var(--dsw-alias-markdown-tag,#f1f3f5);color:var(--dsw-alias-label-secondary,#9a9a9a);white-space:nowrap}
.drr-chip-topic{background:var(--dsw-specific-bubble,#edf3fe);color:var(--dsw-alias-link,#4176e6);font-weight:600}
.drr-chip-match{background:var(--dsw-alias-state-success-tertiary,#e6faed);color:var(--dsw-alias-label-primary,#0f1115);max-width:100%;overflow:hidden;text-overflow:ellipsis}
.drr-chip-oa{background:var(--dsw-alias-state-success-tertiary,#e6faed);color:var(--dsw-alias-label-primary,#0f1115);font-weight:600}
.drr-card-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l3,rgba(128,128,128,.28));color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11px}
.drr-card-foot a{color:var(--dsw-alias-link,#4176e6);text-decoration:none}
.drr-card-foot a:hover{text-decoration:underline}
.drr-abstract{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,#9a9a9a);white-space:pre-wrap}
.drr-empty{color:var(--dsw-alias-label-secondary,#9a9a9a);text-align:center;padding:48px 20px;line-height:1.8;font-size:12.5px}
.drr-row{display:flex;align-items:flex-start;gap:10px;padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28))}
.drr-row:last-child{border-bottom:none}
.drr-row-main{flex:1;min-width:0}
.drr-row-name{font-weight:600;margin-bottom:3px;font-size:13px}
.drr-row-kw{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11.5px;word-break:break-word;line-height:1.65}
.drr-form{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28));border-radius:10px;padding:16px;margin-bottom:16px;background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.drr-label{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin:12px 0 4px;font-weight:600}
.drr-label:first-child{margin-top:0}
.drr-input,.drr-textarea,.drr-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base,#1a1a1a);border:1px solid var(--dsw-alias-border-l4,rgba(128,128,128,.28));border-radius:6px;padding:6px 9px;color:inherit;font-size:12px;font-family:inherit;outline:none}
.drr-input:focus,.drr-textarea:focus,.drr-select:focus{border-color:var(--dsw-alias-link,#4176e6)}
.drr-textarea{resize:vertical;min-height:52px;line-height:1.55}
.drr-check{display:flex;align-items:center;gap:7px;margin:9px 0;font-size:12px}
.drr-check input{width:14px;height:14px;accent-color:var(--dsw-alias-link,#4176e6)}
.drr-form-actions{display:flex;gap:8px;margin-top:16px;align-items:center}
.drr-note{padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px;line-height:1.55;white-space:pre-wrap}
.drr-note-ok{background:var(--dsw-alias-state-success-tertiary,#e6faed);color:var(--dsw-alias-label-primary,#0f1115)}
.drr-note-err{background:var(--dsw-static-red-100,#fee2e2);color:var(--dsw-alias-state-error-primary,#ec1313)}
.drr-note-warn{background:var(--dsw-alias-state-warn-tertiary,#fef5e7);color:var(--dsw-alias-label-primary,#0f1115)}
.drr-sec{font-size:12px;font-weight:600;margin:0 0 6px}
.drr-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin:5px 0 0;line-height:1.65}
.drr-inline{display:flex;gap:12px}
.drr-inline > *{flex:1;min-width:0}
.drr-src{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.drr-src label{display:flex;align-items:center;gap:5px;font-size:11.5px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l4,rgba(128,128,128,.28));border-radius:20px;cursor:pointer;line-height:1.5}
.drr-src label:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.drr-preview{border:1px dashed var(--dsw-alias-border-l4,rgba(128,128,128,.28));border-radius:8px;padding:12px 14px;margin-top:14px}
.drr-preview-title{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin-bottom:9px;font-weight:600}
.drr-preview-item{padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28));font-size:12px;line-height:1.6}
.drr-preview-item:last-child{border-bottom:none}
.drr-preview-item a{color:inherit;text-decoration:none;font-weight:500}
.drr-preview-item a:hover{color:var(--dsw-alias-link,#4176e6);text-decoration:underline}
.drr-preview-meta{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:10.5px;margin-top:2px}
`

    function api(action, body) {
      const init = {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-dsh-research-radar': '1' },
      }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(`${API}/${action}`, init).then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        return data
      })
    }

    function fmtDate(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value.slice(0, 10)
      return date.toLocaleDateString()
    }

    function fmtTime(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value.slice(0, 16)
      return date.toLocaleString()
    }

    function Field({ t, labelKey, value }) {
      if (typeof value !== 'string' || value === '' || value === '摘要未提及') return null
      return h('div', { className: 'drr-field' }, h('b', null, t(labelKey)), value)
    }

    function ItemCard({ item, t }) {
      const s = item.summary !== null && typeof item.summary === 'object' ? item.summary : null
      const hasStructured =
        s !== null &&
        ['tldr', 'problem', 'method', 'findings', 'innovation', 'limitations', 'relevance'].some(
          (k) => typeof s[k] === 'string' && s[k] !== '' && s[k] !== '摘要未提及',
        )

      const topRow = h(
        'div',
        { className: 'drr-card-top' },
        item.topicName ? h('span', { className: 'drr-chip drr-chip-topic' }, item.topicName) : null,
        item.venue ? h('span', { className: 'drr-chip' }, item.venue) : null,
        item.publishedAt ? h('span', { className: 'drr-chip' }, fmtDate(item.publishedAt)) : null,
        item.source ? h('span', { className: 'drr-chip' }, item.source) : null,
        item.openAccess === true ? h('span', { className: 'drr-chip drr-chip-oa' }, t('open_access')) : null,
        item.matchedIn ? h('span', { className: 'drr-chip drr-chip-match' }, `${t('matched')} · ${item.matchedIn}`) : null,
      )

      const body = hasStructured
        ? h(
            'div',
            null,
            s.tldr && s.tldr !== '摘要未提及'
              ? h('div', { className: 'drr-tldr' }, h('b', null, t('tldr')), s.tldr)
              : null,
            h(
              'div',
              { className: 'drr-grid' },
              h(Field, { t, labelKey: 'problem', value: s.problem }),
              h(Field, { t, labelKey: 'method', value: s.method }),
              h(Field, { t, labelKey: 'findings', value: s.findings }),
              h(Field, { t, labelKey: 'innovation', value: s.innovation }),
              h(Field, { t, labelKey: 'limitations', value: s.limitations }),
              h(Field, { t, labelKey: 'relevance', value: s.relevance }),
            ),
            Array.isArray(s.tags) && s.tags.length > 0
              ? h(
                  'div',
                  { className: 'drr-tags' },
                  s.tags.map((tag, index) => h('span', { className: 'drr-tag', key: index }, tag)),
                )
              : null,
          )
        : item.summaryError
          ? h('div', { className: 'drr-field' }, h('b', null, t('summary_failed')), item.summaryError)
          : h(
              'div',
              null,
              h('div', { className: 'drr-field' }, h('b', null, t('abstract_only'))),
              h(
                'div',
                { className: 'drr-abstract' },
                item.abstract ? item.abstract.slice(0, 1200) : t('no_abstract'),
              ),
            )

      const foot = h(
        'div',
        { className: 'drr-card-foot' },
        Array.isArray(item.authors) && item.authors.length > 0
          ? h('span', null, `${t('authors_label')}: ${item.authors.slice(0, 6).join(', ')}${item.authors.length > 6 ? ' 等' : ''}`)
          : null,
        Number(item.citations) > 0 ? h('span', null, `${t('cited')} ${item.citations}`) : null,
        item.url
          ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer noopener' }, item.doi ? `DOI ${item.doi}` : '↗')
          : null,
        h('span', { className: 'drr-spacer' }),
        item.discoveredAt ? h('span', null, fmtTime(item.discoveredAt)) : null,
      )

      return h(
        'div',
        { className: 'drr-card' },
        topRow,
        h(
          'div',
          { className: 'drr-card-title' },
          h('a', { href: item.url || '#', target: '_blank', rel: 'noreferrer noopener' }, item.title || '(无标题)'),
        ),
        body,
        foot,
      )
    }

    function linesToList(text) {
      return String(text || '')
        .split(/[,，;；\n]/)
        .map((v) => v.trim())
        .filter(Boolean)
    }

    function TopicForm({ t, initial, onSave, onCancel }) {
      const [name, setName] = React.useState(initial ? initial.name : '')
      const [keywords, setKeywords] = React.useState(initial ? (initial.keywords || []).join(', ') : '')
      const [authors, setAuthors] = React.useState(initial ? (initial.authors || []).join(', ') : '')
      const [venues, setVenues] = React.useState(initial ? (initial.venues || []).join('\n') : '')
      const [institutions, setInstitutions] = React.useState(initial ? (initial.institutions || []).join('\n') : '')
      const [exclude, setExclude] = React.useState(initial ? (initial.exclude || []).join(', ') : '')
      const [matchMode, setMatchMode] = React.useState(initial && initial.matchMode === 'all' ? 'all' : 'any')
      const [strict, setStrict] = React.useState(!(initial && initial.strict === false))
      const [sources, setSources] = React.useState(
        initial && Array.isArray(initial.sources) && initial.sources.length > 0 ? initial.sources : ['openalex'],
      )
      const [preview, setPreview] = React.useState(null)
      const [previewing, setPreviewing] = React.useState(false)

      const toggle = (source) => {
        setSources((current) =>
          current.includes(source) ? current.filter((s) => s !== source) : current.concat(source),
        )
      }

      const draft = () => ({
        name,
        keywords: linesToList(keywords),
        authors: linesToList(authors),
        venues: linesToList(venues),
        institutions: linesToList(institutions),
        exclude: linesToList(exclude),
        matchMode,
        strict,
        sources,
      })

      const runPreview = () => {
        setPreviewing(true)
        setPreview(null)
        api('preview', { topic: draft(), max: 5 })
          .then((result) => setPreview(result))
          .catch((error) => setPreview({ items: [], errors: [{ source: 'preview', message: error.message }] }))
          .finally(() => setPreviewing(false))
      }

      const previewEl =
        preview === null
          ? null
          : h(
              'div',
              { className: 'drr-preview' },
              h('div', { className: 'drr-preview-title' }, t('preview_title')),
              Array.isArray(preview.errors) && preview.errors.length > 0
                ? h(
                    'div',
                    { className: 'drr-note drr-note-warn', style: { marginBottom: '8px' } },
                    preview.errors.map((e) => `${e.source}: ${e.message}`).join('\n'),
                  )
                : null,
              !Array.isArray(preview.items) || preview.items.length === 0
                ? h('div', { className: 'drr-hint' }, t('preview_empty'))
                : preview.items.map((item, index) =>
                    h(
                      'div',
                      { className: 'drr-preview-item', key: item.id || index },
                      h('a', { href: item.url, target: '_blank', rel: 'noreferrer noopener' }, item.title),
                      h(
                        'div',
                        { className: 'drr-preview-meta' },
                        [
                          item.venue,
                          item.publishedAt ? String(item.publishedAt).slice(0, 10) : '',
                          item.source,
                          item.matchedIn ? `${t('matched')} · ${item.matchedIn}` : '',
                        ]
                          .filter(Boolean)
                          .join('  ·  '),
                      ),
                    ),
                  ),
            )

      return h(
        'div',
        { className: 'drr-form' },
        h('label', { className: 'drr-label' }, t('topic_name')),
        h('input', {
          className: 'drr-input',
          value: name,
          onChange: (e) => setName(e.target.value),
          placeholder: t('topic_name_ph'),
        }),
        h('label', { className: 'drr-label' }, t('keywords')),
        h('textarea', {
          className: 'drr-textarea',
          value: keywords,
          onChange: (e) => setKeywords(e.target.value),
          placeholder: t('keywords_ph'),
        }),
        h(
          'div',
          { className: 'drr-inline' },
          h(
            'div',
            null,
            h('label', { className: 'drr-label' }, t('authors')),
            h('textarea', {
              className: 'drr-textarea',
              value: authors,
              onChange: (e) => setAuthors(e.target.value),
              placeholder: t('authors_ph'),
            }),
          ),
          h(
            'div',
            null,
            h('label', { className: 'drr-label' }, t('exclude')),
            h('textarea', {
              className: 'drr-textarea',
              value: exclude,
              onChange: (e) => setExclude(e.target.value),
              placeholder: t('exclude_ph'),
            }),
          ),
        ),
        h(
          'div',
          { className: 'drr-inline' },
          h(
            'div',
            null,
            h('label', { className: 'drr-label' }, t('venues')),
            h('textarea', {
              className: 'drr-textarea',
              value: venues,
              onChange: (e) => setVenues(e.target.value),
              placeholder: t('venues_ph'),
            }),
          ),
          h(
            'div',
            null,
            h('label', { className: 'drr-label' }, t('institutions')),
            h('textarea', {
              className: 'drr-textarea',
              value: institutions,
              onChange: (e) => setInstitutions(e.target.value),
              placeholder: t('institutions_ph'),
            }),
          ),
        ),
        h('label', { className: 'drr-label' }, t('topic_sources')),
        h(
          'div',
          { className: 'drr-src' },
          ['openalex', 'crossref', 'pubmed', 'arxiv', 'biorxiv', 'rss'].map((source) =>
            h(
              'label',
              { key: source },
              h('input', { type: 'checkbox', checked: sources.includes(source), onChange: () => toggle(source) }),
              source,
            ),
          ),
        ),
        h('div', { className: 'drr-hint' }, t('sources_hint')),
        h('label', { className: 'drr-label' }, t('match_mode')),
        h(
          'div',
          { className: 'drr-src' },
          h(
            'label',
            null,
            h('input', {
              type: 'radio',
              name: 'matchMode',
              checked: matchMode === 'any',
              onChange: () => setMatchMode('any'),
            }),
            t('match_any'),
          ),
          h(
            'label',
            null,
            h('input', {
              type: 'radio',
              name: 'matchMode',
              checked: matchMode === 'all',
              onChange: () => setMatchMode('all'),
            }),
            t('match_all'),
          ),
        ),
        h(
          'label',
          { className: 'drr-check' },
          h('input', { type: 'checkbox', checked: strict, onChange: (e) => setStrict(e.target.checked) }),
          t('strict_mode'),
        ),
        h('div', { className: 'drr-hint' }, t('strict_hint')),
        h(
          'div',
          { className: 'drr-form-actions' },
          h('button', { className: 'drr-btn drr-btn-primary', onClick: () => onSave(draft()) }, t('save')),
          h(
            'button',
            { className: 'drr-btn', onClick: runPreview, disabled: previewing },
            previewing ? t('previewing') : t('preview'),
          ),
          h('button', { className: 'drr-btn', onClick: onCancel }, t('cancel')),
        ),
        previewEl,
      )
    }

    function Panel() {
      const [locale] = React.useState(() => {
        try {
          const value = document.documentElement.lang || navigator.language || 'zh'
          return String(value).toLowerCase().startsWith('en') ? 'en' : 'zh'
        } catch {
          return 'zh'
        }
      })
      const t = (key) => (DICT[locale] && DICT[locale][key]) || DICT.zh[key] || key

      const [data, setData] = React.useState(null)
      const [tab, setTab] = React.useState('items')
      const [busy, setBusy] = React.useState('')
      const [note, setNote] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [showForm, setShowForm] = React.useState(false)
      const [mailDraft, setMailDraft] = React.useState(null)
      const [scanDraft, setScanDraft] = React.useState(null)
      const [apiDraft, setApiDraft] = React.useState(null)
      const [rssDraft, setRssDraft] = React.useState('')
      const [topicFilter, setTopicFilter] = React.useState('')

      const applyState = (next) => {
        setData(next)
        if (next && next.settings) {
          setMailDraft({ ...next.settings.mail })
          setScanDraft({ ...next.settings.scan })
          setApiDraft({ ...(next.settings.api || {}) })
          setRssDraft((next.settings.rss || []).join('\n'))
        }
      }

      const refresh = React.useCallback(
        () =>
          api('state')
            .then(applyState)
            .catch((error) => setNote({ kind: 'err', text: `${t('load_failed')}: ${error.message}` })),
        [],
      )

      React.useEffect(() => {
        void refresh()
      }, [])

      const runScan = () => {
        setBusy('scan')
        setNote(null)
        api('scan', {})
          .then((result) => {
            applyState(result.state)
            const head =
              result.newCount > 0
                ? `${t('scan_done')}：${result.newCount} ${t('new_items')}`
                : `${t('scan_done')}：${t('no_new')}`
            const errors = Array.isArray(result.errors) && result.errors.length > 0
            const detail = errors ? `\n${result.errors.map((e) => `${e.source}: ${e.message}`).join('\n')}` : ''
            setNote({ kind: errors ? 'warn' : 'ok', text: head + detail })
          })
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      const saveTopic = (payload) => {
        setBusy('topic')
        api('topics', { op: 'upsert', topic: { ...payload, id: editing ? editing.id : undefined } })
          .then(() => {
            setShowForm(false)
            setEditing(null)
            setNote({ kind: 'ok', text: t('saved') })
            return refresh()
          })
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      const removeTopic = (id) => {
        setBusy('topic')
        api('topics', { op: 'delete', topic: { id } })
          .then(() => refresh())
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      const saveSettings = () => {
        setBusy('settings')
        api('settings', {
          settings: {
            scan: scanDraft,
            api: apiDraft,
            mail: mailDraft,
            rss: String(rssDraft || '')
              .split(/\n+/)
              .map((s) => s.trim())
              .filter(Boolean),
          },
        })
          .then((result) => {
            applyState(result.state)
            setNote({ kind: 'ok', text: t('saved') })
          })
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      const testMail = () => {
        setBusy('mail')
        setNote(null)
        api('settings', { settings: { mail: mailDraft, api: apiDraft, scan: scanDraft } })
          .then(() => api('test-mail', {}))
          .then(() => setNote({ kind: 'ok', text: '测试邮件已发送 / test email sent' }))
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      if (data === null) {
        return h('div', { className: 'drr-root' }, h('div', { className: 'drr-empty' }, '…'))
      }

      const allItems = data.items || []
      const topics = data.topics || []
      const items = topicFilter === '' ? allItems : allItems.filter((i) => i.topicId === topicFilter)

      const noteEl =
        note === null
          ? null
          : h(
              'div',
              {
                className: `drr-note ${note.kind === 'ok' ? 'drr-note-ok' : note.kind === 'warn' ? 'drr-note-warn' : 'drr-note-err'}`,
              },
              note.text,
            )

      const itemsTab = h(
        'div',
        null,
        noteEl,
        topics.length > 1
          ? h(
              'div',
              { style: { marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' } },
              h(
                'select',
                {
                  className: 'drr-select',
                  style: { width: 'auto', minWidth: '180px' },
                  value: topicFilter,
                  onChange: (e) => setTopicFilter(e.target.value),
                },
                h('option', { value: '' }, t('filter_all')),
                topics.map((topic) => h('option', { key: topic.id, value: topic.id }, topic.name)),
              ),
              h('span', { className: 'drr-count' }, `${items.length}`),
            )
          : null,
        items.length === 0
          ? h('div', { className: 'drr-empty' }, t('empty_items'))
          : items.map((item) => h(ItemCard, { key: item.id, item, t })),
      )

      const topicsTab = h(
        'div',
        null,
        noteEl,
        showForm || editing !== null
          ? h(TopicForm, {
              t,
              initial: editing,
              onSave: saveTopic,
              onCancel: () => {
                setShowForm(false)
                setEditing(null)
              },
            })
          : h(
              'button',
              { className: 'drr-btn drr-btn-primary', onClick: () => setShowForm(true), style: { marginBottom: '14px' } },
              t('add_topic'),
            ),
        topics.length === 0
          ? h('div', { className: 'drr-empty' }, t('empty_topics'))
          : h(
              'div',
              null,
              topics.map((topic) =>
                h(
                  'div',
                  { className: 'drr-row', key: topic.id },
                  h(
                    'div',
                    { className: 'drr-row-main' },
                    h('div', { className: 'drr-row-name' }, topic.name),
                    h(
                      'div',
                      { className: 'drr-row-kw' },
                      [
                        (topic.keywords || []).length > 0 ? `关键词：${topic.keywords.join(' · ')}` : '',
                        (topic.authors || []).length > 0 ? `作者：${topic.authors.join(' · ')}` : '',
                        (topic.venues || []).length > 0 ? `期刊：${topic.venues.join(' · ')}` : '',
                        (topic.institutions || []).length > 0 ? `单位：${topic.institutions.join(' · ')}` : '',
                        (topic.exclude || []).length > 0 ? `排除：${topic.exclude.join(' · ')}` : '',
                        `库：${(topic.sources || []).join(', ')}`,
                      ]
                        .filter(Boolean)
                        .join('　|　'),
                    ),
                  ),
                  h(
                    'button',
                    {
                      className: 'drr-btn drr-btn-sm',
                      onClick: () => {
                        setEditing(topic)
                        setShowForm(false)
                      },
                    },
                    t('edit'),
                  ),
                  h(
                    'button',
                    { className: 'drr-btn drr-btn-sm drr-btn-danger', onClick: () => removeTopic(topic.id) },
                    t('remove'),
                  ),
                ),
              ),
            ),
      )

      const settingsTab = h(
        'div',
        null,
        noteEl,
        h(
          'div',
          { className: 'drr-form' },
          h('div', { className: 'drr-sec' }, t('scan_settings')),
          scanDraft === null
            ? null
            : h(
                'div',
                null,
                h(
                  'label',
                  { className: 'drr-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: scanDraft.enabled !== false,
                    onChange: (e) => setScanDraft({ ...scanDraft, enabled: e.target.checked }),
                  }),
                  t('auto_scan'),
                ),
                h(
                  'div',
                  { className: 'drr-inline' },
                  h(
                    'div',
                    null,
                    h('label', { className: 'drr-label' }, t('interval_hours')),
                    h('input', {
                      className: 'drr-input',
                      type: 'number',
                      min: 1,
                      max: 168,
                      value: scanDraft.intervalHours,
                      onChange: (e) => setScanDraft({ ...scanDraft, intervalHours: Number(e.target.value) }),
                    }),
                  ),
                  h(
                    'div',
                    null,
                    h('label', { className: 'drr-label' }, t('max_per_topic')),
                    h('input', {
                      className: 'drr-input',
                      type: 'number',
                      min: 1,
                      max: 30,
                      value: scanDraft.maxPerTopic,
                      onChange: (e) => setScanDraft({ ...scanDraft, maxPerTopic: Number(e.target.value) }),
                    }),
                  ),
                  h(
                    'div',
                    null,
                    h('label', { className: 'drr-label' }, t('lookback_days')),
                    h('input', {
                      className: 'drr-input',
                      type: 'number',
                      min: 1,
                      max: 3650,
                      value: scanDraft.lookbackDays,
                      onChange: (e) => setScanDraft({ ...scanDraft, lookbackDays: Number(e.target.value) }),
                    }),
                  ),
                ),
                h(
                  'label',
                  { className: 'drr-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: scanDraft.summarize !== false,
                    onChange: (e) => setScanDraft({ ...scanDraft, summarize: e.target.checked }),
                  }),
                  t('do_summarize'),
                ),
                h(
                  'div',
                  { className: 'drr-hint' },
                  `${t('last_scan')}: ${scanDraft.lastScanAt ? fmtTime(scanDraft.lastScanAt) : t('never')}`,
                ),
              ),
        ),
        h(
          'div',
          { className: 'drr-form' },
          h('div', { className: 'drr-sec' }, t('api_settings')),
          apiDraft === null
            ? null
            : h(
                'div',
                null,
                h('label', { className: 'drr-label' }, t('api_mailto')),
                h('input', {
                  className: 'drr-input',
                  value: apiDraft.mailto || '',
                  onChange: (e) => setApiDraft({ ...apiDraft, mailto: e.target.value }),
                  placeholder: 'you@example.com',
                }),
                h('label', { className: 'drr-label' }, t('api_openalex_key')),
                h('input', {
                  className: 'drr-input',
                  value: apiDraft.openalexKey || '',
                  onChange: (e) => setApiDraft({ ...apiDraft, openalexKey: e.target.value }),
                  placeholder: '(optional)',
                }),
              ),
        ),
        h(
          'div',
          { className: 'drr-form' },
          h('div', { className: 'drr-sec' }, t('mail_settings')),
          mailDraft === null
            ? null
            : h(
                'div',
                null,
                h(
                  'label',
                  { className: 'drr-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: mailDraft.enabled === true,
                    onChange: (e) => setMailDraft({ ...mailDraft, enabled: e.target.checked }),
                  }),
                  t('mail_enabled'),
                ),
                h(
                  'div',
                  { className: 'drr-inline' },
                  h(
                    'div',
                    { style: { flex: 2 } },
                    h('label', { className: 'drr-label' }, t('smtp_host')),
                    h('input', {
                      className: 'drr-input',
                      value: mailDraft.host || '',
                      onChange: (e) => setMailDraft({ ...mailDraft, host: e.target.value }),
                      placeholder: 'smtp.qq.com',
                    }),
                  ),
                  h(
                    'div',
                    null,
                    h('label', { className: 'drr-label' }, t('smtp_port')),
                    h('input', {
                      className: 'drr-input',
                      type: 'number',
                      value: mailDraft.port,
                      onChange: (e) => setMailDraft({ ...mailDraft, port: Number(e.target.value) }),
                    }),
                  ),
                ),
                h(
                  'label',
                  { className: 'drr-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: mailDraft.secure === true,
                    onChange: (e) => setMailDraft({ ...mailDraft, secure: e.target.checked }),
                  }),
                  t('smtp_secure'),
                ),
                h(
                  'div',
                  { className: 'drr-inline' },
                  h(
                    'div',
                    null,
                    h('label', { className: 'drr-label' }, t('smtp_user')),
                    h('input', {
                      className: 'drr-input',
                      value: mailDraft.user || '',
                      onChange: (e) => setMailDraft({ ...mailDraft, user: e.target.value }),
                    }),
                  ),
                  h(
                    'div',
                    null,
                    h('label', { className: 'drr-label' }, t('smtp_pass')),
                    h('input', {
                      className: 'drr-input',
                      type: 'password',
                      value: mailDraft.pass || '',
                      onChange: (e) => setMailDraft({ ...mailDraft, pass: e.target.value }),
                    }),
                  ),
                ),
                h('label', { className: 'drr-label' }, t('mail_from')),
                h('input', {
                  className: 'drr-input',
                  value: mailDraft.from || '',
                  onChange: (e) => setMailDraft({ ...mailDraft, from: e.target.value }),
                  placeholder: 'radar@example.com',
                }),
                h('label', { className: 'drr-label' }, t('mail_to')),
                h('input', {
                  className: 'drr-input',
                  value: mailDraft.to || '',
                  onChange: (e) => setMailDraft({ ...mailDraft, to: e.target.value }),
                  placeholder: 'you@example.com',
                }),
                h(
                  'div',
                  { className: 'drr-hint' },
                  `${t('last_mail')}: ${mailDraft.lastSentAt ? fmtTime(mailDraft.lastSentAt) : t('never')}`,
                ),
              ),
        ),
        h(
          'div',
          { className: 'drr-form' },
          h('div', { className: 'drr-sec' }, t('rss_feeds')),
          h('textarea', {
            className: 'drr-textarea',
            value: rssDraft,
            onChange: (e) => setRssDraft(e.target.value),
            placeholder: 'https://rss.arxiv.org/rss/cs.AI',
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: '8px' } },
          h('button', { className: 'drr-btn drr-btn-primary', onClick: saveSettings, disabled: busy === 'settings' }, t('save')),
          h('button', { className: 'drr-btn', onClick: testMail, disabled: busy === 'mail' }, t('test_mail')),
        ),
      )

      return h(
        'div',
        { className: 'drr-root' },
        h(
          'div',
          { className: 'drr-head' },
          h(
            'div',
            null,
            h('h1', { className: 'drr-title' }, t('title')),
            h('p', { className: 'drr-sub' }, t('subtitle')),
          ),
          h('div', { className: 'drr-spacer' }),
          h(
            'button',
            { className: 'drr-btn drr-btn-primary', onClick: runScan, disabled: busy === 'scan' },
            busy === 'scan' ? t('scanning') : t('scan_now'),
          ),
        ),
        h(
          'div',
          { className: 'drr-tabs' },
          ['items', 'topics', 'settings'].map((key) =>
            h(
              'button',
              {
                key,
                className: `drr-tab ${tab === key ? 'drr-tab-active' : ''}`,
                onClick: () => setTab(key),
              },
              t(`tab_${key}`),
              key === 'items' && allItems.length > 0 ? h('span', { className: 'drr-count' }, String(allItems.length)) : null,
            ),
          ),
        ),
        h(
          'div',
          { className: 'drr-body' },
          tab === 'items' ? itemsTab : tab === 'topics' ? topicsTab : settingsTab,
        ),
      )
    }

    function RadarIcon({ size }) {
      const s = typeof size === 'number' && size > 0 ? size : 16
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.45 }),
        h('circle', { cx: 12, cy: 12, r: 5, stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.7 }),
        h('circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor' }),
        h('path', { d: 'M12 12 L18.4 5.6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
        h('circle', { cx: 17, cy: 8, r: 1.5, fill: 'currentColor' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'research-radar.locale')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/dsh-research-radar'
          tag.textContent = CSS
          document.head.append(tag)
          return () => {
            tag.remove()
          }
        }, 'research-radar.styles')

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: PANEL_ID,
                  order: 5,
                  label: () => ctx.locale.bind(NS)('title'),
                },
                RadarIcon,
              ),
            ),
          'research-radar.sidebar',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Panel),
            ),
          'research-radar.panel',
        )
      },
    }
  },
})
