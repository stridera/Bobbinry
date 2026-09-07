import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { users } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, createTestProject, cleanupAllTestData } from '../../__tests__/test-helpers'

/**
 * API key management: creation, listing (never exposing the secret again),
 * per-project restriction, scope enforcement when the key itself is used as
 * a bearer token, deletion/revocation, and the session-only guard on the
 * management endpoints themselves.
 */
describe('API keys', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  function createKey(token: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST', url: '/api/api-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })
  }

  function listKeys(token: string) {
    return app.inject({
      method: 'GET', url: '/api/api-keys',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  function deleteKey(token: string, keyId: string) {
    return app.inject({
      method: 'DELETE', url: `/api/api-keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` },
    })
  }

  // --- 1. Create returns the secret once; list never exposes it ---

  it('returns the full bby_ key once on creation, and list shows metadata but never the secret', async () => {
    const { token } = await verifiedUser()

    const createRes = await createKey(token, { name: 'My Key', scopes: ['entities:read'] })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.payload)
    expect(created.key).toMatch(/^bby_[0-9A-Za-z]{32}$/)
    expect(created.name).toBe('My Key')
    expect(created.keyPrefix).toBe(created.key.slice(0, 8))

    const listRes = await listKeys(token)
    expect(listRes.statusCode).toBe(200)
    const { keys } = JSON.parse(listRes.payload)
    expect(keys).toHaveLength(1)
    expect(keys[0].id).toBe(created.id)
    expect(keys[0].name).toBe('My Key')
    expect(keys[0].keyPrefix).toBe(created.keyPrefix)
    expect(keys[0]).not.toHaveProperty('key')
    expect(keys[0]).not.toHaveProperty('keyHash')
    expect(JSON.stringify(keys[0])).not.toContain(created.key)
  })

  // --- 2. Validation ---

  it('rejects a missing name with 400', async () => {
    const { token } = await verifiedUser()
    const res = await createKey(token, { scopes: ['entities:read'] })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Name is required/)
  })

  it('rejects an empty name with 400', async () => {
    const { token } = await verifiedUser()
    const res = await createKey(token, { name: '   ', scopes: ['entities:read'] })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Name is required/)
  })

  it('rejects a name over 100 characters with 400', async () => {
    const { token } = await verifiedUser()
    const res = await createKey(token, { name: 'x'.repeat(101), scopes: ['entities:read'] })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/100 characters or fewer/)
  })

  it('rejects empty scopes with 400', async () => {
    const { token } = await verifiedUser()
    const res = await createKey(token, { name: 'Key', scopes: [] })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/At least one scope is required/)
  })

  it('rejects invalid scopes with 400', async () => {
    const { token } = await verifiedUser()
    const res = await createKey(token, { name: 'Key', scopes: ['not:a-real-scope'] })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.error).toMatch(/Invalid scopes/)
    expect(body.error).toContain('not:a-real-scope')
  })

  // --- 3. Per-project restriction ---

  it('rejects a projectId the caller does not own with 403', async () => {
    const { token } = await verifiedUser()
    const other = await createTestUser()
    const otherProject = await createTestProject(other.id)

    const res = await createKey(token, {
      name: 'Restricted Key',
      scopes: ['entities:read'],
      projectId: otherProject.id,
    })
    expect(res.statusCode).toBe(403)
  })

  it('creates an unrestricted key when no projectId is given', async () => {
    const { token } = await verifiedUser()
    const res = await createKey(token, { name: 'Unrestricted Key', scopes: ['entities:read'] })
    expect(res.statusCode).toBe(201)
    const created = JSON.parse(res.payload)
    expect(created.projectId).toBeNull()
  })

  it('creates a key restricted to a project the caller owns', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)
    const res = await createKey(token, {
      name: 'Owned Restricted Key',
      scopes: ['entities:read'],
      projectId: project.id,
    })
    expect(res.statusCode).toBe(201)
    const created = JSON.parse(res.payload)
    expect(created.projectId).toBe(project.id)
  })

  // --- 4. Using the created key as a bearer token ---

  it('authenticates entity-types with a key that has entities:read, on the owner project', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)

    const created = JSON.parse((await createKey(token, {
      name: 'Reader Key', scopes: ['entities:read'],
    })).payload)

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${project.id}/entity-types`,
      headers: { authorization: `Bearer ${created.key}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects a key lacking entities:read with 403', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)

    const created = JSON.parse((await createKey(token, {
      name: 'No Scope Key', scopes: ['manuscript:read'],
    })).payload)

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${project.id}/entity-types`,
      headers: { authorization: `Bearer ${created.key}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects a key restricted to project A when used against owner project B', async () => {
    const { user, token } = await verifiedUser()
    const projectA = await createTestProject(user.id, { name: 'Project A' })
    const projectB = await createTestProject(user.id, { name: 'Project B' })

    const created = JSON.parse((await createKey(token, {
      name: 'Project A Key', scopes: ['entities:read'], projectId: projectA.id,
    })).payload)

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${projectB.id}/entity-types`,
      headers: { authorization: `Bearer ${created.key}` },
    })
    expect(res.statusCode).toBe(403)
  })

  // --- 5. Deleting a key ---

  it('lets the owner delete a key, after which it no longer authenticates', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)

    const created = JSON.parse((await createKey(token, {
      name: 'Deletable Key', scopes: ['entities:read'],
    })).payload)

    const delRes = await deleteKey(token, created.id)
    expect(delRes.statusCode).toBe(200)
    expect(JSON.parse(delRes.payload)).toEqual({ success: true })

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${project.id}/entity-types`,
      headers: { authorization: `Bearer ${created.key}` },
    })
    expect(res.statusCode).toBe(401)
  })

  it("another user's attempt to delete the key returns 404", async () => {
    const { token } = await verifiedUser()
    const attacker = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, attacker.id))
    const attackerToken = await createTestToken(attacker.id)

    const created = JSON.parse((await createKey(token, {
      name: 'Victim Key', scopes: ['entities:read'],
    })).payload)

    const res = await deleteKey(attackerToken, created.id)
    expect(res.statusCode).toBe(404)
  })

  // --- 6. API-key auth cannot manage keys (denyApiKeyAuth) ---

  it('rejects API-key auth on create with 403 (denyApiKeyAuth)', async () => {
    const { token } = await verifiedUser()
    const created = JSON.parse((await createKey(token, {
      name: 'Management Key', scopes: ['entities:read'],
    })).payload)

    const res = await createKey(created.key, { name: 'Should Not Exist', scopes: ['entities:read'] })
    expect(res.statusCode).toBe(403)
  })

  it('rejects API-key auth on delete with 403 (denyApiKeyAuth)', async () => {
    const { token } = await verifiedUser()
    const created = JSON.parse((await createKey(token, {
      name: 'Delete-Guard Key', scopes: ['entities:read'],
    })).payload)

    const res = await deleteKey(created.key, created.id)
    expect(res.statusCode).toBe(403)
  })
})
