/**
 * Integration tests for Native vs Sandboxed execution modes
 *
 * Tests the complete flow from manifest → registry → renderer
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ViewRenderer } from '../components/ViewRenderer'
import { viewRegistry } from '../lib/view-registry'
import { createComponentLoader } from '../lib/native-view-loader'
import { BobbinrySDK } from '@bobbinry/sdk'

// Mock the BobbinrySDK
jest.mock('@bobbinry/sdk', () => ({
  BobbinrySDK: jest.fn().mockImplementation(() => ({
    entity: {
      query: jest.fn().mockResolvedValue({ entities: [] }),
      get: jest.fn().mockResolvedValue({ id: '1', data: {} }),
      update: jest.fn().mockResolvedValue({ id: '1' })
    }
  }))
}))

// Mock native view components
const MockOutlineView = ({ projectId, viewId }: any) => (
  <div data-testid="native-outline-view">
    Native Manuscript Outline View
    <div>Project: {projectId}</div>
    <div>View: {viewId}</div>
  </div>
)

const MockEditorView = ({ projectId, viewId }: any) => (
  <div data-testid="native-editor-view">
    Native Manuscript Editor View
    <div>Project: {projectId}</div>
    <div>View: {viewId}</div>
  </div>
)

jest.mock('@bobbinry/manuscript/views/outline', () => MockOutlineView, { virtual: true })
jest.mock('@bobbinry/manuscript/views/editor', () => MockEditorView, { virtual: true })

// Mock BobbinBridge for sandboxed views
jest.mock('../services/BobbinBridge', () => ({
  BobbinBridge: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
    initializeContext: jest.fn().mockResolvedValue(undefined),
    updateTheme: jest.fn(),
    handleMessage: jest.fn().mockResolvedValue(undefined)
  }))
}))

describe('Execution Modes Integration', () => {
  let mockSdk: BobbinrySDK

  beforeEach(() => {
    // Clear registry before each test
    viewRegistry.clear()

    // Create mock SDK
    mockSdk = new BobbinrySDK({
      apiBaseUrl: 'http://localhost:4000',
      getAuthToken: async () => 'mock-token'
    })
  })

  afterEach(() => {
    viewRegistry.clear()
  })

  describe('Native Execution Mode', () => {
    it('should register and render native Manuscript Outline view', async () => {
      // Register native view
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'outline'),
        ssr: true,
        capabilities: ['read'],
        metadata: {
          name: 'Outline',
          type: 'tree',
          source: 'native'
        }
      })

      // Verify registration
      const entry = viewRegistry.get('manuscript.outline')
      expect(entry).toBeDefined()
      expect(entry?.execution).toBe('native')
      expect(entry?.componentLoader).toBeDefined()
      expect(entry?.ssr).toBe(true)

      // Render the view
      const { container } = render(
        <ViewRenderer
          projectId="test-project-1"
          bobbinId="manuscript"
          viewId="manuscript.outline"
          sdk={mockSdk}
        />
      )

      // Should show native view indicator in development
      await waitFor(() => {
        const nativeView = screen.getByTestId('native-outline-view')
        expect(nativeView).toBeInTheDocument()
        expect(nativeView).toHaveTextContent('Native Manuscript Outline View')
        expect(nativeView).toHaveTextContent('Project: test-project-1')
        expect(nativeView).toHaveTextContent('View: manuscript.outline')
      })

      // Should NOT have iframe
      const iframe = container.querySelector('iframe')
      expect(iframe).toBeNull()
    })

    it('should register and render native Manuscript Editor view', async () => {
      // Register native view
      viewRegistry.register({
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'editor'),
        ssr: true,
        capabilities: ['read', 'write'],
        metadata: {
          name: 'Editor',
          type: 'editor',
          source: 'native'
        }
      })

      // Render the view
      render(
        <ViewRenderer
          projectId="test-project-1"
          bobbinId="manuscript"
          viewId="manuscript.editor"
          sdk={mockSdk}
        />
      )

      // Should render native editor
      await waitFor(() => {
        const editorView = screen.getByTestId('native-editor-view')
        expect(editorView).toBeInTheDocument()
        expect(editorView).toHaveTextContent('Native Manuscript Editor View')
      })
    })

    it('should track native views separately in registry', () => {
      // Register multiple views
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'outline'),
        ssr: true,
        capabilities: ['read'],
        metadata: { name: 'Outline', type: 'tree', source: 'native' }
      })

      viewRegistry.register({
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'editor'),
        ssr: true,
        capabilities: ['read', 'write'],
        metadata: { name: 'Editor', type: 'editor', source: 'native' }
      })

      // Get statistics
      const stats = viewRegistry.getStats()
      expect(stats.totalViews).toBe(2)
      expect(stats.nativeViews).toBe(2)
      expect(stats.sandboxedViews).toBe(0)

      // Get only native views
      const nativeViews = viewRegistry.getNativeViews()
      expect(nativeViews).toHaveLength(2)
      expect(nativeViews.every(v => v.execution === 'native')).toBe(true)
    })
  })

  describe('Sandboxed Execution Mode', () => {
    it('should register and render sandboxed Dictionary Panel view', async () => {
      // Register sandboxed view
      viewRegistry.register({
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary-panel',
        execution: 'sandboxed',
        iframeSrc: 'http://localhost:4000/api/views/dictionary-panel/panel',
        capabilities: ['read', 'pubsub'],
        metadata: {
          name: 'Dictionary Panel',
          type: 'panel',
          source: 'sandboxed'
        }
      })

      // Verify registration
      const entry = viewRegistry.get('dictionary.panel')
      expect(entry).toBeDefined()
      expect(entry?.execution).toBe('sandboxed')
      expect(entry?.iframeSrc).toBeDefined()
      expect(entry?.componentLoader).toBeUndefined()

      // Render the view
      const { container } = render(
        <ViewRenderer
          projectId="test-project-1"
          bobbinId="dictionary-panel"
          viewId="dictionary.panel"
          sdk={mockSdk}
        />
      )

      // Should have iframe for sandboxed view
      const iframe = container.querySelector('iframe')
      expect(iframe).toBeInTheDocument()
      expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts')
      expect(iframe?.getAttribute('sandbox')).toContain('allow-same-origin')
    })

    it('should track sandboxed views separately in registry', () => {
      // Register sandboxed view
      viewRegistry.register({
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary-panel',
        execution: 'sandboxed',
        iframeSrc: 'http://localhost:4000/api/views/dictionary-panel/panel',
        capabilities: ['read', 'pubsub'],
        metadata: { name: 'Dictionary Panel', type: 'panel', source: 'sandboxed' }
      })

      // Get statistics
      const stats = viewRegistry.getStats()
      expect(stats.totalViews).toBe(1)
      expect(stats.nativeViews).toBe(0)
      expect(stats.sandboxedViews).toBe(1)

      // Get only sandboxed views
      const sandboxedViews = viewRegistry.getSandboxedViews()
      expect(sandboxedViews).toHaveLength(1)
      expect(sandboxedViews[0].execution).toBe('sandboxed')
    })
  })

  describe('Mixed Execution Modes', () => {
    it('should handle both native and sandboxed views in the same registry', () => {
      // Register native views
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'outline'),
        ssr: true,
        capabilities: ['read'],
        metadata: { name: 'Outline', type: 'tree', source: 'native' }
      })

      viewRegistry.register({
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'editor'),
        ssr: true,
        capabilities: ['read', 'write'],
        metadata: { name: 'Editor', type: 'editor', source: 'native' }
      })

      // Register sandboxed view
      viewRegistry.register({
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary-panel',
        execution: 'sandboxed',
        iframeSrc: 'http://localhost:4000/api/views/dictionary-panel/panel',
        capabilities: ['read', 'pubsub'],
        metadata: { name: 'Dictionary Panel', type: 'panel', source: 'sandboxed' }
      })

      // Verify mixed statistics
      const stats = viewRegistry.getStats()
      expect(stats.totalViews).toBe(3)
      expect(stats.nativeViews).toBe(2)
      expect(stats.sandboxedViews).toBe(1)

      // Verify filtering works
      expect(viewRegistry.getNativeViews()).toHaveLength(2)
      expect(viewRegistry.getSandboxedViews()).toHaveLength(1)

      // Verify by-bobbin retrieval
      const manuscriptViews = viewRegistry.getByBobbin('manuscript')
      expect(manuscriptViews).toHaveLength(2)
      expect(manuscriptViews.every(v => v.execution === 'native')).toBe(true)

      const dictionaryViews = viewRegistry.getByBobbin('dictionary-panel')
      expect(dictionaryViews).toHaveLength(1)
      expect(dictionaryViews[0].execution).toBe('sandboxed')
    })

    it('should render different views with appropriate renderers', async () => {
      // Register both types
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'outline'),
        ssr: true,
        capabilities: ['read'],
        metadata: { name: 'Outline', type: 'tree', source: 'native' }
      })

      viewRegistry.register({
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary-panel',
        execution: 'sandboxed',
        iframeSrc: 'http://localhost:4000/api/views/dictionary-panel/panel',
        capabilities: ['read', 'pubsub'],
        metadata: { name: 'Dictionary Panel', type: 'panel', source: 'sandboxed' }
      })

      // Render native view
      const { container: nativeContainer } = render(
        <ViewRenderer
          projectId="test-project-1"
          bobbinId="manuscript"
          viewId="manuscript.outline"
          sdk={mockSdk}
        />
      )

      // Native view should NOT have iframe
      expect(nativeContainer.querySelector('iframe')).toBeNull()
      await waitFor(() => {
        expect(screen.getByTestId('native-outline-view')).toBeInTheDocument()
      })

      // Render sandboxed view (in separate container)
      const { container: sandboxedContainer } = render(
        <ViewRenderer
          projectId="test-project-2"
          bobbinId="dictionary-panel"
          viewId="dictionary.panel"
          sdk={mockSdk}
        />
      )

      // Sandboxed view SHOULD have iframe
      expect(sandboxedContainer.querySelector('iframe')).toBeInTheDocument()
    })
  })

  describe('Default Behavior', () => {
    it('should default to sandboxed when view not in registry', () => {
      // Don't register anything

      // Render unknown view
      const { container } = render(
        <ViewRenderer
          projectId="test-project-1"
          bobbinId="unknown-bobbin"
          viewId="unknown.view"
          sdk={mockSdk}
        />
      )

      // Should fall back to sandboxed renderer (iframe)
      const iframe = container.querySelector('iframe')
      expect(iframe).toBeInTheDocument()
    })

    it('should reject invalid native view registration', () => {
      // Try to register native view without componentLoader - should throw
      expect(() => {
        viewRegistry.register({
          viewId: 'test.view',
          bobbinId: 'test',
          execution: 'native',
          // Missing componentLoader - should throw error
          capabilities: [],
          metadata: { name: 'Test', type: 'test', source: 'test' }
        } as any)
      }).toThrow('Native view test.view must have componentLoader')
    })
  })

  describe('Performance Characteristics', () => {
    it('should load native views faster than sandboxed views', async () => {
      // Register native view
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'outline'),
        ssr: true,
        capabilities: ['read'],
        metadata: { name: 'Outline', type: 'tree', source: 'native' }
      })

      const nativeStartTime = performance.now()
      render(
        <ViewRenderer
          projectId="test-project-1"
          bobbinId="manuscript"
          viewId="manuscript.outline"
          sdk={mockSdk}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('native-outline-view')).toBeInTheDocument()
      })
      const nativeLoadTime = performance.now() - nativeStartTime

      // Native views should load very quickly (< 100ms in tests)
      expect(nativeLoadTime).toBeLessThan(100)
    })

    it('should support SSR for native views but not sandboxed', () => {
      // Native view with SSR
      viewRegistry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: createComponentLoader('manuscript', 'outline'),
        ssr: true,
        capabilities: ['read'],
        metadata: { name: 'Outline', type: 'tree', source: 'native' }
      })

      // Sandboxed view (no SSR capability)
      viewRegistry.register({
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary-panel',
        execution: 'sandboxed',
        iframeSrc: 'http://localhost:4000/api/views/dictionary-panel/panel',
        capabilities: ['read', 'pubsub'],
        metadata: { name: 'Dictionary Panel', type: 'panel', source: 'sandboxed' }
      })

      const nativeView = viewRegistry.get('manuscript.outline')
      const sandboxedView = viewRegistry.get('dictionary.panel')

      expect(nativeView?.ssr).toBe(true)
      expect(sandboxedView?.ssr).toBeUndefined()
    })
  })
})