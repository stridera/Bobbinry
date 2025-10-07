/**
 * Environment Variable Validation for API
 * 
 * Validates required environment variables at startup
 */

interface EnvConfig {
  DATABASE_URL: string
  PORT: string
  NODE_ENV: string
  LOG_LEVEL: string
  WEB_ORIGIN?: string
  API_JWT_SECRET?: string
}

const requiredEnvVars = {
  production: ['DATABASE_URL', 'WEB_ORIGIN'],
  development: [] as string[],
  test: ['DATABASE_URL'] as string[]
} as const

export function validateEnv(): EnvConfig {
  const env = process.env.NODE_ENV || 'development'
  const required = requiredEnvVars[env as keyof typeof requiredEnvVars] || []

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
    PORT: process.env.PORT || '4000',
    NODE_ENV: env,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    API_JWT_SECRET: process.env.API_JWT_SECRET
  }
}

export const env = validateEnv()
