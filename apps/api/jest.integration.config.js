const base = require('./jest.base.config')

module.exports = {
  ...base,
  displayName: 'API Integration',
  testMatch: [
    '**/__tests__/**/*.{ts,tsx}',
    '**/?(*.)+(spec|test|integration).{ts,tsx}'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.unit\\.test\\.ts$',
    '/__tests__/unit/'
  ]
}
