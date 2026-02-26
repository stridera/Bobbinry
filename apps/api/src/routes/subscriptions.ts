import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  subscriptions,
  subscriptionPayments,
  subscriptionTiers,
  discountCodes,
  accessGrants,
  users
} from '../db/schema'
import { eq, and, or, desc, sql } from 'drizzle-orm'

// Helper to validate UUID
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const subscriptionsPlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // SUBSCRIPTION MANAGEMENT ROUTES
  // ============================================================================

  // Get subscriptions for a user (as subscriber)
  fastify.get<{
    Params: { userId: string }
    Querystring: { status?: string }
  }>('/users/:userId/subscriptions', async (request, reply) => {
    try {
      const { userId } = request.params
      const { status } = request.query

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      const whereConditions = status
        ? and(eq(subscriptions.subscriberId, userId), eq(subscriptions.status, status))
        : eq(subscriptions.subscriberId, userId)

      const subs = await db
        .select({
          subscription: subscriptions,
          tier: subscriptionTiers,
          author: users
        })
        .from(subscriptions)
        .leftJoin(subscriptionTiers, eq(subscriptions.tierId, subscriptionTiers.id))
        .leftJoin(users, eq(subscriptions.authorId, users.id))
        .where(whereConditions)
        .orderBy(desc(subscriptions.createdAt))

      return reply.status(200).send({ subscriptions: subs })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch subscriptions' })
    }
  })

  // Get subscribers for an author
  fastify.get<{
    Params: { authorId: string }
    Querystring: { status?: string; tierId?: string }
  }>('/authors/:authorId/subscribers', async (request, reply) => {
    try {
      const { authorId } = request.params
      const { status, tierId } = request.query

      if (!isValidUUID(authorId)) {
        return reply.status(400).send({ error: 'Invalid author ID format' })
      }

      if (tierId && !isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid tier ID format' })
      }

      const conditions = [eq(subscriptions.authorId, authorId)]
      if (status) {
        conditions.push(eq(subscriptions.status, status))
      }
      if (tierId) {
        conditions.push(eq(subscriptions.tierId, tierId))
      }

      const subscribers = await db
        .select({
          subscription: subscriptions,
          subscriber: users,
          tier: subscriptionTiers
        })
        .from(subscriptions)
        .leftJoin(users, eq(subscriptions.subscriberId, users.id))
        .leftJoin(subscriptionTiers, eq(subscriptions.tierId, subscriptionTiers.id))
        .where(and(...conditions))
        .orderBy(desc(subscriptions.createdAt))

      return reply.status(200).send({ subscribers })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch subscribers' })
    }
  })

  // Create subscription (placeholder - Stripe integration needed)
  fastify.post<{
    Params: { userId: string }
    Body: {
      authorId: string
      tierId: string
      paymentMethodId?: string // Stripe payment method
      discountCode?: string
    }
  }>('/users/:userId/subscribe', async (request, reply) => {
    try {
      const { userId } = request.params
      const { authorId, tierId, discountCode } = request.body
      // const paymentMethodId = request.body.paymentMethodId // TODO: Use for payment processing

      if (!isValidUUID(userId) || !isValidUUID(authorId) || !isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      // Verify tier exists
      const tier = await db
        .select()
        .from(subscriptionTiers)
        .where(and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.authorId, authorId)
        ))
        .limit(1)

      if (tier.length === 0) {
        return reply.status(404).send({ error: 'Subscription tier not found' })
      }

      // Check for existing active subscription
      const existing = await db
        .select()
        .from(subscriptions)
        .where(and(
          eq(subscriptions.subscriberId, userId),
          eq(subscriptions.authorId, authorId),
          or(
            eq(subscriptions.status, 'active'),
            eq(subscriptions.status, 'past_due')
          )
        ))
        .limit(1)

      if (existing.length > 0) {
        return reply.status(400).send({ error: 'Already subscribed to this author' })
      }

      // Validate discount code if provided
      if (discountCode) {
        const code = await db
          .select()
          .from(discountCodes)
          .where(and(
            eq(discountCodes.code, discountCode),
            eq(discountCodes.authorId, authorId),
            eq(discountCodes.isActive, true)
          ))
          .limit(1)

        if (code.length === 0) {
          return reply.status(400).send({ error: 'Invalid discount code' })
        }

        const discount = code[0]!

        // Check if code is expired
        if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) {
          return reply.status(400).send({ error: 'Discount code has expired' })
        }

        // Check max uses
        if (discount.maxUses) {
          if (discount.currentUses >= discount.maxUses) {
            return reply.status(400).send({ error: 'Discount code has reached maximum uses' })
          }
        }
      }

      // TODO: Create Stripe subscription
      // For now, create a placeholder subscription
      const now = new Date()
      const nextMonth = new Date(now)
      nextMonth.setMonth(nextMonth.getMonth() + 1)

      const [subscription] = await db
        .insert(subscriptions)
        .values({
          subscriberId: userId,
          authorId,
          tierId,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: nextMonth,
          cancelAtPeriodEnd: false,
          stripeSubscriptionId: null, // Will be set when Stripe is integrated
          patreonMemberId: null
        })
        .returning()

      // Increment discount code usage if used
      if (discountCode) {
        await db
          .update(discountCodes)
          .set({
            currentUses: sql`CAST(${discountCodes.currentUses} AS INTEGER) + 1`
          })
          .where(eq(discountCodes.code, discountCode))
      }

      return reply.status(201).send({
        subscription,
        message: 'Subscription created successfully',
        note: 'Stripe integration pending - this is a placeholder subscription'
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create subscription' })
    }
  })

  // Update subscription (change tier, cancel, etc.)
  fastify.put<{
    Params: { subscriptionId: string }
    Body: {
      tierId?: string
      cancelAtPeriodEnd?: boolean
    }
  }>('/subscriptions/:subscriptionId', async (request, reply) => {
    try {
      const { subscriptionId } = request.params
      const { tierId, cancelAtPeriodEnd } = request.body

      if (!isValidUUID(subscriptionId)) {
        return reply.status(400).send({ error: 'Invalid subscription ID format' })
      }

      // Get current subscription
      const current = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId))
        .limit(1)

      if (current.length === 0) {
        return reply.status(404).send({ error: 'Subscription not found' })
      }

      const updateData: any = {}

      // Change tier
      if (tierId) {
        if (!isValidUUID(tierId)) {
          return reply.status(400).send({ error: 'Invalid tier ID format' })
        }

        // Verify tier belongs to same author
        const tier = await db
          .select()
          .from(subscriptionTiers)
          .where(and(
            eq(subscriptionTiers.id, tierId),
            eq(subscriptionTiers.authorId, current[0]!.authorId)
          ))
          .limit(1)

        if (tier.length === 0) {
          return reply.status(400).send({ error: 'Invalid tier for this author' })
        }

        updateData.tierId = tierId
        // TODO: Update Stripe subscription tier
      }

      // Cancel subscription
      if (typeof cancelAtPeriodEnd === 'boolean') {
        updateData.cancelAtPeriodEnd = cancelAtPeriodEnd
        // TODO: Update Stripe subscription cancellation
      }

      const [updated] = await db
        .update(subscriptions)
        .set({
          ...updateData,
          updatedAt: new Date()
        })
        .where(eq(subscriptions.id, subscriptionId))
        .returning()

      return reply.status(200).send({ subscription: updated })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update subscription' })
    }
  })

  // Cancel subscription immediately
  fastify.delete<{
    Params: { subscriptionId: string }
  }>('/subscriptions/:subscriptionId', async (request, reply) => {
    try {
      const { subscriptionId } = request.params

      if (!isValidUUID(subscriptionId)) {
        return reply.status(400).send({ error: 'Invalid subscription ID format' })
      }

      // TODO: Cancel in Stripe
      // For now, just update status
      const [canceled] = await db
        .update(subscriptions)
        .set({
          status: 'canceled',
          cancelAtPeriodEnd: false,
          updatedAt: new Date()
        })
        .where(eq(subscriptions.id, subscriptionId))
        .returning()

      if (!canceled) {
        return reply.status(404).send({ error: 'Subscription not found' })
      }

      return reply.status(200).send({
        subscription: canceled,
        message: 'Subscription canceled'
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to cancel subscription' })
    }
  })

  // ============================================================================
  // PAYMENT HISTORY ROUTES
  // ============================================================================

  // Get payment history for a subscription
  fastify.get<{
    Params: { subscriptionId: string }
  }>('/subscriptions/:subscriptionId/payments', async (request, reply) => {
    try {
      const { subscriptionId } = request.params

      if (!isValidUUID(subscriptionId)) {
        return reply.status(400).send({ error: 'Invalid subscription ID format' })
      }

      const payments = await db
        .select()
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.subscriptionId, subscriptionId))
        .orderBy(desc(subscriptionPayments.createdAt))

      return reply.status(200).send({ payments })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch payment history' })
    }
  })

  // Get all payments for a user (as subscriber)
  fastify.get<{
    Params: { userId: string }
    Querystring: { status?: string }
  }>('/users/:userId/payments', async (request, reply) => {
    try {
      const { userId } = request.params
      const { status } = request.query

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      // Get user's subscriptions
      const userSubs = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.subscriberId, userId))

      const subIds = userSubs.map(s => s.id)

      if (subIds.length === 0) {
        return reply.status(200).send({ payments: [] })
      }

      const whereConditions = status
        ? and(
            sql`${subscriptionPayments.subscriptionId} IN ${sql.raw(`(${subIds.map(() => '?').join(', ')})`)}`,
            eq(subscriptionPayments.status, status)
          )
        : sql`${subscriptionPayments.subscriptionId} IN ${sql.raw(`(${subIds.map(() => '?').join(', ')})`)}`;

      const payments = await db
        .select({
          payment: subscriptionPayments,
          subscription: subscriptions,
          author: users
        })
        .from(subscriptionPayments)
        .leftJoin(subscriptions, eq(subscriptionPayments.subscriptionId, subscriptions.id))
        .leftJoin(users, eq(subscriptions.authorId, users.id))
        .where(whereConditions)
        .orderBy(desc(subscriptionPayments.createdAt))

      return reply.status(200).send({ payments })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch payments' })
    }
  })

  // ============================================================================
  // DISCOUNT CODE ROUTES
  // ============================================================================

  // Get discount codes for an author
  fastify.get<{
    Params: { authorId: string }
    Querystring: { active?: string }
  }>('/authors/:authorId/discount-codes', async (request, reply) => {
    try {
      const { authorId } = request.params
      const { active } = request.query

      if (!isValidUUID(authorId)) {
        return reply.status(400).send({ error: 'Invalid author ID format' })
      }

      const whereConditions = active === 'true'
        ? and(eq(discountCodes.authorId, authorId), eq(discountCodes.isActive, true))
        : eq(discountCodes.authorId, authorId)

      const codes = await db
        .select()
        .from(discountCodes)
        .where(whereConditions)
        .orderBy(desc(discountCodes.createdAt))

      return reply.status(200).send({ discountCodes: codes })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch discount codes' })
    }
  })

  // Create discount code
  fastify.post<{
    Params: { authorId: string }
    Body: {
      code: string
      discountType: 'percent' | 'fixed_amount' | 'free_trial'
      discountValue: string
      maxUses?: string
      expiresAt?: string
    }
  }>('/authors/:authorId/discount-codes', async (request, reply) => {
    try {
      const { authorId } = request.params
      const { code, discountType, discountValue, maxUses, expiresAt } = request.body

      if (!isValidUUID(authorId)) {
        return reply.status(400).send({ error: 'Invalid author ID format' })
      }

      if (!code || code.trim().length === 0) {
        return reply.status(400).send({ error: 'Code is required' })
      }

      // Check if code already exists
      const existing = await db
        .select()
        .from(discountCodes)
        .where(eq(discountCodes.code, code.toUpperCase()))
        .limit(1)

      if (existing.length > 0) {
        return reply.status(400).send({ error: 'Code already exists' })
      }

      const [discountCode] = await db
        .insert(discountCodes)
        .values({
          authorId,
          code: code.toUpperCase(),
          discountType,
          discountValue,
          maxUses: maxUses ? Number(maxUses) : null,
          currentUses: 0,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          isActive: true
        })
        .returning()

      return reply.status(201).send({ discountCode })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create discount code' })
    }
  })

  // Update discount code
  fastify.put<{
    Params: { codeId: string }
    Body: {
      isActive?: boolean
      maxUses?: string
      expiresAt?: string
    }
  }>('/discount-codes/:codeId', async (request, reply) => {
    try {
      const { codeId } = request.params
      const updateData = request.body

      if (!isValidUUID(codeId)) {
        return reply.status(400).send({ error: 'Invalid code ID format' })
      }

      const [updated] = await db
        .update(discountCodes)
        .set({
          isActive: updateData.isActive,
          maxUses: updateData.maxUses ? Number(updateData.maxUses) : undefined,
          expiresAt: updateData.expiresAt ? new Date(updateData.expiresAt) : undefined,
          updatedAt: new Date()
        })
        .where(eq(discountCodes.id, codeId))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Discount code not found' })
      }

      return reply.status(200).send({ discountCode: updated })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update discount code' })
    }
  })

  // Delete discount code
  fastify.delete<{
    Params: { codeId: string }
  }>('/discount-codes/:codeId', async (request, reply) => {
    try {
      const { codeId } = request.params

      if (!isValidUUID(codeId)) {
        return reply.status(400).send({ error: 'Invalid code ID format' })
      }

      await db
        .delete(discountCodes)
        .where(eq(discountCodes.id, codeId))

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to delete discount code' })
    }
  })

  // Validate discount code
  fastify.post<{
    Body: {
      code: string
      authorId: string
    }
  }>('/discount-codes/validate', async (request, reply) => {
    try {
      const { code, authorId } = request.body

      if (!code || !authorId) {
        return reply.status(400).send({ error: 'Code and authorId are required' })
      }

      if (!isValidUUID(authorId)) {
        return reply.status(400).send({ error: 'Invalid author ID format' })
      }

      const discountCode = await db
        .select()
        .from(discountCodes)
        .where(and(
          eq(discountCodes.code, code.toUpperCase()),
          eq(discountCodes.authorId, authorId),
          eq(discountCodes.isActive, true)
        ))
        .limit(1)

      if (discountCode.length === 0) {
        return reply.status(404).send({ valid: false, error: 'Invalid code' })
      }

      const discount = discountCode[0]!

      // Check expiration
      if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) {
        return reply.status(400).send({ valid: false, error: 'Code has expired' })
      }

      // Check max uses
      if (discount.maxUses) {
        if (discount.currentUses >= discount.maxUses) {
          return reply.status(400).send({ valid: false, error: 'Code has reached maximum uses' })
        }
      }

      return reply.status(200).send({
        valid: true,
        discountCode: discount
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to validate discount code' })
    }
  })

  // ============================================================================
  // ACCESS GRANT ROUTES (Gifts, Comps)
  // ============================================================================

  // Get access grants for a user
  fastify.get<{
    Params: { userId: string }
    Querystring: { type?: string; active?: string }
  }>('/users/:userId/access-grants', async (request, reply) => {
    try {
      const { userId } = request.params
      const { type, active } = request.query

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      const conditions = [eq(accessGrants.grantedTo, userId)]
      if (type) {
        conditions.push(eq(accessGrants.grantType, type))
      }
      if (active === 'true') {
        conditions.push(eq(accessGrants.isActive, true))
      }

      const grants = await db
        .select({
          grant: accessGrants,
          author: users
        })
        .from(accessGrants)
        .leftJoin(users, eq(accessGrants.authorId, users.id))
        .where(and(...conditions))
        .orderBy(desc(accessGrants.createdAt))

      return reply.status(200).send({ accessGrants: grants })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch access grants' })
    }
  })

  // Create access grant (gift subscription, comp access)
  fastify.post<{
    Params: { authorId: string }
    Body: {
      grantedTo: string
      projectId?: string
      grantType: 'gift' | 'comp' | 'beta' | 'promotional'
      expiresAt?: string
      reason?: string
    }
  }>('/authors/:authorId/access-grants', async (request, reply) => {
    try {
      const { authorId } = request.params
      const { grantedTo, projectId, grantType, expiresAt, reason } = request.body

      if (!isValidUUID(authorId) || !isValidUUID(grantedTo)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      if (projectId && !isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      const [grant] = await db
        .insert(accessGrants)
        .values({
          grantedTo,
          authorId,
          projectId: projectId || null,
          grantType,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          grantedBy: authorId, // Assuming author is granting
          reason,
          isActive: true
        })
        .returning()

      return reply.status(201).send({ accessGrant: grant })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create access grant' })
    }
  })

  // Revoke access grant
  fastify.delete<{
    Params: { grantId: string }
  }>('/access-grants/:grantId', async (request, reply) => {
    try {
      const { grantId } = request.params

      if (!isValidUUID(grantId)) {
        return reply.status(400).send({ error: 'Invalid grant ID format' })
      }

      const [revoked] = await db
        .update(accessGrants)
        .set({ isActive: false })
        .where(eq(accessGrants.id, grantId))
        .returning()

      if (!revoked) {
        return reply.status(404).send({ error: 'Access grant not found' })
      }

      return reply.status(200).send({ accessGrant: revoked })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to revoke access grant' })
    }
  })
}

export default subscriptionsPlugin
