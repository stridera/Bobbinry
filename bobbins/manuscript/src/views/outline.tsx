import React, { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import type { BookEntity, ChapterEntity, SceneEntity } from '@bobbinry/types'

interface OutlineViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
}

interface OutlineNode {
  id: string
  title: string
  type: 'book' | 'chapter' | 'scene'
  children?: OutlineNode[]
  wordCount?: number | undefined
}

/**
 * Native Outline View for Manuscript bobbin
 * Displays hierarchical structure of Books > Chapters > Scenes
 */
export default function OutlineView({ projectId, sdk }: OutlineViewProps) {
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  useEffect(() => {
    loadOutline()
  }, [projectId])

  async function loadOutline() {
    try {
      setLoading(true)

      // Fetch books from SDK
      const books = await sdk.entities.query({
        collection: 'books',
        sort: [{ field: 'order', direction: 'asc' }]
      })

      // Build hierarchical structure
      const outlineData: OutlineNode[] = []

      for (const book of books.data as BookEntity[]) {
        const bookNode: OutlineNode = {
          id: book.id,
          title: book.title || 'Untitled Book',
          type: 'book',
          children: []
        }

        // Fetch chapters for this book
        const chapters = await sdk.entities.query({
          collection: 'chapters',
          filters: { book_id: book.id },
          sort: [{ field: 'order', direction: 'asc' }]
        })

        for (const chapter of chapters.data as ChapterEntity[]) {
          const chapterNode: OutlineNode = {
            id: chapter.id,
            title: chapter.title || 'Untitled Chapter',
            type: 'chapter',
            children: []
          }

          // Fetch scenes for this chapter
          const scenes = await sdk.entities.query({
            collection: 'scenes',
            filters: { chapter_id: chapter.id },
            sort: [{ field: 'order', direction: 'asc' }]
          })

          for (const scene of scenes.data as SceneEntity[]) {
            chapterNode.children!.push({
              id: scene.id,
              title: scene.title || 'Untitled Scene',
              type: 'scene',
              wordCount: scene.word_count ?? undefined
            })
          }

          bookNode.children!.push(chapterNode)
        }

        outlineData.push(bookNode)
      }

      setOutline(outlineData)
    } catch (error) {
      console.error('[OutlineView] Failed to load outline:', error)
    } finally {
      setLoading(false)
    }
  }

  function renderNode(node: OutlineNode, depth: number = 0) {
    const indent = depth * 20
    const isSelected = selectedNode === node.id

    return (
      <div key={node.id} style={{ marginLeft: indent }}>
        <div
          onClick={() => setSelectedNode(node.id)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            backgroundColor: isSelected ? '#e3f2fd' : 'transparent',
            borderRadius: '4px',
            marginBottom: '2px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>
            {node.type === 'book' && '📚'} {node.type === 'chapter' && '📑'}{' '}
            {node.type === 'scene' && '📝'} {node.title}
          </span>
          {node.wordCount !== undefined && (
            <span style={{ fontSize: '12px', color: '#666' }}>{node.wordCount} words</span>
          )}
        </div>
        {node.children && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div>Loading outline...</div>
      </div>
    )
  }

  if (outline.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <div style={{ marginBottom: '12px' }}>No content yet</div>
        <button
          onClick={async () => {
            const title = window.prompt('Enter book title:')
            if (title) {
              try {
                await sdk.entities.create('books', {
                  title,
                  order: Date.now()
                })
                loadOutline()
              } catch (error) {
                console.error('Failed to create book:', error)
                alert('Failed to create book: ' + (error instanceof Error ? error.message : 'Unknown error'))
              }
            }
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Create Your First Book
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}
      >
        <h2 style={{ margin: 0 }}>Manuscript Outline</h2>
        <button
          onClick={loadOutline}
          style={{
            padding: '6px 12px',
            backgroundColor: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Refresh
        </button>
      </div>
      <div>{outline.map(node => renderNode(node))}</div>
    </div>
  )
}