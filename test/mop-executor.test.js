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
    { agent: { session: { id: 's1' } } },
  )
  assert.match(result, /completed/)
  assert.match(result, /done/)
  assert.equal(starts[0].name, 'spawn')
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-pro')
  assert.equal(starts[0].request.agentOptions.provider, 'deepseek-official')
  assert.deepEqual(starts[0].request.toolFilter.allow, [
    'read',
    'write',
    'edit',
    'glob',
    'grep',
    'bash',
    'todo_write',
  ])
  assert.equal(starts[0].request.maxDepth, 0)
})

test('default model is flash', async () => {
  const { ctx, registered, starts } = makeCtx()
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_spawn_executor')
  await tool.execute({ prompt: 'task' }, { agent: { session: { id: 's1' } } })
  assert.equal(starts[0].request.agentOptions.model, 'deepseek-v4-flash')
})
