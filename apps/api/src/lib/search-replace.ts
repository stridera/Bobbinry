import * as cheerio from 'cheerio'

/** Options shared by search and replace operations. */
export type SearchOptions = {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
}

/** One run of a rendered snippet: either plain context (`match: false`) or a
 * highlighted occurrence of the query (`match: true`). A display match holds
 * the highlighted middle as segments so the UI can highlight every coalesced
 * occurrence in a single row. */
export type MatchSegment = { text: string; match: boolean }

/** A match row returned to the client. Adjacent occurrences whose context
 * windows would overlap are coalesced into one row (they'd otherwise render as
 * near-identical "duplicate" entries). `indices` lists every underlying
 * 0-based occurrence index within the field so replace can target them all;
 * `id` embeds the first index and is stable across re-previews as long as the
 * surrounding field text hasn't changed. */
export type EntityMatch = {
  id: string
  entityId: string
  collection: string
  field: string
  indices: number[]
  contextBefore: string
  contextAfter: string
  segments: MatchSegment[]
}

type RawMatch = {
  index: number
  matchText: string
  contextBefore: string
  contextAfter: string
}

type FieldSpec = { field: string; kind: 'plain' | 'html' }

type Hit = { start: number; end: number; matchText: string }

/** A located occurrence in a field's context-coordinate space, tagged with its
 * 0-based occurrence index within the field (the value `replace` keys on). */
type LocatedHit = { start: number; end: number; matchText: string; idx: number }

const CONTEXT_RADIUS = 40
const MAX_MATCHES_PER_FIELD = 500
/** Coalesce two occurrences into one display row when the gap between them is
 * at most this many chars — i.e. their ±CONTEXT_RADIUS windows would overlap
 * and the rows would look like duplicates. */
const MERGE_GAP = CONTEXT_RADIUS

const CONTENT_FIELDS: FieldSpec[] = [
  { field: 'title', kind: 'plain' },
  { field: 'synopsis', kind: 'plain' },
  { field: 'notes', kind: 'plain' },
  { field: 'body', kind: 'html' },
]

const CONTAINER_FIELDS: FieldSpec[] = [
  { field: 'title', kind: 'plain' },
]

const NON_TEXT_KEYS = new Set([
  '_meta', '_variants', 'id',
  'created_at', 'updated_at',
  'word_count', 'order',
  'container_id', 'parent_id', 'contentType', 'content_type',
  'status', 'color', 'icon', 'avatar', 'cover_image',
  'tags',
])

/** Bobbins whose entity rows are eligible for search in v1: manuscript chapters
 * and entity-type rows. Notes / timeline / relationships / goals are excluded. */
export const SEARCHABLE_BOBBIN_IDS = ['manuscript', 'entities'] as const

/** Collections to always skip even within a searchable bobbin (e.g. type
 * definitions are config, not user-edited content). */
export const SKIPPED_COLLECTIONS = new Set(['entity_type_definitions'])

