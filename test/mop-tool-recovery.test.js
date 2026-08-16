import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply, formatCheckpointLine, parseCheckpointLine, lastTurnEndSeq } =
  await import('../packages/mop-tool-recovery/index.js')

function makeCtx(overrides = {}) {
  const registered = []
  const writes = []
  const creates = []
  const ctx = {
    tools: {
      register: (tool) => {
        registered.push(tool)
      },
    },
    fs: {
      resolve: async () => ({}),
      stat: async () => ({}),
      readText: async () => '',
      writeText: async (_t, content) => {
        writes.push(content)
      },
    },
    systemPrompt: { section: () => () => {} },
    sandboxPolicy: { resolve: () => ({}) },
    sessions: {
      get: () => undefined,
      fork: () => ({ id: 'child-hot' }),
      create: (_id, opts) => {
        creates.push(opts)
        return { id: 'child-cold' }
      },
    },
    sessionPersistence: {
      readFrom: async () => ({ meta: {}, events: [] }),
    },
    ...overrides,
  }
  return { ctx, registered, writes, creates }
}

function agent(id) {
  return {
    session: { id, header: { cwd: '/tmp' }, events: [] },
    ctx: {
      get: (name) =>
        name === 'systemPrompt' ? { section: () => () => {} } : undefined,
    },
  }
}

test('apply registers the five recovery tools', () => {
  const { ctx, registered } = makeCtx()
  apply(ctx)
  assert.deepEqual(registered.map((t) => t.name).sort(), [
    'mop_checkpoint',
    'mop_checkpoint_list',
    'mop_rewind',
    'mop_rule_inject',
    'mop_rule_show',
  ])
})

test('rule state is session-scoped', () => {
  const { ctx, registered } = makeCtx()
  apply(ctx)
  const inject = registered.find((t) => t.name === 'mop_rule_inject')
  const show = registered.find((t) => t.name === 'mop_rule_show')
  inject.execute({ text: 'rule for A' }, { agent: agent('session-a') })
  assert.equal(show.execute({}, { agent: agent('session-a') }), 'rule for A')
  assert.equal(
    show.execute({}, { agent: agent('session-b') }),
    '(no rule injected)',
  )
})

test('checkpoint line round-trips (golden fixture)', () => {
  const golden =
    '- [2026-01-01T00:00:00.000Z] milestone | session=sess-1 | seq=42 | git@abc1234'
  assert.deepEqual(parseCheckpointLine(golden), {
    label: 'milestone',
    session: 'sess-1',
    seq: 42,
    note: 'git@abc1234',
  })
  const line = formatCheckpointLine('milestone', 'sess-1', 42, 'git@abc1234')
  const parsed = parseCheckpointLine(line)
  assert.equal(parsed.label, 'milestone')
  assert.equal(parsed.session, 'sess-1')
  assert.equal(parsed.seq, 42)
  assert.equal(parsed.note, 'git@abc1234')
})

test('parseCheckpointLine does not substring-match labels', () => {
  const line = formatCheckpointLine('v1-final', 'sess-1', 1, undefined)
  assert.equal(parseCheckpointLine(line).label, 'v1-final')
  assert.notEqual(parseCheckpointLine(line).label, 'v1')
})

test('lastTurnEndSeq finds the last turn/end boundary', () => {
  const events = [
    { type: 'turn/start', seq: 0 },
    { type: 'turn/end', seq: 3 },
    { type: 'turn/start', seq: 4 },
    { type: 'turn/end', seq: 7 },
  ]
  assert.equal(lastTurnEndSeq(events), 7)
  assert.equal(lastTurnEndSeq([]), 0)
})

