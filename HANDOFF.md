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

### 已完成且经过端到端验证

- ✅ Host 半边（HTTP 路由 + 定时器 + Agent 工具）已 live
- ✅ Client 半边（侧边栏图标 + 主面板）已 live，浏览器实测渲染正常
- ✅ OpenAlex / Crossref / PubMed / arXiv / bioRxiv / RSS 六个源全部接通
- ✅ 五维检索（keywords / authors / venues / institutions / exclude）+ 同维 OR、跨维 AND
- ✅ 相关性保护（strict 模式），修掉了短缩写污染
- ✅ LLM 结构化摘要（一句话 / 问题 / 方法 / 内容与结论 / 创新点 / 局限 / 相关性 / 标签）
- ✅ 卡片式面板（三个页签：最新论文 / 研究方向 / 设置）
- ✅ 「试检索」按钮（不写库不摘要，先验证准确率）
- ✅ 纯 Node 手写 SMTP（零依赖），465 隐式 TLS 与 587 STARTTLS 都支持
- ✅ 定时扫描（默认 12 小时）
- ✅ 本地 git 仓库，3 个提交，工作区 clean

### 用户当前的实盘配置（真实可用，别乱动）

```
研究方向：金属橡胶  keywords = metal rubber, MR, EMWM  sources = openalex, crossref
          matchMode = any  strict = true
SMTP：    smtp.163.com:465 SSL  <REDACTED> → <REDACTED>  已启用
数据：    C:\Users\<user>\.dsh\research-radar\state.json
```

⚠️ **邮件推送是开着的，且 SMTP 是真实可用的**。调试时如果要触发扫描，先确认不会给用户发一封垃圾邮件，或者临时把 `mail.enabled` 关掉。

---

## 三、代码结构

```
F:\python\dsh-research-radar\
├── package.json          manifest（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml      insert 一行：id=dsh-research-radar, name=@local/dsh-research-radar
├── index.js       530 行 Host 半边：HTTP 路由 / 定时器 / research_radar Agent 工具
├── client.js     1119 行 Client 半边：侧边栏图标 + 主面板（React，主题 token）
├── radar/
│   ├── store.js   250 行 JSON 持久化（配置 / 已读去重 / 摘要缓存）
│   ├── sources.js 820 行 六源抓取 + 相关性打分 + strict 判定
│   ├── summarize.js 182 行 LLM 结构化摘要
│   ├── mail.js    282 行 纯 Node SMTP over TLS（零依赖）
│   └── scan.js    201 行 扫描编排 + 摘要邮件正文
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
| GET | `/state` | 方向 + 最近 200 条 + 脱敏设置 + 源标签 + 状态 |
| POST | `/topics` | `{op:'upsert'\|'delete', topic}` |
| POST | `/settings` | patch `scan` / `mail` / `rss` / `api`；`pass` 传回 `********` 视为不改 |
| POST | `/preview` | **试检索**，不写库不摘要不去重 |
| POST | `/scan` | `{topicIds?}` → `{ok, newCount, errors, mail, items, state}` |
| POST | `/item` | 改 `read` |
| POST | `/clear-items` | 清空条目 |
| POST | `/test-mail` | 发测试邮件 |
| POST | `/preview-mail` | 预览摘要正文 |

**Agent 工具** `research_radar`，`action` 枚举：
`status` / `list_topics` / `add_topic` / `remove_topic` / `scan` / `send_digest`，
参数支持 `name` / `keywords` / `authors` / `venues` / `institutions` / `exclude` / `sources` / `topicId`。

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
- 组件：`RadarIcon` / `Panel`（三 tab）/ `ItemCard` / `TopicForm` / `Field`
- `api(action, body)` 用同源 `fetch` + `x-dsh-research-radar: 1` header
- 文案：`DICT` 里内置 zh/en 双语（约 90 个键），按 `document.documentElement.lang` / `navigator.language` 选

---

## 四、环境与硬约束（**这一节最省时间，务必先读**）

### 工具路径

| 工具 | 路径 | 备注 |
| --- | --- | --- |
| node | `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` | v24.21.0，**不在 PATH** |
| git | `C:\Users\<user>\AppData\Local\Programs\PortableGit\cmd\git.exe` | 2.56.0，**不在 PATH**（从 npmmirror 装的 PortableGit） |

语法检查：`& $node --check <file>`，七个 JS 文件都要过一遍。

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

**Client 半边改完要刷新页面**才生效。

**GUI 需要带 token 的 URL**，token 每进程新生成，端口也会变（当前 `http://127.0.0.1:54648`）。拿法：

```js
// 临时在 index.js 加端点，用完删掉
GET /api/dsh-research-radar/__auth-url  →  { url: ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()) }
```

或者读运行时上下文里的 `DSH_WEB_URL`。

**直接调 API 必须带 header**：

