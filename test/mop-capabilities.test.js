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

// 真实 SessionHeader 语义：根会话的 delegationDepth **缺省（absent）**，
// 只有 subagent 子会话才写 >= 1（dsh-session types.ts）。fixture 不得显式写 0——
// 那曾把 `depth !== 0` 的条件 bug 掩盖成永远通过（issue #3）。
function agent(id) {
  return {
    session: { id, header: { cwd: '/tmp' } },
  }
}

function subagentAgent(id) {
  return {
    session: { id, header: { cwd: '/tmp', delegationDepth: 1 } },
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

// P1-1 回归（issue #3）：自动探测曾在真实环境永不触发——根会话 header 的
// delegationDepth 是 absent，旧条件 `depth !== 0` 把 undefined 当非零跳过。
// 下面两条直接驱动捕获到的 agent/created 监听器，锁定真实语义。
function makeListenerCtx() {
  let listener
  const { ctx, writes } = makeCtx({
    on: (event, fn) => {
      if (event === 'agent/created') listener = fn
      return () => {}
    },
  })
  return { ctx, writes, fire: (payload) => listener(payload) }
}

async function flushAsync() {
  // writeManifest 内部有多次 await（probe → resolve → stat → writeText），
  // 用宏任务等它落地。
  await new Promise((resolve) => setTimeout(resolve, 10))
}

test('agent/created：根会话（delegationDepth absent）触发自动探测写清单', async () => {
  const { ctx, writes, fire } = makeListenerCtx()
  apply(ctx)
  fire({ agent: agent('session-root') })
  await flushAsync()
  assert.equal(writes.length, 1)
  assert.match(writes[0].content, /# DSH Capabilities/)
})

test('agent/created：子代理（delegationDepth >= 1）不触发自动探测', async () => {
  const { ctx, writes, fire } = makeListenerCtx()
  apply(ctx)
  fire({ agent: subagentAgent('session-sub') })
  await flushAsync()
  assert.equal(writes.length, 0)
})
