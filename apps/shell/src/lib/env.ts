/**
 * Environment Variable Validation
 * 
 * Validates required environment variables at startup
 */

interface EnvConfig {
  NEXTAUTH_SECRET?: string
  NEXT_PUBLIC_API_URL?: string
  DATABASE_URL?: string
  NODE_ENV?: string
}

const requiredEnvVars = {
  production: ['NEXTAUTH_SECRET', 'DATABASE_URL'],
  development: [] as string[],
  test: [] as string[]
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
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: env
  }
}

export const env = validateEnv()
