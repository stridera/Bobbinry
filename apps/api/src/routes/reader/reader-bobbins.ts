/** GET /public/reader-bobbins — reader-type bobbins available on the public reader. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { loadAllDiskManifests } from '../../lib/disk-manifests'

const readerBobbinsRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * List reader bobbins available on the public reader.
   * GET /public/reader-bobbins
   *
   * Returns a trimmed projection of every disk manifest that declares
   * capabilities.readerBobbinType. The shell registers the `extensions`
   * subtree on /read pages; reader-type bobbins are on for everyone unless a
   * signed-in user disables them (user_bobbins_installed.isEnabled = false).
   */
  fastify.get('/public/reader-bobbins', async (_request, reply) => {
    try {
      const manifests = await loadAllDiskManifests()
      const bobbins: Array<{
        id: string
        name: string
        description: string
        version: string
        readerBobbinType: 'reader' | 'automation'
        manifest: { id: string; name: string; version: string; extensions: Record<string, unknown> }
      }> = []

      for (const [id, manifest] of manifests) {
        const readerBobbinType = manifest.capabilities?.readerBobbinType
        if (readerBobbinType !== 'reader' && readerBobbinType !== 'automation') continue
        const name = typeof manifest.name === 'string' ? manifest.name : id
        const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
        bobbins.push({
          id,
          name,
          description: typeof manifest.description === 'string' ? manifest.description : '',
          version,
          readerBobbinType,
          manifest: { id, name, version, extensions: manifest.extensions ?? {} }
        })
      }

      bobbins.sort((a, b) => a.name.localeCompare(b.name))
      reply.header('Cache-Control', 'public, max-age=300')
      return reply.send({ bobbins })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to load reader bobbins' })
    }
  })
}

export default readerBobbinsRoutes
