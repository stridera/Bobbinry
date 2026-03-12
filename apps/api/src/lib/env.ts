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
  API_ORIGIN: string
  API_JWT_SECRET: string | undefined
  INTERNAL_API_AUTH_TOKEN: string | undefined
  INTERNAL_API_AUTH_TOKEN_PREVIOUS: string | undefined
  S3_ENDPOINT: string
  S3_PUBLIC_ENDPOINT: string
  S3_REGION: string
  S3_BUCKET: string
  S3_ACCESS_KEY: string
  S3_SECRET_KEY: string
  RESEND_API_KEY: string | undefined
  EMAIL_FROM: string
  GOOGLE_ID: string | undefined
  GOOGLE_SECRET: string | undefined
}

const requiredEnvVars = {
  production: [
    'DATABASE_URL',
    'WEB_ORIGIN',
    'INTERNAL_API_AUTH_TOKEN',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
  ],
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
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://bobbinry:bobbinry@localhost:5432/bobbinry',
    PORT: parseInt(process.env.PORT || '4100', 10),
    NODE_ENV: nodeEnv,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    WEB_ORIGIN: process.env.WEB_ORIGIN || 'http://localhost:3100',
    API_ORIGIN: process.env.API_ORIGIN || `http://localhost:${parseInt(process.env.PORT || '4100', 10)}`,
    API_JWT_SECRET: process.env.API_JWT_SECRET,
    INTERNAL_API_AUTH_TOKEN: process.env.INTERNAL_API_AUTH_TOKEN,
    INTERNAL_API_AUTH_TOKEN_PREVIOUS: process.env.INTERNAL_API_AUTH_TOKEN_PREVIOUS,
    S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://127.0.0.1:9100',
    S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || 'http://127.0.0.1:9100',
    S3_REGION: process.env.S3_REGION || 'auto',
    S3_BUCKET: process.env.S3_BUCKET || 'bobbinry',
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || 'admin',
    S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'adminadmin',
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM || 'Bobbinry <noreply@bobbinry.com>',
    GOOGLE_ID: process.env.GOOGLE_ID,
    GOOGLE_SECRET: process.env.GOOGLE_SECRET,
  }
}

export const env = validateEnv()
