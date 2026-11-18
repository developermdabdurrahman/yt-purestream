import js from '@eslint/js';
import globals from 'globals';

const rules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
};

export default [
  { ignores: ['node_modules/**', 'dist/**', 'store/**', '_metadata/**'] },

  // Content script and shared code (classic scripts in a browser).
  {
    files: ['content.js', 'common.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules,
  },
  {
    files: ['popup.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly', YTPS: 'readonly', YTPS_CONFIG: 'readonly' },
    },
    rules,
  },

  // Service worker (classic script, loads common.js with importScripts).
  {
    files: ['background.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker, chrome: 'readonly', YTPS: 'readonly', YTPS_CONFIG: 'readonly' },
    },
    rules,
  },

  // Tooling and tests (Node, ES modules). The test files also run small
  // snippets inside the browser / the service worker.
  {
    files: ['eslint.config.js', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        chrome: 'readonly',
        YTPS: 'readonly',
        maybeRetryStrict: 'readonly',
        lastRetryCheck: 'writable',
      },
    },
    rules,
  },
];
