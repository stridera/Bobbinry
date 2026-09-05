/**
 * User API — split by concern; each module registers its own routes. No prefix
 * here: server.ts mounts the plugin under /api and every path is written in
 * full, so public URLs are unchanged.
 */
import type { FastifyPluginAsync } from 'fastify'
import profilesRoutes from './profiles'
import tiersRoutes from './tiers'
import followsRoutes from './follows'
import notificationPrefsRoutes from './notification-prefs'
import readingPrefsRoutes from './reading-prefs'
import displaySettingsRoutes from './display-settings'
import betaReadersRoutes from './beta-readers'
import betaInvitesRoutes from './beta-invites'
import readerBobbinsRoutes from './reader-bobbins'
import feedRoutes from './feed'
import publicProfileRoutes from './public-profile'
import unsubscribeRoutes from './unsubscribe'

const usersPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(profilesRoutes)
  await fastify.register(tiersRoutes)
  await fastify.register(followsRoutes)
  await fastify.register(notificationPrefsRoutes)
  await fastify.register(readingPrefsRoutes)
  await fastify.register(displaySettingsRoutes)
  await fastify.register(betaReadersRoutes)
  await fastify.register(betaInvitesRoutes)
  await fastify.register(readerBobbinsRoutes)
  await fastify.register(feedRoutes)
  await fastify.register(publicProfileRoutes)
  await fastify.register(unsubscribeRoutes)
}

export default usersPlugin
