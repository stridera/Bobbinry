module.exports = {
  displayName: 'API',
  preset: 'ts-jest',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/src/jest-global-setup.ts',
  globalTeardown: '<rootDir>/src/jest-global-teardown.ts',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@bobbinry/(.*)$': '<rootDir>/../../packages/$1/src'
  },
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true } }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!\\.bun/jose|jose/)'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}'
  ],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  testTimeout: 10000
}
