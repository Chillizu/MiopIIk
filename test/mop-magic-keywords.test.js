import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } = await import('../packages/mop-magic-keywords/index.js')

function captureListener() {
  let listener
  const ctx = {
    on: (_event, fn) => {
      listener = fn
    },
  }
  apply(ctx)
  return listener
}

async function run(prose) {
  const listener = captureListener()
  return listener(
    { messages: [{ role: 'user', content: [{ type: 'text', text: prose }] }] },
    async () => ({ kind: 'enter', messages: [] }),
  )
}

test('keyword in prose triggers notice injection', async () => {
  const decision = await run('please ultrathink about this')
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /ultrathink/)
})

test('keyword inside inline code does not trigger', async () => {
  const decision = await run('use `ultrathink` as a literal')
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 0)
})
