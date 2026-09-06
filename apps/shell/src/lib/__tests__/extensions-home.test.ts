import { extensionRegistry, resolveBobbinHome } from '../extensions'

describe('resolveBobbinHome', () => {
  afterEach(() => {
    extensionRegistry.unregisterBobbin('demo')
    extensionRegistry.unregisterBobbin('plain')
  })

  it('returns the leftPanel contribution home with the bobbin id filled in', () => {
    extensionRegistry.registerExtension('demo', {
      slot: 'shell.leftPanel', type: 'panel', id: 'demo-nav', title: 'Demo',
      home: { entityType: 'widgets', entityId: 'board', metadata: { view: 'board' } },
    })
    expect(resolveBobbinHome('demo')).toEqual({
      bobbinId: 'demo', entityType: 'widgets', entityId: 'board', metadata: { view: 'board' },
    })
  })

  it('ignores homes declared on other slots and returns null when none is declared', () => {
    extensionRegistry.registerExtension('plain', {
      slot: 'shell.rightPanel', type: 'panel', id: 'plain-side', title: 'Side',
      home: { entityType: 'x', entityId: 'y' },
    })
    expect(resolveBobbinHome('plain')).toBeNull()
    expect(resolveBobbinHome('never-registered')).toBeNull()
  })
})
