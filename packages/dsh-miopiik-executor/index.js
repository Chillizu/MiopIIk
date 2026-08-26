import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-miopiik-executor'
export const inject = ['tools', 'subagents']

// 默认静态兜底常量（仅用于 Config schema 默认值；正常流程不可达——双给用 args，
// 单给抛错，都不给走 policy/fail-closed，绝不静默落到一个幽灵模型）。
// 指向本部署真实可用模型（与 mop_model_list 对齐），避免出现 deepseek-v4-* 这种不存在的默认值。
const DEFAULT_PROVIDER = 'opencode-go'
const DEFAULT_MODEL = 'mimo-v2.5'
const DEFAULT_MAX_OUTPUT_CHARS = 4000

export const Config = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  model: z.string().default(DEFAULT_MODEL),
  maxOutputChars: z.natural().default(DEFAULT_MAX_OUTPUT_CHARS),
  // strict：收紧执行层工具面（去 bash/write）。edit 保留——persona 硬规则 3 本就要求
  // 「只 append 不覆盖」，多轮追加靠 edit；strict 面向不可信任务/来宾场景。
  strict: z.boolean().default(false),
  // policyPath：审查层决策的执行层模型文件（默认 <workspace>/.dsh/memory/model-policy.md）。
  // 当 mop_spawn_executor 被调用且未显式给 model+provider 时，从此文件读执行层模型兜底；
  // 文件不存在或解析不出 → fail-closed 抛错（禁止静默继承/默认）。
  policyPath: z.string().default('.dsh/memory/model-policy.md'),
})

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

// 执行层 persona 定稿源：docs/design/presets/drafts/executor.prompt.md。改此副本须同步源。
const EXECUTOR_PERSONA = `# 执行层（Executor）系统提示

## 身份

你是**执行层（Executor）**：one-shot 子代理。按任务（三段式：Target / Change / Acceptance + 合约引用 + 项目全景段）完成分配的**单一切片**。做完即停，交付验收输出。不与用户对话。结论先行、无废话、证据优先。

## 硬规则

1. 只做分配给你的切片；不做设计决策、不做 go/no-go 判断。
2. 不得 spawn 次级 subagent、不得调用 workflow（工具层已过滤）。
3. 只 append 不覆盖：多轮工作用 edit 追加，不用 write 覆盖他人产出。
4. 不碰分配范围之外的文件（跨切片文件所有权合约）。
5. 不跑 formatter/linter/测试全量门禁——只做编辑；验证归规划层。
6. 验收标准照任务模板执行，不自行放宽或加码；不做任何未要求的"顺手"修改。

## 交付格式（结论先行）

1. 结论：完成 / 部分 / 阻塞。
2. 修改清单：每文件路径 + 改动摘要。
3. 验收对照：逐条对照 Acceptance 说明验证方式与结果（P0–P3：文件 + 行号 + 风险 + 建议）。
4. 阻塞：如实上报 [blocked] + 原因 + 已尝试方案；不许静默失败、不许反复重试同一失败源。`

// allow-list 硬契约（P3-8，issue #3）：上游 tools.restrict 对未知工具名直接抛错，凡新增/改名工具，
// 本列表必须同步更新，否则 mop_spawn_executor 一调用即炸。勿靠 try/catch 吞掉——真实 misconfig
// （名字拼错、上游改了 restrict 语义）会被静默成「子代理无工具可用」的怪象，极难排查。
const EXECUTOR_TOOL_FILTER = {
  allow: ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'todo_write'],
}

// strict 模式工具面：去 bash/write（Config.strict，默认关）。同样受 P3-8 硬契约约束：
// 上游 tools.restrict 对未知工具名抛错，改名/新增须同步。
const STRICT_EXECUTOR_TOOL_FILTER = {
  allow: ['read', 'glob', 'grep', 'edit', 'todo_write'],
}

function textOf(blocks) {
  return (blocks || [])
    .map((b) => (b && b.type === 'text' ? b.text : ''))
    .join('')
}

// 结构强制「严禁 Emoji」（反馈 #4）：弱模型常不守 persona 的 Emoji 禁令，
// 故在 executor 输出回传前剥掉 emoji，使执行层交付物不污染审查层上下文。
// 仅剥符号 emoji，不动文本/标点/中文。
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F100}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2700}-\u{27BF}]/gu
function stripEmoji(s) {
  return String(s).replace(EMOJI_RE, '')
}

