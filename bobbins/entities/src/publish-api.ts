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

function baseUrl(sdk: BobbinrySDK): string {
  // BobbinryAPI exposes apiBaseUrl (e.g. "http://localhost:4100/api").
  // The endpoints we call are nested at /api/... so apiBaseUrl is right.
  return (sdk as any).api.apiBaseUrl as string
}

function headers(sdk: BobbinrySDK, withBody = false): Record<string, string> {
  const h = (sdk as any).api.getAuthHeaders(
    withBody ? { 'Content-Type': 'application/json' } : undefined
  ) as Record<string, string>
  return h
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
  patch: { isPublished?: boolean; publishOrder?: number; minimumTierLevel?: number }
): Promise<PublishState> {
  const res = await fetch(`${baseUrl(sdk)}/entities/${entityId}/publish`, {
    method: 'PATCH',
    headers: headers(sdk, true),
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
  const res = await fetch(
    `${baseUrl(sdk)}/projects/${projectId}/entity-types/${typeId}/publish`,
    {
      method: 'PATCH',
      headers: headers(sdk, true),
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
  const res = await fetch(`${baseUrl(sdk)}/projects/${projectId}/entities/reorder`, {
    method: 'POST',
    headers: headers(sdk, true),
    body: JSON.stringify({ collection, orderedIds }),
  })
  return handle<{ success: boolean; reordered: number }>(res, 'Reorder entities')
}

export async function reorderTypes(
  sdk: BobbinrySDK,
  projectId: string,
  orderedTypeIds: string[]
): Promise<{ reordered: number }> {
  const res = await fetch(`${baseUrl(sdk)}/projects/${projectId}/entity-types/reorder`, {
    method: 'POST',
    headers: headers(sdk, true),
    body: JSON.stringify({ orderedTypeIds }),
  })
  return handle<{ success: boolean; reordered: number }>(res, 'Reorder entity types')
}

export async function fetchSubscriptionTiers(
  sdk: BobbinrySDK,
  authorId: string
): Promise<{ tiers: SubscriptionTier[]; acceptsPayments: boolean }> {
  const res = await fetch(`${baseUrl(sdk)}/users/${authorId}/subscription-tiers`, {
    headers: headers(sdk),
  })
  return handle<{ tiers: SubscriptionTier[]; acceptsPayments: boolean }>(
    res,
    'Fetch subscription tiers'
  )
}

export async function fetchProjectOwner(
  sdk: BobbinrySDK,
  projectId: string
): Promise<{ ownerId: string }> {
  // BobbinrySDK exposes sdk.api.getProject on BobbinryAPI — reach through for now.
  const project = await (sdk as any).api.getProject(projectId)
  return { ownerId: project.ownerId as string }
}
