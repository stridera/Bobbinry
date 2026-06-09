import * as cheerio from 'cheerio'

/** Options shared by search and replace operations. */
export type SearchOptions = {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
}

/** A single match returned to the client. The `id` is stable across re-previews
 * as long as the surrounding field text hasn't changed, because it embeds the
 * 0-based match index within that field. */
export type EntityMatch = {
  id: string
  entityId: string
  collection: string
  field: string
  index: number
  matchText: string
  contextBefore: string
  contextAfter: string
}

type RawMatch = {
  index: number
  matchText: string
  contextBefore: string
  contextAfter: string
}

type FieldSpec = { field: string; kind: 'plain' | 'html' }

type Hit = { start: number; end: number; matchText: string }

const CONTEXT_RADIUS = 40
const MAX_MATCHES_PER_FIELD = 500

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

export function findInPlainText(text: string, opts: SearchOptions): RawMatch[] {
  const hits = findHits(text, opts)
  return hits.map((h, i) => ({
    index: i,
    matchText: h.matchText,
    contextBefore: text.slice(Math.max(0, h.start - CONTEXT_RADIUS), h.start),
    contextAfter: text.slice(h.end, Math.min(text.length, h.end + CONTEXT_RADIUS)),
  }))
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

export function findInHtml(html: string, opts: SearchOptions): RawMatch[] {
  if (!html || !opts.query) return []
  const { $, $root } = loadFragment(html)
  const textNodes = walkTextNodes($, $root)
  if (textNodes.length === 0) return []

  let concat = ''
  const nodeRanges: Array<{ start: number; end: number }> = []
  for (const node of textNodes) {
    const data = node.data ?? ''
    const start = concat.length
    concat += data
    nodeRanges.push({ start, end: concat.length })
  }

  const results: RawMatch[] = []
  let globalIndex = 0
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i]!
    const data = node.data ?? ''
    if (!data) continue
    const hits = findHits(data, opts)
    const range = nodeRanges[i]!
    for (const h of hits) {
      const gStart = range.start + h.start
      const gEnd = range.start + h.end
      results.push({
        index: globalIndex++,
        matchText: h.matchText,
        contextBefore: concat.slice(Math.max(0, gStart - CONTEXT_RADIUS), gStart),
        contextAfter: concat.slice(gEnd, Math.min(concat.length, gEnd + CONTEXT_RADIUS)),
      })
      if (results.length >= MAX_MATCHES_PER_FIELD) return results
    }
  }
  return results
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
    const raws = kind === 'html' ? findInHtml(val, opts) : findInPlainText(val, opts)
    for (const r of raws) {
      results.push({
        id: `${entityId}:${field}:${r.index}`,
        entityId,
        collection,
        field,
        index: r.index,
        matchText: r.matchText,
        contextBefore: r.contextBefore,
        contextAfter: r.contextAfter,
      })
    }
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