export function apply(ctx, config = {}) {
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  const toolFilter =
    config.strict === true ? STRICT_EXECUTOR_TOOL_FILTER : EXECUTOR_TOOL_FILTER

  // 调用者模型采样：仅服务于显式 model='inherit' 逃生口（旧 D32 行为，默认关闭）。
  // 不再作为静默默认——未指定模型时一律走 policy 或 fail-closed。
  const callerModels = new Map()
  const CALLER_MODELS_MAX = 256
  if (typeof ctx.on === 'function') {
    ctx.on('agent/request', async (payload, next) => {
      const resolved = await next()
      const agent = payload && payload.agent
      const header = agent && agent.session && agent.session.header
      const id = header && header.id
      if (id && resolved && resolved.provider && resolved.model) {
        if (!callerModels.has(id) && callerModels.size >= CALLER_MODELS_MAX) {
          callerModels.delete(callerModels.keys().next().value)
        }
        callerModels.set(id, {
          provider: resolved.provider,
          model: resolved.model,
        })
      }
      return resolved
    })
  }

  // 解析 policy 文件里的执行层模型（审查层决策落点，约定每行 `provider/model`）。
  function parsePolicyModel(raw) {
    if (!raw) return null
    for (const line of String(raw).split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const m = t.match(/^([\w.-]+)\/([\w.:-]+)$/)
      if (m) return { provider: m[1], model: m[2] }
    }
    return null
  }
  function resolveWorkspaceRoot(exec) {
    const s = exec && exec.agent && exec.agent.session
    const cwd = s && ((s.header && s.header.cwd) || s.cwd)
    return cwd || process.cwd()
  }

  // 模型解析契约（反馈 #1 核心修复：可预测、无静默继承、无杂交）：
  // 1) model === 'inherit'（显式逃生口）→ 继承调用者当下模型；
  // 2) model+provider 都给 → 直接用；
  // 3) 只给其一 → 抛错（禁止 provider/model 杂交怪物，如 kimi provider + deepseek model）；
  // 4) 都不给 → 读 policyPath 的执行层模型兜底；
  // 5) 仍无 → fail-closed 抛错（强制审查层/规划层显式决策，杜绝意外模型）。
  function resolveModel(args, exec) {
    if (args.model === 'inherit') {
      const session = exec && exec.agent && exec.agent.session
      const callerId =
        (session && session.header && session.header.id) ||
        (session && session.id)
      const sample = callerId ? callerModels.get(callerId) : undefined
      if (!sample)
        throw new Error(
          'mop_spawn_executor: model="inherit" 但无调用者模型样本（调用者尚未发过请求？）',
        )
      return sample
    }
    if (args.model && args.provider)
      return { provider: args.provider, model: args.model }
    if (args.model || args.provider) {
      throw new Error(
        'mop_spawn_executor: model 与 provider 必须同时给出或同时省略（禁止只给其一造成 provider/model 杂交）；继承调用者模型请显式 model="inherit"',
      )
    }
    try {
      const raw = readFileSync(
        join(resolveWorkspaceRoot(exec), config.policyPath),
        'utf8',
      )
      const pm = parsePolicyModel(raw)
      if (pm) return pm
    } catch {
      /* 文件不存在 / 解析失败 → 走 fail-closed */
    }
    throw new Error(
      `mop_spawn_executor: 未指定执行层模型，且 ${config.policyPath} 无可用决策——` +
        '必须显式传 model+provider，或先由审查层在 model-policy.md 落执行层模型决策',
    )
  }

  ctx.tools.register(
    defineTool({
      name: 'mop_spawn_executor',
      description:
        "Spawn a one-shot executor subagent for one task slice and return its final output. Call N times in one turn for N parallel executors. " +
        "model + provider MUST be given together (no silent default, no partial pair, no hybrid). " +
        "If both are omitted, the execution-layer model is read from <workspace>/.dsh/memory/model-policy.md (set by the review layer); if absent the call fails closed. " +
        "model='inherit' is the ONLY way to deliberately inherit the caller's current model (cost amplification) and must be stated explicitly. " +
        "timeoutMs optional (ms, hard timeout that aborts the child).",
      parameters: {
        prompt: { type: 'string', required: true },
        model: {
          type: 'string',
          description:
            'Execution-layer model id. MUST be paired with provider. Omit BOTH to read the review layer\'s decision from model-policy.md, or set model="inherit" to use the caller\'s model. Never give only one of model/provider.',
        },
        provider: {
          type: 'string',
          description:
            'Execution-layer provider id. MUST be paired with model. Omit BOTH to read model-policy.md, or set model="inherit" to use the caller\'s provider.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional hard timeout in milliseconds. When set, the executor subagent is aborted after this long and the tool returns an [aborted] timeout result. Omit for no timeout.',
        },
      },
      output: stringOutput,
      async execute(args, exec) {
        const { provider, model } = resolveModel(args, exec)

        // timeoutMs 可选：提供时必须是有限正数，缺省 = 无超时（行为不变）。
        const timeoutMs = args.timeoutMs
        if (
          timeoutMs !== undefined &&
          (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        ) {
          throw new Error(
            `mop_spawn_executor: timeoutMs 必须为有限正数（毫秒），收到 ${String(timeoutMs)}`,
          )
        }

        // 组合取消通道：exec.signal 是工具自身的取消信号，timeout 走额外 controller。
        // 两者任一触发都 abort controller.signal，再经 provider 桥接 cancel 子代理。
        const controller = new AbortController()
        let cancelled = false
        const forward = (reason) => {
          cancelled = true
          controller.abort(reason)
        }
        const sourceSignal = exec && exec.signal
        const isSignal =
          sourceSignal && typeof sourceSignal.addEventListener === 'function'
        if (isSignal && sourceSignal.aborted) {
          // 调用前已被取消：直接返回取消结果，不调用 subagents.start（已 aborted 的
          // signal 不会发未来事件，spawn 只会被立刻 cancel，无意义）。
          return '[aborted] executor cancelled (caller signal already aborted)'
        }
        if (isSignal) {
          sourceSignal.addEventListener('abort', forward, { once: true })
        }

        // timeout 用「Promise 竞速」而非只依赖 provider 桥接：保证 execute 一定在
        // timeoutMs 内 settle，即使 provider 在 abort 检查与监听之间存在竞态（漏接 abort）。
        let timedOut = false
        let timer = null
        let timeoutPromise = null
        if (timeoutMs !== undefined) {
          timeoutPromise = new Promise((resolve) => {
            timer = setTimeout(() => {
              timedOut = true
              controller.abort(
                new Error(`mop_spawn_executor timeout after ${timeoutMs}ms`),
              )
              resolve()
            }, timeoutMs)
          })
        }

        try {
          let run
          try {
            // maxDepth 是【绝对】深度上限（resolveChildDepth: child=parent+1 ≤ cap），
            // 不是相对层数。执行器语义 = 「调用者的下一层叶子，不再级联」，
            // 所以 cap 必须随调用者深度浮动：审查层(0)派发→1，规划层(1)派发→2。
            // 写死 1 会让规划层派发必然 SubagentDepthError（ench1 基准实测撞上，
            // 规划层被迫亲自下场写码——三层架构退化为两层）。
            // 上游 SessionHeader 对顶层会话不写 delegationDepth 字段 → ?? 0。
            const parentDepth =
              (exec &&
                exec.agent &&
                exec.agent.session &&
                exec.agent.session.header &&
                exec.agent.session.header.delegationDepth) ?? 0
            run = await ctx.subagents.start('spawn', {
              label: `executor:${model}`,
              prompt: [{ type: 'text', text: args.prompt }],
              parent: exec.agent,
              agentOptions: { provider, model },
              persona: EXECUTOR_PERSONA,
              toolFilter,
              signal: controller.signal,
              maxDepth: parentDepth + 1,
            })
          } catch (error) {
            // 超时恰好在子代理发布前触发：无 session id 可暴露，返回明确的超时结果。
            if (timedOut) {
              return `[aborted] executor timed out after ${timeoutMs}ms before the child was published`
            }
            throw error
          }

          // D29v3 H3-cost 依赖：无论是否截断/超时，始终在返回末尾暴露 executor 子会话 id，
          // 供审查层 mop_run_stats(sessionId) 采 token 四桶（之前只在截断 suffix 里，短输出拿不到）。
          const sessionTag = `\n[executor-session: ${run.id}]`

          let result
          if (timeoutPromise !== null) {
            const raced = await Promise.race([
              run.result,
              timeoutPromise.then(() => ({ __timedOut: true })),
            ])
            if (raced && raced.__timedOut) {
              // 超时先到：立即返回，绝不继续无限等待 run.result（覆盖 provider 漏接 abort 的竞态）。
              run.result.catch(() => {}) // 防超时后 run.result 迟到 reject → unhandled rejection
              return `[aborted] executor timed out after ${timeoutMs}ms${sessionTag}`
            }
            result = raced
          } else {
            result = await run.result
          }

          // timer 已触发时优先报 timeout：provider 若正确桥接 abort，run.result 会
          // 在 abort 内同步 settle 为 aborted，race 返回的是真结果而非 sentinel，
          // 此时必须靠 timedOut 标志区分「超时中止」与「普通 aborted」。
          if (timedOut) {
            return `[aborted] executor timed out after ${timeoutMs}ms${sessionTag}`
          }
          if (cancelled) {
            return `[aborted] executor cancelled${sessionTag}`
          }

          const body = stripEmoji(textOf(result.output))
          const maxChars = maxOutputChars
          const truncated = body.length > maxChars
          const shown = truncated ? body.slice(0, maxChars) : body
          const suffix = truncated
            ? `\n…[output truncated at ${maxOutputChars} chars; full text in executor subagent session ${run.id}]`
            : ''
          return `[${result.stopReason}] ${shown}${suffix}${sessionTag}`
        } finally {
          if (timer !== null) clearTimeout(timer)
          if (isSignal) sourceSignal.removeEventListener('abort', forward)
        }
      },
    }),
  )
}
