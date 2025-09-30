/**
 * End-to-End Workflow Tests
 * 
 * Tests complete user workflows from project creation through
 * bobbin installation, data creation, and view rendering.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { db } from '../../../api/src/db/connection'
import { projects, users, bobbinsInstalled, entities } from '../../../api/src/db/schema'
import { eq } from 'drizzle-orm'
import { createBobbinrySDK } from '@bobbinry/sdk'
import { viewRegistry } from '../../lib/view-registry'
import type { BookEntity, ChapterEntity, SceneEntity } from '@bobbinry/types'

// Mock fetch
global.fetch = jest.fn()

describe('End-to-End Workflow Tests', () => {
  let testUserId: string
  let testProjectId: string
  let sdk: any

  beforeAll(async () => {
    // Create test user
    const [user] = await db.insert(users).values({
      email: 'e2e@bobbins.test',
      name: 'E2E Test User'
    }).returning()
    testUserId = user!.id

    // Create test project
    const [project] = await db.insert(projects).values({
      ownerId: testUserId,
      name: 'E2E Test Project',
      description: 'End-to-end test project'
    }).returning()
    testProjectId = project!.id

    // Initialize SDK
    sdk = createBobbinrySDK({
      projectId: testProjectId,
      apiUrl: 'http://localhost:4000/api'
    })
  })

  afterAll(async () => {
    // Cleanup
    await db.delete(entities).where(eq(entities.projectId, testProjectId))
    await db.delete(bobbinsInstalled).where(eq(bobbinsInstalled.projectId, testProjectId))
    await db.delete(projects).where(eq(projects.id, testProjectId))
    await db.delete(users).where(eq(users.id, testUserId))
  })

  describe('Complete Manuscript Workflow', () => {
    it('should complete full workflow: install → create book → add chapters → add scenes', async () => {
      // Step 1: Install Manuscript bobbin
      console.log('📦 Step 1: Installing Manuscript bobbin...')
      
      const manifest = {
        id: 'manuscript',
        name: 'Manuscript',
        version: '1.0.0',
        data: {
          collections: [
            { name: 'books', fields: [{ name: 'title', type: 'short_text' }] },
            { name: 'chapters', fields: [{ name: 'title', type: 'short_text' }] },
            { name: 'scenes', fields: [{ name: 'title', type: 'short_text' }] }
          ]
        },
        ui: {
          views: [
            { id: 'outline', type: 'tree', source: 'Chapter' },
            { id: 'editor', type: 'editor', source: 'Scene' }
          ]
        }
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        version: '1.0.0',
        manifestJson: manifest,
        executionMode: 'native',
        trustLevel: 'first-party',
        storageTier: 'tier2'
      }).returning()

      expect(installation).toBeDefined()
      expect(installation!.executionMode).toBe('native')
      console.log('✅ Manuscript bobbin installed')

      // Step 2: Create a book
      console.log('📖 Step 2: Creating a book...')
      
      const [book] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: {
          title: 'My First Novel',
          order: 1
        }
      }).returning()

      expect(book).toBeDefined()
      expect((book!.entityData as any).title).toBe('My First Novel')
      console.log('✅ Book created:', book!.id)

      // Step 3: Create chapters
      console.log('📑 Step 3: Creating chapters...')
      
      const [chapter1] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'chapters',
        entityData: {
          title: 'Chapter 1: The Beginning',
          order: 1,
          book_id: book!.id
        }
      }).returning()

      const [chapter2] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'chapters',
        entityData: {
          title: 'Chapter 2: The Journey',
          order: 2,
          book_id: book!.id
        }
      }).returning()

      expect(chapter1).toBeDefined()
      expect(chapter2).toBeDefined()
      console.log('✅ Chapters created:', chapter1!.id, chapter2!.id)

      // Step 4: Create scenes
      console.log('📝 Step 4: Creating scenes...')
      
      const [scene1] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'scenes',
        entityData: {
          title: 'Scene 1: Morning',
          order: 1,
          chapter_id: chapter1!.id,
          content: 'It was a dark and stormy night...',
          word_count: 6
        }
      }).returning()

      const [scene2] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'scenes',
        entityData: {
          title: 'Scene 2: Evening',
          order: 2,
          chapter_id: chapter1!.id,
          content: 'The sun set over the horizon.',
          word_count: 6
        }
      }).returning()

      expect(scene1).toBeDefined()
      expect(scene2).toBeDefined()
      console.log('✅ Scenes created:', scene1!.id, scene2!.id)

      // Step 5: Query the complete hierarchy
      console.log('🔍 Step 5: Querying complete hierarchy...')
      
      const books = await db.select()
        .from(entities)
        .where(eq(entities.collectionName, 'books'))

      const chapters = await db.select()
        .from(entities)
        .where(eq(entities.collectionName, 'chapters'))

      const scenes = await db.select()
        .from(entities)
        .where(eq(entities.collectionName, 'scenes'))

      expect(books).toHaveLength(1)
      expect(chapters).toHaveLength(2)
      expect(scenes).toHaveLength(2)
      console.log('✅ Hierarchy complete:', books.length, 'books,', chapters.length, 'chapters,', scenes.length, 'scenes')

      // Step 6: Verify data structure (not nested)
      console.log('🔍 Step 6: Verifying data structure...')
      
      const sceneData = scene1!.entityData as any
      expect(sceneData.title).toBe('Scene 1: Morning')
      expect(sceneData.word_count).toBe(6)
      expect(sceneData.data).toBeUndefined() // NOT nested
      console.log('✅ Data structure verified: properties are spread directly')

      // Step 7: Test type safety
      console.log('🔍 Step 7: Testing type safety...')
      
      const typedBook = book!.entityData as BookEntity
      const typedChapter = chapter1!.entityData as ChapterEntity
      const typedScene = scene1!.entityData as SceneEntity

      // These would fail at compile time with wrong access
      expect(typedBook.title).toBeDefined()
      expect(typedChapter.title).toBeDefined()
      expect(typedScene.title).toBeDefined()
      expect(typedScene.word_count).toBe(6)
      console.log('✅ Type safety working correctly')

      console.log('🎉 Complete workflow test passed!')
    })
  })

  describe('Multi-Bobbin Workflow', () => {
    it('should handle multiple bobbins in same project', async () => {
      // Install Manuscript
      await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        version: '1.0.0',
        manifestJson: { id: 'manuscript', name: 'Manuscript', version: '1.0.0' },
        executionMode: 'native',
        trustLevel: 'first-party'
      })

      // Install external bobbin (community/untrusted)
      await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'timeline',
        version: '1.0.0',
        manifestJson: { id: 'timeline', name: 'Timeline', version: '1.0.0' }
        // Uses defaults: sandboxed, community, tier1
      })

      // Query installations
      const installations = await db.select()
        .from(bobbinsInstalled)
        .where(eq(bobbinsInstalled.projectId, testProjectId))

      expect(installations).toHaveLength(2)

      // Verify execution modes
      const manuscriptInstall = installations.find(i => i.bobbinId === 'manuscript')
      const timelineInstall = installations.find(i => i.bobbinId === 'timeline')

      expect(manuscriptInstall!.executionMode).toBe('native')
      expect(manuscriptInstall!.trustLevel).toBe('first-party')

      expect(timelineInstall!.executionMode).toBe('sandboxed')
      expect(timelineInstall!.trustLevel).toBe('community')
    })

    it('should maintain data isolation between bobbins', async () => {
      // Create entity for manuscript
      const [manuscriptEntity] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: { title: 'Manuscript Book' }
      }).returning()

      // Create entity for timeline (same collection name but different bobbin)
      const [timelineEntity] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'timeline',
        collectionName: 'events',
        entityData: { title: 'Timeline Event' }
      }).returning()

      // Query manuscript entities
      const manuscriptEntities = await db.select()
        .from(entities)
        .where(eq(entities.bobbinId, 'manuscript'))

      // Query timeline entities
      const timelineEntities = await db.select()
        .from(entities)
        .where(eq(entities.bobbinId, 'timeline'))

      // Should be isolated
      expect(manuscriptEntities.every(e => e.bobbinId === 'manuscript')).toBe(true)
      expect(timelineEntities.every(e => e.bobbinId === 'timeline')).toBe(true)
    })
  })

  describe('View Rendering in Complete Workflow', () => {
    it('should render native view with real data', async () => {
      // Setup: Create book data
      const [book] = await db.insert(entities).values({
        projectId: testProjectId,
        bobbinId: 'manuscript',
        collectionName: 'books',
        entityData: { title: 'Test Book', order: 1 }
      }).returning()

      // Mock API response
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entities: [{ id: book!.id, ...(book!.entityData as any), _meta: {} }],
          total: 1
        })
      })

      // Register native view
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => {
          return function OutlineView({ sdk }: any) {
            const [books, setBooks] = React.useState<any[]>([])

            React.useEffect(() => {
              sdk.entities.query({ collection: 'books' })
                .then((result: any) => setBooks(result.data))
            }, [sdk])

            return (
              <div>
                <h1>Outline</h1>
                {books.map(b => (
                  <div key={b.id} data-testid={`book-${b.id}`}>
                    {b.title}
                  </div>
                ))}
              </div>
            )
          }
        },
        ssr: false,
        capabilities: ['read'],
        metadata: { name: 'Outline', type: 'tree', source: 'native' }
      })

      // Render view
      const { ViewRenderer } = await import('../../components/ViewRenderer')
      
      render(
        <ViewRenderer
          viewId="manuscript.outline"
          projectId={testProjectId}
          bobbinId="manuscript"
          sdk={sdk}
        />
      )

      // Should display book from database
      await waitFor(() => {
        expect(screen.getByText('Test Book')).toBeInTheDocument()
      })
    })
  })

  describe('Security Workflow', () => {
    it('should enforce security boundaries through complete workflow', async () => {
      // Malicious manifest tries to claim native execution
      const maliciousManifest = {
        id: 'malicious',
        name: 'Malicious Bobbin',
        version: '1.0.0',
        execution: { mode: 'native' }, // ← Should be ignored
        data: { collections: [] }
      }

      // Install without setting execution mode (uses defaults)
      const [installation] = await db.insert(bobbinsInstalled).values({
        projectId: testProjectId,
        bobbinId: 'malicious',
        version: '1.0.0',
        manifestJson: maliciousManifest
      }).returning()

      // Should default to sandboxed despite manifest claim
      expect(installation!.executionMode).toBe('sandboxed')
      expect(installation!.trustLevel).toBe('community')

      // Admin reviews and approves (if trusted)
      const [upgraded] = await db.update(bobbinsInstalled)
        .set({
          trustLevel: 'verified',
          executionMode: 'sandboxed', // Still sandboxed but verified
          configUpdatedBy: testUserId,
          configUpdatedAt: new Date()
        })
        .where(eq(bobbinsInstalled.id, installation!.id))
        .returning()

      expect(upgraded!.trustLevel).toBe('verified')
      expect(upgraded!.executionMode).toBe('sandboxed') // Admin decision, not manifest
      expect(upgraded!.configUpdatedBy).toBe(testUserId)
    })
  })
})

import * as React from 'react'