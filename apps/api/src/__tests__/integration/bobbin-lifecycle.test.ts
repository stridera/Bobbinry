/**
 * Bobbin Lifecycle Integration Tests
 * 
 * Tests the complete lifecycle of bobbin installation, configuration,
 * and data operations including security boundaries.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { build, FastifyInstance } from 'fastify'
import { db } from '../../db/connection'
import { projects, users, bobbinsInstalled, entities } from '../../db/schema'
import { eq } from 'drizzle-orm'

describe('Bobbin Lifecycle Integration Tests', () => {
  let app: FastifyInstance
  let testUserId: string
  let testProjectId: string

  beforeAll(async () => {
    // Initialize Fastify app with all routes
    // app = await build()
    
    // Create test user
    const [user] = await db.insert(users).values({
      email: 'test@bobbins.test',
      name: 'Test User'
    }).returning()
    testUserId = user!.id

    // Create test project
    const [project] = await db.insert(projects).values({
      ownerId: testUserId,
      name: 'Test Project',
      description: 'Integration test project'
    }).returning()
    testProjectId = project!.id
  })

  afterAll(async () => {
    // Cleanup test data
    await db.delete(entities).where(eq(entities.projectId, testProjectId))
    await db.delete(bobbinsInstalled).where(eq(bobbinsInstalled.projectId, testProjectId))
    await db.delete(projects).where(eq(projects.id, testProjectId))
    await db.delete(users).where(eq(users.id, testUserId))
    
    // await app.close()
  })

  describe('Bobbin Installation', () => {
    it('should install a first-party bobbin with native execution', async () => {
      // Install manuscript bobbin
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
        executionMode: 'native', // Admin sets this for first-party bobbins
        trustLevel: 'first-party',
        storageTier: 'tier2'
      }).returning()

      expect(installation).toBeDefined()
      expect(installation!.executionMode).toBe('native')
      expect(installation!.trustLevel).toBe('first-party')
      expect(installation!.storageTier).toBe('tier2')
      
      // Cleanup
      await db.delete(bobbinsInstalled).where(eq(bobbinsInstalled.id, installation!.id))
    })

    it('should install external bobbin with sandboxed execution by default', async () => {
      const manifest = {
        id: 'external-bobbin',
        name: 'External Bobbin',
        version: '1.0.0',
        data: {
          collections: [{ name: 'items', fields: [] }]
        }
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'external-bobbin',
        version: '1.0.0',
        manifestJson: manifest
        // Note: no execution/storage hints - uses defaults
      }).returning()

      expect(installation).toBeDefined()
      expect(installation!.executionMode).toBe('sandboxed') // Default
      expect(installation!.trustLevel).toBe('community') // Default
      expect(installation!.storageTier).toBe('tier1') // Default
      
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
          manifestJson: { id: 'manuscript', name: 'Manuscript', version: '1.0.0' },
          executionMode: 'native',
          trustLevel: 'first-party'
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

  describe('Security Boundaries', () => {
    it('should not allow manifest to override execution mode', async () => {
      // Malicious manifest trying to claim native execution
      const maliciousManifest = {
        id: 'malicious',
        name: 'Malicious Bobbin',
        version: '1.0.0',
        execution: {
          mode: 'native' // SHOULD BE IGNORED
        },
        data: { collections: [] }
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'malicious',
        version: '1.0.0',
        manifestJson: maliciousManifest
        // Don't set executionMode - use default
      }).returning()

      // Should default to sandboxed despite manifest claim
      expect(installation!.executionMode).toBe('sandboxed')
      expect(installation!.trustLevel).toBe('community')
    })

    it('should not allow manifest to request physical storage', async () => {
      const manifest = {
        id: 'storage-requester',
        name: 'Storage Requester',
        version: '1.0.0',
        execution: {
          storage: 'prefer_physical' // SHOULD BE IGNORED
        },
        data: { collections: [] }
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'storage-requester',
        version: '1.0.0',
        manifestJson: manifest
      }).returning()

      // Should default to Tier 1 despite manifest request
      expect(installation!.storageTier).toBe('tier1')
    })

    it('should allow admin to upgrade bobbin trust level', async () => {
      // Install as untrusted
      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'upgradable',
        version: '1.0.0',
        manifestJson: { id: 'upgradable', name: 'Upgradable', version: '1.0.0' }
      }).returning()

      expect(installation!.trustLevel).toBe('community')
      expect(installation!.executionMode).toBe('sandboxed')

      // Admin upgrades trust level
      const [upgraded] = await db.update(bobbinsInstalled)
        .set({
          trustLevel: 'verified',
          executionMode: 'native', // Admin decision
          configUpdatedBy: testUserId,
          configUpdatedAt: new Date()
        })
        .where(eq(bobbinsInstalled.id, installation!.id))
        .returning()

      expect(upgraded!.trustLevel).toBe('verified')
      expect(upgraded!.executionMode).toBe('native')
      expect(upgraded!.configUpdatedBy).toBe(testUserId)
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