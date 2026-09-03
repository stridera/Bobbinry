/**
 * Turn the rendered chapter DOM into an ordered list of speakable segments.
 *
 * One segment per block-level element (paragraph, heading, list item, quote).
 * Nested blocks (`blockquote > p`, `li > p`) are read once, via the innermost
 * block. Each segment is pre-split into sentence-sized chunks because Chrome
 * silently stops utterances that run longer than roughly fifteen seconds.
 */

export interface Segment {
  /** Element to highlight while speaking; null for synthetic segments (chapter title). */
  el: HTMLElement | null
  text: string
  chunks: string[]
}

export const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote'
export const DEFAULT_CHUNK_LENGTH = 220

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function splitOnSpaces(text: string, max: number): string[] {
  const out: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    if (!word) continue
    if (current && current.length + 1 + word.length > max) {
      out.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) out.push(current)
  return out
}

/**
 * Split text into chunks no longer than `max` characters, preferring sentence
 * boundaries and falling back to word boundaries for very long sentences.
 */
export function chunkText(text: string, max: number = DEFAULT_CHUNK_LENGTH): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  if (normalized.length <= max) return [normalized]

  const sentences = normalized.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*)?\s*/g) ?? [normalized]
  const chunks: string[] = []
  let current = ''
  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }

  for (const raw of sentences) {
    const sentence = raw.trim()
    if (!sentence) continue
    if (sentence.length > max) {
      flush()
      chunks.push(...splitOnSpaces(sentence, max))
      continue
    }
    if (current && current.length + 1 + sentence.length > max) flush()
    current = current ? `${current} ${sentence}` : sentence
  }
  flush()
  return chunks
}

/** Collect speakable segments from the chapter content root, in document order. */
export function collectSegments(root: ParentNode, max: number = DEFAULT_CHUNK_LENGTH): Segment[] {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
  const segments: Segment[] = []

  for (const el of blocks) {
    // Containers with their own block children are covered by those children.
    if (el.querySelector(BLOCK_SELECTOR)) continue
    const text = normalizeText(el.textContent ?? '')
    if (!text) continue
    segments.push({ el, text, chunks: chunkText(text, max) })
  }

  if (segments.length === 0) {
    const rootEl = root as unknown as HTMLElement
    const text = normalizeText(rootEl.textContent ?? '')
    if (text) segments.push({ el: rootEl, text, chunks: chunkText(text, max) })
  }

  return segments
}

/** A synthetic segment for the chapter title, spoken before the body. */
export function titleSegment(title: string): Segment | null {
  const text = normalizeText(title)
  if (!text) return null
  return { el: null, text, chunks: [text] }
}
