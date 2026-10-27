window.__ModuleLoader__.load({
  id: '@local/dsh-research-radar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-research-radar'
    const PANEL_ID = 'research-radar'
    const API = '/api/dsh-research-radar'
    /** 面板每页拉多少条论文（服务端分页，缺陷 #6）。 */
    const PAGE_SIZE = 50

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
        topic_languages: '文献语言',
        lang_zh: '中文文献',
        lang_en: '英文文献',
        languages_hint:
          '不选或两项都选 = 不限语言。OpenAlex / PubMed 在源站按语言过滤；其它库按标题摘要里的汉字占比本地判断，认不出语言的照常推送。',
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
        lookback_hint: '想看更早的论文就把窗口调大（最长 10 年）。窗口越大，检索和去重越慢，第一次回溯建议先用「回溯检索」跑一次。',
        lookback_presets: '常用范围',
        preset_half_year: '半年',
        preset_one_year: '1 年',
        preset_two_years: '2 年',
        preset_three_years: '3 年',
        backfill: '回溯检索',
        backfill_running: '回溯中…',
        backfill_hint: '用上面的窗口一次性把老论文捞回来（会跳过增量窗口）',
        backfill_done: '回溯完成',
        do_summarize: '用 LLM 生成结构化摘要',
        summary_depth: '解析深度',
        depth_brief: '精简',
        depth_standard: '标准',
        depth_deep: '深度',
        depth_hint: '精简 = 一句话 + 创新点 + 标签，token 最省；标准 = 七字段（无局限）；深度 = 八字段含局限。只影响新扫描的论文，已有摘要不变。',
        depth_cost: '每篇约',
        do_fulltext: '能拿到全文时按全文总结（更准，但慢一些）',
        fulltext_hint: '会依次尝试 arXiv、Europe PMC、开放获取 PDF、出版社 PDF。拿不到全文的论文自动回退摘要，不会报错。关掉能明显加快扫描。',
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
        scan_window: '本次窗口',
        days_unit: '天',
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
        filter_label: '筛选',
        filter_items: '全部',
        filter_unread: '未读',
        filter_starred: '收藏',
        mark_read: '标为已读',
        mark_unread: '标为未读',
        star: '收藏',
        unstar: '取消收藏',
        deep_read: '精读',
        deep_read_title: '在新会话里让 Agent 精读这篇论文',
        deep_read_failed: '无法发起精读',
        deep_read_no_workspace: '还没有可用的工作区，请先建一个会话',
        mark_all_read: '全部标为已读',
        new_items_short: '新增',
        filter_high: '值得读',
        filter_fulltext: '读过全文',
        sort_label: '排序',
        sort_recent: '按时间',
        sort_quality: '按质量',
        quality_high: '高质量',
        quality_medium: '中等',
        quality_low: '较低',
        quality_unknown: '待评估',
        quality_title: '综合期刊影响因子、被引与开放获取算出的质量分',
        quality_why: '依据',
        impact_factor: '影响因子',
        read_fulltext: '已读全文',
        read_abstract: '仅摘要',
        read_fulltext_title: '这篇的结构化摘要是基于论文全文生成的',
        read_abstract_title: '没能拿到全文，摘要只基于摘要字段',
        key_points: '要点',
        show_details: '展开细节',
        hide_details: '收起细节',
        scan_summary_hint: '上次扫描抓到 {n} 篇，其中 {full} 篇读到了全文',
        load_more: '加载更多',
        no_more: '没有更多了',
        empty_unread: '没有未读论文。',
        empty_starred: '还没有收藏的论文。',
        empty_high: '这个筛选下还没有高质量论文。扫描几轮后，顶刊或高被引的会出现在这里。',
        empty_fulltext: '还没有论文读到全文。开放获取的论文会自动尝试抓全文。',
        empty_filtered: '这个方向下还没有论文。',
        read_marked: '已标为已读',
        unread_marked: '已标为未读',
        starred_marked: '已收藏',
        unstarred_marked: '已取消收藏',
        tab_stats: '趋势',
        stats_days: '统计窗口',
        stats_total: '论文总数',
        stats_read: '已读',
        stats_starred: '已收藏',
        stats_summarized: '已摘要',
        stats_weekly: '每周新增',
        stats_week_unit: '周',
        stats_by_source: '来源分布',
        stats_by_venue: '高频期刊',
        stats_by_author: '高频作者',
        stats_by_topic: '方向分布',
        stats_by_tag: '热门标签',
        stats_empty: '这个窗口内还没有数据。先抓取一批论文，或把统计窗口调大。',
        stats_none: '暂无数据',
        stats_load_failed: '趋势数据加载失败',
        days_unit_short: '天',
        tab_library: '论文库',
        lib_group_year: '按年份',
        lib_group_topic: '按方向',
        lib_total: '库内论文',
        lib_span: '覆盖年份',
        lib_old: '老论文',
        lib_recent: '近期',
        lib_unread: '未读',
        lib_starred: '收藏',
        lib_summarized: '已摘要',
        lib_empty: '论文库还是空的。先跑一次扫描；想看更早的论文，把时间范围调大后点「回溯检索」。',
        lib_badge_old: '老',
        lib_badge_new: '新',
        lib_unknown_year: '年份未知',
        lib_untopiced: '未分类',
        lib_load_failed: '论文库加载失败',
        lib_unit: '篇',
        lib_hint: '这里按发表年份把检索到的论文分架摆放 —— 回溯检索捞回来的老论文会落在更早的架子上。',
        lib_no_summary: '未摘要',
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
        topic_languages: 'Languages',
        lang_zh: 'Chinese',
        lang_en: 'English',
        languages_hint:
          'Nothing selected (or both) = no language filter. OpenAlex / PubMed filter on the server; other sources are judged locally by the CJK ratio of title + abstract, and papers whose language cannot be detected are kept.',
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
        lookback_hint: 'Widen the window to reach older papers (up to 10 years). A wider window makes the first scan slower — use "Backfill" once.',
        lookback_presets: 'Presets',
        preset_half_year: '6 mo',
        preset_one_year: '1 yr',
        preset_two_years: '2 yr',
        preset_three_years: '3 yr',
        backfill: 'Backfill',
        backfill_running: 'Backfilling…',
        backfill_hint: 'Fetch older papers with the window above, ignoring the incremental window',
        backfill_done: 'Backfill finished',
        do_summarize: 'Generate structured summary with LLM',
        summary_depth: 'Summary depth',
        depth_brief: 'Brief',
        depth_standard: 'Standard',
        depth_deep: 'Deep',
        depth_hint: 'Brief = TL;DR + novelty + tags (cheapest); Standard = seven fields (no limitations); Deep = all eight fields incl. limitations. Applies to new scans only.',
        depth_cost: 'per paper ~',
        do_fulltext: 'Read the full text when available (more accurate, slower)',
        fulltext_hint: 'Tries arXiv, Europe PMC, open-access PDFs, then the publisher PDF. Papers without an accessible full text fall back to the abstract — that is not an error. Turning this off makes scans noticeably faster.',
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
        scan_window: 'Window',
        days_unit: 'd',
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
        filter_label: 'Filter',
        filter_items: 'All',
        filter_unread: 'Unread',
        filter_starred: 'Starred',
        mark_read: 'Mark as read',
        mark_unread: 'Mark as unread',
        star: 'Star',
        unstar: 'Unstar',
        deep_read: 'Deep read',
        deep_read_title: 'Ask the Agent to deep-read this paper in a new session',
        deep_read_failed: 'Could not start deep read',
        deep_read_no_workspace: 'No workspace available — create a session first',
        mark_all_read: 'Mark all as read',
        new_items_short: 'new',
        filter_high: 'Worth reading',
        filter_fulltext: 'Full text read',
        sort_label: 'Sort',
        sort_recent: 'By date',
        sort_quality: 'By quality',
        quality_high: 'High',
        quality_medium: 'Medium',
        quality_low: 'Low',
        quality_unknown: 'Unrated',
        quality_title: 'Quality score from journal impact, citations and open access',
        quality_why: 'Why',
        impact_factor: 'Impact factor',
        read_fulltext: 'Full text',
        read_abstract: 'Abstract only',
        read_fulltext_title: 'This summary was generated from the paper full text',
        read_abstract_title: 'Full text unavailable — summary based on the abstract',
        key_points: 'Key points',
        show_details: 'Show details',
        hide_details: 'Hide details',
        scan_summary_hint: 'Last scan: {n} papers, {full} with full text',
        load_more: 'Load more',
        no_more: 'No more papers',
        empty_unread: 'No unread papers.',
        empty_starred: 'No starred papers yet.',
        empty_high: 'No high-quality papers under this filter yet.',
        empty_fulltext: 'No papers read in full text yet.',
        empty_filtered: 'No papers under this topic yet.',
        read_marked: 'Marked as read',
        unread_marked: 'Marked as unread',
        starred_marked: 'Starred',
        unstarred_marked: 'Unstarred',
        tab_stats: 'Trends',
        stats_days: 'Window',
        stats_total: 'Papers',
        stats_read: 'Read',
        stats_starred: 'Starred',
        stats_summarized: 'Summarized',
        stats_weekly: 'New per week',
        stats_week_unit: 'wk',
        stats_by_source: 'Sources',
        stats_by_venue: 'Top venues',
        stats_by_author: 'Top authors',
        stats_by_topic: 'Topics',
        stats_by_tag: 'Top tags',
        stats_empty: 'No data in this window yet. Run a scan, or widen the window.',
        stats_none: 'No data',
        stats_load_failed: 'Failed to load trends',
        days_unit_short: 'd',
        tab_library: 'Library',
        lib_group_year: 'By year',
        lib_group_topic: 'By topic',
        lib_total: 'In library',
        lib_span: 'Years',
        lib_old: 'Older',
        lib_recent: 'Recent',
        lib_unread: 'Unread',
        lib_starred: 'Starred',
        lib_summarized: 'Summarized',
        lib_empty: 'The library is empty. Run a scan; to pull in older papers, widen the window and hit "Backfill".',
        lib_badge_old: 'old',
        lib_badge_new: 'new',
        lib_unknown_year: 'Year unknown',
        lib_untopiced: 'Uncategorized',
        lib_load_failed: 'Failed to load library',
        lib_unit: '',
        lib_hint: 'Papers are shelved by publication year — backfilled older papers land on the earlier shelves.',
        lib_no_summary: 'No summary',
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
.drr-btn-deep{color:var(--dsw-alias-link,#4176e6);border-color:var(--dsw-alias-link,#4176e6)}
.drr-tabs{display:flex;align-items:center;gap:4px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28))}
.drr-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit}
.drr-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.drr-tab-active{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.18));color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
.drr-count{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11px;margin-left:6px}
.drr-body{flex:1;min-height:0;overflow:auto;padding:16px 20px 48px}

