/**
 * 论文质量评估：不再只看「和关键词像不像」，而是把期刊层级、被引次数、
 * 开放获取状态和新鲜度一起算成一个人能看懂的分数与档位。
 *
 * 为什么需要这个：原来的 `score` 只是关键词命中数（标题 6 分、摘要 2 分…），
 * 一篇灌水期刊的论文只要标题里塞满关键词就能排到顶刊前面。用户要的是
 * 「这篇值不值得读」，那需要外部信号。
 *
 * 期刊指标来自 OpenAlex 的 `sources.summary_stats`：
 *   - `2yr_mean_citedness` ≈ 影响因子（近两年篇均被引），是本模块的主信号；
 *   - `h_index` / `i10_index` 作为期刊体量的辅助信号。
 * 这些值只跟期刊走，所以按 ISSN 缓存到磁盘，30 天刷新一次，
 * 不会因为每天扫描而反复请求。
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

import { getText, mailtoParam } from './sources.js'

/** 期刊指标缓存多久刷新一次（天）。 */
export const JOURNAL_CACHE_DAYS = 30

/** 一次最多查多少个 ISSN（OpenAlex 的 `|` OR 查询有长度限制，50 很安全）。 */
const ISSN_BATCH = 50

/** 质量档位，从高到低。`unknown` 表示期刊指标没查到。 */
export const QUALITY_TIERS = ['high', 'medium', 'low', 'unknown']

/**
 * 缺被引信号时给的中性分（0–100）。
 *
 * 用 50 而不是 0：0 会让「顶刊 + 刚发表」的论文被当成没人看；用 100 又会让它
 * 排在已有实证的论文前面。50 表示「还不知道」，不奖励也不惩罚。
 */
const NEUTRAL_CITATION = 50

/**
 * 缺期刊指标时给的中性分（0–100）。理由同 `NEUTRAL_CITATION`：
 * 期刊没被 OpenAlex 收录（中文刊、会议、预印本）不代表它是烂刊。
 */
const NEUTRAL_JOURNAL = 50

/**
 * 把各种写法的 ISSN 归一成 `1234-567X` 形式；认不出来返回 ''。
 * 支持 `02638231`、`0263-8231`、`0263 8231`、`ISSN 0263-8231`。
 */
