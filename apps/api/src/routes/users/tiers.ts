/** Subscription tiers, Stripe onboarding, tier unlocks. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { env } from '../../lib/env'
import { db } from '../../db/connection'
import { userProfiles, subscriptionTiers, projects, projectCollections, users, entities, userPaymentConfig } from '../../db/schema'
import { eq, and, or, inArray } from 'drizzle-orm'
import { requireAuth, requireSelf, optionalAuth } from '../../middleware/auth'
import { getStripe, createExpressAccount, createOnboardingLink } from '../../lib/stripe'
import { notDeleted } from '../../lib/entity-scope'
import { isUuid as isValidUUID } from '../../lib/slugs'

/**
 * Numeric tier fields arrive as strings or numbers from the settings UI.
 * `Number('abc')` is NaN and `Number(undefined)` is 0, so unchecked values
 * used to land in the table as NaN or silently zeroed prices. Returns the
 * 400 message for the first bad field, or null.
 */
function invalidTierNumbers(
  body: { priceMonthly?: unknown; priceYearly?: unknown; tierLevel?: unknown; earlyAccessDays?: unknown },
  opts: { requireTierLevel: boolean },
): string | null {
  const present = (v: unknown) => v !== undefined && v !== null && v !== ''
  for (const field of ['priceMonthly', 'priceYearly'] as const) {
    const v = body[field]
    if (present(v) && !(Number.isFinite(Number(v)) && Number(v) >= 0)) return `${field} must be a non-negative number`
  }
  for (const field of ['tierLevel', 'earlyAccessDays'] as const) {
    const v = body[field]
    if (!present(v)) {
      if (field === 'tierLevel' && opts.requireTierLevel) return 'tierLevel must be a non-negative integer'
      continue
    }
    if (!(Number.isInteger(Number(v)) && Number(v) >= 0)) return `${field} must be a non-negative integer`
  }
  return null
}

const tiersRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // SUBSCRIPTION TIER ROUTES
  // ============================================================================

  // Get all tiers for an author (public - visible for potential subscribers)
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/subscription-tiers', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const { userId } = request.params

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      // Readers see what they can subscribe to; the author also sees the
      // tiers they have deactivated, so they can manage or restore them.
      const isAuthor = request.user?.id === userId
      const [tiers, paymentConfigResult] = await Promise.all([
        db
          .select()
          .from(subscriptionTiers)
          .where(isAuthor
            ? eq(subscriptionTiers.authorId, userId)
            : and(eq(subscriptionTiers.authorId, userId), eq(subscriptionTiers.isActive, true)))
          .orderBy(subscriptionTiers.tierLevel),
        db
          .select()
          .from(userPaymentConfig)
          .where(eq(userPaymentConfig.userId, userId))
          .limit(1)
      ])

      const config = paymentConfigResult[0]
      const acceptsPayments = !!(config?.stripeAccountId && config?.stripeOnboardingComplete)

      return reply.status(200).send({ tiers, acceptsPayments })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch subscription tiers' })
    }
  })

  // ============================================
  // TIER UNLOCKS — auto-derived view of what each subscription tier unlocks.
  // Author-only. Returns per-tier counts of entities + variants gated exactly
  // at that tier, plus a small name sample, so the monetization UI can show
  // authors what they've actually wired up beyond the freeform benefits.
  // ============================================
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/tier-unlocks', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!requireSelf(request, reply, userId)) return
      if (!isValidUUID(userId)) return reply.status(400).send({ error: 'Invalid user ID' })

      // Fetch tiers for this author (sorted by level so output is stable).
      const tiers = await db
        .select()
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.authorId, userId))
        .orderBy(subscriptionTiers.tierLevel)

      if (tiers.length === 0) {
        return reply.send({ tiers: [] })
      }

      // Entities the author owns: their projects' rows + their collection-
      // scoped rows + their global rows. Skip type-definition rows; those
      // gate whole sections, not individual content.
      const authorProjectIds = (
        await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.ownerId, userId))
      ).map(r => r.id)

      const conditions = [eq(entities.userId, userId)]
      if (authorProjectIds.length > 0) conditions.push(inArray(entities.projectId, authorProjectIds))
      // Collection-scoped: collections where the author owns the collection.
      const authorCollectionIds = (
        await db
          .select({ id: projectCollections.id })
          .from(projectCollections)
          .where(eq(projectCollections.userId, userId))
      ).map(r => r.id)
      if (authorCollectionIds.length > 0) conditions.push(inArray(entities.collectionId, authorCollectionIds))

      const ownedRows = await db
        .select({
          id: entities.id,
          entityData: entities.entityData,
          isPublished: entities.isPublished,
          minimumTierLevel: entities.minimumTierLevel,
          publishBase: entities.publishBase,
          publishedVariantIds: entities.publishedVariantIds,
          variantAccessLevels: entities.variantAccessLevels,
          collectionName: entities.collectionName,
        })
        .from(entities)
        .where(and(
          or(...conditions),
          eq(entities.isPublished, true),
          notDeleted(),
        ))

      // Bucket entities + variants by their effective tier level.
      // Entity at level L means: visible only to subscribers ≥ L.
      // Variant at level L = max(entity.minTier, variant override).
      interface Bucket {
        entityCount: number
        variantCount: number
        sample: string[]
      }
      const buckets = new Map<number, Bucket>()
      const getBucket = (level: number) => {
        let b = buckets.get(level)
        if (!b) {
          b = { entityCount: 0, variantCount: 0, sample: [] }
          buckets.set(level, b)
        }
        return b
      }
      const SAMPLE_LIMIT = 5

      for (const row of ownedRows) {
        if (row.collectionName === 'entity_type_definitions') continue
        const data = row.entityData as Record<string, any>
        const name = typeof data?.name === 'string' ? data.name : '(unnamed)'

        if (row.minimumTierLevel > 0) {
          const b = getBucket(row.minimumTierLevel)
          b.entityCount += 1
          if (b.sample.length < SAMPLE_LIMIT) b.sample.push(name)
        }

        const variantAccess = (row.variantAccessLevels ?? {}) as Record<string, number>
        const publishedVariantIds = row.publishedVariantIds ?? []

        // Published variants (not the base) with an effective tier level above 0
        for (const vid of publishedVariantIds) {
          const effective = Math.max(row.minimumTierLevel, variantAccess[vid] ?? 0)
          if (effective > 0) {
            const variantLabel =
              data?._variants?.items?.[vid]?.label ?? vid
            const b = getBucket(effective)
            b.variantCount += 1
            if (b.sample.length < SAMPLE_LIMIT) b.sample.push(`${name} · ${variantLabel}`)
          }
        }
        // Base view counted via the entity gate above; skip double-counting.
      }

      return reply.send({
        tiers: tiers.map(t => {
          const b = buckets.get(t.tierLevel)
          return {
            tierId: t.id,
            tierLevel: t.tierLevel,
            tierName: t.name,
            entityCount: b?.entityCount ?? 0,
            variantCount: b?.variantCount ?? 0,
            sample: b?.sample ?? [],
          }
        }),
      })
    } catch (error) {
      fastify.log.error(error, 'Failed to compute tier unlocks')
      return reply.status(500).send({ error: 'Failed to compute tier unlocks' })
    }
  })

  // Create subscription tier (own tiers only)
  fastify.post<{
    Params: { userId: string }
    Body: {
      name: string
      description?: string
      priceMonthly?: string
      priceYearly?: string
      benefits?: string[]
      earlyAccessDays?: number | string
      tierLevel: number | string
    }
  }>('/users/:userId/subscription-tiers', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const tierData = request.body

      // Verify user is creating their own tier
      if (!requireSelf(request, reply, userId)) return

      if (!tierData.name || tierData.name.trim().length === 0) {
        return reply.status(400).send({ error: 'Tier name is required' })
      }
      const numberError = invalidTierNumbers(tierData, { requireTierLevel: true })
      if (numberError) return reply.status(400).send({ error: numberError })

      const [tier] = await db
        .insert(subscriptionTiers)
        .values({
          authorId: userId,
          name: tierData.name,
          description: tierData.description,
          priceMonthly: tierData.priceMonthly,
          priceYearly: tierData.priceYearly,
          benefits: tierData.benefits,
          earlyAccessDays: Number(tierData.earlyAccessDays) || 0,
          tierLevel: Number(tierData.tierLevel),
          isActive: true
        })
        .returning()

      // Auto-create Stripe Express account if this is a paid tier and author has no payment config
      let onboardingUrl: string | undefined
      const hasPaidPrice = parseFloat(tierData.priceMonthly || '0') > 0 || parseFloat(tierData.priceYearly || '0') > 0
      if (hasPaidPrice) {
        const [existingConfig] = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, userId)).limit(1)
        if (!existingConfig?.stripeAccountId) {
          const stripe = getStripe()
          if (stripe) {
            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
            if (user) {
              const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)

              const account = await createExpressAccount(stripe, { user, profile })

              await db.insert(userPaymentConfig).values({
                userId,
                stripeAccountId: account.id,
                stripeAccountType: 'express',
                stripeOnboardingComplete: false,
                paymentProvider: 'stripe'
              }).onConflictDoUpdate({
                target: userPaymentConfig.userId,
                set: { stripeAccountId: account.id, stripeAccountType: 'express', updatedAt: new Date() }
              })

              const baseUrl = env.WEB_ORIGIN
              const accountLink = await createOnboardingLink(
                stripe,
                account.id,
                `${baseUrl}/settings/monetization?stripe=complete`,
                `${baseUrl}/settings/monetization?stripe=refresh`
              )
              onboardingUrl = accountLink.url
            }
          }
        }
      }

      return reply.status(201).send({ tier, ...(onboardingUrl ? { onboardingUrl } : {}) })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create subscription tier' })
    }
  })

  // Update subscription tier (own tiers only)
  fastify.put<{
    Params: { userId: string; tierId: string }
    Body: {
      name?: string
      description?: string
      priceMonthly?: string
      priceYearly?: string
      benefits?: string[]
      earlyAccessDays?: number | string
      tierLevel?: number | string
      isActive?: boolean
    }
  }>('/users/:userId/subscription-tiers/:tierId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, tierId } = request.params
      const tierData = request.body

      // Verify user is updating their own tier
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid tier ID format' })
      }
      const numberError = invalidTierNumbers(tierData, { requireTierLevel: false })
      if (numberError) return reply.status(400).send({ error: numberError })

      const [updated] = await db
        .update(subscriptionTiers)
        .set({
          name: tierData.name,
          description: tierData.description,
          priceMonthly: tierData.priceMonthly,
          priceYearly: tierData.priceYearly,
          benefits: tierData.benefits,
          ...(tierData.earlyAccessDays !== undefined ? { earlyAccessDays: Number(tierData.earlyAccessDays) } : {}),
          ...(tierData.tierLevel !== undefined ? { tierLevel: Number(tierData.tierLevel) } : {}),
          isActive: tierData.isActive,
          updatedAt: new Date()
        })
        .where(and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.authorId, userId)
        ))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Tier not found' })
      }

      return reply.status(200).send({ tier: updated })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update subscription tier' })
    }
  })

  // Delete subscription tier (own tiers only)
  fastify.delete<{
    Params: { userId: string; tierId: string }
  }>('/users/:userId/subscription-tiers/:tierId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, tierId } = request.params

      // Verify user is deleting their own tier
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid tier ID format' })
      }

      await db
        .delete(subscriptionTiers)
        .where(and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.authorId, userId)
        ))

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to delete subscription tier' })
    }
  })
}

export default tiersRoutes
