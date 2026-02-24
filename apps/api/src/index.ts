import { build } from './server'
import { env } from './lib/env'

const server = build({ logger: true })

const start = async () => {
  try {
    // Run database migrations first
    const { runMigrations } = await import('./db/migrate')
    await runMigrations()

    await server.listen({ port: env.PORT, host: '0.0.0.0' })
    console.log(`🚀 API server running at http://localhost:${env.PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()