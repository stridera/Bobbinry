import { chunkText, collectSegments, titleSegment, DEFAULT_CHUNK_LENGTH } from '../lib/segments'

function root(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('collectSegments', () => {
  it('returns block elements in document order with normalized text', () => {
    const segments = collectSegments(root(`
      <h2>  Chapter   One </h2>
      <p>First <em>paragraph</em>.</p>
      <p>Second
      paragraph.</p>
    `))
    expect(segments.map(s => s.text)).toEqual(['Chapter One', 'First paragraph.', 'Second paragraph.'])
    expect(segments.map(s => s.el?.tagName)).toEqual(['H2', 'P', 'P'])
  })

  it('reads nested blocks once, via the innermost block', () => {
    const segments = collectSegments(root(`
      <blockquote><p>Quoted line.</p></blockquote>
      <ul><li><p>Item one.</p></li><li>Item two.</li></ul>
    `))
    expect(segments.map(s => s.text)).toEqual(['Quoted line.', 'Item one.', 'Item two.'])
  })

  it('skips empty and whitespace-only blocks', () => {
    const segments = collectSegments(root('<p>   </p><p></p><p>Real.</p>'))
    expect(segments.map(s => s.text)).toEqual(['Real.'])
  })

  it('falls back to the root text when there are no block elements', () => {
    const segments = collectSegments(root('Just some <b>inline</b> text.'))
    expect(segments).toHaveLength(1)
    expect(segments[0]?.text).toBe('Just some inline text.')
  })

  it('returns nothing for an empty root', () => {
    expect(collectSegments(root(''))).toEqual([])
  })
})

describe('chunkText', () => {
  it('keeps short text as a single chunk', () => {
    expect(chunkText('Hello there.')).toEqual(['Hello there.'])
  })

  it('splits on sentence boundaries and never exceeds the max', () => {
    const sentence = 'This is a sentence that is fairly long for testing purposes. '
    const text = sentence.repeat(10)
    const chunks = chunkText(text, 150)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(150)
      expect(chunk.endsWith('.')).toBe(true)
    }
    expect(chunks.join(' ')).toBe(text.trim())
  })

  it('hard-wraps a single sentence longer than the max on word boundaries', () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const chunks = chunkText(text, 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60)
      expect(chunk).not.toMatch(/^\s|\s$/)
    }
    expect(chunks.join(' ')).toBe(text)
  })

  it('uses the default chunk length', () => {
    const text = 'A sentence. '.repeat(50)
    for (const chunk of chunkText(text)) {
      expect(chunk.length).toBeLessThanOrEqual(DEFAULT_CHUNK_LENGTH)
    }
  })
})

describe('titleSegment', () => {
  it('creates an element-less segment for the title', () => {
    expect(titleSegment('  Chapter  Two ')).toEqual({ el: null, text: 'Chapter Two', chunks: ['Chapter Two'] })
  })

  it('returns null for a blank title', () => {
    expect(titleSegment('   ')).toBeNull()
  })
})
