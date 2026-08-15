import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', 'docs/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.builtin, ...globals.node },
    },
  },
]
