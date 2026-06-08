export const CONTENT_TYPES = [
  'chapter',
  'scene',
  'prologue',
  'epilogue',
  'interlude',
  'outline',
  'supporting_doc',
] as const

export type ContentType = (typeof CONTENT_TYPES)[number]

export const NARRATIVE_TYPES: ReadonlySet<ContentType> = new Set<ContentType>([
  'chapter',
  'scene',
  'prologue',
  'epilogue',
  'interlude',
])

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  chapter: 'Chapter',
  scene: 'Scene',
  prologue: 'Prologue',
  epilogue: 'Epilogue',
  interlude: 'Interlude',
  outline: 'Outline',
  supporting_doc: 'Supporting Doc',
}

export type ContentTypeGroup = 'manuscript' | 'outlines' | 'reference'

export const CONTENT_TYPE_GROUPS: Record<ContentType, ContentTypeGroup> = {
  chapter: 'manuscript',
  scene: 'manuscript',
  prologue: 'manuscript',
  epilogue: 'manuscript',
  interlude: 'manuscript',
  outline: 'outlines',
  supporting_doc: 'reference',
}

export function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && (CONTENT_TYPES as readonly string[]).includes(value)
}

export function countsTowardWordCount(t: ContentType | null | undefined): boolean {
  return !!t && NARRATIVE_TYPES.has(t)
}
