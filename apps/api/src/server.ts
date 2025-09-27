import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import projectsPlugin from './routes/projects'
import viewsPlugin from './routes/views'
import entitiesPlugin from './routes/entities'

export function build(opts = {}): FastifyInstance {
  const server = Fastify({
    logger: false,
    ...opts
  })

  // CORS configuration - allow both port 3000 and 3001 for shell development
  server.register(cors, {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      ...(process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : [])
    ]
  })

  // Health check endpoint
  server.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // Register route plugins
  server.register(projectsPlugin, { prefix: '/api' })
  server.register(viewsPlugin, { prefix: '/api' })
  server.register(entitiesPlugin, { prefix: '/api' })

  return server
}