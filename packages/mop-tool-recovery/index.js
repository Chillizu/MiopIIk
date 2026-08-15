import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'mop-tool-recovery'
export const inject = ['tools']

const text = (v) => [{ type: 'text', text: v }]

function normalizeSessionId(sessions, id) {
  if (sessions.get(id)) return id
  if (!id.startsWith('session-') && sessions.get('session-' + id)) return 'session-' + id
  if (id.startsWith('session-') && sessions.get(id.slice('session-'.length))) return id.slice('session-'.length)
  return id
}

function lastTurnEndSeq(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') return events[i].seq
  }
  return 0
}

export function apply(ctx) {
  const fs = ctx.get('fs')
  const sp = ctx.get('systemPrompt')
  const sandbox = ctx.get('sandboxPolicy')
  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  let ruleDisposer
  let ruleText = ''

  ctx.tools.register(defineTool({
    name: 'mop_checkpoint',
    description: 'Record a checkpoint (label, optional git note, optional target session) at the last completed turn boundary of that session, into .dsh/memory/checkpoints.md.',
    parameters: { label: { type: 'string', required: true }, note: { type: 'string' }, sessionId: { type: 'string' } },
    output: { schema: { type: 'string' }, render(_a, v) { return text(v) } },
    async execute(args, exec) {
      try {
        const agent = exec.agent
        const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
        if (!fs || !cwd) return 'ERROR: fs or cwd unavailable'
        // target session: given id (normalized) else the calling agent's own
        let sid = null
        let events = null
        if (args.sessionId) {
          sid = normalizeSessionId(sessions, args.sessionId)
          const target = sessions.get(sid)
          if (target) { events = target.events }
          else if (persistence) {
            const read = await persistence.readFrom(sid, 0)
            events = read.events
          } else { return 'session "' + args.sessionId + '" not live and no persistence' }
        } else {
          sid = agent.session.id
          events = agent.session.events
        }
        const boundary = lastTurnEndSeq(events)
        const target = await fs.resolve('.dsh/memory/checkpoints.md', { cwd })
        let prev = ''
        try { prev = await fs.readText(target) } catch (_e) { prev = '' }
        const note = args.note ? ' | ' + args.note : ''
        const line = '- [' + new Date().toISOString() + '] ' + args.label + ' | session=' + sid + ' | seq=' + boundary + note + '\n'
        const policy = sandbox && agent ? sandbox.resolve({ session: agent.session }) : undefined
        await fs.writeText(target, prev + line, undefined, undefined, policy)
        return 'checkpoint OK: ' + args.label + ' @ session ' + sid + ' seq ' + boundary
      } catch (error) {
        return 'ERROR: ' + error.message
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mop_rewind',
    description: 'Fork a target session (planner) to a named checkpoint boundary — hot via sessions.fork, cold via persistence read + seeded create — returning the child session id (lossless).',
    parameters: { sessionId: { type: 'string', required: true }, label: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render(_a, v) { return text(v) } },
    async execute(args, exec) {
      try {
        const agent = exec.agent
        const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
        if (!fs || !cwd) return 'ERROR: fs or cwd unavailable'
        const target = await fs.resolve('.dsh/memory/checkpoints.md', { cwd })
        let cp = ''
        try { cp = await fs.readText(target) } catch (_e) { cp = '' }
        let seq = null
        let ckSession = null
        for (const line of cp.split('\n')) {
          if (line.indexOf(args.label) !== -1) {
            const m = line.match(/seq=(\d+)/)
            const s = line.match(/session=(\S+)/)
            if (m) { seq = Number(m[1]); ckSession = s ? s[1] : null; break }
          }
        }
        if (seq === null) return 'no checkpoint found for label "' + args.label + '"'
        const sid = normalizeSessionId(sessions, args.sessionId)

        if (sessions.get(sid)) {
          const child = sessions.fork(sid, seq)
          return 'rewound (hot): forked ' + sid + ' @ seq ' + seq + ' -> child ' + child.id
        }
        if (!persistence) return 'session "' + args.sessionId + '" not live and no persistence'
        const read = await persistence.readFrom(sid, 0)
        if (seq >= read.events.length) return 'boundary seq ' + seq + ' out of range (cold session has ' + read.events.length + ' events)'
        const seed = read.events.slice(0, seq + 1)
        const child = sessions.create(undefined, {
          seed,
          meta: {
            ...(read.meta.cwd ? { cwd: read.meta.cwd } : {}),
            parentSession: sid,
            seedLength: seed.length,
          },
        })
        return 'rewound (cold): forked ' + sid + ' @ seq ' + seq + ' -> child ' + child.id
      } catch (error) {
        return 'ERROR: ' + error.message
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mop_rule_inject',
    description: 'Inject or replace the session hard rule (TTSR-style) as a prompt section.',
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render(_a, v) { return text(v) } },
    execute(args) {
      try {
        if (!sp) return 'ERROR: systemPrompt unavailable'
        if (ruleDisposer) ruleDisposer()
        ruleText = args.text
        ruleDisposer = sp.section({ name: 'session:rules', order: 50, text: '会话硬规则（规则注入）：\n' + args.text })
        return 'rule injected: ' + args.text.slice(0, 120)
      } catch (error) {
        return 'ERROR: ' + error.message
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mop_rule_show',
    description: 'Return the currently injected session rule text.',
    parameters: {},
    output: { schema: { type: 'string' }, render(_a, v) { return text(v) } },
    execute() {
      return ruleText === '' ? '(no rule injected)' : ruleText
    },
  }))
}
