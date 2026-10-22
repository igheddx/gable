import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['.vite/**', 'out/**', 'node_modules/**', '.dev-data/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Renderer must never reach Node, SQL or the filesystem.
      'no-restricted-imports': [
        'error',
        { patterns: ['electron', 'node:*', 'better-sqlite3', '**/db/*', '**/services/*', '**/main/*'] },
      ],
    },
  },
  {
    // Code passed to page.evaluate runs in the browser and cannot share types with the test file.
    files: ['tests/e2e/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.{ts,mjs,js}'],
    ignores: ['src/renderer/**'],
    languageOptions: { globals: globals.node },
  },
);
