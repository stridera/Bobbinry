/**
 * Dictionary and thesaurus proxy for the dictionary-panel bobbin.
 *
 * Auth-gated so it can't be scraped as a free public dictionary API; the
 * global per-IP rate limiter in server.ts covers abuse from signed-in users.
 * See lib/dictionary.ts and lib/thesaurus.ts for why the panel no longer calls
 * upstream directly.
 */

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth'
import {
  lookupFromUpstream,
  normalizeWord,
  readCache,
  writeCache,
} from '../lib/dictionary'
import { lookupThesaurus } from '../lib/thesaurus'

const dictionaryPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Definitions for a single English word.
   *
   * 200 -> found, 404 -> no such word, 503 -> every upstream is down. The
   * panel keys its messaging off exactly that distinction.
   */
  fastify.get<{ Params: { word: string } }>('/dictionary/:word', {
    preHandler: requireAuth
  }, async (request, reply) => {
    const word = normalizeWord(request.params.word)
    if (!word) {
      return reply.status(400).send({ error: 'Invalid word' })
    }

    try {
      const cached = await readCache(word)
      if (cached) {
        if (cached.notFound) {
          return reply.status(404).send({ error: 'No definition found', word })
        }
        return reply.send({ word, entries: cached.entries ?? [], source: cached.source, cached: true })
      }

      const result = await lookupFromUpstream(word)

      if (result.status === 'unavailable') {
        // Deliberately not cached -- caching an outage would outlive it.
        request.log.warn({ word }, 'dictionary lookup unavailable from all sources')
        return reply.status(503).send({ error: 'Dictionary sources are unavailable', word })
      }

      if (result.status === 'not-found') {
        await writeCache(word, { entries: null, source: 'none', notFound: true })
        return reply.status(404).send({ error: 'No definition found', word })
      }

      await writeCache(word, { entries: result.entries, source: result.source, notFound: false })
      return reply.send({ word, entries: result.entries, source: result.source, cached: false })
    } catch (error) {
      request.log.error({ err: error, word }, 'dictionary lookup failed')
      return reply.status(500).send({ error: 'Dictionary lookup failed' })
    }
  })

  /**
   * Synonyms and antonyms for a single English word.
   *
   * 200 (possibly with empty lists) or 503 when Datamuse is down. There is no
   * 404: Datamuse answers an unknown word with an empty list.
   */
  fastify.get<{ Params: { word: string } }>('/thesaurus/:word', {
    preHandler: requireAuth
  }, async (request, reply) => {
    const word = normalizeWord(request.params.word)
    if (!word) {
      return reply.status(400).send({ error: 'Invalid word' })
    }

    const lookup = await lookupThesaurus(word)
    if (lookup.status === 'unavailable') {
      request.log.warn({ word }, 'thesaurus lookup unavailable')
      return reply.status(503).send({ error: 'Thesaurus source is unavailable', word })
    }
    return reply.send({ word, ...lookup.result })
  })
}

export default dictionaryPlugin
