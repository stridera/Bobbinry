import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BobbinrySDK,
  PanelActions,
  PanelActionButton,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelIconButton,
  PanelLoadingState,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'

interface DiscordRolesSettingsProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
    bobbinId?: string
  }
}

interface RolesConfig {
  configured: boolean
  guildId: string | null
  guildName: string | null
  minTierLevel: number
  tierRoleMap: Record<string, { roleId: string; roleName: string }>
  lastSyncAt: string | null
  lastSyncStatus: string | null
}

interface TierOption {
  id: string
  name: string
  tierLevel: number
}

interface GuildRole {
  id: string
  name: string
  position: number
}

type ViewMode = 'main' | 'settings'

export default function DiscordRolesSettings({ context }: DiscordRolesSettingsProps) {
  const [sdk] = useState(() => new BobbinrySDK('discord-roles'))
  const projectId = useMemo(
    () => context?.projectId || context?.currentProject,
    [context?.projectId, context?.currentProject]
  )

  const [viewMode, setViewMode] = useState<ViewMode>('main')
  const [config, setConfig] = useState<RolesConfig | null>(null)
  const [tiers, setTiers] = useState<TierOption[]>([])
  const [guildRoles, setGuildRoles] = useState<GuildRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Settings form
  const [formBotToken, setFormBotToken] = useState('')
  const [formGuildId, setFormGuildId] = useState('')
  const [formMinTierLevel, setFormMinTierLevel] = useState(2)
  const [formTierRoleMap, setFormTierRoleMap] = useState<Record<string, { roleId: string; roleName: string }>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; guildName?: string; error?: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ success: boolean; synced?: number; error?: string } | null>(null)

  const apiBase = sdk.api.apiBaseUrl
  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(context?.apiToken ? { Authorization: `Bearer ${context.apiToken}` } : {}),
    }),
    [context?.apiToken]
  )

  const loadConfig = useCallback(async () => {
    if (!projectId || !context?.apiToken) return
    try {
      setLoading(true)
      const resp = await fetch(`${apiBase}/discord-roles/config?projectId=${projectId}`, { headers })
      if (resp.ok) {
        const data = await resp.json()
        setConfig(data.config)
        setTiers(data.tiers || [])
        setGuildRoles(data.guildRoles || [])
        if (!data.config?.configured) setViewMode('settings')
        if (data.config?.guildId) setFormGuildId(data.config.guildId)
        if (data.config?.minTierLevel) setFormMinTierLevel(data.config.minTierLevel)
        if (data.config?.tierRoleMap) setFormTierRoleMap(data.config.tierRoleMap)
      }
    } catch {
      setError('Failed to load Discord roles config')
    } finally {
      setLoading(false)
    }
  }, [apiBase, headers, projectId, context?.apiToken])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (context?.apiToken) sdk.api.setAuthToken(context.apiToken)
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId) sdk.setProject(projectId)
  }, [projectId, sdk])

  async function handleTestConnection() {
    if (!formBotToken && !config?.configured) {
      setTestResult({ success: false, error: 'Bot token is required' })
      return
    }
    if (!formGuildId) {
      setTestResult({ success: false, error: 'Guild ID is required' })
      return
    }
    try {
      setTesting(true)
      setTestResult(null)
      const resp = await fetch(`${apiBase}/discord-roles/test-connection`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          botToken: formBotToken || undefined,
          guildId: formGuildId,
        }),
      })
      const data = await resp.json()
      setTestResult(data)
      if (data.success && data.guildRoles) {
        setGuildRoles(data.guildRoles)
      }
    } catch {
      setTestResult({ success: false, error: 'Connection test failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveSettings() {
    if (!formGuildId) {
      setTestResult({ success: false, error: 'Guild ID is required' })
      return
    }
    try {
      setSaving(true)
      setError(null)
      const resp = await fetch(`${apiBase}/discord-roles/config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          projectId,
          botToken: formBotToken || undefined,
          guildId: formGuildId,
          minTierLevel: formMinTierLevel,
          tierRoleMap: formTierRoleMap,
        }),
      })
      if (resp.ok) {
        setFormBotToken('')
        await loadConfig()
        setViewMode('main')
      } else {
        const data = await resp.json()
        setError(data.error || 'Failed to save')
      }
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  function updateTierRole(tierId: string, roleId: string, roleName: string) {
    setFormTierRoleMap(prev => ({
      ...prev,
      [tierId]: { roleId, roleName },
    }))
  }

  async function handleSyncNow() {
    try {
      setSyncing(true)
      setSyncResult(null)
      const resp = await fetch(`${apiBase}/discord-roles/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId }),
      })
      const data = await resp.json()
      setSyncResult(data)
      if (data.success) await loadConfig()
    } catch {
      setSyncResult({ success: false, error: 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  // --- RENDER ---

  if (loading) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelLoadingState label="Loading Discord Roles..." />
        </PanelBody>
      </PanelFrame>
    )
  }

  // Settings view
  if (viewMode === 'settings') {
    return (
      <PanelFrame>
        <PanelActions>
          {config?.configured ? (
            <PanelIconButton onClick={() => setViewMode('main')} title="Back">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
              </svg>
            </PanelIconButton>
          ) : null}
          <PanelPill>Bot Settings</PanelPill>
        </PanelActions>

        <PanelBody className="space-y-3">
          <PanelCard className="space-y-3 px-3 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Bot Token {config?.configured ? <span className="text-green-600 dark:text-green-400">(configured)</span> : null}
              </label>
              <input
                type="password"
                value={formBotToken}
                onChange={(e) => setFormBotToken(e.target.value)}
                placeholder={config?.configured ? 'Enter new token to update' : 'Your Discord bot token'}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Guild (Server) ID</label>
              <input
                type="text"
                value={formGuildId}
                onChange={(e) => setFormGuildId(e.target.value)}
                placeholder="123456789012345678"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Minimum Tier for Discord Access</label>
              <select
                value={formMinTierLevel}
                onChange={(e) => setFormMinTierLevel(parseInt(e.target.value, 10))}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {tiers.length > 0 ? (
                  tiers.map((t) => (
                    <option key={t.id} value={t.tierLevel}>{t.name} (Level {t.tierLevel})</option>
                  ))
                ) : (
                  <>
                    <option value={1}>Level 1</option>
                    <option value={2}>Level 2</option>
                    <option value={3}>Level 3</option>
                  </>
                )}
              </select>
            </div>

            {testResult && (
              <div className={`rounded px-2 py-1.5 text-xs ${testResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                {testResult.success ? `Connected to: ${testResult.guildName}` : testResult.error}
              </div>
            )}

            <div className="flex gap-2">
              <PanelActionButton onClick={handleTestConnection} disabled={testing}>
                {testing ? 'Testing...' : 'Test Connection'}
              </PanelActionButton>
            </div>
          </PanelCard>

          {/* Tier-to-role mapping */}
          {(guildRoles.length > 0 && tiers.length > 0) && (
            <>
              <PanelSectionTitle>Tier &rarr; Role Mapping</PanelSectionTitle>
              <PanelCard className="space-y-3 px-3 py-3">
                {tiers.filter(t => t.tierLevel >= formMinTierLevel).map((tier) => (
                  <div key={tier.id}>
                    <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                      {tier.name} (Level {tier.tierLevel})
                    </label>
                    <select
                      value={formTierRoleMap[tier.id]?.roleId || ''}
                      onChange={(e) => {
                        const role = guildRoles.find(r => r.id === e.target.value)
                        if (role) updateTierRole(tier.id, role.id, role.name)
                        else updateTierRole(tier.id, '', '')
                      }}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="">No role assigned</option>
                      {guildRoles.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </PanelCard>
            </>
          )}

          {error && (
            <div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>
          )}

          <div className="flex gap-2">
            <PanelActionButton onClick={handleSaveSettings} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </PanelActionButton>
          </div>

          <PanelCard className="px-3 py-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Create a bot at discord.com/developers, add it to your server with MANAGE_ROLES permission.
              The bot token is stored encrypted in your account.
            </p>
          </PanelCard>
        </PanelBody>
      </PanelFrame>
    )
  }

  // Not configured
  if (!config?.configured) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelEmptyState
            title="Discord Roles not configured"
            description="Connect a Discord bot to sync subscription tier roles."
            action={<PanelActionButton onClick={() => setViewMode('settings')}>Configure</PanelActionButton>}
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  // Main view
  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton onClick={() => setViewMode('settings')} title="Settings">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </PanelIconButton>
        <PanelPill>{config.guildName || 'Discord'}</PanelPill>
      </PanelActions>

      <PanelBody className="space-y-3">
        <PanelSectionTitle>Role Sync</PanelSectionTitle>

        <PanelCard className="space-y-2 px-3 py-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {config.lastSyncAt ? (
              <>Last sync: {new Date(config.lastSyncAt).toLocaleString()} — {config.lastSyncStatus}</>
            ) : (
              <>No sync performed yet</>
            )}
          </div>

          {Object.keys(config.tierRoleMap).length > 0 && (
            <div className="space-y-1">
              {tiers.filter(t => config.tierRoleMap[t.id]).map(tier => (
                <div key={tier.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700 dark:text-gray-300">{tier.name}</span>
                  <PanelPill>{config.tierRoleMap[tier.id].roleName}</PanelPill>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        {syncResult && (
          <div className={`rounded px-2 py-1.5 text-xs ${syncResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
            {syncResult.success ? `Synced ${syncResult.synced} member(s)` : syncResult.error}
          </div>
        )}

        <PanelActionButton onClick={handleSyncNow} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </PanelActionButton>

        {error && (
          <div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>
        )}
      </PanelBody>
    </PanelFrame>
  )
}
