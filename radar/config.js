/**
 * 插件配置 schema（缺陷 #5：以前只导出 name / inject / apply，用户在 profile
 * 里写 `config:` 时既没有默认值也没有校验）。
 *
 * 这里手写一个 Standard Schema v1（`~standard`）对象，而不是依赖
 * `schemastery`：插件目录在 profile 的 node_modules 之外，走 link 安装后
 * 解析不到那个包，而 DSH 的 loader 只要求 `Config['~standard'].validate`。
 * 手写还能把「未知字段」这类问题报成人类可读的中文消息。
 */

/** 允许的摘要语言。 */
export const CONFIG_LOCALES = ['zh', 'en']

/**
 * 一个字段的描述：类型 + 默认值 + 校验。
 * 只支持本插件真正需要的四种标量类型，够用且没有依赖。
 */
const FIELDS = [
  {
    key: 'dataDir',
    type: 'string',
    fallback: '',
    describe: '数据目录（默认 DSH_HOME/research-radar）',
  },
  {
    key: 'llmProvider',
    type: 'string',
    fallback: '',
    describe: 'LLM provider（留空则用当前会话的默认模型）',
  },
  {
    key: 'llmModel',
    type: 'string',
    fallback: '',
    describe: 'LLM 模型名（留空则用当前会话的默认模型）',
  },
  {
    key: 'locale',
    type: 'string',
    fallback: 'zh',
    describe: '邮件摘要语言：zh 或 en',
    enum: CONFIG_LOCALES,
  },
]

const FIELD_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]))

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 校验并补默认值。未知字段直接忽略（不报错），因为 profile 里可能残留旧版
 * 字段，报错会让整个插件加载失败 —— 那代价太大了。
 * @param {unknown} raw
 * @returns {{ value: Record<string, unknown> } | { issues: { message: string, path?: string[] }[] }}
 */
export function validateConfig(raw) {
  if (raw === undefined || raw === null) raw = {}
  if (!isPlainObject(raw)) {
    return { issues: [{ message: 'config 必须是一个对象' }] }
  }
  const value = {}
  const issues = []
  for (const field of FIELDS) {
    const input = raw[field.key]
    if (input === undefined || input === null) {
      value[field.key] = field.fallback
      continue
    }
    if (field.type === 'string') {
      if (typeof input !== 'string') {
        issues.push({ message: `${field.key} 必须是字符串（${field.describe}）`, path: [field.key] })
        continue
      }
      const trimmed = input.trim()
      if (field.enum !== undefined && trimmed !== '' && !field.enum.includes(trimmed)) {
        issues.push({
          message: `${field.key} 只能是 ${field.enum.join(' / ')}（${field.describe}）`,
          path: [field.key],
        })
        continue
      }
      value[field.key] = trimmed
      continue
    }
    value[field.key] = field.fallback
  }
  if (issues.length > 0) return { issues }
  return { value }
}

/**
 * Standard Schema v1 包装，DSH 的 loader 通过 `plugin.Config['~standard'].validate`
 * 校验 profile 里的 config 并回填默认值。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-research-radar',
    validate(raw) {
      return validateConfig(raw)
    },
  },
  /** 供 panel / 文档展示用的字段说明。 */
  fields: FIELDS.map((field) => ({
    key: field.key,
    type: field.type,
    default: field.fallback,
    ...(field.enum === undefined ? {} : { enum: [...field.enum] }),
    describe: field.describe,
  })),
  /** 取字段默认值，给 `apply` 里兜底用。 */
  defaultOf(key) {
    const field = FIELD_BY_KEY.get(key)
    return field === undefined ? undefined : field.fallback
  },
}
