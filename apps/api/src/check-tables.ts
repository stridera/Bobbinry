import { db } from './db/connection'
import { sql } from 'drizzle-orm'

async function checkTables() {
  const result = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)

  console.log('\nTables in database:')
  console.log(JSON.stringify(result, null, 2))
  if (Array.isArray(result)) {
    result.forEach((row: any) => console.log(`- ${row.table_name}`))
  }

  process.exit(0)
}

checkTables().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
