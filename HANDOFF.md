# 交接文档 / Handoff

> 写给接手的 DSH Agent。读完这一份就能继续干活，不必重新勘察环境。
> 最后更新：2026-10-21

---

## 一、这个任务在干什么

### 用户原始诉求（原话）

> 「我想做一个插件，插件的功能是根据用户的研究内容，查阅并监控最新研究前沿动态，如果出现了最新的文章，插件可以阅读该文章的内容，总结该文章的科研方法、内容、创新点等重要信息，通过邮件等形式定期发送给用户」

### 用户后续确认的决策

| 决策点 | 结论 |
| --- | --- |
| 研究方向 | **通用可配置**，不预置任何学科，用户自己在面板里加 |
| 推送通道 | **两个都要**：Web UI 面板可看 + 可开关的邮件推送 |
| UI | **要 Web UI 面板**，能配方向/邮箱、看最新摘要、手动触发扫描 |
| git | 只做**本地提交**，暂不推 GitHub |
| 浏览器控制 | 用户授权「自行搜索哪个好用，自行安装」→ 已装 `dsh-browser-cdp@1.2.3` |

### 关键转折（m01287）

用户实测后反馈：**「按关键词搜索不准，我搜金属橡胶，推给我的文章一篇都不相关」**，并提出三条要求：

1. 支持按**作者 / 期刊 / 单位 / 标题关键词 / 摘要关键词**多维度关注（不能只有一个泛关键词）；
2. 要**接入 SCI 类文献平台**（原来只有 arXiv / bioRxiv / RSS，对材料、力学、工程类学科基本无覆盖）；
3. **最新论文用卡片式排版**，让两篇论文之间的区分更明显。

这三条已经全部实现并实测通过，详见第三节。

---

## 二、当前状态：能用，已装，已跑通

> **2026-10-21 交接更新**：缺陷 #1–#8 已全部修完，插件已在新机器（`I:\skill\dsh-research-radar`，
> 用户 `<user>`）的桌面 profile 里真实安装并跑通端到端扫描。详细记录见第十一节。

### 已完成且经过端到端验证

- ✅ Host 半边（HTTP 路由 + 定时器 + Agent 工具）已 live
- ✅ Client 半边（侧边栏图标 + 主面板）已 live，浏览器实测渲染正常
- ✅ OpenAlex / Crossref / PubMed / arXiv / bioRxiv / RSS 六个源全部接通
- ✅ 五维检索（keywords / authors / venues / institutions / exclude）+ 同维 OR、跨维 AND
- ✅ 相关性保护（strict 模式），修掉了短缩写污染
- ✅ LLM 结构化摘要（一句话 / 问题 / 方法 / 内容与结论 / 创新点 / 局限 / 相关性 / 标签）
- ✅ 卡片式面板（五个页签：最新论文 / 论文库 / 研究方向 / 趋势 / 设置）
- ✅ 「试检索」按钮（不写库不摘要，先验证准确率）
- ✅ 纯 Node 手写 SMTP（零依赖），465 隐式 TLS 与 587 STARTTLS 都支持
- ✅ 定时扫描（默认 12 小时）
- ✅ **跨源去重**（DOI / arXiv / 标题+年份 / 源内 ID 四级键）
- ✅ **`seen` 自动剪枝**（180 天 / 20000 键，仍在列表里的永不剪）
- ✅ **摘要并发**（3 路，实测 8 篇 30s+ → 18s）
- ✅ **已读 / 收藏 + 三段筛选 + 分页「加载更多」**
- ✅ **邮件 HTML 卡片化**（table + 内联样式 + 「在面板中查看」带令牌按钮）
- ✅ **`Config` schema**（`dataDir` / `llmProvider` / `llmModel` / `locale`）
- ✅ **增量抓取窗口**（只往回看「距上次扫描天数 + 30 天」，下限 30 天以兜住延迟收录，省 OpenAlex 配额）
- ✅ **趋势统计**（第四个页签：周柱状图 + 来源 / 期刊 / 作者 / 标签榜单）
- ✅ **中文文献**（方向里勾「中文文献」，OpenAlex / PubMed 服务端过滤，其余源本地判定）
- ✅ **Agent 精读联动**（卡片上的 🔍 精读：把论文丢进新会话让 Agent 读全文，不自动发送）
- ✅ **解析深度分档**（精简 / 标准 / 深度，同时收窄喂进去的摘要与输出上限，约 1.9k / 5k / 7.6k tokens 每篇）
- ✅ **时间范围可选 + 回溯检索**（`lookbackDays` 上限放宽到 3650 天，面板有半年 / 1 年 / 2 年 / 3 年快捷按钮，
  「回溯检索」按钮用当前窗口强制扫一次，跳过增量窗口）
- ✅ **连字符变体折叠 + Crossref 改相关度排序 + 窗口下限 30 天**（2026-10-23 修掉「检索得太少」的三个根因，见 11.14）
- ✅ **质量分**（期刊影响因子 70% + 被引 30% + 开放获取 4 分 → 0–100 + 高/中/低/待评估，
  外加按**同年同领域被引百分位**算的 **Q1–Q4 分区徽章**，卡片徽章可点开看「依据」，见 11.15）
- ✅ **全文精读**（arXiv / Europe PMC / OA PDF / 出版社 PDF 四条路线，拿到正文就按正文总结，
  拿不到自动回退摘要，见 11.15）
- ✅ **面板更直接**（标题回到第一行、质量分与「凭什么」可展开、顶部状态条、六段细节默认收起，见 11.15）
- ✅ **241 个 `node:test` 单测**（零依赖，`node --test test/*.test.js`）
- ✅ **本地 git 提交**：`71c6c20`（29 文件 / +5064 −212），用的是本轮现装的 MinGit 2.56.0（见第十一节 11.10）

### 用户当前的实盘配置（旧机器记录，新机器上还没迁过来）

```
研究方向：金属橡胶  keywords = metal rubber, MR, EMWM  sources = openalex, crossref
          matchMode = any  strict = true
SMTP：    smtp.163.com:465 SSL  <REDACTED> → <REDACTED>  已启用
数据：    旧机 C:\Users\<user>\.dsh\research-radar\state.json
          新机 C:\Users\<user>\.dsh\research-radar\state.json（本次新建：只有「金属橡胶」方向、无邮箱）
```

⚠️ **邮件推送是开着的，且 SMTP 是真实可用的**。调试时如果要触发扫描，先确认不会给用户发一封垃圾邮件，或者临时把 `mail.enabled` 关掉。

---

## 三、代码结构

```
I:\skill\dsh-research-radar\
├── package.json          manifest（dsh.bundle.patch + dsh.client + files + scripts.test）
├── cordis.patch.yml      insert 一行：id=dsh-research-radar, name=@local/dsh-research-radar
├── index.js       849 行 Host 半边：HTTP 路由 / 定时器 / research_radar Agent 工具 / 分页
├── client.js     2370 行 Client 半边：侧边栏图标 + 主面板（React，主题 token）
├── radar/
│   ├── config.js   119 行 Config schema（手写 Standard Schema v1，零依赖）
│   ├── dedupe.js   125 行 跨源去重键（DOI / arXiv / 标题+年份 / 源内 ID）
│   ├── store.js    400 行 JSON 持久化（配置 / 已读去重 / seen 剪枝 / 摘要缓存）
│   ├── sources.js 1059 行 六源抓取 + 相关性打分 + strict 判定 + 语言过滤 + 年份摊开 + 连字符折叠
│   ├── summarize.js 315 行 LLM 结构化摘要（三档解析深度，支持喂全文）
│   ├── mail.js     581 行 纯 Node SMTP over TLS（零依赖）+ 邮件 HTML 卡片渲染
│   ├── scan.js     611 行 扫描编排（增量窗口 + 全文抓取 + 并发摘要 + 质量回填 + 补 ISSN）+ 摘要邮件正文
│   ├── quality.js  421 行 质量分（期刊影响因子 / 被引百分位与 Q1–Q4 分区 / 开放获取 → 0–100 + 档位）+ DOI 反查 ISSN
│   ├── fulltext.js 598 行 全文抓取（arXiv / Europe PMC / OA PDF / 出版社 PDF → 纯文本）
│   ├── stats.js    182 行 趋势统计（周序列 / 来源 / 期刊 / 作者 / 标签榜单）
│   └── library.js  165 行 论文库书架（按发表年份 / 方向分架 + 新老判定）
├── test/                 18 个文件 / 241 个用例（node:test，零依赖）
├── locale/{zh,en}.json  显示元数据
├── icon.svg              原创雷达图标
├── docs/                 面板截图（panel-items / panel-form / panel-preview）
└── README.md             面向用户的功能说明
```

### Host 半边（`index.js`）

```js
export const name = 'dsh-research-radar'
export const inject = ['webServer', 'llm', 'tools', 'timer', 'agentDefaultModel']
export function apply(ctx, config) { ... }
```

- `API_PREFIX = '/api/dsh-research-radar'`，`CLIENT_MARKER = 'x-dsh-research-radar'`，`TICK_MS = 5 * 60 * 1000`
- 路由用 `ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })`
- 安全校验：`isLoopbackHost(req.headers.host)` 否则 403；缺 `x-dsh-research-radar` header 也 403；POST 必须 `content-type: application/json` 否则 415
- 定时：`ctx.effect(() => ctx.timer.interval(cb, TICK_MS))`，每 5 分钟 tick 一次，自己比较 `lastScanAt` 与 `intervalHours` 决定是否真扫（因为 `interval` 的延迟无法动态改）

**HTTP 端点（面板与外部调用都用这些）**

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/state` | 方向 + 分页条目 + 脱敏设置 + 源标签 + 解析深度档位 + 质量档位 + 状态（`?limit=&offset=&topicId=&filter=&sort=`） |
| POST | `/topics` | `{op:'upsert'\|'delete', topic}` |
| POST | `/settings` | patch `scan` / `mail` / `rss` / `api`；`pass` 传回 `********` 视为不改 |
| POST | `/preview` | **试检索**，不写库不摘要不去重 |
| POST | `/scan` | `{topicIds?, lookbackDays?, summaryDepth?}` → `{ok, newCount, lookbackDays, summaryDepth, qualityTiers, fullTextCount, errors, mail, items, state}` |
| POST | `/item` | 改 `read` / `starred` |
| POST | `/mark-all-read` | 全部标为已读 |
| GET | `/stats` | 趋势统计（`?days=&topicId=`） |
| GET | `/library` | 论文库书架（`?groupBy=year\|topic&topicId=`） |
| POST | `/clear-items` | 清空条目 |
| POST | `/test-mail` | 发测试邮件 |
| POST | `/preview-mail` | 预览摘要正文（返回 text + html） |

**Agent 工具** `research_radar`，`action` 枚举：
`status` / `list_topics` / `add_topic` / `remove_topic` / `scan` / `send_digest`，
参数支持 `name` / `keywords` / `authors` / `venues` / `institutions` / `exclude` / `sources` /
`languages` / `topicId` / `lookbackDays` / `summaryDepth`。

### 相关性判定（`radar/sources.js`，这是核心逻辑，改之前务必看懂）

```js
export function normalizeQuery(topic)   // → { keywords, authors, venues, institutions, exclude, matchMode, strict, strong }
export function scoreItem(item, query)  // → { matchedIn, score, strongHit, hitKeywords }
export function invertAbstract(index)   // OpenAlex 倒排摘要还原
export function collectFromSource({ source, topic, max, rss, api, lookbackDays })
export const SOURCE_LABELS
```

**「主要关键词」= 多词短语 / 含连字符 / 长度 ≥ 6 的词**（`strongKeywords()`）。
短缩写（`MR` / `AI` / `EMWM`）单独出现时歧义太大，不足以判定相关性：

- 存在主要关键词时，`serverKeywords(query)` **只把主要关键词下发给数据库** —— 否则磁共振论文会占满配额；
- `finalize()` 里 strict 判定：有主要关键词则必须 `strongHit.length > 0`，除非方向配了作者/期刊且这些维度命中；
- 短缩写仍参与本地打分和「命中理由」展示。

打分权重：标题命中 ×6、摘要 ×2、作者 ×4、期刊 ×3、主要关键词额外 ×4、开放获取 +1。

### Client 半边（`client.js`）

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-research-radar',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots', 'locale'],
      apply(ctx) { /* 注册 sidebar.panellist + main */ }
    }
  }
})
```

- `NS = 'dsh-research-radar'`，`PANEL_ID = 'research-radar'`
- 注册：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name:'sidebar.panellist', id:PANEL_ID, order:5, label:()=>ctx.locale.bind(NS)('title')}, RadarIcon))`
  + `ctx.slots.inject('main', () => ctx.slots.register({name:'main', key:PANEL_ID, locale:NS}, Panel))`
  —— **`sidebar.panellist` 的 id 和 `main` 的 key 用同一个值就会自动联动**
- 组件：`RadarIcon` / `Panel`（五 tab：items / library / topics / stats / settings）/ `ItemCard` / `TopicForm` / `Field` / `RankList`
- `api(action, body)` 用同源 `fetch` + `x-dsh-research-radar: 1` header
- **Client 服务**：`apply(ctx)` 把 ctx 存进模块级 `clientContext`，`startAgentSession(prompt)` 用它取
  `ctx.get('uiWorkspace')`（回退 `ctx.uiWorkspace`）调 `startSession(undefined, {prompt, clearPreviousDraft:false})`
  —— 面板的 🔍 精读按钮走这条路。`inject` 保持 `['slots','locale']` 不变。
- 文案：`DICT` 里内置 zh/en 双语（约 120 个键），按 `document.documentElement.lang` / `navigator.language` 选

---

## 四、环境与硬约束（**这一节最省时间，务必先读**）

### 工具路径

> **2026-10-21 新机器更新**：下表第一行是旧机路径，已失效。新机见第十一节 11.1。
> 当前可用的是 `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0）
> 或 `G:\DSH\resources\runtime\bin\node.cmd`；git 本轮现装到 `C:\Users\<user>\.dsh\tools\mingit\cmd\git.exe`（见 11.10）。

| 工具 | 路径 | 备注 |
| --- | --- | --- |
| node（旧机） | `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` | v24.21.0，**不在 PATH** |
| git（旧机） | `C:\Users\<user>\AppData\Local\Programs\PortableGit\cmd\git.exe` | 2.56.0，**不在 PATH**（从 npmmirror 装的 PortableGit） |
| node（新机） | `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` | v24.21.0，可用 |
| git（新机） | `C:\Users\<user>\.dsh\tools\mingit\cmd\git.exe` | 2.56.0 MinGit，**不在 PATH**，本轮从 npmmirror 下载解压（11.10） |

语法检查：`& $node --check <file>`，十个 JS 文件都要过一遍（`index.js` / `client.js` / `radar/*.js` 八个）。
单测：`& $node --test --experimental-test-isolation=none test/*.test.js`（**不能只给目录**；沙箱里必须加 isolation flag）。

### DSH 插件开发的坑（全部踩过，别再踩）

1. **`app.asar` 里的模板/文档只有 `read` 工具能读** —— `pwsh` / `glob` / `grep` 一律 PathNotFound。要复制模板必须先 `read` 再 `write`。

2. **动态 Client 半边的源码不是普通 bundle**，它被 `new Function(...)` 求值，参数表固定为：
   `["React", "console", "styles", "host", "harness", ...traps, "process", "Buffer"]`
   → `styles` / `host` / `harness` 是**闭包参数（builtin 符号）**，**不是 `ctx` 上的服务**，也不是 `require` 出来的。
   `ctx.styles` **不存在**。

3. **`fetch` / `require` / `setTimeout` / `setInterval` 在 Client 半边全是抛错的 trap**：
   - 要网络 → Host 半边注册路由，Client 用同源 `fetch`（**只有这一种例外可行**）或 `host.call`
   - 要定时 → `inject: ['timer']` 用 `ctx.timer`
   - 要别的模块 → 走 ctx 服务

4. **样式注入不要用 `ctx.styles`**，直接手写 style 标签：
   ```js
   ctx.effect(() => {
     const tag = document.createElement('style')
     tag.dataset.plugin = '@local/dsh-research-radar'
     tag.textContent = CSS
     document.head.append(tag)
     return () => { tag.remove() }
   }, 'research-radar.styles')
   ```
   （框架的 `claimStyles(id, before)` 会认领 factory 期间注入的 `<style>`，卸载时 `removeOwnedStyles(id)` 清理。）

5. **主题 token 的陷阱**：`--dsw-alias-brand-primary` 在**浅色主题**下是近黑色 `#0f1115`，**不是强调色**！当强调色用会得到「白底黑边、毫无层次」的卡片。正确的强调色是 `--dsw-alias-link`（`#4176e6`）。实测有效的 token：

   | token | 浅色主题值 |
   | --- | --- |
   | `--dsw-alias-link` | `#4176e6` ← 强调色 |
   | `--dsw-alias-brand-primary` | `#0f1115` ← 近黑，别当强调色 |
   | `--dsw-alias-bg-base` / `layer-1` / `layer-2` / `layer-3` | 全是 `#fff` |
   | `--dsw-alias-bg-module-platform` | `#f5f6f7` |
   | `--dsw-alias-border-l1/l2/l3/l4` | `#0000000a` / `1a` / `1f` / `29`（都极淡） |
   | `--dsw-alias-label-primary/secondary/tertiary` | `#0f1115` / `#61666b` / `#81858c` |
   | `--dsw-alias-markdown-placeholder` / `markdown-tag` | `#f5f6f7` / `#f1f3f5` |
   | `--dsw-specific-bubble` | `#edf3fe` |
   | `--dsw-alias-state-success-tertiary` / `warn-tertiary` | `#e6faed` / `#fef5e7` |
   | `--dsw-alias-state-error-primary` / `success-primary` / `warn-primary` | `#ec1313` / `#22c55e` / `#f59e0b` |
   | `--dsw-shadow-lv1` / `lv2` | `0 2px 4px 0 #0000000d` / `0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a` |

6. **不能 `require('@deepseek-ai/dsh-client-ui-*')`** —— profile 的 `node_modules` 里只有 `@deepseek-ai/cosmokit` 和 `@deepseek-ai/schemastery`，其余都在 `app.asar` 里。会报 `slot entry crashed in '<slot>'`。

