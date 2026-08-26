import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-miopiik-model-auth'
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
  // D31 静态预授权种子：profile 作者在组合层声明可用的 `provider/model` 行，
  // 免去每次会话的 mop_model_authorize 往返（完全自定义模型的组合层入口）。
  // 与 allowlist 文件取并集生效；运行期 revoke 对种子条目同样生效（进程内），
  // 但重启后随配置重新并入——要永久移除须改配置，不能只 revoke。
  allowlist: z.array(z.string()).default([]),
})

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

export function apply(ctx, config = {}) {
  const allowlistPath = () => config.allowlistPath ?? DEFAULT_ALLOWLIST_PATH
  let cache = null

  // 静态种子在 apply 时一次性校验：非法条目（缺 "/"、空串）直接抛错——
  // misconfig 必须响（与 P3-8「勿吞真实 misconfig」同一立场），静默跳过会让
  // 「预授权没生效」变成难排查的幽灵问题。
  const configSeed = (() => {
    const entries = config.allowlist ?? []
    const set = new Set()
    for (const entry of entries) {
      const t = String(entry).trim()
      if (!t || !t.includes('/')) {
        throw new Error(
          `dsh-miopiik-model-auth: config.allowlist 条目 ${JSON.stringify(String(entry))} 非法——须为 provider/model 形式`,
        )
      }
      set.add(t)
    }
    return set
  })()

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
    // Config.allowlist 种子与文件并集（D31）：种子条目与手工授权同权。
    for (const k of configSeed) cache.add(k)
    return cache
  }

  function defaultKey() {
    // 懒 ctx.get 而非 inject（P2-4，issue #3）：agentDefaultModel 是可选 seam，inject 会让本插件在缺该服务的
    // 部署里加载即失败。授权闸不应因此整体不可用——缺失时返回 null，仅失去「默认模型隐式授权」这条捷径，
    // allowlist 显式授权仍完整工作（fail-closed 语义不变：未授权模型照样被拒）。
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
        `dsh-miopiik-model-auth: subagent ${header.id} 模型信息缺失（provider=${String(provider)}，model=${String(model)}）——` +
          `fail-closed 拒绝放行（INCONCLUSIVE）。检查模型路由是否解析成功，或显式改用默认模型。`,
      )
    }
    if (await isAuthorized(provider, model)) return config
    throw new Error(
      `dsh-miopiik-model-auth: subagent ${header.id} 请求未授权模型 ${provider}/${model}` +
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

  // ── mop_model_list：默认 + allowlist + 可用模型发现面 ──
  ctx.tools.register(
    defineTool({
      name: 'mop_model_list',
      description:
        '列出当前默认模型、已授权模型（allowlist），以及本部署上可路由的可用模型清单（经 llm 服务枚举，标注 [默认]/[已授权]）。给 subagent（如 mop_spawn_executor）选自定义模型前先看这里：可用但未授权的，先 mop_model_authorize。',
      parameters: {},
      output: stringOutput,
      async execute() {
        const set = await loadAllowlist()
        const dk = defaultKey()
        const lines = [`默认模型: ${dk ?? '(无)'}`, `已授权 (${set.size}):`]
        for (const k of [...set].sort()) lines.push(`- ${k}`)

        // 可用模型枚举（D31）：llm 是可选 seam，懒 ctx.get 而非 inject（P2-4）——
        // 缺失时只失去发现面，授权闸完整工作。单 provider 枚举失败不拖垮整体，
        // 部分可用也要如实呈现（错误行内联，不 throw）。
        const llm = ctx.get('llm')
        if (!llm || typeof llm.listProviders !== 'function') {
          lines.push('可用模型: (llm 服务未挂载，无法枚举)')
        } else {
          lines.push('可用模型:')
          try {
            const providers = await llm.listProviders()
            for (const p of providers) {
              let models
              try {
                models = await llm.listModels(p.id)
              } catch (error) {
                const msg =
                  error && error.message ? error.message : String(error)
                lines.push(`- ${p.id}: (枚举失败: ${msg})`)
                continue
              }
              for (const m of models || []) {
                const key = `${m.provider ?? p.id}/${m.id}`
                const tags = []
                if (key === dk) tags.push('默认')
                if (set.has(key)) tags.push('已授权')
                lines.push(
                  `- ${key}${tags.length ? ` [${tags.join('/')}]` : ''}`,
                )
              }
            }
          } catch (error) {
            const msg = error && error.message ? error.message : String(error)
            lines.push(`- (provider 枚举失败: ${msg})`)
          }
        }

        lines.push(
          '自定义流程: mop_model_authorize(provider, model) 授权后，即可 mop_spawn_executor(provider=…, model=…) 使用；config.allowlist 种子条目重启后重新并入，永久移除须改配置',
        )
        return lines.join('\n')
      },
    }),
  )

  // ── mop_model_revoke：从 allowlist 移除 ──
  ctx.tools.register(
    defineTool({
      name: 'mop_model_revoke',
      description:
        '撤销一个 provider/model 的 subagent 授权：从全局模型 allowlist 移除（默认 ~/.dsh/memory/global/model-allowlist.md，可经 config.allowlistPath 覆盖）。当前默认模型隐式授权，无法撤销。',
      parameters: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
      },
      output: stringOutput,
      async execute(args) {
        const provider = (args.provider || '').trim()
        const model = (args.model || '').trim()
        if (!provider || !model)
          throw new Error('mop_model_revoke: provider 和 model 必填')
        const key = `${provider}/${model}`
        return withAuthLock(async () => {
          if (key === defaultKey()) {
            throw new Error(
              `mop_model_revoke: ${key} 是当前默认模型，隐式授权，不在 allowlist，无法撤销`,
            )
          }
          const set = await loadAllowlist()
          if (!set.has(key)) return `not authorized: ${key}`
          const path = allowlistPath()
          let raw = ''
          try {
            raw = await readFile(path, 'utf8')
          } catch {
            /* 不存在则视为空 */
          }
          // 与 loadAllowlist 同一规范化：trim 后跳过空行/注释，去 `- ` 前缀，命中即删。
          // 注释/空行/其它条目原样保留。
          const isTarget = (line) => {
            const t = line.trim()
            if (!t || t.startsWith('#')) return false
            return t.replace(/^-\s*/, '') === key
          }
          const kept = raw.split('\n').filter((line) => !isTarget(line))
          // 可信主机配置直接 writeFile；进程内由 withAuthLock 串行化。跨进程并发 revoke
          // 与 authorize 存在丢行窗口（revoke 是低频运维操作，文档化接受，不引入 fs-seam CAS）。
          await writeFile(path, kept.join('\n'), 'utf8')
          set.delete(key)
          return `revoked: ${key}`
        })
      },
    }),
  )
}
