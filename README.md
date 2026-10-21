# 研究前沿雷达 / Research Radar

一个 DeepSeek Harness 插件：按你关心的研究方向定期检索最新论文，用 LLM 阅读并结构化总结
「科研问题 / 方法 / 内容与结论 / 创新点 / 局限 / 与方向的相关性」，在 Web UI 面板里以卡片查看，
并可开启 SMTP 邮件定期推送摘要。

## 功能

### 多维度检索（不只是关键词）

每个研究方向可以同时配置五个维度，**同一维度内是「或」，不同维度之间是「且」**：

| 维度 | 作用 | 例 |
| --- | --- | --- |
| `keywords` | 标题 / 摘要关键词 | `metal rubber`、`shape memory alloy` |
| `authors` | 关注作者 | `Lagoudas`、`Li Y` |
| `venues` | 期刊 / 会议 | `Journal of Sound and Vibration` |
| `institutions` | 单位 / 机构 | `Harbin Institute of Technology` |
| `exclude` | 排除词，命中即丢弃 | `bearing`、`review` |
| `languages` | 文献语言：`zh` / `en`，留空 = 不限 | `['zh']` 只看中文文献 |

另有 `matchMode`（多个关键词是「命中任意一个」还是「必须全部命中」）。

`languages` 的两种过滤方式：OpenAlex / PubMed 在**源站**按语言过滤（`language:zh`、`chi[la]`），
其余源（Crossref / arXiv / bioRxiv / RSS）按标题摘要里的**汉字占比**在本地判断。
**认不出语言的条目照常推送**（宁可多推不误杀）；中英文都不选或都选 = 不限语言。

### 相关性保护（strict 模式）

短缩写（`MR`、`AI`、`EMWM`）单独作为关键词时歧义极大 —— 搜「金属橡胶」时 `MR` 会把磁共振
（magnetic resonance）的论文全带进来。strict 模式的处理方式：

- **主要关键词** = 多词短语、含连字符、或长度 ≥ 6 的词；
- 存在主要关键词时，**只把主要关键词下发给数据库**（避免短缩写占满配额），且结果必须命中至少一个主要关键词；
- 只命中短缩写的结果直接丢弃；短缩写仍参与本地打分与「命中理由」展示；
- 若方向还配了作者 / 期刊 / 单位，命中这些维度同样算相关（这类维度本身就是强约束）。

实测：`keywords=['metal rubber','MR','EMWM']` 从「6 条里 5 条是磁共振」变成「6 条全部是金属橡胶」。

### 文献源

| 源 | 说明 |
| --- | --- |
| `openalex` | **推荐主库**。OpenAlex 覆盖全学科期刊论文，支持标题/摘要、作者、期刊 ID、单位四个维度的服务端精确检索 |
| `crossref` | 全学科 DOI 库，按 `query.bibliographic` 模糊检索后本地严格过滤 |
| `pubmed` | 生物医学，E-utilities 布尔检索（`[tiab]` / `[au]` / `[ta]` / `[ad]`） |
| `arxiv` | 预印本，物理 / 数学 / CS |
| `biorxiv` | 生命科学预印本 |
| `rss` | 任意 RSS / Atom 源，本地过滤 |

OpenAlex 无 API Key 时是**全网共享的 $0.10/天**配额，量大时请在设置里填 Key；
`api.mailto` 填上联系邮箱可提升 Crossref / OpenAlex 的礼貌配额。

### 其它

- **试检索**：在方向表单里点「试检索」，**不写库、不摘要**，先看搜出来的文章对不对，再决定保存。
- **跨源去重**：同一篇论文在 OpenAlex / Crossref / PubMed 里各有自己的 ID，但会被识别成一篇
  （键优先级：arXiv 编号 > DOI > 规范化标题+年份 > 源内 ID），不会重复推送。
- **已读 / 收藏**：每张卡片右下角可以「标为已读」「收藏」；顶部三段筛选器（全部 / 未读 / 收藏）
  带实时计数，也可以按方向筛选、一键「全部标为已读」。
