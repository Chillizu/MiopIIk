import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { apply } = await import('../packages/mop-model-auth/index.js')

const DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

async function withCtx(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mop-auth-'))
  const path = join(dir, 'model-allowlist.md')
  if (files.allowlist) await writeFile(path, files.allowlist, 'utf8')
  const listeners = {}
  const tools = {}
  const ctx = {
    on: (event, fn) => {
      listeners[event] = fn
    },
    get: (name) =>
      name === 'agentDefaultModel'
        ? { currentSelection: () => DEFAULT }
        : undefined,
    tools: { register: (t) => (tools[t.name] = t) },
  }
  apply(ctx, { allowlistPath: path })
  return { dir, path, listeners, tools }
}

function subagent(id = 'child-1') {
  return { session: { header: { id, origin: 'subagent' } } }
}

test('闸：subagent + 默认模型放行', async () => {
  const { listeners } = await withCtx()
  const config = await listeners['agent/request'](
    { agent: subagent() },
    async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
  )
  assert.deepEqual(config, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
})

test('闸：subagent + allowlist 模型放行', async () => {
  const { listeners } = await withCtx({ allowlist: 'opencode-go/some-model\n' })
  const config = await listeners['agent/request'](
    { agent: subagent() },
    async () => ({ provider: 'opencode-go', model: 'some-model' }),
  )
  assert.equal(config.model, 'some-model')
})

test('闸：subagent + 未授权模型 throw', async () => {
  const { listeners } = await withCtx()
  await assert.rejects(
    () =>
      listeners['agent/request']({ agent: subagent() }, async () => ({
        provider: 'kimi-coding',
        model: 'kimi-for-coding',
      })),
    /未授权模型 kimi-coding\/kimi-for-coding/,
  )
})

test('闸：主会话（非 subagent）不拦', async () => {
  const { listeners } = await withCtx()
  const config = await listeners['agent/request'](
    { agent: { session: { header: { id: 'root', origin: 'session' } } } },
    async () => ({ provider: 'kimi-coding', model: 'kimi-for-coding' }),
  )
  assert.equal(config.model, 'kimi-for-coding')
})

test('闸：无 model 信息不拦', async () => {
  const { listeners } = await withCtx()
  const config = await listeners['agent/request'](
    { agent: subagent() },
    async () => ({ provider: undefined, model: undefined }),
  )
  assert.deepEqual(config, { provider: undefined, model: undefined })
})

test('mop_model_authorize 追加 allowlist', async () => {
  const { tools, path } = await withCtx()
  const out = await tools['mop_model_authorize'].execute({
    provider: 'opencode-go',
    model: 'model-b',
  })
  assert.match(out, /authorized: opencode-go\/model-b/)
  const raw = await readFile(path, 'utf8')
  assert.match(raw, /opencode-go\/model-b/)
})

test('mop_model_authorize 幂等', async () => {
  const { tools } = await withCtx({ allowlist: 'a/b\n' })
  const out = await tools['mop_model_authorize'].execute({
    provider: 'a',
    model: 'b',
  })
  assert.match(out, /already authorized/)
})

test('mop_model_authorize 拒绝空参数', async () => {
  const { tools } = await withCtx()
  await assert.rejects(
    () => tools['mop_model_authorize'].execute({ provider: '', model: 'x' }),
    /provider 和 model 必填/,
  )
})

test('mop_model_list 显示默认 + allowlist', async () => {
  const { tools } = await withCtx({
    allowlist: 'deepseek-official/deepseek-v4-pro\n',
  })
  const out = await tools['mop_model_list'].execute()
  assert.match(out, /默认模型: deepseek-official\/deepseek-v4-flash/)
  assert.match(out, /deepseek-official\/deepseek-v4-pro/)
})
