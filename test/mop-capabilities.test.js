import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } = await import('../packages/mop-capabilities/index.js')

function makeCtx(overrides = {}) {
  const registered = []
  const writes = []
  const ctx = {
    tools: {
      register: (tool) => {
        registered.push(tool)
      },
    },
    fs: {
      resolve: async () => ({}),
      writeText: async (_t, content) => {
        writes.push(content)
      },
    },
    sessions: { list: () => [], fork: () => ({ id: 'x' }) },
    sessionPersistence: {
      listSnapshots: async () => [],
      readFrom: async () => ({ meta: {}, events: [] }),
    },
    sessionQuery: {
      searchSessions: async () => ({ items: [{ sessionId: 's1' }] }),
    },
    systemPrompt: { section: () => () => {} },
    sandboxPolicy: { resolve: () => ({}) },
    on: () => {},
    ...overrides,
  }
  return { ctx, registered, writes }
}

function agent(id) {
  return {
    session: { id, header: { cwd: '/tmp', delegationDepth: 0 } },
  }
}

test('apply registers the probe tool and writes a manifest', async () => {
  const { ctx, registered, writes } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_probe_capabilities')
  assert.ok(tool, 'probe tool registered')
  const result = await tool.execute({}, { agent: agent('session-a') })
  assert.match(result, /capabilities manifest written/)
  assert.equal(writes.length, 1)
  assert.match(writes[0], /sessionPersistence\.listSnapshots/)
  assert.match(writes[0], /sessionQuery\.searchSessions/)
})

test('degraded seam is recorded as DEGRADED', async () => {
  const { ctx, registered, writes } = makeCtx({
    sessionQuery: {
      searchSessions: async () => {
        throw Object.assign(new Error('search disabled'), {
          code: 'SESSION_QUERY_SEARCH_DISABLED',
        })
      },
    },
  })
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_probe_capabilities')
  const result = await tool.execute({}, { agent: agent('session-a') })
  assert.match(result, /degraded: sessionQuery\.searchSessions/)
  assert.match(writes[0], /\[DEGRADED\] \| SESSION_QUERY_SEARCH_DISABLED/)
})
