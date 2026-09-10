import { buildEntityMetadata, lookupEntity, previewText, type EntityLookup } from '../entity-metadata'

const opts = { baseUrl: 'https://bobbinry.test', authorUsername: 'elena', projectSlug: 'clockwork-dreams' }
const project = { id: 'p1', name: 'Clockwork Dreams', authorName: 'Elena Nightshade', canonicalAuthor: 'elena' }
const projectCard = 'https://bobbinry.test/read/elena/clockwork-dreams/opengraph-image'

function ok(entity: Partial<Extract<EntityLookup, { status: 'ok' }>['entity']> = {}): EntityLookup {
  return {
    status: 'ok',
    project,
    entity: {
      id: 'e1', slug: null, name: 'Calvin Hobbs', description: null, imageUrl: null, typeLabel: 'Power Progressions',
      ...entity,
    },
  }
}

describe('buildEntityMetadata', () => {
  it('titles the preview after the entity, its type, and the project', () => {
    const meta = buildEntityMetadata(ok(), opts)
    expect(meta.title).toBe('Calvin Hobbs · Power Progressions — Clockwork Dreams | Bobbinry')
    expect(meta.openGraph?.title).toBe('Calvin Hobbs · Power Progressions — Clockwork Dreams')
  })

  it('falls back to a project line and the project card when the entity has no text or image', () => {
    const meta = buildEntityMetadata(ok(), opts)
    expect(meta.description).toBe('From Clockwork Dreams by Elena Nightshade on Bobbinry.')
    expect(meta.openGraph?.images).toEqual([{ url: projectCard, alt: 'Clockwork Dreams' }])
    expect(meta.twitter?.images).toEqual([projectCard])
  })

  it("uses the entity's own description, image, and slug when it has them", () => {
    const meta = buildEntityMetadata(
      ok({ slug: 'calvin-hobbs', description: 'A dancer of ley lines.', imageUrl: 'https://img.test/calvin.png' }),
      opts
    )
    expect(meta.description).toBe('A dancer of ley lines.')
    expect(meta.openGraph?.images).toEqual([{ url: 'https://img.test/calvin.png', alt: 'Calvin Hobbs' }])
    expect(meta.alternates?.canonical).toBe('https://bobbinry.test/read/elena/clockwork-dreams/entity/calvin-hobbs')
  })

  it('ignores a relative image URL that a crawler could not fetch', () => {
    const meta = buildEntityMetadata(ok({ imageUrl: '/uploads/calvin.png' }), opts)
    expect(meta.openGraph?.images).toEqual([{ url: projectCard, alt: 'Clockwork Dreams' }])
  })

  it('never names a locked entry', () => {
    const meta = buildEntityMetadata({ status: 'locked', project }, opts)
    expect(meta.title).toBe('Locked entry — Clockwork Dreams | Bobbinry')
    expect(JSON.stringify(meta)).not.toContain('Calvin')
    expect(meta.alternates).toBeUndefined()
  })

  it('reports a missing entry, with or without its project', () => {
    expect(buildEntityMetadata({ status: 'missing', project }, opts).title).toBe('Entry Not Found — Clockwork Dreams | Bobbinry')
    expect(buildEntityMetadata({ status: 'missing', project: null }, opts).title).toBe('Entry Not Found | Bobbinry')
  })
})

describe('previewText', () => {
  it('strips rich-text markup and entities', () => {
    expect(previewText('<p>Light &amp; <strong>shadow</strong></p><p>again</p>')).toBe('Light & shadow again')
  })

  it('truncates long text with an ellipsis', () => {
    const out = previewText('word '.repeat(60))!
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith('…')).toBe(true)
  })

  it('treats empty markup as no description', () => {
    expect(previewText('<p></p>')).toBeNull()
    expect(previewText(null)).toBeNull()
  })
})

describe('lookupEntity', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  function respond(status: number, body: unknown = {}) {
    fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body })
  }

  const projectBody = { project: { id: 'p1', name: 'Clockwork Dreams' }, author: { displayName: 'Elena Nightshade', username: 'elena' } }

  it('fetches anonymously and maps the card fields', async () => {
    respond(200, projectBody)
    respond(200, {
      type: { label: 'Power Progressions' },
      entity: { id: 'e1', slug: 'calvin-hobbs', name: 'Calvin Hobbs', description: null, imageUrl: null },
    })
    const result = await lookupEntity('https://api.test', 'elena', 'clockwork-dreams', 'e1')
    expect(result).toEqual({
      status: 'ok',
      project: { id: 'p1', name: 'Clockwork Dreams', authorName: 'Elena Nightshade', canonicalAuthor: 'elena' },
      entity: { id: 'e1', slug: 'calvin-hobbs', name: 'Calvin Hobbs', description: null, imageUrl: null, typeLabel: 'Power Progressions' },
    })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/api/public/projects/p1/entities/e1')
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toBeUndefined()
    }
  })

  it('reports a tier-gated entity as locked', async () => {
    respond(200, projectBody)
    respond(403, { minimumTierLevel: 2 })
    expect((await lookupEntity('https://api.test', 'elena', 'clockwork-dreams', 'e1')).status).toBe('locked')
  })

  it('reports an unknown project or entity as missing', async () => {
    respond(404)
    expect(await lookupEntity('https://api.test', 'nobody', 'nothing', 'e1')).toEqual({ status: 'missing', project: null })
    respond(200, projectBody)
    respond(404)
    expect((await lookupEntity('https://api.test', 'elena', 'clockwork-dreams', 'nope')).status).toBe('missing')
  })
})
