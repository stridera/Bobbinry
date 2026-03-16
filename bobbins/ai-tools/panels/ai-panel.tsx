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

interface AIToolsPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
    entityId?: string
    entityType?: string
    bobbinId?: string
    metadata?: { title?: string; name?: string }
  }
}

interface ChapterContext {
  entityId: string
  entityType: string
  bobbinId: string
  label: string
}

type ViewMode = 'main' | 'settings'

interface AIConfig {
  configured: boolean
  provider: string | null
  model: string | null
  keyConfigured: boolean
  availableModels?: Record<string, string[]>
}

export default function AIToolsPanel({ context }: AIToolsPanelProps) {
  const [sdk] = useState(() => new BobbinrySDK('ai-tools'))
  const projectId = useMemo(
    () => context?.projectId || context?.currentProject,
    [context?.projectId, context?.currentProject]
  )

  const [activeChapter, setActiveChapter] = useState<ChapterContext | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('main')
  const [config, setConfig] = useState<AIConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)

  // Synopsis state
  const [synopsisResult, setSynopsisResult] = useState<string | null>(null)
  const [synopsisModel, setSynopsisModel] = useState<string | null>(null)
  const [synopsisLoading, setSynopsisLoading] = useState(false)
  const [synopsisSaved, setSynopsisSaved] = useState(false)
  const [existingSynopsis, setExistingSynopsis] = useState<string | null>(null)

  // Review state
  const [reviewResult, setReviewResult] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)

  // Settings form state
  const [settingsProvider, setSettingsProvider] = useState<string>('anthropic')
  const [settingsModel, setSettingsModel] = useState<string>('')
  const [settingsApiKey, setSettingsApiKey] = useState<string>('')
  const [settingsTesting, setSettingsTesting] = useState(false)
  const [settingsTestResult, setSettingsTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [error, setError] = useState<string | null>(null)

  // Use the SDK's resolved API base URL (respects NEXT_PUBLIC_API_URL)
  const apiBase = sdk.api.apiBaseUrl

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(context?.apiToken ? { Authorization: `Bearer ${context.apiToken}` } : {}),
    }),
    [context?.apiToken]
  )

  // Load config on mount
  const loadConfig = useCallback(async () => {
    if (!context?.apiToken) return
    try {
      setConfigLoading(true)
      const resp = await fetch(`${apiBase}/ai-tools/config`, { headers })
      if (resp.ok) {
        const data = await resp.json()
        setConfig(data)
        if (data.provider) setSettingsProvider(data.provider)
        if (data.model) setSettingsModel(data.model)
        if (!data.configured) setViewMode('settings')
      }
    } catch {
      setError('Failed to load AI config')
    } finally {
      setConfigLoading(false)
    }
  }, [apiBase, headers, context?.apiToken, sdk])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (context?.apiToken) {
      sdk.api.setAuthToken(context.apiToken)
    }
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId) {
      sdk.setProject(projectId)
    }
  }, [projectId, sdk])

  // Initialize activeChapter from context on mount (handles re-expand after collapse)
  useEffect(() => {
    if (
      !activeChapter &&
      context?.bobbinId === 'manuscript' &&
      context?.entityType === 'content' &&
      context?.entityId
    ) {
      setActiveChapter({
        entityId: context.entityId,
        entityType: context.entityType,
        bobbinId: 'manuscript',
        label: context.metadata?.title || context.metadata?.name || 'Chapter',
      })
    }
  }, [context?.entityId, context?.entityType, context?.bobbinId, context?.metadata?.title, context?.metadata?.name])

  // Listen for navigation events
  useEffect(() => {
    function handleNavigate(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      if (detail.bobbinId === 'manuscript' && detail.entityType === 'content' && detail.entityId) {
        setActiveChapter({
          entityId: detail.entityId,
          entityType: detail.entityType,
          bobbinId: 'manuscript',
          label: detail.metadata?.title || detail.metadata?.name || 'Chapter',
        })
        // Reset results when chapter changes
        setSynopsisResult(null)
        setSynopsisSaved(false)
        setExistingSynopsis(null)
        setReviewResult(null)
        setNoteSaved(false)
        setError(null)
      }
    }

    function handleContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      if (detail.bobbinId === 'manuscript' && detail.entityType === 'content' && detail.entityId) {
        setActiveChapter((prev) => {
          const label = detail.metadata?.title || detail.metadata?.name || prev?.label || 'Chapter'
          // Only reset results if the entity actually changed
          if (prev?.entityId !== detail.entityId) {
            setSynopsisResult(null)
            setSynopsisSaved(false)
            setExistingSynopsis(null)
            setReviewResult(null)
            setNoteSaved(false)
            setError(null)
          }
          return { entityId: detail.entityId, entityType: detail.entityType, bobbinId: 'manuscript', label }
        })
      }
    }

    window.addEventListener('bobbinry:navigate', handleNavigate)
    window.addEventListener('bobbinry:view-context-change', handleContextChange)
    return () => {
      window.removeEventListener('bobbinry:navigate', handleNavigate)
      window.removeEventListener('bobbinry:view-context-change', handleContextChange)
    }
  }, [])

  // Generate synopsis
  async function handleGenerateSynopsis() {
    if (!activeChapter || !projectId) return
    try {
      setSynopsisLoading(true)
      setSynopsisSaved(false)
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/synopsis`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, entityId: activeChapter.entityId }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Synopsis generation failed')
        return
      }

      setSynopsisResult(data.synopsis)
      setSynopsisModel(data.model)
      if (data.existingSynopsis) setExistingSynopsis(data.existingSynopsis)
    } catch {
      setError('Failed to generate synopsis')
    } finally {
      setSynopsisLoading(false)
    }
  }

  // Save synopsis
  async function handleSaveSynopsis() {
    if (!synopsisResult || !activeChapter || !projectId) return
    try {
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/synopsis/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          entityId: activeChapter.entityId,
          synopsis: synopsisResult,
          model: synopsisModel,
        }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Failed to save synopsis')
        return
      }

      setSynopsisSaved(true)
      setExistingSynopsis(synopsisResult)
    } catch {
      setError('Failed to save synopsis')
    }
  }

  // Generate review
  async function handleGenerateReview() {
    if (!activeChapter || !projectId) return
    try {
      setReviewLoading(true)
      setNoteSaved(false)
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, entityId: activeChapter.entityId }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Review generation failed')
        return
      }

      setReviewResult(data.review)
    } catch {
      setError('Failed to generate review')
    } finally {
      setReviewLoading(false)
    }
  }

  // Save feedback to notes
  async function handleAddToNotes() {
    if (!reviewResult || !activeChapter || !projectId) return
    try {
      setNoteSaving(true)
      setError(null)

      // Use a separate SDK instance scoped to the notes bobbin
      const notesSdk = new BobbinrySDK('notes')
      if (context?.apiToken) notesSdk.api.setAuthToken(context.apiToken)
      notesSdk.setProject(projectId)

      await notesSdk.entities.create('notes', {
        title: `AI Feedback — ${activeChapter.label}`,
        content: reviewResult,
        folder_id: null,
        tags: ['ai-feedback'],
        linked_entities: [{
          entityId: activeChapter.entityId,
          collection: 'content',
          bobbinId: 'manuscript',
          label: activeChapter.label,
        }],
        pinned: false,
        color: null,
        icon: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      setNoteSaved(true)
    } catch {
      setError('Failed to save to notes. Is the Notes bobbin installed?')
    } finally {
      setNoteSaving(false)
    }
  }

  // Settings handlers
  async function handleTestConnection() {
    try {
      setSettingsTesting(true)
      setSettingsTestResult(null)

      const resp = await fetch(`${apiBase}/ai-tools/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider: settingsProvider,
          apiKey: settingsApiKey || undefined,
          model: settingsModel || undefined,
        }),
      })

      const data = await resp.json()
      setSettingsTestResult(resp.ok ? { success: true } : { success: false, error: data.error })
    } catch {
      setSettingsTestResult({ success: false, error: 'Connection test failed' })
    } finally {
      setSettingsTesting(false)
    }
  }

  async function handleSaveSettings() {
    if (!settingsApiKey && !config?.keyConfigured) {
      setSettingsTestResult({ success: false, error: 'API key is required' })
      return
    }
    try {
      setSettingsSaving(true)
      setSettingsTestResult(null)

      const body: Record<string, string> = {
        provider: settingsProvider,
        apiKey: settingsApiKey,
      }
      if (settingsModel) body.model = settingsModel

      const resp = await fetch(`${apiBase}/ai-tools/config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })

      if (resp.ok) {
        setSettingsApiKey('')
        await loadConfig()
        setViewMode('main')
      } else {
        const data = await resp.json()
        setSettingsTestResult({ success: false, error: data.error })
      }
    } catch {
      setSettingsTestResult({ success: false, error: 'Failed to save settings' })
    } finally {
      setSettingsSaving(false)
    }
  }

  const availableModels: string[] =
    config?.availableModels?.[settingsProvider] ||
    (settingsProvider === 'anthropic'
      ? ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001']
      : ['gpt-4o', 'gpt-4o-mini'])

  // --- RENDER ---

  if (configLoading) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelLoadingState label="Loading AI Tools..." />
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
            <PanelIconButton onClick={() => setViewMode('main')} title="Back to tools">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
              </svg>
            </PanelIconButton>
          ) : null}
          <PanelPill>Settings</PanelPill>
        </PanelActions>

        <PanelBody className="space-y-4">
          <PanelSectionTitle>AI Provider</PanelSectionTitle>
          <PanelCard className="space-y-3 px-3 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Provider</label>
              <select
                value={settingsProvider}
                onChange={(e) => {
                  setSettingsProvider(e.target.value)
                  setSettingsModel('')
                }}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="anthropic">Anthropic Claude</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Model</label>
              <select
                value={settingsModel}
                onChange={(e) => setSettingsModel(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">Default</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                API Key {config?.keyConfigured ? <span className="text-green-600 dark:text-green-400">(configured)</span> : null}
              </label>
              <input
                type="password"
                value={settingsApiKey}
                onChange={(e) => setSettingsApiKey(e.target.value)}
                placeholder={config?.keyConfigured ? 'Enter new key to update' : 'Enter your API key'}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            {settingsTestResult ? (
              <div className={`rounded px-2 py-1.5 text-xs ${settingsTestResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                {settingsTestResult.success ? 'Connection successful' : settingsTestResult.error}
              </div>
            ) : null}

            <div className="flex gap-2">
              <PanelActionButton onClick={handleTestConnection} disabled={settingsTesting}>
                {settingsTesting ? 'Testing...' : 'Test Connection'}
              </PanelActionButton>
              <PanelActionButton onClick={handleSaveSettings} disabled={settingsSaving}>
                {settingsSaving ? 'Saving...' : 'Save'}
              </PanelActionButton>
            </div>
          </PanelCard>

          <PanelCard className="px-3 py-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Your API key is stored in your account and used only when you explicitly click Generate.
              Content is sent to the provider you choose. AI Tools does not write or rewrite your content.
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
            title="AI Tools not configured"
            description="Enter your API key to enable synopsis generation and structured feedback."
            action={<PanelActionButton onClick={() => setViewMode('settings')}>Configure</PanelActionButton>}
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  // No chapter selected
  if (!activeChapter) {
    return (
      <PanelFrame>
        <PanelActions>
          <PanelIconButton onClick={() => setViewMode('settings')} title="Settings">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </PanelIconButton>
          <PanelPill>{config.provider === 'anthropic' ? 'Claude' : 'OpenAI'}</PanelPill>
        </PanelActions>
        <PanelBody>
          <PanelEmptyState
            title="No chapter selected"
            description="Open a manuscript chapter to use AI tools."
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  // Active chapter — main tools view
  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton onClick={() => setViewMode('settings')} title="Settings">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </PanelIconButton>
        <PanelPill>{config.provider === 'anthropic' ? 'Claude' : 'OpenAI'}</PanelPill>
      </PanelActions>

      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>{activeChapter.label}</PanelSectionTitle>
        </div>

        {error ? (
          <PanelCard className="text-xs text-red-700 dark:text-red-300">{error}</PanelCard>
        ) : null}

        {/* Synopsis Section */}
        <div className="space-y-2">
          <PanelSectionTitle>Synopsis</PanelSectionTitle>

          {existingSynopsis && !synopsisResult ? (
            <PanelCard className="space-y-2 px-3 py-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">Current synopsis:</p>
              <p className="text-sm text-gray-800 dark:text-gray-200">{existingSynopsis}</p>
            </PanelCard>
          ) : null}

          {synopsisLoading ? (
            <PanelLoadingState label="Generating synopsis..." />
          ) : synopsisResult ? (
            <PanelCard className="space-y-2 px-3 py-2">
              <p className="text-sm text-gray-800 dark:text-gray-200">{synopsisResult}</p>
              {synopsisSaved ? (
                <div className="flex items-center gap-2">
                  <PanelPill>Saved</PanelPill>
                </div>
              ) : (
                <div className="flex gap-2">
                  <PanelActionButton onClick={handleSaveSynopsis}>Save to Synopsis</PanelActionButton>
                  <PanelActionButton onClick={handleGenerateSynopsis}>Regenerate</PanelActionButton>
                </div>
              )}
            </PanelCard>
          ) : (
            <PanelActionButton onClick={handleGenerateSynopsis}>Generate Synopsis</PanelActionButton>
          )}
        </div>

        {/* Review Section */}
        <div className="space-y-2">
          <PanelSectionTitle>Feedback</PanelSectionTitle>

          {reviewLoading ? (
            <PanelLoadingState label="Generating feedback..." />
          ) : reviewResult ? (
            <PanelCard className="space-y-2 px-3 py-2">
              <div
                className="prose prose-sm max-w-none text-gray-800 dark:prose-invert dark:text-gray-200"
                dangerouslySetInnerHTML={{
                  __html: reviewResult
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n- /g, '\n<li>')
                    .replace(/\n\n/g, '<br/><br/>')
                    .replace(/\n/g, '<br/>'),
                }}
              />
              <div className="flex gap-2">
                <PanelActionButton onClick={handleGenerateReview}>Regenerate</PanelActionButton>
                {noteSaved ? (
                  <PanelPill>Saved to Notes</PanelPill>
                ) : (
                  <PanelActionButton onClick={handleAddToNotes} disabled={noteSaving}>
                    {noteSaving ? 'Saving...' : 'Add to Notes'}
                  </PanelActionButton>
                )}
              </div>
            </PanelCard>
          ) : (
            <PanelActionButton onClick={handleGenerateReview}>Get Feedback</PanelActionButton>
          )}
        </div>
      </PanelBody>
    </PanelFrame>
  )
}
