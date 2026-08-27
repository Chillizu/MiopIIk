import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

export const name = 'dsh-miopiik-recall'
export const inject = ['tools']

const execFileAsync = promisify(execFile)

// 会话日志根：~/.dsh/sessions/<cwd-slug>/session-<uuid>/session.jsonl.zstd
// slug 规则与 DSH 一致：路径段以 '-' 连接，整体包 '--'，如 /home/a/b → --home-a-b--。
const DEFAULT_MAX_LINES = 50
const DEFAULT_LINE_CHARS = 400

function slugOf(cwd) {
  return '--' + String(cwd).split('/').filter(Boolean).join('-') + '--'
}

function textOf(block) {
  if (!block || typeof block !== 'object') return ''
  if (block.type === 'text') return block.text || ''
  return ''
}

// 命中的"行"：user/message 与 assistant/message 事件里的纯文本内容。
function messageText(data) {
  const content = data && data.content
  if (Array.isArray(content)) return content.map(textOf).join('')
  if (
    content &&
    typeof content === 'object' &&
    typeof content.text === 'string'
  )
    return content.text
  return ''
}

export const Config = z.object({
  // zstd 可执行文件：默认 'zstd'（PATH 查找）。可通过组合层指向绝对路径。
  zstdBin: z.string(),
  // 会话日志根：默认 ~/.dsh/sessions（DSH 默认布局）；测试/异形布局可覆盖。
  sessionsRoot: z.string(),
  maxLines: z.natural(),
  lineChars: z.natural(),
})

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

export function apply(ctx, config = {}) {
  const zstdBin = config.zstdBin ?? 'zstd'
  const sessionsRoot =
    config.sessionsRoot ?? join(homedir(), '.dsh', 'sessions')
  const maxLines = config.maxLines ?? DEFAULT_MAX_LINES
  const lineChars = config.lineChars ?? DEFAULT_LINE_CHARS

  async function decompress(file) {
    const { stdout } = await execFileAsync(zstdBin, ['-d', '-c', file], {
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout
  }

  async function sessionFiles(cwdDir) {
    let entries = []
    try {
      entries = await readdir(cwdDir, { withFileTypes: true })
    } catch {
      return [] // 无任何会话记录
    }
    const out = []
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith('session-')) continue
      for (const suffix of ['session.jsonl.zstd', 'session.jsonl.zst']) {
        const f = join(cwdDir, e.name, suffix)
        try {
          await stat(f)
          out.push({ sessionId: e.name.slice('session-'.length), file: f })
          break
        } catch {
          /* 该后缀不存在，尝试下一个 */
        }
      }
    }
    out.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
    return out
  }

  async function scanFile(file, query, lower, needle) {
    let raw
    try {
      raw = await decompress(file)
    } catch (error) {
      return {
        skipped: 1,
        error:
          error && error.message
            ? String(error.message).slice(0, 120)
            : String(error),
      }
    }
    const hits = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      let ev
      try {
        ev = JSON.parse(t)
      } catch {
        continue
      }
      if (ev.type !== 'user/message' && ev.type !== 'assistant/message')
        continue
      const text = messageText(ev.data)
      if (!text) continue
      const matched = lower
        ? text.toLowerCase().includes(needle)
        : text.includes(query)
      if (!matched) continue
      hits.push({ time: ev.time, type: ev.type, text })
    }
    return { hits, skipped: 0, error: null }
  }

  ctx.tools.register(
    defineTool({
      name: 'mop_recall',
      description:
        'Recall：查找本会话（scope="session"）或本工作目录全部历史会话（scope="workspace"，默认）中，所有 user/assistant 消息文本包含 query 的行。数据源为 ~/.dsh/sessions 下的会话日志（.jsonl.zstd，经 zstd 解压）。用于追溯之前回合说过/写过的内容：契约、数字结论、已做的决定、步骤号等。返回命中的消息行（时间 + 会话 id + 角色 + 文本，行内截断），并汇总扫描/命中统计。',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            '要检索的字符串（子串匹配；默认忽略大小写，可用 caseSensitive=true 精确匹配）。',
        },
        scope: {
          type: 'string',
          description:
            '"workspace"（默认）：扫描本工作目录所有历史会话；"session"：只扫描当前会话。',
        },
        caseSensitive: {
          type: 'boolean',
          description: '默认 false（忽略大小写）。',
        },
        maxLines: {
          type: 'number',
          description: `最多返回的命中行数，默认 ${DEFAULT_MAX_LINES}。`,
        },
      },
      output: stringOutput,
      async execute(args, exec) {
        const query = String(args.query ?? '').trim()
        if (!query) {
          throw new Error('mop_recall: query 必填（要检索的字符串）')
        }
        const lower = !args.caseSensitive
        const needle = lower ? query.toLowerCase() : query
        const session = exec && exec.agent && exec.agent.session
        const header = session && session.header
        const cwd =
          (header && header.cwd) || (session && session.cwd) || process.cwd()
        const cwdDir = join(sessionsRoot, slugOf(cwd))
        const limit = args.maxLines ?? maxLines
        const scope = args.scope === 'session' ? 'session' : 'workspace'

        const files = await sessionFiles(cwdDir)
        const currentId =
          (header && (header.id || header.sessionId)) || (session && session.id)
        const targets =
          scope === 'session'
            ? files.filter((f) => f.sessionId === currentId)
            : files

        let matched = 0
        let skipped = 0
        let skippedError = null
        const out = []
        for (const t of targets) {
          const r = await scanFile(t.file, query, lower, needle)
          if (r.skipped) {
            skipped += 1
            skippedError = r.error
            continue
          }
          for (const h of r.hits) {
            if (matched >= limit) break
            const time = h.time ? new Date(h.time).toISOString() : '?'
            const role = h.type === 'user/message' ? 'USER' : 'ASSISTANT'
            const text = h.text.replace(/\s+/g, ' ').trim()
            out.push(
              `[${time}] ${t.sessionId} ${role}: ${text.slice(0, lineChars)}`,
            )
            matched += 1
          }
          if (matched >= limit) break
        }
        const headerOut = [
          `recall "${query}" (scope=${scope}, cwd=${cwd}, caseSensitive=${!lower})`,
          `scanned=${targets.length}, matched=${matched}, skipped=${skipped}, sources=${cwdDir}`,
        ]
        if (skipped > 0 && skippedError) {
          headerOut.push(`(zstd 解压失败示例: ${skippedError})`)
        }
        if (matched === 0) {
          headerOut.push('(no hits)')
          return headerOut.join('\n')
        }
        if (matched >= limit) headerOut.push(`(truncated at ${limit} lines)`)
        return [...headerOut, ...out].join('\n')
      },
    }),
  )
}
