import { build } from './server'

const server = build({ logger: true })

const start = async () => {
  try {
    // Run database migrations first
    const { runMigrations } = await import('./db/migrate')
    await runMigrations()
    
    const port = parseInt(process.env.PORT || '4100')
    await server.listen({ port, host: '0.0.0.0' })
    console.log(`🚀 API server running at http://localhost:${port}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()