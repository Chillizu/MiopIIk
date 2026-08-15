import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'mop-capabilities'
export const inject = [
  'tools',
  'fs',
  'sessions',
  'sessionPersistence',
  'sessionQuery',
  'systemPrompt',
  'sandboxPolicy',
]

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

/** 探测一个 seam；结果条目：{ seam, ok, detail }。 */
async function probe(ctx) {
  const results = []

  const present = (seam, fn) =>
    results.push({
      seam,
      ok: typeof fn === 'function',
      detail: typeof fn === 'function' ? 'primitive present' : 'missing',
    })

  present('sessions.list', ctx.sessions && ctx.sessions.list)
  present('sessions.fork', ctx.sessions && ctx.sessions.fork)
  present(
    'sessionPersistence.readFrom',
    ctx.sessionPersistence && ctx.sessionPersistence.readFrom,
  )
  present('systemPrompt.section', ctx.systemPrompt && ctx.systemPrompt.section)
  present(
    'sandboxPolicy.resolve',
    ctx.sandboxPolicy && ctx.sandboxPolicy.resolve,
  )

  try {
    const snapshots = await ctx.sessionPersistence.listSnapshots()
    results.push({
      seam: 'sessionPersistence.listSnapshots',
      ok: true,
      detail: `${snapshots.length} snapshots`,
    })
  } catch (e) {
    results.push({
      seam: 'sessionPersistence.listSnapshots',
      ok: false,
      detail: e && e.message ? e.message : String(e),
    })
  }

  try {
    const page = await ctx.sessionQuery.searchSessions({
      query: 'capability-probe',
    })
    results.push({
      seam: 'sessionQuery.searchSessions',
      ok: true,
      detail: `${page.items.length} hits`,
    })
  } catch (e) {
    results.push({
      seam: 'sessionQuery.searchSessions',
      ok: false,
      detail: e && e.code ? e.code : e && e.message ? e.message : String(e),
    })
  }

  return results
}

function renderManifest(results, cwd) {
  const rows = results
    .map(
      (r) =>
        `| \`${r.seam}\` | ${r.ok ? '[OK]' : '[DEGRADED]'} | ${r.detail} |`,
    )
    .join('\n')
  return `# DSH Capabilities（能力清单）

> 探测时间：${new Date().toISOString()} | cwd：${cwd} | 由 \`@chillizu/mop-capabilities\` 生成。
> 读此文件了解当前部署 seam 可用性；**勿凭记忆假设上游契约**（DSH 尚在 rc，seam 语义可能流动）。

## 探测结果

| seam | 状态 | 详情 |
|---|---|---|
${rows}
`
}

export function apply(ctx) {
  const { tools, fs, sandboxPolicy } = ctx

  async function writeManifest(agent) {
    const cwd =
      agent && agent.session && agent.session.header && agent.session.header.cwd
    if (!cwd) throw new Error('mop-capabilities: session cwd unavailable')
    const results = await probe(ctx)
    const target = await fs.resolve('.dsh/memory/capabilities.md', { cwd })
    const policy = sandboxPolicy.resolve({ session: agent.session })
    await fs.writeText(
      target,
      renderManifest(results, cwd),
      undefined,
      undefined,
      policy,
    )
    return results
  }

  // 根会话（depth 0）启动时自动探测一次；子代理各自不再重复写。
  ctx.on('agent/created', (payload) => {
    const agent = payload && payload.agent
    const depth =
      agent &&
      agent.session &&
      agent.session.header &&
      agent.session.header.delegationDepth
    if (depth !== 0) return
    writeManifest(agent).catch((error) => {
      console.error('mop-capabilities: startup probe failed', error)
    })
  })

  tools.register(
    defineTool({
      name: 'mop_probe_capabilities',
      description:
        'Probe DSH seams (sessions/sessionPersistence/sessionQuery/systemPrompt/sandboxPolicy) and write a capabilities manifest to .dsh/memory/capabilities.md; use at session start to detect upstream drift.',
      parameters: {},
      output: stringOutput,
      async execute(_args, exec) {
        const agent = exec.agent
        const results = await writeManifest(agent)
        const cwd =
          agent &&
          agent.session &&
          agent.session.header &&
          agent.session.header.cwd
        const degraded = results.filter((r) => !r.ok).map((r) => r.seam)
        return degraded.length === 0
          ? `capabilities manifest written to ${cwd}/.dsh/memory/capabilities.md (all ${results.length} seams OK)`
          : `capabilities manifest written (degraded: ${degraded.join(', ')})`
      },
    }),
  )
}
