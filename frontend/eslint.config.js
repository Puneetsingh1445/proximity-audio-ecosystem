import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Ignore build output
  globalIgnores(['dist']),

  // ── All source files: base rules ──────────────────────────────────────────
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // The two useEffect-setState patterns in App.jsx (auth loading + name
      // sync) are intentional; they come directly from the original codebase.
      'react-hooks/set-state-in-effect': 'off',
    },
  },

  // ── Protected files: pre-existing issues, suppress without editing ────────
  // useOfficeSocket.js, useSpatialAudio.js, and OfficeCanvas.jsx contain
  // patterns that existed before Phase 1 and must NOT be modified.
  // We disable only the rules that fire on those specific files.
  {
    files: [
      'src/hooks/useOfficeSocket.js',
      'src/hooks/useSpatialAudio.js',
      'src/components/OfficeCanvas.jsx',
    ],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': 'off',
    },
  },
])
