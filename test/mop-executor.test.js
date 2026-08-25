import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } = await import('../packages/mop-executor/index.js')

function makeCtx() {
  const registered = []
  const starts = []
  const ctx = {
    tools: {
      register: (tool) => {
        registered.push(tool)
      },
    },
    subagents: {
      start: async (name, request) => {
        starts.push({ name, request })
        return {
          id: 'exec-session-1',
          result: Promise.resolve({
            stopReason: 'completed',
            output: [{ type: 'text', text: 'done' }],
          }),
        }
      },
    },
  }
  return { ctx, registered, starts }
}

test('mop_spawn_executor passes model + toolFilter and returns output', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  const result = await tool.execute(
    { prompt: 'task', model: 'deepseek-v4-pro' },
    { agent: { session: { id: 's1' } }, signal: 'SIG' },
  )
  assert.match(result, /completed/)
  assert.match(result, /done/)
  assert.match(result, /\[executor-session: exec-session-1\]/)
  assert.equal(starts[0].name, 'spawn')
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-pro')
  assert.equal(starts[0].request.agentOptions.provider, 'deepseek-official')
  // 现在走组合 AbortController：传给 provider 的是 controller.signal（AbortSignal），
  // 而非直接透传 exec.signal（测试里是字符串 'SIG'，无 addEventListener，不桥接）。
  assert.ok(starts[0].request.signal instanceof AbortSignal)
  assert.equal(starts[0].request.signal.aborted, false)
  assert.equal(starts[0].request.maxDepth, 1)
  assert.deepEqual(starts[0].request.toolFilter.allow, [
    'read',
    'write',
    'edit',
    'glob',
    'grep',
    'bash',
    'todo_write',
  ])
})

test('default model is flash', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-flash')
})

test('long output is truncated with a pointer to the executor session', async () => {
  const { ctx, registered } = makeCtx()
  ctx.subagents.start = async () => ({
    id: 'exec-session-1',
    result: Promise.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'x'.repeat(9000) }],
    }),
  })
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  const result = await tool.execute(
    { prompt: 'task' },
    { agent: { session: { id: 's1' } }, signal: 'SIG' },
  )
  assert.match(result, /output truncated at 4000 chars/)
  assert.ok(result.length < 5000)
})

test('timeoutMs aborts the child and returns an [aborted] timeout with session id', async () => {
  const { ctx, registered, starts } = makeCtx()
  // 模拟 provider：signal abort 时才 settle 为 aborted（等价真实 provider 的桥接 cancel）。
  ctx.subagents.start = async (name, request) => {
    starts.push({ name, request })
    const result = new Promise((resolve) => {
      request.signal.addEventListener(
        'abort',
        () => resolve({ stopReason: 'aborted', output: [] }),
        { once: true },
      )
    })
    return { id: 'exec-session-1', result }
  }
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  const result = await tool.execute(
    { prompt: 'task', timeoutMs: 20 },
    { agent: { session: { id: 's1' } } },
  )
  assert.match(result, /\[aborted\] executor timed out after 20ms/)
  assert.match(result, /\[executor-session: exec-session-1\]/)
  assert.equal(starts[0].request.signal.aborted, true)
})

test('timeout before publication with a rejecting start returns timeout (no hang)', async () => {
  const { ctx, registered, starts } = makeCtx()
  // 模拟 provider：signal abort 时 start reject（子代理尚未发布）。
  ctx.subagents.start = async (name, request) => {
    starts.push({ name, request })
    await new Promise((_resolve, reject) => {
      request.signal.addEventListener(
        'abort',
        () => reject(new Error('start aborted before publication')),
        { once: true },
      )
    })
    return {
      id: 'never',
      result: Promise.resolve({ stopReason: 'completed', output: [] }),
    }
  }
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  const result = await tool.execute(
    { prompt: 'task', timeoutMs: 20 },
    { agent: { session: { id: 's1' } } },
  )
  assert.match(
    result,
    /\[aborted\] executor timed out after 20ms before the child was published/,
  )
})

test('timeout when start still resolves but run.result never settles does not hang (race)', async () => {
  const { ctx, registered, starts } = makeCtx()
  // 模拟竞态：start 在超时前已过 abort 检查、之后仍 resolve，但 run.result 永不 settle
  // 且 abort 不触发其 settle（provider 漏接 abort）。execute 必须靠 Promise.race 主动返回。
  ctx.subagents.start = async (name, request) => {
    starts.push({ name, request })
    return { id: 'exec-session-1', result: new Promise(() => {}) }
  }
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  const result = await tool.execute(
    { prompt: 'task', timeoutMs: 20 },
    { agent: { session: { id: 's1' } } },
  )
  assert.match(result, /\[aborted\] executor timed out after 20ms/)
  assert.match(result, /\[executor-session: exec-session-1\]/)
  assert.equal(starts[0].request.signal.aborted, true)
})

test('already-aborted caller signal short-circuits before spawning', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  const caller = new AbortController()
  caller.abort(new Error('user cancelled'))
  const result = await tool.execute(
    { prompt: 'task' },
    { agent: { session: { id: 's1' } }, signal: caller.signal },
  )
  assert.match(result, /\[aborted\] executor cancelled/)
  assert.equal(starts.length, 0) // 未调用 subagents.start
})

test('caller cancellation during the run is distinguished from timeout', async () => {
  const { ctx, registered, starts } = makeCtx()
  ctx.subagents.start = async (name, request) => {
    starts.push({ name, request })
    const result = new Promise((resolve) => {
      request.signal.addEventListener(
        'abort',
        () => resolve({ stopReason: 'aborted', output: [] }),
        { once: true },
      )
    })
    return { id: 'exec-session-1', result }
  }
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  const caller = new AbortController()
  const pending = tool.execute(
    { prompt: 'task' },
    { agent: { session: { id: 's1' } }, signal: caller.signal },
  )
  caller.abort(new Error('user cancelled'))
  const result = await pending
  assert.match(result, /\[aborted\] executor cancelled/)
  assert.doesNotMatch(result, /timed out/)
})

test('timeoutMs rejects non-finite / non-positive values', async () => {
  const { ctx, registered } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  for (const bad of [0, -5, Number.NaN]) {
    await assert.rejects(
      () =>
        tool.execute(
          { prompt: 'task', timeoutMs: bad },
          { agent: { session: { id: 's1' } } },
        ),
      /timeoutMs 必须为有限正数/,
    )
  }
})

test('Config.strict=true drops bash/write from the executor tool face (edit kept)', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx, { strict: true })
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.deepEqual(starts[0].request.toolFilter.allow, [
    'read',
    'glob',
    'grep',
    'edit',
    'todo_write',
  ])
})

test('Config.strict=false keeps the default tool face unchanged', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx, { strict: false })
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.deepEqual(starts[0].request.toolFilter.allow, [
    'read',
    'write',
    'edit',
    'glob',
    'grep',
    'bash',
    'todo_write',
  ])
})
