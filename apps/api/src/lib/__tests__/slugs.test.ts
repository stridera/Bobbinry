import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, entitySlugs } from '../../db/schema'
import {
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'
import {
  slugifyName,
  ensureCurrentSlug,
  renameSlug,
  claimSlugManually,
  resolveSlug,
  getSlugsForEntities,
  getSlugAliases,
  unpinSlug,
} from '../slugs'

async function seedEntity(projectId: string, name: string) {
  const [row] = await db.insert(entities).values({
    projectId,
    scope: 'project',
    bobbinId: 'entities',
    collectionName: 'character',
    entityData: { name },
  }).returning()
  return row!
}

describe('slugs', () => {
  let projectId: string
  let otherProjectId: string

  beforeAll(async () => {
    const user = await createTestUser()
    projectId = (await createTestProject(user.id)).id
    otherProjectId = (await createTestProject(user.id)).id
  })

  afterAll(async () => {
    await cleanupAllTestData()
  })

  beforeEach(async () => {
    await db.delete(entitySlugs).where(eq(entitySlugs.projectId, projectId))
    await db.delete(entitySlugs).where(eq(entitySlugs.projectId, otherProjectId))
  })

  describe('slugifyName', () => {
    it('kebab-cases and strips punctuation', () => {
      expect(slugifyName('The Fall of Varen!')).toBe('the-fall-of-varen')
      expect(slugifyName('  Chapter 1:  Beginnings  ')).toBe('chapter-1-beginnings')
    })

    it('falls back to untitled for empty/non-ascii input', () => {
      expect(slugifyName('')).toBe('untitled')
      expect(slugifyName('日本語')).toBe('untitled')
    })

    it('truncates long names without a trailing dash', () => {
      const slug = slugifyName('word '.repeat(60))
      expect(slug.length).toBeLessThanOrEqual(150)
      expect(slug.endsWith('-')).toBe(false)
    })
  })

  describe('ensureCurrentSlug', () => {
    it('claims a slug from the name and is a no-op when one exists', async () => {
      const e = await seedEntity(projectId, 'Elena Voss')
      expect(await ensureCurrentSlug(projectId, e.id, 'Elena Voss')).toBe('elena-voss')
      // Second call keeps the existing slug even with a new name.
      expect(await ensureCurrentSlug(projectId, e.id, 'Renamed')).toBe('elena-voss')
    })

    it('suffixes on collision with another entity\'s current slug', async () => {
      const a = await seedEntity(projectId, 'Prologue')
      const b = await seedEntity(projectId, 'Prologue')
      expect(await ensureCurrentSlug(projectId, a.id, 'Prologue')).toBe('prologue')
      expect(await ensureCurrentSlug(projectId, b.id, 'Prologue')).toBe('prologue-2')
    })

    it('skips reserved words', async () => {
      const e = await seedEntity(projectId, 'Entity')
      expect(await ensureCurrentSlug(projectId, e.id, 'Entity')).toBe('entity-2')
    })

    it('same slug is fine in a different project', async () => {
      const a = await seedEntity(projectId, 'Prologue')
      const b = await seedEntity(otherProjectId, 'Prologue')
      expect(await ensureCurrentSlug(projectId, a.id, 'Prologue')).toBe('prologue')
      expect(await ensureCurrentSlug(otherProjectId, b.id, 'Prologue')).toBe('prologue')
    })

    it('one entity can hold current slugs in several projects', async () => {
      // user-scoped entities can be published into multiple projects
      const e = await seedEntity(projectId, 'Shared Hero')
      expect(await ensureCurrentSlug(projectId, e.id, 'Shared Hero')).toBe('shared-hero')
      expect(await ensureCurrentSlug(otherProjectId, e.id, 'Shared Hero')).toBe('shared-hero')
      // both stay current in their own namespaces
      expect((await resolveSlug(projectId, 'shared-hero'))?.requestedIsCurrent).toBe(true)
      expect((await resolveSlug(otherProjectId, 'shared-hero'))?.requestedIsCurrent).toBe(true)
    })
  })

  describe('renameSlug', () => {
    it('moves the slug and keeps the old one as an alias', async () => {
      const e = await seedEntity(projectId, 'Old Title')
      await ensureCurrentSlug(projectId, e.id, 'Old Title')
      expect(await renameSlug(projectId, e.id, 'New Title')).toBe('new-title')
      expect(await getSlugAliases(projectId, e.id)).toEqual(['old-title'])

      const resolved = await resolveSlug(projectId, 'old-title')
      expect(resolved).toEqual({ entityId: e.id, currentSlug: 'new-title', requestedIsCurrent: false })
    })

    it('reclaims its own alias when renamed back', async () => {
      const e = await seedEntity(projectId, 'First')
      await ensureCurrentSlug(projectId, e.id, 'First')
      await renameSlug(projectId, e.id, 'Second')
      expect(await renameSlug(projectId, e.id, 'First')).toBe('first')
      expect(await getSlugAliases(projectId, e.id)).toEqual(['second'])
      // No duplicate rows for the reclaimed slug.
      const rows = await db.select().from(entitySlugs).where(and(
        eq(entitySlugs.projectId, projectId), eq(entitySlugs.slug, 'first')
      ))
      expect(rows).toHaveLength(1)
    })

    it('does not move pinned slugs', async () => {
      const e = await seedEntity(projectId, 'Pinned')
      await claimSlugManually(projectId, e.id, 'my-custom-slug')
      expect(await renameSlug(projectId, e.id, 'Whatever Else')).toBe('my-custom-slug')
    })

    it('displaces another entity\'s alias but never its current slug', async () => {
      const a = await seedEntity(projectId, 'Alpha')
      const b = await seedEntity(projectId, 'Beta')
      await ensureCurrentSlug(projectId, a.id, 'Alpha')
      await renameSlug(projectId, a.id, 'Alpha Prime') // 'alpha' now an alias of a

      // b renames INTO 'alpha' → displaces a's alias
      await ensureCurrentSlug(projectId, b.id, 'Beta')
      expect(await renameSlug(projectId, b.id, 'Alpha')).toBe('alpha')
      expect(await getSlugAliases(projectId, a.id)).toEqual([])
      // old alias now resolves to b
      const resolved = await resolveSlug(projectId, 'alpha')
      expect(resolved?.entityId).toBe(b.id)

      // but a's CURRENT slug can't be taken: c renames into 'alpha-prime' → suffixed
      const c = await seedEntity(projectId, 'Gamma')
      expect(await ensureCurrentSlug(projectId, c.id, 'Alpha Prime')).toBe('alpha-prime-2')
    })

    it('is a no-op when the slug would not change', async () => {
      const e = await seedEntity(projectId, 'Stable')
      await ensureCurrentSlug(projectId, e.id, 'Stable')
      expect(await renameSlug(projectId, e.id, 'STABLE!')).toBe('stable')
      expect(await getSlugAliases(projectId, e.id)).toEqual([])
    })
  })

  describe('claimSlugManually', () => {
    it('claims exactly, pins, and 409-style errors on taken', async () => {
      const a = await seedEntity(projectId, 'A')
      const b = await seedEntity(projectId, 'B')
      await ensureCurrentSlug(projectId, a.id, 'The Slug')

      expect(await claimSlugManually(projectId, b.id, 'the-slug')).toEqual({ error: 'taken' })
      expect(await claimSlugManually(projectId, b.id, 'entity')).toEqual({ error: 'reserved' })
      expect(await claimSlugManually(projectId, b.id, 'Bad Slug!')).toEqual({ error: 'invalid' })
      expect(await claimSlugManually(projectId, b.id, 'fine-slug')).toEqual({ slug: 'fine-slug' })

      // pinned: rename doesn't move it; unpin: it moves again
      expect(await renameSlug(projectId, b.id, 'Moved')).toBe('fine-slug')
      await unpinSlug(projectId, b.id)
      expect(await renameSlug(projectId, b.id, 'Moved')).toBe('moved')
    })

    it('rejects UUID-shaped slugs', async () => {
      const e = await seedEntity(projectId, 'X')
      const res = await claimSlugManually(projectId, e.id, '08deace8-af22-4fbe-b8a5-a5237deedfbf')
      expect(res).toEqual({ error: 'reserved' })
    })
  })

  describe('resolveSlug', () => {
    it('resolves UUIDs unconditionally with the current slug attached', async () => {
      const e = await seedEntity(projectId, 'Resolve Me')
      await ensureCurrentSlug(projectId, e.id, 'Resolve Me')
      expect(await resolveSlug(projectId, e.id)).toEqual({
        entityId: e.id, currentSlug: 'resolve-me', requestedIsCurrent: false
      })
      // UUID with no slug row still resolves
      const bare = await seedEntity(projectId, 'No Slug Yet')
      expect(await resolveSlug(projectId, bare.id)).toEqual({
        entityId: bare.id, currentSlug: null, requestedIsCurrent: false
      })
    })

    it('returns null for unknown slugs', async () => {
      expect(await resolveSlug(projectId, 'never-heard-of-it')).toBeNull()
    })
  })

  describe('getSlugsForEntities', () => {
    it('returns a map of current slugs only', async () => {
      const a = await seedEntity(projectId, 'One')
      const b = await seedEntity(projectId, 'Two')
      await ensureCurrentSlug(projectId, a.id, 'One')
      await ensureCurrentSlug(projectId, b.id, 'Two')
      await renameSlug(projectId, b.id, 'Two Renamed')

      const map = await getSlugsForEntities(projectId, [a.id, b.id, crypto.randomUUID()])
      expect(map.get(a.id)).toBe('one')
      expect(map.get(b.id)).toBe('two-renamed')
      expect(map.size).toBe(2)
    })
  })
})
