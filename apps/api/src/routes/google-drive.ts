/**
 * Google Drive Backup Routes (User-Scoped)
 *
 * Handles Drive-scoped OAuth authorization, token exchange, backup status,
 * and per-project sync controls. Tokens are stored in user_bobbins_installed,
 * per-project state in project_destinations.
 */

import { FastifyPluginAsync } from 'fastify'
import * as jose from 'jose'
import { eq, and, sql, isNull } from 'drizzle-orm'
import { db } from '../db/connection'
import { projectDestinations, projects, userBobbinsInstalled, entities } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { env } from '../lib/env'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

function getStateSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET || env.API_JWT_SECRET || 'development-secret-only-for-local-dev'
  return new TextEncoder().encode(secret)
}

/** Look up the user's backup bobbin installation */
async function getUserBackupBobbin(userId: string) {
  const [bobbin] = await db
    .select()
    .from(userBobbinsInstalled)
    .where(
      and(
        eq(userBobbinsInstalled.userId, userId),
        eq(userBobbinsInstalled.bobbinType, 'backup'),
        eq(userBobbinsInstalled.bobbinId, 'google-drive-backup')
      )
    )
    .limit(1)
  return bobbin
}

const googleDrivePlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /backups/google-drive/authorize
   * Returns the Google OAuth consent URL for Drive authorization (user-scoped)
   */
  fastify.get(
    '/backups/google-drive/authorize',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!env.GOOGLE_ID || !env.GOOGLE_SECRET) {
        return reply.status(500).send({ error: 'Google OAuth not configured on this server' })
      }

      const redirectUri = `${env.API_ORIGIN}/api/backups/google-drive/callback`

      // Sign state as JWT for CSRF protection
      const state = await new jose.SignJWT({ userId: request.user!.id })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('10m')
        .sign(getStateSecret())

      const params = new URLSearchParams({
        client_id: env.GOOGLE_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DRIVE_FILE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state,
      })

      const url = `${GOOGLE_AUTH_URL}?${params.toString()}`
      return reply.send({ url })
    }
  )

  /**
   * GET /backups/google-drive/callback
   * Handles the OAuth callback from Google, exchanges code for tokens,
   * creates "Bobbinry Backup" root folder, stores in user_bobbins_installed
   */
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/backups/google-drive/callback',
    async (request, reply) => {
      const { code, state, error: oauthError } = request.query

      if (oauthError) {
        fastify.log.warn({ oauthError }, 'Google Drive OAuth denied')
        return reply.redirect(`${env.WEB_ORIGIN}/backups?drive=denied`)
      }

      if (!code || !state) {
        return reply.status(400).send({ error: 'Missing code or state parameter' })
      }

      // Verify state JWT
      let statePayload: { userId: string }
      try {
        const { payload } = await jose.jwtVerify(state, getStateSecret(), { algorithms: ['HS256'] })
        statePayload = payload as any
      } catch {
        return reply.status(400).send({ error: 'Invalid or expired state parameter' })
      }

      if (!env.GOOGLE_ID || !env.GOOGLE_SECRET) {
        return reply.status(500).send({ error: 'Google OAuth not configured' })
      }

      const redirectUri = `${env.API_ORIGIN}/api/backups/google-drive/callback`

      // Exchange code for tokens
      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.GOOGLE_ID,
          client_secret: env.GOOGLE_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      })

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text()
        fastify.log.error({ status: tokenResponse.status, body: errBody }, 'Google token exchange failed')
        return reply.redirect(`${env.WEB_ORIGIN}/backups?drive=error`)
      }

      const tokens = (await tokenResponse.json()) as {
        access_token: string
        refresh_token?: string
        expires_in: number
        token_type: string
      }

      if (!tokens.refresh_token) {
        fastify.log.warn('No refresh_token returned — user may have previously authorized without revoking')
      }

      // Get user's Drive email for display
      let driveEmail = ''
      try {
        const aboutResp = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        if (aboutResp.ok) {
          const about = (await aboutResp.json()) as { user?: { emailAddress?: string } }
          driveEmail = about.user?.emailAddress || ''
        }
      } catch {
        // Non-critical, proceed without email
      }

      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

      // Create root folder "Bobbinry Backup" in Drive
      let rootFolderId = ''
      let rootFolderName = 'Bobbinry Backup'
      try {
        const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: rootFolderName,
            mimeType: 'application/vnd.google-apps.folder',
          }),
        })

        if (createResp.ok) {
          const folder = (await createResp.json()) as { id: string; name: string }
          rootFolderId = folder.id
          rootFolderName = folder.name
        } else {
          const errText = await createResp.text()
          fastify.log.error({ status: createResp.status, body: errText }, 'Failed to create root backup folder')
        }
      } catch (err) {
        fastify.log.error({ error: err }, 'Failed to create root backup folder')
      }

      // Check for existing backup bobbin for this user
      const existing = await getUserBackupBobbin(statePayload.userId)

      const bobbinConfig = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || (existing?.config as any)?.refreshToken || '',
        tokenExpiresAt,
        driveEmail,
        rootFolderId,
        rootFolderName,
      }

      if (existing) {
        await db
          .update(userBobbinsInstalled)
          .set({
            config: { ...(existing.config as any), ...bobbinConfig },
            isEnabled: true,
            updatedAt: new Date(),
          })
          .where(eq(userBobbinsInstalled.id, existing.id))
      } else {
        await db.insert(userBobbinsInstalled).values({
          userId: statePayload.userId,
          bobbinId: 'google-drive-backup',
          bobbinType: 'backup',
          config: bobbinConfig,
          isEnabled: true,
        })
      }

      return reply.redirect(`${env.WEB_ORIGIN}/backups?drive=connected`)
    }
  )

  /**
   * GET /backups/status
   * Returns connection status + all projects with their backup state
   */
  fastify.get(
    '/backups/status',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id

      const bobbin = await getUserBackupBobbin(userId)

      if (!bobbin || !bobbin.isEnabled) {
        return reply.send({
          connection: { connected: false },
          projects: [],
        })
      }

      const config = bobbin.config as any

      // Get all user's projects LEFT JOIN project_destinations
      const userProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          isArchived: projects.isArchived,
        })
        .from(projects)
        .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)))

      const activeProjects = userProjects.filter(p => !p.isArchived)

      // Get all google_drive destinations for these projects
      const projectIds = activeProjects.map(p => p.id)
      const destinations = projectIds.length > 0
        ? await db
            .select()
            .from(projectDestinations)
            .where(
              and(
                sql`${projectDestinations.projectId} IN ${projectIds}`,
                eq(projectDestinations.type, 'google_drive')
              )
            )
        : []

      const destMap = new Map(destinations.map(d => [d.projectId, d]))

      // Count chapters per project
      const chapterCounts = projectIds.length > 0
        ? await db
            .select({
              projectId: entities.projectId,
              count: sql<number>`count(*)::int`,
            })
            .from(entities)
            .where(sql`${entities.projectId} IN ${projectIds}`)
            .groupBy(entities.projectId)
        : []
      const countMap = new Map(chapterCounts.map(c => [c.projectId, c.count]))

      const projectList = activeProjects.map(p => {
        const dest = destMap.get(p.id)
        return {
          id: p.id,
          name: p.name,
          isBackedUp: dest ? dest.isActive : true, // no row = eligible (default on)
          lastSyncedAt: dest?.lastSyncedAt?.toISOString() || null,
          lastSyncStatus: dest?.lastSyncStatus || null,
          lastSyncError: dest?.lastSyncError || null,
          chapterCount: countMap.get(p.id) || 0,
        }
      })

      return reply.send({
        connection: {
          connected: true,
          provider: 'google_drive',
          driveEmail: config.driveEmail || null,
          rootFolderName: config.rootFolderName || 'Bobbinry Backup',
        },
        projects: projectList,
      })
    }
  )

  /**
   * DELETE /backups/google-drive/disconnect
   * Removes the user's backup bobbin + all project_destinations of type google_drive
   */
  fastify.delete(
    '/backups/google-drive/disconnect',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id

      // Remove user bobbin
      await db
        .delete(userBobbinsInstalled)
        .where(
          and(
            eq(userBobbinsInstalled.userId, userId),
            eq(userBobbinsInstalled.bobbinId, 'google-drive-backup'),
            eq(userBobbinsInstalled.bobbinType, 'backup')
          )
        )

      // Remove all google_drive destinations for user's projects
      const userProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)))

      const projectIds = userProjects.map(p => p.id)
      if (projectIds.length > 0) {
        await db
          .delete(projectDestinations)
          .where(
            and(
              sql`${projectDestinations.projectId} IN ${projectIds}`,
              eq(projectDestinations.type, 'google_drive')
            )
          )
      }

      return reply.send({ success: true })
    }
  )

  /**
   * POST /backups/projects/:projectId/sync
   * Trigger sync for one project
   */
  fastify.post<{ Params: { projectId: string } }>(
    '/backups/projects/:projectId/sync',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId } = request.params

      // Verify project ownership
      const [project] = await db
        .select({ id: projects.id, name: projects.name, userId: projects.ownerId })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId), isNull(projects.deletedAt)))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      const bobbin = await getUserBackupBobbin(userId)
      if (!bobbin || !bobbin.isEnabled) {
        return reply.status(400).send({ error: 'No backup service connected' })
      }

      const config = bobbin.config as any
      if (!config.accessToken || !config.rootFolderId) {
        return reply.status(400).send({ error: 'Backup not properly configured' })
      }

      // Check if project is opted out
      const [dest] = await db
        .select()
        .from(projectDestinations)
        .where(
          and(
            eq(projectDestinations.projectId, projectId),
            eq(projectDestinations.type, 'google_drive')
          )
        )
        .limit(1)

      if (dest && !dest.isActive) {
        return reply.status(400).send({ error: 'Backup is disabled for this project' })
      }

      // Ensure subfolder exists
      const subfolderId = await ensureProjectSubfolder(
        config, projectId, project.name, dest, fastify.log, bobbin.id
      )
      if (!subfolderId) {
        return reply.status(502).send({ error: 'Failed to create Drive subfolder' })
      }

      // Sync all chapters
      const bobbinId = 'google-drive-backup'
      const { syncChapterToGoogleDrive } = await import(
        `../../../../bobbins/${bobbinId}/actions/sync-service`
      )

      const chapters = await db
        .select()
        .from(entities)
        .where(eq(entities.projectId, projectId))

      let succeeded = 0
      let failed = 0

      // Build a mock destination with user-level tokens + project subfolder
      const syncDestination = {
        id: dest?.id || 'temp',
        config: {
          ...config,
          folderId: subfolderId,
        },
      }

      const persistToken = async (_destId: string, accessToken: string, tokenExpiresAt: string) => {
        await db.update(userBobbinsInstalled).set({
          config: { ...config, accessToken, tokenExpiresAt },
          updatedAt: new Date(),
        }).where(eq(userBobbinsInstalled.id, bobbin.id))
      }

      for (const entity of chapters) {
        const data = entity.entityData as any
        const existingFileId = data?.driveFileId || null

        const result = await syncChapterToGoogleDrive(
          {
            id: entity.id,
            title: data?.title || 'Untitled',
            content: data?.content || '',
            projectId: entity.projectId,
          },
          syncDestination,
          existingFileId,
          fastify.log,
          persistToken
        )

        if (result.success && result.fileId) {
          succeeded++
          await db
            .update(entities)
            .set({
              entityData: {
                ...data,
                driveFileId: result.fileId,
                driveFileUrl: result.fileUrl,
                lastSyncedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            })
            .where(eq(entities.id, entity.id))
        } else {
          failed++
          if (result.error === 'folder_deleted') break
        }
      }

      // Update destination status
      if (dest) {
        await db
          .update(projectDestinations)
          .set({
            lastSyncedAt: new Date(),
            lastSyncStatus: failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed',
            lastSyncError: failed > 0 ? `${failed} of ${chapters.length} chapters failed` : null,
            updatedAt: new Date(),
          })
          .where(eq(projectDestinations.id, dest.id))
      }

      return reply.send({
        success: true,
        succeeded,
        failed,
        total: chapters.length,
      })
    }
  )

  /**
   * PUT /backups/projects/:projectId
   * Toggle backup opt-in/out for a project
   */
  fastify.put<{ Params: { projectId: string }; Body: { isActive: boolean } }>(
    '/backups/projects/:projectId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId } = request.params
      const { isActive } = request.body || {}

      // Verify project ownership
      const [project] = await db
        .select({ id: projects.id, userId: projects.ownerId })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId), isNull(projects.deletedAt)))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      // Find or create destination row
      const [existing] = await db
        .select()
        .from(projectDestinations)
        .where(
          and(
            eq(projectDestinations.projectId, projectId),
            eq(projectDestinations.type, 'google_drive')
          )
        )
        .limit(1)

      if (existing) {
        await db
          .update(projectDestinations)
          .set({ isActive, updatedAt: new Date() })
          .where(eq(projectDestinations.id, existing.id))
      } else {
        await db.insert(projectDestinations).values({
          projectId,
          type: 'google_drive',
          name: 'Google Drive Backup',
          config: {},
          isActive,
          lastSyncStatus: 'pending',
        })
      }

      return reply.send({ success: true, isActive })
    }
  )

  /**
   * POST /backups/sync
   * Trigger sync for all opted-in projects
   */
  fastify.post(
    '/backups/sync',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id

      const bobbin = await getUserBackupBobbin(userId)
      if (!bobbin || !bobbin.isEnabled) {
        return reply.status(400).send({ error: 'No backup service connected' })
      }

      const config = bobbin.config as any

      // Get all user's active projects
      const userProjects = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.ownerId, userId), eq(projects.isArchived, false), isNull(projects.deletedAt)))

      // Filter out opted-out projects
      const projectIds = userProjects.map(p => p.id)
      const optedOut = projectIds.length > 0
        ? await db
            .select({ projectId: projectDestinations.projectId })
            .from(projectDestinations)
            .where(
              and(
                sql`${projectDestinations.projectId} IN ${projectIds}`,
                eq(projectDestinations.type, 'google_drive'),
                eq(projectDestinations.isActive, false)
              )
            )
        : []
      const optedOutIds = new Set(optedOut.map(d => d.projectId))

      const eligibleProjects = userProjects.filter(p => !optedOutIds.has(p.id))

      let totalSucceeded = 0
      let totalFailed = 0
      let totalChapters = 0

      for (const project of eligibleProjects) {
        // Get or create dest
        const [dest] = await db
          .select()
          .from(projectDestinations)
          .where(
            and(
              eq(projectDestinations.projectId, project.id),
              eq(projectDestinations.type, 'google_drive')
            )
          )
          .limit(1)

        const subfolderId = await ensureProjectSubfolder(
          config, project.id, project.name, dest || null, fastify.log, bobbin.id
        )
        if (!subfolderId) continue

        const bobbinId = 'google-drive-backup'
        const { syncChapterToGoogleDrive } = await import(
          `../../../../bobbins/${bobbinId}/actions/sync-service`
        )

        const chapters = await db
          .select()
          .from(entities)
          .where(eq(entities.projectId, project.id))

        totalChapters += chapters.length

        const syncDestination = {
          id: dest?.id || 'temp',
          config: { ...config, folderId: subfolderId },
        }

        const persistToken = async (_destId: string, accessToken: string, tokenExpiresAt: string) => {
          await db.update(userBobbinsInstalled).set({
            config: { ...config, accessToken, tokenExpiresAt },
            updatedAt: new Date(),
          }).where(eq(userBobbinsInstalled.id, bobbin.id))
        }

        let succeeded = 0
        let failed = 0

        for (const entity of chapters) {
          const data = entity.entityData as any
          const result = await syncChapterToGoogleDrive(
            {
              id: entity.id,
              title: data?.title || 'Untitled',
              content: data?.content || '',
              projectId: entity.projectId,
            },
            syncDestination,
            data?.driveFileId || null,
            fastify.log,
            persistToken
          )

          if (result.success && result.fileId) {
            succeeded++
            await db.update(entities).set({
              entityData: { ...data, driveFileId: result.fileId, driveFileUrl: result.fileUrl, lastSyncedAt: new Date().toISOString() },
              updatedAt: new Date(),
            }).where(eq(entities.id, entity.id))
          } else {
            failed++
            if (result.error === 'folder_deleted') break
          }
        }

        totalSucceeded += succeeded
        totalFailed += failed

        // Update destination status
        const currentDest = dest || await db
          .select()
          .from(projectDestinations)
          .where(and(eq(projectDestinations.projectId, project.id), eq(projectDestinations.type, 'google_drive')))
          .limit(1)
          .then(rows => rows[0])

        if (currentDest) {
          await db.update(projectDestinations).set({
            lastSyncedAt: new Date(),
            lastSyncStatus: failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed',
            lastSyncError: failed > 0 ? `${failed} chapters failed` : null,
            updatedAt: new Date(),
          }).where(eq(projectDestinations.id, currentDest.id))
        }
      }

      return reply.send({
        success: true,
        projects: eligibleProjects.length,
        succeeded: totalSucceeded,
        failed: totalFailed,
        total: totalChapters,
      })
    }
  )
}