7. **`read_image` 当前不可用** —— 模型 `deepseek-v4.1-flash-1017` 不声明 image input，截图无法自查。视觉验证只能靠 DOM 断言（`document.body.innerText` / `getComputedStyle`）。截图仍然值得存，给用户看。

### OpenAlex 的坑

**`filter` 参数绝对不能整体 `encodeURIComponent`！** 编码后 `:` 和值里的 `%20` 被二次转义，服务端解析成空值，`count` 直接从 883 掉到 0。用 `encodeFilter(filter)` 只转义 `# & +` 三个字符。

其它实测确认的语法：

| 用法 | 结果 |
| --- | --- |
| `title_and_abstract.search:"metal rubber"` | 883 ✅（**短语必须加引号且空格用 `%20`**） |
| 不加引号 `title_and_abstract.search:metal%20rubber` | 0 ❌ |
| `raw_author_name.search:"Li"` | ✅ |
| `raw_affiliation_strings.search:"Harbin"` | ✅ |
| `primary_location.source.id:S99182027` | ✅（先用 `/sources?search=` 解析期刊名→ID） |
| 竖线 `\|` | **同维度 OR** |
| 逗号 `,` | **跨维度 AND** |
| `authorships.raw_affiliation_strings.search` | 400 ❌ |
| `primary_location.source.display_name.search` | 400 ❌ |

- 约 1/3 记录无摘要（版权），用 `fetchCrossrefAbstracts(dois)` 走 Crossref 批量回补
- `abstract_inverted_index` 是倒排 `{word:[positions]}`，必须用 `invertAbstract()` 还原
- 配额：无 key 时**全网共享 $0.10/天**（响应头 `x-ratelimit-*`），会 429

### 热重载与验证

```js
// 改完 Host 代码后热重载（两次都要 application: applied）
plugin_manager set_plugin({ action:'set_plugin', target:'include:dsh-research-radar', enabled:false })
plugin_manager set_plugin({ action:'set_plugin', target:'include:dsh-research-radar', enabled:true })
```

> **2026-10-21 补充**：上面这条走的是 GUI 里的 plugin_manager 工具（MCP/Agent 工具），本机**用不了**——
> plugin-manager 插件的 `/api/plugin-manager/*` 路由在 desktop profile 里是 404（`web-ui-plugin-manager`
> 在 profile patch 里是 `disabled: true`），带 cookie 404、带 query token 401，脚本调不动。
> 而重跑 `dsh plugin --profile desktop add` **只会重新组合、不会替换已加载的宿主插件**
> （`dsh-hmr` 的 `reconcileProfile()` 把变更模块放进 `pending`，日志原话：
> `changed modules keep running their previous code until a restart`）。
> **结论：改完 Host 代码只能重启桌面应用，或在 GUI 插件面板里 disable→enable 一次。**
> 想在不重启的前提下证明新代码对，就 `import('./index.js')` + stub ctx 跑一遍 `apply()`（见 11.9 第 5 条）。

**Client 半边改完要刷新页面**才生效（host 按文件 mtime 自动换 `rev`，不用重启）。

**GUI 需要带 token 的 URL**，token 每进程新生成，端口也会变（当前 `http://127.0.0.1:61819`）。拿法：

- **最省事**：`POST /api/dsh-research-radar/preview-mail`（不需要 token），返回的 `html` 里就有
  「在面板中查看」按钮，正则抓 `http://127.0.0.1:\d+/\?token=[A-Za-z0-9_-]+` 即可。
  这个 URL 直接 `GET` 会 **303 + `Set-Cookie: dsh-auth-...`**，必须带 cookie 再请求 `/` 才拿到索引页。
- 或者临时在 `index.js` 加端点，用完删掉：
  `GET /api/dsh-research-radar/__auth-url` → `{ url: ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()) }`。
- 或者读运行时上下文里的 `DSH_WEB_URL`。

**直接调 API 必须带 header**：

```powershell
$h = @{'x-dsh-research-radar'='1'}
Invoke-RestMethod -Uri 'http://127.0.0.1:61819/api/dsh-research-radar/state' -Headers $h
```

POST 中文要注意：PowerShell `ConvertTo-Json` 默认编码会把中文写成 `????`，必须
`[System.Text.Encoding]::UTF8.GetBytes($json)` + header `content-type: application/json; charset=utf-8`。

### 浏览器工具（bcdp）的坑

- `bcdp_click` 用 CSS class 会报 `Locator ... matched 3 elements`（侧边栏三个按钮同 class）→ 用 `bcdp_js` 里 `[...document.querySelectorAll('button._2H3hWW_panelRow')].find(e => e.textContent.trim() === '研究前沿雷达').click()`
- `bcdp_js` 里 await 长任务会 `Runtime.evaluate timed out` → **把轮询写在 `bcdp_js` 内部**（最多 40 次 × 1000ms），比多次 `bcdp_wait` 可靠
- 切 tab 后 React 重渲染，之前抓的 DOM 引用失效 → 每次操作后重新 `querySelector`
- 页面里临时注入的钩子必须走 CDP `Page.addScriptToEvaluateOnNewDocument`，`bcdp_js` 直接赋值会在导航后丢失
- **不要手动 `fetch` bundle 再 `new Function` 执行** → 触发 `client-modules: duplicate factory registration`

### 沙箱与网络

- 外网下载必须 `sandbox_permissions: danger-full-access`（沙箱内 TLS 被拦：`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`）
- 但**插件进程本身出网正常**（跑在 DSH 主进程里）
- `web_search` 工具不可用（`DeepSeek search has no API key`），`web_fetch` 可用
- GitHub 直连 `Connection was reset` → 走 `registry.npmmirror.com` 镜像

---

## 五、验证方法（照这个跑一遍就知道有没有坏）

