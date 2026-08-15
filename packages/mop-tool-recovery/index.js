import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'mop-tool-recovery'
export const inject = [
  'tools',
  'fs',
  'systemPrompt',
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

export function apply(ctx) {
  const {
    tools,
    fs,
    systemPrompt,
    sandboxPolicy,
    sessions,
    sessionPersistence,
  } = ctx
  // sessionId -> { disposer, text }；规则状态按会话隔离，避免多会话互相覆盖。
  const ruleState = new Map()

  tools.register(
    defineTool({
      name: 'mop_checkpoint',
      description:
        'Record a checkpoint (label, optional git note, optional target session) at the last completed turn boundary of that session, into .dsh/memory/checkpoints.md.',
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
        const target = await fs.resolve('.dsh/memory/checkpoints.md', { cwd })
        // TODO: append 是全量重写（read + concat + write），checkpoint 多了后 O(n) 且并发会话写同一文件无锁；短期够用。
        const prev = await readExisting(fs, target)
        const line = formatCheckpointLine(args.label, sid, boundary, args.note)
        const policy = sandboxPolicy.resolve({ session: agent.session })
        await fs.writeText(target, prev + line, undefined, undefined, policy)
        return `checkpoint OK: ${args.label} @ session ${sid} seq ${boundary}`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_rewind',
      description:
        'Fork a target session (planner) to a named checkpoint boundary — hot via sessions.fork, cold via persistence read + seeded create — returning the child session id (lossless).',
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
        const target = await fs.resolve('.dsh/memory/checkpoints.md', { cwd })
        const cp = await readExisting(fs, target)
        let seq = null
        for (const line of cp.split('\n')) {
          const entry = parseCheckpointLine(line)
          if (entry !== null && entry.label === args.label) {
            seq = entry.seq
            break
          }
        }
        if (seq === null)
          throw new Error(`no checkpoint found for label "${args.label}"`)
        const sid = normalizeSessionId(sessions, args.sessionId)

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
      name: 'mop_rule_inject',
      description:
        'Inject or replace the session hard rule (TTSR-style) as a prompt section, scoped to the calling session.',
      parameters: { text: { type: 'string', required: true } },
      output: stringOutput,
      execute(args, exec) {
        const agent = exec.agent
        const sid = agent && agent.session ? agent.session.id : null
        if (sid === null) throw new Error('mop_rule_inject: no calling session')
        // 注册到调用 agent 的作用域（session-scoped），而非插件的 standing scope。
        const sessionPrompt =
          agent.ctx && agent.ctx.get ? agent.ctx.get('systemPrompt') : undefined
        const prompt = sessionPrompt || systemPrompt
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
      description:
        'Return the currently injected session rule text for the calling session.',
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
}