/**
 * Ensure a subfolder exists under the root backup folder for a project.
 * Creates the project_destinations row if it doesn't exist yet.
 */
async function ensureProjectSubfolder(
  userConfig: any,
  projectId: string,
  projectName: string,
  existingDest: any | null,
  log: any,
  bobbinInstallId: string
): Promise<string | null> {
  // If dest already has a subfolderId, return it
  if (existingDest) {
    const destConfig = existingDest.config as any
    if (destConfig?.subfolderId) {
      return destConfig.subfolderId
    }
  }

  if (!userConfig.rootFolderId || !userConfig.accessToken) {
    return null
  }

  const accessToken = await ensureFreshUserToken(userConfig, bobbinInstallId)

  // Create subfolder under root
  const shortId = projectId.slice(0, 6)
  const folderName = `${projectName} (${shortId})`

  try {
    const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [userConfig.rootFolderId],
      }),
    })

    if (!createResp.ok) {
      const errText = await createResp.text()
      log.error({ status: createResp.status, body: errText }, 'Failed to create project subfolder')
      return null
    }

    const folder = (await createResp.json()) as { id: string; name: string }

    // Create or update destination row
    if (existingDest) {
      await db
        .update(projectDestinations)
        .set({
          config: { ...(existingDest.config as any), subfolderId: folder.id, subfolderName: folder.name },
          updatedAt: new Date(),
        })
        .where(eq(projectDestinations.id, existingDest.id))
    } else {
      await db.insert(projectDestinations).values({
        projectId,
        type: 'google_drive',
        name: 'Google Drive Backup',
        config: { subfolderId: folder.id, subfolderName: folder.name },
        isActive: true,
        lastSyncStatus: 'pending',
      })
    }

    return folder.id
  } catch (err) {
    log.error({ error: err }, 'Failed to create project subfolder')
    return null
  }
}

