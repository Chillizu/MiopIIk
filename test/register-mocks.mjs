import { registerHooks } from 'node:module'

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
