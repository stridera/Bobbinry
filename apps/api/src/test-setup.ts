// Test setup - env vars must be set before importing env module
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://bobbinry:bobbinry@localhost:5433/bobbinry'
