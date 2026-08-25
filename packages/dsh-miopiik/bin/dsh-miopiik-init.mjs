#!/usr/bin/env node
// dsh-miopiik-init：把内置的 miopiik preset 模板复制到 ${DSH_HOME}/.agent-presets/miopiik。
// 幂等约定：目标已存在时拒绝覆盖，需 --force 才覆盖（覆盖前不做备份，自行 git/备份管理）。
// 只做文件拷贝，不重启服务、不改任何其他配置。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcPreset = resolve(here, '..', 'preset')
const force = process.argv.includes('--force')

const dshHome = process.env.DSH_HOME || join(process.env.HOME || '~', '.dsh')
const dest = join(dshHome, '.agent-presets', 'miopiik')

if (!existsSync(join(srcPreset, 'agent.cordis.yml'))) {
  console.error(
    `dsh-miopiik-init: preset template missing at ${srcPreset} (broken install?)`,
  )
  process.exit(1)
}

if (existsSync(join(dest, 'agent.cordis.yml'))) {
  if (!force) {
    console.log(`dsh-miopiik-init: ${dest} already exists; nothing done.`)
    console.log(
      'Re-run with --force to overwrite it with the bundled template.',
    )
  } else {
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(srcPreset, dest, { recursive: true })
    console.log(`dsh-miopiik-init: overwrote preset at ${dest}`)
  }
} else {
  mkdirSync(dest, { recursive: true })
  cpSync(srcPreset, dest, { recursive: true })
  console.log(`dsh-miopiik-init: preset installed at ${dest}`)
}

console.log('Next steps:')
console.log('  1. Restart the harness so plugins and the preset load.')
console.log("  2. Validate the mount: standingKeyFor('miopiik').")
console.log('  3. Optional smoke task: see examples/miopiik/README.md.')
