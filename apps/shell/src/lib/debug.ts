/**
 * Development-only Debug Utilities
 * 
 * These functions only log in development mode
 */

const isDevelopment = process.env.NODE_ENV === 'development'
const isTest = process.env.NODE_ENV === 'test'

export const debug = {
  log: (...args: unknown[]) => {
    if (isDevelopment && !isTest) {
      console.log(...args)
    }
  },
  
  error: (...args: unknown[]) => {
    if (isDevelopment && !isTest) {
      console.error(...args)
    }
  },
  
  warn: (...args: unknown[]) => {
    if (isDevelopment && !isTest) {
      console.warn(...args)
    }
  },
  
  info: (...args: unknown[]) => {
    if (isDevelopment && !isTest) {
      console.info(...args)
    }
  }
}

// Component-specific debug namespaces
export function createDebug(namespace: string) {
  return {
    log: (...args: unknown[]) => debug.log(`[${namespace}]`, ...args),
    error: (...args: unknown[]) => debug.error(`[${namespace}]`, ...args),
    warn: (...args: unknown[]) => debug.warn(`[${namespace}]`, ...args),
    info: (...args: unknown[]) => debug.info(`[${namespace}]`, ...args)
  }
}
