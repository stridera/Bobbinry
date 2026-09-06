/**
 * Publish/tier/reorder API client for the entities bobbin.
 *
 * Thin wrapper over BobbinrySDK's underlying fetch — there's no built-in
 * method for these endpoints because they live outside the generic
 * entity CRUD flow.
 */

import type { BobbinrySDK } from '@bobbinry/sdk'

export interface PublishState {
  id: string
  isPublished: boolean
  publishedAt: string | null
  publishOrder: number
  minimumTierLevel: number
  publishBase: boolean
  publishedVariantIds: string[]
  variantAccessLevels: Record<string, number>
}

export interface SubscriptionTier {
  id: string
  authorId: string
  name: string
  description: string | null
  tierLevel: number
  priceMonthly: string | null
  priceYearly: string | null
  benefits: string[] | null
  earlyAccessDays: number
}

/** Authenticated request through the SDK; `path` is relative to the API base. */
function apiFetch(sdk: BobbinrySDK, path: string, init?: RequestInit): Promise<Response> {
  return sdk.api.fetch(path, init)
}

async function handle<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${action} failed (${res.status}): ${body || res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function patchEntityPublish(
  sdk: BobbinrySDK,
  projectId: string,
  collection: string,
  entityId: string,
  patch: {
    isPublished?: boolean
    publishOrder?: number
    minimumTierLevel?: number
    publishBase?: boolean
    publishedVariantIds?: string[]
    variantAccessLevels?: Record<string, number>
  }
): Promise<PublishState> {
  const res = await apiFetch(sdk, `/entities/${entityId}/publish`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, collection, ...patch }),
  })
  return handle<PublishState>(res, 'Update entity publish state')
}

export async function patchTypePublish(
  sdk: BobbinrySDK,
  projectId: string,
  typeId: string,
  patch: { isPublished?: boolean; publishOrder?: number; minimumTierLevel?: number }
): Promise<PublishState> {
  const res = await apiFetch(
    sdk,
    `/projects/${projectId}/entity-types/${typeId}/publish`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  )
  return handle<PublishState>(res, 'Update type publish state')
}

export async function reorderEntities(
  sdk: BobbinrySDK,
  projectId: string,
  collection: string,
  orderedIds: string[]
): Promise<{ reordered: number }> {
  const res = await apiFetch(sdk, `/projects/${projectId}/entities/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, orderedIds }),
  })
  return handle<{ success: boolean; reordered: number }>(res, 'Reorder entities')
}

export async function reorderTypes(
  sdk: BobbinrySDK,
  projectId: string,
  orderedTypeIds: string[]
): Promise<{ reordered: number }> {
  const res = await apiFetch(sdk, `/projects/${projectId}/entity-types/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedTypeIds }),
  })
  return handle<{ success: boolean; reordered: number }>(res, 'Reorder entity types')
}

export async function fetchSubscriptionTiers(
  sdk: BobbinrySDK,
  authorId: string
): Promise<{ tiers: SubscriptionTier[]; acceptsPayments: boolean }> {
  const res = await apiFetch(sdk, `/users/${authorId}/subscription-tiers`)
  return handle<{ tiers: SubscriptionTier[]; acceptsPayments: boolean }>(
    res,
    'Fetch subscription tiers'
  )
}

export async function fetchProjectOwner(
  sdk: BobbinrySDK,
  projectId: string
): Promise<{ ownerId: string }> {
  // BobbinrySDK exposes sdk.api.getProject on BobbinryAPI, which wraps the
  // project in a `project` key: { project: { id, ownerId, ... } }.
  const response = await (sdk as any).api.getProject(projectId)
  const ownerId = response?.project?.ownerId ?? response?.ownerId
  if (typeof ownerId !== 'string') {
    throw new Error(`Project ${projectId} did not return an owner id`)
  }
  return { ownerId }
}