```powershell
$h = @{'x-dsh-research-radar'='1'}
Invoke-RestMethod -Uri 'http://127.0.0.1:54648/api/dsh-research-radar/state' -Headers $h
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
$root = 'F:\python\dsh-research-radar'

# 1. 语法
foreach ($f in @('index.js','client.js','radar/store.js','radar/sources.js','radar/summarize.js','radar/mail.js','radar/scan.js')) {
  & $node --check "$root\$f"; if ($LASTEXITCODE -ne 0) { "FAIL $f" }
}

# 2. Host 端点
$h = @{'x-dsh-research-radar'='1'}
$r = Invoke-RestMethod -Uri "$($env:DSH_WEB_URL)/api/dsh-research-radar/state" -Headers $h
"topics=$($r.topics.Count) items=$($r.items.Count) store=$($r.status.storePath)"

# 3. 试检索（不写库，安全）
$body = '{"topic":{"name":"测试","keywords":["metal rubber","MR"],"sources":["openalex"]}}'
Invoke-RestMethod -Uri "$($env:DSH_WEB_URL)/api/dsh-research-radar/preview" -Method Post `
  -Headers (@{'x-dsh-research-radar'='1';'content-type'='application/json; charset=utf-8'}) `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

**Client 半边的离线冒烟测试**（不需要浏览器，很有用）：
在 Node 里 stub `window.__ModuleLoader__` / `React` / `ctx`，跑 `client.js` 的 factory + apply + render 一次组件。检查：
`id` / `inject` / 注册的 slot / locale 命名空间 / 注入的 CSS 字节数与 `data-plugin` 归属 / 组件能否 render。
（历史上这个脚本叫 `smoke-client.mjs`，已被 `.gitignore` 排除，需要时重写一份。）

**面板视觉验证**：bcdp 打开 token URL → `bcdp_js` 断言 `.drr-root` 的 `innerText`、`.drr-card` 数量与间距、`getComputedStyle` 的边框/阴影/颜色、`document.querySelectorAll('style[data-plugin="@local/dsh-research-radar"]').length === 1`、console 无 error。

---

## 六、已知缺陷（我验证过，确实存在）

| # | 缺陷 | 影响 | 位置 |
| --- | --- | --- | --- |
| 1 | **没有 DOI 去重** | 同一篇论文从 OpenAlex（`openalex:W123`）和 Crossref（`crossref:10.xxx`）抓到时算两条，面板和邮件里重复出现 | `radar/scan.js:117` 只按 `id` 判重 |
| 2 | **`seen` 字典永不清理** | `state.json` 无限增长（现在 17 KB，长期会到 MB 级） | `radar/store.js` 无剪枝逻辑 |
| 3 | **`read` 字段写了但没用** | 面板没有「标为已读 / 未读筛选」，`POST /item` 端点形同虚设 | `client.js` 里搜不到 `read` |
| 4 | **PubMed 忽略 `lookbackDays`** | `fetchPubmed({ query, max })` 签名里没有 lookback，不受时间窗口约束 | `radar/sources.js:566` |
| 5 | **没有 `Config` schema 导出** | `dataDir` / `llmProvider` / `llmModel` 只能手改 `cordis.patch.yml`，面板里改不了 | `index.js` 只有 `name` / `inject` / `apply` |
| 6 | **条目只取最近 200 条** | 论文攒多之后看不到更早的，没有分页 / 筛选 | `index.js` `publicState()` |
| 7 | **摘要是串行的** | 每篇几秒，一次扫 8 篇要等半分钟以上，用户会觉得卡 | `radar/scan.js:139-161` |
| 8 | **邮件 HTML 很朴素** | `textToHtml()` 只是转义 + 段落，没有卡片样式，手机上看体验一般 | `radar/mail.js` |
| 9 | **定时靠自建 5 分钟 tick** | 没用 `ctx.schedule`，间隔不能动态改，进程休眠会错过 | `index.js:129-146` |
| 10 | **没有 git remote** | 用户说暂不推 GitHub，但仓库已就绪，加 remote 即可推 | — |

---

## 七、下一步优化方案（按优先级）

### P0 —— 先修正确性，这些会让用户觉得「不可靠」

**1. 跨源去重（缺陷 #1）**
按 `DOI > arXiv id > 规范化标题+年份` 三级键去重。建议在 `scan.js` 的 `fresh` 累积阶段建一个 `dedupeKey()`：

```js
function dedupeKey(item) {
  const doi = String(item.doi ?? '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim()
  if (doi !== '') return `doi:${doi}`
  const title = String(item.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const year = String(item.publishedAt ?? '').slice(0, 4)
  return title === '' ? `id:${item.id}` : `t:${title}|${year}`
}
```

同时 `state.seen` 也应该存这个规范化键，避免下次扫描重复。

**2. `seen` 剪枝（缺陷 #2）**
在 `store.mutate` 里加：只保留最近 N 天（比如 180 天）或最近 M 条（比如 5000）的 `seen` 记录。注意别把还在 `items` 里的删掉。

**3. 摘要并发化（缺陷 #7）**
现在是 `for (const item of fresh)` 串行 + 失败重试。改成限流并发（2–3 路）：

```js
async function mapLimit(list, limit, fn) { /* 简单信号量 */ }
```

注意 LLM 服务可能有速率限制，`limit` 别超过 3；保留单篇失败只记 `summaryError` 的语义。

**4. PubMed 加时间窗口（缺陷 #4）**
`fetchPubmed` 加 `lookbackDays` 参数，用 `("YYYY/MM/DD"[dp] : "3000"[dp])` 或 `mindate/maxdate` + `datetype=pdat` 约束。

### P1 —— 体验，这些会让用户觉得「好用」

**5. 已读 / 收藏（缺陷 #3）**
面板上加「标为已读」按钮 + 顶部筛选（全部 / 未读 / 收藏）。`POST /item` 已存在，改 `read` 即可；再加一个 `starred` 字段。

**6. 邮件 HTML 卡片化（缺陷 #8）**
复用面板的卡片视觉（左侧强调色边、chip 行、一句话高亮块、两栏字段）。注意邮件客户端不支持 CSS 变量和 `grid`，必须用**内联样式 + table 布局**，颜色写死十六进制。加一个「在面板中查看」的按钮链接（用 `ctx.connection.authenticatedUrl()` 生成）。

**7. 条目分页 / 筛选（缺陷 #6）**
`/state` 支持 `?limit=&offset=&topicId=&unreadOnly=`；面板底部加「加载更多」。

**8. `Config` schema（缺陷 #5）**
```js
export const Config = Schema.object({
  dataDir: Schema.string().default(''),
  llmProvider: Schema.string().default(''),
  llmModel: Schema.string().default(''),
})
```
这样面板的插件配置页就能改数据目录和 LLM 路由，不用手改 yaml。

### P2 —— 能力扩展

**9. 增量抓取窗口**
现在每次都用 `lookbackDays`（默认 30 天）扫一个大窗口，靠 `seen` 去重。改成「从 `lastScanAt - 2天` 开始」的滑动窗口，能显著减少请求量和配额消耗（OpenAlex 无 key 时只有 $0.10/天）。

**10. 中文文献**
用户是做材料/力学的，中文文献（CNKI / 万方）没有公开 API。可行路径：
- OpenAlex / Crossref 里筛中文期刊（ISSN 前缀 + `language:zh`）
- 加 `semanticscholar` 源（有 key 时可用，无 key 会 429）
- 用户手动配 RSS（知网期刊有 RSS）

**11. 趋势与统计**
按方向统计每周新增数量、高频期刊、高频作者、关键词热度曲线。数据都在 `state.items` 里，纯前端算即可。

**12. 与 Agent 深度联动**
摘要只读标题 + 摘要，信息有限。可以加一个「让 Agent 精读这篇」的按钮：把 DOI/URL 丢给会话，让 Agent 用 `ctx.web.fetch` 拿全文（开放获取的）再做深度分析。这是这个插件最有想象力的扩展点 —— 从「监控 + 摘要」升级成「监控 + 精读 + 问答」。

### P3 —— 工程化

**13. 单元测试**
`radar/sources.js` 的 `scoreItem` / `finalize` / `strongKeywords` / `invertAbstract` 是纯函数，非常适合写测试。用 node 内置 `node:test`，零依赖。

**14. git remote**
用户说暂不推，但可以先把 `.gitignore` 和 README 弄好，等他要推的时候一条命令的事。

---

## 八、交接清单

接手后建议按这个顺序：

1. 读 `README.md`（面向用户）→ 读本文件第四节（环境约束）
2. 跑第五节的语法检查 + `/state` 端点，确认插件还活着
3. 用 bcdp 打开 token URL，确认面板三个 tab 都能渲染
4. 从 P0 的第 1 条（跨源去重）开始改
5. 每改完一个文件 `node --check`，改完 Host 侧热重载，改完 Client 侧刷新页面验证
6. 提交前 `git status` 确认没有把 `tmp-*/`、`smoke-client.mjs` 之类带进去

### 不要做的事

- ❌ 不要手改 profile 的 `package.json` / `cordis.patch.yml`（用 `plugin_manager`）
- ❌ 不要跑 `pnpm install`
- ❌ 不要 `require('@deepseek-ai/dsh-client-ui-*')`
- ❌ 不要用 `ctx.styles`（不存在）
- ❌ 不要把 OpenAlex 的 `filter` 整体 `encodeURIComponent`
- ❌ 不要把 `--dsw-alias-brand-primary` 当强调色
- ❌ 不要随意触发扫描（邮件推送开着，会给用户发信）
- ❌ 不要直接移动/重命名 `F:\python\dsh-research-radar` 目录后就撒手 —— profile 里登记的是绝对路径 `link:F:/python/dsh-research-radar`，移动后必须重新 `install_bundle`（见第十节）

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

---

## 十、换到另一台电脑

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
