import z from '@deepseek-ai/schemastery'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const name = 'dsh-miopiik-checkpoint'
export const inject = []

// 里程碑自动检查点（0.1.13）：
// 根会话每轮关闭时把一行恢复点追加到 <cwd>/.dsh/memory/checkpoints.md，
// 不再依赖会话自觉调用 mop_checkpoint——弱模型不守 persona 规则（初版反馈
// 核心之一），记忆落盘必须由结构事件驱动，不能靠提示词约束。
//
// 事件契约（宿主 agent 事件，Scoped<Agent> 作用域投递）：
//   agent/inbox/claimed   (emit,  Scoped<Agent>) — 本轮 user 消息原文
//   agent/turn-stopping   (serial, Scoped<Agent>) — 轮关闭前；同 turn 可能多次
//                                                   触发（监听器 steer 后重读
//                                                   inbox），须按 turn 去重
//   agent/error           (emit,  Scoped<Agent>) — 轮/步出错
// Scoped<Agent> 只把事件投递给该 agent 作用域内注册的监听器：本插件以 preset
// 行按会话实例化，天然只收到自己会话的事件，无需按 sessionId 过滤。
//
// 只对根会话（delegationDepth 0 或缺省）落盘：子代理（executor 等）轮次高频,
// 全写会立刻把 checkpoints.md 冲成噪音。子代理的关键结论由父会话的消息摘要
// 承载，不需要独立恢复点。

export const Config = z.object({
  // 覆盖检查点文件路径（测试/异形布局）；缺省时 apply 内回落
  // <cwd>/.dsh/memory/checkpoints.md（同 recall 的 required-Config + ?? 兜底约定）。
  checkpointFile: z.string(),
})

const SUMMARY_CHARS = 120

function textOf(block) {
  if (!block || typeof block !== 'object') return ''
  if (block.type === 'text') return block.text || ''
  return ''
}

// 消息文本解析：content 为 ContentBlock[] 或 { text }（与 recall 同一形状）。
function messageText(content) {
  if (Array.isArray(content)) return content.map(textOf).join('')
  if (
    content &&
    typeof content === 'object' &&
    typeof content.text === 'string'
  )
    return content.text
  return ''
}

export function apply(ctx, config = {}) {
  const overrideFile = config.checkpointFile || null
  // 同 turn 多次 turn-stopping 只写一次。
  const writtenTurns = new Set()
  // turn -> 该轮最后一条 claimed 的 user 消息文本。
  const claimedByTurn = new Map()
  // turn -> 该轮是否已记 error（重试多次只保留第一条）。
  const erroredTurns = new Set()

  function rootOf(agent) {
    if (!agent || !agent.session) return null
    const session = agent.session
    const header = session.header || session
    const depth = header.delegationDepth ?? 0
    if (depth !== 0) return null
    return {
      id: header.id || header.sessionId || session.id || '',
      cwd: header.cwd || session.cwd || '',
    }
  }

  async function appendLine(agent, line) {
    const root = rootOf(agent)
    if (!root || !root.cwd) return
    const file =
      overrideFile || join(root.cwd, '.dsh', 'memory', 'checkpoints.md')
    try {
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, line + '\n', 'utf8')
    } catch (error) {
      // turn-stopping 是 serial 事件、会被 await：绝不能因落盘失败砸掉轮关闭。
      console.warn(
        `[dsh-miopiik-checkpoint] append failed: ${
          (error && error.message) || error
        }`,
      )
    }
  }

  ctx.on('agent/inbox/claimed', ({ message, turn }) => {
    const text = messageText(message && message.content)
      .replace(/\s+/g, ' ')
      .trim()
    if (text) claimedByTurn.set(turn, text)
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    if (writtenTurns.has(turn)) return
    writtenTurns.add(turn)
    const root = rootOf(agent)
    if (!root) return
    const user = (claimedByTurn.get(turn) || '').slice(0, SUMMARY_CHARS)
    const line = [
      `- [${new Date().toISOString()}] auto-turn`,
      `session=${root.id}`,
      `turn=${turn}`,
      `user: ${user || '(no user text)'}`,
    ].join(' | ')
    await appendLine(agent, line)
  })

  ctx.on('agent/error', async ({ agent, turn, error }) => {
    if (erroredTurns.has(turn)) return
    erroredTurns.add(turn)
    const root = rootOf(agent)
    if (!root) return
    const detail = String((error && error.message) || error)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SUMMARY_CHARS)
    const line = [
      `- [${new Date().toISOString()}] auto-error`,
      `session=${root.id}`,
      `turn=${turn}`,
      detail || '(no detail)',
    ].join(' | ')
    await appendLine(agent, line)
  })
}
