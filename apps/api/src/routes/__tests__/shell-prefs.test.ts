import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { createTestApp, createTestToken, createTestUser, cleanupAllTestData } from '../../__tests__/test-helpers'
import { mergeShellPrefs } from '../users/shell-prefs'

describe('shell preferences', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  const get = (token: string) => app.inject({ method: 'GET', url: '/api/users/me/shell-preferences', headers: { authorization: `Bearer ${token}` } })
  const patch = (token: string, prefs: unknown) => app.inject({
    method: 'PATCH', url: '/api/users/me/shell-preferences',
    headers: { authorization: `Bearer ${token}` }, payload: { prefs },
  })

  it('starts empty and merges one level deep across calls', async () => {
    const user = await createTestUser()
    const token = await createTestToken(user.id)
    expect(JSON.parse((await get(token)).payload)).toEqual({ prefs: {}, updatedAt: null })

    await patch(token, { panelWidth: { left: 320 }, lastNav: { p1: { entityType: 'content', entityId: 'a' } } })
    const second = await patch(token, { panelWidth: { right: 400 }, lastNav: { p2: { entityType: 'notes', entityId: 'b' } } })
    expect(second.statusCode).toBe(200)

    const { prefs } = JSON.parse((await get(token)).payload)
    expect(prefs.panelWidth).toEqual({ left: 320, right: 400 })
    expect(Object.keys(prefs.lastNav).sort()).toEqual(['p1', 'p2'])
  })

  it('deletes a key with null', async () => {
    const user = await createTestUser()
    const token = await createTestToken(user.id)
    await patch(token, { viewPreferences: { container: 'manuscript.outline', content: 'manuscript.editor' } })
    await patch(token, { viewPreferences: { container: null } })
    const { prefs } = JSON.parse((await get(token)).payload)
    expect(prefs.viewPreferences).toEqual({ content: 'manuscript.editor' })
  })

  it('rejects unknown namespaces, non-object namespaces and oversize blobs', async () => {
    const user = await createTestUser()
    const token = await createTestToken(user.id)
    expect((await patch(token, { theme: { mode: 'dark' } })).statusCode).toBe(400)
    expect((await patch(token, { panelWidth: 320 })).statusCode).toBe(400)
    const big = await patch(token, { lastNav: { blob: 'x'.repeat(40 * 1024) } })
    expect(big.statusCode).toBe(413)
    expect(JSON.parse((await get(token)).payload).prefs).toEqual({})
  })

  it('is per user and requires auth', async () => {
    const a = await createTestUser()
    const b = await createTestUser()
    const ta = await createTestToken(a.id)
    const tb = await createTestToken(b.id)
    await patch(ta, { leftRail: { active: 'manuscript.manuscript-navigation' } })
    expect(JSON.parse((await get(tb)).payload).prefs).toEqual({})
    expect((await app.inject({ method: 'GET', url: '/api/users/me/shell-preferences' })).statusCode).toBe(401)
  })
})

describe('mergeShellPrefs', () => {
  it('replaces keys inside a namespace without touching siblings', () => {
    expect(mergeShellPrefs(
      { panelWidth: { left: 1, right: 2 }, rightRail: { active: 'x' } },
      { panelWidth: { left: 5, right: null } },
    )).toEqual({ panelWidth: { left: 5 }, rightRail: { active: 'x' } })
  })
})
