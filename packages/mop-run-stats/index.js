import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'mop-run-stats'
export const inject = ['tools']

// D18 可编程 token 出口：裸遥测，单一职责。定价表 / 成本 / 门判归审查层
//（docs/design/model-routing-experiment.md §3）。无 settings。
export const Config = z.object({})

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'mop_run_stats',
      description:
        '读取一个 session 的累计 token 用量（provider 上报口径，逐 turn/step 折叠，同 step 的 usage 替换不重复计）。返回 uncachedInput / cacheRead / cacheWrite / output 四桶 + 计费输入 / 输出合计，不计算价格或成本。全零桶表示该 session 无 usage 记录——门应判 INCONCLUSIVE 而非 PASS；tokenUsage 键缺失才表示 tokenMeter 未挂载（工具报错）。',
      parameters: {
        sessionId: { type: 'string', required: true },
      },
      output: stringOutput,
      async execute(args) {
        const sessionId = String(args.sessionId ?? '').trim()
        if (!sessionId)
          throw new Error('mop_run_stats: sessionId 必填（executor 子会话 id）')

        let usage
        let asOfSeq

        // live-first：会话仍 live 时同步快照（最新、零 I/O、无 dispose drain 竞态）
        const live = ctx.get('sessions')?.get(sessionId)
        if (live) {
          const snap = ctx.get('sessionProjections')?.snapshot(live)
          usage = snap?.values?.tokenUsage
          asOfSeq = snap?.asOfSeq
        }

        // cold 兜底：已 dispose 会话从持久化投影缓存读（缓存行 + readFrom 尾段重折叠）
        const cache = ctx.get('sessionProjectionCache')
        if (usage === undefined && cache) {
          try {
            const snap = await cache.coldSnapshot(sessionId)
            usage = snap.values.tokenUsage
            asOfSeq = snap.asOfSeq
          } catch (error) {
            throw new Error(
              `mop_run_stats: session ${sessionId} 不存在或未持久化（${String(error)}）`,
            )
          }
        }

        if (usage === undefined) {
          throw new Error(
            'mop_run_stats: tokenUsage 投影不可用（tokenMeter 未挂载）。' +
              'session 存在但无 usage 记录时不会走到这里（会返回全零桶）。',
          )
        }

        // 数值校验：token 桶须为有限非负数值。provider 上报异常（NaN/负/非数值）时
        // 不采信、不求和，直接报错让门判 INCONCLUSIVE，而非污染 cost 计算。
        const bucket = (raw, key) => {
          const n = raw ?? 0
          if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
            throw new Error(
              `mop_run_stats: tokenUsage.${key} 非有限非负数值（${String(raw)}）——provider 上报异常`,
            )
          }
          return n
        }
        const uncachedInputTokens = bucket(
          usage.uncachedInputTokens,
          'uncachedInputTokens',
        )
        const cacheReadTokens = bucket(usage.cacheReadTokens, 'cacheReadTokens')
        const cacheWriteTokens = bucket(
          usage.cacheWriteTokens,
          'cacheWriteTokens',
        )
        const outputTokens = bucket(usage.outputTokens, 'outputTokens')

        return JSON.stringify(
          {
            sessionId,
            asOfSeq,
            uncachedInputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            outputTokens,
            // 计费输入计数（uncached + cacheRead + cacheWrite），非成本
            totalInputTokens:
              uncachedInputTokens + cacheReadTokens + cacheWriteTokens,
            totalOutputTokens: outputTokens,
          },
          null,
          2,
        )
      },
    }),
  )
}
