import { createViewRegistry, ViewRegistry, ViewRegistryEntry } from '../view-registry'

describe('ViewRegistry', () => {
  let registry: ViewRegistry

  beforeEach(() => {
    registry = createViewRegistry()
  })

  afterEach(() => {
    registry.clear()
  })

  describe('Registration', () => {
    it('should register a native view', () => {
      const entry: ViewRegistryEntry = {
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        ssr: true,
        capabilities: ['offline', 'pubsub.produce'],
        metadata: {
          name: 'Editor',
          type: 'editor',
          source: 'scenes'
        }
      }

      registry.register(entry)

      expect(registry.has('manuscript.editor')).toBe(true)
      expect(registry.get('manuscript.editor')).toEqual(entry)
    })

    it('should register a sandboxed view', () => {
      const entry: ViewRegistryEntry = {
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary',
        execution: 'sandboxed',
        iframeSrc: '/api/views/dictionary/panel',
        capabilities: ['pubsub.consume'],
        metadata: {
          name: 'Dictionary Panel',
          type: 'panel',
          source: 'words'
        }
      }

      registry.register(entry)

      expect(registry.has('dictionary.panel')).toBe(true)
      expect(registry.get('dictionary.panel')).toEqual(entry)
    })

    it('should throw error for native view without componentLoader', () => {
      const entry: ViewRegistryEntry = {
        viewId: 'invalid.view',
        bobbinId: 'invalid',
        execution: 'native',
        // Missing componentLoader
        capabilities: [],
        metadata: {
          name: 'Invalid',
          type: 'editor',
          source: 'items'
        }
      } as any

      expect(() => registry.register(entry)).toThrow('must have componentLoader')
    })

    it('should throw error for sandboxed view without iframeSrc', () => {
      const entry: ViewRegistryEntry = {
        viewId: 'invalid.view',
        bobbinId: 'invalid',
        execution: 'sandboxed',
        // Missing iframeSrc
        capabilities: [],
        metadata: {
          name: 'Invalid',
          type: 'panel',
          source: 'items'
        }
      } as any

      expect(() => registry.register(entry)).toThrow('must have iframeSrc')
    })

    it('should warn when overwriting existing view', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

      const entry1: ViewRegistryEntry = {
        viewId: 'test.view',
        bobbinId: 'test',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Test', type: 'editor', source: 'items' }
      }

      const entry2: ViewRegistryEntry = {
        ...entry1,
        metadata: { name: 'Test Updated', type: 'editor', source: 'items' }
      }

      registry.register(entry1)
      registry.register(entry2)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      )

      consoleWarnSpy.mockRestore()
    })
  })

  describe('Retrieval', () => {
    beforeEach(() => {
      // Register test views
      registry.register({
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Editor', type: 'editor', source: 'scenes' }
      })

      registry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Outline', type: 'tree', source: 'books' }
      })

      registry.register({
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary',
        execution: 'sandboxed',
        iframeSrc: '/api/views/dictionary/panel',
        capabilities: [],
        metadata: { name: 'Panel', type: 'panel', source: 'words' }
      })
    })

    it('should get view by ID', () => {
      const view = registry.get('manuscript.editor')
      expect(view).toBeDefined()
      expect(view?.viewId).toBe('manuscript.editor')
    })

    it('should return undefined for non-existent view', () => {
      const view = registry.get('nonexistent.view')
      expect(view).toBeUndefined()
    })

    it('should get all views for a bobbin', () => {
      const views = registry.getByBobbin('manuscript')
      expect(views).toHaveLength(2)
      expect(views.map(v => v.viewId)).toContain('manuscript.editor')
      expect(views.map(v => v.viewId)).toContain('manuscript.outline')
    })

    it('should return empty array for bobbin with no views', () => {
      const views = registry.getByBobbin('nonexistent')
      expect(views).toEqual([])
    })

    it('should get all views', () => {
      const views = registry.getAll()
      expect(views).toHaveLength(3)
    })

    it('should get only native views', () => {
      const nativeViews = registry.getNativeViews()
      expect(nativeViews).toHaveLength(2)
      expect(nativeViews.every(v => v.execution === 'native')).toBe(true)
    })

    it('should get only sandboxed views', () => {
      const sandboxedViews = registry.getSandboxedViews()
      expect(sandboxedViews).toHaveLength(1)
      expect(sandboxedViews.every(v => v.execution === 'sandboxed')).toBe(true)
    })
  })

  describe('Unregistration', () => {
    beforeEach(() => {
      registry.register({
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Editor', type: 'editor', source: 'scenes' }
      })

      registry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Outline', type: 'tree', source: 'books' }
      })
    })

    it('should unregister a single view', () => {
      registry.unregister('manuscript.editor')

      expect(registry.has('manuscript.editor')).toBe(false)
      expect(registry.has('manuscript.outline')).toBe(true)
    })

    it('should warn when unregistering non-existent view', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

      registry.unregister('nonexistent.view')

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      )

      consoleWarnSpy.mockRestore()
    })

    it('should unregister all views for a bobbin', () => {
      registry.unregisterBobbin('manuscript')

      expect(registry.has('manuscript.editor')).toBe(false)
      expect(registry.has('manuscript.outline')).toBe(false)
      expect(registry.getByBobbin('manuscript')).toEqual([])
    })

    it('should clean up bobbin tracking when last view removed', () => {
      registry.unregister('manuscript.editor')
      registry.unregister('manuscript.outline')

      const stats = registry.getStats()
      expect(stats.viewsByBobbin['manuscript']).toBeUndefined()
    })
  })

  describe('Statistics', () => {
    beforeEach(() => {
      registry.register({
        viewId: 'manuscript.editor',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Editor', type: 'editor', source: 'scenes' }
      })

      registry.register({
        viewId: 'manuscript.outline',
        bobbinId: 'manuscript',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Outline', type: 'tree', source: 'books' }
      })

      registry.register({
        viewId: 'dictionary.panel',
        bobbinId: 'dictionary',
        execution: 'sandboxed',
        iframeSrc: '/api/views/dictionary/panel',
        capabilities: [],
        metadata: { name: 'Panel', type: 'panel', source: 'words' }
      })
    })

    it('should return correct statistics', () => {
      const stats = registry.getStats()

      expect(stats.totalViews).toBe(3)
      expect(stats.nativeViews).toBe(2)
      expect(stats.sandboxedViews).toBe(1)
      expect(stats.viewsByBobbin).toEqual({
        manuscript: 2,
        dictionary: 1
      })
    })

    it('should update statistics after unregistering', () => {
      registry.unregister('manuscript.editor')

      const stats = registry.getStats()
      expect(stats.totalViews).toBe(2)
      expect(stats.nativeViews).toBe(1)
      expect(stats.viewsByBobbin.manuscript).toBe(1)
    })
  })

  describe('Clear', () => {
    it('should clear all views', () => {
      registry.register({
        viewId: 'test.view',
        bobbinId: 'test',
        execution: 'native',
        componentLoader: async () => ({ default: () => null } as any),
        capabilities: [],
        metadata: { name: 'Test', type: 'editor', source: 'items' }
      })

      expect(registry.getAll()).toHaveLength(1)

      registry.clear()

      expect(registry.getAll()).toHaveLength(0)
      expect(registry.getStats().totalViews).toBe(0)
    })
  })
})