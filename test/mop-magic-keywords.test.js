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

function injectedText(decision) {
  return decision.messages.map((m) => m.content[0].text).join('\n')
}

test('keyword in prose triggers notice injection', async () => {
  const decision = await run('please ultrathink about this')
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1)
  assert.match(injectedText(decision), /ultrathink/)
})

test('keyword inside inline code does not trigger', async () => {
  const decision = await run('use `ultrathink` as a literal')
  assert.equal(decision.messages.length, 0)
})

test('keyword inside fenced code block does not trigger', async () => {
  const decision = await run(
    'here is a snippet:\n```\nworkflowz(parallel(...))\n```\n',
  )
  assert.equal(decision.messages.length, 0)
})

test('two keywords in one message inject both notices', async () => {
  const decision = await run('ultrathink then workflowz this fan-out')
  assert.equal(decision.messages.length, 1)
  const text = injectedText(decision)
  assert.match(text, /ultrathink/)
  assert.match(text, /workflowz/)
})

test('keyword embedded in a longer ASCII word does not trigger', async () => {
  const decision = await run('this is superultrathink territory')
  assert.equal(decision.messages.length, 0)
})

test('keyword with ASCII suffix does not trigger', async () => {
  const decision = await run('stop ultrathinking now')
  assert.equal(decision.messages.length, 0)
})

test('keyword in CJK context triggers (CJK is a natural boundary)', async () => {
  const decision = await run('请用ultrathink来做这件事')
  assert.equal(decision.messages.length, 1)
  assert.match(injectedText(decision), /ultrathink/)
})

test('keyword followed by CJK punctuation triggers', async () => {
  const decision = await run('ultrathink、然后 workflowz')
  assert.equal(decision.messages.length, 1)
  assert.match(injectedText(decision), /ultrathink/)
})
