import { build } from './server'

const server = build({ logger: true })

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '4000')
    await server.listen({ port, host: '0.0.0.0' })
    console.log(`🚀 API server running at http://localhost:${port}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()