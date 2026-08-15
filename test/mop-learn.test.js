import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } = await import('../packages/mop-learn/index.js')

function agent() {
  return { session: { id: 's1', header: { cwd: '/proj' } } }
}

test('mop_learn mints a SKILL.md with frontmatter', async () => {
  const registered = []
  const writes = []
  const ctx = {
    tools: { register: (t) => registered.push(t) },
    fs: {
      resolve: async (path) => ({ path }),
      writeText: async (_t, content) => {
        writes.push({ content })
      },
    },
    sandboxPolicy: { resolve: () => ({}) },
  }
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_learn')
  const result = await tool.execute(
    {
      name: 'deploy-check',
      description: 'Pre-deploy checks',
      content: '## Steps\n1. run tests',
    },
    { agent: agent() },
  )
  assert.match(result, /skill minted/)
  assert.match(writes[0].content, /^---\nname: deploy-check\n/)
  assert.match(writes[0].content, /description: Pre-deploy checks/)
  assert.match(writes[0].content, /## Steps/)
})

test('mop_learn rejects invalid name / empty fields', async () => {
  const registered = []
  const ctx = {
    tools: { register: (t) => registered.push(t) },
    fs: { resolve: async (p) => ({ path: p }), writeText: async () => {} },
    sandboxPolicy: { resolve: () => ({}) },
  }
  apply(ctx)
  const tool = registered.find((t) => t.name === 'mop_learn')
  await assert.rejects(
    () =>
      tool.execute(
        { name: 'Bad Name', description: 'x', content: 'y' },
        { agent: agent() },
      ),
    /invalid skill name/,
  )
  await assert.rejects(
    () =>
      tool.execute(
        { name: 'ok', description: '  ', content: 'y' },
        { agent: agent() },
      ),
    /description required/,
  )
})
