import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const META = join(ROOT, 'packages', 'dsh-miopiik')

const SEVEN = [
  'dsh-miopiik-tool-recovery',
  'dsh-miopiik-executor',
  'dsh-miopiik-magic-keywords',
  'dsh-miopiik-model-auth',
  'dsh-miopiik-capabilities',
  'dsh-miopiik-learn',
  'dsh-miopiik-run-stats',
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

test('meta patch inserts exactly the seven suite rows', () => {
  const yaml = readFileSync(join(META, 'cordis.patch.yml'), 'utf8')
  for (const name of SEVEN) {
    assert.match(
      yaml,
      new RegExp(`- id: ${name}\\n\\s+name: ${name}`),
      `patch must insert row ${name}`,
    )
  }
  const inserted = [...yaml.matchAll(/- id:\s*(\S+)/g)].map((m) => m[1])
  assert.deepEqual(inserted.sort(), [...SEVEN].sort())
})

test('meta dependencies pin the seven packages at the suite version', () => {
  const pkg = JSON.parse(readFileSync(join(META, 'package.json'), 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  assert.deepEqual(deps.sort(), [...SEVEN].sort())
  for (const name of SEVEN) {
    assert.equal(pkg.dependencies[name], `^${pkg.version}`)
  }
  // npx 按包名解析：必须存在与包同名的 bin，否则 `npx dsh-miopiik` 会 404。
  assert.ok(pkg.bin && typeof pkg.bin['dsh-miopiik'] === 'string')
})

test('bundled preset stays byte-identical to examples/miopiik', () => {
  const src = join(ROOT, 'examples', 'miopiik')
  const dst = join(META, 'preset')
  const relSrc = walk(src)
    .map((p) => p.slice(src.length + 1))
    .sort()
  const relDst = walk(dst)
    .map((p) => p.slice(dst.length + 1))
    .sort()
  assert.deepEqual(relDst, relSrc, 'preset file sets diverge')
  for (const rel of relSrc) {
    assert.equal(
      readFileSync(join(dst, rel), 'utf8'),
      readFileSync(join(src, rel), 'utf8'),
      `preset file drifted: ${rel}`,
    )
  }
})
