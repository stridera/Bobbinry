import { FastifyPluginAsync } from 'fastify'
import { parse as parseYAML } from 'yaml'
import { db } from '../db/connection'
import { projects, bobbinsInstalled } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { ManifestCompiler } from '@bobbinry/compiler'

const projectsPlugin: FastifyPluginAsync = async (fastify) => {
  // Create a new project
  fastify.post<{
    Body: {
      name: string
      description?: string
      ownerId: string
    }
  }>('/projects', async (request, reply) => {
    try {
      const { name, description, ownerId } = request.body

      // Validate input
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Project name is required' })
      }

      if (!ownerId) {
        return reply.status(400).send({ error: 'Owner ID is required' })
      }

      // Create project
      const [project] = await db
        .insert(projects)
        .values({
          name: name.trim(),
          description: description?.trim(),
          ownerId
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

  // List projects for a user
  fastify.get<{
    Querystring: {
      ownerId?: string
    }
  }>('/projects', async (request, reply) => {
    try {
      const { ownerId } = request.query

      let query = db.select().from(projects)

      if (ownerId) {
        query = query.where(eq(projects.ownerId, ownerId)) as any
      }

      const projectList = await query

      return reply.status(200).send(projectList)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch projects' })
    }
  })

  // Helper to validate UUID
  function isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(uuid)
  }

  // Get project by ID
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId', async (request, reply) => {
    try {
      const { projectId } = request.params

      if (!isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (project.length === 0) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      return { project: project[0] }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch project' })
    }
  })

  // Install bobbin to project
  fastify.post<{
    Params: { projectId: string }
    Body: {
      manifestPath?: string
      manifestContent?: string
      manifestType?: 'yaml' | 'json'
    }
  }>('/projects/:projectId/bobbins/install', async (request, reply) => {
    try {
      const { projectId } = request.params
      const { manifestPath, manifestContent, manifestType } = request.body

      if (!isValidUUID(projectId)) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      // Verify project exists
      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (project.length === 0) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      // Get manifest content
      let content: string
      let type: 'yaml' | 'json'

      if (manifestPath) {
        // Read from file
        const fs = await import('fs/promises')
        const path = await import('path')
        
        try {
          // Resolve path relative to project root (two levels up from api/src)
          const projectRoot = path.resolve(__dirname, '../../../..')
          const fullPath = path.resolve(projectRoot, manifestPath)
          content = await fs.readFile(fullPath, 'utf-8')
          type = manifestPath.endsWith('.yaml') || manifestPath.endsWith('.yml') ? 'yaml' : 'json'
        } catch (error) {
          return reply.status(400).send({
            error: 'Failed to read manifest file',
            details: error instanceof Error ? error.message : 'Unknown error'
          })
        }
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

  // List installed bobbins for project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/bobbins', async (request, reply) => {
    try {
      const { projectId } = request.params

      const installations = await db
        .select()
        .from(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, projectId),
          eq(bobbinsInstalled.enabled, true)
        ))

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

  // Uninstall bobbin from project
  fastify.delete<{
    Params: { projectId: string; bobbinId: string }
  }>('/projects/:projectId/bobbins/:bobbinId', async (request, reply) => {
    try {
      const { projectId, bobbinId } = request.params

      // Verify project exists
      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (project.length === 0) {
        return reply.status(404).send({ error: 'Project not found' })
      }

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

  // Update project details
  fastify.put<{
    Params: { projectId: string }
    Body: {
      name?: string
      description?: string
      coverImage?: string | null
    }
  }>('/projects/:projectId', async (request, reply) => {
    try {
      const { projectId } = request.params
      const { name, description, coverImage } = request.body

      if (!isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      const updates: any = {}
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