export function escapeRegExp(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

export function buildSearchRegex(opts: SearchOptions): RegExp {
  let source = escapeRegExp(opts.query)
  if (opts.wholeWord) source = `\\b${source}\\b`
  return new RegExp(source, opts.caseSensitive ? 'g' : 'gi')
}

function findHits(text: string, opts: SearchOptions): Hit[] {
  if (!text || !opts.query) return []
  const re = buildSearchRegex(opts)
  const hits: Hit[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null && hits.length < MAX_MATCHES_PER_FIELD) {
    hits.push({ start: m.index, end: m.index + m[0].length, matchText: m[0] })
    if (m[0].length === 0) re.lastIndex++
  }
  return hits
}

/** Resolve a field's searchable text plus its occurrences, in a single
 * coordinate space. For plain text that space is the text itself; for HTML it
 * is the concatenation of all text nodes (see `locateHtml`). Both feed the
 * shared context/merge logic. */
function locatePlain(text: string, opts: SearchOptions): { text: string; hits: LocatedHit[] } {
  const hits = findHits(text, opts).map((h, i) => ({ ...h, idx: i }))
  return { text, hits }
}

function rawFromLocated(text: string, hits: LocatedHit[]): RawMatch[] {
  return hits.map(h => ({
    index: h.idx,
    matchText: h.matchText,
    contextBefore: text.slice(Math.max(0, h.start - CONTEXT_RADIUS), h.start),
    contextAfter: text.slice(h.end, Math.min(text.length, h.end + CONTEXT_RADIUS)),
  }))
}

export function findInPlainText(text: string, opts: SearchOptions): RawMatch[] {
  const { text: src, hits } = locatePlain(text, opts)
  return rawFromLocated(src, hits)
}

export function replaceInPlainText(
  text: string,
  opts: SearchOptions,
  replacement: string,
  selectedIndices: Set<number>,
): string {
  if (!text || !opts.query) return text
  const hits = findHits(text, opts)
  if (hits.length === 0) return text
  let out = ''
  let lastEnd = 0
  hits.forEach((h, i) => {
    if (selectedIndices.has(i)) {
      out += text.slice(lastEnd, h.start) + replacement
    } else {
      out += text.slice(lastEnd, h.end)
    }
    lastEnd = h.end
  })
  out += text.slice(lastEnd)
  return out
}

const SENTINEL_OPEN = '<div data-bobbinry-sr="1">'
const SENTINEL_ATTR = '[data-bobbinry-sr="1"]'

function loadFragment(html: string) {
  const $ = cheerio.load(`${SENTINEL_OPEN}${html}</div>`, null, false)
  const $root = $(SENTINEL_ATTR).first()
  return { $, $root }
}

type TextNode = { type: 'text'; data: string }

/** Walk text nodes in document order. Matches that straddle text-node
 * boundaries (e.g. mid-word formatting like `<em>lan</em>`) are NOT surfaced
 * — only matches wholly within one text node are considered. */
function walkTextNodes(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<any>,
): TextNode[] {
  const nodes: TextNode[] = []
  const walk = (parent: cheerio.Cheerio<any>) => {
    parent.contents().each((_i, node) => {
      const n = node as unknown as { type: string; data?: string }
      if (n.type === 'text') {
        nodes.push(node as unknown as TextNode)
      } else if (n.type === 'tag') {
        walk($(node))
      }
    })
  }
  walk($root)
  return nodes
}

/** Locate matches within HTML by walking text nodes (matches that straddle a
 * text-node boundary are intentionally skipped). Occurrences are numbered in
 * document order; positions are mapped into the concatenated text-node string
 * so context and merging are computed against readable prose. */
function locateHtml(html: string, opts: SearchOptions): { text: string; hits: LocatedHit[] } {
  if (!html || !opts.query) return { text: '', hits: [] }
  const { $, $root } = loadFragment(html)
  const textNodes = walkTextNodes($, $root)
  if (textNodes.length === 0) return { text: '', hits: [] }

  let concat = ''
  const nodeRanges: Array<{ start: number; end: number }> = []
  for (const node of textNodes) {
    const data = node.data ?? ''
    const start = concat.length
    concat += data
    nodeRanges.push({ start, end: concat.length })
  }

  const hits: LocatedHit[] = []
  let globalIndex = 0
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i]!
    const data = node.data ?? ''
    if (!data) continue
    const range = nodeRanges[i]!
    for (const h of findHits(data, opts)) {
      hits.push({
        start: range.start + h.start,
        end: range.start + h.end,
        matchText: h.matchText,
        idx: globalIndex++,
      })
      if (hits.length >= MAX_MATCHES_PER_FIELD) return { text: concat, hits }
    }
  }
  return { text: concat, hits }
}

export function findInHtml(html: string, opts: SearchOptions): RawMatch[] {
  const { text, hits } = locateHtml(html, opts)
  return rawFromLocated(text, hits)
}

/** Coalesce located hits whose context windows overlap into display rows, each
 * carrying the highlighted middle as segments and every underlying occurrence
 * index for replace. Hits arrive in occurrence order. */
