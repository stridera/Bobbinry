/**
 * Environment Variable Validation for API
 *
 * Single source of truth for all configuration. Every module should import
 * from here instead of reading process.env directly.
 */

interface EnvConfig {
  DATABASE_URL: string
  PORT: number
  NODE_ENV: string
  LOG_LEVEL: string
  WEB_ORIGIN: string
  API_JWT_SECRET: string | undefined
  S3_ENDPOINT: string
  S3_REGION: string
  S3_BUCKET: string
  S3_ACCESS_KEY: string
  S3_SECRET_KEY: string
}

const requiredEnvVars = {
  production: ['DATABASE_URL', 'WEB_ORIGIN'],
  development: [] as string[],
  test: ['DATABASE_URL'] as string[]
} as const

export function validateEnv(): EnvConfig {
  const nodeEnv = process.env.NODE_ENV || 'development'
  const required = requiredEnvVars[nodeEnv as keyof typeof requiredEnvVars] || []

  const missing: string[] = []

  for (const varName of required) {
    if (!process.env[varName]) {
      missing.push(varName)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please check your .env file or environment configuration.`
    )
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://bobbinry:bobbinry@localhost:5433/bobbinry',
    PORT: parseInt(process.env.PORT || '4100', 10),
    NODE_ENV: nodeEnv,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    WEB_ORIGIN: process.env.WEB_ORIGIN || 'http://localhost:3100',
    API_JWT_SECRET: process.env.API_JWT_SECRET,
    S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://127.0.0.1:9100',
    S3_REGION: process.env.S3_REGION || 'auto',
    S3_BUCKET: process.env.S3_BUCKET || 'bobbinry',
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || 'admin',
    S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'adminadmin',
  }
}

export const env = validateEnv()
