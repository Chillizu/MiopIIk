import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'mop-executor'
export const inject = ['tools', 'subagents']

// 默认策略（生产由 Loader 按 Config schema 填默认值；直调 apply 时此处兜底）。
const DEFAULT_PROVIDER = 'deepseek-official'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_MAX_OUTPUT_CHARS = 4000

export const Config = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  model: z.string().default(DEFAULT_MODEL),
  maxOutputChars: z.natural().default(DEFAULT_MAX_OUTPUT_CHARS),
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

function textOf(blocks) {
  return (blocks || [])
    .map((b) => (b && b.type === 'text' ? b.text : ''))
    .join('')
}

export function apply(ctx, config = {}) {
  const providerDefault = config.provider ?? DEFAULT_PROVIDER
  const modelDefault = config.model ?? DEFAULT_MODEL
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS

  ctx.tools.register(
    defineTool({
      name: 'mop_spawn_executor',
      description:
        'Spawn a one-shot executor subagent for one task slice and return its final output. Call N times in one turn for N parallel executors; model/provider optional (defaults to the configured default model); timeoutMs optional (ms, hard timeout that aborts the child).',
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
        const provider = args.provider || providerDefault
        const model = args.model || modelDefault

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
            run = await ctx.subagents.start('spawn', {
              label: `executor:${model}`,
              prompt: [{ type: 'text', text: args.prompt }],
              parent: exec.agent,
              agentOptions: { provider, model },
              persona: EXECUTOR_PERSONA,
              toolFilter: EXECUTOR_TOOL_FILTER,
              signal: controller.signal,
              maxDepth: 1,
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
