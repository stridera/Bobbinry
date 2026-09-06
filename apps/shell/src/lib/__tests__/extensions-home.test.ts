import { extensionRegistry, panelsRevealedBy, resolveBobbinHome, resolveSearchNavigation, revealEventNames, searchDeclarations } from '../extensions'

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

describe('panelsRevealedBy / revealEventNames', () => {
  afterEach(() => extensionRegistry.unregisterBobbin('peek'))

  it('finds the panels that asked to be surfaced on an event', () => {
    extensionRegistry.registerExtension('peek', {
      slot: 'shell.rightPanel', type: 'panel', id: 'peek-panel', title: 'Peek',
      revealOn: ['bobbinry:thing-selected', 'bobbinry:thing-hovered'],
    })
    expect(panelsRevealedBy('bobbinry:thing-selected').map(e => e.id)).toEqual(['peek.peek-panel'])
    expect(panelsRevealedBy('bobbinry:nothing')).toEqual([])
    expect(revealEventNames()).toEqual(expect.arrayContaining(['bobbinry:thing-selected', 'bobbinry:thing-hovered']))
  })
})

describe('resolveSearchNavigation', () => {
  afterEach(() => { extensionRegistry.unregisterBobbin('prose'); extensionRegistry.unregisterBobbin('codex') })

  it('prefers an exact collection rule and falls back to a wildcard with $collection', () => {
    extensionRegistry.registerExtension('prose', {
      slot: 'shell.leftPanel', type: 'panel', id: 'prose-nav', title: 'Prose',
      search: { kind: 'text', collections: [{ name: 'content', entityType: 'content' }, { name: 'containers', entityType: 'container' }] },
    })
    extensionRegistry.registerExtension('codex', {
      slot: 'shell.leftPanel', type: 'panel', id: 'codex-nav', title: 'Codex',
      search: { kind: 'records', collections: [{ name: '*', entityType: '$collection', metadata: { view: 'entity-editor' } }] },
    })
    expect(resolveSearchNavigation('containers')).toEqual({ bobbinId: 'prose', entityType: 'container', entityId: '' })
    expect(resolveSearchNavigation('characters')).toEqual({ bobbinId: 'codex', entityType: 'characters', entityId: '', metadata: { view: 'entity-editor' } })
    expect(searchDeclarations().map(d => d.bobbinId).sort()).toEqual(['codex', 'prose'])
  })

  it('returns null when nothing claims the collection', () => {
    expect(resolveSearchNavigation('unknown')).toBeNull()
  })
})
