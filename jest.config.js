module.exports = {
  projects: [
    '<rootDir>/apps/api/jest.config.js',
    '<rootDir>/apps/shell/jest.config.js',
    '<rootDir>/packages/*/jest.config.js',
    '<rootDir>/packages/*/jest.config.cjs'
  ],
  collectCoverageFrom: [
    'apps/*/src/**/*.{ts,tsx}',
    'packages/*/src/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/*.test.{ts,tsx}',
    '!**/*.spec.{ts,tsx}'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html']
}