- **分页**：面板每页 50 条，底部「加载更多」按需追加，不再一次只给最近 200 条。
- **LLM 结构化摘要**：调用当前 Harness 配置的模型，输出严格 JSON，信息不足时明确写「摘要未提及」，不编造。
  多篇摘要并发生成（默认 3 路），单篇失败只记在那一篇上，不影响整轮扫描。
- **卡片式面板**：侧边栏「研究前沿雷达」图标 → 中央面板四个页签（最新论文 / 研究方向 / 趋势 / 设置）。
- **中文文献**：方向里勾上「中文文献」就能把中文期刊一起收进来（OpenAlex 有 100 万+ 条中文记录），
  和英文一起看，不再只能盯 SCI 英文库。
- **趋势统计**：按方向统计每周新增（柱状图）、来源分布、高频期刊 / 作者 / 标签，
  窗口可选 30 / 90 / 180 / 365 / 730 天。
- **增量抓取**：每轮扫描只往回看「距上次扫描的天数 + 2 天」，不再每次都扫 30 天窗口，
  省 OpenAlex 配额；窗口**按方向各算一份**，刚加的方向首次扫描仍用完整窗口；
  从没扫过或时间戳异常时才回退到配置的完整窗口。
- **邮件推送**：纯 Node 内置模块实现的 SMTP 客户端（零第三方依赖），支持 465 隐式 TLS 与 587 STARTTLS。
  邮件正文是**卡片式 HTML**（table + 内联样式，兼容 Outlook / 手机客户端），带「在面板中查看」按钮。
- **定时扫描**：默认每 12 小时一次（1–168 可调），插件内每 5 分钟自查一次是否到点。
- **Agent 精读联动**：每张卡片右下角的 **🔍 精读** 按钮，会把这篇论文的标题 / 作者 / 期刊 / DOI /
  链接 / 摘要拼成一段提示词，**丢进一个新会话的输入框**（不自动发送，你自己按回车）。
  提示词明确要求 Agent 先试着抓全文、拿不到就只基于摘要并说明，且不许编造原文没有的数字和结论。
  点完顺手把该条标为已读。
- **Agent 工具**：`research_radar`，可在对话里直接让 Agent 查看状态、加方向、触发扫描、发摘要。

## 安装

在 DeepSeek Harness 里用插件管理器把本目录作为本地包安装：

```
plugin_manager install_bundle(target: "I:\\skill\\dsh-research-radar")
```

路径换成你实际存放本目录的绝对路径。安装后 `dsh.profile.bundles` 会带上 `@local/dsh-research-radar`，
Host 半边立即生效；**客户端（面板）半边需要刷新一次页面**才会出现在侧边栏。

不想用图形界面的话，等价的命令行方式（已验证）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'G:\DSH\DeepSeek Harness.exe' --expose-internals `
  'G:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js' `
  plugin --profile desktop add "link:I:/skill/dsh-research-radar"
