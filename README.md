# 研究前沿雷达 / Research Radar

一个 DeepSeek Harness 插件：按你关心的研究方向（关键词 + 订阅源）定期检索最新论文，
用 LLM 阅读并结构化总结「科研问题 / 方法 / 内容与结论 / 创新点 / 局限 / 与方向的相关性」，
在 Web UI 面板里随时查看，并可开启 SMTP 邮件定期推送摘要。

## 功能

- **多研究方向**：每个方向独立配置名称、关键词、订阅源（arXiv / bioRxiv / 自定义 RSS）。
- **去重**：按论文 ID 记录已读，只推真正的新文章。
- **LLM 结构化摘要**：调用当前 Harness 配置的模型，输出严格 JSON 字段，信息不足时明确写「摘要未提及」，不编造。
- **面板**：侧边栏「研究前沿雷达」图标 → 中央面板三个页签（最新 / 方向 / 设置），可手动触发扫描。
- **邮件推送**：纯 Node 内置模块实现的 SMTP 客户端（零第三方依赖），支持 465 隐式 TLS 与 587 STARTTLS，发信前可预览。
- **定时扫描**：默认每 12 小时一次（1–168 可调），插件内每 5 分钟自查一次是否到点。
- **Agent 工具**：`research_radar`，可在对话里直接让 Agent 查看状态、加方向、触发扫描、发摘要。

## 安装

在 DeepSeek Harness 里用插件管理器把本目录作为本地包安装：

```
plugin_manager install_bundle(target: "F:\\python\\dsh-research-radar")
```

安装后 `dsh.profile.bundles` 会带上 `@local/dsh-research-radar`，Host 半边立即生效；
**客户端（面板）半边需要刷新一次页面**才会出现在侧边栏。

## 使用

1. 侧边栏点「研究前沿雷达」→ 切到 **研究方向** → **添加方向**，填名称和关键词，勾选订阅源。
2. 切到 **设置**：调扫描间隔与每次抓取数量；要收邮件就勾「启用邮件推送」并填 SMTP 信息
   （QQ 邮箱用 `smtp.qq.com:465` + 授权码；163 用 `smtp.163.com:465`）。填完点 **保存**，
   再点 **发送测试邮件** 确认能收到。
3. 回到面板顶部点 **立即扫描**，第一次会抓取最近一批论文并逐篇生成摘要（较慢，约每篇几秒）。
4. 之后到点会自动扫描，只有**没见过的**论文才会进面板和邮件。

也可以直接在对话里让 Agent 操作，例如：「帮我加一个方向：扩散模型 + diffusion model，订阅 arxiv」，
Agent 会调用 `research_radar` 工具。

## 结构

```
index.js            Host 半边：HTTP 路由、定时器、agent 工具
client.js           Client 半边：侧边栏图标 + 主面板（React，主题 token）
radar/store.js      JSON 持久化（配置 / 已读去重 / 摘要缓存）
radar/sources.js    arXiv / bioRxiv / RSS 抓取与解析（零依赖）
radar/summarize.js  LLM 结构化摘要
radar/mail.js       纯 Node SMTP over TLS 客户端
radar/scan.js       扫描编排 + 摘要邮件正文
locale/{zh,en}.json 显示元数据
icon.svg            原创图标
```

## 数据位置

默认 `%USERPROFILE%\.dsh\research-radar\state.json`（可用插件 `Config.dataDir` 覆盖）。
SMTP 密码只保存在该文件里，面板返回时始终脱敏为 `********`。

## 许可

私有项目，未发布。
