module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts'
  ],
  moduleNameMapper: {
    '^@bobbinry/(.*)$': '<rootDir>/../$1/src'
  },
  transform: {
    '^.+\\.ts$': 'ts-jest'
  }
}