.drr-card{position:relative;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28));border-left:3px solid var(--dsw-alias-link,#4176e6);border-radius:10px;padding:14px 16px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1,#242424);box-shadow:var(--dsw-shadow-lv1,0 2px 4px rgba(0,0,0,.06));transition:box-shadow .12s,border-color .12s}
.drr-card:hover{box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,.08));border-color:var(--dsw-alias-border-l4,rgba(128,128,128,.4))}
.drr-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.drr-card-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px}
.drr-card-head .drr-card-title{flex:1;min-width:0;margin:0}
.drr-card-title{font-size:14.5px;font-weight:600;line-height:1.5;margin:0 0 8px;letter-spacing:.1px}
.drr-card-title a{color:inherit;text-decoration:none}
.drr-card-title a:hover{color:var(--dsw-alias-link,#4176e6);text-decoration:underline}
.drr-q-btn{appearance:none;cursor:pointer;font-family:inherit;transition:filter .12s}
.drr-q-btn:hover{filter:brightness(1.08)}
.drr-why{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary,#9a9a9a);background:var(--dsw-alias-markdown-placeholder,#f5f6f7);border-radius:6px;padding:6px 10px;margin-bottom:8px}
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
.drr-card-read{opacity:.62;border-left-color:var(--dsw-alias-border-l4,rgba(128,128,128,.4))}
.drr-card-read:hover{opacity:1}
.drr-dot{color:var(--dsw-alias-link,#4176e6);font-size:9px;line-height:1;letter-spacing:0}
.drr-chip-star{background:var(--dsw-alias-state-warn-tertiary,#fef5e7);color:var(--dsw-alias-state-warn-primary,#a86a00);font-weight:600}
.drr-btn-star-on{color:var(--dsw-alias-state-warn-primary,#a86a00);border-color:var(--dsw-alias-state-warn-tertiary,#fef5e7)}
.drr-filters{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.drr-strip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary,#9a9a9a);background:var(--dsw-alias-markdown-placeholder,#f5f6f7);border-radius:6px;padding:6px 10px;margin-bottom:10px}
.drr-strip-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#1a7f43);flex:0 0 auto}
.drr-strip-dot-busy{background:var(--dsw-alias-state-warn-primary,#a86a00);animation:drr-pulse 1.2s ease-in-out infinite}
@keyframes drr-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.drr-strip-text{color:var(--dsw-alias-label-primary,#e6e6e6)}
.drr-strip-legend{opacity:.7}
.drr-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l4,rgba(128,128,128,.28));border-radius:6px;overflow:hidden}
.drr-seg button{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);padding:4px 11px;font-size:11.5px;font-family:inherit;cursor:pointer;line-height:1.6}
.drr-seg button + button{border-left:1px solid var(--dsw-alias-border-l4,rgba(128,128,128,.28))}
.drr-seg button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.drr-seg button.drr-seg-on{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.18));color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
.drr-seg-count{opacity:.7;margin-left:4px;font-weight:400}
.drr-q{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;line-height:1.6;padding:1px 8px;border-radius:999px;border:1px solid transparent;letter-spacing:.2px}
.drr-q-high{background:var(--dsw-alias-state-success-tertiary,#e8f6ed);color:var(--dsw-alias-state-success-primary,#1a7f43);border-color:var(--dsw-alias-state-success-tertiary,#e8f6ed)}
.drr-q-medium{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.18));color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-border-l4,rgba(128,128,128,.28))}
.drr-q-low{background:transparent;color:var(--dsw-alias-label-tertiary,#7d7d7d);border-color:var(--dsw-alias-border-l4,rgba(128,128,128,.28))}
.drr-q-unknown{background:transparent;color:var(--dsw-alias-label-tertiary,#7d7d7d);border-color:var(--dsw-alias-border-l4,rgba(128,128,128,.28));border-style:dashed;font-weight:500}
.drr-chip-if{background:var(--dsw-alias-state-success-tertiary,#e8f6ed);color:var(--dsw-alias-state-success-primary,#1a7f43);font-weight:600}
.drr-chip-full{background:var(--dsw-alias-state-success-tertiary,#e8f6ed);color:var(--dsw-alias-state-success-primary,#1a7f43);font-weight:600}
.drr-chip-abs{opacity:.65}
.drr-chip-quiet{opacity:.6}
.drr-card-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.drr-venue{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);font-style:italic}
.drr-expand{appearance:none;border:none;background:transparent;color:var(--dsw-alias-link,#4176e6);font-size:11.5px;font-family:inherit;cursor:pointer;padding:2px 0;margin-bottom:6px}
.drr-expand:hover{text-decoration:underline}
.drr-more{display:flex;justify-content:center;padding:8px 0 4px}
.drr-presets{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}
.drr-presets-label{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);flex:0 0 auto;min-width:56px}
.drr-hint-inline{margin:0;flex:1;min-width:0}
.drr-stats-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin-bottom:20px}
.drr-stat{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28));border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#242424)}
.drr-stat-num{font-size:20px;font-weight:600;line-height:1.2;color:var(--dsw-alias-link,#4176e6);font-variant-numeric:tabular-nums}
.drr-stat-label{font-size:10.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin-top:3px;letter-spacing:.3px}
.drr-chart{display:flex;align-items:flex-end;gap:3px;height:108px;padding-top:8px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28))}
.drr-bar{flex:1;min-width:3px;height:100%;display:flex;align-items:flex-end}
.drr-bar-fill{width:100%;background:var(--dsw-alias-link,#4176e6);border-radius:2px 2px 0 0;opacity:.8;min-height:2px}
.drr-bar:hover .drr-bar-fill{opacity:1}
.drr-chart-axis{display:flex;justify-content:space-between;font-size:10.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin:5px 0 22px}
.drr-lists{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px 24px}
.drr-list-title{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-tertiary,#81858c);letter-spacing:.4px;text-transform:uppercase;margin-bottom:7px}
.drr-list-row{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;line-height:1.5}
.drr-list-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drr-list-count{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:11px;font-variant-numeric:tabular-nums}
.drr-list-track{flex:0 0 54px;height:4px;border-radius:2px;background:var(--dsw-alias-markdown-tag,#f1f3f5);overflow:hidden}
.drr-list-bar{height:100%;background:var(--dsw-alias-link,#4176e6);border-radius:2px}
.drr-lib-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px;margin-bottom:16px}
.drr-shelf{border-left:3px solid var(--dsw-alias-link,#4176e6);background:var(--dsw-alias-bg-l2,#fafafa);border-radius:6px;padding:9px 12px 4px;margin-bottom:10px}
.drr-shelf-head{display:flex;align-items:baseline;gap:9px;margin-bottom:5px;flex-wrap:wrap}
.drr-shelf-year{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.drr-shelf-count{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a)}
.drr-shelf-badge{font-size:10px;padding:1px 6px;border-radius:9px;background:var(--dsw-alias-state-warn-bg,#fdf3e2);color:var(--dsw-alias-state-warn-label,#a86a00)}
.drr-book{display:flex;align-items:baseline;gap:7px;padding:5px 0;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.18));font-size:12px;line-height:1.55}
.drr-book:first-of-type{border-top:none}
.drr-book-mark{flex:0 0 auto;font-size:9.5px;padding:0 5px;border-radius:8px;line-height:15px}
.drr-book-mark-new{background:var(--dsw-alias-state-success-bg,#e6faed);color:var(--dsw-alias-state-success-label,#0a7d3c)}
.drr-book-mark-old{background:var(--dsw-alias-state-warn-bg,#fdf3e2);color:var(--dsw-alias-state-warn-label,#a86a00)}
.drr-book-mark-none{background:var(--dsw-alias-markdown-tag,#f1f3f5);color:var(--dsw-alias-label-secondary,#9a9a9a)}
.drr-book-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drr-book-title a{color:inherit;text-decoration:none}
.drr-book-title a:hover{color:var(--dsw-alias-link,#4176e6);text-decoration:underline}
.drr-book-meta{flex:0 0 auto;font-size:10.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);font-variant-numeric:tabular-nums}
.drr-book-read .drr-book-title{opacity:.6}
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

    /**
     * 拼「让 Agent 精读这篇」的提示词。
     * 只带论文身份信息（标题 / 作者 / 期刊 / DOI / 链接）+ 摘要前 2000 字，
     * 让 Agent 自己去取全文；明确禁止编造，取不到全文就基于摘要回答。
     */
    function buildDeepReadPrompt(item, locale) {
      const zh = locale !== 'en'
      const authors = Array.isArray(item.authors) && item.authors.length > 0 ? item.authors.join(', ') : ''
      const abstract = typeof item.abstract === 'string' ? item.abstract.slice(0, 2000) : ''
      const lines = []
      if (zh) {
        lines.push(`请精读这篇论文，帮我判断它对我的研究方向（${item.topicName || '我的方向'}）有什么用。`)
        lines.push('')
        lines.push(`标题：${item.title || '（未知）'}`)
        if (authors) lines.push(`作者：${authors}`)
        if (item.venue) lines.push(`期刊/会议：${item.venue}`)
        if (item.publishedAt) lines.push(`发表时间：${String(item.publishedAt).slice(0, 10)}`)
        if (item.doi) lines.push(`DOI：${item.doi}`)
        if (item.url) lines.push(`链接：${item.url}`)
        if (abstract) {
          lines.push('')
          lines.push(`摘要：${abstract}`)
        }
        lines.push('')
        lines.push('要求：')
        lines.push('1. 先尝试用可用的抓取工具拿到全文（开放获取 / 预印本 / 机构库）；拿不到就只基于上面的摘要，并明确说明「只读到摘要」。')
        lines.push('2. 按这几块讲：要解决的问题、方法（含关键公式或建模思路）、关键结论与数据、创新点、局限与适用边界。')
        lines.push('3. 最后单独一段说：哪些做法我能直接搬到自己工作上，还缺什么条件。')
        lines.push('4. 不要编造论文里没有的数字、实验或结论；不确定就写「原文未提及」。')
      } else {
        lines.push(`Please deep-read this paper and tell me what it is worth for my research topic (${item.topicName || 'my topic'}).`)
        lines.push('')
        lines.push(`Title: ${item.title || '(unknown)'}`)
        if (authors) lines.push(`Authors: ${authors}`)
        if (item.venue) lines.push(`Venue: ${item.venue}`)
        if (item.publishedAt) lines.push(`Published: ${String(item.publishedAt).slice(0, 10)}`)
        if (item.doi) lines.push(`DOI: ${item.doi}`)
        if (item.url) lines.push(`URL: ${item.url}`)
        if (abstract) {
          lines.push('')
          lines.push(`Abstract: ${abstract}`)
        }
        lines.push('')
        lines.push('Requirements:')
        lines.push('1. Try to fetch the full text with the available tools (open access / preprint / repository). If that fails, work from the abstract above and say so explicitly.')
        lines.push('2. Cover: problem, method (key equations or modelling ideas), key findings and numbers, novelty, limitations and applicability.')
        lines.push('3. End with one paragraph: what I can reuse directly, and what is still missing.')
        lines.push('4. Do not invent numbers, experiments or conclusions that are not in the paper; write "not reported" when unsure.')
      }
      return lines.join('\n')
    }

    /**
     * 把一段提示词丢进「新会话」的输入框（不自动发送，用户自己按回车）。
     * Client 服务只能从 ctx 取，而 Panel 是纯组件，所以用模块级变量接住 apply 时的 ctx。
     */
    let clientContext = null

    function startAgentSession(prompt) {
      const ctx = clientContext
      if (ctx === null) throw new Error('Client 上下文不可用')
      // 服务既可能挂在 ctx 属性上（ctx.uiWorkspace），也可能只走 ctx.get()，两种都试
      const workspace =
        typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
      const target = workspace === undefined ? ctx.uiWorkspace : workspace
      if (target === undefined || typeof target.startSession !== 'function') {
        throw new Error('工作区服务不可用')
      }
      // 不传工作区 = 用当前/最近工作区；clearPreviousDraft:false 表示不清掉用户已输入的草稿
      target.startSession(undefined, { prompt, clearPreviousDraft: false })
    }

    function Field({ t, labelKey, value }) {
      if (typeof value !== 'string' || value === '' || value === '摘要未提及') return null
      return h('div', { className: 'drr-field' }, h('b', null, t(labelKey)), value)
    }

    /** 质量档位 → 徽章文字与配色类名。 */
    function qualityBadge(t, quality) {
      const tier = quality !== null && typeof quality === 'object' ? quality.tier : undefined
      if (tier === 'high') return { label: t('quality_high'), cls: 'drr-q-high' }
      if (tier === 'medium') return { label: t('quality_medium'), cls: 'drr-q-medium' }
      if (tier === 'low') return { label: t('quality_low'), cls: 'drr-q-low' }
      return { label: t('quality_unknown'), cls: 'drr-q-unknown' }
    }

    function ItemCard({ item, t, onToggleRead, onToggleStar, onDeepRead }) {
      const s = item.summary !== null && typeof item.summary === 'object' ? item.summary : null
      const hasStructured =
        s !== null &&
        ['tldr', 'problem', 'method', 'findings', 'innovation', 'limitations', 'relevance'].some(
          (k) => typeof s[k] === 'string' && s[k] !== '' && s[k] !== '摘要未提及',
        )
      const isRead = item.read === true
      const isStarred = item.starred === true
      const badge = qualityBadge(t, item.quality)
      const quality = item.quality !== null && typeof item.quality === 'object' ? item.quality : null
      const impactFactor =
        quality !== null && Number.isFinite(Number(quality.impactFactor)) ? Number(quality.impactFactor) : null
      const score = quality !== null && Number.isFinite(Number(quality.score)) ? Math.round(Number(quality.score)) : null
      // 摘要基于全文还是仅摘要 —— 直接决定用户该不该相信「局限」「方法」这些字段
      const basis = s !== null && s.basis === 'fulltext' ? 'fulltext' : 'abstract'
      // 细节默认收起：一张卡片先给「标题 + 一句话结论 + 质量」，想看再展开。
      // 这是「更直接」的核心 —— 列表页一屏能扫完，不用读六段文字。
      const [expanded, setExpanded] = React.useState(false)
      // 质量分是怎么来的 —— 用户看到「高质量 79」时第一个问题就是凭什么
      const [whyOpen, setWhyOpen] = React.useState(false)
      const reasons = quality !== null && Array.isArray(quality.reasons) ? quality.reasons.filter((r) => typeof r === 'string' && r !== '') : []

      // 第一行只放「标题」和两个最该看见的状态（未读点、收藏星）。
      // 标题是用户在列表里唯一真正在找的东西，必须第一个看到。
      const titleRow = h(
        'div',
        { className: 'drr-card-head' },
        isRead ? null : h('span', { className: 'drr-dot', title: t('filter_unread') }, '●'),
        h(
          'div',
          { className: 'drr-card-title' },
          h('a', { href: item.url || '#', target: '_blank', rel: 'noreferrer noopener' }, item.title || '(无标题)'),
        ),
        isStarred ? h('span', { className: 'drr-chip drr-chip-star' }, '★') : null,
      )

      // 第二行：质量分 + 它凭什么 + 三个一眼能懂的客观指标。
      // 用「高分/中等/较低」这种词而不是裸数字，用户不用记刻度。
      const qualityRow = h(
        'div',
        { className: 'drr-card-top' },
        h(
          'button',
          {
            className: `drr-q drr-q-btn ${badge.cls}`,
            title: t('quality_title'),
            onClick: () => setWhyOpen(!whyOpen),
          },
          score === null ? badge.label : `${badge.label} · ${score}`,
        ),
        impactFactor !== null
          ? h('span', { className: 'drr-chip drr-chip-if' }, `${t('impact_factor')} ${impactFactor.toFixed(1)}`)
          : null,
        Number(item.citations) > 0 ? h('span', { className: 'drr-chip' }, `${t('cited')} ${item.citations}`) : null,
        h(
          'span',
          {
            className: `drr-chip ${basis === 'fulltext' ? 'drr-chip-full' : 'drr-chip-abs'}`,
            title: basis === 'fulltext' ? t('read_fulltext_title') : t('read_abstract_title'),
          },
          basis === 'fulltext' ? `📄 ${t('read_fulltext')}` : t('read_abstract'),
        ),
        item.openAccess === true ? h('span', { className: 'drr-chip drr-chip-oa' }, t('open_access')) : null,
        h('span', { className: 'drr-spacer' }),
        item.publishedAt ? h('span', { className: 'drr-chip drr-chip-quiet' }, fmtDate(item.publishedAt)) : null,
      )

      // 点质量分才展开「凭什么」—— 不占版面，但要查随时能查
      const whyLine =
        whyOpen && reasons.length > 0
          ? h('div', { className: 'drr-why' }, `${t('quality_why')}: ${reasons.join(' · ')}`)
          : null

      const metaRow = h(
        'div',
        { className: 'drr-card-meta' },
        item.topicName ? h('span', { className: 'drr-chip drr-chip-topic' }, item.topicName) : null,
        item.venue ? h('span', { className: 'drr-venue' }, item.venue) : null,
        item.source ? h('span', { className: 'drr-chip drr-chip-quiet' }, item.source) : null,
      )

      // 「一句话结论」放在标题下面、永远可见 —— 用户扫一眼就知道这篇讲了什么
      const tldrLine =
        s !== null && typeof s.tldr === 'string' && s.tldr !== '' && s.tldr !== '摘要未提及'
          ? h('div', { className: 'drr-tldr' }, s.tldr)
          : null

      const detailGrid = hasStructured
        ? h(
            'div',
            null,
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
        : null

      const fallback = hasStructured
        ? null
        : item.summaryError
          ? h('div', { className: 'drr-field' }, h('b', null, t('summary_failed')), item.summaryError)
          : h(
              'div',
              null,
              h('div', { className: 'drr-field' }, h('b', null, t('abstract_only'))),
              h('div', { className: 'drr-abstract' }, item.abstract ? item.abstract.slice(0, 1200) : t('no_abstract')),
            )

      const body = h(
        'div',
        null,
        tldrLine,
        hasStructured
          ? expanded
            ? detailGrid
            : h(
                'button',
                { className: 'drr-expand', onClick: () => setExpanded(true) },
                `▾ ${t('show_details')}`,
              )
          : fallback,
        hasStructured && expanded
          ? h('button', { className: 'drr-expand', onClick: () => setExpanded(false) }, `▴ ${t('hide_details')}`)
          : null,
      )

      const foot = h(
        'div',
        { className: 'drr-card-foot' },
        Array.isArray(item.authors) && item.authors.length > 0
          ? h('span', null, `${t('authors_label')}: ${item.authors.slice(0, 6).join(', ')}${item.authors.length > 6 ? ' 等' : ''}`)
          : null,
        item.url
          ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer noopener' }, item.doi ? `DOI ${item.doi}` : '↗')
          : null,
        h('span', { className: 'drr-spacer' }),
        item.discoveredAt ? h('span', null, fmtTime(item.discoveredAt)) : null,
        typeof onDeepRead === 'function'
          ? h(
              'button',
              {
                className: 'drr-btn drr-btn-sm drr-btn-deep',
                onClick: () => onDeepRead(item),
                title: t('deep_read_title'),
              },
              `🔍 ${t('deep_read')}`,
            )
          : null,
        typeof onToggleStar === 'function'
          ? h(
              'button',
              {
                className: `drr-btn drr-btn-sm ${isStarred ? 'drr-btn-star-on' : ''}`,
                onClick: () => onToggleStar(item, !isStarred),
                title: isStarred ? t('unstar') : t('star'),
              },
              isStarred ? `★ ${t('unstar')}` : `☆ ${t('star')}`,
            )
          : null,
        typeof onToggleRead === 'function'
          ? h(
              'button',
              { className: 'drr-btn drr-btn-sm', onClick: () => onToggleRead(item, !isRead) },
              isRead ? t('mark_unread') : t('mark_read'),
            )
          : null,
      )

      return h(
        'div',
        { className: `drr-card ${isRead ? 'drr-card-read' : ''}` },
        titleRow,
        qualityRow,
        whyLine,
        metaRow,
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
      const [languages, setLanguages] = React.useState(
        initial && Array.isArray(initial.languages) ? initial.languages : [],
      )
      const [preview, setPreview] = React.useState(null)
      const [previewing, setPreviewing] = React.useState(false)

      const toggle = (source) => {
        setSources((current) =>
          current.includes(source) ? current.filter((s) => s !== source) : current.concat(source),
        )
      }

      const toggleLanguage = (code) => {
        setLanguages((current) =>
          current.includes(code) ? current.filter((c) => c !== code) : current.concat(code),
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
        // 空数组或两项都选 = 不限语言（后端也会把两项折成空数组）
        languages: languages.length >= 2 ? [] : languages,
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
        h('label', { className: 'drr-label' }, t('topic_languages')),
        h(
          'div',
          { className: 'drr-src' },
          ['zh', 'en'].map((code) =>
            h(
              'label',
              { key: code },
              h('input', {
                type: 'checkbox',
                checked: languages.includes(code),
                onChange: () => toggleLanguage(code),
              }),
              t(code === 'zh' ? 'lang_zh' : 'lang_en'),
            ),
          ),
        ),
        h('div', { className: 'drr-hint' }, t('languages_hint')),
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

    /** 趋势榜单的一行：名字 + 相对长度的条 + 次数。 */
    function RankList({ title, rows, t }) {
      const list = Array.isArray(rows) ? rows : []
      return h(
        'div',
        null,
        h('div', { className: 'drr-list-title' }, title),
        list.length === 0
          ? h('div', { className: 'drr-hint' }, t('stats_none'))
          : list.map((row) => {
              const max = list.reduce((m, r) => Math.max(m, Number(r.count) || 0), 0) || 1
              const width = Math.max(4, Math.round(((Number(row.count) || 0) / max) * 100))
              return h(
                'div',
                { key: row.key, className: 'drr-list-row' },
                h('span', { className: 'drr-list-name', title: row.key }, row.label || row.key),
                h(
                  'span',
                  { className: 'drr-list-track' },
                  h('span', { className: 'drr-list-bar', style: { width: `${width}%` } }),
                ),
                h('span', { className: 'drr-list-count' }, String(row.count)),
              )
            }),
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
      const [itemFilter, setItemFilter] = React.useState('all')
      const [itemSort, setItemSort] = React.useState('recent')
      const [items, setItems] = React.useState([])
      const [page, setPage] = React.useState({ total: 0, offset: 0, limit: PAGE_SIZE, hasMore: false })
      const [counts, setCounts] = React.useState({ all: 0, unread: 0, starred: 0, highQuality: 0, fullText: 0 })
      const [stats, setStats] = React.useState(null)
      const [statsDays, setStatsDays] = React.useState(90)
      const [statsError, setStatsError] = React.useState('')
      const [library, setLibrary] = React.useState(null)
      const [libGroupBy, setLibGroupBy] = React.useState('year')
      const [libError, setLibError] = React.useState('')

      /** 把状态载荷里的设置草稿同步进表单（不影响已加载的条目列表）。 */
      const absorbSettings = (next) => {
        if (!next || !next.settings) return
        setMailDraft({ ...next.settings.mail })
        setScanDraft({ ...next.settings.scan })
        setApiDraft({ ...(next.settings.api || {}) })
        setRssDraft((next.settings.rss || []).join('\n'))
      }

      /** 第一页（或扫描/保存后）整体替换条目列表。 */
      const applyState = (next) => {
        setData(next)
        absorbSettings(next)
        if (next && Array.isArray(next.items)) {
          setItems(next.items)
          setPage(next.page || { total: next.items.length, offset: 0, limit: PAGE_SIZE, hasMore: false })
          if (next.counts) setCounts(next.counts)
        }
      }

      const stateQuery = (offset) => {
        const params = new URLSearchParams()
        params.set('limit', String(PAGE_SIZE))
        params.set('offset', String(offset))
        if (topicFilter !== '') params.set('topicId', topicFilter)
        if (itemFilter !== 'all') params.set('filter', itemFilter)
        if (itemSort !== 'recent') params.set('sort', itemSort)
        return `state?${params.toString()}`
      }

      const refresh = React.useCallback(
        () =>
          api(stateQuery(0))
            .then(applyState)
            .catch((error) => setNote({ kind: 'err', text: `${t('load_failed')}: ${error.message}` })),
        [topicFilter, itemFilter, itemSort],
      )

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      /** 趋势数据：只在打开「趋势」页时才拉，避免首屏多一次请求。 */
      const loadStats = React.useCallback(() => {
        setStatsError('')
        const params = new URLSearchParams()
        params.set('days', String(statsDays))
        if (topicFilter !== '') params.set('topicId', topicFilter)
        return api(`stats?${params.toString()}`)
          .then(setStats)
          .catch((error) => setStatsError(error.message))
      }, [statsDays, topicFilter])

      React.useEffect(() => {
        if (tab !== 'stats') return
        void loadStats()
      }, [tab, loadStats])

      /** 论文库：同样只在打开页签时才拉。 */
      const loadLibrary = React.useCallback(() => {
        setLibError('')
        const params = new URLSearchParams()
        params.set('groupBy', libGroupBy)
        if (topicFilter !== '') params.set('topicId', topicFilter)
        return api(`library?${params.toString()}`)
          .then(setLibrary)
          .catch((error) => setLibError(error.message))
      }, [libGroupBy, topicFilter])

      React.useEffect(() => {
        if (tab !== 'library') return
        void loadLibrary()
      }, [tab, loadLibrary])

      const loadMore = () => {
        setBusy('more')
        api(stateQuery(page.offset + items.length))
          .then((next) => {
            absorbSettings(next)
            setItems((prev) => prev.concat(next.items || []))
            if (next.page) setPage({ ...next.page, offset: page.offset + items.length })
            if (next.counts) setCounts(next.counts)
          })
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      /** 已读 / 收藏的本地回写：只改这一条，不重新拉整页（避免滚动位置丢失）。 */
      const patchItem = (item, patch) => {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)))
        setCounts((prev) => {
          const out = { ...prev }
          if (typeof patch.read === 'boolean' && (item.read === true) !== patch.read) {
            out.unread = Math.max(0, (out.unread || 0) + (patch.read ? -1 : 1))
          }
          if (typeof patch.starred === 'boolean' && (item.starred === true) !== patch.starred) {
            out.starred = Math.max(0, (out.starred || 0) + (patch.starred ? 1 : -1))
          }
          return out
        })
        api('item', { id: item.id, ...patch }).catch((error) => {
          // 失败就把本地改动回滚，别让界面和服务端不一致
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...item } : i)))
          setNote({ kind: 'err', text: error.message })
        })
      }

      const markAllRead = () => {
        setBusy('mark')
        api('mark-all-read', {})
          .then((result) => {
            if (result.state) applyState(result.state)
            setNote({ kind: 'ok', text: `${t('read_marked')} · ${result.marked}` })
          })
          .catch((error) => setNote({ kind: 'err', text: error.message }))
          .finally(() => setBusy(''))
      }

      const runScan = (options) => {
        setBusy(options && options.backfill ? 'backfill' : 'scan')
        setNote(null)
        const body =
          options && Number(options.lookbackDays) > 0
            ? { lookbackDays: Math.round(Number(options.lookbackDays)) }
            : {}
        api('scan', body)
          .then((result) => {
            // 扫描返回的 state 是默认第一页；当前可能停在「收藏」或某个方向上，
            // 所以只同步设置，列表用当前筛选条件重新拉，别把筛选悄悄重置掉。
            absorbSettings(result.state)
            void refresh()
            const head =
              result.newCount > 0
                ? `${options && options.backfill ? t('backfill_done') : t('scan_done')}：${result.newCount} ${t('new_items')}`
                : `${options && options.backfill ? t('backfill_done') : t('scan_done')}：${t('no_new')}`
            // 把「实际用了多大的窗口、什么解析深度」也报出来 —— 窗口被增量逻辑收窄时，
            // 用户看到 0 篇新论文才不会以为坏了。
            const facts = []
            if (Number(result.lookbackDays) > 0) {
              facts.push(`${t('scan_window')} ${result.lookbackDays} ${t('days_unit')}`)
            }
            if (typeof result.summaryDepth === 'string' && result.summaryDepth !== '') {
              facts.push(`${t('summary_depth')} ${t(`depth_${result.summaryDepth}`)}`)
            }
            const meta = facts.length > 0 ? `（${facts.join(' · ')}）` : ''
            const errors = Array.isArray(result.errors) && result.errors.length > 0
            const detail = errors ? `\n${result.errors.map((e) => `${e.source}: ${e.message}`).join('\n')}` : ''
            setNote({ kind: errors ? 'warn' : 'ok', text: head + meta + detail })
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
            absorbSettings(result.state)
            void refresh()
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

      /** 把论文丢进新会话，让 Agent 精读（Host 侧注入的 startAgentSession）。 */
      const deepRead = (item) => {
        try {
          startAgentSession(buildDeepReadPrompt(item, locale))
        } catch (error) {
          setNote({ kind: 'err', text: `${t('deep_read_failed')}: ${error.message}` })
          return
        }
        if (item.read !== true) patchItem(item, { read: true })
      }

      if (data === null) {
        return h('div', { className: 'drr-root' }, h('div', { className: 'drr-empty' }, '…'))
      }

      const topics = data.topics || []

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

      const emptyText =
        counts.all === 0
          ? t('empty_items')
          : itemFilter === 'unread'
            ? t('empty_unread')
            : itemFilter === 'starred'
              ? t('empty_starred')
              : itemFilter === 'high'
                ? t('empty_high')
                : itemFilter === 'fulltext'
                  ? t('empty_fulltext')
                  : t('empty_filtered')

      const filterButtons = [
        ['all', t('filter_items'), counts.all],
        ['high', t('filter_high'), counts.highQuality],
        ['unread', t('filter_unread'), counts.unread],
        ['starred', t('filter_starred'), counts.starred],
        ['fulltext', t('filter_fulltext'), counts.fullText],
      ]

      const filterBar = h(
        'div',
        { className: 'drr-filters' },
        h(
          'div',
          { className: 'drr-seg' },
          filterButtons.map(([value, label, count]) =>
            h(
              'button',
              {
                key: value,
                className: itemFilter === value ? 'drr-seg-on' : '',
                onClick: () => setItemFilter(value),
              },
              label,
              h('span', { className: 'drr-seg-count' }, String(count || 0)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'drr-seg' },
          [
            ['recent', t('sort_recent')],
            ['quality', t('sort_quality')],
          ].map(([value, label]) =>
            h(
              'button',
              {
                key: value,
                className: itemSort === value ? 'drr-seg-on' : '',
                onClick: () => setItemSort(value),
                title: t('sort_label'),
              },
              label,
            ),
          ),
        ),
        topics.length > 1
          ? h(
              'select',
              {
                className: 'drr-select',
                style: { width: 'auto', minWidth: '160px' },
                value: topicFilter,
                onChange: (e) => setTopicFilter(e.target.value),
              },
              h('option', { value: '' }, t('filter_all')),
              topics.map((topic) => h('option', { key: topic.id, value: topic.id }, topic.name)),
            )
          : null,
        h('span', { className: 'drr-spacer' }),
        counts.unread > 0
          ? h(
              'button',
              { className: 'drr-btn drr-btn-sm', onClick: markAllRead, disabled: busy === 'mark' },
              t('mark_all_read'),
            )
          : null,
      )

      // 顶部状态条：把「上次什么时候扫的、扫多宽、抓到几篇、其中几篇读了全文」
      // 从设置页搬到论文列表顶上 —— 这些是用户每次打开面板最想先知道的事，
      // 藏在设置里等于没有。
      const statusStrip = (() => {
        const scan = data.settings && data.settings.scan ? data.settings.scan : {}
        const parts = []
        parts.push(`${t('last_scan')}：${scan.lastScanAt ? fmtTime(scan.lastScanAt) : t('never')}`)
        if (Number.isFinite(Number(data.status && data.status.effectiveLookbackDays))) {
          parts.push(`${t('scan_window')} ${data.status.effectiveLookbackDays} ${t('days_unit')}`)
        }
        if (Number(scan.lastScanNew) > 0) parts.push(`${t('new_items_short')} ${scan.lastScanNew}`)
        if (Number(counts.fullText) > 0) parts.push(`${t('read_fulltext')} ${counts.fullText}`)
        if (Number(counts.highQuality) > 0) parts.push(`${t('quality_high')} ${counts.highQuality}`)
        const scanning = data.status && data.status.scanning === true
        return h(
          'div',
          { className: 'drr-strip' },
          h('span', { className: `drr-strip-dot ${scanning ? 'drr-strip-dot-busy' : ''}` }),
          h('span', { className: 'drr-strip-text' }, parts.join(' · ')),
          h('span', { className: 'drr-spacer' }),
          h(
            'span',
            { className: 'drr-strip-legend' },
            `${t('quality_high')} ≥60 · ${t('quality_medium')} ≥35 · ${t('quality_low')} <35`,
          ),
        )
      })()

      const itemsTab = h(
        'div',
        null,
        noteEl,
        statusStrip,
        filterBar,
        items.length === 0
          ? h('div', { className: 'drr-empty' }, emptyText)
          : items.map((item) =>
              h(ItemCard, {
                key: item.id,
                item,
                t,
                onToggleRead: (target, next) => patchItem(target, { read: next }),
                onToggleStar: (target, next) => patchItem(target, { starred: next }),
                onDeepRead: deepRead,
              }),
            ),
        items.length > 0
          ? h(
              'div',
              { className: 'drr-more' },
              page.hasMore
                ? h(
                    'button',
                    { className: 'drr-btn', onClick: loadMore, disabled: busy === 'more' },
                    `${t('load_more')} (${items.length}/${page.total})`,
                  )
                : h('span', { className: 'drr-hint' }, t('no_more')),
            )
          : null,
      )

      const statsTab = (() => {
        if (statsError !== '') {
          return h('div', { className: 'drr-note drr-note-err' }, `${t('stats_load_failed')}: ${statsError}`)
        }
        if (stats === null) {
          return h('div', { className: 'drr-empty' }, '…')
        }
        const dayOptions = [30, 90, 180, 365, 730]
        const peak = Math.max(1, Number(stats.weeklyPeak) || 0)
        const weeks = Array.isArray(stats.weeks) ? stats.weeks : []
        const cards = [
          [t('stats_total'), stats.total],
          [t('stats_read'), stats.readCount],
          [t('stats_starred'), stats.starredCount],
          [t('stats_summarized'), stats.summarizedCount],
        ]
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'drr-filters' },
            h('span', { className: 'drr-hint', style: { margin: '0 6px 0 0' } }, t('stats_days')),
            h(
              'div',
              { className: 'drr-seg' },
              dayOptions.map((days) =>
                h(
                  'button',
                  {
                    key: days,
                    className: statsDays === days ? 'drr-seg-on' : '',
                    onClick: () => setStatsDays(days),
                  },
                  `${days}${t('days_unit_short')}`,
                ),
              ),
            ),
            h('span', { className: 'drr-spacer' }),
            topics.length > 1
              ? h(
                  'select',
                  {
                    className: 'drr-select',
                    style: { width: 'auto', minWidth: '160px' },
                    value: topicFilter,
                    onChange: (e) => setTopicFilter(e.target.value),
                  },
                  h('option', { value: '' }, t('filter_all')),
                  topics.map((topic) => h('option', { key: topic.id, value: topic.id }, topic.name)),
                )
              : null,
          ),
          stats.total === 0
            ? h('div', { className: 'drr-empty' }, t('stats_empty'))
            : h(
                'div',
                null,
                h(
                  'div',
                  { className: 'drr-stats-cards' },
                  cards.map(([label, value]) =>
                    h(
                      'div',
                      { key: label, className: 'drr-stat' },
                      h('div', { className: 'drr-stat-num' }, String(value ?? 0)),
                      h('div', { className: 'drr-stat-label' }, label),
                    ),
                  ),
                ),
                h('div', { className: 'drr-list-title' }, t('stats_weekly')),
                h(
                  'div',
                  { className: 'drr-chart' },
                  weeks.map((week) =>
                    h(
                      'div',
                      { key: week.week, className: 'drr-bar', title: `${week.week} · ${week.count}` },
                      h('div', {
                        className: 'drr-bar-fill',
                        style: { height: `${Math.round(((Number(week.count) || 0) / peak) * 100)}%` },
                      }),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'drr-chart-axis' },
                  h('span', null, weeks.length > 0 ? weeks[0].week : ''),
                  h('span', null, weeks.length > 0 ? weeks[weeks.length - 1].week : ''),
                ),
                h(
                  'div',
                  { className: 'drr-lists' },
                  h(RankList, { title: t('stats_by_source'), rows: stats.bySource, t }),
                  h(RankList, { title: t('stats_by_venue'), rows: stats.byVenue, t }),
                  h(RankList, { title: t('stats_by_author'), rows: stats.byAuthor, t }),
                  topics.length > 1
                    ? h(RankList, { title: t('stats_by_topic'), rows: stats.byTopic, t })
                    : null,
                  h(RankList, { title: t('stats_by_tag'), rows: stats.byTag, t }),
                ),
              ),
        )
      })()

      const libraryTab = (() => {
        if (libError !== '') {
          return h('div', { className: 'drr-note drr-note-err' }, `${t('lib_load_failed')}: ${libError}`)
        }
        if (library === null) {
          return h('div', { className: 'drr-empty' }, '…')
        }
        const groups = Array.isArray(library.groups) ? library.groups : []
        const sum = library.summary || {}
        const span =
          sum.oldestYear && sum.newestYear
            ? sum.oldestYear === sum.newestYear
              ? sum.oldestYear
              : `${sum.oldestYear}–${sum.newestYear}`
            : ''
        const cards = [
          [t('lib_total'), library.total],
          [t('lib_span'), span || '—'],
          [t('filter_high'), sum.highQualityCount ?? 0],
          [t('filter_fulltext'), sum.fullTextCount ?? 0],
          [t('lib_old'), sum.oldCount ?? 0],
          [t('lib_unread'), sum.unreadCount ?? 0],
          [t('lib_starred'), sum.starredCount ?? 0],
        ]
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'drr-filters' },
            h(
              'div',
              { className: 'drr-seg' },
              [
                ['year', t('lib_group_year')],
                ['topic', t('lib_group_topic')],
              ].map(([key, label]) =>
                h(
                  'button',
                  {
                    key,
                    className: libGroupBy === key ? 'drr-seg-on' : '',
                    onClick: () => setLibGroupBy(key),
                  },
                  label,
                ),
              ),
            ),
            topics.length > 1
              ? h(
                  'select',
                  {
                    className: 'drr-select',
                    style: { width: 'auto', minWidth: '160px' },
                    value: topicFilter,
                    onChange: (event) => setTopicFilter(event.target.value),
                  },
                  h('option', { value: '' }, t('filter_all')),
                  topics.map((topic) => h('option', { key: topic.id, value: topic.id }, topic.name)),
                )
              : null,
          ),
          h('div', { className: 'drr-hint', style: { margin: '2px 0 12px' } }, t('lib_hint')),
          h(
            'div',
            { className: 'drr-lib-summary' },
            cards.map(([label, value]) =>
              h(
                'div',
                { className: 'drr-stat', key: label },
                h('div', { className: 'drr-stat-num' }, String(value ?? 0)),
                h('div', { className: 'drr-stat-label' }, label),
              ),
            ),
          ),
          groups.length === 0
            ? h('div', { className: 'drr-empty' }, t('lib_empty'))
            : groups.map((group) =>
                h(
                  'div',
                  { className: 'drr-shelf', key: group.key },
                  h(
                    'div',
                    { className: 'drr-shelf-head' },
                    h(
                      'span',
                      { className: 'drr-shelf-year' },
                      group.key === '未知' || group.key === '未分类'
                        ? t(group.key === '未分类' ? 'lib_untopiced' : 'lib_unknown_year')
                        : group.label,
                    ),
                    h(
                      'span',
                      { className: 'drr-shelf-count' },
                      `${group.count} ${t('lib_unit')}`,
                    ),
                    group.oldCount > 0
                      ? h(
                          'span',
                          { className: 'drr-shelf-badge' },
                          `${t('lib_old')} ${group.oldCount}`,
                        )
                      : null,
                  ),
                  group.items.map((row) =>
                    h(
                      'div',
                      {
                        key: row.id,
                        className: `drr-book${row.read ? ' drr-book-read' : ''}`,
                      },
                      h(
                        'span',
                        {
                          className: `drr-book-mark ${
                            row.freshness === 'old'
                              ? 'drr-book-mark-old'
                              : row.freshness === 'new'
                                ? 'drr-book-mark-new'
                                : 'drr-book-mark-none'
                          }`,
                        },
                        row.freshness === 'old'
                          ? t('lib_badge_old')
                          : row.freshness === 'new'
                            ? t('lib_badge_new')
                            : '?',
                      ),
                      h(
                        'span',
                        { className: 'drr-book-title', title: row.title },
                        h(
                          'a',
                          {
                            href: row.url || '#',
                            target: '_blank',
                            rel: 'noreferrer noopener',
                            onClick: () => {
                              if (!row.read) patchItem(row, { read: true })
                            },
                          },
                          row.title || row.id,
                        ),
                      ),
                      h(
                        'span',
                        { className: 'drr-book-meta' },
                        [
                          row.qualityTier === 'high'
                            ? `★ ${t('quality_high')}`
                            : row.qualityTier === 'medium'
                              ? t('quality_medium')
                              : '',
                          row.impactFactor !== null && row.impactFactor !== undefined
                            ? `IF ${Number(row.impactFactor).toFixed(1)}`
                            : '',
                          row.venue || '',
                          row.publishedAt ? String(row.publishedAt).slice(0, 10) : '',
                          row.citations > 0 ? `引 ${row.citations}` : '',
                          row.summaryBasis === 'fulltext' ? `📄 ${t('read_fulltext')}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · '),
                      ),
                    ),
                  ),
                ),
              ),
        )
      })()

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
                        (topic.languages || []).length > 0
                          ? `${t('topic_languages')}：${topic.languages
                              .map((code) => (code === 'zh' ? t('lang_zh') : t('lang_en')))
                              .join(' · ')}`
                          : '',
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
                      max: 50,
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
                  'div',
                  { className: 'drr-presets' },
                  h('span', { className: 'drr-presets-label' }, t('lookback_presets')),
                  h(
                    'div',
                    { className: 'drr-seg' },
                    [
                      [180, 'preset_half_year'],
                      [365, 'preset_one_year'],
                      [730, 'preset_two_years'],
                      [1095, 'preset_three_years'],
                    ].map(([days, key]) =>
                      h(
                        'button',
                        {
                          key,
                          type: 'button',
                          className: Number(scanDraft.lookbackDays) === days ? 'drr-seg-on' : '',
                          onClick: () => setScanDraft({ ...scanDraft, lookbackDays: days }),
                        },
                        t(key),
                      ),
                    ),
                  ),
                ),
                h('div', { className: 'drr-hint' }, t('lookback_hint')),
                h(
                  'div',
                  { className: 'drr-presets' },
                  h('span', { className: 'drr-presets-label' }, t('backfill')),
                  h(
                    'button',
                    {
                      className: 'drr-btn drr-btn-sm',
                      type: 'button',
                      disabled: busy !== '',
                      onClick: () => runScan({ backfill: true, lookbackDays: scanDraft.lookbackDays }),
                    },
                    busy === 'backfill' ? t('backfill_running') : t('backfill'),
                  ),
                  h('span', { className: 'drr-hint drr-hint-inline' }, t('backfill_hint')),
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
                scanDraft.summarize === false
                  ? null
                  : h(
                      'div',
                      { className: 'drr-presets' },
                      h('span', { className: 'drr-presets-label' }, t('summary_depth')),
                      h(
                        'div',
                        { className: 'drr-seg' },
                        (Array.isArray(data && data.summaryDepths) && data.summaryDepths.length > 0
                          ? data.summaryDepths
                          : [{ key: 'brief' }, { key: 'standard' }, { key: 'deep' }]
                        ).map((option) =>
                          h(
                            'button',
                            {
                              key: option.key,
                              type: 'button',
                              className:
                                (scanDraft.summaryDepth || 'standard') === option.key ? 'drr-seg-on' : '',
                              onClick: () => setScanDraft({ ...scanDraft, summaryDepth: option.key }),
                            },
                            `${t(`depth_${option.key}`)}${
                              Number.isFinite(Number(option.approxTokens))
                                ? ` · ${Math.round(Number(option.approxTokens) / 100) / 10}k`
                                : ''
                            }`,
                          ),
                        ),
                      ),
                    ),
                scanDraft.summarize === false
                  ? null
                  : h('div', { className: 'drr-hint' }, t('depth_hint')),
                scanDraft.summarize === false
                  ? null
                  : h(
                      'label',
                      { className: 'drr-check' },
                      h('input', {
                        type: 'checkbox',
                        checked: scanDraft.fullText !== false,
                        onChange: (e) => setScanDraft({ ...scanDraft, fullText: e.target.checked }),
                      }),
                      t('do_fulltext'),
                    ),
                scanDraft.summarize === false || scanDraft.fullText === false
                  ? null
                  : h('div', { className: 'drr-hint' }, t('fulltext_hint')),
                h(
                  'div',
                  { className: 'drr-hint' },
                  `${t('last_scan')}: ${scanDraft.lastScanAt ? fmtTime(scanDraft.lastScanAt) : t('never')}`,
                ),
                h(
                  'div',
                  { className: 'drr-hint' },
                  `${t('scan_window')}: ${
                    data && data.status && Number.isFinite(Number(data.status.effectiveLookbackDays))
                      ? `${data.status.effectiveLookbackDays} ${t('days_unit')}`
                      : `${scanDraft.lookbackDays} ${t('days_unit')}`
                  }`,
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
          ['items', 'library', 'topics', 'stats', 'settings'].map((key) =>
            h(
              'button',
              {
                key,
                className: `drr-tab ${tab === key ? 'drr-tab-active' : ''}`,
                onClick: () => setTab(key),
              },
              t(`tab_${key}`),
              key === 'items' && counts.all > 0 ? h('span', { className: 'drr-count' }, String(counts.all)) : null,
            ),
          ),
        ),
        h(
          'div',
          { className: 'drr-body' },
          tab === 'items'
            ? itemsTab
            : tab === 'library'
              ? libraryTab
              : tab === 'topics'
                ? topicsTab
                : tab === 'stats'
                  ? statsTab
                  : settingsTab,
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
        clientContext = ctx
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
