/**
 * Discord REST API Client
 *
 * Lightweight utility for outbound Discord API calls.
 * Used by both discord-notifier (webhooks) and discord-roles (bot REST).
 * No gateway connection — pure HTTP.
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10'

interface DiscordEmbed {
  title?: string
  description?: string
  url?: string
  color?: number
  thumbnail?: { url: string }
  image?: { url: string }
  footer?: { text: string; icon_url?: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  timestamp?: string
}

interface WebhookPayload {
  content?: string | undefined
  embeds?: DiscordEmbed[]
  username?: string
  avatar_url?: string
}

interface DiscordGuildMember {
  user: { id: string; username: string; discriminator: string; global_name?: string }
  nick?: string
  roles: string[]
}

interface RateLimitState {
  remaining: number
  resetAt: number
}

const rateLimits = new Map<string, RateLimitState>()

function updateRateLimit(bucket: string, headers: Headers): void {
  const remaining = headers.get('x-ratelimit-remaining')
  const resetAfter = headers.get('x-ratelimit-reset-after')
  if (remaining != null && resetAfter != null) {
    rateLimits.set(bucket, {
      remaining: parseInt(remaining, 10),
      resetAt: Date.now() + parseFloat(resetAfter) * 1000,
    })
  }
}

async function waitForRateLimit(bucket: string): Promise<void> {
  const limit = rateLimits.get(bucket)
  if (limit && limit.remaining <= 1 && limit.resetAt > Date.now()) {
    const waitMs = limit.resetAt - Date.now() + 100 // small buffer
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }
}

async function discordFetch(
  url: string,
  options: RequestInit & { botToken?: string },
  bucket: string
): Promise<Response> {
  await waitForRateLimit(bucket)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.botToken ? { Authorization: `Bot ${options.botToken}` } : {}),
  }

  const maxRetries = 3
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> || {}) },
    })

    updateRateLimit(bucket, resp.headers)

    if (resp.status === 429) {
      const body = await resp.json() as { retry_after?: number }
      const retryAfter = (body.retry_after || 1) * 1000
      console.warn(`[discord-api] Rate limited on ${bucket}, retrying in ${retryAfter}ms`)
      await new Promise(resolve => setTimeout(resolve, retryAfter))
      continue
    }

    return resp
  }

  throw new Error(`Discord API rate limit exceeded after ${maxRetries} retries`)
}

// ---------------------------------------------------------------------------
// Webhook (used by discord-notifier)
// ---------------------------------------------------------------------------

export async function sendWebhook(webhookUrl: string, payload: WebhookPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return { success: false, error: `Discord webhook error ${resp.status}: ${text}` }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export function buildChapterEmbed(opts: {
  chapterTitle: string
  projectTitle: string
  chapterUrl: string
  excerpt?: string | undefined
  coverImageUrl?: string | undefined
  authorName?: string | undefined
  mentionRole?: string | null | undefined
}): WebhookPayload {
  const embed: DiscordEmbed = {
    title: `New Chapter: ${opts.chapterTitle}`,
    description: opts.excerpt
      ? `${opts.projectTitle}\n\n${opts.excerpt}`
      : `A new chapter of **${opts.projectTitle}** is now available!`,
    url: opts.chapterUrl,
    color: 0x58A0FF, // Bobbinry blue
    footer: { text: 'Posted via Bobbinry' },
    timestamp: new Date().toISOString(),
  }

  if (opts.coverImageUrl) {
    embed.thumbnail = { url: opts.coverImageUrl }
  }

  return {
    content: opts.mentionRole || undefined,
    embeds: [embed],
    username: opts.authorName ? `${opts.authorName} on Bobbinry` : 'Bobbinry',
  }
}

// ---------------------------------------------------------------------------
// Bot REST API (used by discord-roles)
// ---------------------------------------------------------------------------

export async function searchGuildMember(
  botToken: string,
  guildId: string,
  query: string
): Promise<DiscordGuildMember | null> {
  const url = `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}/members/search?query=${encodeURIComponent(query)}&limit=1`
  const resp = await discordFetch(url, { method: 'GET', botToken }, `guild:${guildId}:members`)

  if (!resp.ok) {
    const text = await resp.text()
    console.error(`[discord-api] searchGuildMember failed: ${resp.status} ${text}`)
    return null
  }

  const members = await resp.json() as DiscordGuildMember[]
  return members[0] || null
}

export async function addRole(
  botToken: string,
  guildId: string,
  userId: string,
  roleId: string
): Promise<{ success: boolean; error?: string }> {
  const url = `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`
  const resp = await discordFetch(url, { method: 'PUT', botToken }, `guild:${guildId}:roles`)

  if (resp.status === 204 || resp.ok) {
    return { success: true }
  }

  const text = await resp.text()
  return { success: false, error: `${resp.status}: ${text}` }
}

export async function removeRole(
  botToken: string,
  guildId: string,
  userId: string,
  roleId: string
): Promise<{ success: boolean; error?: string }> {
  const url = `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`
  const resp = await discordFetch(url, { method: 'DELETE', botToken }, `guild:${guildId}:roles`)

  if (resp.status === 204 || resp.ok) {
    return { success: true }
  }

  const text = await resp.text()
  return { success: false, error: `${resp.status}: ${text}` }
}

export async function getGuildRoles(
  botToken: string,
  guildId: string
): Promise<Array<{ id: string; name: string; position: number }> | null> {
  const url = `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}/roles`
  const resp = await discordFetch(url, { method: 'GET', botToken }, `guild:${guildId}:roles`)

  if (!resp.ok) {
    console.error(`[discord-api] getGuildRoles failed: ${resp.status}`)
    return null
  }

  return resp.json() as Promise<Array<{ id: string; name: string; position: number }>>
}

export async function testBotConnection(
  botToken: string,
  guildId: string
): Promise<{ success: boolean; guildName?: string; error?: string }> {
  try {
    const url = `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}`
    const resp = await discordFetch(url, { method: 'GET', botToken }, `guild:${guildId}:info`)

    if (!resp.ok) {
      const text = await resp.text()
      return { success: false, error: `${resp.status}: ${text}` }
    }

    const guild = await resp.json() as { name: string }
    return { success: true, guildName: guild.name }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Connection failed' }
  }
}
