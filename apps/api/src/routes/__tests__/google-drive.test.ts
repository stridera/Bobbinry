import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals'
import * as jose from 'jose'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, projectDestinations, userBobbinsInstalled } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'
import { encryptDriveConfig } from '../google-drive'
import { decryptSecret } from '../../lib/secret-storage'

/**
 * Google Drive backup routes: OAuth connect/callback, backup status,
 * per-project opt-in, and manual sync trigger.
 *
 * Google is never called. Two things are mocked:
 *  - `global.fetch`, which the route uses directly for token exchange and
 *    Drive API calls (no wrapper module exists).
 *  - the compiled bobbin module `bobbins/google-drive-backup/dist/actions/sync-service`,
 *    which `drive-sync-core.ts` loads via a dynamic `import()` at the exact
 *    relative path mocked below — this is what the manual sync route's
 *    background `runProjectSync()` call ultimately invokes per chapter.
 */
describe('Google Drive backup routes', () => {
  let app: any
  let originalFetch: typeof global.fetch
  const originalGoogleId = process.env.GOOGLE_ID
  const originalGoogleSecret = process.env.GOOGLE_SECRET
  const stateSecretBytes = new TextEncoder().encode(
    process.env.NEXTAUTH_SECRET || process.env.API_JWT_SECRET || ''
  )

  beforeAll(async () => {
    app = await createTestApp()
    originalFetch = global.fetch
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await cleanupAllTestData()
    process.env.GOOGLE_ID = originalGoogleId
    process.env.GOOGLE_SECRET = originalGoogleSecret
    global.fetch = originalFetch
    mockSyncChapter.mockReset()
  })

  async function verifiedUser() {
    const user = await createTestUser()
    const token = await createTestToken(user.id)
    return { user, token }
  }

  async function signState(userId: string) {
    return new jose.SignJWT({ userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(stateSecretBytes)
  }

  function authorize(token?: string) {
    return app.inject({
      method: 'GET',
      url: '/api/backups/google-drive/authorize',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function callback(query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString()
    return app.inject({ method: 'GET', url: `/api/backups/google-drive/callback?${qs}` })
  }

  function status(token?: string) {
    return app.inject({
      method: 'GET',
      url: '/api/backups/status',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function putProject(token: string | undefined, projectId: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: `/api/backups/projects/${projectId}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body,
    })
  }

  function postSync(token: string | undefined, projectId: string) {
    return app.inject({
      method: 'POST',
      url: `/api/backups/projects/${projectId}/sync`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  async function seedBobbin(userId: string, config: Record<string, unknown>, isEnabled = true) {
    const [row] = await db
      .insert(userBobbinsInstalled)
      .values({
        userId,
        bobbinId: 'google-drive-backup',
        bobbinType: 'backup',
        config: encryptDriveConfig(config as any),
        isEnabled,
      })
      .returning()
    return row!
  }

  async function seedDestination(projectId: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db
      .insert(projectDestinations)
      .values({
        projectId,
        type: 'google_drive',
        name: 'Google Drive Backup',
        config: {},
        isActive: true,
        lastSyncStatus: 'pending',
        ...overrides,
      } as any)
      .returning()
    return row!
  }

  async function seedEntity(projectId: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db
      .insert(entities)
      .values({
        projectId,
        bobbinId: 'content',
        collectionName: 'content',
        entityData: { title: 'Chapter 1', body: 'Once upon a time...', ...overrides },
      } as any)
      .returning()
    return row!
  }

  async function getDestination(projectId: string) {
    const [row] = await db
      .select()
      .from(projectDestinations)
      .where(and(eq(projectDestinations.projectId, projectId), eq(projectDestinations.type, 'google_drive')))
      .limit(1)
    return row
  }

  async function waitForDestinationStatus(
    projectId: string,
    notStatus: string,
    timeoutMs = 3000
  ): Promise<any> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const dest = await getDestination(projectId)
      if (dest && dest.lastSyncStatus !== notStatus) return dest
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error(`Timed out waiting for destination status to leave "${notStatus}"`)
  }

  // Mocks the compiled bobbin's sync-service module. Path is relative to
  // *this test file* but resolves to the same absolute file that
  // apps/api/src/jobs/drive-sync-core.ts dynamically imports at runtime
  // (bobbins/google-drive-backup/dist/actions/sync-service).
  const mockSyncChapter = jest.fn()
  jest.mock('../../../../../bobbins/google-drive-backup/dist/actions/sync-service', () => ({
    syncChapterToGoogleDrive: (...args: unknown[]) => mockSyncChapter(...args),
  }))

  // ===========================================================================
  // GET /backups/google-drive/authorize
  // ===========================================================================

  describe('GET /backups/google-drive/authorize', () => {
    it('returns 401 without a token', async () => {
      const res = await authorize()
      expect(res.statusCode).toBe(401)
    })

    it('returns "not configured" status rather than 500-by-accident when Google credentials are unset', async () => {
      const { token } = await verifiedUser()
      delete process.env.GOOGLE_ID
      delete process.env.GOOGLE_SECRET

      const res = await authorize(token)
      expect(res.statusCode).toBe(500)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Google OAuth not configured on this server' })
    })

    it('returns an auth URL with a state param signed for the requesting user', async () => {
      process.env.GOOGLE_ID = 'test-client-id'
      process.env.GOOGLE_SECRET = 'test-client-secret'
      const { user, token } = await verifiedUser()

      const res = await authorize(token)
      expect(res.statusCode).toBe(200)
      const { url } = JSON.parse(res.payload)
      expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)

      const parsed = new URL(url)
      expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
      expect(parsed.searchParams.get('response_type')).toBe('code')
      expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
      expect(parsed.searchParams.get('access_type')).toBe('offline')
      expect(parsed.searchParams.get('prompt')).toBe('consent')

      const state = parsed.searchParams.get('state')
      expect(state).toBeTruthy()
      const { payload } = await jose.jwtVerify(state!, stateSecretBytes, { algorithms: ['HS256'] })
      expect(payload.userId).toBe(user.id)
    })
  })

  // ===========================================================================
  // GET /backups/google-drive/callback
  // ===========================================================================

  describe('GET /backups/google-drive/callback', () => {
    it('redirects with drive=denied when Google reports an OAuth error', async () => {
      const res = await callback({ error: 'access_denied' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${process.env.WEB_ORIGIN}/backups?drive=denied`)
    })

    it('returns 400 for a missing code or state parameter', async () => {
      const res = await callback({})
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing code or state parameter' })
    })

    it('refuses a tampered state with 400', async () => {
      const res = await callback({ code: 'abc123', state: 'not-a-real-jwt' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid or expired state parameter' })
    })

    it('returns "not configured" rather than a raw 500 crash when Google credentials are unset', async () => {
      const { user } = await verifiedUser()
      const state = await signState(user.id)
      delete process.env.GOOGLE_ID
      delete process.env.GOOGLE_SECRET

      const res = await callback({ code: 'abc123', state })
      expect(res.statusCode).toBe(500)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Google OAuth not configured' })
    })

    it('handles a Google token-exchange error response rather than throwing', async () => {
      process.env.GOOGLE_ID = 'test-client-id'
      process.env.GOOGLE_SECRET = 'test-client-secret'
      const { user } = await verifiedUser()
      const state = await signState(user.id)

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      })) as any

      const res = await callback({ code: 'abc123', state })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${process.env.WEB_ORIGIN}/backups?drive=error`)
    })

    it('completes a valid callback and stores the encrypted connection', async () => {
      process.env.GOOGLE_ID = 'test-client-id'
      process.env.GOOGLE_SECRET = 'test-client-secret'
      const { user } = await verifiedUser()
      const state = await signState(user.id)

      global.fetch = jest.fn(async (url: any) => {
        const u = String(url)
        if (u.includes('oauth2.googleapis.com/token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'access-tok-123',
              refresh_token: 'refresh-tok-456',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
          }
        }
        if (u.includes('drive/v3/about')) {
          return { ok: true, json: async () => ({ user: { emailAddress: 'writer@example.com' } }) }
        }
        if (u.includes('drive/v3/files')) {
          return { ok: true, json: async () => ({ id: 'root-folder-id', name: 'Bobbinry Backup' }) }
        }
        throw new Error(`Unexpected fetch to ${u}`)
      }) as any

      const res = await callback({ code: 'abc123', state })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${process.env.WEB_ORIGIN}/backups?drive=connected`)

      const [row] = await db
        .select()
        .from(userBobbinsInstalled)
        .where(and(eq(userBobbinsInstalled.userId, user.id), eq(userBobbinsInstalled.bobbinId, 'google-drive-backup')))
        .limit(1)
      expect(row).toBeTruthy()
      expect(row!.bobbinType).toBe('backup')
      expect(row!.isEnabled).toBe(true)

      const config = row!.config as any
      // Tokens must be encrypted at rest (v1: envelope), never plaintext.
      expect(config.accessToken).toMatch(/^v1:/)
      expect(config.refreshToken).toMatch(/^v1:/)
      expect(decryptSecret(config.accessToken)).toBe('access-tok-123')
      expect(decryptSecret(config.refreshToken)).toBe('refresh-tok-456')
      expect(config.driveEmail).toBe('writer@example.com')
      expect(config.rootFolderId).toBe('root-folder-id')
      expect(config.rootFolderName).toBe('Bobbinry Backup')
    })
  })

  // ===========================================================================
  // GET /backups/status
  // ===========================================================================

  describe('GET /backups/status', () => {
    it('returns 401 without a token', async () => {
      const res = await status()
      expect(res.statusCode).toBe(401)
    })

    it('reports not connected cleanly when nothing is installed', async () => {
      const { token } = await verifiedUser()
      const res = await status(token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ connection: { connected: false }, projects: [] })
    })

    it('reflects the stored config and project destinations', async () => {
      const { user, token } = await verifiedUser()
      await seedBobbin(user.id, {
        accessToken: 'tok',
        refreshToken: 'reftok',
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        driveEmail: 'writer@example.com',
        rootFolderId: 'root-1',
        rootFolderName: 'Bobbinry Backup',
      })

      const backedUpProject = await createTestProject(user.id, { name: 'Backed Up Project' })
      const dest = await seedDestination(backedUpProject.id, {
        isActive: true,
        config: { subfolderId: 'sub-1' },
        lastSyncStatus: 'success',
        lastSyncedAt: new Date(),
      })
      await seedEntity(backedUpProject.id)
      await seedEntity(backedUpProject.id)

      const defaultProject = await createTestProject(user.id, { name: 'No Destination Row Yet' })

      const res = await status(token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      expect(body.connection).toEqual({
        connected: true,
        provider: 'google_drive',
        driveEmail: 'writer@example.com',
        rootFolderName: 'Bobbinry Backup',
        rootFolderId: 'root-1',
      })

      const backedUp = body.projects.find((p: any) => p.id === backedUpProject.id)
      expect(backedUp).toBeTruthy()
      expect(backedUp.isBackedUp).toBe(dest.isActive)
      expect(backedUp.lastSyncStatus).toBe('success')
      expect(backedUp.driveFolderId).toBe('sub-1')
      expect(backedUp.chapterCount).toBe(2)

      // No project_destinations row = eligible by default (isBackedUp true).
      const withoutRow = body.projects.find((p: any) => p.id === defaultProject.id)
      expect(withoutRow).toBeTruthy()
      expect(withoutRow.isBackedUp).toBe(true)
      expect(withoutRow.lastSyncStatus).toBeNull()
      expect(withoutRow.chapterCount).toBe(0)
    })
  })

  // ===========================================================================
  // PUT /backups/projects/:projectId
  // ===========================================================================

  describe('PUT /backups/projects/:projectId', () => {
    it('returns 401 without a token', async () => {
      const { user } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await putProject(undefined, project.id, { isActive: false })
      expect(res.statusCode).toBe(401)
    })

    it('refuses a non-owner with 403 Forbidden', async () => {
      const { token } = await verifiedUser()
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)

      const res = await putProject(token, project.id, { isActive: false })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Forbidden',
        message: 'You do not have permission to access this project',
      })
    })

    it('persists opt-out then opt-in in project_destinations', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)

      const off = await putProject(token, project.id, { isActive: false })
      expect(off.statusCode).toBe(200)
      expect(JSON.parse(off.payload)).toEqual({ success: true, isActive: false })

      const afterOff = await getDestination(project.id)
      expect(afterOff?.isActive).toBe(false)
      const rowId = afterOff!.id

      const on = await putProject(token, project.id, { isActive: true })
      expect(on.statusCode).toBe(200)
      expect(JSON.parse(on.payload)).toEqual({ success: true, isActive: true })

      const afterOn = await getDestination(project.id)
      expect(afterOn?.isActive).toBe(true)
      // Same row was updated, not a second one inserted.
      expect(afterOn?.id).toBe(rowId)
    })
  })

  // ===========================================================================
  // POST /backups/projects/:projectId/sync
  // ===========================================================================

  describe('POST /backups/projects/:projectId/sync', () => {
    it('returns 401 without a token', async () => {
      const { user } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await postSync(undefined, project.id)
      expect(res.statusCode).toBe(401)
    })

    it('refuses a non-owner with 403 Forbidden', async () => {
      const { token } = await verifiedUser()
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)

      const res = await postSync(token, project.id)
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Forbidden',
        message: 'You do not have permission to access this project',
      })
    })

    it('returns 400 when no backup service is connected', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)

      const res = await postSync(token, project.id)
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'No backup service connected' })
    })

    it('returns 400 when the backup config is incomplete', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await seedBobbin(user.id, {}) // enabled, but no accessToken/rootFolderId

      const res = await postSync(token, project.id)
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Backup not properly configured' })
    })

    it('returns 400 when the project has opted out of backups', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await seedBobbin(user.id, {
        accessToken: 'tok',
        rootFolderId: 'root-1',
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      await seedDestination(project.id, { isActive: false })

      const res = await postSync(token, project.id)
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Backup is disabled for this project' })
    })

    it('starts the sync and records success once the (mocked) Drive client succeeds', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await seedBobbin(user.id, {
        accessToken: 'tok',
        rootFolderId: 'root-1',
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      // Pre-seed the subfolder id so ensureProjectSubfolder short-circuits
      // without needing to mock the Drive folder-creation fetch call too.
      await seedDestination(project.id, { isActive: true, config: { subfolderId: 'sub-1' } })
      const entity = await seedEntity(project.id)

      mockSyncChapter.mockResolvedValue({
        success: true,
        fileId: 'drive-file-1',
        fileUrl: 'https://drive.google.com/file/drive-file-1',
      })

      const res = await postSync(token, project.id)
      expect(res.statusCode).toBe(202)
      expect(JSON.parse(res.payload)).toEqual({ started: true })

      const dest = await waitForDestinationStatus(project.id, 'syncing')
      expect(dest.lastSyncStatus).toBe('success')
      expect(dest.lastSyncError).toBeNull()
      expect(dest.lastSyncedAt).toBeTruthy()

      const [updatedEntity] = await db.select().from(entities).where(eq(entities.id, entity.id)).limit(1)
      expect((updatedEntity!.entityData as any).driveFileId).toBe('drive-file-1')
      expect((updatedEntity!.entityData as any).driveFileUrl).toBe('https://drive.google.com/file/drive-file-1')
    })

    it('records failure instead of throwing when the (mocked) Drive client fails', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await seedBobbin(user.id, {
        accessToken: 'tok',
        rootFolderId: 'root-1',
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      await seedDestination(project.id, { isActive: true, config: { subfolderId: 'sub-1' } })
      await seedEntity(project.id)

      mockSyncChapter.mockResolvedValue({ success: false, error: 'upload_failed' })

      const res = await postSync(token, project.id)
      expect(res.statusCode).toBe(202)
      expect(JSON.parse(res.payload)).toEqual({ started: true })

      const dest = await waitForDestinationStatus(project.id, 'syncing')
      expect(dest.lastSyncStatus).toBe('failed')
      expect(dest.lastSyncError).toMatch(/failed/)
    })
  })
})
