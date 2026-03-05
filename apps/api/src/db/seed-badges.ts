/**
 * Seed: Owner badge for site admin
 *
 * Usage:
 *   DATABASE_URL="postgres://strider@localhost:5432/bobbins_dev" npx tsx src/db/seed-badges.ts
 *
 * Idempotent — uses ON CONFLICT DO NOTHING via the unique index.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { users, userBadges } from './schema'
import { eq } from 'drizzle-orm'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'strider@bobbinry.dev'

async function seedBadges() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  if (databaseUrl.includes('_prod') || process.env.NODE_ENV === 'production') {
    console.error('REFUSING to seed production database!')
    process.exit(1)
  }

  const client = postgres(databaseUrl)
  const db = drizzle(client)

  try {
    // Look up admin user
    const [adminUser] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL))
      .limit(1)

    if (!adminUser) {
      console.log(`No user found with email ${ADMIN_EMAIL} — skipping badge seed.`)
      console.log('Set ADMIN_EMAIL env var to use a different email.')
      return
    }

    // Insert owner badge (idempotent)
    await db
      .insert(userBadges)
      .values({
        userId: adminUser.id,
        badge: 'owner',
        label: 'Owner',
      })
      .onConflictDoNothing()

    console.log(`Owner badge assigned to ${adminUser.email} (${adminUser.id})`)
  } finally {
    await client.end()
  }
}

seedBadges().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
