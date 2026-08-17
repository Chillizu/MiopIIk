import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'mop-tool-recovery'
export const inject = [
  'tools',
  'fs',
  'sandboxPolicy',
  'sessions',
  'sessionPersistence',
]

// 四个工具的字符串输出声明，抽为公共常量。
const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

// checkpoint 行格式：`- [ISO] label | session=<sid> | seq=<n> [| note]`
const CHECKPOINT_LINE =
  /^- \[[^\]]*\] (.+?) \| session=(\S+) \| seq=(\d+)(?: \| (.*))?\s*$/

// checkpoint 落点（D13，docs/design/recovery-toolkit.md）：项目 .dsh/memory/checkpoints.md，同包内写/读三处必须同一路径。
const CHECKPOINTS_REL_PATH = '.dsh/memory/checkpoints.md'

/** 构造一条 checkpoint 行；与 {@link parseCheckpointLine} 互为 round-trip 契约。 */
export function formatCheckpointLine(label, sid, boundary, note) {
  const time = new Date().toISOString()
  return note
    ? `- [${time}] ${label} | session=${sid} | seq=${boundary} | ${note}\n`
    : `- [${time}] ${label} | session=${sid} | seq=${boundary}\n`
}

/** 解析一条 checkpoint 行；label 精确匹配（非子串），seq 为 inclusive 边界。 */
export function parseCheckpointLine(line) {
  const m = CHECKPOINT_LINE.exec(line)
  if (!m) return null
  return { label: m[1], session: m[2], seq: Number(m[3]), note: m[4] }
}

/** 会话事件流里最后一个 `turn/end` 的 seq；无则 0（fork 到空）。 */
export function lastTurnEndSeq(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') return events[i].seq
  }
  return 0
}

/** 归一化会话 id：补/去 `session-` 前缀，便于 `sessions.get` 命中。 */
export function normalizeSessionId(sessions, id) {
  if (sessions.get(id)) return id
  if (!id.startsWith('session-') && sessions.get('session-' + id))
    return 'session-' + id
  if (id.startsWith('session-') && sessions.get(id.slice('session-'.length)))
    return id.slice('session-'.length)
  return id
}

/** 读文件内容；仅当文件不存在返回空串，权限等其它错误照常抛出。 */
async function readExisting(fs, target) {
  const stat = await fs.stat(target)
  return stat === undefined ? '' : await fs.readText(target)
}

/**
 * 原子追加一行到 checkpoint 文件：CAS（version）防并发会话写覆盖。
 * 冲突（FS_STALE_VERSION / FS_NOT_OBSERVED）重试，其余错误照常抛。
 */
async function appendCheckpoint(fs, target, line, policy) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const info = await fs.stat(target)
    if (info === undefined) {
      try {
        await fs.writeText(
          target,
          line,
          { kind: 'createIfAbsent' },
          undefined,
          policy,
        )
        return
      } catch (error) {
        if (error && error.code === 'FS_NOT_OBSERVED') continue // 并发创建竞争 → 重试
        throw error
      }
    }
    const prev = await fs.readText(target)
    try {
      await fs.writeText(
        target,
        prev + line,
        { kind: 'replaceIfVersion', version: info.version },
        undefined,
        policy,
      )
      return
    } catch (error) {
      if (error && error.code === 'FS_STALE_VERSION') continue // 并发写冲突 → 重试
      throw error
    }
  }
  throw new Error(
    'mop_checkpoint: append failed after retries (concurrent writes)',
  )
}

