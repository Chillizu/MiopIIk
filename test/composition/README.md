# REAL-composition tests

Mount the mop fixture through the **real** harness Cordis stack — `boot()` from
`@deepseek-ai/dsh-app-boot`, the real `cordis-plugin-loader`, and the real
`@deepseek-ai/dsh-*` services — instead of the `register-mocks.mjs` stubs used
by `test/*.test.js`.

## Run

```sh
npm run test:composition
```

Requires the DSH harness checkout at `/opt/deepseek-harness` (override with
`DSH_HARNESS_ROOT=/path/to/harness`). `link-harness.mjs` symlinks the real
packages into `test/composition/node_modules` (config-dir bare-name resolution)
and `node_modules/@deepseek-ai` (mop-executor's own imports); the links are
idempotent and gitignored.

## What it proves

1. **Loader coerces Config defaults into `apply(config)`** — the
   `subagent-spawn-in-process` row carries no config, and the real Loader fills
   `providerName: 'spawn'` from the schema default (asserted on
   `entry.fiber.config` and on the registered provider name).
2. **Real driver TypeError on missing signal** — `ctx.subagents.start('spawn',
…)` without `signal` reaches `startInProcessRun`
   (`packages/subagent/subagent-in-process-driver/src/index.ts:102`) and throws
   `TypeError: Cannot read properties of undefined (reading 'aborted')` at
   `:107`. The mock tests cannot see this.
3. **Canary for a second real bug** — mounting `mop-executor` through the real
   Loader fails: its `Config` uses `z.number().int()`
   (`packages/mop-executor/index.js:15`), which does not exist in real
   `@deepseek-ai/schemastery@3.18.1` (nor original `schemastery@3.18.0`); the
   harness idiom is `z.natural()` (cf. `dsh-tools` Config). The mock stub
   `test/stubs/schemastery.js` hides this with a no-op `.int()`. `cordis.yml`
   therefore excludes mop-executor; `cordis.with-executor.yml` + test 3 pin the
   failure. After fixing the Config, flip test 3 to assert the `maxOutputChars`
   (4000) default.

## Why symlinks instead of npm devDependencies

The harness is a pnpm workspace at `0.1.0-rc.x`; its packages declare
`workspace:^` deps. npm rejects that protocol outright
(`EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`). A `file:` link
installs as a symlink with transitive deps silently skipped — runtime resolution
works only because the link's realpath sits inside the harness's own
pnpm-installed `node_modules`. `link-harness.mjs` does exactly that
deterministically, without touching `package.json`.

Note: `npm install`/`npm run` in this session's shell can be poisoned by the
harness process's inherited `npm_*` env vars; running tests with a clean env
(`env -i HOME=$HOME PATH=$PATH npm run test:composition`) is the reliable form.
