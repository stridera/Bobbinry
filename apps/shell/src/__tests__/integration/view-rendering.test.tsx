/**
 * View Rendering Integration Tests
 * 
 * Tests that views load correctly in their designated execution mode
 * (native vs sandboxed) and that message passing works as expected.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ViewRenderer } from '../../components/ViewRenderer'
import { viewRegistry } from '../../lib/view-registry'
import type { BobbinrySDK } from '@bobbinry/sdk'

// Mock SDK
const createMockSDK = (): BobbinrySDK => ({
  entities: {
    query: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    get: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'test-id' }),
    update: jest.fn().mockResolvedValue({ id: 'test-id' }),
    delete: jest.fn().mockResolvedValue({ success: true })
  },
  views: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn()
  }
} as any)

describe('View Rendering Integration Tests', () => {
  let mockSDK: BobbinrySDK

  beforeEach(() => {
    mockSDK = createMockSDK()
    viewRegistry.clear()
  })

  describe('Native View Rendering', () => {
    it('should load native view as React component', async () => {
      // Register a native view
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => {
          // Mock component
          return function MockOutlineView() {
            return <div data-testid="native-outline">Native Outline View</div>
          }
        },
        ssr: true,
        capabilities: ['read', 'write'],
        metadata: {
          name: 'Outline',
          type: 'tree',
          source: 'native'
        }
      })

      render(
        <ViewRenderer
          viewId="manuscript.outline"
          projectId="test-project"
          bobbinId="manuscript"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('native-outline')).toBeInTheDocument()
      })

      // Should NOT be in an iframe
      expect(screen.queryByTitle(/view/i)).not.toBeInTheDocument()
    })

    it('should pass props correctly to native view', async () => {
      let capturedProps: any = null

      viewRegistry.register({
        viewId: 'test.native',
        bobbinId: 'test',
        execution: 'native',
        componentLoader: async () => {
          return function TestView(props: any) {
            capturedProps = props
            return <div data-testid="test-view">Test View</div>
          }
        },
        ssr: false,
        capabilities: [],
        metadata: { name: 'Test', type: 'custom', source: 'native' }
      })

      render(
        <ViewRenderer
          viewId="test.native"
          projectId="project-123"
          bobbinId="test"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        expect(capturedProps).toBeDefined()
        expect(capturedProps.projectId).toBe('project-123')
        expect(capturedProps.bobbinId).toBe('test')
        expect(capturedProps.sdk).toBe(mockSDK)
      })
    })

    it('should handle native view errors gracefully', async () => {
      viewRegistry.register({
        viewId: 'error.native',
        bobbinId: 'error',
        execution: 'native',
        componentLoader: async () => {
          throw new Error('Failed to load component')
        },
        ssr: false,
        capabilities: [],
        metadata: { name: 'Error', type: 'custom', source: 'native' }
      })

      render(
        <ViewRenderer
          viewId="error.native"
          projectId="test-project"
          bobbinId="error"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
      })
    })
  })

  describe('Sandboxed View Rendering', () => {
    it('should load sandboxed view in iframe', async () => {
      viewRegistry.register({
        viewId: 'external.board',
        bobbinId: 'external',
        execution: 'sandboxed',
        iframeSrc: '/api/views/external/board',
        ssr: false,
        capabilities: ['read'],
        metadata: {
          name: 'Board',
          type: 'board',
          source: 'external'
        }
      })

      render(
        <ViewRenderer
          viewId="external.board"
          projectId="test-project"
          bobbinId="external"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        const iframe = screen.getByTitle(/board/i) as HTMLIFrameElement
        expect(iframe).toBeInTheDocument()
        expect(iframe.tagName).toBe('IFRAME')
      })
    })

    it('should apply sandbox restrictions to iframe', async () => {
      viewRegistry.register({
        viewId: 'untrusted.view',
        bobbinId: 'untrusted',
        execution: 'sandboxed',
        iframeSrc: '/api/views/untrusted/view',
        ssr: false,
        capabilities: [],
        metadata: { name: 'Untrusted', type: 'custom', source: 'external' }
      })

      render(
        <ViewRenderer
          viewId="untrusted.view"
          projectId="test-project"
          bobbinId="untrusted"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        const iframe = screen.getByTitle(/untrusted/i) as HTMLIFrameElement
        expect(iframe).toBeInTheDocument()
        
        // Should have sandbox attribute with restrictions
        const sandbox = iframe.getAttribute('sandbox')
        expect(sandbox).toBeTruthy()
        expect(sandbox).toContain('allow-scripts')
        expect(sandbox).not.toContain('allow-same-origin')
      })
    })
  })

  describe('Execution Mode Routing', () => {
    it('should route native bobbins to NativeViewRenderer', async () => {
      viewRegistry.register({
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => {
          return function EditorView() {
            return <div data-testid="native-editor">Native Editor</div>
          }
        },
        ssr: true,
        capabilities: ['read', 'write'],
        metadata: { name: 'Editor', type: 'editor', source: 'native' }
      })

      render(
        <ViewRenderer
          viewId="manuscript.editor"
          projectId="test-project"
          bobbinId="manuscript"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        // Should render natively, not in iframe
        expect(screen.getByTestId('native-editor')).toBeInTheDocument()
        expect(screen.queryByTitle(/view/i)).not.toBeInTheDocument()
      })
    })

    it('should route sandboxed bobbins to SandboxedViewRenderer', async () => {
      viewRegistry.register({
        viewId: 'community.widget',
        bobbinId: 'community',
        execution: 'sandboxed',
        iframeSrc: '/api/views/community/widget',
        ssr: false,
        capabilities: ['read'],
        metadata: { name: 'Widget', type: 'widget', source: 'external' }
      })

      render(
        <ViewRenderer
          viewId="community.widget"
          projectId="test-project"
          bobbinId="community"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        // Should render in iframe
        const iframe = screen.getByTitle(/widget/i)
        expect(iframe).toBeInTheDocument()
        expect(iframe.tagName).toBe('IFRAME')
      })
    })

    it('should fallback to sandboxed for unknown execution mode', async () => {
      viewRegistry.register({
        viewId: 'unknown.view',
        bobbinId: 'unknown',
        execution: 'unknown-mode' as any, // Invalid mode
        componentLoader: null,
        ssr: false,
        capabilities: [],
        metadata: { name: 'Unknown', type: 'custom', source: 'unknown' }
      })

      render(
        <ViewRenderer
          viewId="unknown.view"
          projectId="test-project"
          bobbinId="unknown"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        // Should default to sandboxed (iframe)
        const iframe = screen.queryByTitle(/view/i)
        expect(iframe).toBeInTheDocument()
      })
    })
  })

  describe('View Registry', () => {
    it('should register and retrieve view configurations', () => {
      const viewConfig = {
        viewId: 'test.view',
        bobbinId: 'test',
        execution: 'native' as const,
        componentLoader: jest.fn(),
        ssr: true,
        capabilities: ['read', 'write'],
        metadata: { name: 'Test', type: 'custom', source: 'native' }
      }

      viewRegistry.register(viewConfig)

      const retrieved = viewRegistry.get('test.view')
      expect(retrieved).toEqual(viewConfig)
    })

    it('should list all registered views', () => {
      viewRegistry.register({
        viewId: 'view1',
        bobbinId: 'bobbin1',
        execution: 'native',
        componentLoader: jest.fn(),
        ssr: true,
        capabilities: [],
        metadata: { name: 'View 1', type: 'custom', source: 'native' }
      })

      viewRegistry.register({
        viewId: 'view2',
        bobbinId: 'bobbin2',
        execution: 'sandboxed',
        iframeSrc: '/api/views/bobbin2/view2',
        ssr: false,
        capabilities: [],
        metadata: { name: 'View 2', type: 'custom', source: 'external' }
      })

      const allViews = viewRegistry.getAll()
      expect(allViews).toHaveLength(2)
      expect(allViews.map(v => v.viewId)).toContain('view1')
      expect(allViews.map(v => v.viewId)).toContain('view2')
    })

    it('should unregister views', () => {
      viewRegistry.register({
        viewId: 'temp.view',
        bobbinId: 'temp',
        execution: 'native',
        componentLoader: jest.fn(),
        ssr: false,
        capabilities: [],
        metadata: { name: 'Temp', type: 'custom', source: 'native' }
      })

      expect(viewRegistry.get('temp.view')).toBeDefined()

      viewRegistry.unregister('temp.view')

      expect(viewRegistry.get('temp.view')).toBeUndefined()
    })

    it('should clear all registrations', () => {
      viewRegistry.register({
        viewId: 'view1',
        bobbinId: 'bobbin1',
        execution: 'native',
        componentLoader: jest.fn(),
        ssr: false,
        capabilities: [],
        metadata: { name: 'View 1', type: 'custom', source: 'native' }
      })

      expect(viewRegistry.getAll()).toHaveLength(1)

      viewRegistry.clear()

      expect(viewRegistry.getAll()).toHaveLength(0)
    })
  })

  describe('Loading States', () => {
    it('should show loading state while component loads', async () => {
      let resolveLoader: any
      const loaderPromise = new Promise<any>(resolve => {
        resolveLoader = resolve
      })

      viewRegistry.register({
        viewId: 'slow.view',
        bobbinId: 'slow',
        execution: 'native',
        componentLoader: () => loaderPromise,
        ssr: false,
        capabilities: [],
        metadata: { name: 'Slow', type: 'custom', source: 'native' }
      })

      render(
        <ViewRenderer
          viewId="slow.view"
          projectId="test-project"
          bobbinId="slow"
          sdk={mockSDK}
        />
      )

      // Should show loading
      expect(screen.getByText(/loading/i)).toBeInTheDocument()

      // Resolve the loader
      resolveLoader(() => function SlowView() {
        return <div data-testid="slow-view">Loaded!</div>
      })

      await waitFor(() => {
        expect(screen.getByTestId('slow-view')).toBeInTheDocument()
        expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Error Boundaries', () => {
    it('should catch and display component errors', async () => {
      viewRegistry.register({
        viewId: 'crashing.view',
        bobbinId: 'crashing',
        execution: 'native',
        componentLoader: async () => {
          return function CrashingView() {
            throw new Error('Component crashed!')
          }
        },
        ssr: false,
        capabilities: [],
        metadata: { name: 'Crashing', type: 'custom', source: 'native' }
      })

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      render(
        <ViewRenderer
          viewId="crashing.view"
          projectId="test-project"
          bobbinId="crashing"
          sdk={mockSDK}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument()
      })

      consoleSpy.mockRestore()
    })
  })
})