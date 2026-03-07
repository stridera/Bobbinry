import { FastifyPluginAsync } from 'fastify'
import { parse as parseYAML } from 'yaml'
import * as path from 'path'
import * as fs from 'fs/promises'
import { db } from '../db/connection'
import { projects, bobbinsInstalled } from '../db/schema'
import { eq, and, count } from 'drizzle-orm'
import { ManifestCompiler } from '@bobbinry/compiler'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'
import { getUserMembershipTier, getProjectLimit } from '../lib/membership'

const projectsPlugin: FastifyPluginAsync = async (fastify) => {
  // Create a new project (requires authentication)
  fastify.post<{
    Body: {
      name: string
      description?: string
    }
  }>('/projects', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { name, description } = request.body
      const user = request.user!

      // Validate input
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Project name is required' })
      }

      // Check project limit based on membership tier
      const tier = await getUserMembershipTier(user.id)
      const limit = getProjectLimit(tier)

      const [projectCount] = await db
        .select({ count: count() })
        .from(projects)
        .where(and(
          eq(projects.ownerId, user.id),
          eq(projects.isArchived, false)
        ))

      if ((projectCount?.count ?? 0) >= limit) {
        return reply.status(403).send({
          error: `Project limit reached. ${tier === 'free' ? 'Free' : 'Supporter'} accounts can create up to ${limit} projects.`,
          limit,
          tier,
          upgradeUrl: '/membership',
        })
      }

      // Create project with authenticated user as owner
      const [project] = await db
        .insert(projects)
        .values({
          name: name.trim(),
          description: description?.trim(),
          ownerId: user.id
        })
        .returning()

      if (!project) {
        return reply.status(500).send({ error: 'Failed to create project' })
      }

      return reply.status(201).send(project)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create project' })
    }
  })

  // List projects for authenticated user
  fastify.get('/projects', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const user = request.user!

      // Only return projects owned by the authenticated user
      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.ownerId, user.id))

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
    preHandler: requireAuth
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
        // Read from file - SECURITY: Only allow paths within bobbins directory
        const fs = await import('fs/promises')

        // Resolve paths
        const projectRoot = path.resolve(__dirname, '../../../..')
        const bobbinsDir = path.resolve(projectRoot, 'bobbins')
        const fullPath = path.resolve(projectRoot, manifestPath)

        // Security check: Ensure the resolved path is within allowed directories
        if (!fullPath.startsWith(bobbinsDir + path.sep)) {
          return reply.status(403).send({
            error: 'Access denied',
            message: 'Manifest path must be within the bobbins directory'
          })
        }

        // Try the given path, falling back to alternative manifest location
        // Supports both: bobbins/foo.manifest.yaml and bobbins/foo/manifest.yaml
        try {
          content = await fs.readFile(fullPath, 'utf-8')
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            return reply.status(400).send({
              error: 'Failed to read manifest file',
              details: err.message ?? 'Unknown error'
            })
          }
          // Try subdirectory format: bobbins/foo/manifest.yaml
          let altContent: string | undefined
          const match = manifestPath.match(/^bobbins\/(.+)\.manifest\.yaml$/)
          if (match) {
            const altPath = path.resolve(projectRoot, `bobbins/${match[1]}/manifest.yaml`)
            if (altPath.startsWith(bobbinsDir + path.sep)) {
              altContent = await fs.readFile(altPath, 'utf-8').catch(() => undefined)
            }
          }
          if (!altContent) {
            return reply.status(400).send({
              error: 'Failed to read manifest file',
              details: err.message
            })
          }
          content = altContent
        }
        type = manifestPath.endsWith('.yaml') || manifestPath.endsWith('.yml') ? 'yaml' : 'json'
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

      // Check bobbin dependencies
      const requiredBobbins: string[] = manifest.compatibility?.requiredBobbins || manifest.requires || []
      if (requiredBobbins.length > 0) {
        const existingInstalls = await db
          .select({ bobbinId: bobbinsInstalled.bobbinId })
          .from(bobbinsInstalled)
          .where(and(
            eq(bobbinsInstalled.projectId, projectId),
            eq(bobbinsInstalled.enabled, true)
          ))
        const installedIds = new Set(existingInstalls.map(i => i.bobbinId))
        const missingBobbins = requiredBobbins.filter((id: string) => !installedIds.has(id))
        if (missingBobbins.length > 0) {
          return reply.status(400).send({
            error: 'missing_dependencies',
            message: `This bobbin requires the following bobbins to be installed first: ${missingBobbins.join(', ')}`,
            missingBobbins
          })
        }
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
            version: manifest.version
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

        return {
          success: true,
          action: 'installed',
          bobbin: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version
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
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/bobbins', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params

      // Check ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const installations = await db
        .select()
        .from(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, projectId),
          eq(bobbinsInstalled.enabled, true)
        ))

      // In development, refresh manifests from disk to pick up YAML changes
      // This prevents stale manifests when devs edit YAML without re-installing
      if (process.env.NODE_ENV === 'development') {
        const projectRoot = path.resolve(__dirname, '../../../..')
        for (const install of installations) {
          try {
            const manifestPath = path.resolve(projectRoot, `bobbins/${install.bobbinId}/manifest.yaml`)
            const content = await fs.readFile(manifestPath, 'utf-8')
            const freshManifest = parseYAML(content)
            const stored = install.manifestJson as Record<string, any>

            // Compare key sections that affect the shell
            const sectionsToSync = ['extensions', 'ui', 'execution', 'capabilities', 'data', 'interactions'] as const
            let needsUpdate = false
            const merged = { ...stored }

            for (const section of sectionsToSync) {
              const freshVal = JSON.stringify(freshManifest[section] ?? null)
              const storedVal = JSON.stringify(stored[section] ?? null)
              if (freshVal !== storedVal) {
                console.log(`[DEV] Manifest ${install.bobbinId}: "${section}" section changed on disk`)
                merged[section] = freshManifest[section]
                needsUpdate = true
              }
            }

            if (needsUpdate) {
              console.log(`[DEV] Refreshing stale manifest for ${install.bobbinId}`)
              await db.update(bobbinsInstalled)
                .set({ manifestJson: merged })
                .where(eq(bobbinsInstalled.id, install.id))
              install.manifestJson = merged
            }
          } catch {
            // Manifest file not found on disk - skip refresh
          }
        }
      }

      return {
        bobbins: installations.map((install: any) => ({
          id: install.bobbinId,
          version: install.version,
          manifest: install.manifestJson,
          installedAt: install.installedAt
        }))
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
}

export default projectsPlugin