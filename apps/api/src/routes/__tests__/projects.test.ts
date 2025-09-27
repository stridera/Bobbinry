import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { build } from '../../server'
import { db } from '../../db/connection'
import { users, projects } from '../../db/schema'

describe('Projects API', () => {
  let app: any

  beforeAll(async () => {
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('POST /api/projects', () => {
    it('should create a new project', async () => {
      // First create a user
      const [user] = await db.insert(users).values({
        id: 'test-user',
        email: 'test@example.com',
        name: 'Test User'
      }).returning()

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Test Project',
          description: 'A test project',
          ownerId: user.id
        }
      })

      expect(response.statusCode).toBe(201)
      const project = JSON.parse(response.payload)
      expect(project.name).toBe('Test Project')
      expect(project.description).toBe('A test project')
      expect(project.ownerId).toBe(user.id)
    })

    it('should return 400 for invalid project data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: '', // Invalid empty name
          ownerId: 'nonexistent'
        }
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('GET /api/projects', () => {
    it('should return projects for a user', async () => {
      // Create user and project
      const [user] = await db.insert(users).values({
        id: 'test-user-2',
        email: 'test2@example.com',
        name: 'Test User 2'
      }).returning()

      await db.insert(projects).values({
        id: 'test-project',
        name: 'Test Project',
        description: 'Test Description',
        ownerId: user.id
      })

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects?ownerId=${user.id}`
      })

      expect(response.statusCode).toBe(200)
      const projectList = JSON.parse(response.payload)
      expect(Array.isArray(projectList)).toBe(true)
      expect(projectList.length).toBe(1)
      expect(projectList[0].name).toBe('Test Project')
    })
  })

  describe('POST /api/projects/:projectId/bobbins/install', () => {
    it('should install a bobbin from manifest file', async () => {
      // Create user and project
      const [user] = await db.insert(users).values({
        id: 'test-user-3',
        email: 'test3@example.com',
        name: 'Test User 3'
      }).returning()

      const [project] = await db.insert(projects).values({
        id: 'test-project-3',
        name: 'Test Project 3',
        description: 'Test Description',
        ownerId: user.id
      }).returning()

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/bobbins/install`,
        payload: {
          manifestPath: 'bobbins/manuscript.manifest.yaml'
        }
      })

      expect(response.statusCode).toBe(200)
      const result = JSON.parse(response.payload)
      expect(result.success).toBe(true)
      expect(result.bobbin).toBeDefined()
      expect(result.bobbin.name).toBe('manuscript')
    })

    it('should return 404 for nonexistent project', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/nonexistent/bobbins/install',
        payload: {
          manifestPath: 'bobbins/manuscript.manifest.yaml'
        }
      })

      expect(response.statusCode).toBe(404)
    })

    it('should return 400 for invalid manifest path', async () => {
      // Create user and project
      const [user] = await db.insert(users).values({
        id: 'test-user-4',
        email: 'test4@example.com',
        name: 'Test User 4'
      }).returning()

      const [project] = await db.insert(projects).values({
        id: 'test-project-4',
        name: 'Test Project 4',
        description: 'Test Description',
        ownerId: user.id
      }).returning()

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/bobbins/install`,
        payload: {
          manifestPath: 'nonexistent/manifest.yaml'
        }
      })

      expect(response.statusCode).toBe(400)
    })
  })
})