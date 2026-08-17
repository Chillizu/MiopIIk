import { registerHooks } from 'node:module'

// 只 stub harness 私有包（@deepseek-ai/dsh-tools / dsh-llm 是 harness workspace 包，
// 不在 npm；CI 无法安装）。@deepseek-ai/schemastery 在 npm（v3.18.1，见 devDependencies），
// 走真实实现——这样 Config 契约 bug（如 z.number().int()、z.string().optional()）
// 会在 mock 测试 import 时就被真实 schemastery 抓住，不再被 no-op stub 掩盖。
const stubs = new Map([
  ['@deepseek-ai/dsh-tools', 'dsh-tools.js'],
  ['@deepseek-ai/dsh-llm', 'dsh-llm.js'],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubs.has(specifier)) {
      return {
        url: new URL('./stubs/' + stubs.get(specifier), import.meta.url).href,
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})
