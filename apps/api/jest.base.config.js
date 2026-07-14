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
    // ESM modules — jest must transform these or the import fails at runtime.
    // Match both the .bun-hashed dir and the bare package dir.
    'node_modules/(?!(\\.bun/)?(jose|nanoid|archiver|compress-commons|zip-stream|crc32-stream|is-stream|minimatch|brace-expansion|balanced-match|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)(@|/))'
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
