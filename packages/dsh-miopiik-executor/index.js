import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-miopiik-executor'
export const inject = ['tools', 'subagents']

// 默认策略（生产由 Loader 按 Config schema 填默认值；直调 apply 时此处兜底）。
const DEFAULT_PROVIDER = 'deepseek-official'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_MAX_OUTPUT_CHARS = 4000

export const Config = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  model: z.string().default(DEFAULT_MODEL),
  maxOutputChars: z.natural().default(DEFAULT_MAX_OUTPUT_CHARS),
  // strict：收紧执行层工具面（去 bash/write）。edit 保留——persona 硬规则 3 本就要求
  // 「只 append 不覆盖」，多轮追加靠 edit；strict 面向不可信任务/来宾场景。
  strict: z.boolean().default(false),
  // D32 动态默认：spawn 未显式指定 model/provider 时，整对继承「调用者当下实际
  // 在用的模型」（经 agent/request waterfall 采样），而非固定 Config 值。
  // 主会话换模型、preset 行覆盖 planner=pro 等，执行层都自动跟随；置 false 回到静态默认。
  followCallerModel: z.boolean().default(true),
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

export function apply(ctx, config = {}) {
  const providerDefault = config.provider ?? DEFAULT_PROVIDER
  const modelDefault = config.model ?? DEFAULT_MODEL
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  const followCallerModel = config.followCallerModel !== false
  const toolFilter =
    config.strict === true ? STRICT_EXECUTOR_TOOL_FILTER : EXECUTOR_TOOL_FILTER

  // D32 调用者模型采样：agent/request waterfall 里每次请求的 {provider,model}
  // 按「发起会话 id」记录最近一次值。工具执行发生在调用者的两个 step 之间，
  // 调用者必然刚发过请求，样本总是新鲜的。FIFO 上限防长驻进程缓慢泄漏；
  // ctx.on 缺失（极简宿主/测试替身）只失去动态默认，静态回退链完整。
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

  // D32 模型解析优先级：
  // 1) args 显式给出 provider/model 任一字段 → 按字段回退 Config 默认（与旧版一致，
  //    不与调用者采样混搭——kimi provider 配 deepseek model 名这类杂交只会制造怪象）；
  // 2) 未显式且 followCallerModel → 整对继承调用者当下模型；
  // 3) 否则 Config 固定默认成对兜底。
  function resolveModel(args, exec) {
    if (args.provider || args.model || !followCallerModel) {
      return {
        provider: args.provider || providerDefault,
        model: args.model || modelDefault,
      }
    }
    const session = exec && exec.agent && exec.agent.session
    const callerId =
      (session && session.header && session.header.id) ||
      (session && session.id)
    const sample = callerId ? callerModels.get(callerId) : undefined
    if (sample) return sample
    return { provider: providerDefault, model: modelDefault }
  }

  ctx.tools.register(
    defineTool({
      name: 'mop_spawn_executor',
      description:
        "Spawn a one-shot executor subagent for one task slice and return its final output. Call N times in one turn for N parallel executors. model/provider optional: when both are omitted the child inherits the CALLER'S current model (dynamic default, Config.followCallerModel); when either is given, the missing field falls back to the configured default. timeoutMs optional (ms, hard timeout that aborts the child).",
      parameters: {
        prompt: { type: 'string', required: true },
        model: { type: 'string' },
        provider: { type: 'string' },
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

          const body = textOf(result.output)
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
