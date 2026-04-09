/**
 * Global (user-scoped) bobbin management
 *
 * Bobbins installed at global scope are visible across all of a user's projects.
 */

import { FastifyPluginAsync } from 'fastify'
import { parse as parseYAML } from 'yaml'
import { db } from '../db/connection'
import { bobbinsInstalled } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'
import { ManifestCompiler } from '@bobbinry/compiler'
import { loadDiskManifests, getManifestScopes, loadManifestFromBobbinsPath } from '../lib/disk-manifests'

const userBobbinsPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * Install bobbin at global (user) scope
   * POST /users/me/bobbins/install
   */
  fastify.post<{
    Body: {
      manifestPath?: string
      manifestContent?: string
      manifestType?: 'yaml' | 'json'
    }
  }>('/users/me/bobbins/install', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id
      const { manifestPath, manifestContent, manifestType } = request.body

      // Get manifest content
      let content: string
      let type: 'yaml' | 'json'

      if (manifestPath) {
        const result = await loadManifestFromBobbinsPath(manifestPath)
        if (!result.ok) {
          return reply.status(result.status).send({ error: result.error, message: result.message })
        }
        content = result.content
        type = result.type
      } else if (manifestContent) {
        content = manifestContent
        type = manifestType || 'json'
      } else {
        return reply.status(400).send({ error: 'Either manifestPath or manifestContent is required' })
      }

      let manifest: any
      try {
        manifest = type === 'yaml' ? parseYAML(content) : JSON.parse(content)
      } catch {
        return reply.status(400).send({ error: 'Invalid manifest format' })
      }

      // Validate that the manifest supports global scope
      const scopes = getManifestScopes(manifest)
      if (!scopes.includes('global')) {
        return reply.status(400).send({ error: `Bobbin '${manifest.id}' does not support global-scope installation` })
      }

      // Compile & validate
      const compiler = new ManifestCompiler({})
      const compileResult = await compiler.compile(manifest)
      if (!compileResult.success) {
        return reply.status(400).send({ error: 'Manifest compilation failed', details: compileResult.errors })
      }

      // Upsert
      const existing = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.userId, userId), eq(bobbinsInstalled.bobbinId, manifest.id)))
        .limit(1)

      if (existing.length > 0) {
        await db.update(bobbinsInstalled)
          .set({ version: manifest.version, manifestJson: manifest, enabled: true, installedAt: new Date() })
          .where(eq(bobbinsInstalled.id, existing[0]!.id))
        return { success: true, action: 'updated', bobbin: { id: manifest.id, name: manifest.name, version: manifest.version } }
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        userId,
        scope: 'global',
        bobbinId: manifest.id,
        version: manifest.version,
        manifestJson: manifest,
        enabled: true,
      }).returning()

      return {
        success: true,
        action: 'installed',
        bobbin: { id: manifest.id, name: manifest.name, version: manifest.version },
        installation: { id: installation!.id, installedAt: installation!.installedAt }
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to install bobbin at global scope')
      return reply.status(500).send({ error: 'Failed to install bobbin' })
    }
  })

  /**
   * List global-scoped bobbins for the current user
   * GET /users/me/bobbins
   */
  fastify.get('/users/me/bobbins', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id

      const installations = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.userId, userId), eq(bobbinsInstalled.scope, 'global'), eq(bobbinsInstalled.enabled, true)))

      const diskManifests = await loadDiskManifests(installations.map(i => i.bobbinId))

      return {
        bobbins: installations.filter(i => diskManifests.has(i.bobbinId)).map(install => ({
          id: install.bobbinId,
          version: install.version,
          scope: 'global',
          manifest: diskManifests.get(install.bobbinId),
          installedAt: install.installedAt,
        }))
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list global bobbins')
      return reply.status(500).send({ error: 'Failed to list global bobbins' })
    }
  })

  /**
   * Uninstall global-scoped bobbin
   * DELETE /users/me/bobbins/:bobbinId
   */
  fastify.delete<{
    Params: { bobbinId: string }
  }>('/users/me/bobbins/:bobbinId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id
      const { bobbinId } = request.params

      await db.delete(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.userId, userId), eq(bobbinsInstalled.bobbinId, bobbinId), eq(bobbinsInstalled.scope, 'global')))

      return { success: true, message: `Bobbin ${bobbinId} uninstalled globally` }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to uninstall global bobbin')
      return reply.status(500).send({ error: 'Failed to uninstall bobbin' })
    }
  })
}

export default userBobbinsPlugin
