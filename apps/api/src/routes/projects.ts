import { FastifyPluginAsync } from 'fastify'
import { parse as parseYAML } from 'yaml'
import { db } from '../db/connection'
import { projects, bobbinsInstalled, entities, projectManuscriptDisplaySettings } from '../db/schema'
import { eq, and, count, inArray, isNull } from 'drizzle-orm'
import { ManifestCompiler } from '@bobbinry/compiler'
import { requireAuth, requireProjectOwnership, requireVerified, requireScope } from '../middleware/auth'
import { getUserMembershipTier, getProjectLimit, getUserBadges } from '../lib/membership'
import { checkAndUpgradeBobbin, type UpgradeResult } from '../lib/bobbin-upgrader'
import { loadDiskManifests, loadManifestFromBobbinsPath } from '../lib/disk-manifests'
import { getEffectiveBobbins } from '../lib/effective-bobbins'

// Bobbins auto-installed on every new project and protected from uninstall.
// Source of truth is each bobbin's manifest `core: true` flag; this list keeps
// the create path from having to scan every manifest on disk to find them.
// (Import/export are core shell features, not bobbins — see routes/import.ts
// and routes/export.ts.)
const CORE_BOBBIN_IDS = ['manuscript'] as const

const projectsPlugin: FastifyPluginAsync = async (fastify) => {
  // Create a new project (requires authentication)
  fastify.post<{
    Body: {
      name: string
      description?: string
    }
  }>('/projects', {
    preHandler: [requireAuth, requireVerified, requireScope('projects:write')]
  }, async (request, reply) => {
    try {
      const { name, description } = request.body
      const user = request.user!

      // Validate input
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Project name is required' })
      }

      // Check project limit based on membership tier (owners are exempt)
      const badges = await getUserBadges(user.id)
      if (!badges.includes('owner')) {
        const tier = await getUserMembershipTier(user.id)
        const limit = getProjectLimit(tier)

        const [projectCount] = await db
          .select({ count: count() })
          .from(projects)
          .where(and(
            eq(projects.ownerId, user.id),
            eq(projects.isArchived, false),
            isNull(projects.deletedAt)
          ))

        if ((projectCount?.count ?? 0) >= limit) {
          return reply.status(403).send({
            error: `Project limit reached. ${tier === 'free' ? 'Free' : 'Supporter'} accounts can create up to ${limit} projects.`,
            limit,
            tier,
            upgradeUrl: '/membership',
          })
        }
      }

      // Create the project and auto-install core bobbins in a single
      // transaction so a partial setup can't ship — either the project lands
      // with manuscript pre-installed, or nothing lands.
      const coreManifests = await loadDiskManifests([...CORE_BOBBIN_IDS])

      const project = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(projects)
          .values({
            name: name.trim(),
            description: description?.trim(),
            ownerId: user.id
          })
          .returning()

        if (!created) {
          throw new Error('Project insert returned no row')
        }

        for (const bobbinId of CORE_BOBBIN_IDS) {
          const manifest = coreManifests.get(bobbinId)
          if (!manifest) {
            fastify.log.warn({ bobbinId }, 'core bobbin manifest missing on disk; skipping auto-install')
            continue
          }
          await tx.insert(bobbinsInstalled).values({
            projectId: created.id,
            bobbinId,
            version: manifest.version,
            manifestJson: manifest,
            enabled: true
          })
        }

        return created
      })

      return reply.status(201).send(project)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create project' })
    }
  })

  // List projects for authenticated user
  fastify.get('/projects', {
    preHandler: [requireAuth, requireScope('projects:read')]
  }, async (request, reply) => {
    try {
      const user = request.user!

      // Project-scoped API keys see only their one project.
      const restriction = request.apiKeyAuth && request.apiKeyProjectId
        ? eq(projects.id, request.apiKeyProjectId)
        : undefined

      const projectList = await db
        .select()
        .from(projects)
        .where(and(eq(projects.ownerId, user.id), isNull(projects.deletedAt), restriction))

      return reply.status(200).send(projectList)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch projects' })
    }
  })

  // Get project by ID (requires ownership)
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId', {
    preHandler: [requireAuth, requireScope('projects:read')]
  }, async (request, reply) => {
    try {
      const { projectId } = request.params

      // Check ownership (also validates UUID and checks project exists)
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return // Response already sent

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      return { project }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch project' })
    }
  })

  // Install bobbin to project (requires ownership)
  fastify.post<{
    Params: { projectId: string }
    Body: {
      manifestPath?: string
      manifestContent?: string
      manifestType?: 'yaml' | 'json'
    }
  }>('/projects/:projectId/bobbins/install', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const { manifestPath, manifestContent, manifestType } = request.body

      // Check ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

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
        return reply.status(400).send({
          error: 'Either manifestPath or manifestContent is required'
        })
      }

      // Parse manifest
      let manifest
      console.log('[BOBBIN INSTALL] Parsing manifest...')
      try {
        if (type === 'yaml') {
          manifest = parseYAML(content)
        } else {
          manifest = JSON.parse(content)
        }
        console.log('[BOBBIN INSTALL] Parsed manifest has extensions:', !!manifest.extensions)
        if (manifest.extensions) {
          console.log('[BOBBIN INSTALL] Extensions:', JSON.stringify(manifest.extensions, null, 2))
        }
      } catch (parseError) {
        return reply.status(400).send({
          error: 'Invalid manifest format',
          details: parseError
        })
      }

      // Validate and compile manifest
      const compiler = new ManifestCompiler({ projectId })
      const result = await compiler.compile(manifest)
      
      console.log('[BOBBIN INSTALL] After compilation, manifest has extensions:', !!manifest.extensions)
      if (manifest.extensions) {
        console.log('[BOBBIN INSTALL] Extensions after compilation:', JSON.stringify(manifest.extensions, null, 2))
      }

      if (!result.success) {
        return reply.status(400).send({
          error: 'Manifest compilation failed',
          details: result.errors,
          warnings: result.warnings
        })
      }

      // Check if bobbin is already installed
      const existingInstall = await db
        .select()
        .from(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, projectId),
          eq(bobbinsInstalled.bobbinId, manifest.id)
        ))
        .limit(1)

      if (existingInstall.length > 0) {
        // Update existing installation
        await db
          .update(bobbinsInstalled)
          .set({
            version: manifest.version,
            manifestJson: manifest,
            enabled: true,
            installedAt: new Date()
          })
          .where(eq(bobbinsInstalled.id, existingInstall[0]!.id))

        return {
          success: true,
          action: 'updated',
          bobbin: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            external: !!manifest.capabilities?.external
          },
          compilation: {
            migrations: result.migrations,
            warnings: result.warnings
          }
        }
      } else {
        // Create new installation
        const [installation] = await db
          .insert(bobbinsInstalled)
          .values({
            projectId,
            bobbinId: manifest.id,
            version: manifest.version,
            manifestJson: manifest,
            enabled: true
          })
          .returning()

        if (!installation) {
          return reply.status(500).send({ error: 'Failed to create installation' })
        }

        // Process seed data for new installations
        if (manifest.seed && Array.isArray(manifest.seed)) {
          try {
            const refMap = new Map<string, string>()

            for (const seedItem of manifest.seed) {
              const data = { ...seedItem.data }

              // Replace {{ref:xxx}} placeholders with actual entity IDs
              for (const [key, value] of Object.entries(data)) {
                if (typeof value !== 'string') continue
                const match = value.match(/^\{\{ref:(.+)\}\}$/)
                if (!match) continue
                const refId = refMap.get(match[1]!)
                if (refId) {
                  data[key] = refId
                } else {
                  fastify.log.warn(`[BOBBIN INSTALL] Unresolved seed ref "{{ref:${match[1]}}}" in ${seedItem.collection}.${key}`)
                }
              }

              const [entity] = await db.insert(entities).values({
                projectId,
                bobbinId: manifest.id,
                collectionName: seedItem.collection,
                entityData: data
              }).returning()

              if (seedItem.ref && entity) {
                refMap.set(seedItem.ref, entity.id)
              }
            }
          } catch (seedError) {
            fastify.log.error(seedError, '[BOBBIN INSTALL] Failed to create seed data')
          }
        }

        return {
          success: true,
          action: 'installed',
          bobbin: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            external: !!manifest.capabilities?.external
          },
          installation: {
            id: installation.id,
            installedAt: installation.installedAt
          },
          compilation: {
            migrations: result.migrations,
            warnings: result.warnings
          }
        }
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: 'Failed to install bobbin',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // List installed bobbins for project (requires ownership)
  // Returns all bobbins visible from this project context: project + collection + global scopes.
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/bobbins', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const userId = request.user!.id

      // Check ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // --- Project-scoped installations (with legacy migration) ---

      const installations = await db
        .select()
        .from(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, projectId),
          eq(bobbinsInstalled.scope, 'project'),
          eq(bobbinsInstalled.enabled, true)
        ))

      const legacySmartPublisher = installations.filter((install) => install.bobbinId === 'smart-publisher')
      const currentWebPublisher = installations.find((install) => install.bobbinId === 'web-publisher')

      if (legacySmartPublisher.length > 0) {
        if (currentWebPublisher) {
          await db.delete(bobbinsInstalled)
            .where(inArray(bobbinsInstalled.id, legacySmartPublisher.map((install) => install.id)))
        } else {
          await db.update(bobbinsInstalled)
            .set({
              bobbinId: 'web-publisher'
            })
            .where(inArray(bobbinsInstalled.id, legacySmartPublisher.map((install) => install.id)))
        }
      }

      const normalizedInstallations = legacySmartPublisher.length > 0
        ? await db
            .select()
            .from(bobbinsInstalled)
            .where(and(
              eq(bobbinsInstalled.projectId, projectId),
              eq(bobbinsInstalled.scope, 'project'),
              eq(bobbinsInstalled.enabled, true)
            ))
        : installations

      // Read disk manifests concurrently, then check for upgrades
      const upgrades: UpgradeResult[] = []
      const allEffective = await getEffectiveBobbins(projectId, userId)
      const allBobbinIds = allEffective.map(b => b.bobbinId)
      const diskManifests = await loadDiskManifests(allBobbinIds)

      // Filter out bobbins that no longer exist on disk (renamed/removed).
      // Auto-uninstall stale records so they don't reappear.
      const staleInstalls = normalizedInstallations.filter(i => !diskManifests.has(i.bobbinId))
      const liveInstalls = normalizedInstallations.filter(i => diskManifests.has(i.bobbinId))

      if (staleInstalls.length > 0) {
        const staleIds = staleInstalls.map(i => i.bobbinId)
        fastify.log.info(`[bobbins] Auto-uninstalling stale bobbins from project ${projectId}: ${staleIds.join(', ')}`)
        // Fire-and-forget cleanup — don't block the response
        db.delete(bobbinsInstalled)
          .where(inArray(bobbinsInstalled.id, staleInstalls.map(i => i.id)))
          .catch(err => fastify.log.error(err, 'Failed to auto-uninstall stale bobbins'))
      }

      for (const install of liveInstalls) {
        const diskManifest = diskManifests.get(install.bobbinId)!

        const result = await checkAndUpgradeBobbin(db, install, diskManifest, projectId)
        if (result) {
          upgrades.push(result)
          if (result.success) {
            install.version = result.toVersion
            install.manifestJson = diskManifest
          }
        }
      }

      // Build response from all effective bobbins (project + collection + global)
      const seenIds = new Set<string>()
      const bobbinsList: any[] = []

      // Project-scoped first (with upgrade info)
      for (const install of liveInstalls) {
        seenIds.add(install.bobbinId)
        bobbinsList.push({
          id: install.bobbinId,
          version: install.version,
          scope: 'project',
          scopeTarget: projectId,
          manifest: diskManifests.get(install.bobbinId),
          installedAt: install.installedAt,
        })
      }

      // Collection + global scoped
      for (const eb of allEffective) {
        if (seenIds.has(eb.bobbinId)) continue
        if (!diskManifests.has(eb.bobbinId)) continue
        seenIds.add(eb.bobbinId)
        bobbinsList.push({
          id: eb.bobbinId,
          scope: eb.scope,
          scopeTarget: eb.scopeOwnerId,
          manifest: diskManifests.get(eb.bobbinId),
        })
      }

      return {
        bobbins: bobbinsList,
        ...(upgrades.length > 0 && { upgrades })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch installed bobbins' })
    }
  })

  // Uninstall bobbin from project (requires ownership)
  fastify.delete<{
    Params: { projectId: string; bobbinId: string }
  }>('/projects/:projectId/bobbins/:bobbinId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId, bobbinId } = request.params

      // Check ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Check if bobbin is installed
      const installation = await db
        .select()
        .from(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, projectId),
          eq(bobbinsInstalled.bobbinId, bobbinId)
        ))
        .limit(1)

      if (installation.length === 0) {
        return reply.status(404).send({ error: 'Bobbin not installed in this project' })
      }

      const installedBobbin = installation[0]!

      // Block uninstall of core infrastructure bobbins (manuscript/import/export).
      // The UI hides the affordance; this is the server-side guard.
      const diskManifests = await loadDiskManifests([bobbinId])
      const diskManifest = diskManifests.get(bobbinId)
      if (diskManifest?.core === true) {
        return reply.status(400).send({
          error: 'Core bobbin cannot be uninstalled',
          bobbinId
        })
      }

      // Delete the installation
      await db
        .delete(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, projectId),
          eq(bobbinsInstalled.bobbinId, bobbinId)
        ))

      return {
        success: true,
        message: `Bobbin ${bobbinId} uninstalled from project ${projectId}`,
        bobbin: {
          id: installedBobbin.bobbinId,
          version: installedBobbin.version
        }
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to uninstall bobbin' })
    }
  })

  // Update project details (requires ownership)
  fastify.put<{
    Params: { projectId: string }
    Body: {
      name?: string
      description?: string
      coverImage?: string | null
    }
  }>('/projects/:projectId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const { name, description, coverImage } = request.body

      // Check ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const updates: Record<string, unknown> = {}
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (coverImage !== undefined) updates.coverImage = coverImage

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'No updates provided' })
      }

      const [project] = await db
        .update(projects)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(projects.id, projectId))
        .returning()

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      return reply.send({ project })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update project' })
    }
  })

  // ============================================================================
  // PROJECT MANUSCRIPT DISPLAY SETTINGS (cascade middle layer)
  // ============================================================================

  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/manuscript-display-settings', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const rows = await db
        .select()
        .from(projectManuscriptDisplaySettings)
        .where(eq(projectManuscriptDisplaySettings.projectId, projectId))
        .limit(1)

      if (rows.length === 0) {
        return reply.status(200).send({
          settings: {
            projectId,
            paragraphSpacing: null,
            paragraphIndent: null,
            codeBlockWrap: null,
            sceneBreakStyle: null,
            dropCaps: null,
            smartDashes: null,
            smartEllipsis: null
          }
        })
      }
      return reply.status(200).send({ settings: rows[0] })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch project manuscript display settings' })
    }
  })

  fastify.put<{
    Params: { projectId: string }
    Body: {
      paragraphSpacing?: 'standard' | 'manuscript' | null
      paragraphIndent?: 'none' | 'first-line' | 'every' | null
      codeBlockWrap?: boolean | null
      sceneBreakStyle?: 'asterism' | 'rule' | 'blank-line' | null
      dropCaps?: boolean | null
      smartDashes?: boolean | null
      smartEllipsis?: boolean | null
    }
  }>('/projects/:projectId/manuscript-display-settings', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return
      const body = request.body ?? {}

      const existing = await db
        .select()
        .from(projectManuscriptDisplaySettings)
        .where(eq(projectManuscriptDisplaySettings.projectId, projectId))
        .limit(1)

      if (existing.length > 0) {
        const [updated] = await db
          .update(projectManuscriptDisplaySettings)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(projectManuscriptDisplaySettings.projectId, projectId))
          .returning()
        return reply.status(200).send({ settings: updated })
      } else {
        const [created] = await db
          .insert(projectManuscriptDisplaySettings)
          .values({ projectId, ...body })
          .returning()
        return reply.status(201).send({ settings: created })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update project manuscript display settings' })
    }
  })
}

export default projectsPlugin
