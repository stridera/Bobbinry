/**
 * Type safety tests for Manuscript entities
 * 
 * These tests verify that entity types match the actual API response structure.
 * If the API changes but types don't update, TypeScript will catch the mismatch.
 */

import type { BookEntity, ChapterEntity, SceneEntity } from '@bobbinry/types'

describe('Manuscript Entity Types', () => {
  it('should have correct structure for BookEntity', () => {
    // This simulates what the API returns
    const apiResponse: BookEntity = {
      id: '123',
      title: 'My Book',
      order: 1,
      _meta: {
        bobbinId: 'manuscript',
        collection: 'books',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }

    // Correct access - data is spread directly on the entity
    expect(apiResponse.title).toBe('My Book')
    
    // TypeScript will error if we try to access non-existent nested .data property
    // @ts-expect-error - This should fail because data is spread directly
    const _wrongType: string = apiResponse.data?.title
  })

  it('should have correct structure for ChapterEntity', () => {
    const apiResponse: ChapterEntity = {
      id: '456',
      title: 'Chapter 1',
      order: 1,
      book_id: '123',
      _meta: {
        bobbinId: 'manuscript',
        collection: 'chapters',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }

    // Correct access
    expect(apiResponse.title).toBe('Chapter 1')
    expect(apiResponse.book_id).toBe('123')
    
    // @ts-expect-error - This should fail
    const _wrongType: string = apiResponse.data?.title
  })

  it('should have correct structure for SceneEntity', () => {
    const apiResponse: SceneEntity = {
      id: '789',
      title: 'Opening Scene',
      order: 1,
      chapter_id: '456',
      word_count: 1500,
      _meta: {
        bobbinId: 'manuscript',
        collection: 'scenes',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }

    // Correct access
    expect(apiResponse.word_count).toBe(1500)
    expect(apiResponse.chapter_id).toBe('456')
    
    // @ts-expect-error - This should fail
    const _wrongType: number = apiResponse.data?.word_count
  })

  it('should allow optional fields to be undefined', () => {
    const sceneWithoutWordCount: SceneEntity = {
      id: '789',
      title: 'Opening Scene',
      order: 1,
      chapter_id: '456',
      // word_count is optional
      _meta: {
        bobbinId: 'manuscript',
        collection: 'scenes',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }

    expect(sceneWithoutWordCount.word_count).toBeUndefined()
  })
})