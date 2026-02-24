// Test setup - use the same database as development for now
// In production, you'd want a separate test database
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://bobbinry:bobbinry@localhost:5433/bobbinry'
process.env.NODE_ENV = 'test'