```powershell
$node = 'C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$root = 'I:\skill\dsh-research-radar'

# 0. 单测（最快，241 个用例，~7.5s）
#    在 DSH 沙箱里要加 --experimental-test-isolation=none，否则 spawn EPERM
& $node --test --experimental-test-isolation=none "$root/test/*.test.js"

# 1. 语法
foreach ($f in @('index.js','client.js','radar/config.js','radar/dedupe.js','radar/store.js','radar/sources.js','radar/summarize.js','radar/mail.js','radar/scan.js','radar/stats.js','radar/quality.js','radar/fulltext.js','radar/library.js')) {
  & $node --check "$root\$f"; if ($LASTEXITCODE -ne 0) { "FAIL $f" }
}

# 2. Host 端点（插件前缀路由只认 marker header，不需要 GUI token）
$h = @{'x-dsh-research-radar'='1'}
$r = Invoke-RestMethod -Uri "$($env:DSH_WEB_URL)/api/dsh-research-radar/state" -Headers $h
"topics=$($r.topics.Count) items=$($r.page.total) store=$($r.status.storePath)"

# 3. 试检索（不写库、不摘要、不发信，安全）
$body = '{"topic":{"name":"测试","keywords":["metal rubber","MR"],"sources":["openalex"]}}'
Invoke-RestMethod -Uri "$($env:DSH_WEB_URL)/api/dsh-research-radar/preview" -Method Post `
  -Headers (@{'x-dsh-research-radar'='1';'content-type'='application/json; charset=utf-8'}) `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

⚠️ **不要轻易 POST `/scan`** —— 邮件推送开着时会给用户真发信。要验证扫描先在 `/settings` 里关掉
`mail.enabled`，或者只跑 `/preview`。

**Client 半边的离线冒烟测试**已经固化成 `test/client-smoke.test.js`（17 个用例，不需要浏览器）：
用极简 React 替身跑 `client.js` 的 factory + apply + 首屏渲染 + 点击筛选 / 标为已读 / 加载更多 /
趋势页 / 方向表单语言复选框 / 设置页深度与时间范围预设 / 回溯检索 / 质量徽章与分区徽章，
断言 `mod.inject === ['slots','locale']`、卡片内容、`POST /item` 的 body、`offset` 递增、
`POST /scan` 的 `lookbackDays`。改完 `client.js` 先跑它，再刷新页面。

**面板视觉验证**：bcdp 打开 token URL → `bcdp_js` 断言 `.drr-root` 的 `innerText`、`.drr-card` 数量与间距、`getComputedStyle` 的边框/阴影/颜色、`document.querySelectorAll('style[data-plugin="@local/dsh-research-radar"]').length === 1`、console 无 error。

**确认 host 已加载最新 client.js**：从 `/?token=...` 页面正则取第二条 combo href（记得 `.Replace('&amp;','&')`），
`GET` 它，然后 grep 一个刚加的字符串（比如 `filter_items`）。host 按文件 mtime 自动换 `rev`，不用重启。

---

## 六、已知缺陷（原始记录 + 当前状态）

> **2026-10-21 更新**：下表 1–8 已全部修完并在真机验证（详见第十一节），9 已查明无需改，10 受环境阻塞。
> 保留原始描述，方便对照当时的问题与修法。

| # | 缺陷 | 状态 | 修法 / 位置 |
| --- | --- | --- | --- |
| 1 | **没有 DOI 去重** —— 同一篇论文从 OpenAlex（`openalex:W123`）和 Crossref（`crossref:10.xxx`）抓到时算两条 | ✅ 已修 | 新增 `radar/dedupe.js`，`scan.js` 用多键候选 + `selectFresh()` |
| 2 | **`seen` 字典永不清理** —— `state.json` 无限增长 | ✅ 已修 | `store.js` 的 `pruneSeen()`，180 天 / 20000 键，`mutate` 前自动跑 |
| 3 | **`read` 字段写了但没用** —— 面板没有已读 / 未读筛选 | ✅ 已修 | 加 `starred` 字段、`/mark-all-read`、面板筛选器与卡片按钮 |
| 4 | **PubMed 忽略 `lookbackDays`** | ✅ 已修 | `fetchPubmed` 加 `datetype=pdat&mindate&maxdate` |
| 5 | **没有 `Config` schema 导出** | ✅ 已修 | 新增 `radar/config.js`（手写 Standard Schema v1，零依赖） |
| 6 | **条目只取最近 200 条** | ✅ 已修 | `/state` 支持 `limit/offset/topicId/filter`，面板「加载更多」 |
| 7 | **摘要是串行的** | ✅ 已修 | `mapLimit(fresh, 3, ...)`，实测 8 篇从 30s+ 降到 18s |
| 8 | **邮件 HTML 很朴素** | ✅ 已修 | `mail.js` 新增 `digestToHtml()`，table + 内联样式卡片 |
| 9 | **定时靠自建 5 分钟 tick** —— 没用 `ctx.schedule` | ✅ 无需改（已查清） | `ctx.schedule` 并不存在：`timer` 服务的公开 API 就是 `timeout/interval/throttle/debounce`（`setTimeout/setInterval` 是 `timeout/interval` 的 deprecated 别名），`schedule` 是另一个包 `@deepseek-ai/dsh-schedule` 的**会话提醒**服务，跟插件定时器无关。现有 `ctx.timer.interval` 已是正确用法，详见第十一节 11.9 |
| 10 | **没有 git remote** | ⬜ 仍不推 GitHub（用户决策） | 本地提交已补上（`71c6c20`），git 用本轮现装的 MinGit，见 11.10 |

---

## 七、下一步优化方案（按优先级）

### P0 —— 已全部完成 ✅（2026-10-21）

1. **跨源去重（缺陷 #1）** → 新增 `radar/dedupe.js`。键优先级 `arxiv:<id>` → `doi:<doi>` → `t:<规范化标题>|<年份>` → `id:<小写 item.id>`；一篇论文写多个键，命中任一即视为见过。**与原方案的两处关键差异**：
   - `normalizeTitle` 用 `[^\p{L}\p{N}]+` 而不是 `[^a-z0-9]+` —— 后者会把纯中文标题抹成空串，所有中文论文共用一个键。
   - arXiv 的 DOI（`10.48550/arXiv.xxxx`）归一成 arXiv 编号，避免同一篇预印本在 arXiv 源和 Crossref 源各算一条。
2. **`seen` 剪枝（缺陷 #2）** → `store.js` 的 `pruneSeen()` / `SEEN_MAX_AGE_DAYS=180` / `SEEN_MAX_ENTRIES=20000`（按**键**计，约 7000–10000 篇）。`keepKeys` 由 `state.items` 的键汇总，**还在列表里的论文永不剪掉**；`mutate()` 在 persist 前自动跑。
3. **摘要并发化（缺陷 #7）** → `scan.js` 的 `mapLimit(fresh, SUMMARY_CONCURRENCY=3, ...)`，保留「单篇失败只记 `summaryError`」语义，错误汇总进 `result.errors`。
4. **PubMed 时间窗口（缺陷 #4）** → `sources.js` 的 `pubmedDateRange(lookbackDays)` + `datetype=pdat&mindate&maxdate`，上限卡今天。

### P1 —— 已全部完成 ✅（2026-10-21）

5. **已读 / 收藏（缺陷 #3）** → `normalizeItem` 加 `starred`；`POST /item` 同时支持 `read` / `starred`；新增 `POST /mark-all-read`；面板顶部三段筛选器（全部 / 未读 / 收藏，带计数）+ 方向下拉 + 「全部标为已读」；卡片右下角「收藏」「标为已读」按钮，已读卡片降透明度。
6. **邮件 HTML 卡片化（缺陷 #8）** → `mail.js` 的 `digestToHtml(items, topics, { panelUrl, locale })`：table + 内联样式、无 `<style>` 无 class、颜色写死十六进制、`safeUrl` 挡 `javascript:`；「在面板中查看」按钮用 `resolvePanelUrl(ctx)`（`ctx.get('connection').authenticatedUrl()`）生成带令牌 URL。
7. **条目分页 / 筛选（缺陷 #6）** → `GET /state?limit=&offset=&topicId=&filter=`（`filter` ∈ `all|unread|starred`），返回 `page:{total,offset,limit,hasMore}` 与 `counts:{all,unread,starred}`；面板每页 50 条 + 「加载更多」。
8. **`Config` schema（缺陷 #5）** → `radar/config.js` **手写 Standard Schema v1**（不依赖 schemastery —— link 安装后 profile 的 `node_modules` 里解析不到它）：`dataDir` / `llmProvider` / `llmModel` / `locale`，未知字段静默忽略（profile 里残留旧字段不能让插件加载失败）。

### P2 —— 能力扩展（第 9 条已完成 ✅）

**9. 增量抓取窗口** ✅ 已完成（2026-10-21）
原来每次都用 `lookbackDays`（默认 30 天）扫一个大窗口，靠 `seen` 去重，白烧配额。
现在 `radar/scan.js` 导出 `effectiveLookbackDays(lastScanAt, configuredDays, now)`：

| 情况 | 实际窗口 |
| --- | --- |
| 从没扫过 / 时间戳坏了 / 上次扫描在未来（改过系统时间） | 配置值（宁多勿漏） |
| 距上次已超过配置值（插件停了两周） | 配置值（不无限往前追） |
| 否则 | `ceil(间隔天数) + 2`，且 ≥ `MIN_LOOKBACK_DAYS=2`，且 ≤ 配置值 |

- `MIN_LOOKBACK_DAYS=2` 是给「论文在线日期比抓取日期晚一两天」留的余量，跨零点不会漏。
- **窗口按方向各算一份**（2026-10-21 修）：`lastScanAt` 从 `settings.scan` 挪到了每个 topic 上
  （`normalizeTopic` 新增 `lastScanAt`，缺省 `''`；`runScan` 扫完写回被扫的方向）。
  否则「刚新建的方向」会被全局的旧 `lastScanAt` 一起收窄成 2–3 天，首次扫描只能看到最近几天的论文。
  规则：方向自己的 `lastScanAt` 为空 → 用完整配置窗口；有值 → 按上表收窄。
  `settings.scan.lastScanAt` 仍保留（面板显示「上次扫描」、定时器判断间隔用），但不再参与窗口计算。
- `runScan` 把每个方向实际用的窗口写进 `result.scannedTopics[i].lookbackDays`，
  `result.lookbackDays` 取其中的最大值（对外报告「这次最多往回看多少天」）；
  `options.lookbackDays` 可强制指定（测试用）。
- `GET /state` 的 `status.effectiveLookbackDays` 取所有**启用**方向里最宽的那个，面板设置页显示成「本次窗口: N 天」。
- `POST /scan` 的响应新增 `lookbackDays`（以前只在 `runScan` 内部有，HTTP 层漏掉了）。
- 顺手修了 `fetchBiorxiv` 写死 30 天的问题（之前 `lookbackDays` 对它无效，缺陷 #4 的同类漏网）。
- 测试：`test/scan.test.js` 新增 6 个用例（无记录 / 1 小时 / 10 天 / 很久 / 未来 / 非法配置值）
  + 4 个 `runScan` 集成用例（显式窗口透传、按方向自动收窄、新方向不被全局收窄、扫完写回方向的 `lastScanAt`）。

**10. 中文文献** ✅ 已完成（2026-10-21）
用户是做材料/力学的，中文文献（CNKI / 万方）没有公开 API —— 但**不需要**它们也能做：

- 前置实测（这轮重新验证过）：
  - OpenAlex 有 `language` 字段，`filter=language:zh,...` 有效；`language:zh|en`（竖线 OR）也有效
    （同一个检索 `title_and_abstract.search:"metal rubber"`：zh 9 条、en 826 条、`zh|en` 835 条 = 9+826）。
  - Crossref **没有** language 过滤：`filter=...,language:zh` → 400 `filter-not-available`；
    `select=language` → 400 `select-not-available`。
  - PubMed 用 `chi[la]` / `eng[la]`，但**竖线无效**，必须显式 `(chi[la] OR eng[la])`
    （`"metal rubber"[tiab] AND chi[la]` → 0 条，`AND (chi[la] OR eng[la])` → 24 条）。
- 实现：方向新增 `languages: ['zh'] / ['en'] / []` 字段（`radar/store.js` 的 `normalizeTopic`，
  归一化函数会把非 zh/en 的值丢掉）。
  - **OpenAlex / PubMed 走服务端过滤**：`openAlexFilter` 拼 `language:zh|en`，`pubmedTerm` 拼 `(chi[la] OR eng[la])`。
  - **其余源（Crossref / arXiv / bioRxiv / RSS）走本地判定**：`detectLanguage(item)` 数标题+摘要里的
    汉字与拉丁字母占比，`cjk/total >= 0.2` 判 zh，否则有拉丁字母判 en；`finalize` 里 `isWrongLanguage` 丢弃不符的。
  - **认不出语言的条目一律放行**（`detectLanguage` 返回 `''`）—— 宁可多推，不误杀。
- **语义决策**：`languages` 是白名单，空数组 = 不限；**zh 与 en 同时选中直接折成空数组**。
  理由：如果真把 `zh|en` 拼给 OpenAlex，反而会把德语/法语论文排除掉，比不选更严格，违背用户「我全都要」的直觉。
- 老数据没有 `languages` 字段 → 读出来是 `[]` → 行为完全不变（向后兼容）。
- 面板：方向表单在「检索哪些数据库」下面新增「文献语言」两个复选框；方向列表行显示「文献语言：中文文献」。
- Agent 工具 `research_radar` 的 `add_topic` 新增 `languages` 参数；`status` 返回每个方向的 `languages`。
- 测试：`test/language.test.js` 14 例（归一化 / 折成空数组 / `describeLanguages` / `detectLanguage` 四种输入 /
  `finalize` 的 zh、en、不限、认不出放行、与 strict 叠加 / store 落盘归一化）
  + `test/client-smoke.test.js` 3 例（表单勾选后 upsert 带上 `languages`、两项都勾提交 `[]`、列表展示与编辑回填）。
- 没做的：CNKI / 万方（无公开 API）、semanticscholar（无 key 会 429）。真需要可以后续加 RSS 源（知网期刊有 RSS）。

**11. 趋势与统计** ✅ 已完成（2026-10-21）
新增 `radar/stats.js` + `GET /stats?days=&topicId=` + 面板第四个页签「趋势」。
- 统计在 **Host 侧**算（面板每页只有 50 条，前端算不了全量），纯函数 `computeStats(items, options)`。
- 返回：`windowDays / total / readCount / starredCount / summarizedCount / weeks[{week,count}] /
  weeklyPeak / bySource[{key,count,label}] / byVenue / byAuthor / byTopic / byTag`。
- `weekStart(iso)` 把时间归到 **UTC 周一**；时间序列**补齐空周**（0 也返回），前端画柱状图不用判断档。
- 坏时间戳与未来时间戳的条目不进窗口 —— 宁可少一根柱子，也不制造假峰值。
- 窗口可选 30 / 90 / 180 / 365 / 730 天，`days` 夹到 1–730，`topLimit` 默认 8、上限 50。
- 面板：4 张数字卡 + 周柱状图 + 5 个榜单（来源 / 期刊 / 作者 / 方向 / 标签），榜单带相对长度条。
- **第三次踩 `Number(null) === 0`**：`const rawDays = Number(options.days)` 会把「没传」变成 0 再夹成 1，
  统计窗口只剩一天。修法与 `clampInt` 相同：先判 `null / undefined / ''` 再 Number。`topLimit` 同样处理。
- 测试：`test/stats.test.js` 11 例 + `test/index.test.js` 的 `GET /stats` 1 例 +
  `test/client-smoke.test.js` 的趋势页 2 例。

**12. 与 Agent 深度联动** ✅ 已完成（2026-10-21）
摘要只读标题 + 摘要，信息有限。现在每张论文卡片底部有一个 **🔍 精读** 按钮：点一下把这篇论文的
身份信息 + 摘要前 2000 字拼成提示词，**丢进一个新会话的输入框**（不自动发送，用户自己按回车）。
- 提示词由 `buildDeepReadPrompt(item, locale)` 生成，中英双语；内容：方向名 + 标题 / 作者 / 期刊 /
  发表时间 / DOI / 链接 / 摘要，然后四条要求 —— ①先试着抓全文（OA / 预印本 / 机构库），拿不到就只基于
  摘要并明说；②按「问题 / 方法 / 结论与数据 / 创新点 / 局限」讲；③最后一段说哪些能直接搬到自己工作上；
  ④**不要编造**原文没有的数字、实验或结论，不确定写「原文未提及」。
- 落地方式：`client.js` 里用**模块级变量 `clientContext`** 接住 `apply(ctx)` 的 ctx（Panel 是纯组件，
  拿不到 ctx），`startAgentSession(prompt)` 调 `ctx.get('uiWorkspace')`（回退 `ctx.uiWorkspace`）的
  `startSession(undefined, { prompt, clearPreviousDraft: false })`。
  - `workspaceId` 传 `undefined` = 用当前 / 最近工作区，不用自己找；
  - `clearPreviousDraft: false` = **不清掉用户已经输入的草稿**（语义见 app.asar 的
    `requestDraftInitialization`：`clearPreviousDraft !== true` 且当前有草稿时返回 `preserved`）。
  - 为什么不走 `slots.register({ inject })` 注入 props：`inject` 是 `(...args) => Record`，
    拿不到 Client 根 ctx 的服务，还得再包一层；模块级变量最简单，且 apply 只跑一次。
- 点完顺手把该条标为已读（`patchItem(item, { read: true })`），列表里不会重复出现。
- 失败兜底：`uiWorkspace` 不可用 / 调用抛错时，面板顶部提示「无法发起精读: <原因>」，**不标已读、不崩**。
- 测试：`test/client-smoke.test.js` 2 例 —— ①点精读后 `uiWorkspace.startSession` 被调一次，
  `workspaceId === undefined`、`clearPreviousDraft === false`、提示词里含标题 / DOI / 方向名 / 链接 / 「不要编造」，
  且发出 `POST /item {read:true}`；②`uiWorkspace` 为 `null` 时提示失败且不发 POST。
- 没做的：真正的「拿全文」是 Agent 侧的能力（`web_fetch` 等工具），插件不替它抓；也没有回写「精读结论」到卡片
  —— 那是下一步（可以把会话 id 存进 item，卡片上显示「已精读」并跳回会话）。

### P3 —— 工程化

**13. 单元测试** ✅ 已完成（2026-10-21，2026-10-27 扩到 241 个）
`node --test test/*.test.js`，**241 个用例**，零依赖。覆盖去重键、seen 剪枝、检索打分 / strict 过滤、
连字符折叠、语言过滤、并发限流、增量窗口、解析深度分档、按年份摊开配额（`spreadByYear`）、分页筛选、
HTTP 路由、Config schema、趋势统计、论文库分架、邮件 HTML、质量分（对数曲线 / 百分位分区 / 缺信号先验）、
全文抽取（HTML / PMC XML / PDF / 四条路线）、客户端面板渲染冒烟。
**坑 1**：`node --test test/`（只给目录）在 Node 24 会报 `Cannot find module 'I:\...\test'`，必须写 glob（`test/*.test.js`）或显式列文件。
**坑 2**：在 DSH 的 Windows 沙箱里，`node --test` 的**默认进程隔离**会 `spawn EPERM` ——
测试运行器要用管道 stdio 起子进程，而沙箱禁止程序打开命名管道。加上 `--experimental-test-isolation=none`
（同进程串行跑）就正常：`node --test --experimental-test-isolation=none test/*.test.js` → 241 pass。
这不是代码问题，换到普通终端（或 danger-full-access）用原来的命令即可。

**14. git remote** ⬜ 仍不推 GitHub（用户决策：只做本地提交）。本地提交这一半已补上：
本轮装了 MinGit 并提交 `71c6c20`，详见 11.10。

---

## 八、交接清单

接手后建议按这个顺序：

1. 读 `README.md`（面向用户）→ 读本文件第四节（环境约束）
2. 跑第五节的语法检查 + `/state` 端点，确认插件还活着
3. 用 bcdp 打开 token URL，确认面板五个 tab 都能渲染
4. **跑一遍单测**：`node --test test/*.test.js`，应该是 196 pass / 0 fail
   （在 DSH 沙箱里跑要加 `--experimental-test-isolation=none`，否则 `spawn EPERM`，见第七节 P3 第 13 条）
5. P0 / P1 / P2 第 9、10、11、12 条已完成（第七节 + 第十一节）；解析深度与时间范围两项见 11.12，
   论文库书架见 11.13，「检索得太少」的三个根因见 11.14
6. 每改完一个文件 `node --check`，改完 Host 侧热重载，改完 Client 侧刷新页面验证
7. 提交前确认没有把 `tmp-*`、`*.bak` 之类带进去

### 判断「检索结果太少」的正确姿势（2026-10-23 血泪）

用户说「检索得太少」时，**不要第一反应去放宽 strict**。按这个顺序量：

1. **逐源直抓**：`collectFromSource({source, topic, max:30, lookbackDays:365})` 看每个源各出几条。
   某一个源 0 条而 OpenAlex 有 30 条，问题就在那个源，不在 strict。
2. **对比 strict 前后**：同一批候选跑 `finalize(items, query, max, false)` 与 `finalize(items, query, max, false, false)`
   加个 `strict:false` 的 query，看 strict 到底丢了多少。实测它只丢 20%（50→40），不是主因。
3. **看窗口**：`effectiveLookbackDays()` 算出来几天，再用那个天数直抓一次。窗口 3 天时命中 0 条是正常的。
4. **看字面匹配率**：把返回的标题拿去和关键词做归一化比对，看有多少是「写法变体」被漏掉的
   （实测 26% 是 `metal-rubber` / `metal–rubber`）。
5. 最后才动 strict 或配额。

### 不要做的事

- ❌ 不要手改 profile 的 `package.json` / `cordis.patch.yml`（用 `plugin_manager`）
- ❌ 不要跑 `pnpm install`
- ❌ 不要 `require('@deepseek-ai/dsh-client-ui-*')`
- ❌ 不要用 `ctx.styles`（不存在）
- ❌ 不要把 OpenAlex 的 `filter` 整体 `encodeURIComponent`
- ❌ 不要把 `--dsw-alias-brand-primary` 当强调色
- ❌ 不要随意触发扫描（邮件推送开着，会给用户发信）
- ❌ 不要直接移动/重命名插件目录后就撒手 —— profile 里登记的是绝对路径 `link:I:/skill/dsh-research-radar`，移动后必须重新 `install_bundle`（见第十节）
- ❌ **不要用 `Get-Content -Raw` + `WriteAllText` 改含中文的文件** —— Windows PowerShell 5.1 的 `Get-Content` 默认按 ANSI(936) 读，`-Raw` 再写回会把整个文件变成乱码。本次就是这么把 `HANDOFF.md` 弄坏过一次，最后靠 `.git/objects` 里的 blob 手工解压恢复的。要改文件用 `edit` 工具，或者 `[System.IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)` + `WriteAllText(..., UTF8Encoding($false))`。

---

## 九、关键决策记录（为什么这么做）

| 决策 | 原因 |
| --- | --- |
| 自建 bundle **零运行时依赖** | profile 目录外 `import 'nodemailer'` 的解析不可靠；只用 Node 内置 + Host 注入服务 |
| 邮件**手写 SMTP** 而非用 nodemailer | 同上。实测 465 SSL / 587 STARTTLS / AUTH LOGIN / AUTH PLAIN 全部可用，`.eml` 输出格式正确 |
| Client↔Host 走**同源 HTTP 路由**而非 `host.call` | 官方模板无 `host.call` 示例，已安装插件也都是自有 RPC 路线；同源 fetch 简单可靠（且这是 Client 半边 `fetch` trap 的唯一例外） |
| 相关性用**主要关键词 + strict** 而非纯 AND | 纯 AND 经常 0 命中；纯 OR 被短缩写淹没。折中方案实测最稳 |
| 有主要关键词时**只下发主要关键词**给数据库 | 否则 `MR` 会在服务端占满 `max` 配额，本地再过滤也来不及 |
| 面板自己维护 zh/en 字典而非只用 `ctx.locale.bind()` | 需要按浏览器语言即时切换，且字典键多，自己查表更直接（同时也 `register` 给框架用） |
| 数据存 `~/.dsh/research-radar/state.json` | Web 进程没有 `DSH_HOME` 环境变量，落到 Temp 会丢数据。用 `resolveDshHome()` 三级兜底 |
| topic 的 `id` 缺失时**由名称派生**而非丢弃 | 换机/手改 `state.json` 容易漏 `id`，原来会静默丢方向。`deriveTopicId()` 用 djb2 哈希，同名稳定 |
| **手写 Standard Schema v1** 而不 `import schemastery` | 插件用 `link:` 装进 profile 后，模块解析从 profile 的 `node_modules` 走，不保证能找到 `@deepseek-ai/schemastery`。手写 `{'~standard': {version:1, vendor, validate}}` 零依赖且被 `resolveConfig()` 正式支持 |
| 去重键**一篇论文写多个**（DOI + arXiv + 标题 + 源内 ID） | 只有单个键时，某源缺 DOI 就会漏判重；多键冗余写入，下次命中任意一个都能挡住 |
| `normalizeTitle` 用 `[^\p{L}\p{N}]+` | 只保留 `[a-z0-9]` 会把纯中文标题抹成空串，所有中文论文共用一个键 |
| **不把 `connection` 加进对象级 `inject`** | 桌面端注入表是宿主启动时一次性收集的，对象级 `inject` 会把整个 `apply()` 推迟，晚订阅会丢行。改用 `ctx.get('connection')` 局部取，拿不到就降级（`dsh-whale-widget` 的 `lib/index.js` 有同样的注释） |
| 邮件 HTML 用 **table + 内联样式** | Outlook / 手机邮件客户端不支持 CSS 变量与 `grid`；`<style>` 在部分客户端会被剥离 |
| 客户端渲染测试用**极简 React 替身** | 装不了 jsdom（插件零依赖），但「改完 client.js 白屏」是最容易发生的事故。替身只实现 `createElement/useState/useEffect/useCallback`，够跑通渲染与点击 |
| 语言过滤**只加 zh/en 两档**，不引入 CNKI / 万方 | 中文库没有公开 API。实测 OpenAlex 的 `language:zh` 就够用（`metal rubber` 相关 9 条中文记录），不值得为它引入抓取式爬虫 |
| `languages` **zh + en 都选 = 空数组（不限）** | 真拼成 `language:zh|en` 反而会把德语/法语论文排除，比不选更严格，违背「我全都要」的直觉 |
| 认不出语言的条目**放行** | 本地判定只靠汉字占比，标题是纯数字/符号时判不出来。宁可多推一条，也不要把真论文误杀 |
| 趋势统计在 **Host 侧**算 | 面板每页只有 50 条，前端算不了全量；`computeStats()` 是纯函数，好测 |
| 「精读」用 **`uiWorkspace.startSession(undefined, {prompt})`** 而不是往输入框塞字 | 这是宿主给插件的官方口子（`StartSessionOptions extends DraftInitializationOptions`，只有 `prompt` / `clearPreviousDraft` / `agentPreset`）。传 `undefined` 工作区 = 用当前/最近工作区，不用自己找；`clearPreviousDraft:false` 保证不清掉用户已输入的草稿 |
| 精读提示词**明确要求「不要编造」** | 摘要 + 元数据信息有限，Agent 拿不到全文时最容易胡编数字。宁可让它说「只读到摘要」 |
| Client 服务用**模块级变量 `clientContext`** 接 `apply(ctx)` 的 ctx | Panel 是纯 React 组件拿不到 ctx；`slots.register({inject})` 的 `inject` 是 `(...args) => Record`，也拿不到 Client 根 ctx 的服务。apply 只跑一次，模块级变量最简单 |
| 解析深度**同时收窄输入摘要与输出上限** | 只压 `maxTokens` 省不了多少 —— 一篇 6000 字摘要本身就占 ~4k tokens。`brief` 档喂 1500 字 + 350 输出，单篇从 ~7.6k 降到 ~1.9k |
| 深度档位**只影响新扫描**，不重算历史 | 否则用户在设置里点一下「精简」，历史几百篇会被重烧一遍，比不切更费 |
| 时间范围上限放到 **3650 天**，另配「回溯检索」按钮 | 只把窗口调大没用：日常扫描是增量的（只往回看「距上次扫描天数 + 2 天」），老论文永远进不来。必须有一个显式的「用整个窗口扫一次」的入口 |
| 回溯**不常驻**，扫完照常前移 `lastScanAt` | 否则每轮都按 3 年窗口烧配额，正好和「省 token」的诉求相反 |

---

## 十、换到另一台电脑

> **本节描述的搬家已经在 2026-10-21 发生过一次**：旧机 `C:\Users\<user>\` / `F:\python\dsh-research-radar`
> → 新机 `C:\Users\<user>\` / `I:\skill\dsh-research-radar`。实际走的是 10.5 的省事路径（只带代码，
> 配置重填），因为旧机的 `state.json` 没带过来。下文的实测记录保留原样，作为方法参考。

好消息：**插件代码里没有任何硬编码路径或用户名**（`F:\`、`C:\`、`/python`、`jincheng` 全搜不到），整个目录可以直接搬到任意位置、任意盘符、任意用户名下。

已实测验证（不是推测）：

| 验证项 | 方法 | 结果 |
| --- | --- | --- |
| 换路径后代码仍可运行 | 把整个目录拷到 `F:\python\tmp-move-test\another dir\dsh-research-radar`（**带空格、带中文无关路径**），7 个 JS 文件 `node --check` | 全部 exit=0 |
| 数据目录跟随新用户名 | 把 `USERPROFILE`/`HOME` 指向假的 `F:\python\tmp-move-test\fakeuser`，清掉 `DSH_HOME`，调 `resolveDshHome()` | 得到 `F:\...\fakeuser\.dsh`，自动建目录并写入 `state.json`（702 bytes） |
| `DSH_HOME` 能覆盖 | 设 `DSH_HOME=F:\python\tmp-move-test\customhome` | `store.path` = `...\customhome\research-radar\state.json` |
| 真实 `state.json` 拷过去能读 | 复制用户的 17 KB state 到假 home | `topics=[{id:'t-mvgpentg',name:'金属橡胶'}]`、`items=4`、`seen=12`、`mail.host=smtp.163.com`、密码 16 位**完整保留** |
| 手改 state.json 漏 id 不会丢数据 | 写一条只有 `name` 没有 `id` 的方向 | 修复前：重启后整条被丢弃；修复后：由名称派生稳定 id `t-voqfnb`，两次独立加载结果一致 |

> 最后一项是本次迁移测试**发现并修掉的真实 bug**：`normalizeTopic` 原来要求 `id` 和 `name` 都非空，否则返回 `null` 丢弃。新机器上用户手写或从别处拼 `state.json` 时很容易漏 `id`，一重启方向就没了。现在改成 `id` 缺失时用 `deriveTopicId(name)`（djb2 哈希）生成，同名稳定。

需要重新处理的只有两处**外部登记**：DSH profile 里的绝对路径，以及数据目录。

### 10.1 要带走什么

| 内容 | 位置 | 必需 | 说明 |
| --- | --- | --- | --- |
| 插件目录 | `F:\python\dsh-research-radar\` | ✅ 必需 | 排除 `node_modules/`（本项目零依赖，本来就没有） |
| git 历史 | 同上 `.git\` | 建议 | 不要的话删掉也能跑，但会丢掉 5 个提交记录 |
| 用户配置 + 已抓论文 | `C:\Users\<user>\.dsh\research-radar\state.json` | 建议 | 里面是方向（金属橡胶）、扫描设置、SMTP 账号密码、已抓的 4 篇论文和去重表 |
| 截图 | 插件目录 `docs\` | 可选 | 只是给 README 用的 |

**打包命令**（在旧机器上，PowerShell）：

```powershell
# 连 git 历史一起打（CreateFromDirectory 会把 .git 也带上；Compress-Archive 会跳过隐藏项）
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  'F:\python\dsh-research-radar',
  'F:\python\research-radar.zip',
  [System.IO.Compression.CompressionLevel]::Optimal,
  $true)

# 配置单独打一份（别和代码混在一起，里面有邮箱授权码）
Copy-Item "$env:USERPROFILE\.dsh\research-radar\state.json" `
  "$env:USERPROFILE\Desktop\radar-state.json"
```

已实测：上面第一条命令产出 **854 KB / 95 个条目**（含 `.git\` 的 5 个提交），解压后 `node --check` 全部通过。

> ⚠️ `state.json` 里的 SMTP 密码是**明文**（`settings.mail.pass`）。别把它传到网盘、别提交进 git。它位于插件目录之外，正常情况下不会被 `git add` 到；但如果为了「一起打包」把它复制进插件目录，一定要先加进 `.gitignore`。走微信/邮件传的话，用完就删。

### 10.2 新机器前置条件

| 需要 | 是否必需 | 怎么确认 |
| --- | --- | --- |
| DeepSeek Harness 已安装并能打开 Web GUI | ✅ 必需 | 能打开 `http://127.0.0.1:<port>` |
| 插件目录放好 | ✅ 必需 | 路径随意，**但之后不要再移动** |
| `state.json` 放到 `%USERPROFILE%\.dsh\research-radar\` | 建议 | 目录不存在就新建 |
| Node.js | 可选 | 只在想跑 `node --check` 语法检查时需要。DSH 自带一份：`%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| Git | 可选 | 只在想继续提交时需要。没有也不影响插件运行 |
| 网络能访问 `api.openalex.org` / `api.crossref.org` | ✅ 必需 | 否则扫描会全空 |

### 10.3 安装步骤

**第 1 步：放代码**

把 `research-radar` 文件夹解压到新机器任意位置，例如 `D:\work\dsh-research-radar`。

**第 2 步：放配置**

```powershell
$dst = "$env:USERPROFILE\.dsh\research-radar"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item "$env:USERPROFILE\Desktop\radar-state.json" "$dst\state.json"
```

如果没带 `state.json`，跳过这步 —— 插件首次启动会自动建一份空配置，之后在面板里重新填方向、邮箱即可。

**第 3 步：装插件**

在 DSH 里让 Agent 执行（**不要手改 profile 的 `package.json`**）：

```
plugin_manager install_bundle
  target: D:\work\dsh-research-radar        ← 用新机器上的绝对路径
```

返回 `"application": "applied"` 且 `"warnings": []` 即成功。DSH 会自动在 profile 里写入
`"@local/dsh-research-radar": "link:D:/work/dsh-research-radar"`（注意是正斜杠）。

**第 4 步：刷新页面**

侧边栏应出现「研究前沿雷达」。没出现就 `Ctrl+Shift+R` 硬刷新（Client 半边是浏览器 bundle，必须刷新才加载）。

**第 5 步：验证**

```powershell
# 端点活着（需要 marker header，否则 403）
Invoke-RestMethod -Uri "$($env:DSH_WEB_URL)/api/dsh-research-radar/state" `
  -Headers @{'x-dsh-research-radar'='1'} | ConvertTo-Json -Depth 4
```

看到 `topics`、`settings`、`status.storePath` 就说明 Host 半边正常。`storePath` 应该是
`C:\Users\<新用户名>\.dsh\research-radar\state.json` —— **如果指向 `AppData\Local\Temp`，说明数据目录没放对**。

然后面板里点「设置 → 发送测试邮件」，确认 SMTP 在新机器上也能发（163 的授权码通常不绑 IP，但公司网络可能封 465 端口）。

### 10.4 五个容易踩的坑

**① profile 里的路径是绝对的，搬家必失效**

旧机器 profile 里是 `link:F:/python/dsh-research-radar`。把文件夹拷到 `D:\work\` 之后，这个 link 指向不存在的路径，DSH 启动会报模块找不到。

- 如果新机器是**全新安装的 DSH**（profile 里没有这条记录）→ 走 10.3 第 3 步，自动写对新路径。
- 如果新机器是**整个 profile 一起拷过来的** → 必须重新 `install_bundle`，或让 Agent 用 `plugin_manager` 先 `set_plugin` 禁用再启用，它会重写 link。

**② 数据目录跟着用户名走**

`radar/store.js` 的 `resolveDshHome()` 顺序是：`DSH_HOME` 环境变量 → `os.homedir()\.dsh` → `os.tmpdir()\dsh-home`。新机器用户名不同，路径自然就变了 —— 这是设计如此，不用改代码。只要把 `state.json` 放到**新机器的** `%USERPROFILE%\.dsh\research-radar\` 就行。

注意 `os.homedir()` 在 Windows 上读的是 `USERPROFILE`，如果新机器上设置了 `HOME` 但没设 `USERPROFILE`（少见，一般是 Git Bash 环境），可能落到意料之外的目录。排查时先看 `/state` 返回的 `status.storePath` 到底指哪。

**③ GUI 的 token URL 每个进程都不一样**

`http://127.0.0.1:<port>/?token=xxxx` 里的 token 是 DSH 进程启动时随机生成的，重启就变，端口也可能变（见过 58120 / 57364 / 54648）。**不要硬编码**。要让 Agent 拿当前 URL，用 Host 的 `ctx.connection.authenticatedUrl(baseUrl)`。

**④ OpenAlex 免费额度是按 IP 共享的**

无 API Key 时是**全网共享 $0.10/天**（响应头 `x-ratelimit-remaining-usd`）。换机器换 IP 会拿到新额度，但白天高峰期照样 429。插件里已有 1.1 秒节流 + 429 指数退避重试，还不行就在「设置 → 检索接口」填自己的 OpenAlex Key（免费申请）。

**⑤ 别把 `state.json` 提交进 git**

它在插件目录之外，正常情况下不会被 `git add` 到。但如果有人为了「一起打包」把它复制进插件目录，记得加进 `.gitignore` —— 里面是明文邮箱授权码。

### 10.5 只想把代码带到新机器、配置重新填

最省事的路径：**只拷代码目录，不拷 `state.json`**。新机器装好后在面板里点「研究方向 → 添加方向」，填名称 + 关键词 + 勾选数据库，点「试检索」确认搜得准，再保存；然后「设置」里填 SMTP。全程 2 分钟，比处理明文密码的风险更划算。

`radar-config.example.json` 是配置的字段结构参考（占位值，无真实凭据），不确定某个字段怎么填时看它。

---

## 十一、本次交接完成的工作（2026-10-21，新机器 `<user>` / `I:\skill\dsh-research-radar`）

### 11.1 环境差异（和旧机器不一样，先看这个）

| 项 | 旧机 | 新机（本次） |
| --- | --- | --- |
| 用户名 | `<user>` | `<user>` |
| 插件目录 | `F:\python\dsh-research-radar` | `I:\skill\dsh-research-radar` |
| `DSH_HOME` | — | `C:\Users\<user>\.dsh` |
| Web URL | 端口会变 | `http://127.0.0.1:61819`（`$env:DSH_WEB_URL`） |
| node | 不在 PATH | `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0），或 `G:\DSH\resources\runtime\bin\node.cmd` |
| **git** | PortableGit 2.56 | 原本**完全没有 git.exe**（`C:\Program Files\Git`、`D:\Program Files\Git`（空目录）、`C:\Users\<user>\AppData\Local\Programs\PortableGit` 都没有；`Get-ChildItem D:\ -Filter git.exe -Recurse -Depth 3` 无结果）→ 本轮已装 MinGit，见 11.10 |
| 用户数据 | 有 `state.json` | **没迁过来**，插件首次启动自动建了空的 |

**结论**：仓库 `.git/` 一直是完整的（`refs/heads/main` 从 `35fa645` 走到 `71c6c20`），只是原本没有可执行文件。
11.10 记录了怎么用 npmmirror 上的 MinGit 补上这个缺口。

### 11.2 沙箱 ACL 事故（开工时全盘写不进去）

本会话刚开始所有 `pwsh` 调用都直接失败：

```
Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(I:\skill\dsh-research-radar)
```

用 `diagnose-windows-sandbox-acl` skill 的脚本诊断出：`I:\skill\dsh-research-radar` 与 `I:\skill` 的
owner 是当前用户、`writeDac=true` 但 `writeOwner=false`；`I:\` 的 owner 是 `S-1-5-18`（SYSTEM）且 `writeDac=false`。

修法（注意 PowerShell 执行策略会拦住直接 `&` 脚本，要用 `powershell.exe -File`）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  '<skill>\scripts\diagnose-windows-sandbox-acl.ps1' `
  -Path 'I:\skill\dsh-research-radar' -AllowRoot 'I:\skill\dsh-research-radar' `
  -Out 'I:\skill\dsh-acl-recovery'
```

结果 `FIXED=0 GRANTED=1 REFUSED=0 RESTORED=0`，备份在 `I:\skill\dsh-acl-recovery\acl-backup-*.json`，
回滚脚本同名 `.ps1`。

### 11.3 代码改动清单

| 文件 | 改动 |
| --- | --- |
| `radar/dedupe.js` | **新增**（125 行）。`normalizeDoi` / `normalizeArxivId` / `normalizeTitle` / `normalizeYear` / `dedupeKeys` / `dedupeKey` / `isCanonicalKey` / `migrateSeenKey` |
| `radar/config.js` | **新增**（119 行）。手写 Standard Schema v1：`dataDir` / `llmProvider` / `llmModel` / `locale` |
| `radar/store.js` | `pruneSeen()` + `SEEN_MAX_AGE_DAYS=180` + `SEEN_MAX_ENTRIES=20000`；`normalizeItem` 加 `starred`；`normalizeTopic` 加 `languages`（`KNOWN_LANGUAGES=['zh','en']`，两项都选折成 `[]`）与 `lastScanAt`；`normalize()` 迁移旧 seen 键、`summaryDepth` 归一；`mutate()` 前自动剪枝；**`maxPerTopic` 默认 8 → 15、上限 30 → 50** |
| `radar/sources.js` | `pubmedDateRange()`；`fetchPubmed({query,max,lookbackDays=30})` 拼 `datetype=pdat&mindate&maxdate`；`normalizeQuery` 加 `languages`；`openAlexFilter` 拼 `language:zh|en`、`pubmedTerm` 拼 `(chi[la] OR eng[la])`；`detectLanguage()` + `isWrongLanguage()` 本地语言判定；`describeLanguages()`；`fetchBiorxiv` 支持 `lookbackDays`（原来写死 30 天）；**`shouldSpread()`（`WIDE_WINDOW_DAYS=90`）+ `spreadByYear()` + `fetchOpenAlexPage()` 双路取样 + `finalize(...,spread)`**；**`foldText()`（连字符 / 下划线 / 斜杠折成空格）+ `includesPhrase()` 走折叠**（修掉 `metal-rubber` 假阴性）；**`fetchCrossref` 去掉 `sort=published` 改走相关度排序**（修掉 80 条里 0 条相关）；`export { strongKeywords }`、`export { finalize, isExcluded }`（为可单测） |
| `radar/summarize.js` | **`SUMMARY_DEPTHS=['brief','standard','deep']`** + `DEFAULT_SUMMARY_DEPTH='standard'`；`FIELD_SPECS` / `DEPTH_SPECS`（字段集 + `abstractChars` + `maxTokens`）；`normalizeSummaryDepth()` / `summaryDepthSpec()` / `summaryDepthOptions()` / `buildSystemPrompt(depth)`；`summarizePaper(...,depth)` 并把 `summary.depth` 写进结果 |
| `radar/scan.js` | `mapLimit()` + `SUMMARY_CONCURRENCY=3` + `summarizeOne()`；`selectFresh(candidates, seen)`；`effectiveLookbackDays()` + `MIN_LOOKBACK_DAYS=30`（增量窗口下限，配置上限 3650 天；30 天是为了兜住「出版日期几天前、今天才进索引」的延迟收录）；`resolvePanelUrl(ctx)`；`spread: shouldSpread(topicLookback)`；`result.summaryDepth` / `result.lookbackDays`；邮件改 `digestToHtml`；locale 从 `config.locale` 读；**`ensureIssns()`（扫描前给缺 ISSN 的新论文用 DOI 反查补上）+ `backfillQuality()`（扫描末尾重算缺前提的老论文，判据是「有没有 ISSN」而不是「有没有 quality」）+ `result.backfilled` / `result.fullTextCount` / `result.qualityTiers`** |
| `radar/quality.js` | **新增**（421 行）。`normalizeIssn` / `journalScore`（对数曲线）/ `citationScore`（年化）/ `citationPercentileScore` / `quartileOf`（Q1–Q4）/ `paperQuality` / `fetchJournalMetrics`（ISSN 批量，50 一批）/ `createJournalCache`（30 天，查不到的也记 missing）/ **`resolveIssnsByDoi`（DOI 批量反查 ISSN，`filter=doi:a\|b` 只能写一次字段前缀）** |
| `radar/fulltext.js` | **新增**（598 行）。`arxivIdOf` / `htmlToText` / `extractPmcBody` / `pdfToText`（纯 `node:zlib`，按 `latin1` 解，TJ 字距补空格）/ `looksLikeProse` / `condenseText`（保头 55% + 保尾 45%）/ `stripLeadingBoilerplate` / `fetchFullText`（四条路线 + 总预算共享 + 订阅制 `CLOSED_HOSTS` 快速失败）/ `resolveDoiLanding`（失败重试一次） |
| `radar/stats.js` | **新增**（182 行）。`computeStats(items,{days,topicId,now,topLimit,sourceLabels})` / `weekStart()` / `DEFAULT_STATS_DAYS=90` / `MAX_STATS_DAYS=730` / `TOP_LIMIT=8` |
| `radar/library.js` | **新增**（156 行）。`yearOf()` / `freshnessOf(item,now)`（90 天新 / 365 天内近期 / 超过一年老 / 无日期 unknown，未来日期算新）/ `buildLibrary(items,{groupBy,topicId,now,topicLabel})`；架内排序 `publishedAt` → `citations` → `discoveredAt`；行只带精简字段（`hasSummary` / `summaryDepth` / `ageDays` / `freshness`），不带宽摘要 |
| `radar/mail.js` | `MAIL_COLORS` / `FONT_STACK` / `escapeHtml` / `safeUrl` / `chipHtml` / `fieldRowHtml` / `paperCardHtml` / `digestToHtml(items,topics,{panelUrl,locale})`；`textToHtml` 保留作兜底 |
| `index.js` | `import { Config, validateConfig }`、`export { Config }`；`paginateItems()` + `DEFAULT_ITEM_LIMIT=50` + `MAX_ITEM_LIMIT=500`；`publicState(query)` 返回 `page` / `counts` / `summaryDepths`，`status.effectiveLookbackDays` 取各方向最大值；`POST /item` 支持 `read`+`starred`；新增 `POST /mark-all-read`；新增 `GET /stats`；**新增 `GET /library`**；`POST /preview` 传 `spread`；`POST /scan` 支持 `lookbackDays` 强制窗口并回传 `summaryDepth`；`POST /settings` 的 `scan` 分支含 `summaryDepth` 与 1–3650 天窗口；`preview-mail` 返回 `html`；`toLanguageList()` + topics/Agent 工具的 `languages`、Agent 的 `lookbackDays`/`summaryDepth` |
| `client.js` | 筛选器（全部/未读/收藏 + 计数）、方向下拉、`loadMore()`、`patchItem()`、`markAllRead()`；`ItemCard({item,t,onToggleRead,onToggleStar,onDeepRead})`；**🔍 精读按钮** + `buildDeepReadPrompt(item,locale)` + `startAgentSession(prompt)`（模块级 `clientContext` 接 `apply(ctx)` 的 ctx，走 `uiWorkspace.startSession`）；第四个页签「趋势」（`RankList` + 周柱状图）；**第五个页签「论文库」**（`loadLibrary()` 只在打开页签时拉、按年份/方向切换、顶部 6 张数字卡、`.drr-shelf` 书架 + `.drr-book` 行 + 新/老角标、点标题顺手标已读）；方向表单的「文献语言」复选框；**设置页的常用时间范围预设（半年/1年/2年/3年）+ 回溯检索按钮 + 解析深度 seg**；扫描提示条报告「本次窗口 N 天 · 解析深度 X」；新增 CSS `.drr-card-read` / `.drr-dot` / `.drr-chip-star` / `.drr-seg` / `.drr-more` / `.drr-stat*` / `.drr-chart*` / `.drr-list*` / `.drr-btn-deep` / `.drr-presets*` / `.drr-hint-inline` / `.drr-lib-summary` / `.drr-shelf*` / `.drr-book*`；DICT 加 70+ 个键 |
| `package.json` | `files` 加 `radar/config.js`、`radar/dedupe.js`、`radar/stats.js`、`radar/library.js`；`scripts.test = "node --test test/*.test.js"` |
| `radar-config.example.json` | `settings.scan` 补 `summaryDepth: "standard"`（换机器重建时容易漏） |

### 11.4 测试（241 个用例，全部通过）

```
node --test test/*.test.js   →   pass 241 / fail 0
```

（在 DSH 沙箱里要加 `--experimental-test-isolation=none`，否则测试运行器起子进程会 `spawn EPERM`。）

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `test/dedupe.test.js` | 10 | 各种 DOI 前缀、arXiv 归一、中文标题不抹空、键顺序、`migrateSeenKey` |
| `test/store.test.js` | 9 | 180 天边界、坏时间戳、`keepKeys` 永不删、条数截断、幂等、默认设置（含 `summaryDepth` / `fullText` / `maxPerTopic` 15） |
| `test/store-file.test.js` | 12 | 真实落盘读回、旧键迁移、items 里的键不被剪、坏 JSON 回退、`summaryDepth` 补默认与非法值归一、`maxPerTopic` 旧默认 8→15 迁移、**`citationPercentile` 缺字段/显式 null 都读成 null（不能变 0 → Q4）** |
| `test/sources.test.js` | 13 | `normalizeQuery` 的 strong 判定、`scoreItem` 打分、`invertAbstract`、六源标签 |
| `test/finalize.test.js` | 21 | strict 丢弃磁共振、作者/期刊救回、排除词、`matchMode=all`、同分按日期；`spreadByYear` 每年代表 / 年内排序 / 条数够用 / 脏数据、`finalize(spread=true)`、`shouldSpread` 90 天边界；**连字符变体折叠 4 例**（标题四种写法、摘要变体、不放过 `MR Imaging`、排除词折叠） |
| `test/language.test.js` | 14 | `languages` 归一化、zh+en 折成 `[]`、`detectLanguage` 四种输入、`finalize` 的语言过滤与 strict 叠加、store 落盘 |
| `test/quality.test.js` | 16 | `normalizeIssn` 各种写法；`journalScore` 对数曲线（IF 1→29 / 3→58 / 5→75 / 8.512→94 / ≥10 封顶）与 h 指数兜底；`citationScore` 年化；`paperQuality` 四档与理由、脏输入；**`quartileOf` Q1–Q4 与 `null` 不判 Q4**；**`citationPercentileScore` 缺信号返回 `null` 而非 0**；百分位优先（同一篇论文前 10% > 前 60%）；缺信号先验不让「没证据」压过「有证据」；**两个信号都没有时 unknown + 0 分**；`fetchJournalMetrics` 批量去重与上游失败；期刊缓存命中/过期/查不了也记一笔；**`resolveIssnsByDoi` 批量反查 ISSN 与上游失败** |
| `test/fulltext.test.js` | 17 | `arxivIdOf` 各种写法；`htmlToText` 段落/脚本/实体；`extractPmcBody` 只取 body 跳过 ref-list；最小 PDF 抽取与非 PDF 安全；`looksLikeProse` 区分 CID 乱码；`condenseText` 保头保尾；`stripLeadingBoilerplate`；`fetchFullText` 四条路线与限定 routes；publisher-pdf 的 `citation_pdf_url` 与 `/pdf` 后缀；订阅制域名快速失败；总预算跨路线共享；**不是 PDF 就换 UA 重试**；**反爬验证页快速放弃** |
| `test/scan.test.js` | 30 | `mapLimit` 顺序/并发峰值/夹取/抛错；`resolvePanelUrl` 三种降级；`effectiveLookbackDays` 6 例（**含 30 天下限**）+ `runScan` 窗口透传/按方向收窄 4 例；`summaryDepth` 默认/三档/非法值/`options` 覆盖 5 例；`fullText` 开关；**`backfillQuality` 6 例**（补缺分的老论文、幂等、用期刊缓存、空库、补 ISSN 后重算、补不到 ISSN 不抹分）；**`ensureIssns` 3 例**（DOI 反查、全部有序号时不发请求、上游抛错安全） |
| `test/select-fresh.test.js` | 8 | 跨源只留高分那条、跨方向、seen 的 DOI/标题键命中、脏候选 |
| `test/paginate.test.js` | 10 | 分页、筛选、非法参数夹取（**含 `null` → 默认 50**）、`/item`、`/mark-all-read`、收藏落盘 |
| `test/config.test.js` | 8 | `~standard` 契约、默认回填、trim、enum、未知字段忽略 |
| `test/stats.test.js` | 11 | `weekStart` 归周一、窗口夹取（含 `null`→90）、补空周、榜单排序、坏/未来时间戳 |
| `test/mail.test.js` | 10 | 无 `<style>` 无 `class=`、卡片边色、字段渲染、HTML 转义、挡 `javascript:`、中英文 |
| `test/index.test.js` | 14 | 路由注册、marker/loopback/content-type 校验、topics/settings/preview/scan、`GET /stats`、`GET /library`、解析深度档位与设置、`POST /scan` 强制窗口、Agent 工具 |
| `test/summarize.test.js` | 8 | 三档字段集、`abstractChars`/`maxTokens` 严格递增、`summaryDepthOptions`、`buildSystemPrompt` 只列当前档、`buildUserMessage` 按档截断、`summarizePaper` 精简档与深度档 |
| `test/library.test.js` | 13 | `yearOf` 只认开头四位、`freshnessOf` 90/365 天边界与未来日期、按年份分架与排序、无日期归「未知」、架内排序三级兜底、summary 计数、行只带精简字段、按方向分架与「未分类」、topicId 过滤、脏数据、空库、每架老论文数/未读数 |
| `test/client-smoke.test.js` | 17 | 极简 React 替身跑首屏渲染、筛选点击、POST `/item`、加载更多、**精读 2 例**、趋势页 2 例、**论文库 2 例**、方向表单语言 3 例、设置页预设/深度/回溯 2 例、英文环境、**质量徽章 + 分区徽章** |

`test/helpers.js` 提供 `tempDir(t)` / `makeCtx()` / `call(ctx,req)` / `seedState(dir,state)`。

### 11.5 真机端到端验证结果

插件已用 `dsh plugin` 真实装进桌面 profile（`link:I:/skill/dsh-research-radar`，并追加进
`dsh.profile.bundles` 末尾），host 已加载：

| 验证 | 结果 |
| --- | --- |
| `GET /api/dsh-research-radar/state`（只带 `x-dsh-research-radar: 1`） | **200**（插件前缀路由不需要 GUI token，`/api` 信任围栏只要求 loopback Host） |
| 首次 state | `topics:[]`、`items:[]`、`page:{total:0,...}`、`counts:{all:0,...}`、`status.storePath=C:\Users\<user>\.dsh\research-radar\state.json` |
| 试检索「金属橡胶」`metal rubber / MR / EMWM` | `ok=true items=4 errors=0`，**4 篇全部是金属橡胶**（strict 生效），全部 openalex，score 13/11/10/10 |
| 建方向 | `id=t-mvhf3hgr` |
| 真实扫描 | **18 秒**、`newCount=4`、`errors=0`、4 篇都有中文结构化摘要（并发前是 30s+） |
| `preview-mail` | `textLen=3770 htmlLen=23520`，HTML 里含带令牌的「在面板中查看」URL → `resolvePanelUrl` 在真实 host 上拿到了 `connection` 服务 |
| Client bundle | `/?token=...` → 200 / 39681 字节；combo `/plugins/??...&rev=d931a893c04b` → 200 / 3984647 字节，含 `filter_items` / `mark-all-read` / `drr-seg` / `buildDeepReadPrompt` / `drr-btn-deep`（host 会随文件 mtime 自动换 rev，改完刷新页面即可，不用重启） |

### 11.6 安装命令（本机已验证可用）

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'G:\DSH\DeepSeek Harness.exe' --expose-internals `
  'G:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js' `
  plugin --profile desktop add "link:I:/skill/dsh-research-radar"
```

- `dsh plugin --profile desktop add/remove/why` 可用；**`--dump-config` 不行**（报 `profile "desktop" is managed exclusively by the Electron application`）。
- 手动 `dsh plugin add` **不会**把包加进 `dsh.profile.bundles`，要自己追加（或用 GUI 的 plugin_manager）。
- profile 备份：`package.json.bak-drr` / `pnpm-lock.yaml.bak-drr` / `cordis.patch.yml.bak-drr`。
- 副作用：pnpm 重装时把 `billion-context` 从 0.1.194 升到了 0.1.202（`Packages: +66 -42`），安装本身成功。

### 11.7 本次踩的坑（新机器特有）

1. **`Get-Content -Raw` + `WriteAllText` 会把中文文件写成乱码**。Windows PowerShell 5.1 的 `Get-Content`
   默认按 ANSI(936) 读，`-Raw` 再写回 UTF-8 就把整份 `HANDOFF.md`（33923 字节）毁成 46998 字节的乱码。
   **恢复办法**（本机没 git 时也能用）：`.git/objects` 里还有 blob，用 `zlib.inflateSync` 手工解出
   `tree` → 找到 blob sha → 解压得到原始字节。脚本思路见本节末尾。
2. **`node --test test/`（只给目录）在 Node 24 会失败**：`Cannot find module 'I:\...\test'`。必须 `test/*.test.js`。
3. **`Number(null) === 0`**：`clampInt` 第一版把缺省的 `limit` 夹成 1，`/state` 只返回一条论文。修法：开头
   `if (value === null || value === undefined || value === '') return fallback`。
4. **`webServer.protocol` 自带冒号**（`"http:"`），拼 URL 时是 `` `${protocol}//127.0.0.1:${port}` ``，
   别再补一个 `//`。
5. **HTML 里的 `&amp;`**：从 `/?token=` 页面正则取 combo href 时要 `.Replace('&amp;','&')`，否则 404。
6. **单包路径一律 404**：`/plugins/@local/dsh-research-radar/client.js` 不存在，只有 combo
   `/plugins/??a/client.js,b/client.js&rev=...` 能下。
7. **`edit` 的 `old_string` 末尾换行**：改 `index.js` 的 import 行时漏掉换行，拼成
   `from './radar/mail.js'import {...}` → `SyntaxError: Unexpected token 'import'`。改 import 区要复查整块。
8. **极简 React 替身的 setState 不会自动重渲染**：`mount()` 必须手动渲染第二次才能看到异步 `refresh()` 的结果。
9. **`buttonByText` 不能用 `includes`**：面板里「标为已读」和「全部标为已读」会误命中，要用整词 + 前后缀容忍。
10. **极简 React 替身的 hook 游标要按组件分帧**：Panel 里嵌 TopicForm 时共用一个游标，
    子组件的 `useState` 会落到 Panel 的槽位上，表单输入全串了（症状：勾了「中文文献」，提交的 `languages` 还是 `[]`）。
    修法：`Map<组件函数, {slots, cursor}>`，`textOf` / `findAll` 展开函数组件时用 `mini.withFrame(type, fn)` 切帧。
11. **DSH 沙箱里 `node --test` 默认隔离会 `spawn EPERM`**（测试运行器用管道 stdio 起子进程，沙箱禁止命名管道）。
    加 `--experimental-test-isolation=none` 即可；换普通终端不用加。

### 11.8 从 `.git/objects` 手工恢复文件（本机没有 git 时）

```js
// tmp-recover.mjs <repoRoot> <path> [outFile]
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import path from 'node:path'

async function readObject(sha) {
  const raw = inflateSync(await readFile(path.join(repo, '.git', 'objects', sha.slice(0, 2), sha.slice(2))))
  const nul = raw.indexOf(0)
  return { type: raw.subarray(0, nul).toString().split(' ')[0], body: raw.subarray(nul + 1) }
}
// 从 refs/heads/main 拿 commit → 取 `tree <sha>` → 逐层 parseTree（mode '40000' 是子树，
// 其余 40 位 hex 是 blob）→ 找到目标路径的 blob sha → readObject 拿 body 原样写出
```

注意：**必须用 `node:fs` 写文件，不要经过 PowerShell 的 stdout 重定向**，否则中文又会被 936 编码毁一次。

### 11.9 下一步（给下一个人）

1. ~~**P2 第 9 条：增量抓取窗口**~~ ✅ 已完成（第七节 P2 第 9 条）。
2. ~~**P2 第 10 条：中文文献**~~ ✅ 已完成（第七节 P2 第 10 条）。
3. ~~**P2 第 11 条：趋势统计**~~ ✅ 已完成（第七节 P2 第 11 条）。
4. ~~**P2 第 12 条：Agent 精读联动**~~ ✅ 已完成（第七节 P2 第 12 条）。
   最终没走槽位，而是给 `ItemCard` 加按钮 + 模块级 `clientContext` + `uiWorkspace.startSession`，
   所以 `client.js` 的 `inject` 仍是 `['slots','locale']`，**没有**加 `conversation`。
5. **让新 Host 代码生效** —— GUI 的 plugin-manager API **无法用脚本调用**（带 cookie 是 404，带 query token 是 401），
   只能用 `dsh plugin --profile desktop add` CLI，或在 GUI 里手动 disable→enable 一次插件 / 重启桌面应用。
   本轮结束时 host 里跑的**仍是旧版 `index.js`**：`GET /stats` 返回 405、`status` 缺 `effectiveLookbackDays`、
   `topics[0].languages` 为空。Client 半边不用重启（host 按文件 mtime 自动换 rev），Host 半边必须重载。

   **⚠️ 实测：重跑 `dsh plugin add` 不会重载已加载的 Host 插件**。本轮又跑了一次
   `dsh plugin --profile desktop add "link:I:/skill/dsh-research-radar"`（它确实改了 profile 的 `package.json`，
   输出 `Done in 946ms`，`Packages: -42` 只是 pnpm 的增量统计，7 个插件与 `@local/dsh-research-radar` 链接都还在，
   `node_modules` 176 个目录、`pnpm-lock.yaml` 正常），但等 4 秒后重探仍然是 `/stats` 405、
   `status` 缺 `effectiveLookbackDays`。原因在 `dsh-hmr` 的 `reconcileProfile()` 返回值：
   `if (pending.length > 0) this.ctx.logger.warn("changed modules keep running their previous code until a restart: %o", pending)`
   —— 已加载模块即使磁盘变了，也只是进 `pending` 等重启，不会热替换。
   （`dsh-base` 里 hmr 的配置是 `disabled: !!js "!ctx.get('profileContext')"` + `config.root: []`，
   桌面 profile 下它是**启用**的，但启用不等于能替换已加载的宿主插件。）

   **验证新代码正确性的替代办法**（不重启也能证明代码对）：在插件目录里直接 `import('./index.js')`，
   用 stub ctx 跑 `apply()`，把真实的 `state.json` 走一遍。本轮实测：
   ```
   route: prefix /api/dsh-research-radar  tools: research_radar
   GET /state        -> 200  items=4  statusKeys=scanning,lastError,storePath,scanIntervalHours,effectiveLookbackDays
                              effectiveLookbackDays = 3   topic languages = [[]]
   GET /stats?days=90-> 200  total=4 weeks=1 bySource=[{key:'openalex',count:4,label:'OpenAlex（SCI 期刊综合库）'}]
                              byTag=[{key:'金属橡胶',count:4},...]
   ```
   → 代码本身没问题，纯粹是运行中的 host 还挂着旧模块。

   - 另一条路：**改 profile 的 `cordis.patch.yml`**。HMR 服务会监听 profile manifest 与两份用户 patch，
     文件一变就重新组合，从而重新 import 已链接包的最新磁盘内容（官方 README 原文：
     「HMR 的 profile 监听和 Plugin Manager 执行的 profile 重新组合，还会替换 profile 目录下已加载文件
     在磁盘上发生变化的插件…文件被原地更改的包，例如构建输出发生变化的已链接包…会在下一次此类重新组合时生效，
     无需重启」）。**但上面的实测已经证明「重新组合」这条路对本插件无效**（重跑 add 就触发了重新组合），
     所以不要指望它；真要走请先跟用户确认，并先备份（`cordis.patch.yml.bak-drr` 已在）。
   - **结论：只能重启桌面应用，或在 GUI 的插件面板里 disable→enable 一次 `dsh-research-radar`。**
6. ~~**缺陷 #9：`ctx.schedule`**~~ ✅ 已查明**不需要改**。`timer` 服务的公开 API 是
   `timeout / interval / throttle / debounce`（`setTimeout / setInterval` 只是 `timeout / interval` 的
   deprecated 别名，`ctx.mixin("timer", [...])` 把六个都挂到 ctx 上）。`schedule` 是另一个独立包
   `@deepseek-ai/dsh-schedule` 提供的**会话提醒**服务（`schedule/catalog`、`schedule/delete`、`schedule/history`
   这些 remote 方法），跟「插件自己每隔 N 分钟看一眼该不该扫描」完全是两回事。现有 `ctx.timer.interval` 就是正解。
7. **可以接着做的新功能**（都不是缺陷）：
   - 精读结论回写：把会话 id 存进 item，卡片显示「已精读」并能跳回会话；
   - 邮件里也放「精读」深链（需要能带 prompt 打开新会话的 URL scheme，尚未勘察）；
   - `semanticscholar` 源（无 key 会 429，需要限流）。
   - ~~按方向单独设解析深度 / 时间范围~~ —— 目前深度与窗口是**全局**的（`settings.scan`）。
     想更省 token 可以往下做「方向级覆盖」，但先把 11.12 的全局版用一阵子看够不够。
   - **论文库的深挖方向**（11.13 只做了第一版）：书架上的行目前只能点开外链、不能展开摘要
     （行是精简过的）；可以给 `.drr-book` 加个点击展开原始 `ItemCard` 的面板；
     也可以加「只看老论文 / 只看未读」的书架内筛选，或者按 `venue` / 作者分架。
   - **书架容量 1000 是拍的**（11.13）。真实用量攒上来之后要看一眼 `state.json` 大小；
     如果超过十几 MB，就改成「把摘要单独存一个 `summaries.json`、`state.json` 只存索引」。
   - **bioRxiv 单源 63.8 秒**（11.14）。它每次拉整个时间窗口的 feed 再本地过滤，是六源里最慢的；
     已经夹到 `Math.min(days, 180)` 但还不够，应该单独加超时 / 本地缓存，或者默认不勾这个源。
   - **Crossref 的 `query.bibliographic` 是全文模糊匹配**（11.14）。改走相关度排序后 `max=8` 能出 8 条，
     但 `total-results=158717` 说明服务端几乎没过滤；如果还想提高质量，可以试
     `query.title` 而不是 `query.bibliographic`（未验证）。
8. ~~**git**~~ ✅ 已补上。本轮从 npmmirror 下了 MinGit 2.56.0 解压到
   `C:\Users\<user>\.dsh\tools\mingit\`，并完成一次本地提交 `71c6c20`（29 文件 / +5064 −212）。
   细节见 11.10。仍然**没有 remote**（用户决策：只做本地提交，不推 GitHub）。

### 11.10 补装 git（MinGit）与首次提交

原本这台机器上没有任何 `git.exe`（见 11.1）。`winget` 虽然存在（`C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\winget.exe`），
但调用直接返回 `exit=-1978335231`（0x8A150001，即 winget 本身没装好/未初始化），走不通。于是改从 npmmirror 直接下便携版：

```powershell
# 1) 列版本（找最新的 vX.Y.Z.windows.N）
#    https://registry.npmmirror.com/-/binary/git-for-windows/
# 2) 下 MinGit（比 PortableGit 小一半，够用：commit / status / log / diff 都有）
#    https://registry.npmmirror.com/-/binary/git-for-windows/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip
#    → 39806486 字节
# 3) 解压到持久位置（沙箱里不能写 C:\Users\<user>\.dsh\tools\，要用 danger-full-access 跑这一步）
#    Expand-Archive -Path mingit.zip -DestinationPath C:\Users\<user>\.dsh\tools\mingit
```

装好之后：

```powershell
$git = 'C:\Users\<user>\.dsh\tools\mingit\cmd\git.exe'
cd I:\skill\dsh-research-radar
& $git config core.autocrlf false   # 关键：不设的话 git 会把 LF 全改写成 CRLF
& $git add -A
& $git commit -F <UTF-8 消息文件>
```

**三个坑**：

1. **`.git` 目录在沙箱里写不进去**。DSH 的工作区授权 ACE 只落在工作区根目录
   （`I:\skill\dsh-research-radar` 上有 `S-1-4-570429532-510903478` 的 `Write/Delete` 允许项），
   `.git` 子目录没有这个 ACE（`radar\` 下也没有，`test\` 和 `tmp-git\` 有，因为它们是后建的、继承了父目录 ACE）。
   表现是 `error: could not lock config file .git/config: Permission denied`、`Set-Content .git\probe.tmp` 被拒。
   解法：`git config` / `add` / `commit` 这几条命令用 **danger-full-access** 跑（本轮就是这么做的），
   或者干脆在普通终端里跑。注意 `Get-Acl .git` 里 `NT AUTHORITY\Authenticated Users Allow Modify` 是
   **继承自 `I:\`** 的，而 `I:\` 那个 ACE 是 `inherited=False` 的普通用户 ACE —— 受限令牌不认它。
2. **`core.autocrlf` 必须先关**。仓库里全是 LF（`.gitattributes` 不存在），Windows 版 git 默认
   `core.autocrlf=true`，`git add` 会警告 `LF will be replaced by CRLF` 并把工作区文件改写，
   于是「只改了几行」的 diff 会变成整文件重写。本轮已 `git config core.autocrlf false`（写进 `.git/config`）。
3. **提交消息走文件不走 `-m`**。中文消息用 `-m` 在 PowerShell 里会被按 ANSI 传参毁掉，
   正确做法：`[System.IO.File]::WriteAllText($f, $msg, (New-Object System.Text.UTF8Encoding($false)))` 然后 `git commit -F $f`。
   提交后校验：`git log -1 --format=%s%n%b` 用 `execFileSync(..., {encoding:'utf8'})` 读回来，
   确认 0 个 U+FFFD 且含中文 —— 本轮验证通过（subject: `feat: 修完 P0/P1 缺陷并补 P2 能力，加 150 个单测`）。
（后来用例数涨到 173，该 subject 是当时那次提交的历史记录，不用改。）

提交结果：`71c6c20`（parent `35fa645`），29 文件、+5064 −212，`git status --porcelain` 干净。
暂存区里没有任何 `tmp-*` / `.gui-index.html` / `.combo.js` / `*.bak` 残留（`.gitignore` 已覆盖）。

> 想把它加进 PATH 就 `$env:PATH = 'C:\Users\<user>\.dsh\tools\mingit\cmd;' + $env:PATH`，
> 但 MinGit 的 `cmd\` 里只有 `git.exe`，`usr\bin\` 才是全套 POSIX 工具，别指望 `bash` / `ssh` 之类。

### 11.11 重启后的真机验收 + 增量窗口改成按方向算

**用户重启桌面应用后，新代码终于生效了**（重启前 host 里一直挂着旧 `index.js`，见 11.9 第 5 条）。
注意端口会变：重启后是 `http://127.0.0.1:55633`（重启前是 `61819`），token 也是每进程新生成的。

验收结果（全部带 header `x-dsh-research-radar: 1`）：

| 检查项 | 结果 |
| --- | --- |
| `GET /state` | 200，`page.total=4`、`counts.unread=4`、`topics=1` |
| `status` 键 | `scanning,lastError,storePath,scanIntervalHours,effectiveLookbackDays` ✅ 新代码 |
| `GET /stats?days=90` | 200（重启前 405），`total=4`、`weeks=1`、`bySource=[openalex:4]` |
| `?limit=2` / `?limit=2&offset=2` | 2 条 `hasMore=true` / 2 条 `hasMore=false` |
| `?filter=starred` / `?filter=unread` | 0 条 / 4 条，`counts` 三键齐全 |
| `?limit=99999` | `page.limit` 夹到 **500** |
| `POST /preview-mail` | 200，`htmlLen=23520`，含 `border-left:3px solid #4176e6`，**无 `<style>`、无 `class=`** |
| 邮件里的面板链接 | `http://127.0.0.1:55633/?token=5eT1i...`（`resolvePanelUrl` 拿到 connection 服务） |
| Client bundle（rev `9b7850eae9ae`） | 3984647 字节，含 `drr-btn-deep` / `deep_read` / `filter_items` / `stats_days` / `drr-seg` / `mark-all-read` / `languages_hint` / `loadStats` |

**验收时发现并修掉的真 bug：增量窗口把「刚建的方向」也算窄了。**
`lastScanAt` 原来只存在 `settings.scan` 上（全局一个），于是新建方向后第一次扫描，
窗口按「全局上次扫描」算成 3 天 —— 用户加了个新方向，却只能看到最近 3 天的论文，老论文永远进不来。
修法：

- `radar/store.js` 的 `normalizeTopic` 新增 `lastScanAt: asString(raw.lastScanAt, '')`。
- `radar/scan.js`：`lookbackFor(topic) = forcedLookback ?? effectiveLookbackDays(topic.lastScanAt, configured)`，
  每个方向各算一份窗口传给 `collectFromSource`；扫完在 `store.mutate` 里把 `lastScanAt` 写回**被扫到的**方向
  （`scannedTopicIds` 里有的才写）。`result.scannedTopics[i].lookbackDays` 记录每个方向实际用的窗口，
  `result.lookbackDays` 取最大值（对外报告用）。
- `radar/scan.js` 顶部先声明 `usedLookbacks`，`selectFresh` 之后再赋 `result.lookbackDays`（因为要等循环跑完）。
- `index.js` 的 `publicState`：`status.effectiveLookbackDays` 改成取所有**启用**方向里最宽的那个；
  `POST /topics` 与 Agent `add_topic` 建方向时显式写 `lastScanAt: ''`。
- `POST /scan` 的 HTTP 响应补上 `lookbackDays`（以前只在 `runScan` 内部有，HTTP 层漏了），
  Agent 的 `scan` 也补了。

**验证方式（不重启也能证明 Host 代码对）**：临时脚本 `import('./index.js')` + stub ctx 跑 `apply()`，
假 `req` 要同时提供 `on(ev, fn)` 和 `Symbol.asyncIterator`（`readBody` 用 `req.on('data'/'end')`，
只给 async iterator 会报 `req.on is not a function`），假 `res` 要给 `setHeader`/`writeHead`/`write`/`end`。
实测输出：`before effectiveLookbackDays = 30`（新方向无历史）→ 扫描后 `lastScanAt` 两个方向都「有」→
`after effectiveLookbackDays = 3`。修完这条之后单测 **152 pass / 0 fail**。

**这个改动需要再重启一次**（Host 代码变了）；Client 不用改，刷新页面即可。

### 11.12 解析深度分档 + 时间范围可选（2026-10-22）

用户提出（原话）：「能不能增加一个时间范围选择，让用户能够选择 1 年或几年内的查阅论文，
推送的论文解析深度也可以选择，这样可以节省一点 token」。

#### 11.12.1 解析深度分档（省 token 的正解）

关键判断：**光改输出上限省不了多少 token**，因为输入侧（摘要正文）才是大头。所以每档同时收窄
「喂进去的摘要长度」和「输出上限」：

| 档位 | 字段 | 摘要喂入 | 输出上限 | 单篇预算 |
| --- | --- | --- | --- | --- |
| `brief` 精简 | 一句话 / 创新点 / 标签 | 1500 字 | 350 tokens | ~1.9k |
| `standard` 标准（默认） | 七字段（无局限） | 4000 字 | 1000 tokens | ~5k |
| `deep` 深度 | 八字段（含局限） | 6000 字 | 1600 tokens | ~7.6k |

- `radar/summarize.js`：`SUMMARY_DEPTHS` / `DEFAULT_SUMMARY_DEPTH` / `DEPTH_SPECS` / `normalizeSummaryDepth()` /
  `summaryDepthSpec()` / `buildSystemPrompt(depth)` / `summaryDepthOptions()`（给面板报每档 `approxTokens`）；
  `normalizeSummary(raw, depth)` 按档位只产出该档字段（缺的填「摘要未提及」）；`summarizePaper(..., depth)`
  把 `summary.depth` 一起写进条目。旧常量 `SYSTEM_PROMPT` / `MAX_ABSTRACT_CHARS` / `MAX_OUTPUT_TOKENS` 已删。
- `radar/store.js`：`defaultSettings().scan.summaryDepth = 'standard'`，`normalize()` 用 `normalizeSummaryDepth` 兜非法值
  （老 `state.json` 没有这个键 → 读出来是 `'standard'`，行为不变）。
- `radar/scan.js`：`options.summaryDepth` 可临时覆盖设置（Agent 一次性精读用），`result.summaryDepth` 在
  「有没有新论文」之前就赋值，所以空扫也能报告档位。
- 面板设置页：「解析深度」三段 seg，按钮上直接显示 `精简 · 1.9k` / `标准 · 5k` / `深度 · 7.6k`；
  关掉「生成结构化摘要」时整块隐藏（不摘要就没有深度可选）。
- **只影响新扫描的论文**，已有摘要不重算 —— 否则切一次档位就把历史全重烧一遍。

#### 11.12.2 时间范围可选 + 回溯检索

- `lookbackDays` 上限从 365 放宽到 **3650**（10 年）：`effectiveLookbackDays()` 的夹取、`POST /settings` 的夹取同步改。
- 面板设置页：数字框（1–3650）+「常用范围」预设 seg（半年 / 1 年 / 2 年 / 3 年）+ 说明文字。
- **回溯检索**按钮：调 `runScan({backfill:true, lookbackDays: scanDraft.lookbackDays})` →
  `POST /scan` 带 `lookbackDays` → `doScan` 里 `forcedLookback` 直接压过增量窗口，用整个窗口扫一次。
  这是必须的：日常扫描是增量的（只往回看「距上次扫描天数 + 2 天」），光把窗口调大不会把老论文捞回来。
  回溯完 `lastScanAt` 照常前移，下一次自动回到增量模式，不会每轮都烧配额。
- Agent 工具同步：`research_radar` 的 `scan` 支持 `lookbackDays` 与 `summaryDepth` 两个参数，
  可以直接说「回溯最近三年，用精简档」。

**回溯必须配「按年份摊开配额」，否则时间范围形同虚设**（本轮真机实测发现并修掉）：

- 现象：`preview` 传 `lookbackDays: 30` 和 `lookbackDays: 1095` 返回的 8 条**完全一样**，
  全是最新几天（2026-10-16 ~ 10-20）。原因是 OpenAlex 只按 `publication_date:desc` 取
  `per-page = max*4 = 32` 条，热点方向三年内有 18993 条命中，前 32 条自然全被最近几天占满，
  本地 `finalize` 再按「相关度 + 日期」截 8 条，还是那 8 条。
- 修法两层（`radar/sources.js`）：
  1. **宽窗口双路取样**：`lookbackDays > WIDE_WINDOW_DAYS(=90)` 时再发一次
     `sort=cited_by_count:desc`，两路结果按 OpenAlex work id 合并去重 ——
     既有「最新的」，也有「窗口内绕不开的高被引经典」。
  2. **`spreadByYear(items, max)`**：`finalize` 新增第 5 个参数 `spread`，为 true 时按年份分桶、
     年份从新到旧轮转取（同一年内按 相关度 → 被引 → 日期 排序），保证窗口内每年都有代表。
     `collectFromSource` 新增 `spread` 透传，`scan.js` 里按实际窗口 `shouldSpread(topicLookback)` 决定。
- 实测效果（`perovskite solar cell`，max=8）：
  - `days=30 spread=false` → 8 条全 2026 年；
  - `days=1095 spread=false` → 8 条仍全 2026 年（bug 复现）；
  - `days=1095 spread=true` → `{2023:2, 2024:2, 2025:2, 2026:2}`，被引 1398 / 1096 / 793 / 761 的经典都进来了。
- 为什么只在宽窗口开：日常增量扫描窗口只有 3 天，摊开没有意义，还会多一次请求。
  判断依据是**实际窗口**（`shouldSpread(topicLookback)`）而不是「是不是回溯」——
  新方向首次扫描用的是完整配置窗口，用户把窗口设成 3 年时同样需要摊开。
  `POST /preview`（试检索）在窗口 > 90 天时同样摊开（`shouldSpread(lookbackDays)`），
  否则「试检索」看到的和「回溯检索」看到的不是同一批论文，用户没法拿它判断方向配得对不对。
- 实测「新方向 + 配置窗口 1095 天 + 不点回溯」也得到 `{2023:2,2024:2,2025:2,2026:2}`。

#### 11.12.3 测试与验证

- 新增 `test/summarize.test.js`（8 例）：三档字段集、`abstractChars`/`maxTokens` 严格递增、
  `approxTokens = abstractChars + maxTokens`、system prompt 只列当前档字段、user 消息按档截断、
  `summarizePaper` 精简档真的只发 350 tokens、深度档缺字段填「摘要未提及」、不传深度用默认档。
- `test/store.test.js` / `test/store-file.test.js`：默认 `summaryDepth='standard'`、老 `state.json` 补齐、
  `'ultra'` 归一成 `'standard'`。
- `test/scan.test.js`（19 例）：`result.summaryDepth` 默认 / brief / deep / 非法退回 / `options` 覆盖。
- `test/index.test.js`（13 例）：`/state` 暴露 `summaryDepths`、`POST /settings` 改深度生效、
  `POST /scan {lookbackDays:365}` 真的用 365 天窗口。
- `test/client-smoke.test.js`（15 例）：点「1 年」→ `POST /settings` 的 `scan.lookbackDays===365`；
  点「精简 · 1.9k」→ `scan.summaryDepth==='brief'`；点「2 年」+「回溯检索」→ `POST /scan` 的 `body.lookbackDays===730`，
  且结果提示里带「本次窗口 730 天 · 解析深度 标准」。
- `test/finalize.test.js`（17 例，新增 6 例）：`spreadByYear` 每年都有代表、年份内按 相关度→被引→日期 排序、
  条数够用时原样返回、脏数据安全、`finalize(..., spread=true)` 能把 2023 年的老论文带出来而 `spread=false` 不能、
  `shouldSpread` 的 90 天边界与脏值。
- 合计 **193 个用例，全绿**（`node --test --experimental-test-isolation=none test/*.test.js`，约 1s）。

**面板上的即时反馈**：`runScan` 成功后的提示条会追加「（本次窗口 N 天 · 解析深度 标准）」。
必须有这个 —— 日常扫描是增量的，窗口会被收窄成 3 天，用户看到「0 篇新论文」时不然会以为插件坏了。

#### 11.12.4 本次踩的坑

1. **`abstract: 'x'.repeat(9000)` 让「deep 档不该截断」的断言假失败** —— deep 的 `abstractChars` 是 6000，
   9000 字也会被截。测试数据改成 5000 字。
2. **Client bundle 已经是新的、Host 还是旧的**。这轮改完 `client.js` 后，从 combo 里能 grep 到
   `backfill` / `summary_depth` / `depth_brief`（host 按 mtime 自动换 rev，刷新页面就生效）；
   但 `/state` 返回的 `summaryDepths` 是空的、`settings.scan.summaryDepth` 也是空 ——
   说明 **Host 侧改动仍然要重启桌面应用**才生效（和 11.11 同一个坑，不是代码问题）。
3. 面板上新加的 `drr-presets` 是 flex 行（左侧 56px 标签 + 右侧 seg），窄屏要 `flex-wrap:wrap`，
   否则「回溯检索」按钮会被挤出容器。

### 11.13 论文库（书架）——回答「我到底检索到了哪些、哪些是老论文」（2026-10-22）

**用户诉求（m03695 原话）**：「应该整一个论文库，这样我才知道你检索到了哪些，哪些是老的论文，
这个论文库可以罗列检索过的论文，或者做成类似书架的形式，分类存放好。这个修改需要在1个小时内搞定」

**为什么需要它**：回溯检索（11.12）把窗口拉到 3 年后，2023/2024 的老论文会混进「最新论文」流水里，
按发现时间倒序排的话它们只是「刚被发现的旧货」，看不出哪些是补回来的老论文、也不知道库里到底有多少。

**和「最新论文」的分工**：
- 最新论文 = 按**发现时间**倒序的流水，只回答「这轮扫到了什么」；
- 论文库   = 按**发表年份**归架的全量书架，回答「我手上到底有哪些、哪些是老论文」。

#### 11.13.1 Host 侧（`radar/library.js`，156 行）

```js
export function yearOf(publishedAt)                    // '2024-05-01' → '2024'，取不到返回 ''
export function freshnessOf(item, now = Date.now())    // 'new' | 'recent' | 'old' | 'unknown'
export function buildLibrary(items, options = {})      // → { groupBy, topicId, total, groups, summary }
```

- **新鲜度**：90 天内 = `new`、≤365 天 = `recent`、>365 天 = `old`、没日期 = `unknown`。
  **未来日期也算 `new`** —— 在线优先发表的论文常带未来日期，不能因为差值为负就判成老论文。
- **分架**：`groupBy='year'`（默认）按发表年份，新到旧，「未知」排最后；
  `groupBy='topic'` 按方向，篇数从多到少，没方向的归「未分类」。
- **架内排序**：`publishedAt` 降序 → `citations` 降序 → `discoveredAt` 降序（三级兜底保证顺序稳定）。
- **行只带精简字段**：`{id,title,authors(前3),authorCount,venue,publishedAt,source,topicId,topicName,
  url,doi,citations,read,starred,hasSummary,summaryDepth,discoveredAt,ageDays,freshness}` ——
  **不带 `abstract` 和 `summary`**，1000 篇也不会撑爆一次响应。
- **`summary` 汇总**：`{oldestYear,newestYear,oldCount,newCount,unreadCount,starredCount,summarizedCount}`，
  面板顶部 6 张数字卡直接用它。
- 端点：`GET /library?groupBy=year|topic&topicId=`（在 `GET /stats` 之后注册，同样走 loopback + marker 校验）。
- **书架容量**：`radar/scan.js` 的 `MAX_ITEMS_KEPT` 从 500 提到 **1000**。原来的 500 是「滚动窗口」语义，
  回溯捞回来的老论文很容易被后续扫描挤掉；改成书架后必须留得住。实测每篇约 4KB（含结构化摘要），
  1000 篇约 4MB，`state.json` 单文件读写仍然很快。

#### 11.13.2 Client 侧（第五个页签「论文库」）

- `loadLibrary()` 用 `React.useCallback` 包一层，`useEffect` 只在 `tab === 'library'` 时才拉
  —— 和趋势页一样，不打开就不发请求，首屏不多一次往返。
- 顶部：`按年份 / 按方向` seg 切换 + 方向下拉（`topics.length > 1` 才出现）。
- 6 张数字卡：库内论文 / 覆盖年份（`2023–2026`，只有一年时显示单年）/ 老论文 / 未读 / 收藏 / 已摘要。
- 书架：`.drr-shelf`（左侧 3px 强调色边）→ 架头（年份 + `N 篇` + `老论文 N` 角标）→ `.drr-book` 行
  （新/老角标 + 标题链接 + 期刊·日期·引用数）；已读的行标题透明度降到 0.6。
- 点标题顺手 `patchItem(row, {read: true})`（本地乐观更新 + 失败回滚），和卡片上的「标为已读」同一条路。
- 空库文案明确指路：「先跑一次扫描；想看更早的论文，把时间范围调大后点『回溯检索』」。

#### 11.13.3 验证

- 新增 `test/library.test.js`（**13 例**）：`yearOf` 只认开头四位、`freshnessOf` 的 90/365 天边界与未来日期、
  按年份分架与排序、无日期归「未知」、架内三级排序、summary 计数、行只带精简字段、按方向分架与「未分类」、
  topicId 过滤、脏数据（`null` / `1` / `'x'` / 没 id）、空库、每架老论文数与未读数。
- `test/index.test.js` 新增 1 例（共 14）：「GET /library 返回按年份分架的论文库」——
  断言 `groups` 键序 `['2026','2023']`、`summary.oldestYear='2023'`、架上行 `abstract`/`summary` 都是 `undefined`
  但 `hasSummary=true`、`groupBy=topic` 时 `label` 是中文方向名、`topicId=t-zzz` 返回空。
- `test/client-smoke.test.js` 新增 2 例（共 17）：论文库页按年份分架渲染（数字卡、两架、引文数、`.drr-shelf` 两个、
  old 角标存在）、切「按方向」会重新拉带 `groupBy=topic` 的请求 + 空库提示。
- 全量：`node --test --experimental-test-isolation=none test/*.test.js` → **196 pass / 0 fail / ~1.1s**。
- 真实 `state.json`（11 篇）实测：`oldestYear=2023`、`newestYear=2026`、`oldCount=6`、`newCount=5`；
  架分布 `2026:5` / `2025:2` / `2024:2` / `2023:2`；`groupBy=topic` → `金属橡胶(11)`。

#### 11.13.4 本次踩的坑

1. **`MAX_ITEMS_KEPT` 的语义变了**。500 是「滚动窗口」时定的数，现在它是「书架容量」——
   随手改大前先想清楚：这个值决定回溯捞回来的老论文能留多久，不是性能参数。
2. **行必须精简**。真实 `state.json` 11 篇就有 44KB（约 4KB/篇，主要是 `abstract` + `summary`）；
   1000 篇会到 4MB，面板每次切页签都要传一遍。所以 `compactItem()` 只挑 19 个字段
   （`hasSummary` / `summaryDepth` / `ageDays` / `freshness` 代替原始 `summary`），单行约 300B。
3. **未来日期**。`freshnessOf` 一开始用 `Math.floor((now - at) / 86400000)` 直接比阈值，
   在线优先发表（日期在未来）会算出负数 → 落进 `recent`。补了 `if (days < 0) return 'new'`。


### 11.14 「检索得太少」——三个假阴性与一处窗口设置（2026-10-23）

用户反馈（m03986）：「感觉检索得太少了，这个检索条件是不是太严格」。查下来**不是 strict 太严**，
而是三条独立的漏检路径，每条都单独造成大量假阴性。

#### 11.14.1 诊断数据（全部实测，方向「金属橡胶」keywords=`['metal rubber','MR','EMWM']`）

| 探针 | 结果 |
| --- | --- |
| 逐源直抓（`max:30`，窗口 365 天） | openalex **30** / crossref **0** / pubmed **0** / arxiv **0** / biorxiv **0**（且 biorxiv 耗时 **63.8 秒**） |
| 日常窗口实际命中（openalex） | 3 天 → **0** 条、7 天 → **0** 条、14 天 → **0** 条、30 天 → **4** 条 |
| strict 前后对比（openalex，窗口 90 天） | strict **14** / 非 strict **20** |
| strict 前后对比（窗口 365 天） | strict **40** / 非 strict **50** |
| OpenAlex 服务端真实命中量 | `"metal rubber"` 一年 **63**、五年 **297**；`金属橡胶` 一年 **2**；`"EMWM"` 五年 **39**；`"MR"` 五年 **152654**（不可用） |
| OpenAlex 返回的 50 条候选 | 字面匹配 `metal rubber` **31** 条；归一化连字符后**新增 13 条（26%）**；50 条里 **28 条（56%）无摘要** |
| Crossref 取回 80 条（`sort=published`） | 标题真含 metal rubber **0** 条 |
| Crossref 取回 80 条（默认相关度排序） | 标题真含 metal rubber **34** 条；`rows=200` 时 **69** 条 |

#### 11.14.2 三个修复

1. **连字符变体折叠**（`radar/sources.js`）。新增私有 `foldText(value)`：
   `String(value ?? '').toLowerCase().replace(/[\u2010-\u2015\u2212_/-]+/g, ' ').replace(/\s+/g, ' ').trim()`，
   把 hyphen / en dash / em dash / minus / 下划线 / 斜杠统一折成空格。`includesPhrase()` 改成
   `const needle = foldText(phrase); return haystack.includes(needle)`；`scoreItem()` 的四个 haystack
   （标题 / 摘要 / 期刊 / 作者）都先 `foldText` 一次（**每篇只折一次**，否则 6000 字摘要会按关键词数重复折叠）；
   `isExcluded()` 同样走折叠。
   - 收益：窗口 90 天 strict **14 → 19** 条；365 天 **40 → 50** 条。
   - 为什么重要：56% 的条目没有摘要，只能靠标题匹配，而标题里 `metal-rubber` / `metal–rubber` 很常见。
2. **Crossref 改走相关度排序**（`fetchCrossref`）。删掉 `sort=published` + `order=desc`，
   `rows` 从 `min(100, max*8)` 起步。`query.bibliographic` 是全文模糊匹配（`total-results=158717`，
   加引号也无效），按日期倒序取前 80 条**全是最新发表的无关文章**，本地 strict 过滤后剩 0 条。
   时间范围仍由 `from-pub-date` / `until-pub-date` 保证。
   - 收益：crossref **0 → 8** 条（`max=8`）。
3. **增量窗口下限 2 → 30 天**（`radar/scan.js` 的 `MIN_LOOKBACK_DAYS`）。这是最隐蔽的一条：
   窗口按**出版日期**过滤，而论文从发表到被 OpenAlex / Crossref 收录常有几天到几周的延迟。
   窗口只有 2–3 天时，「出版日期在 5 天前、今天才进索引」的论文**永远够不到，会被永久漏掉**。
   放宽到 30 天**不增加请求数**（每页条数由 `maxPerTopic` 决定，与窗口无关），重复抓到的靠 `seen` 去重丢掉。

#### 11.14.3 配套调整：配额默认值 8 → 15，上限 30 → 50

| 位置 | 改动 |
| --- | --- |
| `radar/store.js:16` | 新增 `export const DEFAULT_MAX_PER_TOPIC = 15` |
| `radar/store.js:24` | `defaultSettings().scan.maxPerTopic` **8 → 15** |
| `radar/store.js:70-76` | 新增 `LEGACY_MAX_PER_TOPIC = 8` + `migrateMaxPerTopic()`：**老 state.json 里存着显式 8 的迁移成 15**，其它值一律尊重 |
| `radar/store.js:267` | `normalize()` 走 `migrateMaxPerTopic()`（夹取 1–50） |
| `index.js:407` | `POST /settings` 夹取 `Math.min(30, …)` → `Math.min(50, …)` |
| `client.js:1724` | 输入框 `max: 30` → `max: 50` |

依据：`maxPerTopic=8` 跨源去重后只有 **16–18** 篇独立论文；`15` → **26** 篇；`30` → **42** 篇
（各源 openalex 30 / crossref 27 / pubmed 2）。

⚠️ **必须做迁移的原因**：只改 `defaultSettings` 对老用户**无效** —— 他们的 `state.json` 里已经
显式存了 `maxPerTopic: 8`，`normalize()` 读出来就是 8，默认值根本不参与。实测用户机器上
`GET /state` 返回的 `settings.scan.maxPerTopic` 一直是 8，直到加了 `migrateMaxPerTopic`。
**以后凡是改默认值，都要问一句「老 state 里是不是已经存了旧值」。**

#### 11.14.4 修复后的端到端实测

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 日常扫描（上次扫描 0–48 小时前，窗口 30 天） | 窗口被收窄到 **3 天 → 0 条** | 稳定 **30 天 → 4 条** |
| `maxPerTopic=15` 跨源去重 | 16 篇（crossref 0） | **26 篇**（crossref 15） |
| 首次扫描（窗口 365 天） | — | **25 篇入库**（2025:5 / 2026:20），seen 键 75 个，6.8 秒 |
| 紧接着再扫一次 | — | 窗口自动收窄到 **31 天**，0 条新论文（去重正常），4.5 秒 |

#### 11.14.5 测试

- `test/finalize.test.js` 新增 4 例（**17 → 21 例**）：标题四种连字符写法（`metal-rubber` / `Metal–Rubber` /
  `metal_rubber` / `Metal / Rubber`）全部命中；摘要里的变体同样命中且 `matchedIn` 写 `摘要:metal rubber`；
  折叠不会放过 `MR Imaging of the Knee`；排除词也走折叠。
- `test/scan.test.js` 因 `MIN_LOOKBACK_DAYS` 2→30 改了 5 处期望值（「刚扫过 1 小时」现在也是 30 天下限；
  「隔 10 天 + 配置 365」→ 40 天）。
- `test/store.test.js:76` `maxPerTopic` 期望 8 → 15。
- `test/store-file.test.js` 新增 3 例（**8 → 11 例**）：老默认值 8 迁成 15；手动设的 3/20/40/50
  一律尊重不被覆盖；缺省 / 脏值 / 超上限都夹到合法范围。
- 合计 **196 个用例，全绿**（`node --test --experimental-test-isolation=none test/*.test.js`）。

#### 11.14.6 本次踩的坑

1. **「检索太少」的第一反应是放宽 strict，但 strict 只占 26%**。窗口 365 天时 strict 丢的是 50→40，
   真正的杀手是 Crossref 全丢（80 条里 0 条相关）和窗口只有 3 天（0 条）。**先量再改**。
2. **bioRxiv 单源 63.8 秒**。它每次拉整个时间窗口的 feed 再本地过滤，窗口调大时会更慢。
   当前 `fetchBiorxiv` 已把窗口夹到 `Math.min(days, 180)`，但 63 秒仍然过分 —— 下次要给它单独加超时或缓存。
3. **`newCount` 不在 `runScan` 的 result 上**。result 只有 `newItems`，`newCount` 是 `index.js` 里
   `result.newItems.length` 现算的。写调试脚本时直接读 `r.newCount` 会得到 `undefined`（被 JSON.stringify 吞掉）。

### 11.15 质量分 + 全文精读 + 面板更直接（2026-10-27）

用户反馈（m04426）：「不用太依赖摘要进行文章理解，应该可以根据论文得分区、影响因子等元素判断文章
是否具有较高的质量，如果可以获得文章的全文，则应该根据文章的全文进行阅读理解与总结。另外，UI 设计
应该更加直接一点，让用户能够更加容易理解。」

三件事分别对应下面三节。

#### 11.15.1 质量分（`radar/quality.js`，364 行）

数据源只有 OpenAlex 一家够用：`sources` 接口的 `summary_stats` 里有 `2yr_mean_citedness`（与 JCR
影响因子同源）、`h_index`、`i10_index`。

**实测契约**（2026-10-27）：

| 探针 | 结果 |
| --- | --- |
| `sources?filter=display_name.search:Thin-Walled Structures` | `{"id":"S205118121","stats":{"2yr_mean_citedness":8.512673112098248,"h_index":154,"i10_index":7765},"works":12375,"type":"journal"}` |
| 批量 `filter=issn:0263-8231\|0997-7538\|0013-7944\|0267-7261` | 200，4 条全中（`issn_l:` 同样可用） |
| `works` 接口的 `primary_location.source` | **不含 `summary_stats`**（只有 display_name / issn_l / is_oa / is_core 等）→ 必须单独查 `sources` 并缓存 |
| `filter=doi:10.x\|10.y` | **400** `"It looks like you're trying to do an OR query between filters and it's not supported... Problem value: 10.1016/...\|doi:10.1016/..."`；正确写法 `doi:<a>\|doi:<b>` |
| `issn_l` 精确匹配的必要性 | `9999-9999` 会被 OpenAlex 模糊匹配到 `Space Resolver 16`（IF 0 / h1）→ 必须按 `issn_l` 相等过滤 |

**打分公式**（`paperQuality()`）：期刊 **70%** + 年化被引 **30%**，开放获取再 **+4**。

- 期刊分用**对数曲线**：`Math.min(100, Math.round((Math.log10(1 + min(IF, 30)) / Math.log10(11)) * 100))`。
  实测 IF 0.5 → 17、1 → 29、2 → 46、3 → 58、5 → 75、8.5 → 94、≥10 → 100。
  **为什么不用线性**：线性（`IF / 20 * 100`）把 IF 5 判成 25 分、IF 8.5 判成 42 分，工程领域主流好刊
  全被打成「低质量」，用户会觉得这个分没用。对数曲线让「IF 3 以上」就进入 58 分以上，符合直觉。
  没有 IF 时用 h 指数兜底，**封顶 60**（不能和真影响因子平起平坐）。
- 被引按**年化**算（`citations / max(years, 0.25)`），年化 20 次 = 100 分。新论文被引天然少，
  不年化会让「刚发表的顶刊论文」永远拿低分。
- 档位：`score >= 60 → high`、`>= 35 → medium`、否则 `low`；**期刊与被引都拿不到时是 `unknown`**，
  不是 `low` —— 没见过不等于差。
- `reasons` 是给人看的中文短语（`期刊影响因子 8.5` / `被引 30 次` / `开放获取（可抓全文）` /
  `核心期刊` / `未识别到期刊` / `期刊指标未收录`），面板点徽章就展开这些。

**分区（Q1–Q4）与百分位优先（2026-10-27 补）**

用户原话是「根据论文得**分区**、影响因子等元素判断质量」—— 分区是单独一项，不能只用 IF 代替。

- 数据源：OpenAlex `works` 的 `cited_by_percentile_year`，是**同年同领域**的被引百分位
  （实测 `10.1016/j.ymssp.2026.1` 返回 `{min:90,max:96}`）。这比 JCR 分区更公平：JCR 只按期刊算，
  同一本刊里每篇论文分区相同；这个是按**这篇论文**在领域里的实际排位算的，跨学科可比。
- `quartileOf(percentile)`：`>=75 → Q1`、`>=50 → Q2`、`>=25 → Q3`、否则 `Q4`；**拿不到百分位返回 `null`
  而不是 Q4**。取区间**上限** `max` 判档（min 90 / max 96 算「前 4%」）。
- 打分时**百分位优先**：有百分位就用 `citationPercentileScore(percentile) = clamp(percentile)`，
  没有才退回年化被引。理由：工程类被引 10 次可能已是领域前 5%，生物类被引 10 次只是中游，
  原始被引数跨学科不可比，年化只缓解了「老论文占便宜」，没解决学科间不可比。百分位两个问题一起解决。
- 面板上分区是**独立徽章**（`drr-chip-quartile`，Q1 绿 / Q2 灰底 / Q3Q4 灰字），不折进分数，
  因为用户要看的是「几区」。卡片 `title` 解释口径。

**五处打分 bug（都是「没数据」被当成「数据是 0」）**

三个函数都栽在同一个 JS 陷阱上：`Number(null) === 0`、`Number('') === 0`、`Number(undefined) === NaN`。

1. `quartileOf(null)` → `0 >= 25` 不成立 → **Q4**，等于把每篇新论文都标成末档。→ 开头先挡 `null/undefined/''`。
2. `citationPercentileScore(null)` → **0 分**（「被引排最后」），把没算过百分位的论文判死。→ 同上。
3. 缺失信号按 0 分计入权重：没有期刊指标时 `jScore = 0`，70% 权重的 0 分把「被引前 10%」的论文
   压成 **27 分 low**。→ 缺失信号改填**中性先验 50**（`NEUTRAL_JOURNAL` / `NEUTRAL_CITATION`）。
4. 但只填中性先验会反过来让「缺谁就把权重全给另一个」消失掉一半问题：修复后「顶刊 + 刚发表、
   还没算百分位」拿 **81 分**，「顶刊 + 被引前 45%」拿 **82 分** —— 「没证据」不再高于「中等证据」，
   这是**对的**。而修复前前者是 100 分、后者 82 分。
5. 两个信号**都没有**时仍然算出一个 50 分（还叠 OA 的 +4 = 54），面板显示「待评估 · 50」，
   看起来像篇中等质量的论文。→ `tier === 'unknown'` 时**把 score 归 0**，面板不露数字（只显示「待评估」）。

实测校准（5 组）：顶刊 IF8.5 + 前 92% + 被引 30 + OA → **97 分 high Q1**；好刊 IF5.7 + 被引 0 + OA →
**59 分 medium**；一般 IF2.6 + 前 40% → **47 分 medium Q3**；低 IF0.6 + 被引 5 → **17 分 low**；
无期刊 + 前 0% → 35 分 medium Q4（中性期刊先验 50×0.7 撑起来的，可接受）。

**实测校准**（4 组）：顶刊 IF8.5 被引30 OA → **97 分 high**；好刊 IF5.7 被引0 OA → **59 分 medium**；
一般 IF2.6 被引6 OA → **47 分 medium**；低 IF0.6 被引5 → **17 分 low**。

**期刊缓存**（`createJournalCache({dir})`）：文件 `journals.json`，形如
`{version:1, entries:{issn:{name,twoYearMeanCitedness,hIndex,...,fetchedAt}}}`；只拉缺失或超 30 天的，
**查不到的也写 `{missing:true, fetchedAt}`** —— 否则每轮扫描都会重试那批冷门期刊。
必须预热：`runScan` 里先 `await journalCache.ensure(fresh.map(i => i.issn), settings.api)` 再
`asMap()`，因为索引里只有老论文，靠它预热不到本次新抓到的期刊。

#### 11.15.2 全文精读（`radar/fulltext.js`，598 行）

**四条路线**，按「拿到全文的概率 × 速度」排序：

| 路线 | 做法 | 实测 |
| --- | --- | --- |
| `arxiv` | `https://arxiv.org/html/<id>` | 200 / 187989B / **1.7s**，抽出 **38355 字** |
| `europepmc` | `search?query=DOI:"<doi>"` 取 `pmcid` → `/<pmcid>/fullTextXML` | 102890B / 1.8s，抽出 **28386 字** |
| `oa-pdf` | OpenAlex `best_oa_location.pdf_url` | 378887B / 9.7s，抽出 **27596 字** |
| `publisher-pdf` | DOI 落地页的 `citation_pdf_url`，或已知域名直接拼 `/pdf` | 覆盖率最高，实测救回一批 OpenAlex 没标 pdf_url 的论文 |

**踩过的坑**：

1. **arXiv 必须按 `</article>` 截断**。正文在 `<article>` 内（起始偏移 20186），`</article>` 在 180059，
   之后是 `<footer class="arxiv-html-footer">` 版权与 Accessibility 垃圾。
2. **Europe PMC 的 UA**。用 `dsh-research-radar/1.0` 会 `TypeError: fetch failed`，必须
   `Mozilla/5.0 dsh-research-radar/1.0` 或走 `getText` 的 UA。
3. **PDF 抽文本不能只捞 `(...)`**。第一版把 content stream 里所有字面量串起来，MDPI 的 PDF 抽出
   **5,134,343 字**且 `looksLikeProse=false` —— PDF 里单词间的空格常常不是字符，而是 `TJ` 数组里的
   **字距偏移**（`[(Word)-280(another)] TJ`）。修法：遇到 `TJ` 数组时按数值补空格（`<= -100` 补空格，
   `<= -1000` 补两个），并且只处理含 `\bT[Jj]\b` 的 stream chunk。
4. **`</p><p>` 会变成 `\n Second`**（带前导空格），断言 `First paragraph.\nSecond paragraph.` 失败。
   `htmlToText` 里要 `.replace(/ *\n */g, '\n')`。
5. **正文里残留命名实体**（`&middot;`）会污染可读性检查，要补一条
   `/&[a-zA-Z][a-zA-Z0-9]{1,10};/g` 清掉。
6. **订阅制出版社要快速失败**。Elsevier 的 `linkinghub.elsevier.com` 对 `10.1016/*` 返回 **200 但只有壳页**，
   正文要登录 —— 这是「DOI 标了 OA 但实际下不到」的典型。`CLOSED_HOSTS` 里列了
   Elsevier / ScienceDirect / IEEE / ACM / ACS / T&F / ASCE / ASME，命中就直接返回 null，
   不再白等一次必然失败的下载。
7. **doi.org 在本机偶发连不上**：同一 DOI 第一次 `fetch failed`（5ms 就失败），隔 1.2 秒重试就通。
   `resolveDoiLanding` 加了「失败重试一次」。
8. **总预算要跨路线共享**。原来每条路线各自 `timeoutMs: 25000`，最坏情况 4 条路线 = 100 秒。
   现在 `fetchFullText` 算一个 `deadline`，每条路线拿 `remaining`，**剩不到 2 秒就放弃**。

**截断策略**（`condenseText`）：**保头 55% + 保尾 45%**，中间插
`\n\n……（正文中段已省略 N 字）……\n\n`。保尾是因为结论、局限都在文末。按档位截断：
精简 4000 字 / 标准 12000 字 / 深度 20000 字（`DEPTH_SPECS.fullTextChars`）。

**摘要 prompt 的分支**（`buildSystemPrompt(depth, hasFullText)`）：有全文时开头写明「你拿到的是论文
**正文**（可能截断过中段）」，并要求「方法 / 实验 / 数据必须来自正文；中段被省略时不要假设，关键信息
缺失写『正文未提及』」。摘要结果写 `summary.basis = 'fulltext' | 'abstract'`，有全文时还写
`fullTextSource` / `fullTextUrl` / `fullTextChars`。

**实测成功率**（「金属橡胶」10 篇候选，真实网络）：加 `publisher-pdf` 之前 **1/10**，之后 **3–4/10**，
平均每篇 12.5 秒。用户库 33 篇里 14 篇标了开放获取（**42%**），这是全文获取率的上限参考。
拿不到的（Elsevier / 中文期刊 / 没 DOI）自动回退摘要，**不算错误**。

**开关**：`settings.scan.fullText`（默认 `true`），面板设置页有「能拿到全文时按全文总结（更准，但慢一些）」
复选框。关掉能明显加快扫描。

#### 11.15.3 面板更直接

用户说「UI 设计应该更加直接一点」，具体改了四处：

1. **标题回到第一行**。原来 `topRow`（质量分 + 影响因子 + 被引 + 全文 + OA + 星标 + 日期，最多 7 个徽章）
   压在标题上面，用户在列表里找的明明是标题，却要先扫一排小字。现在拆成
   `titleRow`（未读点 + 标题 + 收藏星）+ `qualityRow`（质量分 + 影响因子 + 被引 + 全文/仅摘要 + OA + 日期）。
2. **质量分可点开看「凭什么」**。徽章从 `<span>` 改成 `<button>`（`.drr-q-btn`），点一下展开
   `依据: 期刊影响因子 8.5 · 被引前 8%（Q1） · 被引 7 次 · 开放获取（可抓全文）`（`.drr-why`）。
   默认收起，不占版面。
3. **分区独立成徽章**（`.drr-chip-quartile`）。用户明确要看「几区」，所以 `Q1` 不折进质量分，
   单独显示在质量分右边：Q1 绿底、Q2 灰底、Q3/Q4 只灰字（视觉上从「值得读」往后递减）。
   **没有百分位就不显示分区** —— 宁可空着，也不硬塞一个 Q4 把新论文打成末档。
4. **顶部状态条**（`.drr-strip`）。把「上次扫描 / 本次窗口 N 天 / 新增 N / 已读全文 N / 高质量 N」
   从设置页搬到论文列表顶上 —— 这些是每次打开面板最想先知道的事，藏在设置里等于没有。
   左边一个小圆点：绿=空闲、琥珀+呼吸动画=正在扫描。右边是档位图例
   `高质量 ≥60 · 中等 ≥35 · 较低 <35`，用户不用记刻度。
5. **六段细节默认收起**（沿用 11.15 之前的改动）。卡片先给「标题 + 一句话结论 + 质量」，
   想看再点「展开细节」。

#### 11.15.4 测试

| 文件 | 用例数 | 新增内容 |
| --- | --- | --- |
| `test/quality.test.js` | 16 | normalizeIssn / 对数曲线边界 / 年化被引 / 四档判定 / 脏输入 / 批量查 ISSN / 上游失败 / 期刊缓存命中与过期 / **Q1–Q4 分区与 `null` 不判 Q4** / **缺信号返回 `null` 而非 0** / **百分位优先跨学科可比** / **缺信号先验不许「没证据」压过「有证据」** / **两信号都没有时 unknown + 0 分** / **DOI 批量反查 ISSN（去重 + OR 只写一次字段前缀）** / **反查失败返回空对象** |
| `test/fulltext.test.js` | 17 | arXiv 编号识别 / HTML 转文本 / PMC body 抽取 / PDF 抽取 / 非 PDF 安全 / 可读性判定 / 截断 / 四条路线回退 / 限定路线 / `citation_pdf_url` / 域名拼 `/pdf` / 订阅制快速失败 / 预算共享 / 换 UA 重试 / 验证页快速放弃 |
| `test/scan.test.js` | 30 | 新增「按设置决定是否抓全文」（关掉时只发 1 个 RSS 请求，不碰 doi.org）、`backfillQuality` 4 例、`ensureIssns` 3 例、**「有分数但缺 ISSN」也会重算**、**补不到 ISSN 不抹掉已有分数** |
| `test/store.test.js` | 9 | 默认值加 `fullText: true` |
| `test/client-smoke.test.js` | 17 | 新增质量徽章「高质量 · 79」/ 影响因子 / **分区徽章 `Q1` 与 `drr-quartile-q1`** / 点开「依据」/ 顶部状态条断言；**没百分位的条目不出现 `Q4`** |

合计 **241 个用例，全绿**（`node --test --experimental-test-isolation=none test/*.test.js`，约 7.5 秒）。

#### 11.15.6 老论文补 ISSN 与重算（实测）

**问题**：用户库里 33 篇论文的 `issn` **一个都没有**（字段是后加的，入库时还不存在），
所以质量分只能按被引算。实测：22 篇 medium、**11 篇 unknown（0 分，埋在「待评估」里）**、
高质量 0 篇。

**修法**（`radar/quality.js` 的 `resolveIssnsByDoi` + `radar/scan.js` 的 `ensureIssns` /
`backfillQuality`）：

1. `resolveIssnsByDoi(dois, api)`：`GET https://api.openalex.org/works?filter=doi:<a>|<b>&select=doi,primary_location`，
   从 `primary_location.source.issn_l` 取 ISSN，一次最多 50 个 DOI。
   - **`|` OR 查询只能写一次字段前缀**：`filter=doi:a|doi:b` 报 400
     （`It looks like you're trying to do an OR query between filters and it's not supported`），
     正确是 `filter=doi:a|b`。实测这条踩过一次才通。
2. `ensureIssns(items, {api, issnResolver})`：只处理「缺 ISSN 且有 DOI」的，补到的写回 `item.issn`。
   `issnResolver` 可注入（测试用），默认就是 `resolveIssnsByDoi`；上游抛错返回 0，不阻断扫描。
3. `runScan` 里在质量评估**之前**先 `ensureIssns(fresh, ...)` —— 有些源（RSS / PubMed / arXiv）
   本来就不给 ISSN，不补的话这些源的论文质量分永远拿不到期刊信号。
4. `backfillQuality` 的判据从「有没有 `quality`」改成**「有没有 ISSN」**：已有分数但缺 ISSN 的
   也要重算，否则影响因子这份 70% 的权重永远补不上（**这是本块最重要的修正** ——
   第一版只补 `quality === null` 的，跑真实库返回 `backfilled 0`，才发现 33 篇全都「有分数没 ISSN」）。
   补不到 ISSN 的**保留原分**，不要无谓抖动。

**实测（用户真实库的副本）**：`backfilled 33 in 12143 ms`，`withIssn: 0 → 33`、
`withImpactFactor: 0 → 33`、期刊缓存 26 条，档位从 `{medium:22, unknown:11}` 变成
**`{high:18, medium:13, low:2, unknown:0}`**。最高分 80（MSSP，IF 10.10）、78（Thin-Walled
Structures，IF 8.51）、79（Polymers，IF 7.91）。

#### 11.15.7 全文抓取的两个假失败（实测上限 53% of OA）

**背景**：用户库里 33 篇论文只有 9 篇能抓到全文（27%），17 篇标了开放获取的里也只抓到 9 篇。
逐条追下去发现**两个失败都不是「网站不给」**，而是我们自己的判断错了。

**假失败 1：UA 版本号被出版社区别对待**

同一个 URL、同一份 headers，只差 UA 里的 Chrome 版本号，结果完全不同：

| UA | 结果 |
| --- | --- |
| `Chrome/120.0.0.0` | 200 + `text/html` + **14367 字节拦截页** |
| `Chrome/131.0.0.0` | 200 + `application/pdf` + **3631757 字节真 PDF** |

修法：`BROWSER_UA` 升到 `Chrome/131.0.0.0`，并新增 `ALT_UA`（Safari 17.4）作为备用；
`downloadPdf()` 第一个 UA 拿不到 PDF 就换第二个再试一次。

**假失败 2：200 + HTML 拦截页被当成下载成功**

`fetchBinary` 原来只判 `res.ok`。出版社反爬返回的拦截页**状态码是 200**，
于是被当成了「PDF 下载成功」，再到 `pdfToText()` 输出空串才失败 —— 白白浪费一次完整下载。
修法：新增 `looksLikePdf(buffer)` 验 `%PDF` 魔数，不是 PDF 就换 UA 重试。

**假失败 3（放弃得对）：IOP 的 Radware 验证页**

`10.1088/1742-6596/2956/1/012046` 的 DOI 会 302 到
`https://validate.perfdrive.com/…`（Radware Bot Manager Captcha），也是一个 **200 + 14367 字节**的页面。
这种页面再试几次都是同一个验证页，只会烧掉整个 25 秒预算。
修法：新增 `CHALLENGE_PATTERNS`（`Radware Bot Manager Captcha` / `validate.perfdrive.com` /
`cf-browser-verification` / `<title>Access Denied` 等）与 `looksLikeChallenge(finalUrl, html)`，
命中就直接放弃这条路线。**只在 HTML < 40000 字节时才用内容判断**，避免正常论文落地页误伤。

**实测效果**：成功率不变（9/33），但总耗时从 **230 秒降到 157 秒**，平均 4770ms/篇 ——
省下来的全是「本来就没戏」的等待。

**上限在哪里（重要结论）**：24 篇失败的里 **15 篇是 Elsevier 的 `10.1016/*`**（63%）。
试过 `www.sciencedirect.com/science/article/pii/<pii>/pdfft?download=true`，
返回 **403 + 832803 字节拦截页**。ScienceDirect 对非浏览器请求一律 403，这是硬墙。
所以全文获取率的天花板就是「开放获取比例」，插件已经接近这个上限，不要再往这条路上投人。

**踩坑**：`downloadPdf` 用字符串 `replace` 大段重写时把同一个函数体复制了好几遍，
`node --check` 直接报 `Identifier 'downloadPdf' has already been declared` ——
而且当时的修复脚本写文件被沙箱拒（`EPERM: open 'radar/fulltext.js'`），只能改用 `edit` 工具逐块删。
教训：**大段替换别用脚本拼字符串，用 `edit` 按块改**。

#### 11.15.5 本次踩的坑

1. **单测里 `throw new Error('network down')` 会白等 32 秒**。`getText` 对可重试错误走
   4s / 9s / 18s 退避 —— 模拟上游失败要返回 **404**（不可重试），耗时降到 1.1 秒。
2. **极简 React 替身的 `useState` 槽位要按组件分帧**（11.12 已记）。这次加 `whyOpen` 又踩了一次：
   `ItemCard` 的两个 `useState` 如果和 `Panel` 共用游标，点质量徽章会把 Panel 的 state 改掉。
3. **PDF 必须按 `latin1` 解码，不能用 `utf8`**。content stream 里的字面量是字节串，用 `utf8` 解会把
   高位字节变成 `U+FFFD`，`looksLikeProse` 直接判失败。`pdfToText` 全程用 `buf.toString('latin1')`。
4. **改 UI 后必须跑 client-smoke**。卡片结构从 `topRow + metaRow + title` 变成
   `titleRow + qualityRow + whyLine + metaRow`，所有基于文本顺序的断言都要重新对一遍。
5. **对象字面量里同一个键写两遍，后者静默覆盖前者**。`radar/store.js` 的 `normalizeItem` 里
   `citationPercentile` 出现了两次：第一次写了正确的 `&& raw.citationPercentile !== null` 守卫，
   第二次是更早的旧写法 `Number.isFinite(Number(raw.citationPercentile))`。JS 不报错、`node --check`
   也不报错，**后一个定义生效**，于是老 state 里没有这个字段时 `Number(undefined) = NaN` 侥幸没错，
   但一旦值是 `null` 就会变成 `0` —— 每篇论文都被判成 Q4。这是本仓库第 4 次踩 `Number(null) === 0`
   的坑（前三次：`clampInt`、`stats.js` 的 `days`、`quality.js` 的 `quartileOf` /
   `citationPercentileScore`），教训是**这个守卫必须集中写在一个函数里复用**，不要每处手抄。
   排查手法：`grep -n 'citationPercentile' radar/store.js` 一眼就能看到相邻两行同名键。
6. **插件启动阶段不要做异步写 state**。第一版把 `backfillQuality` 挂在 `apply()` 的启动流程里，
   测试直接红了三条，全是清理临时目录撞车：`ENOTEMPTY`（目录非空）、`EBUSY`（资源被占用）——
   启动时的异步写还在跑，测试已经结束并删目录了。真实环境里它还会和面板首屏读抢文件锁。
   改法有两条并用：① 扫描**末尾**回填（`runScan` 尾部 + `result.backfilled`）；② 面板读时用
   **惰性现算**兜底（`publicState` 里对缺 `quality` 的条目调一次 `paperQuality`，只读不写盘）。
   `test/helpers.js` 的 `tempDir` 同时改成 `fsp.rm(..., {maxRetries:20, retryDelay:50})`。
7. **改「补数据」的判据要想清楚是「缺结果」还是「缺前提」**。`backfillQuality` 第一版判据是
   `quality === null`，跑真实库返回 `backfilled 0` 却什么都没修 —— 因为那 33 篇都**已经算过分**
   （只是没 ISSN，算出来的是半瞎的分数）。判据必须落在**前提**（有没有 ISSN）而不是**结果**
   （有没有分数）。



