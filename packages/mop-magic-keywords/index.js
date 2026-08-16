import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

export const name = 'mop-magic-keywords'

const DEFAULT_NOTICES = {
  ultrathink:
    '【ultrathink】多步推理：先完整想清楚方案再动手；结论先行、证据优先、避免跳步。',
  workflowz:
    '【workflowz】本次任务用 workflow 工具做确定性编排：并行 fan-out 用 parallel()，多阶段流水线用 pipeline()，对抗验证/多视角评审用独立 agent()；进度用 phase()/log()。若当前 preset 未挂载 workflow 工具则忽略此条。',
}

// 关键词列表由 notices 的键派生，单一 dict 保证「关键词 ↔ 文案」不脱节。
export const Config = z.object({
  notices: z.dict(z.string()).default(DEFAULT_NOTICES),
})

function textOf(messages) {
  let out = ''
  for (const m of messages) {
    if (!m || m.role !== 'user') continue
    for (const b of m.content || []) {
      if (b && b.type === 'text') out += `${b.text}\n`
    }
  }
  return out
}

function proseOnly(text) {
  // 去掉 fenced code block 与 inline code，仅保留散文
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
}

export function apply(ctx, config = {}) {
  const notices = config.notices ?? DEFAULT_NOTICES
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const prose = proseOnly(textOf(payload.messages))
    if (!prose) return decision
    const hits = Object.keys(notices).filter((kw) => prose.includes(kw))
    if (hits.length === 0) return decision
    const notice = hits.map((kw) => notices[kw]).join('\n')
    const msg = createUserMessage({
      content: [{ type: 'text', text: notice }],
      source: {
        kind: 'plugin',
        plugin: 'mop-magic-keywords',
        form: 'notice',
        summary: `magic keyword: ${hits.join(', ')}`,
      },
    })
    return { kind: 'enter', messages: [...decision.messages, msg] }
  })
}
