/**
 * Public Reader API
 *
 * Provides public-facing endpoints for anonymous readers to access published content.
 * Respects access control, embargo schedules, and subscription tiers.
 */


import type { FastifyPluginAsync } from 'fastify'
import readerBobbinsRoutes from './reader-bobbins'
import chaptersRoutes from './chapters'
import seoRoutes from './seo'
import lookupRoutes from './lookup'
import collectionsRoutes from './collections'
import socialRoutes from './social'
import codexRoutes from './codex'
import annotationsRoutes from './annotations'
import annotationsAuthorRoutes from './annotations-author'

/**
 * The reader API is split by concern; each module registers its own routes.
 * No prefix here — server.ts mounts the whole plugin under /api, and every
 * route path is written in full so the public URLs are unchanged.
 */
const readerPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(readerBobbinsRoutes)
  await fastify.register(chaptersRoutes)
  await fastify.register(seoRoutes)
  await fastify.register(lookupRoutes)
  await fastify.register(collectionsRoutes)
  await fastify.register(socialRoutes)
  await fastify.register(codexRoutes)
  await fastify.register(annotationsRoutes)
  await fastify.register(annotationsAuthorRoutes)
}

export default readerPlugin
