/**
 * 跨源去重键。
 *
 * 同一篇论文从不同数据库抓回来时，`item.id` 一定不同：
 *   openalex:10.1016/j.jsv.2024.118000   （OpenAlex 用 DOI 或 W 号）
 *   crossref:10.1016/j.jsv.2024.118000   （Crossref 用 DOI）
 *   pubmed:38123456                      （PubMed 用 PMID）
 *   arxiv:2401.12345                     （arXiv 用编号）
 * 只按 `item.id` 判重，同一篇论文就会在面板和邮件里重复出现。
 *
 * 这里给出三级规范化键，优先级从强到弱：
 *   1. arXiv 编号  —— 预印本与它的期刊版/OpenAlex 记录能对上（arXiv 的 DOI 是 10.48550/arXiv.xxxx）
 *   2. DOI         —— 期刊论文的稳定标识
 *   3. 标题+年份    —— 既没有 DOI 也没有 arXiv 编号时（RSS、bioRxiv、脏数据）兜底
 * 最弱一级再兜底用 `id:<item.id>`，保证任何条目都有键。
 */

const DOI_URL_PREFIX = /^(?:https?:\/\/)?(?:dx\.)?doi\.org\//
const DOI_PREFIX = /^doi:\s*/i
const ARXIV_URL_PREFIX = /^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\//
const ARXIV_PREFIX = /^arxiv:/i
const ARXIV_VERSION = /v\d+$/i
/** arXiv 官方给每篇预印本分配的 DOI 前缀 */
const ARXIV_DOI_PREFIX = /^10\.48550\/arxiv\./i

/**
 * 规范化 DOI：去掉 https://doi.org/ 前缀、`doi:` 前缀与首尾空白，统一小写。
 * @returns {string} 规范化 DOI，空字符串表示没有
 */
export function normalizeDoi(value) {
  let doi = String(value ?? '').trim()
  if (doi === '') return ''
  doi = doi.replace(DOI_URL_PREFIX, '').replace(DOI_PREFIX, '')
  // 有些源（尤其是 RSS 正文里抄来的）会在句末带一个点
  doi = doi.replace(/[.\s]+$/, '')
  return doi.toLowerCase()
}

/**
 * 规范化 arXiv 编号：去掉 arxiv: 前缀、abs/pdf 链接、`.pdf` 后缀与版本号 v1/v2。
 * @returns {string} 形如 2401.12345 或 hep-th/9901001，空字符串表示没有
 */
export function normalizeArxivId(value) {
  let id = String(value ?? '').trim()
  if (id === '') return ''
  id = id.replace(ARXIV_URL_PREFIX, '').replace(ARXIV_PREFIX, '')
  id = id.replace(/\.pdf$/i, '').replace(ARXIV_VERSION, '')
  return id.trim().toLowerCase()
}

/**
 * 规范化标题：只保留字母与数字（含中文），全部小写。
 * 这样 `Metal Rubber: A Review.` 与 `metal-rubber a review` 得到同一个键。
 * 注意不能用 `[^a-z0-9]` —— 那样纯中文标题会被整条抹成空字符串。
 */
export function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** 从出版日期里取年份；取不到返回空字符串。 */
export function normalizeYear(value) {
  const match = /(\d{4})/.exec(String(value ?? ''))
  return match === null ? '' : match[1]
}

/** 条目里的 arXiv 编号：先看 DOI 是不是 arXiv 分配的，再看 id / source。 */
function arxivIdOf(item) {
  const doi = normalizeDoi(item?.doi)
  if (ARXIV_DOI_PREFIX.test(doi)) return normalizeArxivId(doi.replace(ARXIV_DOI_PREFIX, ''))
  const id = String(item?.id ?? '')
  if (ARXIV_PREFIX.test(id)) return normalizeArxivId(id)
  if (String(item?.source ?? '') === 'arxiv') return normalizeArxivId(id)
  return ''
}

/**
 * 一个条目的全部去重键（从强到弱）。
 * 判重时只要任意一个键已存在就算重复 —— 这样「先抓到 OpenAlex 的 DOI 记录、
 * 后抓到 arXiv 预印本」和反过来都能合并。
 * @returns {string[]}
 */
export function dedupeKeys(item) {
  if (item === null || typeof item !== 'object') return []
  const keys = []
  const push = (key) => {
    if (key !== '' && !keys.includes(key)) keys.push(key)
  }
  const arxivId = arxivIdOf(item)
  if (arxivId !== '') push(`arxiv:${arxivId}`)
  const doi = normalizeDoi(item.doi)
  if (doi !== '') push(`doi:${doi}`)
  const title = normalizeTitle(item.title)
  if (title !== '') push(`t:${title}|${normalizeYear(item.publishedAt)}`)
  const id = String(item.id ?? '').trim().toLowerCase()
  if (id !== '') push(`id:${id}`)
  return keys
}

/**
 * 条目的主去重键（最强的那一个），写进 `state.seen`。
 * @returns {string} 空字符串表示该条目不可用（没有 id、标题、DOI）
 */
export function dedupeKey(item) {
  const keys = dedupeKeys(item)
  return keys.length === 0 ? '' : keys[0]
}

/** 键是不是本模块产出的规范形态（用于识别并迁移旧版 state.json 里的裸 item.id）。 */
export function isCanonicalKey(key) {
  return /^(?:arxiv|doi|t|id):/.test(String(key ?? ''))
}

/**
 * 把旧版 `state.seen`（直接存 `item.id`，形如 `openalex:10.xxx`）里的键
 * 迁移成规范形态 `id:openalex:10.xxx`，否则升级后历史论文会被重新推一遍。
 */
export function migrateSeenKey(key) {
  const value = String(key ?? '').trim()
  if (value === '') return ''
  if (isCanonicalKey(value)) return value
  return `id:${value.toLowerCase()}`
}