function buildDisplayMatches(
  entityId: string,
  collection: string,
  field: string,
  text: string,
  hits: LocatedHit[],
): EntityMatch[] {
  if (hits.length === 0) return []

  const groups: LocatedHit[][] = []
  for (const h of hits) {
    const current = groups[groups.length - 1]
    const prev = current?.[current.length - 1]
    if (current && prev && h.start - prev.end <= MERGE_GAP) current.push(h)
    else groups.push([h])
  }

  return groups.map(group => {
    const first = group[0]!
    const last = group[group.length - 1]!
    const segments: MatchSegment[] = []
    let cursor = first.start
    for (const h of group) {
      if (h.start > cursor) segments.push({ text: text.slice(cursor, h.start), match: false })
      segments.push({ text: text.slice(h.start, h.end), match: true })
      cursor = h.end
    }
    const indices = group.map(h => h.idx)
    return {
      id: `${entityId}:${field}:${indices[0]}`,
      entityId,
      collection,
      field,
      indices,
      contextBefore: text.slice(Math.max(0, first.start - CONTEXT_RADIUS), first.start),
      contextAfter: text.slice(last.end, Math.min(text.length, last.end + CONTEXT_RADIUS)),
      segments,
    }
  })
}

export function replaceInHtml(
  html: string,
  opts: SearchOptions,
  replacement: string,
  selectedIndices: Set<number>,
): string {
  if (!html || !opts.query) return html
  const { $, $root } = loadFragment(html)
  const textNodes = walkTextNodes($, $root)
  if (textNodes.length === 0) return html

  let globalIndex = 0
  for (const node of textNodes) {
    const data = node.data ?? ''
    if (!data) {
      continue
    }
    const hits = findHits(data, opts)
    if (hits.length === 0) continue
    let out = ''
    let lastEnd = 0
    for (const h of hits) {
      if (selectedIndices.has(globalIndex)) {
        out += data.slice(lastEnd, h.start) + replacement
      } else {
        out += data.slice(lastEnd, h.end)
      }
      lastEnd = h.end
      globalIndex++
    }
    out += data.slice(lastEnd)
    node.data = out
  }

  return $root.html() ?? html
}

function looksLikeHtml(s: string): boolean {
  return /<[a-z][^>]*>/i.test(s)
}

export function getEntityFields(
  collection: string,
  entityData: Record<string, unknown>,
): FieldSpec[] {
  if (collection === 'content') return CONTENT_FIELDS
  if (collection === 'containers') return CONTAINER_FIELDS
  const specs: FieldSpec[] = []
  for (const [key, val] of Object.entries(entityData)) {
    if (NON_TEXT_KEYS.has(key)) continue
    if (typeof val !== 'string' || val.length === 0) continue
    specs.push({ field: key, kind: looksLikeHtml(val) ? 'html' : 'plain' })
  }
  return specs
}

export function findInEntity(
  entityId: string,
  collection: string,
  entityData: Record<string, unknown>,
  opts: SearchOptions,
): EntityMatch[] {
  const results: EntityMatch[] = []
  const specs = getEntityFields(collection, entityData)
  for (const { field, kind } of specs) {
    const val = entityData[field]
    if (typeof val !== 'string' || !val) continue
    const { text, hits } = kind === 'html' ? locateHtml(val, opts) : locatePlain(val, opts)
    results.push(...buildDisplayMatches(entityId, collection, field, text, hits))
  }
  return results
}

export function replaceInEntity(
  collection: string,
  entityData: Record<string, unknown>,
  opts: SearchOptions,
  replacement: string,
  selectionsByField: Map<string, Set<number>>,
): { data: Record<string, unknown>; touchedFields: string[] } {
  const out: Record<string, unknown> = { ...entityData }
  const touched: string[] = []
  const specs = getEntityFields(collection, entityData)
  for (const { field, kind } of specs) {
    const selected = selectionsByField.get(field)
    if (!selected || selected.size === 0) continue
    const val = entityData[field]
    if (typeof val !== 'string' || !val) continue
    const next = kind === 'html'
      ? replaceInHtml(val, opts, replacement, selected)
      : replaceInPlainText(val, opts, replacement, selected)
    if (next !== val) {
      out[field] = next
      touched.push(field)
    }
  }
  return { data: out, touchedFields: touched }
}

/** Parse a match id back into its components. Returns null if malformed. */
export function parseMatchId(id: string): { entityId: string; field: string; index: number } | null {
  const firstColon = id.indexOf(':')
  const lastColon = id.lastIndexOf(':')
  if (firstColon < 0 || lastColon <= firstColon) return null
  const entityId = id.slice(0, firstColon)
  const field = id.slice(firstColon + 1, lastColon)
  const index = Number.parseInt(id.slice(lastColon + 1), 10)
  if (!entityId || !field || !Number.isInteger(index) || index < 0) return null
  return { entityId, field, index }
}
