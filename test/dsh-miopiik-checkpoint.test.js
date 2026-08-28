import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { apply } = await import('../packages/dsh-miopiik-checkpoint/index.js')

const SESSION_ID = 'session-ckpt-0000-0000-0000-000000000001'
const CWD = '/home/data/Projects/some-project'
const USER_TEXT = '处理 A 阶段：grep 现状，run 单测，写报告'

// 捕获 ctx.on 注册的监听器，事件由测试手工触发（payload 形状照抄宿主契约）。
function makeCtx() {
  const listeners = {}
  const ctx = {
    on: (event, fn) => {
      listeners[event] = fn
      return () => {}
    },
  }
  return { ctx, listeners }
}

function agentOf(opts = {}) {
  const header = {
    id: opts.id || SESSION_ID,
    cwd: opts.cwd || CWD,
  }
  if (!opts.noDepth) header.delegationDepth = opts.depth ?? 0
  return { session: { header } }
}

const claimed = (agent, turn, text) => ({
  agent,
  turn,
  message: text ? { content: [{ type: 'text', text }] } : { content: [] },
})

async function makeTemp() {
  const dir = await mkdtemp(join(tmpdir(), 'ckpt-'))
  const file = join(dir, 'checkpoints.md')
  return { dir, file }
}

async function lines(file) {
  try {
    const raw = await readFile(file, 'utf8')
    return raw.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

test('根会话一轮：claimed user 消息 + turn-stopping 后落一行 auto-turn', async (t) => {
  const { dir, file } = await makeTemp()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx, { checkpointFile: file })

  const agent = agentOf()
  listeners['agent/inbox/claimed'](claimed(agent, 3, USER_TEXT))
  await listeners['agent/turn-stopping']({ agent, turn: 3, signal: undefined })

  const out = await lines(file)
  assert.equal(out.length, 1)
  assert.match(out[0], /^- \[[0-9]{4}-[0-9]{2}-[0-9]{2}T/) // ISO 时间
  assert.match(out[0], /auto-turn/)
  assert.match(out[0], new RegExp(`session=${SESSION_ID}`))
  assert.match(out[0], /turn=3/)
  assert.ok(out[0].endsWith(`user: ${USER_TEXT}`))
})

test('header 缺 delegationDepth 视为根会话，同样落盘', async (t) => {
  const { dir, file } = await makeTemp()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx, { checkpointFile: file })

  const agent = agentOf({ noDepth: true })
  await listeners['agent/turn-stopping']({ agent, turn: 1 })

  assert.equal((await lines(file)).length, 1)
})

test('同 turn 二次 turn-stopping（steer 重读）只写一次', async (t) => {
  const { dir, file } = await makeTemp()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx, { checkpointFile: file })

  const agent = agentOf()
  listeners['agent/inbox/claimed'](claimed(agent, 5, USER_TEXT))
  await listeners['agent/turn-stopping']({ agent, turn: 5 })
  await listeners['agent/turn-stopping']({ agent, turn: 5 })

  assert.equal((await lines(file)).length, 1)
})

test('子代理（delegationDepth=1）轮次不落盘', async (t) => {
  const { dir, file } = await makeTemp()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx, { checkpointFile: file })

  const agent = agentOf({ depth: 1 })
  listeners['agent/inbox/claimed'](claimed(agent, 2, 'executor 跑任务 1'))
  await listeners['agent/turn-stopping']({ agent, turn: 2 })

  assert.deepEqual(await lines(file), [])
})

test('无 user 文本的轮次写 (no user text)，长文本截断 120 字符', async (t) => {
  const { dir, file } = await makeTemp()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx, { checkpointFile: file })

  const agent = agentOf()
  await listeners['agent/turn-stopping']({ agent, turn: 9 })

  // claimed 空消息不覆盖之前：先空轮验证兜底文案
  assert.ok((await lines(file))[0].endsWith('user: (no user text)'))

  const long = 'x'.repeat(300)
  listeners['agent/inbox/claimed'](claimed(agent, 10, long))
  await listeners['agent/turn-stopping']({ agent, turn: 10 })
  const out = await lines(file)
  assert.equal(out.length, 2)
  assert.ok(out[1].endsWith(`user: ${long.slice(0, 120)}`))
})

test('agent/error 落一行 auto-error（同 turn 重试只记第一条）', async (t) => {
  const { dir, file } = await makeTemp()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx, { checkpointFile: file })

  const agent = agentOf()
  await listeners['agent/error']({
    agent,
    turn: 7,
    step: 2,
    error: new Error('模型闸拒绝 hy3'),
  })
  await listeners['agent/error']({
    agent,
    turn: 7,
    step: 3,
    error: new Error('第二次'),
  })

  const out = await lines(file)
  assert.equal(out.length, 1)
  assert.match(out[0], /auto-error/)
  assert.ok(out[0].endsWith('模型闸拒绝 hy3'))
})

test('session 缺 cwd：不写不炸', async (t) => {
  const { dir, file } = await makeTemp()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx, { checkpointFile: file })

  const agent = { session: { header: { id: SESSION_ID } } } // 无 cwd
  await listeners['agent/turn-stopping']({ agent, turn: 1 })
  assert.deepEqual(await lines(file), [])
})

test('不传 checkpointFile 时默认写到 <cwd>/.dsh/memory/checkpoints.md', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ckpt-cwd-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { ctx, listeners } = makeCtx()
  apply(ctx) // 无 config

  const agent = agentOf({ cwd: dir })
  listeners['agent/inbox/claimed'](claimed(agent, 1, USER_TEXT))
  await listeners['agent/turn-stopping']({ agent, turn: 1 })

  const out = await lines(join(dir, '.dsh', 'memory', 'checkpoints.md'))
  assert.equal(out.length, 1)
  assert.match(out[0], /auto-turn/)
})
