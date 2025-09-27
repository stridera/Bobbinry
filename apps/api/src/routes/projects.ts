import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { parse as parseYAML } from 'yaml'
import { db } from '../db/connection'
import { projects, bobbinsInstalled } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { ManifestCompiler } from '@bobbinry/compiler'

const projectsPlugin: FastifyPluginAsync = async (fastify) => {
  // Get project by ID
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId', async (request, reply) => {
    try {
      const { projectId } = request.params

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
      manifestContent: string
      manifestType: 'yaml' | 'json'
    }
  }>('/projects/:projectId/bobbins/install', async (request, reply) => {
    try {
      const { projectId } = request.params
      const { manifestContent, manifestType } = request.body

      // Verify project exists
      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (project.length === 0) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      // Parse manifest
      let manifest
      try {
        if (manifestType === 'yaml') {
          manifest = parseYAML(manifestContent)
        } else {
          manifest = JSON.parse(manifestContent)
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
          .where(eq(bobbinsInstalled.id, existingInstall[0].id))

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
}

export default projectsPlugin