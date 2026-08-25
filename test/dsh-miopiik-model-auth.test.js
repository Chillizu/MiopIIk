import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { apply } = await import('../packages/dsh-miopiik-model-auth/index.js')

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

test('闸：subagent 无 model 信息 fail-closed', async () => {
  const { listeners } = await withCtx()
  await assert.rejects(
    () =>
      listeners['agent/request']({ agent: subagent() }, async () => ({
        provider: undefined,
        model: undefined,
      })),
    /模型信息缺失.*fail-closed/,
  )
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

test('并发 authorize 不丢更新：两个不同模型都落盘', async () => {
  const { tools, path } = await withCtx()
  const [a, b] = await Promise.all([
    tools['mop_model_authorize'].execute({ provider: 'p1', model: 'm1' }),
    tools['mop_model_authorize'].execute({ provider: 'p2', model: 'm2' }),
  ])
  assert.match(a, /authorized: p1\/m1/)
  assert.match(b, /authorized: p2\/m2/)
  const raw = await readFile(path, 'utf8')
  assert.match(raw, /p1\/m1/)
  assert.match(raw, /p2\/m2/)
})

test('mop_model_list 显示默认 + allowlist', async () => {
  const { tools } = await withCtx({
    allowlist: 'deepseek-official/deepseek-v4-pro\n',
  })
  const out = await tools['mop_model_list'].execute()
  assert.match(out, /默认模型: deepseek-official\/deepseek-v4-flash/)
  assert.match(out, /deepseek-official\/deepseek-v4-pro/)
})

test('mop_model_revoke 从 allowlist 移除并同步缓存', async () => {
  const { tools, path } = await withCtx({ allowlist: 'a/b\nc/d\n' })
  const out = await tools['mop_model_revoke'].execute({
    provider: 'a',
    model: 'b',
  })
  assert.match(out, /revoked: a\/b/)
  const raw = await readFile(path, 'utf8')
  assert.doesNotMatch(raw, /a\/b/)
  assert.match(raw, /c\/d/)
  // 缓存同步：list 不再包含已撤销 key
  const listed = await tools['mop_model_list'].execute()
  assert.doesNotMatch(listed, /a\/b/)
  assert.match(listed, /c\/d/)
})

test('mop_model_revoke 对不存在的 key 幂等', async () => {
  const { tools } = await withCtx({ allowlist: 'a/b\n' })
  const out = await tools['mop_model_revoke'].execute({
    provider: 'x',
    model: 'y',
  })
  assert.match(out, /not authorized: x\/y/)
})

test('mop_model_revoke 拒绝撤销当前默认模型', async () => {
  const { tools } = await withCtx({ allowlist: 'a/b\n' })
  await assert.rejects(
    () =>
      tools['mop_model_revoke'].execute({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
      }),
    /当前默认模型/,
  )
})

test('mop_model_revoke 拒绝空参数', async () => {
  const { tools } = await withCtx()
  await assert.rejects(
    () => tools['mop_model_revoke'].execute({ provider: '', model: 'x' }),
    /provider 和 model 必填/,
  )
})

test('mop_model_revoke 保留注释/其它条目与 list 前缀', async () => {
  const { tools, path } = await withCtx({
    allowlist: '# comment\n- a/b\nc/d\n',
  })
  const out = await tools['mop_model_revoke'].execute({
    provider: 'c',
    model: 'd',
  })
  assert.match(out, /revoked: c\/d/)
  const raw = await readFile(path, 'utf8')
  assert.match(raw, /# comment/)
  assert.match(raw, /- a\/b/)
  assert.doesNotMatch(raw, /c\/d/)
})
