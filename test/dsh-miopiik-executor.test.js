import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } = await import('../packages/dsh-miopiik-executor/index.js')

function makeCtx() {
  const registered = []
  const starts = []
  const listeners = {}
  const ctx = {
    tools: {
      register: (tool) => {
        registered.push(tool)
      },
    },
    // D32：动态默认依赖 agent/request waterfall 采样；真实宿主必有 events，
    // 测试替身在此提供最小 on() 以便喂样本。
    on: (event, fn) => {
      ;(listeners[event] ??= []).push(fn)
      return () => {}
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
  return { ctx, registered, starts, listeners }
}

// 模拟调用者在某会话上刚完成的一次 LLM 请求（waterfall next 返回其解析结果）。
async function sampleCallerModel(listeners, sessionId, provider, model) {
  await listeners['agent/request'][0](
    { agent: { session: { header: { id: sessionId } } } },
    async () => ({ provider, model }),
  )
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
  assert.equal(starts[0].request.maxDepth, 1) // 顶层调用者（header 缺 depth = 0）→ cap 1
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

test('maxDepth is absolute-parent+1: planner (depth 1) can spawn executors', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  // 规划层位于 delegationDepth 1（ench1 基准实测：写死 maxDepth=1 导致
  // SubagentDepthError "depth 2 exceeds maxDepth 1"，规划层被迫亲自下场）。
  await tool.execute(
    { prompt: 'task' },
    { agent: { session: { header: { id: 'p1', delegationDepth: 1 } } } },
  )
  assert.equal(starts[0].request.maxDepth, 2)
  // 更深层调用者同理浮动；执行器仍是调用者的下一层叶子，不可再级联。
  await tool.execute(
    { prompt: 'task' },
    { agent: { session: { header: { id: 'p2', delegationDepth: 2 } } } },
  )
  assert.equal(starts[1].request.maxDepth, 3)
})

test('default model is flash', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-flash')
})

test("D32: no explicit args inherits the caller's current model pair", async () => {
  const { ctx, registered, starts, listeners } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  // 调用者（主会话 s1）刚用 kimi/k2 发过请求 → spawn 不带参数应整对继承。
  await sampleCallerModel(listeners, 's1', 'kimi-coding', 'kimi-k2')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.equal(starts[0].request.agentOptions.provider, 'kimi-coding')
  assert.equal(starts[0].request.agentOptions.model, 'kimi-k2')
})

test('D32: sample follows the latest request (model switch mid-conversation)', async () => {
  const { ctx, registered, starts, listeners } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await sampleCallerModel(listeners, 's1', 'kimi-coding', 'kimi-k2')
  await sampleCallerModel(
    listeners,
    's1',
    'deepseek-official',
    'deepseek-v4-pro',
  )
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-pro')
})

test('D32: explicit model keeps per-field Config fallback (no caller mixing)', async () => {
  const { ctx, registered, starts, listeners } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await sampleCallerModel(listeners, 's1', 'kimi-coding', 'kimi-k2')
  // 只给 model：provider 回退 Config 默认，而非调用者的 kimi-coding——
  // 跨 provider 杂交（kimi provider + deepseek model 名）只会制造怪象。
  await tool.execute(
    { prompt: 'task', model: 'deepseek-v4-pro' },
    { agent: { session: { id: 's1' } } },
  )
  assert.equal(starts[0].request.agentOptions.provider, 'deepseek-official')
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-pro')
})

test('D32: unknown caller session (no sample) falls back to static default', async () => {
  const { ctx, registered, starts, listeners } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await sampleCallerModel(listeners, 'someone-else', 'kimi-coding', 'kimi-k2')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-flash')
  assert.equal(starts[0].request.agentOptions.provider, 'deepseek-official')
})

test('D32: followCallerModel=false restores static default even with a sample', async () => {
  const { ctx, registered, starts, listeners } = makeCtx()
  apply(ctx, { followCallerModel: false })
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await sampleCallerModel(listeners, 's1', 'kimi-coding', 'kimi-k2')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-flash')
  assert.equal(starts[0].request.agentOptions.provider, 'deepseek-official')
})

test('D32: caller sample map is FIFO-bounded', async () => {
  const { ctx, registered, starts, listeners } = makeCtx()
  apply(ctx)
  for (let i = 0; i < 300; i++) {
    await sampleCallerModel(listeners, `session-${i}`, `p${i}`, `m${i}`)
  }
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  // 最老的 session-0..43 已被逐出；session-299 必须仍在。
  await tool.execute(
    { prompt: 'task' },
    { agent: { session: { id: 'session-299' } } },
  )
  assert.equal(starts[0].request.agentOptions.model, 'm299')
  // session-0 已逐出 → 静态默认。
  await tool.execute(
    { prompt: 'task' },
    { agent: { session: { id: 'session-0' } } },
  )
  assert.equal(starts[1].request.agentOptions.model, 'deepseek-v4-flash')
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