export function normalizeIssn(value) {
  const digits = String(value ?? '')
    .toUpperCase()
    .replace(/[^0-9X]/g, '')
  if (digits.length !== 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4)}`
}

/**
 * 期刊层级（0–100）。只用 `2yr_mean_citedness`，因为它和影响因子同量纲，
 * 用户一看就懂。h_index 只在影响因子缺失时兜底。
 *
 * **用对数曲线而不是线性**：影响因子的实际分布是长尾的 —— 大部分期刊在
 * 1–5 之间，10 以上就很少了。线性映射（IF/20*100）会把 IF 5 判成 25 分、
 * IF 8.5 判成 42 分，于是工程领域的主流好刊全被打成「低质量」，这是错的。
 * 对数曲线下：IF 1→29 分、3→58、5→75、8.5→94、10→100，符合直觉。
 */
export function journalScore(metrics) {
  if (metrics === null || typeof metrics !== 'object') return 0
  const ifValue = Number(metrics.twoYearMeanCitedness)
  if (Number.isFinite(ifValue) && ifValue > 0) {
    // log10(1+IF) / log10(11)：IF=10 正好打满 100
    return Math.min(100, Math.round((Math.log10(1 + Math.min(ifValue, 30)) / Math.log10(11)) * 100))
  }
  const hIndex = Number(metrics.hIndex)
  if (Number.isFinite(hIndex) && hIndex > 0) {
    // 没有影响因子时用 h 指数粗略兜底：h=200 给 60 分
    return Math.min(60, Math.round((Math.min(hIndex, 200) / 200) * 60))
  }
  return 0
}

/**
 * 被引百分位 → 分区。OpenAlex 的 `cited_by_percentile_year` 是「同年同领域被引
 * 排名百分位」，这正好是用户说的「分区」—— 而且它比 JCR 分区更公平：
 * JCR 只按期刊算，同一本刊里每篇论文分区相同；这个是按**这篇论文**在领域里的
 * 实际排位算的，跨学科也能比。
 *
 * 取上限 `max` 来判：min 90 / max 96 的论文算「前 4%」而不是「前 10%」。
 */
export function quartileOf(percentile) {
  // 必须先挡 null / undefined / ''：`Number(null) === 0`，不挡的话「没有百分位」
  // 会被判成 Q4（被引前 100%），等于把每篇新论文都标成末档。
  if (percentile === null || percentile === undefined || percentile === '') return null
  const value = Number(percentile)
  if (!Number.isFinite(value)) return null
  if (value >= 75) return 'Q1'
  if (value >= 50) return 'Q2'
  if (value >= 25) return 'Q3'
  return 'Q4'
}

/**
 * 被引百分位换算成分数（0–100）。有百分位就用它，没有才退回年化被引。
 *
 * **为什么优先百分位**：工程类论文被引 10 次可能已是领域前 5%，生物类被引 10 次
 * 只是中游。原始被引数跨学科不可比，年化被引也只是缓解了「老论文占便宜」，
 * 没解决「学科之间不可比」。百分位两个问题一起解决。
 */
export function citationPercentileScore(percentile) {
  // 同 quartileOf：`Number(null) === 0` 会把「没算出来」当成「前 100%」，
  // 结果新论文的百分位分是 0 而不是「没有这个信号」。
  if (percentile === null || percentile === undefined || percentile === '') return null
  const value = Number(percentile)
  if (!Number.isFinite(value)) return null
  // 百分位本身就是 0–100，与 `citationScore` 同量纲，直接当分数用，不再做二次变换
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * 被引次数换算成分数（0–100）。绝对被引对老论文有利，所以按「年化被引」算，
 * 并且给新论文一个下限保护（刚发表 0 被引是正常的，不该被判死）。
 */
export function citationScore(citations, publishedAt, now = Date.now()) {
  const count = Number(citations)
  if (!Number.isFinite(count) || count <= 0) return 0
  const published = Date.parse(String(publishedAt ?? ''))
  const years = Number.isFinite(published) ? Math.max(0.25, (now - published) / (365.25 * 86400000)) : 3
  const perYear = count / years
  // 年化 20 次被引 ≈ 100 分（领域里非常热门）
  return Math.min(100, Math.round((Math.min(perYear, 20) / 20) * 100))
}

/**
 * 综合质量评估。
 *
 * @param {object} item 论文（需要 venue / issn / citations / publishedAt / openAccess）
 * @param {{ journals?: Map<string, object>|Record<string, object>, now?: number }} [options]
 *   `journals` 是 ISSN → 指标 的查找表（由 createJournalCache 提供）
 * @returns {{ score:number, tier:string, reasons:string[], impactFactor:number|null, journalHIndex:number|null }}
 */
export function paperQuality(item, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const lookup = options.journals
  const issn = normalizeIssn(item?.issn ?? '')
  let metrics = null
  if (lookup !== undefined && lookup !== null && issn !== '') {
    metrics = typeof lookup.get === 'function' ? lookup.get(issn) : lookup[issn]
  }
  if (metrics === undefined) metrics = null

  const impactFactor = metrics !== null && Number.isFinite(Number(metrics.twoYearMeanCitedness))
    ? Number(metrics.twoYearMeanCitedness)
    : null
  const journalHIndex = metrics !== null && Number.isFinite(Number(metrics.hIndex)) ? Number(metrics.hIndex) : null

  const jScore = journalScore(metrics)
  const percentile = item?.citationPercentile
  const percentileScore = citationPercentileScore(percentile)
  // 有百分位就用百分位（跨学科可比），没有才退回年化被引；两者都没有就是 null
  // （「没有这个信号」），而不是 0（「被引排最后」）。
  const annualized = citationScore(item?.citations, item?.publishedAt, now)
  const cScore = percentileScore !== null ? percentileScore : annualized > 0 ? annualized : null
  const reasons = []

  // 期刊占 70%，被引占 30% —— 期刊是「长期质量」信号，被引是「这篇本身」信号，
  // 但新论文被引天然少，所以权重给低一些。
  //
  // **缺失的信号一律用中性先验 50，两边对称**。两个反面例子都得堵住：
  //   1. 按 0 分计：没有期刊指标时 jScore=0，按 70% 权重算会把「被引前 10%」
  //      的论文压成 27 分判 low；
  //   2. 缺谁就把权重全给另一个：那样「顶刊 + 刚发表、还没算百分位」会拿满分，
  //      排在「顶刊 + 被引前 45%」前面 —— 「没证据」不该比「中等证据」得分高；
  //      而「无期刊 + 被引前 10%」会拿 90 分，反超顶刊论文，只因为它的权重没被稀释。
  // 用 50 表示「还不知道」，不奖励也不惩罚，权重结构始终一致。
  let score = Math.round(
    (jScore > 0 ? jScore : NEUTRAL_JOURNAL) * 0.7 + (cScore !== null ? cScore : NEUTRAL_CITATION) * 0.3,
  )

  if (impactFactor !== null) {
    reasons.push(`期刊影响因子 ${impactFactor.toFixed(1)}`)
  } else if (journalHIndex !== null) {
    reasons.push(`期刊 h 指数 ${journalHIndex}`)
  } else if (issn !== '') {
    reasons.push('期刊指标未收录')
  } else {
    reasons.push('未识别到期刊')
  }

  const cites = Number(item?.citations)
  const quartile = quartileOf(percentile)
  if (quartile !== null) {
    reasons.push(`${quartile}（被引前 ${Math.max(1, 100 - Math.round(percentile))}%）`)
  }
  if (Number.isFinite(cites) && cites > 0) reasons.push(`被引 ${cites} 次`)
  if (item?.openAccess === true) {
    // 开放获取意味着能抓全文，对「能不能读懂」是实打实的加分
    score += 4
    reasons.push('开放获取（可抓全文）')
  }
  if (metrics !== null && metrics.isCore === true) reasons.push('核心期刊')

  score = Math.min(100, Math.max(0, score))

  let tier
  // 两个信号都没有 → unknown（「不知道」，不是「差」）。
  // 注意用 cScore === null 而不是 === 0：百分位 0 是「算出来了，排最后」，
  // 那是有效信号，应该判 low 而不是 unknown。
  if (metrics === null && jScore === 0 && cScore === null) tier = 'unknown'
  else if (score >= 60) tier = 'high'
  else if (score >= 35) tier = 'medium'
  else tier = 'low'

  // 中性先验只在「另一个信号确实存在」时用来补权重；两个都没有就是真的不知道，
  // 这时候报 50 分（还叠了 OA 的 +4）会让人以为这是篇中等质量的论文。
  // 归零更诚实，也让它排在所有有证据的论文后面 —— 事实就是没证据。
  if (tier === 'unknown') score = 0

  return {
    score,
    tier,
    reasons,
    impactFactor,
    journalHIndex,
    citationPercentile: percentileScore === null ? null : Number(percentile),
    quartile,
  }
}

/**
 * 批量取期刊指标。返回 `{ issn -> metrics }` 的普通对象，方便直接写缓存。
 * 单个 ISSN 查不到就跳过，不抛错 —— 缺指标只是少一个信号，不该让扫描失败。
 */
export async function fetchJournalMetrics(issns, api) {
  const unique = []
  const seen = new Set()
  for (const value of Array.isArray(issns) ? issns : []) {
    const issn = normalizeIssn(value)
    if (issn === '' || seen.has(issn)) continue
    seen.add(issn)
    unique.push(issn)
  }

  const out = {}
  for (let i = 0; i < unique.length; i += ISSN_BATCH) {
    const chunk = unique.slice(i, i + ISSN_BATCH)
    const filter = `issn:${chunk.join('|')}`
    const url =
      'https://api.openalex.org/sources?filter=' +
      encodeURIComponent(filter) +
      '&select=id,display_name,issn_l,summary_stats,works_count,is_core,is_in_doaj,type&per-page=50' +
      mailtoParam(api)
    let payload
    try {
      payload = JSON.parse(await getText(url))
    } catch {
      continue
    }
    for (const source of Array.isArray(payload?.results) ? payload.results : []) {
      const key = normalizeIssn(source?.issn_l ?? '')
      if (key === '' || !chunk.includes(key)) continue
      const stats = source?.summary_stats !== null && typeof source?.summary_stats === 'object' ? source.summary_stats : {}
      out[key] = {
        name: String(source?.display_name ?? ''),
        twoYearMeanCitedness: Number.isFinite(Number(stats['2yr_mean_citedness']))
          ? Number(stats['2yr_mean_citedness'])
          : null,
        hIndex: Number.isFinite(Number(stats.h_index)) ? Number(stats.h_index) : null,
        i10Index: Number.isFinite(Number(stats.i10_index)) ? Number(stats.i10_index) : null,
        worksCount: Number.isFinite(Number(source?.works_count)) ? Number(source.works_count) : null,
        isCore: source?.is_core === true,
        isInDoaj: source?.is_in_doaj === true,
        type: String(source?.type ?? ''),
      }
    }
  }
  return out
}

/**
 * 期刊指标磁盘缓存。指标变化很慢（一个月一次足够），没必要每轮扫描都请求。
 * 文件放在 dataDir 下，跟 state.json 同级。
 */
export function createJournalCache({ dir }) {
  const file = path.join(dir, 'journals.json')
  let entries = {}
  let loaded = false

  async function load() {
    if (loaded) return entries
    loaded = true
    try {
      const raw = JSON.parse(await fsp.readFile(file, 'utf8'))
      if (raw !== null && typeof raw === 'object' && raw.entries !== null && typeof raw.entries === 'object') {
        entries = raw.entries
      }
    } catch {
      /* 缓存不存在或坏了都当空缓存，下次扫描重建 */
    }
    return entries
  }

  async function save() {
    try {
      await fsp.mkdir(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await fsp.writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8')
      await fsp.rename(tmp, file)
    } catch {
      /* 写缓存失败不影响主流程 */
    }
  }

  function isFresh(entry, now) {
    if (entry === null || typeof entry !== 'object') return false
    const fetchedAt = Date.parse(String(entry.fetchedAt ?? ''))
    if (!Number.isFinite(fetchedAt)) return false
    return now - fetchedAt < JOURNAL_CACHE_DAYS * 86400000
  }

  return {
    file,
    /** 同步查找（调用前需已 ensure()）。 */
    get(issn) {
      const key = normalizeIssn(issn)
      if (key === '') return null
      const entry = entries[key]
      return entry !== null && typeof entry === 'object' ? entry : null
    },
    /** 只含指标的 Map，喂给 paperQuality。 */
    asMap() {
      const map = new Map()
      for (const [key, value] of Object.entries(entries)) {
        if (value !== null && typeof value === 'object') map.set(key, value)
      }
      return map
    },
    /**
     * 确保这些 ISSN 都有新鲜指标：先读缓存，缺的或过期的批量拉一次。
     * 返回本次实际请求的期刊数（0 表示全部命中缓存）。
     */
    async ensure(issns, api, now = Date.now()) {
      await load()
      const stale = []
      for (const value of Array.isArray(issns) ? issns : []) {
        const issn = normalizeIssn(value)
        if (issn === '') continue
        if (!isFresh(entries[issn], now)) stale.push(issn)
      }
      if (stale.length === 0) return 0
      const fetched = await fetchJournalMetrics(stale, api)
      const fetchedAt = new Date(now).toISOString()
      for (const issn of stale) {
        const metrics = fetched[issn]
        if (metrics !== undefined) {
          entries[issn] = { ...metrics, fetchedAt }
        } else {
          // 查不到也记一笔，避免每次扫描都重试同一批冷门期刊
          entries[issn] = { name: '', twoYearMeanCitedness: null, hIndex: null, fetchedAt, missing: true }
        }
      }
      await save()
      return stale.length
    },
  }
}
