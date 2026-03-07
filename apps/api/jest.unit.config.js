const base = require('./jest.base.config')

module.exports = {
  ...base,
  displayName: 'API Unit',
  testMatch: [
    '**/__tests__/unit/**/*.{ts,tsx}',
    '**/?(*.)+(unit).{ts,tsx}'
  ]
}
