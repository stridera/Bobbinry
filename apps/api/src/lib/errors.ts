/**
 * Standardized API Error Handling
 */

import { FastifyReply } from 'fastify'

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', context)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id ${id} not found` : `${resource} not found`
    super(message, 404, 'NOT_FOUND', { resource, id })
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', context)
    this.name = 'ConflictError'
  }
}

/**
 * Standardized error response handler
 */
export function handleError(reply: FastifyReply, error: unknown, correlationId?: string) {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      code: error.code,
      correlationId,
      ...(process.env.NODE_ENV === 'development' && error.context && { context: error.context })
    })
  }

  // Handle unknown errors
  const message = error instanceof Error ? error.message : 'Internal server error'
  const isDevelopment = process.env.NODE_ENV === 'development'

  return reply.status(500).send({
    error: isDevelopment ? message : 'Internal server error',
    code: 'INTERNAL_ERROR',
    correlationId,
    ...(isDevelopment && error instanceof Error && { stack: error.stack })
  })
}
