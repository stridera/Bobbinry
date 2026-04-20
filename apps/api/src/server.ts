import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import projectsPlugin from './routes/projects'
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
import projectFollowsPlugin from './routes/project-follows'
import notificationsPlugin from './routes/notifications'
import membershipPlugin from './routes/membership'
import adminPlugin from './routes/admin'
import { checkDatabaseHealth } from './db/connection'
import { env } from './lib/env'
import { startTriggerScheduler, stopTriggerScheduler } from './jobs/trigger-scheduler'
import { loadAllDiskManifests } from './lib/disk-manifests'
import { initNotificationHandlers } from './jobs/notification-handlers'
import { getMetricsSnapshot, incrementCounter, observeTimingMs } from './lib/metrics'
import { verifyInternalRequest } from './lib/internal-auth'
import googleDrivePlugin from './routes/google-drive'
import aiToolsPlugin from './routes/ai-tools'
import userBobbinsPlugin from './routes/user-bobbins'
import { initDriveSyncHandler } from './jobs/drive-sync-handler'
import { initDiscordNotifierHandler } from './jobs/discord-notifier-handler'
import { initDiscordRolesHandler } from './jobs/discord-roles-handler'
import apiKeysPlugin from './routes/api-keys'
import rssTokensPlugin from './routes/rss-tokens'
import exportPlugin from './routes/export'
import templatesPlugin from './routes/templates'
import entityTypesPlugin from './routes/entity-types'
import entityPublishPlugin from './routes/entity-publish'
import promoCodesPlugin from './routes/promo-codes'
import { hashApiKey, getApiKeyTier } from './middleware/auth'

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
    maxParamLength: 512,
    ...opts
  })

  // Add correlation ID to all requests
  server.addHook('onRequest', async (request) => {
    request.headers['x-correlation-id'] = request.headers['x-correlation-id'] || request.id
    ;(request as any).__startedAt = performance.now()
    incrementCounter('http.requests.total', { method: request.method })
  })

  server.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as any).__startedAt as number | undefined
    if (typeof startedAt === 'number') {
      observeTimingMs('http.requests.duration', performance.now() - startedAt, {
        method: request.method,
        status: reply.statusCode
      })
    }
  })

  // Global error handler
  server.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
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

    // Rate limiter sets error.code (not statusCode) to 429
    const isRateLimit = error.code === '429' || String(error.statusCode) === '429'
    const statusCode = isRateLimit ? 429 : (error.statusCode || 500)

    if (isRateLimit) {
      reply.header('Retry-After', '60')
    }

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

  // Rate limiting — per-key buckets for API keys, per-IP for browser sessions
  server.register(rateLimit, {
    max: (request: FastifyRequest) => {
      const authHeader = request.headers.authorization
      if (authHeader) {
        const token = authHeader.split(' ')[1]
        if (token?.startsWith('bby_')) {
          const keyHash = hashApiKey(token)
          const tier = getApiKeyTier(keyHash)
          // tier may be null on first request before cache is populated — use free limit
          return tier === 'supporter' ? 500 : 100
        }
      }
      return process.env.NODE_ENV === 'development' ? 1000 : 300
    },
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => {
      const authHeader = request.headers.authorization
      if (authHeader) {
        const token = authHeader.split(' ')[1]
        if (token?.startsWith('bby_')) {
          return `apikey:${hashApiKey(token)}`
        }
      }
      return request.ip
    },
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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

  server.get('/internal/metrics', async (request, reply) => {
    const verification = verifyInternalRequest(request)
    if (!verification.ok) {
      incrementCounter('internal_auth.denied', { reason: verification.reason })
      return reply.status(403).send({ error: 'Forbidden' })
    }

    return reply.send(getMetricsSnapshot())
  })

  // Register route plugins
  server.register(projectsPlugin, { prefix: '/api' })
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
  server.register(templatesPlugin, { prefix: '/api' })
  server.register(entityTypesPlugin, { prefix: '/api' })
  server.register(entityPublishPlugin, { prefix: '/api' })
  server.register(uploadsPlugin, { prefix: '/api' })
  server.register(projectTagsPlugin, { prefix: '/api' })
  server.register(projectFollowsPlugin, { prefix: '/api' })
  server.register(membershipPlugin, { prefix: '/api' })
  server.register(notificationsPlugin, { prefix: '/api' })
  server.register(adminPlugin, { prefix: '/api' })
  server.register(googleDrivePlugin, { prefix: '/api' })
  server.register(aiToolsPlugin, { prefix: '/api' })
  server.register(userBobbinsPlugin, { prefix: '/api' })
  server.register(apiKeysPlugin, { prefix: '/api' })
  server.register(rssTokensPlugin, { prefix: '/api' })
  server.register(exportPlugin, { prefix: '/api' })
  server.register(promoCodesPlugin, { prefix: '/api' })


  // Warm disk manifest cache, then start the trigger scheduler
  server.addHook('onReady', async () => {
    await loadAllDiskManifests()
    startTriggerScheduler()
    initNotificationHandlers()
    initDriveSyncHandler()
    initDiscordNotifierHandler()
    initDiscordRolesHandler()
  })

  server.addHook('onClose', async () => {
    stopTriggerScheduler()
  })

  return server
}
