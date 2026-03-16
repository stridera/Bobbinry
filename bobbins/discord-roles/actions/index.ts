import type { ActionContext, ActionResult, ActionRuntimeHost } from '@bobbinry/action-runtime'

async function createDbCallbacks() {
  const { db } = await import('../../../apps/api/src/db/connection')
  const { subscriptions, subscriptionTiers, userProfiles, userBobbinsInstalled, users } = await import(
    '../../../apps/api/src/db/schema'
  )
  const { eq, and } = await import('drizzle-orm')
  return { db, subscriptions, subscriptionTiers, userProfiles, userBobbinsInstalled, users, eq, and }
}

async function getProjectConfig(userId: string, projectId: string) {
  const { db, userBobbinsInstalled, eq, and } = await createDbCallbacks()
  const [bobbin] = await db
    .select()
    .from(userBobbinsInstalled)
    .where(
      and(
        eq(userBobbinsInstalled.userId, userId),
        eq(userBobbinsInstalled.bobbinId, 'discord-roles'),
        eq(userBobbinsInstalled.bobbinType, 'integration')
      )
    )
    .limit(1)

  if (!bobbin?.config) return null
  const config = bobbin.config as any
  return config.projects?.[projectId] || null
}

export async function testConnection(
  params: { projectId: string; botToken?: string; guildId: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const { testBotConnection, getGuildRoles } = await import('../../../apps/api/src/lib/discord-api')

    // Use provided token or stored one
    let token = params.botToken
    if (!token) {
      const projectConfig = await getProjectConfig(context.userId, params.projectId)
      token = projectConfig?.botToken
    }
    if (!token) {
      return { success: false, error: 'Bot token is required' }
    }

    const connResult = await testBotConnection(token, params.guildId)
    if (!connResult.success) return connResult

    const roles = await getGuildRoles(token, params.guildId)

    return {
      success: true,
      data: {
        guildName: connResult.guildName,
        guildRoles: (roles || [])
          .filter(r => r.name !== '@everyone')
          .sort((a, b) => b.position - a.position)
          .map(r => ({ id: r.id, name: r.name, position: r.position })),
      },
    }
  } catch (error) {
    runtime.log.error({ error }, 'testConnection failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function syncRoles(
  params: { projectId: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const projectConfig = await getProjectConfig(context.userId, params.projectId)
    if (!projectConfig?.botToken || !projectConfig?.guildId) {
      return { success: false, error: 'Discord bot not configured for this project' }
    }

    const { db, subscriptions, subscriptionTiers, userProfiles, users, eq, and } = await createDbCallbacks()
    const { searchGuildMember, addRole, removeRole } = await import('../../../apps/api/src/lib/discord-api')

    // Get active subscribers for this author
    const activeSubs = await db
      .select({
        subscriberId: subscriptions.subscriberId,
        tierId: subscriptions.tierId,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.authorId, context.userId),
          eq(subscriptions.status, 'active')
        )
      )

    // Get tier info
    const tierIds = [...new Set(activeSubs.map(s => s.tierId))]
    const tierMap = new Map<string, number>()
    for (const tierId of tierIds) {
      const [tier] = await db
        .select({ id: subscriptionTiers.id, tierLevel: subscriptionTiers.tierLevel })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.id, tierId))
        .limit(1)
      if (tier) tierMap.set(tier.id, tier.tierLevel)
    }

    let synced = 0
    let skipped = 0
    let errors = 0

    for (const sub of activeSubs) {
      const tierLevel = tierMap.get(sub.tierId) || 0
      if (tierLevel < projectConfig.minTierLevel) {
        skipped++
        continue
      }

      // Get subscriber's Discord handle
      const [profile] = await db
        .select({ discordHandle: userProfiles.discordHandle })
        .from(userProfiles)
        .where(eq(userProfiles.userId, sub.subscriberId))
        .limit(1)

      if (!profile?.discordHandle) {
        skipped++
        continue
      }

      // Find Discord user in guild
      const member = await searchGuildMember(projectConfig.botToken, projectConfig.guildId, profile.discordHandle)
      if (!member) {
        skipped++
        continue
      }

      // Determine which role to assign
      const roleMapping = projectConfig.tierRoleMap?.[sub.tierId]
      if (!roleMapping?.roleId) {
        skipped++
        continue
      }

      // Assign the role
      const result = await addRole(projectConfig.botToken, projectConfig.guildId, member.user.id, roleMapping.roleId)
      if (result.success) {
        synced++
      } else {
        errors++
        runtime.log.warn({ subscriberId: sub.subscriberId, error: result.error }, 'Failed to assign role')
      }
    }

    return {
      success: errors === 0,
      data: { synced, skipped, errors },
    }
  } catch (error) {
    runtime.log.error({ error }, 'syncRoles failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function syncSingleUser(
  params: { projectId: string; subscriberId: string; action?: 'add' | 'remove' },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const projectConfig = await getProjectConfig(context.userId, params.projectId)
    if (!projectConfig?.botToken || !projectConfig?.guildId) {
      return { success: false, error: 'Discord bot not configured for this project' }
    }

    const { db, subscriptions, subscriptionTiers, userProfiles, eq, and } = await createDbCallbacks()
    const { searchGuildMember, addRole, removeRole } = await import('../../../apps/api/src/lib/discord-api')

    // Get subscriber's Discord handle
    const [profile] = await db
      .select({ discordHandle: userProfiles.discordHandle })
      .from(userProfiles)
      .where(eq(userProfiles.userId, params.subscriberId))
      .limit(1)

    if (!profile?.discordHandle) {
      return { success: false, error: 'Subscriber has no Discord handle set' }
    }

    // Find Discord user in guild
    const member = await searchGuildMember(projectConfig.botToken, projectConfig.guildId, profile.discordHandle)
    if (!member) {
      return { success: false, error: 'Discord user not found in server' }
    }

    // Get active subscription
    const [sub] = await db
      .select({ tierId: subscriptions.tierId, status: subscriptions.status })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriberId, params.subscriberId),
          eq(subscriptions.authorId, context.userId)
        )
      )
      .limit(1)

    const shouldRemove = params.action === 'remove' || !sub || sub.status !== 'active'

    if (shouldRemove) {
      // Remove all managed roles
      for (const mapping of Object.values(projectConfig.tierRoleMap || {})) {
        const m = mapping as { roleId: string }
        if (m.roleId) {
          await removeRole(projectConfig.botToken, projectConfig.guildId, member.user.id, m.roleId)
        }
      }
      return { success: true, data: { action: 'removed' } }
    }

    // Add the appropriate role
    const roleMapping = projectConfig.tierRoleMap?.[sub.tierId] as { roleId: string } | undefined
    if (!roleMapping?.roleId) {
      return { success: false, error: 'No role mapping for this tier' }
    }

    const result = await addRole(projectConfig.botToken, projectConfig.guildId, member.user.id, roleMapping.roleId)
    return result.success
      ? { success: true, data: { action: 'added', roleId: roleMapping.roleId } }
      : { success: false, error: result.error }
  } catch (error) {
    runtime.log.error({ error }, 'syncSingleUser failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const actions = {
  sync_roles: syncRoles,
  sync_single_user: syncSingleUser,
  test_connection: testConnection,
}
