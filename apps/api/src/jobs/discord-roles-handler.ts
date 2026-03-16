/**
 * Discord Role Manager Handler
 *
 * Listens for subscription:changed events and syncs Discord roles
 * based on author-configured tier-to-role mappings.
 */

import { serverEventBus, type DomainEvent } from '../lib/event-bus'
import { db } from '../db/connection'
import { userProfiles, userBobbinsInstalled } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { searchGuildMember, addRole, removeRole } from '../lib/discord-api'

async function getAuthorRolesConfig(authorId: string) {
  const [bobbin] = await db
    .select()
    .from(userBobbinsInstalled)
    .where(
      and(
        eq(userBobbinsInstalled.userId, authorId),
        eq(userBobbinsInstalled.bobbinId, 'discord-roles'),
        eq(userBobbinsInstalled.bobbinType, 'integration'),
        eq(userBobbinsInstalled.isEnabled, true)
      )
    )
    .limit(1)

  return bobbin?.config as any || null
}

async function handleSubscriptionChanged(event: DomainEvent): Promise<void> {
  const { authorId, subscriberId, tierId, tierLevel, action } = event.payload as {
    authorId: string
    subscriberId: string
    tierId: string
    tierLevel: number
    action: 'created' | 'upgraded' | 'downgraded' | 'canceled'
  }

  if (!authorId || !subscriberId) return

  // Check if author has discord-roles configured
  const bobbinConfig = await getAuthorRolesConfig(authorId)
  if (!bobbinConfig?.projects) return

  // Get subscriber's Discord handle
  const [profile] = await db
    .select({ discordHandle: userProfiles.discordHandle })
    .from(userProfiles)
    .where(eq(userProfiles.userId, subscriberId))
    .limit(1)

  if (!profile?.discordHandle) return

  // Process each project the author has configured
  for (const [_projectId, projectConfig] of Object.entries(bobbinConfig.projects)) {
    const config = projectConfig as any
    if (!config.botToken || !config.guildId) continue

    // Find the subscriber in the Discord guild
    const member = await searchGuildMember(config.botToken, config.guildId, profile.discordHandle)
    if (!member) continue

    if (action === 'canceled') {
      // Remove all managed roles
      for (const mapping of Object.values(config.tierRoleMap || {})) {
        const m = mapping as { roleId: string }
        if (m.roleId) {
          const result = await removeRole(config.botToken, config.guildId, member.user.id, m.roleId)
          if (!result.success) {
            console.warn(`[discord-roles] Failed to remove role ${m.roleId} from ${subscriberId}: ${result.error}`)
          }
        }
      }
      continue
    }

    // For create/upgrade/downgrade: check tier level meets threshold
    if (tierLevel < (config.minTierLevel || 0)) {
      // Below threshold — remove any managed roles
      for (const mapping of Object.values(config.tierRoleMap || {})) {
        const m = mapping as { roleId: string }
        if (m.roleId) {
          await removeRole(config.botToken, config.guildId, member.user.id, m.roleId)
        }
      }
      continue
    }

    // Remove old roles first (for upgrade/downgrade), then add new one
    if (action === 'upgraded' || action === 'downgraded') {
      for (const [mappedTierId, mapping] of Object.entries(config.tierRoleMap || {})) {
        const m = mapping as { roleId: string }
        if (m.roleId && mappedTierId !== tierId) {
          await removeRole(config.botToken, config.guildId, member.user.id, m.roleId)
        }
      }
    }

    // Assign the new role
    const roleMapping = config.tierRoleMap?.[tierId] as { roleId: string } | undefined
    if (roleMapping?.roleId) {
      const result = await addRole(config.botToken, config.guildId, member.user.id, roleMapping.roleId)
      if (!result.success) {
        console.warn(`[discord-roles] Failed to assign role ${roleMapping.roleId} to ${subscriberId}: ${result.error}`)
      }
    }

    // Update last sync timestamp
    config.lastSyncAt = new Date().toISOString()
    config.lastSyncStatus = 'success'
  }

  // Persist updated sync timestamps
  const [bobbin] = await db
    .select()
    .from(userBobbinsInstalled)
    .where(
      and(
        eq(userBobbinsInstalled.userId, authorId),
        eq(userBobbinsInstalled.bobbinId, 'discord-roles'),
        eq(userBobbinsInstalled.bobbinType, 'integration')
      )
    )
    .limit(1)

  if (bobbin) {
    await db.update(userBobbinsInstalled).set({
      config: bobbinConfig,
      updatedAt: new Date(),
    }).where(eq(userBobbinsInstalled.id, bobbin.id))
  }
}

export function initDiscordRolesHandler(): void {
  serverEventBus.on('subscription:changed', handleSubscriptionChanged)
  console.log('[discord-roles] Initialized — listening for subscription:changed events')
}
