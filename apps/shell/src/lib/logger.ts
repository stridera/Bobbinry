/**
 * Structured Logging Utility
 * 
 * Provides consistent logging across the application with proper log levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development'
  private isTest = process.env.NODE_ENV === 'test'

  private log(level: LogLevel, message: string, context?: LogContext) {
    // Skip all logs in test environment
    if (this.isTest) return

    // In production, skip debug logs
    if (!this.isDevelopment && level === 'debug') return

    const timestamp = new Date().toISOString()
    switch (level) {
      case 'debug':
        if (this.isDevelopment) {
          console.debug(`[${timestamp}] DEBUG:`, message, context || '')
        }
        break
      case 'info':
        console.info(`[${timestamp}] INFO:`, message, context || '')
        break
      case 'warn':
        console.warn(`[${timestamp}] WARN:`, message, context || '')
        break
      case 'error':
        console.error(`[${timestamp}] ERROR:`, message, context || '')
        break
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context)
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context)
  }

  warn(message: string, context?: LogContext) {
    this.log('warn', message, context)
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorContext = error instanceof Error
      ? { error: error.message, stack: error.stack, ...context }
      : { error, ...context }
    
    this.log('error', message, errorContext)
  }
}

export const logger = new Logger()
