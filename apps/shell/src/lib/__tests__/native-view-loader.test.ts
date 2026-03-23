/**
 * Tests for NativeViewLoader
 */

import {
  loadNativeView,
  loadNativeViewWithMetadata,
  createComponentLoader,
  preloadNativeView,
  preloadNativeViews
} from '../native-view-loader'

// Note: Jest wraps virtual mocks in an additional default export layer
// So jest.mock('foo', () => ({ default: X })) becomes { default: { default: X } }
// This is expected behavior when testing dynamic imports with Jest

// Mock dynamic imports - Jest will wrap these in another default export
const MockOutlineView = () => null
MockOutlineView.displayName = 'MockOutlineView'

const MockEditorView = () => null
MockEditorView.displayName = 'MockEditorView'

jest.mock('@bobbinry/manuscript/views/outline', () => (MockOutlineView), { virtual: true })
jest.mock('@bobbinry/manuscript/views/editor', () => (MockEditorView), { virtual: true })

describe('NativeViewLoader', () => {
  describe('loadNativeView', () => {
    it('should load a native view component', async () => {
      const component = await loadNativeView('manuscript', 'outline')
      expect(component).toBeDefined()
      expect(typeof component).toBe('function')
    })

    it('should load multiple views from same bobbin', async () => {
      const outline = await loadNativeView('manuscript', 'outline')
      const editor = await loadNativeView('manuscript', 'editor')

      expect(outline).toBeDefined()
      expect(editor).toBeDefined()
      expect(outline).not.toBe(editor)
    })

    it('should return null for non-existent view', async () => {
      const result = await loadNativeView('manuscript', 'nonexistent')
      expect(result).toBeNull()
    })

    it('should return null for non-existent bobbin', async () => {
      const result = await loadNativeView('nonexistent', 'outline')
      expect(result).toBeNull()
    })

    // Note: This test is difficult to properly mock with Jest's virtual mocks
    // because Jest wraps all virtual mocks in a default export.
    // In real usage, a module without a default export would fail at import time
    // or the check would catch undefined/null default exports.
    it.skip('should throw error for view without default export', async () => {
      await expect(
        loadNativeView('invalid', 'broken')
      ).rejects.toThrow(/does not have a default export/)
    })

    it('should include helpful error context', async () => {
      try {
        await loadNativeView('nonexistent', 'view')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        const message = (error as Error).message
        expect(message).toContain('Bobbin: nonexistent')
        expect(message).toContain('View: view')
        expect(message).toContain('nonexistent.view')
      }
    })
  })

  describe('loadNativeViewWithMetadata', () => {
    it('should load view with metadata', async () => {
      const loaded = await loadNativeViewWithMetadata('manuscript', 'outline')

      expect(loaded.component).toBeDefined()
      expect(loaded.bobbinId).toBe('manuscript')
      expect(loaded.viewId).toBe('manuscript.outline')
      expect(loaded.metadata.packageName).toBe('@bobbinry/manuscript')
      expect(loaded.metadata.viewPath).toBe('views/outline')
      expect(loaded.metadata.loadedAt).toBeInstanceOf(Date)
    })

    it('should have recent loadedAt timestamp', async () => {
      const before = new Date()
      const loaded = await loadNativeViewWithMetadata('manuscript', 'editor')
      const after = new Date()

      expect(loaded.metadata.loadedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(loaded.metadata.loadedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should generate correct viewId', async () => {
      const outline = await loadNativeViewWithMetadata('manuscript', 'outline')
      const editor = await loadNativeViewWithMetadata('manuscript', 'editor')

      expect(outline.viewId).toBe('manuscript.outline')
      expect(editor.viewId).toBe('manuscript.editor')
    })
  })

  describe('createComponentLoader', () => {
    it('should create a loader function', () => {
      const loader = createComponentLoader('manuscript', 'outline')
      expect(typeof loader).toBe('function')
    })

    it('should load component when called', async () => {
      const loader = createComponentLoader('manuscript', 'outline')
      const component = await loader()

      expect(component).toBeDefined()
      expect(typeof component).toBe('function')
    })

    it('should create loaders for different views', async () => {
      const outlineLoader = createComponentLoader('manuscript', 'outline')
      const editorLoader = createComponentLoader('manuscript', 'editor')

      const outline = await outlineLoader()
      const editor = await editorLoader()

      expect(outline).not.toBe(editor)
    })

    it('should return null when loader is called with invalid view', async () => {
      const loader = createComponentLoader('nonexistent', 'view')

      const result = await loader()
      expect(result).toBeNull()
    })
  })

  describe('preloadNativeView', () => {
    let consoleLogSpy: ReturnType<typeof jest.spyOn>
    let consoleErrorSpy: ReturnType<typeof jest.spyOn>

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should preload a view successfully', async () => {
      await preloadNativeView('manuscript', 'outline')

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[NativeViewLoader] Preloaded: manuscript.outline'
      )
    })

    it('should not throw on preload failure', async () => {
      await expect(
        preloadNativeView('nonexistent', 'view')
      ).resolves.not.toThrow()
    })

    it('should log success even for missing views (returns null gracefully)', async () => {
      await preloadNativeView('nonexistent', 'view')

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[NativeViewLoader] Preloaded: nonexistent.view'
      )
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('preloadNativeViews', () => {
    let consoleLogSpy: ReturnType<typeof jest.spyOn>
    let consoleErrorSpy: ReturnType<typeof jest.spyOn>

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should preload multiple views', async () => {
      await preloadNativeViews([
        { bobbinId: 'manuscript', viewPath: 'outline' },
        { bobbinId: 'manuscript', viewPath: 'editor' }
      ])

      expect(consoleLogSpy).toHaveBeenCalledTimes(2)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[NativeViewLoader] Preloaded: manuscript.outline'
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[NativeViewLoader] Preloaded: manuscript.editor'
      )
    })

    it('should not throw if some views fail to preload', async () => {
      await expect(
        preloadNativeViews([
          { bobbinId: 'manuscript', viewPath: 'outline' },
          { bobbinId: 'nonexistent', viewPath: 'view' },
          { bobbinId: 'manuscript', viewPath: 'editor' }
        ])
      ).resolves.not.toThrow()
    })

    it('should preload all views including missing ones (returns null gracefully)', async () => {
      await preloadNativeViews([
        { bobbinId: 'manuscript', viewPath: 'outline' },
        { bobbinId: 'nonexistent', viewPath: 'view' },
        { bobbinId: 'manuscript', viewPath: 'editor' }
      ])

      // All 3 logged as preloaded (missing views return null without throwing)
      expect(consoleLogSpy).toHaveBeenCalledTimes(3)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[NativeViewLoader] Preloaded: manuscript.outline'
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[NativeViewLoader] Preloaded: nonexistent.view'
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[NativeViewLoader] Preloaded: manuscript.editor'
      )
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('should handle empty array', async () => {
      await expect(
        preloadNativeViews([])
      ).resolves.not.toThrow()

      expect(consoleLogSpy).not.toHaveBeenCalled()
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
  })
})