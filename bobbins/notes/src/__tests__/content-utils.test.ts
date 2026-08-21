import { describe, it, expect } from '@jest/globals'
import { normalizeNoteContent, noteContentToText, plainTextToHtml } from '../components/content-utils'

describe('plainTextToHtml', () => {
  it('wraps paragraphs and keeps single line breaks', () => {
    expect(plainTextToHtml('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>')
  })

  it('escapes markup so legacy text is not interpreted as HTML', () => {
    expect(plainTextToHtml('a < b & c')).toBe('<p>a &lt; b &amp; c</p>')
  })

  it('returns empty string for blank input', () => {
    expect(plainTextToHtml('  \n ')).toBe('')
  })
})

describe('normalizeNoteContent', () => {
  it('passes HTML through untouched', () => {
    expect(normalizeNoteContent('<p><strong>hi</strong></p>')).toBe('<p><strong>hi</strong></p>')
  })

  it('converts legacy plain text', () => {
    expect(normalizeNoteContent('plain')).toBe('<p>plain</p>')
  })

  it('handles null and non-strings', () => {
    expect(normalizeNoteContent(null)).toBe('')
    expect(normalizeNoteContent(undefined)).toBe('')
  })
})

describe('noteContentToText', () => {
  it('strips tags and decodes entities', () => {
    expect(noteContentToText('<p>Tom &amp; <em>Jerry</em></p><ul><li>a</li><li>b</li></ul>'))
      .toBe('Tom & Jerry\na\nb')
  })

  it('leaves plain text alone', () => {
    expect(noteContentToText('just text')).toBe('just text')
  })
})
