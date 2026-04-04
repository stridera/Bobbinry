const base = require('./jest.base.config')

module.exports = {
  ...base,
  displayName: 'API Integration',
  // Run serially — integration tests share a database and truncate between suites
  maxWorkers: 1,
  testMatch: [
    '**/__tests__/**/*.{ts,tsx}',
    '**/?(*.)+(spec|test|integration).{ts,tsx}'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.unit\\.test\\.ts$',
    '/__tests__/unit/',
    'test-helpers\\.ts$'
  ]
}
