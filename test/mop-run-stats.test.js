import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } = await import('../packages/mop-run-stats/index.js')

function captureTool(services) {
  let tool
  const ctx = {
    get: (name) => services[name],
    tools: { register: (t) => (tool = t) },
  }
  apply(ctx)
  return tool
}

const BUCKETS = {
  uncachedInputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 2,
  cacheWriteTokens: 0,
}

const ZERO = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

test('live-first: 从 live session 快照读取精确桶', async () => {
  const tool = captureTool({
    sessions: { get: (id) => (id === 's-1' ? { id: 's-1' } : undefined) },
    sessionProjections: {
      snapshot: () => ({ asOfSeq: 3, values: { tokenUsage: BUCKETS } }),
    },
  })
  const result = await tool.execute({ sessionId: 's-1' })
  assert.deepEqual(JSON.parse(result), {
    sessionId: 's-1',
    asOfSeq: 3,
    uncachedInputTokens: 10,
    cacheReadTokens: 2,
    cacheWriteTokens: 0,
    outputTokens: 5,
    totalInputTokens: 12,
    totalOutputTokens: 5,
  })
})

test('cold 兜底: live 缺失时走 coldSnapshot 且透传 sessionId', async () => {
  let seen
  const tool = captureTool({
    sessions: { get: () => undefined },
    sessionProjectionCache: {
      coldSnapshot: async (id) => {
        seen = id
        return { asOfSeq: 7, values: { tokenUsage: BUCKETS } }
      },
    },
  })
  const result = await tool.execute({ sessionId: 'cold-9' })
  assert.equal(seen, 'cold-9')
  assert.deepEqual(JSON.parse(result), {
    sessionId: 'cold-9',
    asOfSeq: 7,
    uncachedInputTokens: 10,
    cacheReadTokens: 2,
    cacheWriteTokens: 0,
    outputTokens: 5,
    totalInputTokens: 12,
    totalOutputTokens: 5,
  })
})

test('tokenUsage 键缺失（tokenMeter 未挂载）→ 报错', async () => {
  const tool = captureTool({
    sessions: { get: () => undefined },
    sessionProjectionCache: {
      coldSnapshot: async () => ({ asOfSeq: -1, values: {} }),
    },
  })
  await assert.rejects(
    () => tool.execute({ sessionId: 's-1' }),
    /tokenUsage 投影不可用（tokenMeter 未挂载）/,
  )
})

test('session 不存在/未持久化（coldSnapshot reject）→ 报错', async () => {
  const tool = captureTool({
    sessions: { get: () => undefined },
    sessionProjectionCache: {
      coldSnapshot: async () => {
        throw new Error('not found')
      },
    },
  })
  await assert.rejects(
    () => tool.execute({ sessionId: 'gone' }),
    /session gone 不存在或未持久化/,
  )
})

test('空 sessionId → 报错', async () => {
  const tool = captureTool({})
  await assert.rejects(
    () => tool.execute({ sessionId: '   ' }),
    /sessionId 必填/,
  )
})

test('全零桶不是错误：返回零值（门判 INCONCLUSIVE）', async () => {
  const tool = captureTool({
    sessions: { get: () => undefined },
    sessionProjectionCache: {
      coldSnapshot: async () => ({ asOfSeq: -1, values: { tokenUsage: ZERO } }),
    },
  })
  const result = await tool.execute({ sessionId: 'empty' })
  assert.deepEqual(JSON.parse(result), {
    sessionId: 'empty',
    asOfSeq: -1,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  })
})

test('输出键序稳定（contract anchor）', async () => {
  const tool = captureTool({
    sessions: { get: () => undefined },
    sessionProjectionCache: {
      coldSnapshot: async () => ({
        asOfSeq: 3,
        values: { tokenUsage: BUCKETS },
      }),
    },
  })
  const result = await tool.execute({ sessionId: 's-1' })
  const keys = Object.keys(JSON.parse(result))
  assert.deepEqual(keys, [
    'sessionId',
    'asOfSeq',
    'uncachedInputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'outputTokens',
    'totalInputTokens',
    'totalOutputTokens',
  ])
})
