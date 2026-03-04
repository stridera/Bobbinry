import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import * as jose from 'jose'
import { build } from '../../server'
import { db } from '../../db/connection'
import { users, projects, bobbinsInstalled, entities } from '../../db/schema'
import { getJwtSecret } from '../../middleware/auth'
import { sql } from 'drizzle-orm'

async function createTestToken(userId: string): Promise<string> {
  return new jose.SignJWT({ id: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(getJwtSecret())
}

describe('Projects API', () => {
  let app: any

  beforeAll(async () => {
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    // Clean up test data after each test
    await db.delete(entities).where(sql`true`)
    await db.delete(bobbinsInstalled).where(sql`true`)
    await db.delete(projects).where(sql`true`)
    await db.delete(users).where(sql`true`)
  })

  describe('POST /api/projects', () => {
    it('should create a new project', async () => {
      const [user] = await db.insert(users).values({
        email: 'test@example.com',
        name: 'Test User'
      }).returning()

      const token = await createTestToken(user!.id)

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'Test Project',
          description: 'A test project'
        }
      })

      expect(response.statusCode).toBe(201)
      const project = JSON.parse(response.payload)
      expect(project.name).toBe('Test Project')
      expect(project.description).toBe('A test project')
      expect(project.ownerId).toBe(user!.id)
    })

    it('should return 400 for invalid project data', async () => {
      const [user] = await db.insert(users).values({
        email: 'test-invalid@example.com',
        name: 'Test User'
      }).returning()

      const token = await createTestToken(user!.id)

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: '' // Invalid empty name
        }
      })

      expect(response.statusCode).toBe(400)
    })

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Test Project'
        }
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe('GET /api/projects', () => {
    it('should return projects for authenticated user', async () => {
      const [user] = await db.insert(users).values({
        email: 'test2@example.com',
        name: 'Test User 2'
      }).returning()

      await db.insert(projects).values({
        name: 'Test Project',
        description: 'Test Description',
        ownerId: user!.id
      })

      const token = await createTestToken(user!.id)

      const response = await app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(response.statusCode).toBe(200)
      const projectList = JSON.parse(response.payload)
      expect(Array.isArray(projectList)).toBe(true)
      expect(projectList.length).toBe(1)
      expect(projectList[0].name).toBe('Test Project')
    })
  })

  describe('POST /api/projects/:projectId/bobbins/install', () => {
    let testUser: any
    let testProject: any
    let authToken: string

    beforeEach(async () => {
      const [user] = await db.insert(users).values({
        email: 'test-install@example.com',
        name: 'Test Install User'
      }).returning()
      testUser = user!

      const [project] = await db.insert(projects).values({
        name: 'Test Install Project',
        description: 'Test Description',
        ownerId: testUser.id
      }).returning()
      testProject = project!

      authToken = await createTestToken(testUser.id)
    })

    it('should install a bobbin from manifest file', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${testProject.id}/bobbins/install`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          manifestPath: 'bobbins/manuscript/manifest.yaml'
        }
      })

      expect(response.statusCode).toBe(200)
      const result = JSON.parse(response.payload)
      expect(result.success).toBe(true)
      expect(result.bobbin).toBeDefined()
      expect(result.bobbin.name).toBe('Manuscript')
    })

    it('should return 404 for nonexistent project', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/00000000-0000-0000-0000-000000000000/bobbins/install',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          manifestPath: 'bobbins/manuscript/manifest.yaml'
        }
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return 403 for invalid manifest path', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${testProject.id}/bobbins/install`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          manifestPath: 'nonexistent/manifest.yaml'
        }
      })

      // nonexistent path outside bobbins/ returns 403 (access denied)
      expect(response.statusCode).toBe(403)
    })
  })
})