```

装完还要把 `@local/dsh-research-radar` 追加到 profile `package.json` 的 `dsh.profile.bundles`
末尾（插件管理器会自动做这一步；手动 `dsh plugin add` 不会）。

### 换到另一台电脑

代码本身不含任何硬编码路径，整个目录拷到任意位置都能用，只需两步：

1. 把目录放到新机器上（之后不要再移动）。
2. 用新路径重新 `install_bundle`（或先禁用再启用一次），profile 里登记的绝对路径会被更新。
3. 想保留方向与邮箱配置的话，把旧机器的 `%USERPROFILE%\.dsh\research-radar\state.json`
   拷到新机器同名位置即可；不想带就跳过，首次启动会自动建空配置。

`state.json` 里 SMTP 密码是明文，传输时注意；它已被 `.gitignore` 排除，不会被提交。
详细步骤与踩坑清单见 [HANDOFF.md](HANDOFF.md) 第十节。

## 使用

1. 侧边栏点「研究前沿雷达」→ 切到 **研究方向** → **添加方向**。
   填名称，然后至少填关键词 / 作者 / 期刊 / 单位中的一项，勾选要检索的数据库（建议先只勾 OpenAlex）。
2. 点 **试检索** 看返回的 5 条是否对路。不对就调关键词（把宽泛的短缩写去掉，用多词短语），再试。
3. 满意后点 **保存**。
4. 切到 **设置**：调扫描间隔与每方向抓取数量；要收邮件就勾「启用邮件推送」并填 SMTP
   （QQ 邮箱用 `smtp.qq.com:465` + 授权码；163 用 `smtp.163.com:465`）。保存后点 **发送测试邮件** 确认。
5. 回到面板顶部点 **立即扫描**，第一次会抓取并逐篇生成摘要（3 路并发，8 篇约 20 秒）。
6. 之后到点自动扫描，只有**没见过的**论文才会进面板和邮件。
7. 看过的卡片点「标为已读」，想留着的点「收藏」；顶部筛选器可以在全部 / 未读 / 收藏之间切换。
8. 想深挖某篇，点卡片右下角的 **🔍 精读** —— 会在新会话里生成一段提示词（含标题 / DOI / 链接 / 摘要），
   按回车让 Agent 去抓全文、讲方法、判断能不能搬到你自己的工作里。不满意可以改提示词再发。

也可以直接在对话里让 Agent 操作，例如：
「帮我加一个方向：金属橡胶，关键词 metal rubber / MR / EMWM，订阅 OpenAlex 和 Crossref」。

## 结构

```
index.js            Host 半边：HTTP 路由、定时器、agent 工具
client.js           Client 半边：侧边栏图标 + 主面板（React，主题 token）
radar/config.js     插件配置 schema（Standard Schema v1，手写零依赖）
radar/dedupe.js     跨源去重键（DOI / arXiv / 标题+年份 / 源内 ID）
radar/store.js      JSON 持久化（配置 / 已读去重 / 摘要缓存 / seen 剪枝）
radar/sources.js    OpenAlex / Crossref / PubMed / arXiv / bioRxiv / RSS 抓取与相关性打分
radar/summarize.js  LLM 结构化摘要
radar/mail.js       纯 Node SMTP over TLS 客户端 + 邮件 HTML 卡片渲染
radar/scan.js       扫描编排（增量窗口 + 并发摘要）+ 摘要邮件正文
radar/stats.js      趋势统计（周序列 / 来源 / 期刊 / 作者 / 标签榜单）
locale/{zh,en}.json 显示元数据
icon.svg            原创图标
test/*.test.js      node:test 单测（零依赖，npm test）
```

## 开发

```powershell
# 单元测试（不需要安装任何依赖）
node --test test/*.test.js
# 在 DSH 的 Windows 沙箱里跑要加 --experimental-test-isolation=none（默认进程隔离会 spawn EPERM）
```

覆盖：去重键归一、seen 剪枝、检索打分与 strict 过滤、语言过滤、并发限流、增量窗口、
分页与筛选、HTTP 路由、Config schema、趋势统计、邮件 HTML、客户端面板渲染冒烟
（用极简 React 替身，含趋势页、方向表单与「精读」按钮）。共 152 个用例。

## 数据位置

默认 `%USERPROFILE%\.dsh\research-radar\state.json`（可用插件 `Config.dataDir` 覆盖）。
SMTP 密码只保存在该文件里，面板返回时始终脱敏为 `********`。

`state.seen`（已推送过的论文）会自动剪枝：超过 180 天或超过 20000 个键就清掉最旧的，
但**仍在列表里的论文永远不会被剪掉**，所以去重不会因为清理而失效。

## 插件配置

在 profile 的 `cordis.patch.yml`（或用 `plugin_manager`）里可覆盖以下字段，全部可选：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `''`（= `DSH_HOME/research-radar`） | 数据目录 |
| `llmProvider` | `''`（= 当前默认模型） | 摘要用的 provider |
| `llmModel` | `''`（= 当前默认模型） | 摘要用的模型 |
| `locale` | `'zh'` | 邮件与摘要的语言，`zh` / `en` |

## 打包带走

```powershell
Compress-Archive -Path 'I:\skill\dsh-research-radar' `
  -DestinationPath "$env:USERPROFILE\Desktop\research-radar.zip" -Force
```

`radar-config.example.json` 是配置文件的字段结构参考（全占位值，无真实凭据）。

## 许可

私有项目，未发布。
