import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env file from project root before any imports
try {
  const envPath = resolve(__dirname, '../.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex)
    const value = trimmed.slice(eqIndex + 1)
    process.env[key] ??= value
  }
} catch {
  // .env file not found, use defaults
}

// Test setup - env vars must be set before importing env module
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://bobbinry:bobbinry@localhost:5433/bobbinry'