export function apply(ctx) {
  const { tools, fs, sandboxPolicy, sessions, sessionPersistence } = ctx
  // sessionId -> { disposer, text }；规则状态按会话隔离，避免多会话互相覆盖。
  const ruleState = new Map()

  tools.register(
    defineTool({
      name: 'mop_checkpoint',
      description:
        'Record a recovery point for a session (label + its last completed turn boundary) into .dsh/memory/checkpoints.md. Call at major milestones; a checkpoint is meaningful only across turns — call it at the start of the next turn for the turn just finished.',
      parameters: {
        label: { type: 'string', required: true },
        note: { type: 'string' },
        sessionId: { type: 'string' },
      },
      output: stringOutput,
      async execute(args, exec) {
        const agent = exec.agent
        const cwd =
          agent &&
          agent.session &&
          agent.session.header &&
          agent.session.header.cwd
        if (!cwd) throw new Error('mop_checkpoint: session cwd unavailable')
        let sid
        let events
        if (args.sessionId) {
          sid = normalizeSessionId(sessions, args.sessionId)
          const target = sessions.get(sid)
          events = target
            ? target.events
            : (await sessionPersistence.readFrom(sid, 0)).events
        } else {
          sid = agent.session.id
          events = agent.session.events
        }
        const boundary = lastTurnEndSeq(events)
        const target = await fs.resolve(CHECKPOINTS_REL_PATH, { cwd })
        const line = formatCheckpointLine(args.label, sid, boundary, args.note)
        const policy = sandboxPolicy.resolve({ session: agent.session })
        await appendCheckpoint(fs, target, line, policy)
        return `checkpoint OK: ${args.label} @ session ${sid} seq ${boundary}`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_rewind',
      description:
        'Fork a target session (planner) losslessly back to a named checkpoint boundary and return the child session id. Use when the planner went off-track or you want to try another route. label must exist in checkpoints.md; pass sessionId equal to the session recorded in that checkpoint.',
      parameters: {
        sessionId: { type: 'string', required: true },
        label: { type: 'string', required: true },
      },
      output: stringOutput,
      async execute(args, exec) {
        const agent = exec.agent
        const cwd =
          agent &&
          agent.session &&
          agent.session.header &&
          agent.session.header.cwd
        if (!cwd) throw new Error('mop_rewind: session cwd unavailable')
        const target = await fs.resolve(CHECKPOINTS_REL_PATH, { cwd })
        const cp = await readExisting(fs, target)
        let seq = null
        let cpSession = null
        // 倒序遍历取最新一条（checkpoint 文件只追加，同名 label 后写的才是最新边界）。
        const lines = cp.split('\n')
        for (let i = lines.length - 1; i >= 0; i--) {
          const entry = parseCheckpointLine(lines[i])
          if (entry !== null && entry.label === args.label) {
            seq = entry.seq
            cpSession = entry.session
            break
          }
        }
        if (seq === null)
          throw new Error(`no checkpoint found for label "${args.label}"`)
        const sid = normalizeSessionId(sessions, args.sessionId)
        // 归属校验：checkpoint 记录的 session 必须与传入 sessionId 一致（归一化后比对）。
        // 旧行无 session 字段则跳过校验（向后兼容）。
        if (cpSession && normalizeSessionId(sessions, cpSession) !== sid) {
          throw new Error(
            `mop_rewind: checkpoint "${args.label}" belongs to session ${cpSession}, not ${args.sessionId} — pass the checkpoint's own sessionId`,
          )
        }

        if (sessions.get(sid)) {
          const child = sessions.fork(sid, seq)
          return `rewound (hot): forked ${sid} @ seq ${seq} -> child ${child.id}`
        }
        const read = await sessionPersistence.readFrom(sid, 0)
        if (seq >= read.events.length)
          throw new Error(
            `boundary seq ${seq} out of range (cold session has ${read.events.length} events)`,
          )
        // 与热路径 sessions.fork 一致：seq 为 inclusive 边界（seed = events[0..seq]）。
        const seed = read.events.slice(0, seq + 1)
        const child = sessions.create(undefined, {
          seed,
          meta: {
            ...(read.meta.cwd ? { cwd: read.meta.cwd } : {}),
            parentSession: sid,
            seedLength: seed.length,
          },
        })
        return `rewound (cold): forked ${sid} @ seq ${seq} -> child ${child.id}`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_checkpoint_list',
      description:
        'List every recovery point in .dsh/memory/checkpoints.md (label / session / seq / note) — read this to see what you can rewind to.',
      parameters: {},
      output: stringOutput,
      async execute(_args, exec) {
        const agent = exec.agent
        const cwd =
          agent &&
          agent.session &&
          agent.session.header &&
          agent.session.header.cwd
        if (!cwd)
          throw new Error('mop_checkpoint_list: session cwd unavailable')
        const target = await fs.resolve(CHECKPOINTS_REL_PATH, { cwd })
        const cp = await readExisting(fs, target)
        const entries = cp
          .split('\n')
          .map(parseCheckpointLine)
          .filter((e) => e !== null)
        if (entries.length === 0) return '(no checkpoints)'
        return entries
          .map(
            (e) =>
              `- ${e.label} | session=${e.session} | seq=${e.seq}${e.note ? ` | ${e.note}` : ''}`,
          )
          .join('\n')
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_rule_inject',
      description:
        'Inject a session-scoped rule that overrides default behavior for the current session. Use to freeze a lesson or constraint so later turns obey it. Memory-only (lost on process restart); revoke with mop_rule_clear.',
      parameters: { text: { type: 'string', required: true } },
      output: stringOutput,
      execute(args, exec) {
        const agent = exec.agent
        const sid = agent && agent.session ? agent.session.id : null
        if (sid === null) throw new Error('mop_rule_inject: no calling session')
        // 注册到调用 agent 的作用域（session-scoped），而非插件的 standing scope。
        const sessionPrompt =
          agent.ctx && agent.ctx.get ? agent.ctx.get('systemPrompt') : undefined
        if (sessionPrompt === undefined)
          throw new Error(
            'mop_rule_inject: session-scoped systemPrompt unavailable — refusing to fall back to a process-global rule',
          )
        const prompt = sessionPrompt
        const prev = ruleState.get(sid)
        if (prev && prev.disposer) prev.disposer()
        const disposer = prompt.section({
          name: 'session:rules',
          order: 50,
          text: `会话硬规则（规则注入）：\n${args.text}`,
        })
        ruleState.set(sid, { disposer, text: args.text })
        return `rule injected: ${args.text.slice(0, 120)}`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_rule_show',
      description: 'Show the rules injected for the current session.',
      parameters: {},
      output: stringOutput,
      execute(_args, exec) {
        const agent = exec.agent
        const sid = agent && agent.session ? agent.session.id : null
        const state = sid !== null ? ruleState.get(sid) : undefined
        return state === undefined || state.text === ''
          ? '(no rule injected)'
          : state.text
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_rule_clear',
      description:
        'Clear the session-scoped rules injected by mop_rule_inject for the current session. Memory-only: injected rules are not persisted and are also lost on process restart.',
      parameters: {},
      output: stringOutput,
      execute(_args, exec) {
        const agent = exec.agent
        const sid = agent && agent.session ? agent.session.id : null
        const state = sid !== null ? ruleState.get(sid) : undefined
        if (state !== undefined && state.disposer) state.disposer()
        ruleState.delete(sid)
        return state === undefined ? '(no rule injected)' : 'rules cleared'
      },
    }),
  )
}
