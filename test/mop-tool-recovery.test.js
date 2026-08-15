import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } = await import('../packages/mop-tool-recovery/index.js')

function makeCtx() {
  const registered = []
  const ctx = {
    tools: {
      register: (tool) => {
        registered.push(tool)
      },
    },
    fs: {
      resolve: async () => ({}),
      readText: async () => '',
      writeText: async () => {},
    },
    systemPrompt: { section: () => () => {} },
    sandboxPolicy: { resolve: () => ({}) },
    sessions: {
      get: () => undefined,
      fork: () => ({ id: 'child-1' }),
      create: () => ({ id: 'child-1' }),
    },
    sessionPersistence: { readFrom: async () => ({ meta: {}, events: [] }) },
  }
  return { ctx, registered }
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

test('apply registers the four recovery tools', () => {
  const { ctx, registered } = makeCtx()
  apply(ctx)
  assert.deepEqual(registered.map((t) => t.name).sort(), [
    'mop_checkpoint',
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
