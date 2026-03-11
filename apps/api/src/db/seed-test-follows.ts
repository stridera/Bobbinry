import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { randomBytes, scryptSync } from 'crypto'
import {
  users,
  userProfiles,
  projects,
  projectPublishConfig,
  subscriptionTiers,
  entities,
  chapterPublications
} from './schema'

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

async function seedTestFollows() {
  const { env } = await import('../lib/env')

  if (env.DATABASE_URL.includes('_prod') || env.NODE_ENV === 'production') {
    console.error('REFUSING to seed production database!')
    process.exit(1)
  }

  const client = postgres(env.DATABASE_URL)
  const db = drizzle(client)

  try {
    console.log('Seeding test data for follow/subscribe testing...\n')

    // --- Test Author: Elena ---
    const [elena] = await db.insert(users).values({
      email: 'elena@bobbinry.dev',
      name: 'Elena Nightshade',
      passwordHash: hashPassword('password123')
    }).returning()
    if (!elena) throw new Error('Failed to create elena')
    console.log(`Created user: elena@bobbinry.dev (id: ${elena.id})`)

    await db.insert(userProfiles).values({
      userId: elena.id,
      username: 'elena',
      displayName: 'Elena Nightshade',
      bio: 'Fantasy & sci-fi author. Tea enthusiast.'
    })

    // Elena's projects
    const [project1] = await db.insert(projects).values({
      ownerId: elena.id,
      name: 'The Last Starweaver',
      description: 'A young astronomer discovers she can weave starlight into reality.',
      shortUrl: 'the-last-starweaver'
    }).returning()
    if (!project1) throw new Error('Failed to create project1')

    const [project2] = await db.insert(projects).values({
      ownerId: elena.id,
      name: 'Clockwork Dreams',
      description: 'In a city of living machines, one automaton begins to dream.',
      shortUrl: 'clockwork-dreams'
    }).returning()
    if (!project2) throw new Error('Failed to create project2')

    // Publish configs (make both live)
    await db.insert(projectPublishConfig).values([
      { projectId: project1.id, publishingMode: 'live', defaultVisibility: 'public' },
      { projectId: project2.id, publishingMode: 'live', defaultVisibility: 'public' }
    ])

    // Chapters for project1
    const [ch1] = await db.insert(entities).values({
      projectId: project1.id,
      bobbinId: 'manuscript',
      collectionName: 'content',
      entityData: { title: 'The Observatory', order: 1, content: 'Lira gazed through the ancient telescope...' }
    }).returning()
    if (!ch1) throw new Error('Failed to create ch1')

    const [ch2] = await db.insert(entities).values({
      projectId: project1.id,
      bobbinId: 'manuscript',
      collectionName: 'content',
      entityData: { title: 'First Thread', order: 2, content: 'The starlight bent at her touch...' }
    }).returning()
    if (!ch2) throw new Error('Failed to create ch2')

    const [ch3] = await db.insert(entities).values({
      projectId: project1.id,
      bobbinId: 'manuscript',
      collectionName: 'content',
      entityData: { title: 'Unraveling', order: 3, content: 'But every thread she pulled...' }
    }).returning()
    if (!ch3) throw new Error('Failed to create ch3')

    // Chapters for project2
    const [ch4] = await db.insert(entities).values({
      projectId: project2.id,
      bobbinId: 'manuscript',
      collectionName: 'content',
      entityData: { title: 'Gears and Ghosts', order: 1, content: 'Unit 7 opened its eyes for the first time...' }
    }).returning()
    if (!ch4) throw new Error('Failed to create ch4')

    // Publish the chapters
    const now = new Date()
    await db.insert(chapterPublications).values([
      { projectId: project1.id, chapterId: ch1.id, publishStatus: 'published', isPublished: true, publishedAt: now, firstPublishedAt: now, lastPublishedAt: now },
      { projectId: project1.id, chapterId: ch2.id, publishStatus: 'published', isPublished: true, publishedAt: now, firstPublishedAt: now, lastPublishedAt: now },
      { projectId: project1.id, chapterId: ch3.id, publishStatus: 'published', isPublished: true, publishedAt: now, firstPublishedAt: now, lastPublishedAt: now },
      { projectId: project2.id, chapterId: ch4.id, publishStatus: 'published', isPublished: true, publishedAt: now, firstPublishedAt: now, lastPublishedAt: now }
    ])

    // Subscription tiers for Elena (paid author)
    await db.insert(subscriptionTiers).values([
      {
        authorId: elena.id,
        name: 'Stargazer',
        description: 'Get chapters 3 days early',
        priceMonthly: '3.00',
        priceYearly: '30.00',
        benefits: ['Early chapter access', 'Author updates'],
        chapterDelayDays: 3,
        tierLevel: 1,
        isActive: true
      },
      {
        authorId: elena.id,
        name: 'Constellation',
        description: 'Immediate access + bonus content',
        priceMonthly: '7.00',
        priceYearly: '70.00',
        benefits: ['Immediate chapter access', 'Bonus short stories', 'Discord role', 'Name in acknowledgments'],
        chapterDelayDays: 0,
        tierLevel: 2,
        isActive: true
      }
    ])

    console.log(`Created projects: "${project1.name}" (${project1.shortUrl}), "${project2.name}" (${project2.shortUrl})`)
    console.log(`Created 4 published chapters and 2 subscription tiers`)

    // --- Test Reader: Marcus ---
    const [marcus] = await db.insert(users).values({
      email: 'marcus@bobbinry.dev',
      name: 'Marcus Reed',
      passwordHash: hashPassword('password123')
    }).returning()
    if (!marcus) throw new Error('Failed to create marcus')
    console.log(`\nCreated user: marcus@bobbinry.dev (id: ${marcus.id})`)

    await db.insert(userProfiles).values({
      userId: marcus.id,
      username: 'marcus',
      displayName: 'Marcus Reed',
      bio: 'Avid reader. Will follow anything with dragons.'
    })

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('TEST ACCOUNTS (password: password123)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('  Author:  elena@bobbinry.dev  (username: elena)')
    console.log('           Has 2 projects, 2 paid tiers')
    console.log('  Reader:  marcus@bobbinry.dev (username: marcus)')
    console.log('           Use to test follow/subscribe')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`\nTest URLs:`)
    console.log(`  /read/elena                        — Author works page`)
    console.log(`  /read/elena/the-last-starweaver     — Project TOC (3 chapters)`)
    console.log(`  /read/elena/clockwork-dreams         — Project TOC (1 chapter)`)

  } catch (error) {
    console.error('Seeding failed:', error)
    throw error
  } finally {
    await client.end()
  }
}

seedTestFollows()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
