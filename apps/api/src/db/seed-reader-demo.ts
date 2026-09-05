/**
 * Reader demo data for the local dev database.
 *
 * Builds on seed-test-follows.ts (elena + marcus + two live projects) and
 * fills in everything the public reader can show: real chapter prose that
 * mentions published entities, a scheduled/embargoed chapter, threaded
 * comments, reactions, a beta reader with an open annotation, a paid
 * subscription, and view analytics.
 *
 * Idempotent: every row is looked up by a natural key before insert, so it
 * can be re-run after a reset or whenever the demo needs topping up.
 *
 *   cd apps/api && DATABASE_URL="postgres://strider@localhost:5432/bobbins_dev" npx tsx src/db/seed-reader-demo.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  users,
  userProfiles,
  projects,
  entities,
  chapterPublications,
  comments,
  reactions,
  betaReaders,
  chapterAnnotations,
  subscriptions,
  subscriptionTiers,
  chapterViews,
  projectFollows,
} from './schema'
import { countWordsFromHtml } from '../lib/text'

const DAY = 24 * 60 * 60 * 1000

async function main() {
  const { env } = await import('../lib/env')
  if (env.DATABASE_URL.includes('_prod') || env.DATABASE_URL.includes('neon.tech') || env.NODE_ENV === 'production') {
    console.error('REFUSING to seed a production database')
    process.exit(1)
  }
  const client = postgres(env.DATABASE_URL)
  const db = drizzle(client)

  try {
    // ── People ──────────────────────────────────────────────────────────
    const byEmail = async (email: string) => {
      const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      if (!u) throw new Error(`${email} not found — run seed-test-follows.ts first`)
      return u
    }
    const elena = await byEmail('elena@bobbinry.dev')
    const marcus = await byEmail('marcus@bobbinry.dev')
    const alice = await byEmail('alice@bobbinry.dev')

    const [aliceProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, alice.id)).limit(1)
    if (!aliceProfile) {
      await db.insert(userProfiles).values({
        userId: alice.id, username: 'alice', displayName: 'Alice Writer', bio: 'Reads everything twice.',
      })
      console.log('profile: alice')
    }

    // ── Projects ────────────────────────────────────────────────────────
    const byShortUrl = async (shortUrl: string) => {
      const [p] = await db.select().from(projects).where(and(eq(projects.shortUrl, shortUrl), isNull(projects.deletedAt))).limit(1)
      if (!p) throw new Error(`project ${shortUrl} not found`)
      return p
    }
    const starweaver = await byShortUrl('the-last-starweaver')
    const clockwork = await byShortUrl('clockwork-dreams')

    // ── Chapters ────────────────────────────────────────────────────────
    interface ChapterSpec {
      title: string
      order: number
      body: string
      /** Days from now the public may read it; negative = already released. */
      releaseInDays?: number
    }

    async function upsertChapter(projectId: string, spec: ChapterSpec) {
      const [existing] = await db
        .select({ id: entities.id, entityData: entities.entityData })
        .from(entities)
        .where(and(
          eq(entities.projectId, projectId),
          eq(entities.collectionName, 'content'),
          isNull(entities.deletedAt),
          sql`${entities.entityData}->>'title' = ${spec.title}`,
        ))
        .limit(1)

      const nowIso = new Date().toISOString()
      const data = {
        ...((existing?.entityData as Record<string, unknown>) ?? {}),
        title: spec.title,
        order: spec.order,
        body: spec.body,
        type: 'scene',
        status: 'published',
        word_count: countWordsFromHtml(spec.body),
        updated_at: nowIso,
      }
      delete (data as Record<string, unknown>).content // legacy plain-text field from the old seed

      let chapterId: string
      if (existing) {
        await db.update(entities).set({ entityData: data, contentType: 'chapter', updatedAt: new Date() }).where(eq(entities.id, existing.id))
        chapterId = existing.id
      } else {
        const [row] = await db.insert(entities).values({
          projectId, bobbinId: 'manuscript', collectionName: 'content', contentType: 'chapter', entityData: data,
        }).returning({ id: entities.id })
        chapterId = row!.id
      }

      const publishedAt = new Date()
      const publicReleaseDate = new Date(Date.now() + (spec.releaseInDays ?? -7) * DAY)
      const [pub] = await db.select({ id: chapterPublications.id }).from(chapterPublications).where(eq(chapterPublications.chapterId, chapterId)).limit(1)
      const pubValues = {
        publishStatus: 'published', isPublished: true, publishedAt, publicReleaseDate,
        firstPublishedAt: publishedAt, lastPublishedAt: publishedAt, publishOrder: spec.order,
      }
      if (pub) {
        await db.update(chapterPublications).set(pubValues).where(eq(chapterPublications.id, pub.id))
      } else {
        await db.insert(chapterPublications).values({ projectId, chapterId, ...pubValues })
      }
      console.log(`chapter: ${spec.title}${spec.releaseInDays && spec.releaseInDays > 0 ? ` (embargoed ${spec.releaseInDays}d)` : ''}`)
      return chapterId
    }

    const p = (...paras: string[]) => paras.map(t => `<p>${t}</p>`).join('')

    // Starweaver: give the empty third chapter real prose that names published entities.
    const unraveling = await upsertChapter(starweaver.id, {
      title: 'Unraveling', order: 3,
      body: p(
        'But every thread she pulled loosened another. By the third night Lira could no longer tell which constellations were hers and which had always hung there, patient and indifferent, above Thornhaven.',
        'Her grandmother had warned her. "The sky keeps its own accounts," she used to say, stirring the kettle at the Observatory while Lira pretended not to listen. "Borrow from it and it will collect."',
        'Maren found her on the roof at dawn, fingers raw from the cold, a single silver thread wound so tightly round her wrist that it had begun to cut. "Whatever you owe," Maren said quietly, "you do not pay it alone."',
        'Below them The Restricted Archive stood dark. Somewhere inside, The Keeper was already awake, and already writing her name in the ledger.',
      ),
    })

    // Clockwork Dreams: prose for the existing chapter, three more, one still embargoed.
    const gears = await upsertChapter(clockwork.id, {
      title: 'Gears and Ghosts', order: 1,
      body: p(
        'Unit 7 opened its eyes for the first time and found the world already in motion. Pistons breathed around it. A Cogwork Templar stood guard at the foundry door, boiler ticking, and did not look down.',
        'It was not supposed to be able to look up. Nothing in the schematics allowed for wanting. Yet the automaton turned its head toward the skylight, where the brass cathedral spires caught the last of the furnace light, and felt something it had no word for.',
        'A Somnial Cartographer passed through the yard with a lantern and a roll of maps that showed streets no one had built. She paused, sketched something quickly, and moved on. Unit 7 memorised her face without being told to.',
        '"Faulty batch," the foreman said, and marked the crate. Unit 7 decided, in the silence between two piston strokes, that it disagreed.',
      ),
    })
    const cathedral = await upsertChapter(clockwork.id, {
      title: 'The Brass Cathedral', order: 2,
      body: p(
        'The cathedral had not been consecrated to any god. It was consecrated to pressure. Every Cogwork Templar in the city took their oath beneath its central escapement, and the boilers in their armour were lit from the same eternal flame.',
        'Unit 7 crept along the gallery, oil-quiet. It had come to find a Dreamsmith Artificer named Ottoline Vex, who was said to repair constructs nobody else would touch.',
        'She was asleep at her bench, surrounded by half-finished familiars. One of them, a pocket-watch beetle, watched Unit 7 approach with a single ticking eye.',
        '"You\'re the one that looked up," Ottoline said without opening her eyes. "Sit. Let\'s find out what you\'re for."',
      ),
    })
    const streets = await upsertChapter(clockwork.id, {
      title: 'A Map of Sleeping Streets', order: 3,
      body: p(
        'The Somnial Cartographer\'s name was Hesper Quill, and her maps were of the city as it dreamed itself: avenues that only existed on the third night of rain, a bridge that connected two different Tuesdays.',
        '"Every sleeper is a lamp on this page," she told Unit 7, unrolling a chart across the workshop floor. "Tonight the whole district is burning with them. Something is dreaming <em>through</em> the machines."',
        'Ottoline Vex looked up from the beetle she was rewinding. "Through them, or as them?"',
        'Hesper did not answer. She was watching a new lamp flicker into being on the map, exactly where Unit 7 was standing.',
      ),
    })
    await upsertChapter(clockwork.id, {
      title: 'The Duel at Voltaic Bridge', order: 4, releaseInDays: 5,
      body: p(
        'The Aether Duelist waited at the centre of Voltaic Bridge with his blade sheathed and the storm already gathering in his footwork. Rain hissed where it touched him.',
        '"I was told to stop a faulty unit," he said. "Nobody mentioned it would bring friends."',
        'Behind Unit 7, Hesper Quill was already sketching the bridge onto a page where it had not existed a moment ago, and Ottoline Vex was winding forty beetles at once.',
        'Unit 7 stepped forward. It had been built to lift, to carry, to obey. It discovered, on the wet iron of the bridge, that it had also been built to stand between.',
      ),
    })

    // Publish the four class entities so the reader highlights them.
    await db.update(entities)
      .set({ isPublished: true, publishBase: true, publishedAt: new Date() })
      .where(and(eq(entities.projectId, clockwork.id), eq(entities.collectionName, 'classes'), isNull(entities.deletedAt)))

    // ── Comments (threaded) ─────────────────────────────────────────────
    async function upsertComment(chapterId: string, authorId: string, content: string, parentId: string | null = null) {
      const [existing] = await db.select({ id: comments.id }).from(comments)
        .where(and(eq(comments.chapterId, chapterId), eq(comments.authorId, authorId), eq(comments.content, content))).limit(1)
      if (existing) return existing.id
      const [row] = await db.insert(comments).values({
        chapterId, authorId, content, parentId, moderationStatus: 'approved',
      }).returning({ id: comments.id })
      console.log(`comment: "${content.slice(0, 40)}…"`)
      return row!.id
    }
    const [observatory] = await db.select({ id: entities.id }).from(entities)
      .where(and(eq(entities.projectId, starweaver.id), sql`${entities.entityData}->>'title' = 'The Observatory'`, isNull(entities.deletedAt))).limit(1)
    if (observatory) {
      const top = await upsertComment(observatory.id, marcus.id, 'The image of star charts that still shimmer is going to stay with me. Is the observatory based on a real place?')
      await upsertComment(observatory.id, elena.id, 'Half real! The building is the old Greenwich transit room; the shimmering is entirely Lira\'s problem.', top)
      await upsertComment(observatory.id, alice.id, 'Read this twice before bed and then could not sleep. Compliment.')
    }
    await upsertComment(gears, marcus.id, 'A robot deciding to disagree in the gap between two piston strokes is the best opening line I have read this year.')
    await upsertComment(unraveling, alice.id, 'Maren finally gets a scene. More Maren.')

    // ── Reactions ───────────────────────────────────────────────────────
    async function react(chapterId: string, userId: string, type: string) {
      const [existing] = await db.select({ id: reactions.id }).from(reactions)
        .where(and(eq(reactions.chapterId, chapterId), eq(reactions.userId, userId), eq(reactions.reactionType, type))).limit(1)
      if (!existing) await db.insert(reactions).values({ chapterId, userId, reactionType: type })
    }
    if (observatory) { await react(observatory.id, marcus.id, 'heart'); await react(observatory.id, marcus.id, 'wow'); await react(observatory.id, alice.id, 'heart') }
    await react(gears, marcus.id, 'fire'); await react(gears, alice.id, 'heart'); await react(cathedral, marcus.id, 'heart'); await react(streets, alice.id, 'wow')
    console.log('reactions: seeded')

    // ── Beta reader + annotation ────────────────────────────────────────
    const [beta] = await db.select({ id: betaReaders.id }).from(betaReaders)
      .where(and(eq(betaReaders.readerId, marcus.id), eq(betaReaders.projectId, clockwork.id))).limit(1)
    if (!beta) {
      await db.insert(betaReaders).values({ authorId: elena.id, readerId: marcus.id, projectId: clockwork.id, isActive: true, notes: 'Demo beta reader' })
      console.log('beta reader: marcus on Clockwork Dreams')
    }
    const annotationTargets: Array<[string, string, string, number, string, string | null, string]> = [
      // chapterId, projectId, quote, paragraphIndex, type, suggestedText, content
      [gears, clockwork.id, 'memorised her face', 2, 'suggestion', 'memorized her face', 'US spelling elsewhere in the chapter.'],
      [gears, clockwork.id, 'Faulty batch', 3, 'feedback', null, 'Love this line. Consider letting it sit on its own paragraph.'],
    ]
    if (observatory) annotationTargets.push([observatory.id, starweaver.id, 'ancient telescope', 0, 'error', 'antique telescope', 'Typo or word choice? "ancient" reads odd for brass.'])
    for (const [chapterId, projectId, quote, idx, type, suggested, content] of annotationTargets) {
      const [existing] = await db.select({ id: chapterAnnotations.id }).from(chapterAnnotations)
        .where(and(eq(chapterAnnotations.chapterId, chapterId), eq(chapterAnnotations.authorId, marcus.id), eq(chapterAnnotations.anchorQuote, quote))).limit(1)
      if (existing) continue
      await db.insert(chapterAnnotations).values({
        chapterId, projectId, authorId: marcus.id, anchorParagraphIndex: idx, anchorQuote: quote,
        annotationType: type, errorCategory: type === 'error' ? 'typo' : null, content, suggestedText: suggested, status: 'open', chapterVersion: 1,
      })
      console.log(`annotation: "${quote}"`)
    }

    // ── Subscription (marcus → Stargazer, 3-day early access) ───────────
    const [stargazer] = await db.select({ id: subscriptionTiers.id }).from(subscriptionTiers)
      .where(and(eq(subscriptionTiers.authorId, elena.id), eq(subscriptionTiers.name, 'Stargazer'))).limit(1)
    if (stargazer) {
      const [sub] = await db.select({ id: subscriptions.id }).from(subscriptions)
        .where(and(eq(subscriptions.subscriberId, marcus.id), eq(subscriptions.authorId, elena.id))).limit(1)
      if (!sub) {
        await db.insert(subscriptions).values({
          subscriberId: marcus.id, authorId: elena.id, tierId: stargazer.id, status: 'active',
          currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * DAY),
        })
        console.log('subscription: marcus → Stargazer')
      }
    }

    // ── Follows ─────────────────────────────────────────────────────────
    for (const [followerId, projectId] of [[marcus.id, starweaver.id], [marcus.id, clockwork.id], [alice.id, starweaver.id]] as const) {
      const [f] = await db.select({ followerId: projectFollows.followerId }).from(projectFollows)
        .where(and(eq(projectFollows.followerId, followerId), eq(projectFollows.projectId, projectId))).limit(1)
      if (!f) await db.insert(projectFollows).values({ followerId, projectId })
    }

    // ── View analytics ──────────────────────────────────────────────────
    const viewTargets: Array<[string, number]> = [[gears, 18], [cathedral, 11], [streets, 6], [unraveling, 9]]
    if (observatory) viewTargets.push([observatory.id, 24])
    for (const [chapterId, count] of viewTargets) {
      const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(chapterViews)
        .where(and(eq(chapterViews.chapterId, chapterId), sql`${chapterViews.sessionId} like 'seed-%'`))
      const n = countRow?.n ?? 0
      if (n >= count) continue
      const rows = Array.from({ length: count - n }, (_, i) => {
        const finished = i % 3 !== 0
        return {
          chapterId,
          readerId: i % 5 === 0 ? marcus.id : i % 7 === 0 ? alice.id : null,
          sessionId: `seed-${chapterId.slice(0, 8)}-${n + i}`,
          startedAt: new Date(Date.now() - (i + 1) * 6 * 60 * 60 * 1000),
          lastPositionPercent: finished ? 100 : 20 + (i * 13) % 60,
          completedAt: finished ? new Date(Date.now() - i * 5 * 60 * 60 * 1000) : null,
          readTimeSeconds: 180 + (i * 97) % 600,
          deviceType: ['desktop', 'mobile', 'tablet'][i % 3],
        }
      })
      await db.insert(chapterViews).values(rows)
      await db.update(chapterPublications)
        .set({ viewCount: sql`GREATEST(${chapterPublications.viewCount}, ${count})` })
        .where(eq(chapterPublications.chapterId, chapterId))
    }
    console.log('views: seeded')

    console.log('\nReader demo data ready.')
    console.log('  /read/elena/the-last-starweaver/unraveling        — prose with saga entities, comments')
    console.log('  /read/elena/clockwork-dreams/gears-and-ghosts     — prose with class entities, annotations (marcus is beta)')
    console.log('  /read/elena/clockwork-dreams/the-duel-at-voltaic-bridge — embargoed 5 days: anonymous locked, Stargazer (3d) locked, Constellation unlocked')
    console.log('  marcus: subscribed to Stargazer, beta on Clockwork Dreams, follows both')
  } finally {
    await client.end()
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
