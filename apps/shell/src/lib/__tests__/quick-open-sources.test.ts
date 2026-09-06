import { buildQuickOpenItems } from '../quick-open-sources'
import type { RecordSource } from '@bobbinry/types'

// Mirrors what bobbins/{manuscript,entities,notes}/manifest.yaml declare. Kept
// inline so the test pins the shape the palette relied on before the sources
// moved into manifests.
export const MANUSCRIPT_RECORDS: RecordSource[] = [
  { collection: 'containers', entityType: 'container', parentField: 'parent_id', metadata: { type: 'container' } },
  { collection: 'content', entityType: 'content', parentField: 'container_id', parentCollection: 'containers', metadata: { type: 'content' } },
]
export const ENTITIES_RECORDS: RecordSource[] = [
  { discover: { collection: 'entity_type_definitions', idField: 'type_id', labelField: 'label', iconField: 'icon' }, titleField: 'name', metadata: { view: 'entity-editor' },
    group: { entityId: 'list', metadata: { view: 'entity-list', typeId: '$collection', typeLabel: '$label', typeIcon: '$icon' } } },
]
export const NOTES_RECORDS: RecordSource[] = [
  { collection: 'notes', entityType: 'notes', metadata: { view: 'note-editor' }, group: { label: 'Notes' } },
]

const DB: Record<string, any[]> = {
  containers: [
    { id: 'book', title: 'The Book', parent_id: null },
    { id: 'part', title: 'Part One', parentId: 'book' },
  ],
  content: [
    { id: 'ch1', title: 'Chapter 1', container_id: 'part' },
    { id: 'loose', title: '', containerId: null },
  ],
  entity_type_definitions: [
    { type_id: 'character', label: 'Characters' },
    { type_id: 'place' },
    { label: 'no id, skipped' },
  ],
  character: [{ id: 'c1', name: 'Mira' }, { id: 'c2', title: 'Titled only' }],
  place: [{ id: 'p1', name: 'Harbor' }],
  notes: [{ id: 'n1', title: 'Ideas' }],
}

const entityApi = {
  query: jest.fn(async ({ collection }: { collection: string }) => {
    if (collection === 'broken') throw new Error('boom')
    return { data: DB[collection] ?? [], total: 0 }
  }),
}

describe('buildQuickOpenItems', () => {
  it('reproduces the palette items the shell used to hardcode for the core bobbins', async () => {
    const { items, groups } = await buildQuickOpenItems(entityApi as any, [
      { bobbinId: 'manuscript', records: MANUSCRIPT_RECORDS, quickOpen: { label: 'Manuscript', icon: 'document' } },
      { bobbinId: 'entities', records: ENTITIES_RECORDS, quickOpen: { label: 'Entities', icon: 'person' } },
      { bobbinId: 'notes', records: NOTES_RECORDS, quickOpen: { label: 'Notes', icon: 'note' } },
    ])

    expect(groups).toEqual([
      { kind: 'manuscript', label: 'Manuscript', icon: 'document' },
      { kind: 'entities', label: 'Entities', icon: 'person' },
      { kind: 'notes', label: 'Notes', icon: 'note' },
    ])

    expect(items).toEqual([
      { id: 'book', title: 'The Book', kind: 'manuscript', subtitle: '',
        navDetail: { entityType: 'container', entityId: 'book', bobbinId: 'manuscript', metadata: { type: 'container', parentId: null } } },
      { id: 'part', title: 'Part One', kind: 'manuscript', subtitle: 'The Book',
        navDetail: { entityType: 'container', entityId: 'part', bobbinId: 'manuscript', metadata: { type: 'container', parentId: 'book' } } },
      { id: 'ch1', title: 'Chapter 1', kind: 'manuscript', subtitle: 'The Book › Part One',
        navDetail: { entityType: 'content', entityId: 'ch1', bobbinId: 'manuscript', metadata: { type: 'content', parentId: 'part' } } },
      { id: 'loose', title: 'Untitled', kind: 'manuscript', subtitle: '',
        navDetail: { entityType: 'content', entityId: 'loose', bobbinId: 'manuscript', metadata: { type: 'content', parentId: null } } },
      { id: 'c1', title: 'Mira', kind: 'entities', subtitle: 'Characters',
        navDetail: { entityType: 'character', entityId: 'c1', bobbinId: 'entities', metadata: { view: 'entity-editor', typeId: 'character', typeLabel: 'Characters' } } },
      { id: 'c2', title: 'Titled only', kind: 'entities', subtitle: 'Characters',
        navDetail: { entityType: 'character', entityId: 'c2', bobbinId: 'entities', metadata: { view: 'entity-editor', typeId: 'character', typeLabel: 'Characters' } } },
      { id: 'p1', title: 'Harbor', kind: 'entities', subtitle: 'place',
        navDetail: { entityType: 'place', entityId: 'p1', bobbinId: 'entities', metadata: { view: 'entity-editor', typeId: 'place', typeLabel: 'place' } } },
      { id: 'n1', title: 'Ideas', kind: 'notes', subtitle: 'Notes',
        navDetail: { entityType: 'notes', entityId: 'n1', bobbinId: 'notes', metadata: { view: 'note-editor' } } },
    ])
  })

  it('skips failing collections and uses the collection name as entityType by default', async () => {
    const { items } = await buildQuickOpenItems(entityApi as any, [
      { bobbinId: 'third', records: [{ collection: 'broken' }, { collection: 'notes' }], quickOpen: { label: 'Third' } },
    ])
    expect(items).toEqual([
      { id: 'n1', title: 'Ideas', kind: 'third', subtitle: 'Third',
        navDetail: { entityType: 'notes', entityId: 'n1', bobbinId: 'third', metadata: {} } },
    ])
  })

  it('resolves the path across the same collection when parent ids chain', async () => {
    const { items } = await buildQuickOpenItems(entityApi as any, [
      { bobbinId: 'm', records: [{ collection: 'containers', parentField: 'parent_id' }], quickOpen: { label: 'M' } },
    ])
    expect(items.map(i => [i.title, i.subtitle])).toEqual([['The Book', ''], ['Part One', 'The Book']])
  })
})
