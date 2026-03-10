/**
 * Admin API Routes
 *
 * Owner-only endpoints for site management: stats, user listing, badge management.
 */

import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { users, projects, userBadges, userProfiles } from '../db/schema'
import { eq, sql, ilike, or, count, desc } from 'drizzle-orm'
import { requireAuth, requireOwner } from '../middleware/auth'

const adminPlugin: FastifyPluginAsync = async (fastify) => {
  const adminPreHandler = [requireAuth, requireOwner]

  /**
   * GET /admin/stats
   * Dashboard stats: total users, projects, recent signups, badge counts
   */
  fastify.get('/admin/stats', {
    preHandler: adminPreHandler,
  }, async (_request, reply) => {
    const [[userCount], [projectCount], [signups7d], [signups30d], badgeCounts] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(projects),
      db.select({ count: count() }).from(users)
        .where(sql`${users.createdAt} > NOW() - INTERVAL '7 days'`),
      db.select({ count: count() }).from(users)
        .where(sql`${users.createdAt} > NOW() - INTERVAL '30 days'`),
      db.select({
        badge: userBadges.badge,
        count: count(),
      })
        .from(userBadges)
        .where(eq(userBadges.isActive, true))
        .groupBy(userBadges.badge),
    ])

    return reply.send({
      totalUsers: userCount?.count ?? 0,
      totalProjects: projectCount?.count ?? 0,
      signupsLast7d: signups7d?.count ?? 0,
      signupsLast30d: signups30d?.count ?? 0,
      badgeCounts: Object.fromEntries(badgeCounts.map(b => [b.badge, b.count])),
    })
  })

  /**
   * GET /admin/users?search=&page=&limit=
   * Paginated user list with search and badges
   */
  fastify.get<{
    Querystring: { search?: string; page?: string; limit?: string }
  }>('/admin/users', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const search = request.query.search?.trim()
    const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '50', 10) || 50))
    const offset = (page - 1) * limit

    const whereClause = search
      ? or(
          ilike(users.email, `%${search}%`),
          ilike(users.name, `%${search}%`),
          ilike(userProfiles.username, `%${search}%`)
        )
      : undefined

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
          username: userProfiles.username,
        })
        .from(users)
        .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
        .where(whereClause)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(users)
        .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
        .where(whereClause),
    ])

    // Fetch badges for all returned users in one query
    const userIds = rows.map(r => r.id)
    const allBadges = userIds.length > 0
      ? await db
          .select({ userId: userBadges.userId, badge: userBadges.badge, label: userBadges.label })
          .from(userBadges)
          .where(sql`${userBadges.userId} IN ${userIds} AND ${userBadges.isActive} = true`)
      : []

    const badgesByUser = new Map<string, { badge: string; label: string | null }[]>()
    for (const b of allBadges) {
      const list = badgesByUser.get(b.userId) || []
      list.push({ badge: b.badge, label: b.label })
      badgesByUser.set(b.userId, list)
    }

    const usersWithBadges = rows.map(u => ({
      ...u,
      badges: badgesByUser.get(u.id) || [],
    }))

    return reply.send({
      users: usersWithBadges,
      total: totalRow?.count ?? 0,
      page,
      limit,
    })
  })

  /**
   * POST /admin/users/:userId/badges
   * Assign a badge to a user
   */
  fastify.post<{
    Params: { userId: string }
    Body: { badge: string; label?: string }
  }>('/admin/users/:userId/badges', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { userId } = request.params
    const { badge, label } = request.body

    if (!badge) {
      return reply.status(400).send({ error: 'Badge name is required' })
    }

    // Verify target user exists
    const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
    if (!targetUser) {
      return reply.status(404).send({ error: 'User not found' })
    }

    const [inserted] = await db
      .insert(userBadges)
      .values({
        userId,
        badge,
        label: label || null,
        grantedBy: request.user!.id,
      })
      .onConflictDoNothing()
      .returning()

    if (!inserted) {
      return reply.status(409).send({ error: 'User already has this badge' })
    }

    return reply.status(201).send(inserted)
  })

  /**
   * DELETE /admin/users/:userId/badges/:badge
   * Remove a badge from a user
   */
  fastify.delete<{
    Params: { userId: string; badge: string }
  }>('/admin/users/:userId/badges/:badge', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { userId, badge } = request.params

    const result = await db
      .delete(userBadges)
      .where(sql`${userBadges.userId} = ${userId} AND ${userBadges.badge} = ${badge}`)
      .returning()

    if (result.length === 0) {
      return reply.status(404).send({ error: 'Badge not found on user' })
    }

    return reply.send({ success: true })
  })
}

export default adminPlugin
