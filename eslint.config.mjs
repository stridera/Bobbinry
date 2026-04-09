/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      '.next',
      '.turbo',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Browser dialogs (alert/confirm/prompt) are banned project-wide — they block the
      // event loop, can't be themed, and break UX consistency. Use a toast or modal.
      'no-alert': 'error',
    },
  },
];
