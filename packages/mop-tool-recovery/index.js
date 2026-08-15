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

const text = (v) => [{ type: 'text', text: v }]

// checkpoint 行格式：`- [ISO] label | session=<sid> | seq=<n> [| note]`
const CHECKPOINT_LINE =
  /^- \[[^\]]*\] (.+?) \| session=(\S+) \| seq=(\d+)(?: \| (.*))?$/

function normalizeSessionId(sessions, id) {
  if (sessions.get(id)) return id
  if (!id.startsWith('session-') && sessions.get('session-' + id))
    return 'session-' + id
  if (id.startsWith('session-') && sessions.get(id.slice('session-'.length)))
    return id.slice('session-'.length)
  return id
}

function lastTurnEndSeq(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') return events[i].seq
  }
  return 0
}

function parseCheckpointLine(line) {
  const m = CHECKPOINT_LINE.exec(line)
  if (!m) return null
  return { label: m[1], session: m[2], seq: Number(m[3]), note: m[4] }
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
      output: {
        schema: { type: 'string' },
        render(_a, v) {
          return text(v)
        },
      },
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
          if (target) {
            events = target.events
          } else {
            const read = await sessionPersistence.readFrom(sid, 0)
            events = read.events
          }
        } else {
          sid = agent.session.id
          events = agent.session.events
        }
        const boundary = lastTurnEndSeq(events)
        const target = await fs.resolve('.dsh/memory/checkpoints.md', { cwd })
        let prev = ''
        try {
          prev = await fs.readText(target)
        } catch {
          prev = ''
        }
        const note = args.note ? ' | ' + args.note : ''
        const line =
          '- [' +
          new Date().toISOString() +
          '] ' +
          args.label +
          ' | session=' +
          sid +
          ' | seq=' +
          boundary +
          note +
          '\n'
        const policy = sandboxPolicy.resolve({ session: agent.session })
        await fs.writeText(target, prev + line, undefined, undefined, policy)
        return (
          'checkpoint OK: ' +
          args.label +
          ' @ session ' +
          sid +
          ' seq ' +
          boundary
        )
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
      output: {
        schema: { type: 'string' },
        render(_a, v) {
          return text(v)
        },
      },
      async execute(args, exec) {
        const agent = exec.agent
        const cwd =
          agent &&
          agent.session &&
          agent.session.header &&
          agent.session.header.cwd
        if (!cwd) throw new Error('mop_rewind: session cwd unavailable')
        const target = await fs.resolve('.dsh/memory/checkpoints.md', { cwd })
        let cp = ''
        try {
          cp = await fs.readText(target)
        } catch {
          cp = ''
        }
        let seq = null
        for (const line of cp.split('\n')) {
          const entry = parseCheckpointLine(line)
          if (entry !== null && entry.label === args.label) {
            seq = entry.seq
            break
          }
        }
        if (seq === null)
          throw new Error('no checkpoint found for label "' + args.label + '"')
        const sid = normalizeSessionId(sessions, args.sessionId)

        if (sessions.get(sid)) {
          const child = sessions.fork(sid, seq)
          return (
            'rewound (hot): forked ' +
            sid +
            ' @ seq ' +
            seq +
            ' -> child ' +
            child.id
          )
        }
        const read = await sessionPersistence.readFrom(sid, 0)
        if (seq >= read.events.length)
          throw new Error(
            'boundary seq ' +
              seq +
              ' out of range (cold session has ' +
              read.events.length +
              ' events)',
          )
        const seed = read.events.slice(0, seq + 1)
        const child = sessions.create(undefined, {
          seed,
          meta: {
            ...(read.meta.cwd ? { cwd: read.meta.cwd } : {}),
            parentSession: sid,
            seedLength: seed.length,
          },
        })
        return (
          'rewound (cold): forked ' +
          sid +
          ' @ seq ' +
          seq +
          ' -> child ' +
          child.id
        )
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_rule_inject',
      description:
        'Inject or replace the session hard rule (TTSR-style) as a prompt section, scoped to the calling session.',
      parameters: { text: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render(_a, v) {
          return text(v)
        },
      },
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
          text: '会话硬规则（规则注入）：\n' + args.text,
        })
        ruleState.set(sid, { disposer, text: args.text })
        return 'rule injected: ' + args.text.slice(0, 120)
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'mop_rule_show',
      description:
        'Return the currently injected session rule text for the calling session.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render(_a, v) {
          return text(v)
        },
      },
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
