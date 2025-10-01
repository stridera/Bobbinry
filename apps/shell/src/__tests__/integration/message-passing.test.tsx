/**
 * Message Passing Integration Tests
 * 
 * Tests SDK message passing between shell and views,
 * both for native and sandboxed execution modes.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ViewRenderer } from '../../components/ViewRenderer'
import { viewRegistry } from '../../lib/view-registry'
import type { BookEntity } from '@bobbinry/types'

// Mock fetch for API calls
global.fetch = jest.fn()

describe('Message Passing Integration Tests', () => {
  beforeEach(() => {
    viewRegistry.clear()
    // Clear all mocks
    if (global.fetch && typeof global.fetch === 'function') {
      (global.fetch as jest.Mock).mockClear()
    }
    
    // Default successful API responses
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ entities: [], total: 0 })
    })
  })

  describe('Native View SDK Communication', () => {
    it('should allow native view to query entities via SDK', async () => {
      const mockBooks: BookEntity[] = [
        { id: '1', title: 'Book 1', order: 1, _meta: {} as any },
        { id: '2', title: 'Book 2', order: 2, _meta: {} as any }
      ]

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entities: mockBooks, total: 2 })
      })

      let capturedSDK: any = null

      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => {
          return function TestOutlineView({ sdk }: any) {
            capturedSDK = sdk
            const [books, setBooks] = React.useState<any[]>([])

            React.useEffect(() => {
              sdk.entities.query({ collection: 'books' })
                .then((result: any) => setBooks(result.data))
            }, [sdk])

            return (
              <div>
                {books.map((book: any) => (
                  <div key={book.id} data-testid={`book-${book.id}`}>
                    {book.title}
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

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      render(
        <ViewRenderer
          viewId="manuscript.outline"
          projectId="test-project"
          bobbinId="manuscript"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('book-1')).toHaveTextContent('Book 1')
        expect(screen.getByTestId('book-2')).toHaveTextContent('Book 2')
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/collections/books/entities'),
        expect.any(Object)
      )
    })

    it('should allow native view to create entities via SDK', async () => {
      const createdBook = {
        id: 'new-book-id',
        title: 'New Book',
        order: Date.now(),
        _meta: {}
      }

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => createdBook
      })

      let createCalled = false

      viewRegistry.register({
        viewId: 'test.creator',
        bobbinId: 'test',
        execution: 'native',
        componentLoader: async () => {
          return function CreatorView({ sdk }: any) {
            const handleCreate = async () => {
              await sdk.entities.create('books', {
                title: 'New Book',
                order: Date.now()
              })
              createCalled = true
            }

            return (
              <button onClick={handleCreate} data-testid="create-btn">
                Create Book
              </button>
            )
          }
        },
        ssr: false,
        capabilities: ['write'],
        metadata: { name: 'Creator', type: 'custom', source: 'native' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      render(
        <ViewRenderer
          viewId="test.creator"
          projectId="test-project"
          bobbinId="test"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('create-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('create-btn'))

      await waitFor(() => {
        expect(createCalled).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/entities'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('New Book')
        })
      )
    })

    it('should handle API errors gracefully', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      )

      let errorCaught = false

      viewRegistry.register({
        viewId: 'test.error',
        bobbinId: 'test',
        execution: 'native',
        componentLoader: async () => {
          return function ErrorView({ sdk }: any) {
            React.useEffect(() => {
              sdk.entities.query({ collection: 'books' })
                .catch(() => { errorCaught = true })
            }, [sdk])

            return <div data-testid="error-view">View</div>
          }
        },
        ssr: false,
        capabilities: ['read'],
        metadata: { name: 'Error', type: 'custom', source: 'native' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      render(
        <ViewRenderer
          viewId="test.error"
          projectId="test-project"
          bobbinId="test"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        expect(errorCaught).toBe(true)
      })
    })
  })

  describe('Sandboxed View SDK Communication', () => {
    it('should use postMessage for sandboxed view communication', async () => {
      const mockPostMessage = jest.fn()
      
      viewRegistry.register({
        viewId: 'external.board',
        bobbinId: 'external',
        execution: 'sandboxed',
        componentLoader: null,
        ssr: false,
        capabilities: ['read'],
        metadata: { name: 'Board', type: 'board', source: 'external' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      render(
        <ViewRenderer
          viewId="external.board"
          projectId="test-project"
          bobbinId="external"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        const iframe = screen.getByTitle(/board/i) as HTMLIFrameElement
        expect(iframe).toBeInTheDocument()
      })

      // Simulate iframe loaded and ready
      const iframe = screen.getByTitle(/board/i) as HTMLIFrameElement
      const readyEvent = new MessageEvent('message', {
        data: { type: 'BOBBIN_READY', viewId: 'external.board' },
        origin: window.location.origin
      })

      window.dispatchEvent(readyEvent)

      // Simulate view requesting data
      const queryEvent = new MessageEvent('message', {
        data: {
          type: 'BOBBIN_SDK_CALL',
          id: 'query-1',
          method: 'entities.query',
          args: [{ collection: 'items' }]
        },
        origin: window.location.origin
      })

      window.dispatchEvent(queryEvent)

      // Should trigger fetch to API
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })
    })

    it('should enforce capability restrictions for sandboxed views', async () => {
      viewRegistry.register({
        viewId: 'readonly.view',
        bobbinId: 'readonly',
        execution: 'sandboxed',
        componentLoader: null,
        ssr: false,
        capabilities: ['read'], // No write capability
        metadata: { name: 'ReadOnly', type: 'custom', source: 'external' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      render(
        <ViewRenderer
          viewId="readonly.view"
          projectId="test-project"
          bobbinId="readonly"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        const iframe = screen.getByTitle(/readonly/i)
        expect(iframe).toBeInTheDocument()
      })

      // Simulate view trying to create entity (should be rejected)
      const createEvent = new MessageEvent('message', {
        data: {
          type: 'BOBBIN_SDK_CALL',
          id: 'create-1',
          method: 'entities.create',
          args: ['items', { name: 'New Item' }]
        },
        origin: window.location.origin
      })

      window.dispatchEvent(createEvent)

      // Should NOT trigger fetch because view lacks write capability
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/entities'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('Event Bus Communication', () => {
    it('should allow views to emit custom events', async () => {
      const eventHandler = jest.fn()

      viewRegistry.register({
        viewId: 'emitter.view',
        bobbinId: 'emitter',
        execution: 'native',
        componentLoader: async () => {
          return function EmitterView({ sdk }: any) {
            const handleEmit = () => {
              sdk.messageBus.send('*', 'custom:event', { data: 'test' })
            }

            return (
              <button onClick={handleEmit} data-testid="emit-btn">
                Emit Event
              </button>
            )
          }
        },
        ssr: false,
        capabilities: [],
        metadata: { name: 'Emitter', type: 'custom', source: 'native' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      // Subscribe to event
      sdk.messageBus.on('custom:event', eventHandler)

      render(
        <ViewRenderer
          viewId="emitter.view"
          projectId="test-project"
          bobbinId="emitter"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('emit-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('emit-btn'))

      await waitFor(() => {
        expect(eventHandler).toHaveBeenCalledWith({ data: 'test' })
      })
    })

    it('should allow views to listen for events', async () => {
      let receivedData: any = null

      viewRegistry.register({
        viewId: 'listener.view',
        bobbinId: 'listener',
        execution: 'native',
        componentLoader: async () => {
          return function ListenerView({ sdk }: any) {
            React.useEffect(() => {
              const handler = (data: any) => {
                receivedData = data
              }
              sdk.messageBus.on('test:event', handler)
              return () => sdk.messageBus.off('test:event', handler)
            }, [sdk])

            return <div data-testid="listener">Listening...</div>
          }
        },
        ssr: false,
        capabilities: [],
        metadata: { name: 'Listener', type: 'custom', source: 'native' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      render(
        <ViewRenderer
          viewId="listener.view"
          projectId="test-project"
          bobbinId="listener"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('listener')).toBeInTheDocument()
      })

      // Emit event from outside
      sdk.messageBus.send('*', 'test:event', { message: 'hello' })

      await waitFor(() => {
        expect(receivedData).toEqual({ message: 'hello' })
      })
    })

    it('should cleanup event listeners on unmount', async () => {
      const handler = jest.fn()

      viewRegistry.register({
        viewId: 'cleanup.view',
        bobbinId: 'cleanup',
        execution: 'native',
        componentLoader: async () => {
          return function CleanupView({ sdk }: any) {
            React.useEffect(() => {
              sdk.messageBus.on('cleanup:event', handler)
              return () => sdk.messageBus.off('cleanup:event', handler)
            }, [sdk])

            return <div data-testid="cleanup">View</div>
          }
        },
        ssr: false,
        capabilities: [],
        metadata: { name: 'Cleanup', type: 'custom', source: 'native' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      const { unmount } = render(
        <ViewRenderer
          viewId="cleanup.view"
          projectId="test-project"
          bobbinId="cleanup"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('cleanup')).toBeInTheDocument()
      })

      // Unmount component
      unmount()

      // Emit event after unmount
      sdk.messageBus.send('*', 'cleanup:event', {})

      // Handler should NOT be called after cleanup
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('Type Safety in Message Passing', () => {
    it('should pass typed entities correctly', async () => {
      const mockBooks: BookEntity[] = [
        {
          id: '1',
          title: 'Typed Book',
          order: 1,
          _meta: {
            bobbinId: 'manuscript',
            collection: 'books',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      ]

      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entities: mockBooks, total: 1 })
      })

      let capturedBook: BookEntity | null = null

      viewRegistry.register({
        viewId: 'typed.view',
        bobbinId: 'typed',
        execution: 'native',
        componentLoader: async () => {
          return function TypedView({ sdk }: any) {
            React.useEffect(() => {
              sdk.entities.query({ collection: 'books' })
                .then((result: any) => {
                  const book = result.data[0] as BookEntity
                  capturedBook = book
                  
                  // TypeScript would catch this at compile time
                  // book.data.title // ❌ Error: Property 'data' does not exist
                  const title = book.title // ✅ Correct
                })
            }, [sdk])

            return <div data-testid="typed">Typed View</div>
          }
        },
        ssr: false,
        capabilities: ['read'],
        metadata: { name: 'Typed', type: 'custom', source: 'native' }
      })

      const sdk = new BobbinrySDK('test-component', 'http://localhost:4000/api')
      sdk.setProject('test-project')

      render(
        <ViewRenderer
          viewId="typed.view"
          projectId="test-project"
          bobbinId="typed"
          sdk={sdk}
        />
      )

      await waitFor(() => {
        expect(capturedBook).toBeDefined()
        expect(capturedBook!.title).toBe('Typed Book')
        expect((capturedBook as any).data).toBeUndefined() // No nested .data
      })
    })
  })
})

// Add React import for JSX
import * as React from 'react'