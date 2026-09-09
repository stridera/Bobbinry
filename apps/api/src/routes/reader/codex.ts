/** Published entities (reader codex). Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { entities, projects } from '../../db/schema'
import { findActiveSubscription } from '../../lib/chapter-access'
import { effectiveOverrides, resolveEntityForVariant, sortedVariantIds, variantConfigFromTypeData, versionableFieldNames, type VariantResolutionConfig } from '@bobbinry/types'
import { eq, and, asc, sql, inArray } from 'drizzle-orm'
import { optionalAuth } from '../../middleware/auth'
import { getEffectiveBobbins, getCollectionIdsForProject, buildScopeCondition } from '../../lib/effective-bobbins'
import { resolveSlug, getSlugsForEntities } from '../../lib/slugs'
import { canViewProject, resolveViewAs, type EffectiveViewer } from './shared'

const codexRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // PUBLISHED ENTITIES (READER CODEX)
  // ============================================

  /**
   * Resolve the caller's effective subscription tier level against a project
   * owner. Owner → Infinity, active subscriber → their tier_level, otherwise 0.
   */
  async function resolveCallerTierLevel(projectId: string, callerId: string | undefined): Promise<number> {
    if (!callerId) return 0
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project) return 0
    if (project.ownerId === callerId) return Number.POSITIVE_INFINITY

    const sub = await findActiveSubscription(callerId, project.ownerId)
    return sub?.tierLevel ?? 0
  }

  /**
   * Codex tier level for an effective viewer, honoring ?viewAs=.
   *
   * Under a simulation the owner must lose their Infinity bypass, or "view as
   * visitor" would still hand them every tier-gated entity and every locked
   * variant. Beta resolves to 0 because the codex has no beta concept — a real
   * beta reader with no subscription sits at 0 too.
   */
  async function resolveViewerTierLevel(projectId: string, viewer: EffectiveViewer): Promise<number> {
    if (viewer.simulate) return viewer.simulate.kind === 'tier' ? viewer.simulate.tierLevel : 0
    return resolveCallerTierLevel(projectId, viewer.userId)
  }

  interface ReaderVariantItem {
    label?: string | undefined
    axis_value?: unknown
    overrides?: Record<string, unknown> | undefined
  }

  interface ReaderVariantsBlock {
    axis_id?: string | null
    active?: string | null
    order?: string[]
    items?: Record<string, ReaderVariantItem>
  }

  /**
   * Card-thumbnail URL for an entity's (sanitized) data: the designated
   * `thumbnail` when its url is in the `images` gallery, else the first
   * gallery image, else the legacy `image_url`. Mirrors getEntityThumbnail
   * in bobbins/entities/src/images.ts — keep in lockstep.
   */
  function deriveThumbnailUrl(data: Record<string, unknown> | null | undefined): string | null {
    if (!data) return null
    const rawImages = Array.isArray(data.images) ? data.images : []
    const urls: string[] = []
    for (const entry of rawImages) {
      if (typeof entry === 'string' && entry) urls.push(entry)
      else if (entry && typeof entry === 'object' && typeof (entry as any).url === 'string' && (entry as any).url) {
        urls.push((entry as any).url)
      }
    }
    if (urls.length === 0) {
      return typeof data.image_url === 'string' && data.image_url ? data.image_url : null
    }
    const thumb = data.thumbnail
    if (thumb && typeof thumb === 'object' && typeof (thumb as any).url === 'string' && urls.includes((thumb as any).url)) {
      return (thumb as any).url
    }
    return urls[0] ?? null
  }

  /**
   * Card fields (name / description / thumbnail) for an entity.
   *
   * These are a convenience projection off the top level of the sanitized
   * data. When the base view is hidden that top level can be missing the very
   * fields every visible era overrides, so resolve at the first visible era
   * instead.
   *
   * That era is picked in **axis** order, never by indexing
   * `publishedVariantIds` — that array is stored in the order the author
   * toggled the checkboxes, so on an ordered axis its first element is
   * arbitrary.
   */
  function cardProjection(
    sanitizedData: Record<string, any>,
    variantConfig: VariantResolutionConfig,
    visibleBase: boolean,
    visibleVariantIds: string[]
  ): { name: unknown; description: unknown; imageUrl: string | null } {
    let view = sanitizedData
    if (!visibleBase && visibleVariantIds.length > 0) {
      const firstEra = sortedVariantIds(sanitizedData, variantConfig.variantAxis?.kind ?? null, {
        eraIds: visibleVariantIds,
      })[0]
      if (firstEra) {
        view = resolveEntityForVariant(sanitizedData, variantConfig, firstEra, {
          eraIds: visibleVariantIds,
        })
      }
    }
    return {
      name: view?.name ?? null,
      description: view?.description ?? null,
      imageUrl: deriveThumbnailUrl(view),
    }
  }

  /**
   * Rebuild entityData so it contains only what the caller may see. The raw DB
   * record holds every base field plus the full `_variants` block — published
   * or not, tier-gated or not — so returning it verbatim hands hidden variant
   * content to anyone reading the network response, even though the metadata
   * (publishBase / publishedVariantIds) says it's locked.
   *
   * Base fields ship when the base view is visible, or when a visible variant
   * can still render them. A versionable field's base value is dropped when the
   * base is hidden and every visible variant resolves it to something else —
   * that value is never rendered through any visible view. An empty gallery
   * override doesn't count as covering: those variants inherit, so the base
   * value may still be rendered.
   *
   * "Resolves to something else" is `effectiveOverrides` rather than a literal
   * `field in overrides` check, because a forward-inheriting field can be
   * covered by an *earlier* era. Crucially the fill runs over the **visible**
   * era set only: a reader must never inherit a value from an era gated above
   * their tier, which on an early-access axis is exactly the paywalled one.
   * For `inherit: 'base'` fields this reduces to the original predicate.
   */
  function sanitizeEntityDataForReader(
    data: Record<string, unknown>,
    visibleBase: boolean,
    visibleVariantIds: string[],
    variantConfig: VariantResolutionConfig
  ): Record<string, unknown> {
    if (!visibleBase && visibleVariantIds.length === 0) return {}

    const versionableFields = versionableFieldNames(variantConfig)
    const { _variants, ...base } = data
    const variantsRoot = (_variants ?? {}) as ReaderVariantsBlock
    const rawItems = variantsRoot.items ?? {}

    const visibleItems: Record<string, ReaderVariantItem> = {}
    for (const vid of visibleVariantIds) {
      const item = rawItems[vid]
      if (!item) continue
      const overrides: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(item.overrides ?? {})) {
        if (versionableFields.has(key)) overrides[key] = value
      }
      visibleItems[vid] = { label: item.label, axis_value: item.axis_value ?? null, overrides }
    }

    const sanitized: Record<string, unknown> = { ...base }
    if (!visibleBase) {
      const effective = new Map(
        visibleVariantIds.map(vid => [
          vid,
          effectiveOverrides(data, variantConfig, vid, { eraIds: visibleVariantIds }),
        ])
      )
      for (const field of versionableFields) {
        const renderedNowhere = visibleVariantIds.every(
          vid => effective.get(vid)?.[field] !== undefined
        )
        if (renderedNowhere) delete sanitized[field]
      }
    }

    if (visibleVariantIds.length > 0) {
      const visibleSet = new Set(visibleVariantIds)
      const active = variantsRoot.active
      sanitized['_variants'] = {
        axis_id: variantsRoot.axis_id ?? null,
        active: typeof active === 'string' && visibleSet.has(active) ? active : null,
        order: (variantsRoot.order ?? []).filter(vid => visibleSet.has(vid)),
        items: visibleItems,
      }
    }

    return sanitized
  }

  /**
   * List published entities for the public reader, grouped by published type.
   * Gated by subscriber tier level when minimum_tier_level > 0.
   */
  fastify.get<{
    Params: { projectId: string }
    Querystring: { viewAs?: string }
  }>('/public/projects/:projectId/entities', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params

      // Confirm project exists and grab owner for bobbin-installed lookup
      const [project] = await db
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      const viewer = await resolveViewAs(projectId, request.user?.id, request.query.viewAs)

      if (!(await canViewProject(projectId, viewer.userId, viewer.simulate))) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      const effective = await getEffectiveBobbins(projectId, project.ownerId)
      const entitiesInstalled = effective.find(b => b.bobbinId === 'entities' && b.enabled)
      if (!entitiesInstalled) {
        return { installed: false, callerTierLevel: 0, types: [], lockedPreviews: { types: 0, entities: 0, variants: 0 } }
      }

      const callerTier = await resolveViewerTierLevel(projectId, viewer)
      const isOwner = callerTier === Number.POSITIVE_INFINITY

      // Resolve entity-visibility scope for this project: project, any
      // collections it belongs to, and the owner's global entities. This
      // mirrors buildScopeCondition() used by the author-side routes so
      // collection-scoped type defs + entities show on the reader too.
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, project.ownerId)

      // 1) Load all published type-definition rows visible from this project
      const typeRows = await db
        .select({
          id: entities.id,
          data: entities.entityData,
          isPublished: entities.isPublished,
          publishOrder: entities.publishOrder,
          minimumTierLevel: entities.minimumTierLevel,
        })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, 'entity_type_definitions'),
          eq(entities.isPublished, true)
        ))
        .orderBy(asc(entities.publishOrder))

      const visibleTypes = typeRows.filter(t => isOwner || t.minimumTierLevel <= callerTier)
      const lockedTypes = typeRows.length - visibleTypes.length

      // 2) Load published entities for each visible type, tier-filtered
      let lockedEntityCount = 0
      const typeIds = visibleTypes
        .map(t => (t.data as Record<string, unknown>)?.type_id)
        .filter((v): v is string => typeof v === 'string')

      const entityRowsByType = new Map<string, typeof entities.$inferSelect[]>()
      if (typeIds.length > 0) {
        const entityRows = await db
          .select()
          .from(entities)
          .where(and(
            scopeFilter,
            inArray(entities.collectionName, typeIds),
            eq(entities.isPublished, true)
          ))
          .orderBy(asc(entities.publishOrder))

        for (const row of entityRows) {
          const list = entityRowsByType.get(row.collectionName) ?? []
          list.push(row)
          entityRowsByType.set(row.collectionName, list)
        }
      }

      const codexSlugMap = await getSlugsForEntities(
        projectId,
        [...entityRowsByType.values()].flat().map(r => r.id)
      )

      let lockedVariantCount = 0
      const types = visibleTypes.map(t => {
        const typeData = t.data as Record<string, any>
        const typeId = typeData.type_id as string
        const variantConfig = variantConfigFromTypeData(typeData)
        const rows = entityRowsByType.get(typeId) ?? []
        const visibleRows = isOwner ? rows : rows.filter(r => r.minimumTierLevel <= callerTier)
        lockedEntityCount += rows.length - visibleRows.length
        // Per-tier bucket of entities the caller can't see yet. Drives the
        // spoiler-safe "🔒 Tier N" teaser cards on the reader.
        const lockedByTier: Record<number, number> = {}
        if (!isOwner) {
          for (const r of rows) {
            if (r.minimumTierLevel > callerTier) {
              lockedByTier[r.minimumTierLevel] = (lockedByTier[r.minimumTierLevel] ?? 0) + 1
            }
          }
        }

        return {
          typeId,
          label: typeData.label,
          icon: typeData.icon ?? '📋',
          listLayout: typeData.list_layout,
          editorLayout: typeData.editor_layout,
          customFields: typeData.custom_fields ?? [],
          baseFields: typeData.base_fields ?? ['name', 'description', 'tags', 'image_url'],
          versionableBaseFields: typeData.versionable_base_fields ?? [],
          subtitleFields: typeData.subtitle_fields ?? [],
          variantAxis: typeData.variant_axis ?? null,
          variantInheritance: typeData.variant_inheritance ?? {},
          minimumTierLevel: t.minimumTierLevel,
          publishOrder: t.publishOrder,
          lockedByTier,
          entities: visibleRows.map(r => {
            const data = r.entityData as Record<string, unknown>
            const publishedVariantIds = r.publishedVariantIds ?? []
            const variantAccess = (r.variantAccessLevels ?? {}) as Record<string, number>

            // Filter out variants the caller can't reach. Effective gate is
            // max(entity.minTier, variant's access level). Entity-level gate
            // already applied above (visibleRows), so the only additional
            // filter here is the per-variant level.
            let visibleBase = r.publishBase
            let visibleVariantIds = publishedVariantIds
            if (!isOwner) {
              const baseEffective = Math.max(r.minimumTierLevel, variantAccess['__base__'] ?? 0)
              if (baseEffective > callerTier) visibleBase = false
              const filteredIds = publishedVariantIds.filter(vid => {
                const effective = Math.max(r.minimumTierLevel, variantAccess[vid] ?? 0)
                return effective <= callerTier
              })
              const hiddenVariantCount =
                (r.publishBase && !visibleBase ? 1 : 0) +
                (publishedVariantIds.length - filteredIds.length)
              lockedVariantCount += hiddenVariantCount
              visibleVariantIds = filteredIds
            }

            const sanitizedData = isOwner
              ? data
              : sanitizeEntityDataForReader(data, visibleBase, visibleVariantIds, variantConfig)
            const card = cardProjection(sanitizedData, variantConfig, visibleBase, visibleVariantIds)

            return {
              id: r.id,
              slug: codexSlugMap.get(r.id) ?? null,
              typeId,
              name: card.name ?? null,
              description: card.description ?? null,
              imageUrl: card.imageUrl,
              tags: Array.isArray(sanitizedData?.tags) ? sanitizedData.tags : [],
              entityData: sanitizedData,
              publishOrder: r.publishOrder,
              minimumTierLevel: r.minimumTierLevel,
              publishedAt: r.publishedAt,
              publishBase: visibleBase,
              publishedVariantIds: visibleVariantIds,
              variantAccessLevels: isOwner ? variantAccess : undefined,
              lockedVariantCount:
                !isOwner
                  ? (r.publishBase && !visibleBase ? 1 : 0) +
                    (publishedVariantIds.length - visibleVariantIds.length)
                  : 0,
            }
          }),
        }
      })

      return {
        installed: true,
        callerTierLevel: isOwner ? -1 : callerTier,
        types,
        lockedPreviews: {
          types: lockedTypes,
          entities: lockedEntityCount,
          variants: lockedVariantCount,
        },
      }
    } catch (error) {
      fastify.log.error(error, 'Failed to list published entities')
      return reply.status(500).send({ error: 'Failed to list published entities' })
    }
  })

  /**
   * Single published entity (for the /entity/<id> subpage and the modal view).
   * Returns the type + entity so the client can render with LayoutRenderer
   * without loading the full codex. Applies the same tier/scope gating as
   * the listing endpoint.
   */
  fastify.get<{
    Params: { projectId: string; entityId: string }
    Querystring: { viewAs?: string }
  }>('/public/projects/:projectId/entities/:entityId', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    try {
      const { projectId, entityId: entityParam } = request.params

      // The URL param may be the entity's slug, an old slug alias, or a UUID.
      const resolved = await resolveSlug(projectId, entityParam)
      if (!resolved) return reply.status(404).send({ error: 'Entity not found' })
      const entityId = resolved.entityId

      const [project] = await db
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      const viewer = await resolveViewAs(projectId, request.user?.id, request.query.viewAs)

      if (!(await canViewProject(projectId, viewer.userId, viewer.simulate))) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      const effective = await getEffectiveBobbins(projectId, project.ownerId)
      const installed = effective.find(b => b.bobbinId === 'entities' && b.enabled)
      if (!installed) return reply.status(404).send({ error: 'Entities not available' })

      const callerTier = await resolveViewerTierLevel(projectId, viewer)
      const isOwner = callerTier === Number.POSITIVE_INFINITY

      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, project.ownerId)

      // Locate the entity row, constrained to this project's visible scope
      // and to published state (or owner bypass).
      const [entityRow] = await db
        .select()
        .from(entities)
        .where(and(scopeFilter, eq(entities.id, entityId)))
        .limit(1)
      if (!entityRow) return reply.status(404).send({ error: 'Entity not found' })
      if (entityRow.collectionName === 'entity_type_definitions') {
        return reply.status(404).send({ error: 'Entity not found' })
      }
      if (!isOwner) {
        if (!entityRow.isPublished) return reply.status(404).send({ error: 'Entity not found' })
        if (entityRow.minimumTierLevel > callerTier) {
          return reply.status(403).send({ error: 'Subscription required', minimumTierLevel: entityRow.minimumTierLevel })
        }
      }

      // Load the type row (published + tier-visible) so we can return the
      // layout metadata the client needs to render.
      const [typeRow] = await db
        .select()
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, 'entity_type_definitions'),
          sql`${entities.entityData}->>'type_id' = ${entityRow.collectionName}`,
        ))
        .limit(1)
      if (!typeRow) return reply.status(404).send({ error: 'Entity type not found' })
      if (!isOwner) {
        // An unpublished type hides its entities entirely (matching the listing);
        // only a tier gap is a paywall.
        if (!typeRow.isPublished) return reply.status(404).send({ error: 'Entity not found' })
        if (typeRow.minimumTierLevel > callerTier) {
          return reply.status(403).send({ error: 'Subscription required', minimumTierLevel: typeRow.minimumTierLevel })
        }
      }

      const typeData = typeRow.entityData as Record<string, any>
      const data = entityRow.entityData as Record<string, unknown>
      const publishedVariantIds = entityRow.publishedVariantIds ?? []
      const variantAccess = (entityRow.variantAccessLevels ?? {}) as Record<string, number>

      let visibleBase = entityRow.publishBase
      let visibleVariantIds = publishedVariantIds
      let lockedVariantCount = 0
      if (!isOwner) {
        const baseEffective = Math.max(entityRow.minimumTierLevel, variantAccess['__base__'] ?? 0)
        if (baseEffective > callerTier) visibleBase = false
        visibleVariantIds = publishedVariantIds.filter(vid => {
          const effective = Math.max(entityRow.minimumTierLevel, variantAccess[vid] ?? 0)
          return effective <= callerTier
        })
        lockedVariantCount =
          (entityRow.publishBase && !visibleBase ? 1 : 0) +
          (publishedVariantIds.length - visibleVariantIds.length)
      }

      const variantConfig = variantConfigFromTypeData(typeData)
      const sanitizedData = isOwner
        ? data
        : sanitizeEntityDataForReader(data, visibleBase, visibleVariantIds, variantConfig)
      const card = cardProjection(sanitizedData, variantConfig, visibleBase, visibleVariantIds)

      return {
        type: {
          typeId: typeData.type_id,
          label: typeData.label,
          icon: typeData.icon ?? '📋',
          listLayout: typeData.list_layout,
          editorLayout: typeData.editor_layout,
          customFields: typeData.custom_fields ?? [],
          baseFields: typeData.base_fields ?? ['name', 'description', 'tags', 'image_url'],
          versionableBaseFields: typeData.versionable_base_fields ?? [],
          subtitleFields: typeData.subtitle_fields ?? [],
          variantAxis: typeData.variant_axis ?? null,
          variantInheritance: typeData.variant_inheritance ?? {},
          minimumTierLevel: typeRow.minimumTierLevel,
          publishOrder: typeRow.publishOrder,
        },
        entity: {
          id: entityRow.id,
          slug: resolved.currentSlug,
          typeId: entityRow.collectionName,
          name: (card.name as string) ?? null,
          description: (card.description as string) ?? null,
          imageUrl: card.imageUrl,
          tags: Array.isArray(sanitizedData?.tags) ? sanitizedData.tags : [],
          entityData: sanitizedData,
          publishOrder: entityRow.publishOrder,
          minimumTierLevel: entityRow.minimumTierLevel,
          publishedAt: entityRow.publishedAt,
          publishBase: visibleBase,
          publishedVariantIds: visibleVariantIds,
          variantAccessLevels: isOwner ? variantAccess : undefined,
          lockedVariantCount,
        },
        callerTierLevel: isOwner ? -1 : callerTier,
      }
    } catch (error) {
      fastify.log.error(error, 'Failed to load single entity')
      return reply.status(500).send({ error: 'Failed to load entity' })
    }
  })

  /**
   * Lightweight list of published entity names for the chapter-page highlighter.
   * Returns only { id, name, typeId, typeIcon, typeLabel } rows — matches the
   * EntityEntry shape in bobbins/manuscript/src/extensions/entity-highlight.ts.
   */
  fastify.get<{
    Params: { projectId: string }
    Querystring: { viewAs?: string }
  }>('/public/projects/:projectId/entities/published-names', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params

      const [project] = await db
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      const viewer = await resolveViewAs(projectId, request.user?.id, request.query.viewAs)

      if (!(await canViewProject(projectId, viewer.userId, viewer.simulate))) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      const effective = await getEffectiveBobbins(projectId, project.ownerId)
      const installed = effective.find(b => b.bobbinId === 'entities' && b.enabled)
      if (!installed) return { installed: false, entities: [] }

      const callerTier = await resolveViewerTierLevel(projectId, viewer)
      const isOwner = callerTier === Number.POSITIVE_INFINITY

      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, project.ownerId)

      const typeRows = await db
        .select({
          id: entities.id,
          data: entities.entityData,
          minimumTierLevel: entities.minimumTierLevel,
        })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, 'entity_type_definitions'),
          eq(entities.isPublished, true),
        ))

      interface TypeMeta { label: string; icon: string; variantConfig: VariantResolutionConfig }
      const visibleTypeMeta = new Map<string, TypeMeta>()
      for (const t of typeRows) {
        if (!isOwner && t.minimumTierLevel > callerTier) continue
        const d = t.data as Record<string, any>
        if (typeof d?.type_id !== 'string') continue
        visibleTypeMeta.set(d.type_id, {
          label: d.label ?? d.type_id,
          icon: d.icon ?? '📋',
          variantConfig: variantConfigFromTypeData(d),
        })
      }

      if (visibleTypeMeta.size === 0) return { installed: true, entities: [] }

      const entityRows = await db
        .select({
          id: entities.id,
          data: entities.entityData,
          collectionName: entities.collectionName,
          minimumTierLevel: entities.minimumTierLevel,
          publishBase: entities.publishBase,
          publishedVariantIds: entities.publishedVariantIds,
          variantAccessLevels: entities.variantAccessLevels,
        })
        .from(entities)
        .where(and(
          scopeFilter,
          inArray(entities.collectionName, Array.from(visibleTypeMeta.keys())),
          eq(entities.isPublished, true),
        ))

      const nameSlugMap = await getSlugsForEntities(projectId, entityRows.map(r => r.id))

      // Build one row per (entity, distinct visible name). The highlight matcher
      // on the client dedupes by lowercase name and keeps a list per match.
      const rows: { id: string; slug: string | null; name: string; typeId: string; typeIcon: string; typeLabel: string }[] = []
      for (const r of entityRows) {
        if (!isOwner && r.minimumTierLevel > callerTier) continue
        const meta = visibleTypeMeta.get(r.collectionName)!
        const data = r.data as Record<string, any>
        const baseName = typeof data?.name === 'string' ? (data.name as string) : ''
        const seen = new Set<string>()
        const pushName = (candidate: unknown) => {
          if (typeof candidate !== 'string') return
          const trimmed = candidate.trim()
          if (!trimmed) return
          const key = trimmed.toLowerCase()
          if (seen.has(key)) return
          seen.add(key)
          rows.push({
            id: r.id,
            slug: nameSlugMap.get(r.id) ?? null,
            name: trimmed,
            typeId: r.collectionName,
            typeIcon: meta.icon,
            typeLabel: meta.label,
          })
        }

        // Apply the same per-variant tier gates as the codex endpoints so a
        // locked variant's name override (often itself a spoiler) never ships.
        const variantAccess = (r.variantAccessLevels ?? {}) as Record<string, number>
        const visibleBase = r.publishBase &&
          (isOwner || Math.max(r.minimumTierLevel, variantAccess['__base__'] ?? 0) <= callerTier)
        const variantIds = (r.publishedVariantIds ?? []).filter(vid =>
          isOwner || Math.max(r.minimumTierLevel, variantAccess[vid] ?? 0) <= callerTier
        )

        if (visibleBase) pushName(baseName)

        // Resolve each visible era's effective name. Filling over `variantIds`
        // only means an era never surfaces a name inherited from one gated
        // above this caller's tier.
        for (const vid of variantIds) {
          const resolved = effectiveOverrides(data, meta.variantConfig, vid, { eraIds: variantIds }).name
          pushName(typeof resolved === 'string' ? resolved : baseName)
        }

        // Aliases are entity-level alternate names (nicknames, epithets, titles).
        // Emit one row per alias so the client matcher treats them as separate
        // match targets that resolve to the same entity id. Only when some view
        // of the entity is actually visible to this caller.
        if ((visibleBase || variantIds.length > 0) && Array.isArray(data?.aliases)) {
          for (const alias of data.aliases) pushName(alias)
        }
      }

      return { installed: true, entities: rows }
    } catch (error) {
      fastify.log.error(error, 'Failed to list published entity names')
      return reply.status(500).send({ error: 'Failed to list entities' })
    }
  })
}

export default codexRoutes
