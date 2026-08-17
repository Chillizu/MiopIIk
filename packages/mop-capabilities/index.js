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

// 能力清单落点（D27，docs/design/capabilities.md）：项目 .dsh/memory/capabilities.md。
const CAPABILITIES_REL_PATH = '.dsh/memory/capabilities.md'

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

// markdown 表格单元格转义：换行折叠、`|` 转义，防异常消息破坏表格格式。
function escapeCell(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '\\|')
}

function renderManifest(results, cwd) {
  const degraded = results.filter((r) => !r.ok).length
  const status = degraded === 0 ? 'OK' : 'DEGRADED'
  const rows = results
    .map(
      (r) =>
        `| \`${r.seam}\` | ${r.ok ? '[OK]' : '[DEGRADED]'} | ${escapeCell(r.detail)} |`,
    )
    .join('\n')
  return `# DSH Capabilities（能力清单）

> 探测时间：${new Date().toISOString()} | status：${status} | cwd：${cwd} | 由 \`@chillizu/mop-capabilities\` 生成。
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
    const target = await fs.resolve(CAPABILITIES_REL_PATH, { cwd })
    const policy = sandboxPolicy.resolve({ session: agent.session })
    // CAS 写入：观测版本 → replaceIfVersion；缺失 → createIfAbsent。多 root agent
    // 并发探测时不会盲覆盖他人已写的清单（冲突抛 FS_NOT_OBSERVED / FS_STALE_VERSION）。
    const info = await fs.stat(target)
    await fs.writeText(
      target,
      renderManifest(results, cwd),
      info === undefined
        ? { kind: 'createIfAbsent' }
        : { kind: 'replaceIfVersion', version: info.version },
      undefined,
      policy,
    )
    return results
  }

  // 根会话（depth 0）启动时自动探测一次；子代理各自不再重复写。best-effort 异步：
  // 首次工作可能早于 manifest 完成——读清单时检查 status/时间戳，缺失则显式调
  // mop_probe_capabilities。写失败只 console.error，不崩启动。
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
        'Probe DSH seam availability and write the capability manifest (with status OK/DEGRADED) to .dsh/memory/capabilities.md. Call at session start to detect upstream drift instead of assuming contracts from memory; the startup auto-probe is best-effort (async), so call this explicitly to guarantee the manifest is fresh before work.',
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
          ? `capabilities manifest written to ${cwd}/${CAPABILITIES_REL_PATH} (all ${results.length} seams OK)`
          : `capabilities manifest written (degraded: ${degraded.join(', ')})`
      },
    }),
  )
}
