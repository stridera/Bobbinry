import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { randomUUID } from 'crypto'
import projectsPlugin from './routes/projects'
import viewsPlugin from './routes/views'
import entitiesPlugin from './routes/entities'
import usersPlugin from './routes/users'
import subscriptionsPlugin from './routes/subscriptions'
import stripePlugin from './routes/stripe'
import publishingPlugin from './routes/publishing'
import readerPlugin from './routes/reader'
import bobbinActionsPlugin from './routes/bobbin-actions'
import collectionsPlugin from './routes/collections'
import dashboardPlugin from './routes/dashboard'
import authPlugin from './routes/auth'
import discoverPlugin from './routes/discover'
import uploadsPlugin from './routes/uploads'
import projectTagsPlugin from './routes/project-tags'
import { checkDatabaseHealth } from './db/connection'
import { env } from './lib/env'
import { startTriggerScheduler, stopTriggerScheduler } from './jobs/trigger-scheduler'

export function build(opts = {}): FastifyInstance {
  const server = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: process.env.LOG_LEVEL || 'info',
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          hostname: req.hostname,
          remoteAddress: req.ip,
          headers: {
            'user-agent': req.headers['user-agent'],
            'x-correlation-id': req.headers['x-correlation-id'],
            'content-type': req.headers['content-type']
          }
        }),
        res: (res) => ({
          statusCode: res.statusCode
        }),
        err: (err) => ({
          type: err.constructor.name,
          message: err.message,
          stack: process.env.NODE_ENV === 'development' ? (err.stack || '') : '',
          code: err.code,
          statusCode: err.statusCode
        })
      }
    },
    genReqId: () => randomUUID(),
    ...opts
  })

  // Add correlation ID to all requests
  server.addHook('onRequest', async (request) => {
    request.headers['x-correlation-id'] = request.headers['x-correlation-id'] || request.id
  })

  // Global error handler
  server.setErrorHandler((error, request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || request.id

    server.log.error({
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
        statusCode: error.statusCode
      },
      correlationId,
      url: request.url,
      method: request.method
    }, 'Unhandled error')

    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === 'development'
    const statusCode = error.statusCode || 500

    reply.status(statusCode).send({
      error: statusCode < 500 ? error.message : 'Internal Server Error',
      correlationId,
      ...(isDevelopment && {
        details: error.message,
        stack: error.stack,
        code: error.code
      })
    })
  })

  // Security headers with helmet
  server.register(helmet, {
    ...(process.env.NODE_ENV !== 'production' && { contentSecurityPolicy: false }),
    crossOriginEmbedderPolicy: false, // Allow iframe embedding for views
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow images/assets to load from shell on different port
    frameguard: false // Disable X-Frame-Options to allow iframe embedding
  })

  // Rate limiting
  server.register(rateLimit, {
    max: process.env.NODE_ENV === 'development' ? 1000 : 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
      code: 429,
      error: 'Rate limit exceeded',
      message: `Rate limit exceeded, retry in ${Math.round(context.ttl / 1000)}s`,
      correlationId: request.id
    })
  })

  // Request size limits — 5MB to accommodate large manuscript chapters
  server.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => {
    try {
      if (typeof body === 'string' && body.length > 5 * 1024 * 1024) {
        done(new Error('Request body too large'), undefined)
        return
      }
      done(null, JSON.parse(body as string))
    } catch (error) {
      done(error instanceof Error ? error : new Error('Invalid JSON'), undefined)
    }
  })

  // CORS configuration - environment-aware origins
  server.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? [env.WEB_ORIGIN]
      : [env.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID']
  })

  // Health check endpoint with database connectivity
  server.get('/health', async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || request.id
    const startTime = Date.now()

    try {
      const dbHealthy = await checkDatabaseHealth()
      const responseTime = Date.now() - startTime

      const status = dbHealthy ? 'ok' : 'degraded'
      const statusCode = dbHealthy ? 200 : 503

      return reply.status(statusCode).send({
        status,
        timestamp: new Date().toISOString(),
        correlationId,
        services: {
          database: dbHealthy ? 'healthy' : 'unhealthy'
        },
        responseTime: `${responseTime}ms`
      })
    } catch (error) {
      server.log.error({ error, correlationId }, 'Health check failed')
      return reply.status(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        correlationId,
        error: 'Health check failed'
      })
    }
  })

  // Register route plugins
  server.register(projectsPlugin, { prefix: '/api' })
  server.register(viewsPlugin, { prefix: '/api' })
  server.register(entitiesPlugin, { prefix: '/api' })
  server.register(usersPlugin, { prefix: '/api' })
  server.register(subscriptionsPlugin, { prefix: '/api' })
  server.register(stripePlugin, { prefix: '/api' })
  server.register(publishingPlugin, { prefix: '/api' })
  server.register(readerPlugin, { prefix: '/api' })
  server.register(bobbinActionsPlugin, { prefix: '/api' })
  server.register(collectionsPlugin, { prefix: '/api' })
  server.register(dashboardPlugin, { prefix: '/api' })
  server.register(authPlugin, { prefix: '/api' })
  server.register(discoverPlugin, { prefix: '/api' })
  server.register(uploadsPlugin, { prefix: '/api' })
  server.register(projectTagsPlugin, { prefix: '/api' })

  // Start the trigger scheduler for cron-based bobbin actions
  server.addHook('onReady', async () => {
    startTriggerScheduler()
  })

  server.addHook('onClose', async () => {
    stopTriggerScheduler()
  })

  return server
}