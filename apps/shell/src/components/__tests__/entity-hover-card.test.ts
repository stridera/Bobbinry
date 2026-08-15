/**
 * The hover card renders whatever the entity's description field holds, which
 * may be rich text from the entity editor. It has two lines to work with, so
 * the summary has to survive markup, entities, and stray whitespace.
 */

import { toPlainSummary } from '@bobbinry/ui-components'

describe('toPlainSummary', () => {
  it('returns an empty string for missing descriptions', () => {
    expect(toPlainSummary(undefined)).toBe('')
    expect(toPlainSummary('')).toBe('')
  })

  it('strips markup and keeps the text', () => {
    expect(toPlainSummary('<p>A <strong>reluctant</strong> heir.</p>')).toBe(
      'A reluctant heir.'
    )
  })

  it('inserts a gap where block tags used to separate text', () => {
    expect(toPlainSummary('<p>First line.</p><p>Second line.</p>')).toBe(
      'First line. Second line.'
    )
    expect(toPlainSummary('One<br>Two')).toBe('One Two')
  })

  it('decodes the entities the editor emits', () => {
    expect(toPlainSummary('Bran &amp; Sons &lt;of the Marsh&gt;')).toBe(
      'Bran & Sons <of the Marsh>'
    )
    expect(toPlainSummary('a&nbsp;&nbsp;b')).toBe('a b')
    expect(toPlainSummary('&quot;Hush,&quot; she said. It&#39;s late.')).toBe(
      '"Hush," she said. It\'s late.'
    )
  })

  it('collapses whitespace and newlines onto one line', () => {
    expect(toPlainSummary('  spaced \n\n out   text  ')).toBe('spaced out text')
  })

  it('leaves text at or under the limit untouched', () => {
    const text = 'x'.repeat(40)
    expect(toPlainSummary(text, 40)).toBe(text)
  })

  it('truncates on a word boundary when there is a usable one', () => {
    const summary = toPlainSummary('the quick brown fox jumps over the lazy dog', 20)
    expect(summary).toBe('the quick brown fox…')
  })

  it('hard-truncates rather than dropping most of a long word', () => {
    // A single long token has no boundary worth breaking on — cutting back to
    // it would throw away nearly everything the card had room for.
    const summary = toPlainSummary(`ab ${'z'.repeat(60)}`, 20)
    expect(summary).toBe('ab zzzzzzzzzzzzzzzzz…')
  })

  it('never exceeds the limit by more than the ellipsis', () => {
    const long = 'lorem ipsum dolor sit amet '.repeat(20)
    expect(toPlainSummary(long, 100).length).toBeLessThanOrEqual(101)
  })
})
