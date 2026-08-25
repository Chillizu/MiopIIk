import { test } from 'node:test'
import assert from 'node:assert/strict'

const { apply } =
  await import('../packages/dsh-miopiik-magic-keywords/index.js')

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

function listenerWithConfig(config) {
  let listener
  const ctx = {
    on: (_event, fn) => {
      listener = fn
    },
  }
  apply(ctx, config)
  return listener
}

test('enabled=false 关闭整条隐式控制流', async () => {
  const listener = listenerWithConfig({ enabled: false })
  const decision = await listener(
    {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'please ultrathink' }],
        },
      ],
    },
    async () => ({ kind: 'enter', messages: [] }),
  )
  assert.equal(decision.messages.length, 0)
})

test('自定义 notices 与默认合并，不整体替换默认', async () => {
  const listener = listenerWithConfig({
    notices: { focusmode: '【focusmode】聚焦单线程推进。' },
  })
  const decision = await listener(
    {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'ultrathink then focusmode' }],
        },
      ],
    },
    async () => ({ kind: 'enter', messages: [] }),
  )
  const text = injectedText(decision)
  assert.match(text, /ultrathink/) // 默认仍保留
  assert.match(text, /focusmode/) // 新增关键词也生效
})
