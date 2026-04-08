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

interface DiscordNotifierSettingsProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
    bobbinId?: string
  }
}

interface DestinationConfig {
  id: string
  name: string
  webhookUrl: string
  channelName: string
  tierFilter: {
    mode: 'public_only' | 'tier_and_above' | 'all'
    minTierLevel: number
  }
  messageTemplate: {
    showExcerpt: boolean
    showCoverImage: boolean
    mentionRole: string | null
  }
  isActive: boolean
  lastSyncStatus: string
  lastSyncError: string | null
}

interface TierOption {
  id: string
  name: string
  tierLevel: number
}

type ViewMode = 'list' | 'add' | 'edit'

export default function DiscordNotifierSettings({ context }: DiscordNotifierSettingsProps) {
  const [sdk] = useState(() => new BobbinrySDK('discord-notifier'))
  const projectId = useMemo(
    () => context?.projectId || context?.currentProject,
    [context?.projectId, context?.currentProject]
  )

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [destinations, setDestinations] = useState<DestinationConfig[]>([])
  const [tiers, setTiers] = useState<TierOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [formChannelName, setFormChannelName] = useState('')
  const [formWebhookUrl, setFormWebhookUrl] = useState('')
  const [formTierMode, setFormTierMode] = useState<'public_only' | 'tier_and_above' | 'all'>('all')
  const [formMinTierLevel, setFormMinTierLevel] = useState(0)
  const [formShowExcerpt, setFormShowExcerpt] = useState(true)
  const [formShowCoverImage, setFormShowCoverImage] = useState(true)
  const [formMentionRole, setFormMentionRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)

  const apiBase = sdk.api.apiBaseUrl
  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(context?.apiToken ? { Authorization: `Bearer ${context.apiToken}` } : {}),
    }),
    [context?.apiToken]
  )

  const loadDestinations = useCallback(async () => {
    if (!projectId || !context?.apiToken) return
    try {
      setLoading(true)
      const resp = await fetch(`${apiBase}/discord-notifier/destinations?projectId=${projectId}`, { headers })
      if (resp.ok) {
        const data = await resp.json()
        setDestinations(data.destinations || [])
        setTiers(data.tiers || [])
      }
    } catch {
      setError('Failed to load Discord destinations')
    } finally {
      setLoading(false)
    }
  }, [apiBase, headers, projectId, context?.apiToken])

  useEffect(() => {
    loadDestinations()
  }, [loadDestinations])

  useEffect(() => {
    if (context?.apiToken) sdk.api.setAuthToken(context.apiToken)
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId) sdk.setProject(projectId)
  }, [projectId, sdk])

  function resetForm() {
    setFormChannelName('')
    setFormWebhookUrl('')
    setFormTierMode('all')
    setFormMinTierLevel(0)
    setFormShowExcerpt(true)
    setFormShowCoverImage(true)
    setFormMentionRole('')
    setTestResult(null)
    setEditingId(null)
  }

  function openEdit(dest: DestinationConfig) {
    setEditingId(dest.id)
    setFormChannelName(dest.channelName)
    setFormWebhookUrl(dest.webhookUrl)
    setFormTierMode(dest.tierFilter.mode)
    setFormMinTierLevel(dest.tierFilter.minTierLevel)
    setFormShowExcerpt(dest.messageTemplate.showExcerpt)
    setFormShowCoverImage(dest.messageTemplate.showCoverImage)
    setFormMentionRole(dest.messageTemplate.mentionRole || '')
    setTestResult(null)
    setViewMode('edit')
  }

  async function handleTestWebhook() {
    if (!formWebhookUrl) {
      setTestResult({ success: false, error: 'Webhook URL is required' })
      return
    }
    try {
      setTesting(true)
      setTestResult(null)
      const resp = await fetch(`${apiBase}/discord-notifier/test-webhook`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ webhookUrl: formWebhookUrl }),
      })
      const data = await resp.json()
      setTestResult(resp.ok ? { success: true } : { success: false, error: data.error })
    } catch {
      setTestResult({ success: false, error: 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (!formWebhookUrl || !formChannelName) {
      setTestResult({ success: false, error: 'Channel name and webhook URL are required' })
      return
    }
    try {
      setSaving(true)
      setError(null)
      const body = {
        projectId,
        channelName: formChannelName,
        webhookUrl: formWebhookUrl,
        tierFilter: { mode: formTierMode, minTierLevel: formMinTierLevel },
        messageTemplate: {
          showExcerpt: formShowExcerpt,
          showCoverImage: formShowCoverImage,
          mentionRole: formMentionRole || null,
        },
      }

      const url = editingId
        ? `${apiBase}/discord-notifier/destinations/${editingId}`
        : `${apiBase}/discord-notifier/destinations`
      const method = editingId ? 'PUT' : 'POST'

      const resp = await fetch(url, { method, headers, body: JSON.stringify(body) })
      if (resp.ok) {
        resetForm()
        setViewMode('list')
        await loadDestinations()
      } else {
        const data = await resp.json()
        setError(data.error || 'Failed to save')
      }
    } catch {
      setError('Failed to save destination')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const resp = await fetch(`${apiBase}/discord-notifier/destinations/${id}`, {
        method: 'DELETE',
        headers,
      })
      if (resp.ok) {
        await loadDestinations()
      }
    } catch {
      setError('Failed to delete destination')
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      await fetch(`${apiBase}/discord-notifier/destinations/${id}/toggle`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ isActive: !isActive }),
      })
      await loadDestinations()
    } catch {
      setError('Failed to toggle destination')
    }
  }

  // --- RENDER ---

  if (loading) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelLoadingState label="Loading Discord config..." />
        </PanelBody>
      </PanelFrame>
    )
  }

  // Add / Edit form
  if (viewMode === 'add' || viewMode === 'edit') {
    return (
      <PanelFrame>
        <PanelActions>
          <PanelIconButton onClick={() => { resetForm(); setViewMode('list') }} title="Back">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
            </svg>
          </PanelIconButton>
          <PanelPill>{viewMode === 'edit' ? 'Edit Channel' : 'Add Channel'}</PanelPill>
        </PanelActions>

        <PanelBody className="space-y-3">
          <PanelCard className="space-y-3 px-3 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Channel Name</label>
              <input
                type="text"
                value={formChannelName}
                onChange={(e) => setFormChannelName(e.target.value)}
                placeholder="#announcements"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Webhook URL</label>
              <input
                type="password"
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Notify For</label>
              <select
                value={formTierMode}
                onChange={(e) => setFormTierMode(e.target.value as any)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">All publishes</option>
                <option value="public_only">Public releases only</option>
                <option value="tier_and_above">Tier threshold and above</option>
              </select>
            </div>

            {formTierMode === 'tier_and_above' && tiers.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Minimum Tier</label>
                <select
                  value={formMinTierLevel}
                  onChange={(e) => setFormMinTierLevel(parseInt(e.target.value, 10))}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {tiers.map((t) => (
                    <option key={t.id} value={t.tierLevel}>{t.name} (Level {t.tierLevel})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={formShowExcerpt} onChange={(e) => setFormShowExcerpt(e.target.checked)} />
                Show excerpt
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={formShowCoverImage} onChange={(e) => setFormShowCoverImage(e.target.checked)} />
                Show cover image
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Mention Role (optional)</label>
              <input
                type="text"
                value={formMentionRole}
                onChange={(e) => setFormMentionRole(e.target.value)}
                placeholder="@everyone or @role-name"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </PanelCard>

          {testResult && (
            <div className={`rounded px-2 py-1.5 text-xs ${testResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
              {testResult.success ? 'Test message sent successfully!' : testResult.error}
            </div>
          )}

          {error && (
            <div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>
          )}

          <div className="flex gap-2">
            <PanelActionButton onClick={handleTestWebhook} disabled={testing}>
              {testing ? 'Testing...' : 'Test Webhook'}
            </PanelActionButton>
            <PanelActionButton onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </PanelActionButton>
          </div>

          <PanelCard className="px-3 py-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Create a webhook in Discord: Server Settings &rarr; Integrations &rarr; Webhooks &rarr; New Webhook.
              Copy the webhook URL and paste it above.
            </p>
          </PanelCard>
        </PanelBody>
      </PanelFrame>
    )
  }

  // List view
  return (
    <PanelFrame>
      <PanelActions>
        <PanelPill>Discord Notifier</PanelPill>
      </PanelActions>

      <PanelBody className="space-y-3">
        {destinations.length === 0 ? (
          <PanelEmptyState
            title="No Discord channels configured"
            description="Add a Discord webhook to announce new chapters to your community."
            action={<PanelActionButton onClick={() => { resetForm(); setViewMode('add') }}>Add Channel</PanelActionButton>}
          />
        ) : (
          <>
            <PanelSectionTitle>Channels</PanelSectionTitle>
            {destinations.map((dest) => (
              <PanelCard key={dest.id} className="space-y-2 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{dest.channelName}</span>
                    <PanelPill>{dest.isActive ? 'Active' : 'Paused'}</PanelPill>
                  </div>
                  <div className="flex gap-1">
                    <PanelIconButton onClick={() => handleToggle(dest.id, dest.isActive)} title={dest.isActive ? 'Pause' : 'Resume'}>
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {dest.isActive ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        )}
                      </svg>
                    </PanelIconButton>
                    <PanelIconButton onClick={() => openEdit(dest)} title="Edit">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </PanelIconButton>
                    <PanelIconButton onClick={() => handleDelete(dest.id)} title="Delete">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </PanelIconButton>
                  </div>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {dest.tierFilter.mode === 'all' && 'All publishes'}
                  {dest.tierFilter.mode === 'public_only' && 'Public releases only'}
                  {dest.tierFilter.mode === 'tier_and_above' && `Tier ${dest.tierFilter.minTierLevel}+`}
                  {dest.lastSyncStatus !== 'pending' && (
                    <span className={dest.lastSyncStatus === 'success' ? 'ml-2 text-green-600 dark:text-green-400' : 'ml-2 text-red-600 dark:text-red-400'}>
                      Last: {dest.lastSyncStatus}
                    </span>
                  )}
                </div>

                {dest.lastSyncError && (
                  <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    {dest.lastSyncError}
                  </div>
                )}
              </PanelCard>
            ))}
            <PanelActionButton onClick={() => { resetForm(); setViewMode('add') }}>Add Channel</PanelActionButton>
          </>
        )}
      </PanelBody>
    </PanelFrame>
  )
}
