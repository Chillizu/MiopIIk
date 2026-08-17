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
      stat: async () => undefined,
      writeText: async (_t, content, intent) => {
        writes.push({ content, intent })
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
  assert.match(writes[0].content, /sessionPersistence\.listSnapshots/)
  assert.match(writes[0].content, /sessionQuery\.searchSessions/)
  assert.match(writes[0].content, /status：OK/)
  assert.equal(writes[0].intent.kind, 'createIfAbsent')
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
  assert.match(
    writes[0].content,
    /\[DEGRADED\] \| SESSION_QUERY_SEARCH_DISABLED/,
  )
  assert.match(writes[0].content, /status：DEGRADED/)
})

test('detail 字段的 | 与换行被转义，不破坏 markdown 表格', async () => {
  const { ctx, registered, writes } = makeCtx({
    sessionPersistence: {
      listSnapshots: async () => {
        throw new Error('a|b\nc')
      },
      readFrom: async () => ({ meta: {}, events: [] }),
    },
  })
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_probe_capabilities')
  await tool.execute({}, { agent: agent('session-a') })
  assert.match(writes[0].content, /a\\\|b c/)
  assert.doesNotMatch(writes[0].content, /a\|b\nc/)
})

test('已有 manifest 走 replaceIfVersion CAS，不盲覆盖', async () => {
  const { ctx, registered, writes } = makeCtx()
  apply(ctx)
  // 覆盖 fs.stat：第一次返回已存在（version v7）
  const tool = registered.find((t) => t.name === 'mop_probe_capabilities')
  const statImpl = async () => ({ version: 'v7' })
  ctx.fs.stat = statImpl
  await tool.execute({}, { agent: agent('session-a') })
  assert.equal(writes[0].intent.kind, 'replaceIfVersion')
  assert.equal(writes[0].intent.version, 'v7')
})
