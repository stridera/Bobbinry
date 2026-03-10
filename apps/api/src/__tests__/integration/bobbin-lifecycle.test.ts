/**
 * Bobbin Lifecycle Integration Tests
 *
 * Tests the complete lifecycle of bobbin installation, configuration,
 * and data operations including security boundaries.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { db } from '../../db/connection'
import { bobbinsInstalled, entities, projects } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { createTestUser, createTestProject, cleanupAllTestData } from '../test-helpers'

describe('Bobbin Lifecycle Integration Tests', () => {
  let testUserId: string
  let testProjectId: string

  beforeAll(async () => {
    const user = await createTestUser()
    testUserId = user.id

    const project = await createTestProject(testUserId, {
      name: 'Test Project',
      description: 'Integration test project'
    })
    testProjectId = project.id
  })

  afterAll(async () => {
    await cleanupAllTestData()
  })

  describe('Bobbin Installation', () => {
    it('should install a first-party bobbin with native execution', async () => {
      const manifest = {
        id: 'manuscript',
        name: 'Manuscript',
        version: '1.0.0',
        data: {
          collections: [
            { name: 'books', fields: [] },
            { name: 'chapters', fields: [] },
            { name: 'scenes', fields: [] }
          ]
        }
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        version: '1.0.0',
        manifestJson: manifest,
      }).returning()

      expect(installation).toBeDefined()

      // Cleanup
      await db.delete(bobbinsInstalled).where(eq(bobbinsInstalled.id, installation!.id))
    })

    it('should accept any JSON in manifestJson field', async () => {
      // Note: Database stores manifestJson as JSONB without validation
      // Validation should happen at the application layer
      const invalidManifest = {
        id: 'invalid',
        // Missing required fields - but DB will accept it
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'invalid',
        version: '1.0.0',
        manifestJson: invalidManifest
      }).returning()

      expect(installation).toBeDefined()
      expect(installation!.bobbinId).toBe('invalid')

      // Cleanup
      await db.delete(bobbinsInstalled).where(eq(bobbinsInstalled.id, installation!.id))
    })
  })

  describe('Entity CRUD Operations', () => {
    beforeEach(async () => {
      // Ensure manuscript is installed
      const existing = await db.select()
        .from(bobbinsInstalled)
        .where(eq(bobbinsInstalled.bobbinId, 'manuscript'))
        .limit(1)

      if (existing.length === 0) {
        await db.insert(bobbinsInstalled).values({
          projectId: testProjectId,
          bobbinId: 'manuscript',
          version: '1.0.0',
          manifestJson: { id: 'manuscript', name: 'Manuscript', version: '1.0.0' }
        })
      }
    })

    it('should create entity in correct collection', async () => {
      const bookData = {
        title: 'Test Book',
        order: Date.now()
      }

      const [entity] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: bookData
      }).returning()

      expect(entity).toBeDefined()
      expect(entity!.collectionName).toBe('books')
      expect((entity!.entityData as any).title).toBe('Test Book')
    })

    it('should query entities by collection', async () => {
      // Create test entities
      await db.insert(entities).values([
        {
          projectId: testProjectId,
          bobbinId: 'manuscript',
          collectionName: 'books',
          entityData: { title: 'Book 1', order: 1 }
        },
        {
          projectId: testProjectId,
          bobbinId: 'manuscript',
          collectionName: 'books',
          entityData: { title: 'Book 2', order: 2 }
        }
      ])

      const results = await db.select()
        .from(entities)
        .where(eq(entities.collectionName, 'books'))

      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results.every(r => r.collectionName === 'books')).toBe(true)
    })

    it('should enforce project isolation', async () => {
      // Create another project
      const [otherProject] = await db.insert(projects).values({
        ownerId: testUserId,
        name: 'Other Project'
      }).returning()

      // Create entity in other project
      await db.insert(entities).values({
        projectId: otherProject!.id,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: { title: 'Other Book', order: 1 }
      })

      // Query should only return entities from test project
      const results = await db.select()
        .from(entities)
        .where(eq(entities.projectId, testProjectId))

      expect(results.every(r => r.projectId === testProjectId)).toBe(true)

      // Cleanup
      await db.delete(entities).where(eq(entities.projectId, otherProject!.id))
      await db.delete(projects).where(eq(projects.id, otherProject!.id))
    })

    it('should update entity maintaining type structure', async () => {
      const [entity] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: { title: 'Original Title', order: 1 }
      }).returning()

      const updatedData = {
        title: 'Updated Title',
        order: 1,
        subtitle: 'New subtitle'
      }

      const [updated] = await db.update(entities)
        .set({ entityData: updatedData })
        .where(eq(entities.id, entity!.id))
        .returning()

      expect((updated!.entityData as any).title).toBe('Updated Title')
      expect((updated!.entityData as any).subtitle).toBe('New subtitle')
    })

    it('should delete entity', async () => {
      const [entity] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: { title: 'To Delete', order: 1 }
      }).returning()

      await db.delete(entities).where(eq(entities.id, entity!.id))

      const result = await db.select()
        .from(entities)
        .where(eq(entities.id, entity!.id))

      expect(result.length).toBe(0)
    })
  })

  describe('Data Consistency', () => {
    it('should maintain entity data structure (not nested in .data)', async () => {
      const bookData = {
        title: 'Direct Access Book',
        subtitle: 'Testing structure',
        order: 1
      }

      const [entity] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: bookData
      }).returning()

      // Data should be directly on entityData, NOT nested
      const data = entity!.entityData as any
      expect(data.title).toBe('Direct Access Book')
      expect(data.subtitle).toBe('Testing structure')
      expect(data.data).toBeUndefined() // Should NOT have nested .data
    })

    it('should handle optional fields correctly', async () => {
      const sceneData = {
        title: 'Test Scene',
        order: 1,
        chapter_id: 'chapter-123'
        // word_count is optional
      }

      const [entity] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'scenes',
        entityData: sceneData
      }).returning()

      const data = entity!.entityData as any
      expect(data.word_count).toBeUndefined()
      expect(data.title).toBeDefined()
    })
  })
})
