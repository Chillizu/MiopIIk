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
3. **Config-schema contract is now caught in CI too** — mock tests
   (`test/*.test.js`) import packages through **real** `@deepseek-ai/schemastery`
   (npm devDependency v3.18.1), not a stub, so a bogus method like
   `z.number().int()` or `z.string().optional()` throws at import and fails
   `npm test` in CI. This was the `z.number().int()` bug
   (`packages/mop-executor/index.js:15`, now fixed to `z.natural()`) that the old
   no-op `test/stubs/schemastery.js` masked. The composition test additionally
   boots every package's `Config` through the **real Loader** (asserting the
   coerced defaults land in `apply(config)`), the last-line contract anchor.

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

## CI coverage boundary (P1-6)

CI runs `check`/`lint`/`format:check`/`npm test` on every push/PR
(`.github/workflows/ci.yml`). The mock tests (`npm test`) now exercise **real
schemastery** for every package's `Config` (see §3), so Config-contract
regressions are caught on the push gate.

The full **real-boot** checks here (`boot()` through the harness Loader, real
spawn-driver error, real token-meter projection folding) need a built harness
checkout (`/opt/deepseek-harness`). They run in a separate workflow
(`.github/workflows/composition.yml`) on **manual dispatch + weekly schedule**,
which checks out `deepseek-ai/deepseek-harness` at a pinned ref, builds
`build:lib:host`, and runs `npm run test:composition`. They are deliberately
**not** in the push gate: a full harness `pnpm install` + `build:lib:host` is too
heavy and too fragile against a fast-moving rc harness for free runners.

**Push CI green ⇒ mock green, not composition green.** Run
`npm run test:composition` locally before a release, and re-run the composition
workflow against a fresh harness ref when upstream seams change.