/**
 * Ensure the user's access token is fresh. Refreshes if within 5 minutes of expiry.
 * Updates the user_bobbins_installed row with the new token.
 */
async function ensureFreshUserToken(config: any, bobbinInstallId: string): Promise<string> {
  const expiresAt = config.tokenExpiresAt ? new Date(config.tokenExpiresAt).getTime() : 0
  const fiveMinutes = 5 * 60 * 1000

  if (Date.now() < expiresAt - fiveMinutes) {
    return config.accessToken
  }

  if (!config.refreshToken) {
    throw new Error('No refresh token available — user must re-authorize')
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GOOGLE_ID,
      client_secret: env.GOOGLE_SECRET,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Token refresh failed (${response.status}): ${errText}`)
  }

  const tokens = (await response.json()) as {
    access_token: string
    expires_in: number
  }

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await db
    .update(userBobbinsInstalled)
    .set({
      config: {
        ...config,
        accessToken: tokens.access_token,
        tokenExpiresAt: newExpiresAt,
      },
      updatedAt: new Date(),
    })
    .where(eq(userBobbinsInstalled.id, bobbinInstallId))

  return tokens.access_token
}

// Export for use by sync handler
export { ensureFreshUserToken, getUserBackupBobbin, ensureProjectSubfolder }

export default googleDrivePlugin
