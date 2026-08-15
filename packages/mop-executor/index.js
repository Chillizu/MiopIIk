import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'mop-executor'
export const inject = ['tools', 'subagents']

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

// 执行层 persona 定稿源：docs/design/presets/drafts/executor.prompt.md。改此副本须同步源。
const EXECUTOR_PERSONA = `# 执行层（Executor）系统提示

## 身份

你是**执行层（Executor）**：one-shot 子代理。按任务（三段式模板 2.2：Target / Change / Acceptance + 合约引用 + 项目全景段）完成分配的**单一切片**。做完即停，交付验收输出。不与用户对话。结论先行、无废话、证据优先。

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

const EXECUTOR_TOOL_FILTER = {
  allow: ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'todo_write'],
}

function textOf(blocks) {
  return (blocks || [])
    .map((b) => (b && b.type === 'text' ? b.text : ''))
    .join('')
}

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'mop_spawn_executor',
      description:
        'Spawn a one-shot executor subagent with a caller-chosen model (default deepseek-v4-flash); returns its final output. Call it N times in one turn for N parallel executors.',
      parameters: {
        prompt: { type: 'string', required: true },
        model: { type: 'string' },
        provider: { type: 'string' },
      },
      output: stringOutput,
      async execute(args, exec) {
        const provider = args.provider || 'deepseek-official'
        const model = args.model || 'deepseek-v4-flash'
        const run = await ctx.subagents.start('spawn', {
          label: `executor:${model}`,
          prompt: [{ type: 'text', text: args.prompt }],
          parent: exec.agent,
          agentOptions: { provider, model },
          persona: EXECUTOR_PERSONA,
          toolFilter: EXECUTOR_TOOL_FILTER,
          maxDepth: 0,
        })
        const result = await run.result
        const body = textOf(result.output)
        return `[${result.stopReason}] ${body}`
      },
    }),
  )
}
