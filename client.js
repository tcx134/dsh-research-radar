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
        subtitle: '监控研究方向的最新论文，自动总结方法、内容与创新点',
        tab_items: '最新论文',
        tab_topics: '研究方向',
        tab_settings: '设置',
        scan_now: '立即扫描',
        scanning: '扫描中…',
        empty_items: '还没有抓取到论文。先添加研究方向，然后点「立即扫描」。',
        empty_topics: '还没有研究方向。添加一个方向（名称 + 关键词）开始监控。',
        add_topic: '添加方向',
        topic_name: '方向名称',
        topic_keywords: '关键词（逗号或换行分隔）',
        topic_sources: '订阅源',
        save: '保存',
        cancel: '取消',
        edit: '编辑',
        remove: '删除',
        enabled: '启用',
        disabled: '停用',
        scan_settings: '扫描设置',
        auto_scan: '启用定时扫描',
        interval_hours: '扫描间隔（小时）',
        max_per_topic: '每个方向每次最多抓取',
        do_summarize: '用 LLM 生成结构化摘要',
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
        authors: '作者',
        summary_failed: '摘要生成失败',
        clear_items: '清空已抓取',
        load_failed: '加载失败',
        summary_off: '未启用 LLM 摘要',
      },
      en: {
        title: 'Research Radar',
        subtitle: 'Monitor new papers in your fields and summarize method, findings and novelty',
        tab_items: 'Papers',
        tab_topics: 'Topics',
        tab_settings: 'Settings',
        scan_now: 'Scan now',
        scanning: 'Scanning…',
        empty_items: 'No papers yet. Add a topic, then press "Scan now".',
        empty_topics: 'No topics yet. Add a name and keywords to start monitoring.',
        add_topic: 'Add topic',
        topic_name: 'Topic name',
        topic_keywords: 'Keywords (comma or newline separated)',
        topic_sources: 'Sources',
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        remove: 'Delete',
        enabled: 'Enabled',
        disabled: 'Disabled',
        scan_settings: 'Scan settings',
        auto_scan: 'Enable scheduled scanning',
        interval_hours: 'Interval (hours)',
        max_per_topic: 'Max items per topic',
        do_summarize: 'Generate structured summary with LLM',
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
        authors: 'Authors',
        summary_failed: 'Summary failed',
        clear_items: 'Clear papers',
        load_failed: 'Failed to load',
        summary_off: 'LLM summary disabled',
      },
    }

    const CSS = `
.drr-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-base,#1a1a1a);font-size:13px}
.drr-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}
.drr-title{font-size:15px;font-weight:600;margin:0}
.drr-sub{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:12px;margin:2px 0 0}
.drr-spacer{flex:1}
.drr-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#494949);background:var(--dsw-alias-bg-layer-1,#242424);color:inherit;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit}
.drr-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#2c2c2c)}
.drr-btn:disabled{opacity:.5;cursor:default}
.drr-btn-primary{background:var(--dsw-alias-brand-primary,#4d7cfe);border-color:transparent;color:#fff}
.drr-btn-primary:hover:not(:disabled){filter:brightness(1.08);background:var(--dsw-alias-brand-primary,#4d7cfe)}
.drr-btn-danger{color:var(--dsw-alias-state-error-primary,#e5534b)}
.drr-tabs{display:flex;gap:4px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}
.drr-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit}
.drr-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.drr-tab-active{background:var(--dsw-alias-bg-layer-2,#2c2c2c);color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
.drr-body{flex:1;min-height:0;overflow:auto;padding:14px 18px 40px}
.drr-card{border:1px solid var(--dsw-alias-border-l1,#333);border-radius:8px;padding:12px 14px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1,#242424)}
.drr-card-title{font-size:13px;font-weight:600;line-height:1.45;margin:0 0 4px}
.drr-card-title a{color:inherit;text-decoration:none}
.drr-card-title a:hover{color:var(--dsw-alias-brand-primary,#4d7cfe);text-decoration:underline}
.drr-meta{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11px;margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap}
.drr-field{margin:3px 0;line-height:1.6}
.drr-field b{color:var(--dsw-alias-label-secondary,#9a9a9a);font-weight:500}
.drr-tag{display:inline-block;padding:1px 7px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#2c2c2c);color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:10px;margin-right:5px}
.drr-empty{color:var(--dsw-alias-label-secondary,#9a9a9a);text-align:center;padding:48px 20px;line-height:1.7}
.drr-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}
.drr-row:last-child{border-bottom:none}
.drr-row-main{flex:1;min-width:0}
.drr-row-name{font-weight:600;margin-bottom:2px}
.drr-row-kw{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11px;word-break:break-word}
.drr-form{border:1px solid var(--dsw-alias-border-l2,#494949);border-radius:8px;padding:14px;margin-bottom:14px;background:var(--dsw-alias-bg-layer-1,#242424)}
.drr-label{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin:10px 0 4px}
.drr-label:first-child{margin-top:0}
.drr-input,.drr-textarea,.drr-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base,#1a1a1a);border:1px solid var(--dsw-alias-border-l2,#494949);border-radius:6px;padding:6px 9px;color:inherit;font-size:12px;font-family:inherit;outline:none}
.drr-input:focus,.drr-textarea:focus,.drr-select:focus{border-color:var(--dsw-alias-brand-primary,#4d7cfe)}
.drr-textarea{resize:vertical;min-height:56px;line-height:1.5}
.drr-check{display:flex;align-items:center;gap:7px;margin:9px 0;font-size:12px}
.drr-check input{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary,#4d7cfe)}
.drr-form-actions{display:flex;gap:8px;margin-top:14px}
.drr-note{padding:7px 12px;border-radius:6px;font-size:12px;margin-bottom:12px;line-height:1.5}
.drr-note-ok{background:rgba(81,185,118,.12);color:var(--dsw-alias-state-success-primary,#51b976)}
.drr-note-err{background:rgba(229,83,75,.12);color:var(--dsw-alias-state-error-primary,#e5534b)}
.drr-note-warn{background:rgba(212,146,69,.12);color:var(--dsw-alias-state-warn-primary,#d49245)}
.drr-sec{font-size:12px;font-weight:600;margin:0 0 4px}
.drr-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin:4px 0 0;line-height:1.6}
.drr-inline{display:flex;gap:10px}
.drr-inline > *{flex:1}
.drr-src{display:flex;gap:14px;flex-wrap:wrap;margin-top:4px}
.drr-src label{display:flex;align-items:center;gap:5px;font-size:12px}
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

    function fmtTime(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value.slice(0, 16)
      return date.toLocaleString()
    }

    function field(t, key, value) {
      if (typeof value !== 'string' || value === '') return null
      return h('div', { className: 'drr-field', key }, h('b', null, `${t(key)}：`), value)
    }

    function ItemCard({ item, t }) {
      const s = item.summary
      return h(
        'div',
        { className: 'drr-card' },
        h(
          'div',
          { className: 'drr-card-title' },
          h('a', { href: item.url, target: '_blank', rel: 'noreferrer noopener' }, item.title || '(无标题)'),
        ),
        h(
          'div',
          { className: 'drr-meta' },
          item.topicName ? h('span', null, `◈ ${item.topicName}`) : null,
          h('span', null, item.source),
          item.publishedAt ? h('span', null, item.publishedAt.slice(0, 10)) : null,
          h('span', null, fmtTime(item.discoveredAt)),
          Array.isArray(item.authors) && item.authors.length > 0
            ? h('span', null, `${t('authors')}: ${item.authors.slice(0, 4).join(', ')}`)
            : null,
        ),
        s !== null && typeof s === 'object'
          ? h(
              'div',
              null,
              field(t, 'tldr', s.tldr),
              field(t, 'problem', s.problem),
              field(t, 'method', s.method),
              field(t, 'findings', s.findings),
              field(t, 'innovation', s.innovation),
              field(t, 'limitations', s.limitations),
              field(t, 'relevance', s.relevance),
              Array.isArray(s.tags) && s.tags.length > 0
                ? h(
                    'div',
                    { className: 'drr-field' },
                    h('b', null, `${t('tags')}：`),
                    s.tags.map((tag, index) => h('span', { className: 'drr-tag', key: index }, tag)),
                  )
                : null,
            )
          : item.summaryError
            ? h('div', { className: 'drr-field' }, h('b', null, `${t('summary_failed')}：`), item.summaryError)
            : h('div', { className: 'drr-field' }, (item.abstract || '').slice(0, 600)),
      )
    }

    function TopicForm({ t, initial, onSave, onCancel }) {
      const [name, setName] = React.useState(initial ? initial.name : '')
      const [keywords, setKeywords] = React.useState(initial ? initial.keywords.join(', ') : '')
      const [sources, setSources] = React.useState(initial ? initial.sources : ['arxiv'])
      const toggle = (source) => {
        setSources((current) =>
          current.includes(source) ? current.filter((s) => s !== source) : current.concat(source),
        )
      }
      return h(
        'div',
        { className: 'drr-form' },
        h('label', { className: 'drr-label' }, t('topic_name')),
        h('input', {
          className: 'drr-input',
          value: name,
          onChange: (e) => setName(e.target.value),
          placeholder: t('topic_name'),
        }),
        h('label', { className: 'drr-label' }, t('topic_keywords')),
        h('textarea', {
          className: 'drr-textarea',
          value: keywords,
          onChange: (e) => setKeywords(e.target.value),
          placeholder: 'large language model, retrieval augmented generation',
        }),
        h('label', { className: 'drr-label' }, t('topic_sources')),
        h(
          'div',
          { className: 'drr-src' },
          ['arxiv', 'biorxiv', 'rss'].map((source) =>
            h(
              'label',
              { key: source },
              h('input', {
                type: 'checkbox',
                checked: sources.includes(source),
                onChange: () => toggle(source),
              }),
              source,
            ),
          ),
        ),
        h(
          'div',
          { className: 'drr-form-actions' },
          h(
            'button',
            {
              className: 'drr-btn drr-btn-primary',
              onClick: () => onSave({ name, keywords, sources }),
            },
            t('save'),
          ),
          h('button', { className: 'drr-btn', onClick: onCancel }, t('cancel')),
        ),
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
      const t = (key) => (DICT[locale] && DICT[locale][key]) || (DICT.zh[key] ?? key)

      const [data, setData] = React.useState(null)
      const [tab, setTab] = React.useState('items')
      const [busy, setBusy] = React.useState('')
      const [note, setNote] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [showForm, setShowForm] = React.useState(false)
      const [mailDraft, setMailDraft] = React.useState(null)
      const [scanDraft, setScanDraft] = React.useState(null)
      const [rssDraft, setRssDraft] = React.useState(null)

      const applyState = (next) => {
        setData(next)
        if (next && next.settings) {
          setMailDraft({ ...next.settings.mail })
          setScanDraft({ ...next.settings.scan })
          setRssDraft((next.settings.rss || []).join('\n'))
        }
      }

      const refresh = React.useCallback(() => {
        return api('state')
          .then(applyState)
          .catch((error) => setNote({ kind: 'err', text: `${t('load_failed')}: ${error.message}` }))
      }, [])

      React.useEffect(() => {
        void refresh()
      }, [])

      const runScan = () => {
        setBusy('scan')
        setNote(null)
        api('scan', {})
          .then((result) => {
            applyState(result.state)
            const text =
              result.newCount > 0
                ? `${t('scan_done')}：${result.newCount} ${t('new_items')}`
                : `${t('scan_done')}：${t('no_new')}`
            const errors = Array.isArray(result.errors) && result.errors.length > 0
            setNote({ kind: errors ? 'warn' : 'ok', text: errors ? `${text}｜${result.errors.map((e) => `${e.source}: ${e.message}`).join('; ')}` : text })
          })
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      const saveTopic = (payload) => {
        setBusy('topic')
        api('topics', { op: 'upsert', topic: { ...payload, id: editing ? editing.id : undefined } })
          .then((result) => {
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
        api('settings', { settings: { mail: mailDraft, scan: scanDraft } })
          .then(() => api('test-mail', {}))
          .then(() => setNote({ kind: 'ok', text: '测试邮件已发送' }))
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      if (data === null) {
        return h('div', { className: 'drr-root' }, h('div', { className: 'drr-empty' }, busy === 'load' ? '…' : t('load_failed')))
      }

      const items = data.items || []
      const topics = data.topics || []

      const noteEl =
        note === null
          ? null
          : h(
              'div',
              { className: `drr-note ${note.kind === 'ok' ? 'drr-note-ok' : note.kind === 'warn' ? 'drr-note-warn' : 'drr-note-err'}` },
              note.text,
            )

      const itemsTab = h(
        'div',
        null,
        items.length === 0
          ? h('div', { className: 'drr-empty' }, t('empty_items'))
          : items.map((item) => h(ItemCard, { key: item.id, item, t })),
      )

      const topicsTab = h(
        'div',
        null,
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
              { className: 'drr-btn drr-btn-primary', onClick: () => setShowForm(true), style: { marginBottom: '12px' } },
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
                    h('div', { className: 'drr-row-kw' }, `${topic.keywords.join(' · ')}　|　${topic.sources.join(', ')}`),
                  ),
                  h(
                    'button',
                    {
                      className: 'drr-btn',
                      onClick: () => {
                        setEditing(topic)
                        setShowForm(false)
                      },
                    },
                    t('edit'),
                  ),
                  h(
                    'button',
                    { className: 'drr-btn drr-btn-danger', onClick: () => removeTopic(topic.id), disabled: busy !== '' },
                    t('remove'),
                  ),
                ),
              ),
            ),
      )

      const settingsTab = h(
        'div',
        null,
        h(
          'div',
          { className: 'drr-card' },
          h('div', { className: 'drr-sec' }, t('scan_settings')),
          h(
            'label',
            { className: 'drr-check' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(scanDraft && scanDraft.enabled),
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
                value: scanDraft ? scanDraft.intervalHours : 12,
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
                max: 20,
                value: scanDraft ? scanDraft.maxPerTopic : 6,
                onChange: (e) => setScanDraft({ ...scanDraft, maxPerTopic: Number(e.target.value) }),
              }),
            ),
          ),
          h(
            'label',
            { className: 'drr-check' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(scanDraft && scanDraft.summarize),
              onChange: (e) => setScanDraft({ ...scanDraft, summarize: e.target.checked }),
            }),
            t('do_summarize'),
          ),
          h('label', { className: 'drr-label' }, t('rss_feeds')),
          h('textarea', {
            className: 'drr-textarea',
            value: rssDraft || '',
            onChange: (e) => setRssDraft(e.target.value),
            placeholder: 'https://export.arxiv.org/rss/cs.AI',
          }),
        ),
        h(
          'div',
          { className: 'drr-card' },
          h('div', { className: 'drr-sec' }, t('mail_settings')),
          h(
            'label',
            { className: 'drr-check' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(mailDraft && mailDraft.enabled),
              onChange: (e) => setMailDraft({ ...mailDraft, enabled: e.target.checked }),
            }),
            t('mail_enabled'),
          ),
          h('label', { className: 'drr-label' }, t('smtp_host')),
          h('input', {
            className: 'drr-input',
            value: mailDraft ? mailDraft.host : '',
            onChange: (e) => setMailDraft({ ...mailDraft, host: e.target.value }),
            placeholder: 'smtp.qq.com',
          }),
          h(
            'div',
            { className: 'drr-inline' },
            h(
              'div',
              null,
              h('label', { className: 'drr-label' }, t('smtp_port')),
              h('input', {
                className: 'drr-input',
                type: 'number',
                value: mailDraft ? mailDraft.port : 465,
                onChange: (e) => setMailDraft({ ...mailDraft, port: Number(e.target.value) }),
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'flex-end', paddingBottom: '6px' } },
              h(
                'label',
                { className: 'drr-check', style: { margin: 0 } },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(mailDraft && mailDraft.secure),
                  onChange: (e) => setMailDraft({ ...mailDraft, secure: e.target.checked }),
                }),
                t('smtp_secure'),
              ),
            ),
          ),
          h('label', { className: 'drr-label' }, t('smtp_user')),
          h('input', {
            className: 'drr-input',
            value: mailDraft ? mailDraft.user : '',
            onChange: (e) => setMailDraft({ ...mailDraft, user: e.target.value }),
          }),
          h('label', { className: 'drr-label' }, t('smtp_pass')),
          h('input', {
            className: 'drr-input',
            type: 'password',
            value: mailDraft ? mailDraft.pass : '',
            onChange: (e) => setMailDraft({ ...mailDraft, pass: e.target.value }),
          }),
          h('label', { className: 'drr-label' }, t('mail_from')),
          h('input', {
            className: 'drr-input',
            value: mailDraft ? mailDraft.from : '',
            onChange: (e) => setMailDraft({ ...mailDraft, from: e.target.value }),
            placeholder: 'me@example.com',
          }),
          h('label', { className: 'drr-label' }, t('mail_to')),
          h('input', {
            className: 'drr-input',
            value: mailDraft ? mailDraft.to : '',
            onChange: (e) => setMailDraft({ ...mailDraft, to: e.target.value }),
            placeholder: 'a@example.com, b@example.com',
          }),
          h('p', { className: 'drr-hint' }, `${t('last_mail')}: ${data.settings.mail.lastSentAt ? fmtTime(data.settings.mail.lastSentAt) : t('never')}`),
          h(
            'div',
            { className: 'drr-form-actions' },
            h('button', { className: 'drr-btn drr-btn-primary', onClick: saveSettings, disabled: busy !== '' }, t('save')),
            h('button', { className: 'drr-btn', onClick: testMail, disabled: busy !== '' }, t('test_mail')),
          ),
        ),
      )

      const scanning = data.status && data.status.scanning
      const lastScan = data.settings.scan.lastScanAt

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
          h('span', { className: 'drr-hint' }, `${t('last_scan')}: ${lastScan ? fmtTime(lastScan) : t('never')}`),
          h(
            'button',
            { className: 'drr-btn drr-btn-primary', onClick: runScan, disabled: busy !== '' || scanning },
            scanning || busy === 'scan' ? t('scanning') : t('scan_now'),
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
                className: `drr-tab${tab === key ? ' drr-tab-active' : ''}`,
                onClick: () => setTab(key),
              },
              t(`tab_${key}`),
            ),
          ),
        ),
        h('div', { className: 'drr-body' }, noteEl, tab === 'items' ? itemsTab : tab === 'topics' ? topicsTab : settingsTab),
      )
    }

    function RadarIcon({ size, active }) {
      const px = typeof size === 'number' && size > 0 ? size : 16
      return h(
        'svg',
        {
          width: px,
          height: px,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('circle', { cx: 12, cy: 12, r: 9 }),
        h('circle', { cx: 12, cy: 12, r: 4.5 }),
        h('path', { d: 'M12 12 L19 6' }),
        h('circle', { cx: 17.5, cy: 6.5, r: 1.4, fill: 'currentColor', stroke: 'none' }),
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

        ctx.slots.inject('sidebar.panellist', () => {
          return ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 5,
              label: () => {
                const t = ctx.locale.bind(NS)
                return t('title')
              },
            },
            RadarIcon,
          )
        })

        ctx.slots.inject('main', () => {
          return ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Panel)
        })
      },
    }
  },
})
