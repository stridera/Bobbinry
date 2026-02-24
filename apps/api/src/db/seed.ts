import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { randomBytes, scryptSync } from 'crypto'
import { users, projects, bobbinsInstalled } from './schema'

/**
 * Hash password using the same method as the auth routes
 */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

/**
 * Seed database with test data for development
 * WARNING: Only run this in development environments!
 */
async function seed() {
  const { env } = await import('../lib/env')
  const connectionString = env.DATABASE_URL

  const client = postgres(connectionString)
  const db = drizzle(client)

  try {
    console.log('🌱 Seeding database with test data...')

    // Create test users
    console.log('Creating test users...')

    const testUsers = [
      {
        email: 'test@bobbinry.dev',
        name: 'Test User',
        password: 'password123'
      },
      {
        email: 'alice@bobbinry.dev',
        name: 'Alice Writer',
        password: 'password123'
      },
      {
        email: 'bob@bobbinry.dev',
        name: 'Bob Author',
        password: 'password123'
      }
    ]

    for (const userData of testUsers) {
      const passwordHash = hashPassword(userData.password)

      await db.insert(users).values({
        email: userData.email,
        name: userData.name,
        passwordHash
      })

      console.log(`  ✓ Created user: ${userData.email} (password: ${userData.password})`)
    }

    console.log('\n✅ Seeding complete!')
    console.log('\nTest accounts:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    testUsers.forEach(u => {
      console.log(`  Email:    ${u.email}`)
      console.log(`  Password: ${u.password}`)
      console.log('  ─────────────────────────────────────')
    })
    console.log('')

  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  } finally {
    await client.end()
  }
}

// Run seed if called directly
if (require.main === module) {
  seed()
    .then(() => {
      console.log('Seed completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Seed failed:', error)
      process.exit(1)
    })
}

export { seed }
