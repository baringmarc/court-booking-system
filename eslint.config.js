import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // H10: Vitest runs a value returned from a hook as a teardown, so `beforeEach(() => mock.mockReset())` fails whatever the code does.
      'no-restricted-syntax': ['error', {
        selector: 'CallExpression[callee.name=/^(beforeEach|afterEach|beforeAll|afterAll)$/] > ArrowFunctionExpression[expression=true] > CallExpression',
        message: 'Hooks never return a value (Vitest runs a returned value as a teardown). Use a block body: beforeEach(() => { mock.mockReset() }).',
      }],
    },
  },
])
