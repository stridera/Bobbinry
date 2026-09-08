import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { bobbinsInstalled } from '../../db/schema'
import { and, eq } from 'drizzle-orm'
import { createTestApp, createTestToken, createTestUser, cleanupAllTestData } from '../../__tests__/test-helpers'

/**
 * User-scoped (global) bobbin installs: apps/api/src/routes/user-bobbins.ts
 *
 * Every route here acts on request.user!.id (there is no :userId param), so
 * there is no separate "acting on someone else's install" refusal to trigger
 * via the URL. Isolation is instead verified by confirming that list/uninstall
 * never observe or touch another user's rows.
 */
describe('User-scoped bobbins', () => {
  let app: any

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function testUser() {
    const u = await createTestUser()
    return { user: u, token: await createTestToken(u.id) }
  }

  function install(token: string | undefined, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/users/me/bobbins/install',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload,
    })
  }

  function list(token: string | undefined) {
    return app.inject({
      method: 'GET',
      url: '/api/users/me/bobbins',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function uninstall(token: string | undefined, bobbinId: string) {
    return app.inject({
      method: 'DELETE',
      url: `/api/users/me/bobbins/${bobbinId}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  // A manifest whose id matches a real bobbins/<id>/manifest.yaml directory,
  // so the list route's disk-manifest lookup succeeds. /install only
  // validates the submitted content -- never the disk file -- so we can
  // freely force `install.scopes` to include 'global' regardless of what
  // the real on-disk manifest for this id declares.
  function helloWorldManifest(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      id: 'hello-world',
      name: 'Hello World Global',
      version: '1.0.0',
      install: { scopes: ['global'] },
      data: { collections: [] },
      ...overrides,
    })
  }

  // --- 1. Auth ---

  describe('auth', () => {
    it('rejects install without a token', async () => {
      const res = await install(undefined, { manifestContent: helloWorldManifest() })
      expect(res.statusCode).toBe(401)
    })

    it('rejects list without a token', async () => {
      const res = await list(undefined)
      expect(res.statusCode).toBe(401)
    })

    it('rejects uninstall without a token', async () => {
      const res = await uninstall(undefined, 'hello-world')
      expect(res.statusCode).toBe(401)
    })
  })

  // --- 2. Install ---

  describe('install', () => {
    it('installs a bobbin whose submitted manifest declares global scope', async () => {
      const { token } = await testUser()
      const res = await install(token, { manifestContent: helloWorldManifest(), manifestType: 'json' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.success).toBe(true)
      expect(body.action).toBe('installed')
      expect(body.bobbin).toEqual({ id: 'hello-world', name: 'Hello World Global', version: '1.0.0' })
      expect(body.installation.id).toBeDefined()
    })

    it('rejects a real disk manifest that does not declare global scope', async () => {
      const { token } = await testUser()
      const res = await install(token, { manifestPath: 'bobbins/entities/manifest.yaml' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe("Bobbin 'entities' does not support global-scope installation")
    })

    it('defaults to project-only scope when install.scopes is omitted, and rejects it', async () => {
      const { token } = await testUser()
      const res = await install(token, {
        manifestContent: JSON.stringify({ id: 'no-scope-bobbin', name: 'No Scope', version: '1.0.0' }),
        manifestType: 'json',
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe("Bobbin 'no-scope-bobbin' does not support global-scope installation")
    })

    it('rejects a manifest that fails compiler validation with 400 + details', async () => {
      const { token } = await testUser()
      const res = await install(token, {
        // 'Bad_ID' violates the schema's ^[a-z][a-z0-9_-]*$ id pattern.
        manifestContent: JSON.stringify({ id: 'Bad_ID', name: 'x', version: '1.0.0', install: { scopes: ['global'] } }),
        manifestType: 'json',
      })
      expect(res.statusCode).toBe(400)
      const body = JSON.parse(res.payload)
      expect(body.error).toBe('Manifest compilation failed')
      expect(body.details).toBeDefined()
    })

    it('rejects invalid JSON manifestContent with 400', async () => {
      const { token } = await testUser()
      const res = await install(token, { manifestContent: '{ not json', manifestType: 'json' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Invalid manifest format')
    })

    it('requires manifestPath or manifestContent', async () => {
      const { token } = await testUser()
      const res = await install(token, {})
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Either manifestPath or manifestContent is required')
    })

    it('returns 404 for a manifestPath that does not resolve on disk (unknown bobbin)', async () => {
      const { token } = await testUser()
      const res = await install(token, { manifestPath: 'nonexistent/manifest.yaml' })
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload).error).toBe('Manifest file not found')
    })

    it('returns 403 for a manifestPath that resolves but sits outside bobbins/', async () => {
      const { token } = await testUser()
      const res = await install(token, { manifestPath: 'package.json' })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload).error).toBe('Access denied')
    })

    it('is an idempotent upsert on repeat install: bumps version and re-enables a disabled row', async () => {
      const { user: u, token } = await testUser()

      const first = await install(token, { manifestContent: helloWorldManifest({ version: '1.0.0' }), manifestType: 'json' })
      expect(JSON.parse(first.payload).action).toBe('installed')

      // Disable directly, simulating whatever path disables an install.
      await db.update(bobbinsInstalled)
        .set({ enabled: false })
        .where(and(eq(bobbinsInstalled.userId, u.id), eq(bobbinsInstalled.bobbinId, 'hello-world')))

      const second = await install(token, { manifestContent: helloWorldManifest({ version: '2.0.0' }), manifestType: 'json' })
      expect(second.statusCode).toBe(200)
      const body = JSON.parse(second.payload)
      expect(body.action).toBe('updated')
      expect(body.bobbin.version).toBe('2.0.0')

      const rows = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.userId, u.id), eq(bobbinsInstalled.bobbinId, 'hello-world')))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.version).toBe('2.0.0')
      expect(rows[0]!.enabled).toBe(true)
    })
  })

  // --- 3. List ---

  describe('list', () => {
    it("lists the caller's install with manifest-derived fields", async () => {
      const { token } = await testUser()
      await install(token, { manifestContent: helloWorldManifest(), manifestType: 'json' })

      const res = await list(token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.bobbins).toHaveLength(1)
      const entry = body.bobbins[0]
      expect(entry.id).toBe('hello-world')
      expect(entry.version).toBe('1.0.0')
      expect(entry.scope).toBe('global')
      expect(entry.installedAt).toBeDefined()
      // manifest comes from the real on-disk file, not what we submitted
      expect(entry.manifest.id).toBe('hello-world')
      expect(entry.manifest.name).toBe('Hello World')
    })

    it("never returns another user's installs", async () => {
      const { token: tokenA } = await testUser()
      const { token: tokenB } = await testUser()
      await install(tokenA, { manifestContent: helloWorldManifest(), manifestType: 'json' })

      const res = await list(tokenB)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).bobbins).toEqual([])
    })

    it('silently filters out an install whose manifest is missing from disk', async () => {
      const { user: u, token } = await testUser()
      await db.insert(bobbinsInstalled).values({
        userId: u.id,
        scope: 'global',
        bobbinId: 'ghost-bobbin-does-not-exist',
        version: '1.0.0',
        manifestJson: { id: 'ghost-bobbin-does-not-exist', name: 'Ghost', version: '1.0.0' },
        enabled: true,
      })

      const res = await list(token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).bobbins).toEqual([])
    })

    it('excludes disabled installs', async () => {
      const { user: u, token } = await testUser()
      await db.insert(bobbinsInstalled).values({
        userId: u.id,
        scope: 'global',
        bobbinId: 'hello-world',
        version: '1.0.0',
        manifestJson: { id: 'hello-world', name: 'Hello World', version: '1.0.0' },
        enabled: false,
      })

      const res = await list(token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).bobbins).toEqual([])
    })

    it('excludes project-scoped rows even for the same user + bobbin id', async () => {
      const { user: u, token } = await testUser()
      await db.insert(bobbinsInstalled).values({
        userId: u.id,
        scope: 'project',
        bobbinId: 'entities',
        version: '1.0.0',
        manifestJson: { id: 'entities', name: 'Entities', version: '1.0.0' },
        enabled: true,
      })

      const res = await list(token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).bobbins).toEqual([])
    })
  })

  // --- 4. Uninstall ---

  describe('uninstall', () => {
    it('removes the row', async () => {
      const { user: u, token } = await testUser()
      await install(token, { manifestContent: helloWorldManifest(), manifestType: 'json' })

      const res = await uninstall(token, 'hello-world')
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true, message: 'Bobbin hello-world uninstalled globally' })

      const rows = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.userId, u.id), eq(bobbinsInstalled.bobbinId, 'hello-world')))
      expect(rows).toHaveLength(0)
    })

    it('is idempotent for a bobbin that was never installed (no 404)', async () => {
      const { token } = await testUser()
      const res = await uninstall(token, 'never-installed')
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).success).toBe(true)
    })

    it("cannot delete another user's global install", async () => {
      const { user: victim, token: victimToken } = await testUser()
      const { token: attackerToken } = await testUser()
      await install(victimToken, { manifestContent: helloWorldManifest(), manifestType: 'json' })

      const res = await uninstall(attackerToken, 'hello-world')
      // The route always reports success -- it can't distinguish "nothing
      // matched" from "deleted" -- but the victim's row must survive.
      expect(res.statusCode).toBe(200)

      const rows = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.userId, victim.id), eq(bobbinsInstalled.bobbinId, 'hello-world')))
      expect(rows).toHaveLength(1)
    })
  })
})
