import {
  countWords,
  countWordsFromHtml,
  decodeHtmlEntities,
  htmlToParagraphs,
  htmlToPlainText,
  tokenizeHtml,
  tokenizeWords,
} from '../../text'

describe('htmlToPlainText', () => {
  it('treats block boundaries as word boundaries', () => {
    // The bug in search-replace.ts's text-node walker: it concatenated nodes
    // with no separator, so this collapsed to the single token "endStart".
    expect(countWordsFromHtml('<p>end</p><p>Start</p>')).toBe(2)
    expect(countWordsFromHtml('one<br>two')).toBe(2)
    expect(countWordsFromHtml('<ul><li>a</li><li>b</li></ul>')).toBe(2)
  })

  it('treats inline tags as transparent', () => {
    // The bug in the old countWordsFromHtml: every tag became a space, so an
    // italicised part-word counted twice.
    expect(countWordsFromHtml('<em>in</em>line')).toBe(1)
    expect(countWordsFromHtml('<strong>un</strong><em>bel</em>ievable')).toBe(1)
    expect(countWordsFromHtml('<p>a <a href="/x">link</a> here</p>')).toBe(3)
  })

  it('keeps punctuation attached across an inline close tag', () => {
    // The dominant real-world form of the over-count: every italicised title
    // followed by a comma, and every bolded speaker label followed by a colon,
    // contributed one phantom word each. On a 273k-word project this was 347.
    expect(countWordsFromHtml('<p>A Guide to <em>Threadwork</em>, by someone</p>')).toBe(6)
    expect(countWordsFromHtml('<p><strong>Ruby</strong>: Lucas, Steve is</p>')).toBe(4)
  })

  it('does not count script or style content as prose', () => {
    expect(countWordsFromHtml('<p>hi</p><style>.a { color: red }</style>')).toBe(1)
    expect(countWordsFromHtml('<script>var a = 1; var b = 2;</script><p>hi</p>')).toBe(1)
  })

  it('ignores comments, including ones containing tags', () => {
    expect(countWordsFromHtml('<p>a<!-- <p>ignored words</p> -->b</p>')).toBe(1)
  })

  it('returns empty for the editor empty-document sentinel', () => {
    expect(countWordsFromHtml('<p></p>')).toBe(0)
    expect(countWordsFromHtml('')).toBe(0)
    expect(countWordsFromHtml(null)).toBe(0)
    expect(countWordsFromHtml(undefined)).toBe(0)
  })
})

describe('decodeHtmlEntities', () => {
  it('keeps an apostrophe entity inside its word', () => {
    // The old regex was /&[a-z]+;/gi -> ' ', which both split don't in two and
    // missed numeric entities entirely — the form TipTap actually emits.
    expect(countWordsFromHtml('<p>don&#39;t</p>')).toBe(1)
    expect(countWordsFromHtml('<p>don&apos;t</p>')).toBe(1)
    expect(countWordsFromHtml('<p>don&#x27;t</p>')).toBe(1)
    expect(decodeHtmlEntities('don&#39;t')).toBe("don't")
  })

  it('treats nbsp as a separator and zero-width joiners as not', () => {
    expect(countWordsFromHtml('<p>a&nbsp;b</p>')).toBe(2)
    expect(countWordsFromHtml('<p>a&#160;b</p>')).toBe(2)
    expect(countWordsFromHtml('<p>co&shy;operate</p>')).toBe(1)
  })

  it('decodes one level only', () => {
    // &amp;lt; is the literal text "&lt;", not "<".
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;')
  })

  it('leaves malformed and unknown entities verbatim', () => {
    expect(decodeHtmlEntities('&notarealentity;')).toBe('&notarealentity;')
    expect(decodeHtmlEntities('100 & 200')).toBe('100 & 200')
    // Lone surrogates and out-of-range code points would throw fromCodePoint.
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;')
    expect(decodeHtmlEntities('&#99999999;')).toBe('&#99999999;')
  })
})

describe('tokenizer agreement', () => {
  it('counts through the same tokenizer it exposes', () => {
    // Load-bearing: the change feed's wordsAdded - wordsRemoved only reconciles
    // with the stored word_count if these are the same function.
    const samples = [
      '<p>The quick brown fox.</p><p>Jumped over the lazy dog.</p>',
      '<h1>Chapter One</h1><p>It was a <em>dark</em> and stormy night&hellip;</p>',
      '<p>don&#39;t &nbsp; stop</p><blockquote>believing</blockquote>',
      '<p></p>',
    ]
    for (const html of samples) {
      expect(countWordsFromHtml(html)).toBe(tokenizeWords(htmlToPlainText(html)).length)
      expect(tokenizeHtml(html).count).toBe(countWordsFromHtml(html))
      expect(tokenizeHtml(html).words).toEqual(tokenizeWords(htmlToPlainText(html)))
    }
  })

  it('counts plain text identically to flattened HTML', () => {
    expect(countWords('The quick brown fox')).toBe(4)
    expect(countWords('  leading and trailing  ')).toBe(3)
    expect(countWords('')).toBe(0)
    expect(countWords(null)).toBe(0)
  })
})

describe('htmlToParagraphs', () => {
  it('splits on block boundaries and drops blanks', () => {
    expect(htmlToParagraphs('<p>one</p><p></p><p>two</p>')).toEqual(['one', 'two'])
  })

  it('keeps an inline-formatted paragraph intact', () => {
    expect(htmlToParagraphs('<p>a <em>b</em> c</p>')).toEqual(['a b c'])
  })
})
