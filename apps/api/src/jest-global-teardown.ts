export default async function globalTeardown() {
  const { closeConnection } = await import('./db/connection')
  await closeConnection()
}
