import type { Config } from 'drizzle-kit'
import { resolve } from 'path'

export default {
  schema: './src/db/schema.ts',
  out: resolve(__dirname, '../../infra/db/migrations'),
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://bobbinry:bobbinry@localhost:5432/bobbinry'
  }
} satisfies Config