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
const CONFIG_WITH_EXECUTOR = join(here, 'cordis.with-executor.yml')

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

test('real Loader coerces mop-executor Config defaults into apply(config)', async () => {
  // Regression: mop-executor Config used z.number().int() (absent from real
  // schemastery); the mock stub hid it. Fixed to z.natural(). This asserts the
  // Loader fills defaults into apply's second arg (maxOutputChars 4000).
  const ctx2 = await boot('mop-composition', CONFIG_WITH_EXECUTOR)
  try {
    const entries = [...ctx2.loader.entries()]
    const exec = entries.find((entry) => entry.options.id === 'mop-executor')
    assert.ok(exec, 'mop-executor entry must be mounted and active')
    assert.equal(exec.fiber.config.maxOutputChars, 4000)
    assert.equal(exec.fiber.config.provider, 'deepseek-official')
    assert.equal(exec.fiber.config.model, 'deepseek-v4-flash')
  } finally {
    await ctx2.fiber.dispose()
  }
})
