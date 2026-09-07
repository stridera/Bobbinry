import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { users, betaReaders, betaReaderInvites } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, createTestProject, cleanupAllTestData } from '../../__tests__/test-helpers'

/**
 * Beta reader management (bobbins/routes/users/beta-readers.ts) and invite
 * links (beta-invites.ts). These are an access boundary: a beta-reader row
 * grants read access to a private project, so ownership checks (requireSelf,
 * authorId scoping) and the invite redemption flow are the load-bearing
 * behaviour under test here.
 */
describe('beta readers', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  function listBetaReaders(token: string | undefined, userId: string, query = '') {
    return app.inject({
      method: 'GET', url: `/api/users/${userId}/beta-readers${query}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function addBetaReader(token: string | undefined, userId: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST', url: `/api/users/${userId}/beta-readers`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body,
    })
  }

  function updateBetaReader(token: string | undefined, userId: string, betaReaderId: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'PUT', url: `/api/users/${userId}/beta-readers/${betaReaderId}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body,
    })
  }

  function deleteBetaReader(token: string | undefined, userId: string, betaReaderId: string) {
    return app.inject({
      method: 'DELETE', url: `/api/users/${userId}/beta-readers/${betaReaderId}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function listBetaReading(token: string | undefined, userId: string) {
    return app.inject({
      method: 'GET', url: `/api/users/${userId}/beta-reading`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function createInvite(token: string | undefined, userId: string, body: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST', url: `/api/users/${userId}/beta-invites`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body,
    })
  }

  function listInvites(token: string | undefined, userId: string, query = '') {
    return app.inject({
      method: 'GET', url: `/api/users/${userId}/beta-invites${query}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function revokeInvite(token: string | undefined, userId: string, inviteId: string) {
    return app.inject({
      method: 'DELETE', url: `/api/users/${userId}/beta-invites/${inviteId}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function previewInvite(tokenParam: string) {
    return app.inject({ method: 'GET', url: `/api/public/beta-invites/${tokenParam}` })
  }

  function redeemInvite(token: string | undefined, tokenParam: string) {
    return app.inject({
      method: 'POST', url: `/api/beta-invites/${tokenParam}/redeem`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  // --- 1. Auth required on every route ---

  it('returns 401 for GET beta-readers without a token', async () => {
    const author = await createTestUser()
    const res = await listBetaReaders(undefined, author.id)
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for POST beta-readers without a token', async () => {
    const author = await createTestUser()
    const res = await addBetaReader(undefined, author.id, { readerId: author.id })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for PUT beta-readers/:id without a token', async () => {
    const author = await createTestUser()
    const res = await updateBetaReader(undefined, author.id, '00000000-0000-0000-0000-000000000000', { notes: 'x' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for DELETE beta-readers/:id without a token', async () => {
    const author = await createTestUser()
    const res = await deleteBetaReader(undefined, author.id, '00000000-0000-0000-0000-000000000000')
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for GET beta-reading without a token', async () => {
    const author = await createTestUser()
    const res = await listBetaReading(undefined, author.id)
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for POST beta-invites without a token', async () => {
    const author = await createTestUser()
    const res = await createInvite(undefined, author.id, {})
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for GET beta-invites without a token', async () => {
    const author = await createTestUser()
    const res = await listInvites(undefined, author.id)
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for DELETE beta-invites/:id without a token', async () => {
    const author = await createTestUser()
    const res = await revokeInvite(undefined, author.id, '00000000-0000-0000-0000-000000000000')
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for POST beta-invites/:token/redeem without a token', async () => {
    const res = await redeemInvite(undefined, 'some-token')
    expect(res.statusCode).toBe(401)
  })

  // --- 2. Author can add / list beta readers; list is scoped to the author ---

  it('lets the author add a beta reader and list it back', async () => {
    const { user: author, token } = await verifiedUser()
    const reader = await createTestUser()

    const addRes = await addBetaReader(token, author.id, { readerId: reader.id, notes: 'Trusted friend' })
    expect(addRes.statusCode).toBe(201)
    const created = JSON.parse(addRes.payload).betaReader
    expect(created.authorId).toBe(author.id)
    expect(created.readerId).toBe(reader.id)
    expect(created.accessLevel).toBe('beta')
    expect(created.isActive).toBe(true)

    const listRes = await listBetaReaders(token, author.id)
    expect(listRes.statusCode).toBe(200)
    const { betaReaders: rows } = JSON.parse(listRes.payload)
    expect(rows).toHaveLength(1)
    expect(rows[0].betaReader.id).toBe(created.id)
    expect(rows[0].user.id).toBe(reader.id)
  })

  it("does not include another author's beta readers in the list", async () => {
    const { user: author, token } = await verifiedUser()
    const other = await verifiedUser()
    const reader = await createTestUser()

    await addBetaReader(other.token, other.user.id, { readerId: reader.id })

    const listRes = await listBetaReaders(token, author.id)
    expect(listRes.statusCode).toBe(200)
    expect(JSON.parse(listRes.payload).betaReaders).toHaveLength(0)
  })

  it('rejects adding the same reader twice (same author, same project scope) with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const reader = await createTestUser()

    await addBetaReader(token, author.id, { readerId: reader.id })
    const dupe = await addBetaReader(token, author.id, { readerId: reader.id })
    expect(dupe.statusCode).toBe(400)
    expect(JSON.parse(dupe.payload).error).toMatch(/already added/)
  })

  it('rejects a malformed readerId with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await addBetaReader(token, author.id, { readerId: 'not-a-uuid' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Invalid reader ID format/)
  })

  it('rejects a malformed projectId on add with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const reader = await createTestUser()
    const res = await addBetaReader(token, author.id, { readerId: reader.id, projectId: 'not-a-uuid' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Invalid project ID format/)
  })

  it('rejects a malformed projectId on list with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await listBetaReaders(token, author.id, '?projectId=not-a-uuid')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Invalid project ID format/)
  })

  // --- 3. Non-owner cannot manage another author's beta readers (requireSelf -> 403) ---

  it("returns 403 when a caller lists another user's beta readers (requireSelf)", async () => {
    const { token } = await verifiedUser()
    const victim = await createTestUser()
    const res = await listBetaReaders(token, victim.id)
    expect(res.statusCode).toBe(403)
  })

  it("returns 403 when a caller adds a beta reader under another user's id (requireSelf)", async () => {
    const { token } = await verifiedUser()
    const victim = await createTestUser()
    const reader = await createTestUser()
    const res = await addBetaReader(token, victim.id, { readerId: reader.id })
    expect(res.statusCode).toBe(403)
  })

  it("returns 404 when updating a beta reader that belongs to someone else, even under the caller's own userId (authorId scoping)", async () => {
    const { user: author, token } = await verifiedUser()
    const other = await verifiedUser()
    const reader = await createTestUser()

    const created = JSON.parse((await addBetaReader(other.token, other.user.id, { readerId: reader.id })).payload).betaReader

    // Caller passes their OWN userId (so requireSelf passes) but targets a
    // betaReaderId owned by someone else -> the authorId filter in the WHERE
    // clause means no row matches, so this is a 404, not a 403.
    const res = await updateBetaReader(token, author.id, created.id, { notes: 'hijacked' })
    expect(res.statusCode).toBe(404)
  })

  it("returns 404 deleting a beta reader that belongs to someone else, and leaves the row alone", async () => {
    const { user: author, token } = await verifiedUser()
    const other = await verifiedUser()
    const reader = await createTestUser()

    const created = JSON.parse((await addBetaReader(other.token, other.user.id, { readerId: reader.id })).payload).betaReader

    const res = await deleteBetaReader(token, author.id, created.id)
    expect(res.statusCode).toBe(404)

    const stillThere = await db.select().from(betaReaders).where(eq(betaReaders.id, created.id))
    expect(stillThere).toHaveLength(1)
  })

  // --- 4. Update: allow-listed fields only, owner-only ---

  it('lets the owner update accessLevel, notes and isActive on their own beta reader', async () => {
    const { user: author, token } = await verifiedUser()
    const reader = await createTestUser()
    const created = JSON.parse((await addBetaReader(token, author.id, { readerId: reader.id })).payload).betaReader

    const res = await updateBetaReader(token, author.id, created.id, {
      accessLevel: 'arc', notes: 'updated', isActive: false,
    })
    expect(res.statusCode).toBe(200)
    const updated = JSON.parse(res.payload).betaReader
    expect(updated.accessLevel).toBe('arc')
    expect(updated.notes).toBe('updated')
    expect(updated.isActive).toBe(false)
  })

  it('rejects a malformed betaReaderId on update with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await updateBetaReader(token, author.id, 'not-a-uuid', { notes: 'x' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Invalid beta reader ID format/)
  })

  it('returns 404 updating a betaReaderId that does not exist', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await updateBetaReader(token, author.id, '00000000-0000-0000-0000-000000000000', { notes: 'x' })
    expect(res.statusCode).toBe(404)
  })

  // --- 5. Removing a beta reader works for the owner only ---

  it('lets the owner remove their own beta reader', async () => {
    const { user: author, token } = await verifiedUser()
    const reader = await createTestUser()
    const created = JSON.parse((await addBetaReader(token, author.id, { readerId: reader.id })).payload).betaReader

    const delRes = await deleteBetaReader(token, author.id, created.id)
    expect(delRes.statusCode).toBe(200)
    expect(JSON.parse(delRes.payload)).toEqual({ success: true })

    const rows = await db.select().from(betaReaders).where(eq(betaReaders.id, created.id))
    expect(rows).toHaveLength(0)
  })

  it('rejects a malformed betaReaderId on delete with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await deleteBetaReader(token, author.id, 'not-a-uuid')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Invalid beta reader ID format/)
  })

  // --- 6. beta-reading (reader's own list, self-scoped) ---

  it("returns 403 when a caller reads another user's beta-reading list (requireSelf)", async () => {
    const { token } = await verifiedUser()
    const victim = await createTestUser()
    const res = await listBetaReading(token, victim.id)
    expect(res.statusCode).toBe(403)
  })

  it('lists an empty beta-reading array when the caller has no grants', async () => {
    const { user, token } = await verifiedUser()
    const res = await listBetaReading(token, user.id)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ betaReading: [] })
  })

  it('lists a project-specific grant in beta-reading', async () => {
    const { user: author, token: authorToken } = await verifiedUser()
    const { user: reader, token: readerToken } = await verifiedUser()
    const project = await createTestProject(author.id, { name: 'Grant Project' })

    await addBetaReader(authorToken, author.id, { readerId: reader.id, projectId: project.id })

    const res = await listBetaReading(readerToken, reader.id)
    expect(res.statusCode).toBe(200)
    const { betaReading } = JSON.parse(res.payload)
    expect(betaReading).toHaveLength(1)
    expect(betaReading[0].project.id).toBe(project.id)
    expect(betaReading[0].authorWide).toBe(false)
  })

  // --- 7. Invite creation / listing / validation ---

  it('lets the author create an invite link and returns a token', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await createInvite(token, author.id, { accessLevel: 'arc', maxUses: 5 })
    expect(res.statusCode).toBe(201)
    const invite = JSON.parse(res.payload).invite
    expect(invite.authorId).toBe(author.id)
    expect(invite.accessLevel).toBe('arc')
    expect(invite.maxUses).toBe(5)
    expect(invite.isActive).toBe(true)
    expect(typeof invite.token).toBe('string')
    expect(invite.token.length).toBeGreaterThan(10)
  })

  it('rejects an invite scoped to a project the caller does not own with 404', async () => {
    const { user: author, token } = await verifiedUser()
    const other = await createTestUser()
    const otherProject = await createTestProject(other.id)

    const res = await createInvite(token, author.id, { projectId: otherProject.id })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.payload).error).toMatch(/Project not found/)
  })

  it('rejects a maxUses of 0 or a non-integer with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const zero = await createInvite(token, author.id, { maxUses: 0 })
    expect(zero.statusCode).toBe(400)
    expect(JSON.parse(zero.payload).error).toMatch(/maxUses must be a positive integer/)

    const fractional = await createInvite(token, author.id, { maxUses: 1.5 })
    expect(fractional.statusCode).toBe(400)
  })

  it('rejects a malformed projectId on invite creation with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await createInvite(token, author.id, { projectId: 'not-a-uuid' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Invalid project ID format/)
  })

  it('lists only the caller\'s own active invites', async () => {
    const { user: author, token } = await verifiedUser()
    const other = await verifiedUser()

    await createInvite(token, author.id, {})
    await createInvite(other.token, other.user.id, {})

    const res = await listInvites(token, author.id)
    expect(res.statusCode).toBe(200)
    const { invites } = JSON.parse(res.payload)
    expect(invites).toHaveLength(1)
    expect(invites[0].invite.authorId).toBe(author.id)
  })

  it("returns 403 creating an invite under another user's id (requireSelf)", async () => {
    const { token } = await verifiedUser()
    const victim = await createTestUser()
    const res = await createInvite(token, victim.id, {})
    expect(res.statusCode).toBe(403)
  })

  // --- 8. Revoking an invite: owner only ---

  it('lets the owner revoke their own invite; it then disappears from the active list', async () => {
    const { user: author, token } = await verifiedUser()
    const invite = JSON.parse((await createInvite(token, author.id, {})).payload).invite

    const revokeRes = await revokeInvite(token, author.id, invite.id)
    expect(revokeRes.statusCode).toBe(200)
    expect(JSON.parse(revokeRes.payload)).toEqual({ success: true })

    const listRes = await listInvites(token, author.id)
    expect(JSON.parse(listRes.payload).invites).toHaveLength(0)
  })

  it("returns 404 revoking someone else's invite, even under the caller's own userId", async () => {
    const { user: author, token } = await verifiedUser()
    const other = await verifiedUser()
    const invite = JSON.parse((await createInvite(other.token, other.user.id, {})).payload).invite

    const res = await revokeInvite(token, author.id, invite.id)
    expect(res.statusCode).toBe(404)
  })

  it('rejects a malformed inviteId on revoke with 400', async () => {
    const { user: author, token } = await verifiedUser()
    const res = await revokeInvite(token, author.id, 'not-a-uuid')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/Invalid invite ID format/)
  })

  // --- 9. Public preview ---

  it('previews a valid invite as status "valid" without auth', async () => {
    const { user: author, token } = await verifiedUser()
    const invite = JSON.parse((await createInvite(token, author.id, { accessLevel: 'early_access' })).payload).invite

    const res = await previewInvite(invite.token)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.status).toBe('valid')
    expect(body.accessLevel).toBe('early_access')
  })

  it('returns 404 previewing an unknown token', async () => {
    const res = await previewInvite('does-not-exist')
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.payload).status).toBe('invalid')
  })

  it('previews a revoked invite as status "revoked"', async () => {
    const { user: author, token } = await verifiedUser()
    const invite = JSON.parse((await createInvite(token, author.id, {})).payload).invite
    await revokeInvite(token, author.id, invite.id)

    const res = await previewInvite(invite.token)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload).status).toBe('revoked')
  })

  // --- 10. Redemption flow ---

  it('lets an authenticated reader redeem a valid invite and creates a beta-reader row', async () => {
    const { user: author, token: authorToken } = await verifiedUser()
    const { user: reader, token: readerToken } = await verifiedUser()
    const project = await createTestProject(author.id)

    const invite = JSON.parse((await createInvite(authorToken, author.id, { projectId: project.id, accessLevel: 'beta' })).payload).invite

    const res = await redeemInvite(readerToken, invite.token)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ success: true })

    const rows = await db.select().from(betaReaders).where(eq(betaReaders.readerId, reader.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.authorId).toBe(author.id)
    expect(rows[0]!.projectId).toBe(project.id)
    expect(rows[0]!.accessLevel).toBe('beta')
    expect(rows[0]!.isActive).toBe(true)

    const [used] = await db.select().from(betaReaderInvites).where(eq(betaReaderInvites.id, invite.id))
    expect(used!.useCount).toBe(1)
  })

  it('is idempotent: redeeming an invite the reader already used again does not consume another use', async () => {
    const { user: author, token: authorToken } = await verifiedUser()
    const { token: readerToken } = await verifiedUser()

    const invite = JSON.parse((await createInvite(authorToken, author.id, {})).payload).invite

    const first = await redeemInvite(readerToken, invite.token)
    expect(first.statusCode).toBe(200)
    expect(JSON.parse(first.payload)).toEqual({ success: true })

    const second = await redeemInvite(readerToken, invite.token)
    expect(second.statusCode).toBe(200)
    expect(JSON.parse(second.payload)).toEqual({ success: true, alreadyMember: true })

    const [used] = await db.select().from(betaReaderInvites).where(eq(betaReaderInvites.id, invite.id))
    expect(used!.useCount).toBe(1)
  })

  it('rejects redeeming an invalid/unknown token with 404', async () => {
    const { token } = await verifiedUser()
    const res = await redeemInvite(token, 'not-a-real-token')
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.payload).error).toMatch(/no longer valid/)
  })

  it('rejects redeeming a revoked invite with 404', async () => {
    const { user: author, token: authorToken } = await verifiedUser()
    const { token: readerToken } = await verifiedUser()
    const invite = JSON.parse((await createInvite(authorToken, author.id, {})).payload).invite
    await revokeInvite(authorToken, author.id, invite.id)

    const res = await redeemInvite(readerToken, invite.token)
    expect(res.statusCode).toBe(404)
  })

  it('rejects redeeming an invite that has reached maxUses with 409', async () => {
    const { user: author, token: authorToken } = await verifiedUser()
    const { token: reader1Token } = await verifiedUser()
    const { token: reader2Token } = await verifiedUser()
    const invite = JSON.parse((await createInvite(authorToken, author.id, { maxUses: 1 })).payload).invite

    const first = await redeemInvite(reader1Token, invite.token)
    expect(first.statusCode).toBe(200)

    const second = await redeemInvite(reader2Token, invite.token)
    expect(second.statusCode).toBe(409)
    expect(JSON.parse(second.payload).error).toMatch(/maximum number of uses/)
  })

  it('rejects the author redeeming their own invite link with 400', async () => {
    const { user: author, token: authorToken } = await verifiedUser()
    const invite = JSON.parse((await createInvite(authorToken, author.id, {})).payload).invite

    const res = await redeemInvite(authorToken, invite.token)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/cannot redeem your own invite/)
  })

  it('reactivates an inactive beta-reader row on re-redemption instead of duplicating it', async () => {
    const { user: author, token: authorToken } = await verifiedUser()
    const { user: reader, token: readerToken } = await verifiedUser()
    const invite = JSON.parse((await createInvite(authorToken, author.id, {})).payload).invite

    await redeemInvite(readerToken, invite.token)
    const [row] = await db.select().from(betaReaders).where(eq(betaReaders.readerId, reader.id))
    await db.update(betaReaders).set({ isActive: false }).where(eq(betaReaders.id, row!.id))

    const res = await redeemInvite(readerToken, invite.token)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ success: true, alreadyMember: true })

    const rows = await db.select().from(betaReaders).where(eq(betaReaders.readerId, reader.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.isActive).toBe(true)
  })
})
