import { clearBreadcrumbCache, resolveCrumbs } from '../breadcrumbs'
import { extensionRegistry, type RecordDeclaration } from '../extensions'
import { ENTITIES_RECORDS, MANUSCRIPT_RECORDS, NOTES_RECORDS } from './quick-open-sources.test'

const BOOK = '11111111-1111-4111-8111-111111111111'
const PART = '22222222-2222-4222-8222-222222222222'
const CH1 = '33333333-3333-4333-8333-333333333333'
const MIRA = '44444444-4444-4444-8444-444444444444'
const NOTE = '55555555-5555-4555-8555-555555555555'

const DB: Record<string, any[]> = {
  containers: [
    { id: BOOK, title: 'The Book', parent_id: null },
    { id: PART, title: 'Part One', parentId: BOOK },
  ],
  content: [{ id: CH1, title: 'Chapter 1', container_id: PART }],
  entity_type_definitions: [{ id: '77777777-7777-4777-8777-777777777777', type_id: 'characters', label: 'Characters', icon: '🧙' }],
  characters: [{ id: MIRA, name: 'Mira' }],
  notes: [{ id: NOTE, title: 'Ideas' }],
}

const sdk = {
  query: jest.fn(async ({ collection }: { collection: string }) => ({ data: DB[collection] ?? [], total: 0 })),
  get: jest.fn(async (collection: string, id: string) => {
    const row = (DB[collection] ?? []).find(r => r.id === id)
    if (!row) throw new Error('not found')
    return row
  }),
}

const DECLARATIONS: RecordDeclaration[] = [
  { bobbinId: 'manuscript', records: MANUSCRIPT_RECORDS, quickOpen: { label: 'Manuscript', icon: 'document' } },
  { bobbinId: 'entities', records: ENTITIES_RECORDS, quickOpen: { label: 'Entities', icon: 'person' } },
  { bobbinId: 'notes', records: NOTES_RECORDS, quickOpen: { label: 'Notes', icon: 'note' } },
]

const MANUSCRIPT_HOME = { entityType: 'container', entityId: 'ROOT', metadata: { type: 'root', view: 'outline' } }
const ENTITIES_HOME = { entityType: 'entity_type_definitions', entityId: 'publishing', metadata: { view: 'publishing' } }

const project = (bobbinId: string, home: object) => ({ id: 'ROOT', label: 'My Project', navDetail: { bobbinId, ...home } })
const resolve = (nav: { entityType: string; entityId: string; bobbinId: string; metadata?: Record<string, any> }) =>
  resolveCrumbs(nav, sdk as any, 'p1', 'My Project', DECLARATIONS)

describe('resolveCrumbs', () => {
  beforeEach(() => {
    clearBreadcrumbCache()
    sdk.get.mockClear()
    sdk.query.mockClear()
    extensionRegistry.registerExtension('manuscript', { slot: 'shell.leftPanel', type: 'panel', id: 'manuscript-navigation', title: 'Manuscript', priority: 100, home: MANUSCRIPT_HOME })
    extensionRegistry.registerExtension('entities', { slot: 'shell.leftPanel', type: 'panel', id: 'entities-navigation', title: 'Entities', home: ENTITIES_HOME })
    extensionRegistry.registerExtension('notes', { slot: 'shell.leftPanel', type: 'panel', id: 'notes-navigation', title: 'Notes' })
  })
  afterEach(() => {
    for (const id of ['manuscript', 'entities', 'notes']) extensionRegistry.unregisterBobbin(id)
  })

  it('walks a container up through its parents, leaf inert', async () => {
    const crumbs = await resolve({ entityType: 'container', entityId: PART, bobbinId: 'manuscript' })
    expect(crumbs).toEqual([
      project('manuscript', MANUSCRIPT_HOME),
      { id: BOOK, label: 'The Book', navDetail: { entityType: 'container', entityId: BOOK, bobbinId: 'manuscript', metadata: { type: 'container' } } },
      { id: PART, label: 'Part One' },
    ])
  })

  it('resolves a chapter through its container chain', async () => {
    const crumbs = await resolve({ entityType: 'content', entityId: CH1, bobbinId: 'manuscript', metadata: { type: 'content' } })
    expect(crumbs.map(c => c.label)).toEqual(['My Project', 'The Book', 'Part One', 'Chapter 1'])
    expect(crumbs[2]!.navDetail).toEqual({ entityType: 'container', entityId: PART, bobbinId: 'manuscript', metadata: { type: 'container' } })
    expect(crumbs[3]!.navDetail).toBeUndefined()
  })

  it('falls back to the navigate event parentId when the record fetch fails', async () => {
    const missing = '66666666-6666-4666-8666-666666666666'
    const crumbs = await resolve({ entityType: 'content', entityId: missing, bobbinId: 'manuscript', metadata: { parentId: BOOK } })
    expect(crumbs.map(c => c.label)).toEqual(['My Project', 'The Book', 'Untitled'])
  })

  it('builds the entity crumbs from a discovered type, with the list view as the group crumb', async () => {
    const crumbs = await resolve({ entityType: 'characters', entityId: MIRA, bobbinId: 'entities', metadata: { view: 'entity-editor' } })
    expect(crumbs).toEqual([
      project('entities', ENTITIES_HOME),
      {
        id: 'characters', label: 'Characters',
        navDetail: {
          entityType: 'characters', entityId: 'list', bobbinId: 'entities',
          metadata: { view: 'entity-list', typeId: 'characters', typeLabel: 'Characters', typeIcon: '🧙' },
        },
      },
      { id: MIRA, label: 'Mira' },
    ])
  })

  it('renders a label-only group as an inert crumb, and borrows the top-priority home when the bobbin has none', async () => {
    const crumbs = await resolve({ entityType: 'notes', entityId: NOTE, bobbinId: 'notes' })
    expect(crumbs).toEqual([
      project('manuscript', MANUSCRIPT_HOME),
      { id: 'notes', label: 'Notes' },
      { id: NOTE, label: 'Ideas' },
    ])
  })

  it('gives sentinel targets and undeclared bobbins just the project crumb', async () => {
    expect(await resolve({ entityType: 'container', entityId: 'ROOT', bobbinId: 'manuscript' })).toEqual([project('manuscript', MANUSCRIPT_HOME)])
    expect(await resolve({ entityType: 'goals', entityId: MIRA, bobbinId: 'goals' })).toEqual([project('manuscript', MANUSCRIPT_HOME)])
    expect(await resolve({ entityType: 'unknown', entityId: MIRA, bobbinId: 'entities' })).toEqual([project('entities', ENTITIES_HOME)])
  })

  it('returns nothing without a target or sdk, and an inert project crumb when no home is registered', async () => {
    expect(await resolveCrumbs(null, sdk as any, 'p1', 'X', DECLARATIONS)).toEqual([])
    for (const id of ['manuscript', 'entities', 'notes']) extensionRegistry.unregisterBobbin(id)
    expect(await resolve({ entityType: 'notes', entityId: 'pinboard', bobbinId: 'notes' })).toEqual([{ id: 'ROOT', label: 'My Project' }])
  })

  it('caches whole collections so the ancestor walk is one query per collection', async () => {
    await resolve({ entityType: 'content', entityId: CH1, bobbinId: 'manuscript' })
    await resolve({ entityType: 'container', entityId: PART, bobbinId: 'manuscript' })
    expect(sdk.query.mock.calls.filter(([a]) => a.collection === 'containers')).toHaveLength(1)
  })
})