test('cold rewind seeds through the inclusive boundary and passes meta', async () => {
  const events = [
    { type: 'turn/start', seq: 0 },
    { type: 'tool/call', seq: 1 },
    { type: 'tool/result', seq: 2 },
    { type: 'turn/end', seq: 3 },
    { type: 'turn/start', seq: 4 },
    { type: 'tool/call', seq: 5 },
    { type: 'tool/result', seq: 6 },
    { type: 'turn/end', seq: 7 },
  ]
  const { ctx, registered, creates } = makeCtx({
    fs: {
      resolve: async () => ({}),
      stat: async () => ({}),
      readText: async () =>
        '- [2026-01-01T00:00:00.000Z] milestone | session=sess-cold | seq=7\n',
      writeText: async () => {},
    },
    sessionPersistence: {
      readFrom: async () => ({ meta: { cwd: '/proj' }, events }),
    },
  })
  apply(ctx)
  const rewind = registered.find((t) => t.name === 'mop_rewind')
  const result = await rewind.execute(
    { sessionId: 'sess-cold', label: 'milestone' },
    { agent: agent('session-a') },
  )
  assert.match(result, /cold/)
  assert.equal(creates.length, 1)
  assert.equal(creates[0].seed.length, 8) // events[0..7] inclusive
  assert.equal(creates[0].meta.parentSession, 'sess-cold')
  assert.equal(creates[0].meta.cwd, '/proj')
  assert.equal(creates[0].meta.seedLength, 8)
})

test('hot rewind uses sessions.fork', async () => {
  const forked = []
  const { ctx, registered } = makeCtx({
    fs: {
      resolve: async () => ({}),
      stat: async () => ({}),
      readText: async () =>
        '- [2026-01-01T00:00:00.000Z] milestone | session=sess-hot | seq=3\n',
      writeText: async () => {},
    },
    sessions: {
      get: (id) => (id === 'sess-hot' ? { events: [] } : undefined),
      fork: (sid, seq) => {
        forked.push({ sid, seq })
        return { id: 'child-hot' }
      },
      create: () => ({ id: 'child-cold' }),
    },
  })
  apply(ctx)
  const rewind = registered.find((t) => t.name === 'mop_rewind')
  const result = await rewind.execute(
    { sessionId: 'sess-hot', label: 'milestone' },
    { agent: agent('session-a') },
  )
  assert.match(result, /hot/)
  assert.deepEqual(forked, [{ sid: 'sess-hot', seq: 3 }])
})

test('rewind rejects when checkpoint session does not match sessionId', async () => {
  const { ctx, registered } = makeCtx({
    fs: {
      resolve: async () => ({}),
      stat: async () => ({}),
      readText: async () =>
        '- [2026-01-01T00:00:00.000Z] milestone | session=sess-a | seq=3\n',
      writeText: async () => {},
    },
  })
  apply(ctx)
  const rewind = registered.find((t) => t.name === 'mop_rewind')
  await assert.rejects(
    () =>
      rewind.execute(
        { sessionId: 'sess-b', label: 'milestone' },
        { agent: agent('session-x') },
      ),
    /belongs to session sess-a, not sess-b/,
  )
})

test('mop_checkpoint_list returns parsed entries', async () => {
  const { ctx, registered } = makeCtx({
    fs: {
      resolve: async () => ({}),
      stat: async () => ({}),
      readText: async () =>
        '- [2026-01-01T00:00:00.000Z] a | session=s1 | seq=1\n' +
        '- [2026-01-01T00:00:00.000Z] b | session=s2 | seq=2 | note2\n',
      writeText: async () => {},
    },
  })
  apply(ctx)
  const list = registered.find((t) => t.name === 'mop_checkpoint_list')
  const result = await list.execute({}, { agent: agent('session-a') })
  assert.match(result, /a \| session=s1 \| seq=1/)
  assert.match(result, /b \| session=s2 \| seq=2 \| note2/)
})

test('checkpoint write retries on concurrent version conflict', async () => {
  let statCalls = 0
  let writeCalls = 0
  const expected = []
  const { ctx, registered } = makeCtx({
    fs: {
      resolve: async () => ({}),
      stat: async () => {
        statCalls += 1
        return { version: statCalls }
      },
      readText: async () => '- [t] old | session=s | seq=0\n',
      writeText: async (_t, _content, exp) => {
        writeCalls += 1
        expected.push(exp)
        if (writeCalls === 1)
          throw Object.assign(new Error('changed'), {
            code: 'FS_STALE_VERSION',
          })
      },
    },
  })
  apply(ctx)
  const cp = registered.find((t) => t.name === 'mop_checkpoint')
  const result = await cp.execute({ label: 'x' }, { agent: agent('session-a') })
  assert.match(result, /checkpoint OK/)
  assert.equal(writeCalls, 2) // 第一次冲突，第二次成功
  assert.equal(expected[0].kind, 'replaceIfVersion')
  assert.equal(expected[0].version, 1)
  assert.equal(expected[1].version, 2)
})
