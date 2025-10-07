/**
 * Authentication API Routes
 *
 * Handles user authentication (login, signup, session validation)
 */

import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const authPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Login endpoint
   * POST /auth/login
   */
  fastify.post<{
    Body: {
      email: string
      password: string
    }
  }>('/auth/login', async (request, reply) => {
    try {
      const { email, password } = request.body

      if (!email || !password) {
        return reply.status(400).send({ error: 'Email and password are required' })
      }

      // Find user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

      if (!user || !user.passwordHash) {
        // For security, don't reveal whether user exists
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      // Verify password hash
      const hashParts = user.passwordHash.split(':')
      if (hashParts.length !== 2 || !hashParts[0] || !hashParts[1]) {
        return reply.status(500).send({ error: 'Invalid password hash format' })
      }
      const [salt, storedHash] = hashParts
      const hash = scryptSync(password, salt, 64).toString('hex')

      const isValid = timingSafeEqual(
        Buffer.from(storedHash, 'hex'),
        Buffer.from(hash, 'hex')
      )

      if (!isValid) {
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name
      })
    } catch (error) {
      fastify.log.error({ error }, 'Login failed')
      return reply.status(500).send({ error: 'Login failed' })
    }
  })

  /**
   * Signup endpoint
   * POST /auth/signup
   */
  fastify.post<{
    Body: {
      email: string
      password: string
      name?: string
    }
  }>('/auth/signup', async (request, reply) => {
    try {
      const { email, password, name } = request.body

      if (!email || !password) {
        return reply.status(400).send({ error: 'Email and password are required' })
      }

      // Check if user already exists
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

      if (existing) {
        return reply.status(409).send({ error: 'User already exists' })
      }

      // Hash password with scrypt
      const salt = randomBytes(16).toString('hex')
      const hash = scryptSync(password, salt, 64).toString('hex')
      const passwordHash = `${salt}:${hash}`

      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          name: name || null,
          passwordHash
        })
        .returning()

      if (!newUser) {
        return reply.status(500).send({ error: 'Failed to create user' })
      }

      return reply.status(201).send({
        id: newUser.id,
        email: newUser.email,
        name: newUser.name
      })
    } catch (error) {
      fastify.log.error({ error }, 'Signup failed')
      return reply.status(500).send({ error: 'Signup failed' })
    }
  })

  /**
   * Get current user session
   * GET /auth/session
   */
  fastify.get<{
    Querystring: {
      userId?: string
    }
  }>('/auth/session', async (request, reply) => {
    try {
      const { userId } = request.query

      if (!userId) {
        return reply.status(401).send({ error: 'Not authenticated' })
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (!user) {
        return reply.status(404).send({ error: 'User not found' })
      }

      return reply.send({ user })
    } catch (error) {
      fastify.log.error({ error }, 'Session check failed')
      return reply.status(500).send({ error: 'Session check failed' })
    }
  })
}

export default authPlugin
