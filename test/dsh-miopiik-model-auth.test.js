import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { apply } = await import('../packages/dsh-miopiik-model-auth/index.js')

const DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

async function withCtx(files = {}, seams = {}, config = {}, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mop-auth-'))
  const path = join(dir, 'model-allowlist.md')
  if (files.allowlist) await writeFile(path, files.allowlist, 'utf8')
  const listeners = {}
  const tools = {}
  const ctx = {
    on: (event, fn) => {
      listeners[event] = fn
    },
    get: (name) => {
      if (name === 'agentDefaultModel')
        return { currentSelection: () => DEFAULT }
      if (name in seams) return seams[name]
      return undefined
    },
    tools: { register: (t) => (tools[t.name] = t) },
  }
  // opts.noPath：不注入绝对 allowlistPath → 走工作区默认路径契约（新契约用例）。
  apply(ctx, opts.noPath ? config : { allowlistPath: path, ...config })
  return { dir, path, listeners, tools }
}

// D31：llm seam 替身——两个 provider，其一枚举正常、其二可按需注入失败。
function fakeLlm({ failProvider = null } = {}) {
  return {
    listProviders: async () => [
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'kimi-coding', name: 'Kimi' },
    ],
    listModels: async (provider) => {
      if (failProvider && provider === failProvider)
        throw new Error('endpoint unreachable')
      if (provider === 'deepseek-official')
        return [
          { provider, id: 'deepseek-v4-flash', name: 'Flash' },
          { provider, id: 'deepseek-v4-pro', name: 'Pro' },
        ]
      return [{ provider, id: 'kimi-k2', name: 'K2' }]
    },
  }
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

test('D31: list 枚举可用模型并标注 默认/已授权', async () => {
  const { tools } = await withCtx(
    { allowlist: 'deepseek-official/deepseek-v4-pro\n' },
    { llm: fakeLlm() },
  )
  const out = await tools['mop_model_list'].execute()
  assert.match(out, /可用模型:/)
  // flash = 默认；pro = 已授权（allowlist）；kimi-k2 可用但未授权（无标注）。
  assert.match(out, /- deepseek-official\/deepseek-v4-flash \[默认\]/)
  assert.match(out, /- deepseek-official\/deepseek-v4-pro \[已授权\]/)
  assert.match(out, /- kimi-coding\/kimi-k2\n/)
})

test('D31: llm seam 缺失时提示不可枚举且不崩', async () => {
  const { tools } = await withCtx()
  const out = await tools['mop_model_list'].execute()
  assert.match(out, /llm 服务未挂载，无法枚举/)
})

test('D31: 单 provider 枚举失败被隔离，其它 provider 照常列出', async () => {
  const { tools } = await withCtx(
    {},
    { llm: fakeLlm({ failProvider: 'kimi-coding' }) },
  )
  const out = await tools['mop_model_list'].execute()
  assert.match(out, /kimi-coding: \(枚举失败: endpoint unreachable\)/)
  assert.match(out, /deepseek-official\/deepseek-v4-flash/)
})

test('D31: config.allowlist 种子放行闸并出现在 list', async () => {
  const { listeners, tools } = await withCtx(
    {},
    {},
    { allowlist: ['acme-cloud/claude-fake'] },
  )
  const config = await listeners['agent/request'](
    { agent: subagent() },
    async () => ({ provider: 'acme-cloud', model: 'claude-fake' }),
  )
  assert.equal(config.model, 'claude-fake')
  const listed = await tools['mop_model_list'].execute()
  // 该用例无 llm seam：种子条目出现在「已授权」段（可用段标注由专门用例覆盖）。
  assert.match(listed, /- acme-cloud\/claude-fake\n/)
})

test('D31: config.allowlist 非法条目在 apply 即抛错', async () => {
  await assert.rejects(
    () => withCtx({}, {}, { allowlist: ['no-slash-entry'] }),
    /config\.allowlist 条目 "no-slash-entry" 非法/,
  )
})

test('D31: revoke 种子条目进程内生效（重启后随配置重新并入）', async () => {
  const { listeners, tools } = await withCtx({}, {}, { allowlist: ['a/b'] })
  await tools['mop_model_revoke'].execute({ provider: 'a', model: 'b' })
  // 同进程内走闸：revoke 后应拒绝。
  await assert.rejects(
    () =>
      listeners['agent/request']({ agent: subagent() }, async () => ({
        provider: 'a',
        model: 'b',
      })),
    /未授权模型 a\/b/,
  )
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

// ── 工作区级授权（收紧后契约）：<cwd>/.dsh/memory/model-allowlist.md ──────────

function execCwd(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

test('工作区级：authorize 默认落到 <cwd>/.dsh/memory/model-allowlist.md', async () => {
  const { tools, dir } = await withCtx({}, {}, {}, { noPath: true })
  const out = await tools['mop_model_authorize'].execute(
    { provider: 'opencode-go', model: 'ws-model' },
    execCwd(dir),
  )
  assert.match(out, /workspace allowlist:/)
  const raw = await readFile(
    join(dir, '.dsh', 'memory', 'model-allowlist.md'),
    'utf8',
  )
  assert.match(raw, /opencode-go\/ws-model/)
})

test('工作区级：闸按 subagent 会话 cwd 解析 allowlist，两个工作区互相隔离', async () => {
  const dirA = await mkdtemp(join(tmpdir(), 'mop-ws-a-'))
  const dirB = await mkdtemp(join(tmpdir(), 'mop-ws-b-'))
  const { tools, listeners } = await withCtx({}, {}, {}, { noPath: true })
  // 在工作区 A 授权
  await tools['mop_model_authorize'].execute(
    { provider: 'openrouter', model: 'x/y' },
    execCwd(dirA),
  )
  // A 的 subagent 放行
  const agentA = {
    session: { header: { id: 'child-a', origin: 'subagent', cwd: dirA } },
  }
  const cfg = await listeners['agent/request']({ agent: agentA }, async () => ({
    provider: 'openrouter',
    model: 'x/y',
  }))
  assert.equal(cfg.model, 'x/y')
  // B 的 subagent 同一模型被拒（隔离）
  const agentB = {
    session: { header: { id: 'child-b', origin: 'subagent', cwd: dirB } },
  }
  await assert.rejects(
    () =>
      listeners['agent/request']({ agent: agentB }, async () => ({
        provider: 'openrouter',
        model: 'x/y',
      })),
    /未授权模型 openrouter\/x\/y/,
  )
})

test('工作区级：list 标注 allowlist 文件路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mop-ws-l-'))
  const { tools } = await withCtx({}, {}, {}, { noPath: true })
  const out = await tools['mop_model_list'].execute(null, execCwd(dir))
  assert.match(
    out,
    new RegExp(
      `allowlist 文件: ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.dsh/memory/model-allowlist.md`,
    ),
  )
})

test('工作区级：相对 allowlistPath 相对工作区根解析', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mop-ws-r-'))
  const { tools } = await withCtx({}, {}, { allowlistPath: 'auth/custom.md' })
  const out = await tools['mop_model_authorize'].execute(
    { provider: 'a', model: 'b' },
    execCwd(dir),
  )
  assert.match(out, /authorized: a\/b/)
  const raw = await readFile(join(dir, 'auth', 'custom.md'), 'utf8')
  assert.match(raw, /a\/b/)
})
