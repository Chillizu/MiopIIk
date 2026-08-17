import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'mop-model-auth'
export const inject = ['tools']

// 全局模型 allowlist：每行 `provider/model`（支持 `#` 注释、`- ` list 前缀）。
// 默认路径是设计契约（docs/design/model-auth.md），可经 config.allowlistPath 覆盖。
//
// 可信配置路径：allowlist 是全局主机级配置（~/.dsh/memory/global/…），非工作区产物，
// 故直接经 node:fs/promises 读写，不经 DSH fs/sandboxPolicy seam。这是有意设计，
// 不是 sandbox 绕过——工作区内的写仍受 sandbox 约束；此文件是用户显式维护的授权清单。
const DEFAULT_ALLOWLIST_PATH = join(
  homedir(),
  '.dsh',
  'memory',
  'global',
  'model-allowlist.md',
)

export const Config = z.object({
  // schemastery 无 .optional()：字段默认即 optional（.required() 才强制）。
  allowlistPath: z.string(),
})

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

export function apply(ctx, config = {}) {
  const allowlistPath = () => config.allowlistPath ?? DEFAULT_ALLOWLIST_PATH
  let cache = null

  // 授权写入串行化（进程内）：check-then-append 整段入锁，防并发 authorize 丢更新
  // （lost-update）。跨进程由 appendFile 的 O_APPEND 原子追加兜底。
  let authQueue = Promise.resolve()
  function withAuthLock(fn) {
    const run = authQueue.then(fn, fn)
    authQueue = run.then(
      () => {},
      () => {},
    )
    return run
  }

  async function loadAllowlist() {
    if (cache !== null) return cache
    let raw = ''
    try {
      raw = await readFile(allowlistPath(), 'utf8')
    } catch {
      /* 文件不存在 = 空 allowlist */
    }
    cache = new Set(
      raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.replace(/^-\s*/, '')),
    )
    return cache
  }

  function defaultKey() {
    const s = ctx.get('agentDefaultModel')?.currentSelection()
    return s && s.provider && s.model ? `${s.provider}/${s.model}` : null
  }

  async function isAuthorized(provider, model) {
    // 调用方已做 fail-closed 前置校验（provider/model 非空），此处不再兜底放行。
    const key = `${provider}/${model}`
    const dk = defaultKey()
    if (dk !== null && key === dk) return true
    return (await loadAllowlist()).has(key)
  }

  // ── 硬闸：agent/request 全局 waterfall（覆盖所有 subagent 派发路径） ──
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const agent = payload && payload.agent
    const header = agent && agent.session && agent.session.header
    if (!header || header.origin !== 'subagent') return config // 只闸 subagent，主会话 model 由用户自选
    const provider = config && config.provider
    const model = config && config.model
    // fail-closed（审查层要求）：subagent 模型信息缺失时拒绝，不静默放行。
    // 缺失意味着模型路由未成功解析；放行会让未授权模型溜进子代理，故按
    // INCONCLUSIVE 语义硬拒并给出指引。主会话不经过此分支。
    if (!provider || !model) {
      throw new Error(
        `mop-model-auth: subagent ${header.id} 模型信息缺失（provider=${String(provider)}，model=${String(model)}）——` +
          `fail-closed 拒绝放行（INCONCLUSIVE）。检查模型路由是否解析成功，或显式改用默认模型。`,
      )
    }
    if (await isAuthorized(provider, model)) return config
    throw new Error(
      `mop-model-auth: subagent ${header.id} 请求未授权模型 ${provider}/${model}` +
        `（默认=${defaultKey() ?? '无'}，不在 allowlist）。` +
        `授权：mop_model_authorize(provider="${provider}", model="${model}")；` +
        `或改用默认模型。`,
    )
  })

  // ── mop_model_authorize：追加 allowlist ──
  ctx.tools.register(
    defineTool({
      name: 'mop_model_authorize',
      description:
        '授权一个 provider/model 供 subagent 使用：追加到全局模型 allowlist（默认 ~/.dsh/memory/global/model-allowlist.md，可经 config.allowlistPath 覆盖）。资源对象授权，非动作授权。',
      parameters: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
      },
      output: stringOutput,
      async execute(args) {
        const provider = (args.provider || '').trim()
        const model = (args.model || '').trim()
        if (!provider || !model)
          throw new Error('mop_model_authorize: provider 和 model 必填')
        const key = `${provider}/${model}`
        // 整段 check-then-append 入锁：set.has 早退也在锁内，否则两个并发调用
        // 会同时通过 exists 检查并追加重复行。
        return withAuthLock(async () => {
          const set = await loadAllowlist()
          if (set.has(key)) return `already authorized: ${key}`
          const path = allowlistPath()
          await mkdir(dirname(path), { recursive: true })
          let raw = ''
          try {
            raw = await readFile(path, 'utf8')
          } catch {
            /* 不存在则新建 */
          }
          const sep = raw && !raw.endsWith('\n') ? '\n' : ''
          await appendFile(path, `${sep}${key}\n`, 'utf8')
          set.add(key)
          return `authorized: ${key}`
        })
      },
    }),
  )

  // ── mop_model_list：展示默认 + allowlist ──
  ctx.tools.register(
    defineTool({
      name: 'mop_model_list',
      description: '列出当前默认模型与已授权的 subagent 模型（allowlist）。',
      parameters: {},
      output: stringOutput,
      async execute() {
        const set = await loadAllowlist()
        const lines = [
          `默认模型: ${defaultKey() ?? '(无)'}`,
          `已授权 (${set.size}):`,
        ]
        for (const k of [...set].sort()) lines.push(`- ${k}`)
        lines.push(
          'allowlist 缓存于首次读取/授权时刷新；手工编辑文件需重启会话生效',
        )
        return lines.join('\n')
      },
    }),
  )
}
