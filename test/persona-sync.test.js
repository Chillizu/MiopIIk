import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 维护规则「改决策行必须同步承载文档代码块」的机制化：把执行层 persona 的
// 定稿源（docs/design/presets/drafts/executor.prompt.md）与运行时副本
// （packages/mop-executor/index.js 的 EXECUTOR_PERSONA）钉死为逐字同步。
// 一旦有人只改一处，本测试即失败（trust structure, not self-discipline）。
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const code = readFileSync(join(root, 'packages/mop-executor/index.js'), 'utf8')
const match = code.match(/const EXECUTOR_PERSONA = `([\s\S]*?)`/)
assert.ok(match, 'EXECUTOR_PERSONA 模板字面量必须存在')
const codePersona = match[1].trim()

const doc = readFileSync(
  join(root, 'docs/design/presets/drafts/executor.prompt.md'),
  'utf8',
)
// 定稿源里「> 同步清单」是文档内部注记，不属于 persona 正文；剥掉后，
// 把移除注记残留的 3+ 连续换行折叠为 2（块引用前后各有一个空行）。
const docPersona = doc
  .split('\n')
  .filter((line) => !line.startsWith('> '))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

test('executor persona：定稿源与运行时副本逐字同步', () => {
  assert.equal(
    docPersona,
    codePersona,
    'persona 漂移：docs/design/presets/drafts/executor.prompt.md 与 ' +
      'packages/mop-executor/index.js 的 EXECUTOR_PERSONA 不一致，改一处须同步另一处',
  )
})
