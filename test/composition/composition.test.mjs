// REAL-composition tests: mount the fixture through the harness's real Cordis
// Loader (boot from @deepseek-ai/dsh-app-boot) instead of the register-mocks
// stubs used by test/*.test.js. Run with: npm run test:composition
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureLinks, HARNESS_ROOT } from './link-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(here, 'cordis.yml')
const CONFIG_WITH_MOP = join(here, 'cordis.with-mop.yml')

/** The real boot entry: packages/boot/app-boot/src/index.ts:757 (built lib). */
let boot
let ctx

before(async () => {
  ensureLinks()
  boot = (
    await import(
      pathToFileURL(join(HARNESS_ROOT, 'packages/boot/app-boot/lib/index.js'))
        .href
    )
  ).boot
  // boot(binName, absoluteConfigPath) mounts the leaf config through the real
  // Loader and settles the tree (app-boot/src/index.ts:757; template in
  // app-boot/tests/app-boot.spec.ts:548).
  ctx = await boot('mop-composition', CONFIG)
})

after(async () => {
  await ctx?.fiber.dispose()
})

test('Loader coerces a Config schema default into apply(config)', () => {
  const entries = [...ctx.loader.entries()]
  const spawn = entries.find(
    (entry) => entry.options.id === 'subagent-spawn-in-process',
  )
  assert.ok(spawn, 'subagent-spawn-in-process entry must be mounted and active')
  // fiber.config is the schema-coerced config the Loader passes as apply's
  // second argument (cordis fiber.ts:655 resolveConfig applies Config defaults).
  // The fixture row carries no config, so providerName must come from the
  // schema default z.string().default('spawn')
  // (packages/subagent/subagent-spawn-in-process/src/index.ts Config).
  assert.equal(spawn.fiber.config.providerName, 'spawn')
  // The default must have reached apply: the provider registered under it.
  assert.ok(ctx.subagents.list().includes('spawn'))
})

test('real spawn driver throws TypeError when a start request lacks signal', async () => {
  // subagents.start('spawn', …) -> provider.start -> startInProcessRun
  // (packages/subagent/subagent-in-process-driver/src/index.ts:102); the driver
  // unconditionally dereferences request.signal.aborted at :107. maxDepth is
  // required by assertSubagentMaxDepth (:106), so it is present; signal is not.
  await assert.rejects(
    ctx.subagents.start('spawn', {
      label: 'composition-negative',
      prompt: [{ type: 'text', text: 'x' }],
      maxDepth: 1,
    }),
    (error) =>
      error instanceof TypeError &&
      /reading 'aborted'/.test(error.message) &&
      error.message.includes('undefined'),
    'missing signal must surface the driver TypeError, not a mock-friendly error',
  )
})

test('real Loader coerces all three mop Config schemas into apply(config)', async () => {
  // Regressions: mop-executor used z.number().int() and mop-model-auth used
  // z.string().optional(), both absent from real schemastery; the mock stub hid
  // them. This boots all three Config-schema packages through the real Loader,
  // so any future bogus schema method fails at boot rather than at a preset
  // switch.
  const ctx2 = await boot('mop-composition', CONFIG_WITH_MOP)
  try {
    const entries = [...ctx2.loader.entries()]
    const exec = entries.find((entry) => entry.options.id === 'mop-executor')
    assert.ok(exec, 'mop-executor entry must be mounted and active')
    assert.equal(exec.fiber.config.maxOutputChars, 4000)
    assert.equal(exec.fiber.config.provider, 'deepseek-official')
    assert.equal(exec.fiber.config.model, 'deepseek-v4-flash')

    const kw = entries.find(
      (entry) => entry.options.id === 'mop-magic-keywords',
    )
    assert.ok(kw, 'mop-magic-keywords entry must be mounted and active')
    assert.ok(
      kw.fiber.config.notices.ultrathink,
      'notices.ultrathink default must be present',
    )
    assert.ok(
      kw.fiber.config.notices.workflowz,
      'notices.workflowz default must be present',
    )

    const auth = entries.find((entry) => entry.options.id === 'mop-model-auth')
    assert.ok(auth, 'mop-model-auth entry must be mounted and active')
    // allowlistPath is optional (no .default), so the Loader leaves it undefined.
    assert.equal(auth.fiber.config.allowlistPath, undefined)
  } finally {
    await ctx2.fiber.dispose()
  }
})
