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
  getSanitizedHtmlProps,
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

interface ActiveEntity {
  entityId: string
  entityType: string
  bobbinId: string
  label: string
  collectionName?: string
}

type ToolContext = 'content' | 'entity' | 'notes' | 'timeline' | 'unsupported'
type ViewMode = 'main' | 'settings'

interface AIConfig {
  configured: boolean
  provider: string | null
  model: string | null
  keyConfigured: boolean
  availableModels?: Record<string, string[]>
}

interface ExistingReview {
  review: string
  model: string
  focus: string | null
  generatedAt: string
}

function getToolContext(bobbinId?: string, entityType?: string): ToolContext {
  if (bobbinId === 'manuscript' && entityType === 'content') return 'content'
  if (bobbinId === 'entities') return 'entity'
  if (bobbinId === 'notes' && entityType === 'notes') return 'notes'
  if (bobbinId === 'timeline' && entityType === 'timeline_events') return 'timeline'
  return 'unsupported'
}

/** Simple markdown-to-HTML for AI output (bold, bullets, line breaks) */
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n- /g, '\n<li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')
}

export default function AIToolsPanel({ context }: AIToolsPanelProps) {
  const [sdk] = useState(() => new BobbinrySDK('ai-tools'))
  const projectId = useMemo(
    () => context?.projectId || context?.currentProject,
    [context?.projectId, context?.currentProject]
  )

  const [activeEntity, setActiveEntity] = useState<ActiveEntity | null>(null)
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
  const [reviewFocus, setReviewFocus] = useState('')
  const [existingReview, setExistingReview] = useState<ExistingReview | null>(null)

  // Names state
  const [namesResult, setNamesResult] = useState<string[] | null>(null)
  const [namesLoading, setNamesLoading] = useState(false)
  const [namesGenre, setNamesGenre] = useState('')
  const [copiedName, setCopiedName] = useState<string | null>(null)

  // Brainstorm state
  const [brainstormResult, setBrainstormResult] = useState<string | null>(null)
  const [brainstormLoading, setBrainstormLoading] = useState(false)

  // Flesh-out state
  const [fleshOutResult, setFleshOutResult] = useState<string | null>(null)
  const [fleshOutLoading, setFleshOutLoading] = useState(false)

  // Settings form state
  const [settingsProvider, setSettingsProvider] = useState<string>('anthropic')
  const [settingsModel, setSettingsModel] = useState<string>('')
  const [settingsApiKey, setSettingsApiKey] = useState<string>('')
  const [settingsTesting, setSettingsTesting] = useState(false)
  const [settingsTestResult, setSettingsTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const apiBase = sdk.api.apiBaseUrl

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(context?.apiToken ? { Authorization: `Bearer ${context.apiToken}` } : {}),
    }),
    [context?.apiToken]
  )

  const toolContext = useMemo(
    () => getToolContext(activeEntity?.bobbinId, activeEntity?.entityType),
    [activeEntity?.bobbinId, activeEntity?.entityType]
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

  // Reset all tool state when entity changes
  function resetToolState() {
    setSynopsisResult(null)
    setSynopsisSaved(false)
    setExistingSynopsis(null)
    setReviewResult(null)
    setReviewFocus('')
    setExistingReview(null)
    setNamesResult(null)
    setNamesGenre('')
    setCopiedName(null)
    setBrainstormResult(null)
    setFleshOutResult(null)
    setError(null)
  }

  // Build an ActiveEntity from event detail
  function entityFromDetail(detail: any): ActiveEntity {
    return {
      entityId: detail.entityId,
      entityType: detail.entityType,
      bobbinId: detail.bobbinId,
      label: detail.metadata?.title || detail.metadata?.name || detail.label || 'Untitled',
      collectionName: detail.collectionName,
    }
  }

  // Initialize activeEntity from context on mount
  useEffect(() => {
    if (!activeEntity && context?.bobbinId && context?.entityType && context?.entityId) {
      setActiveEntity({
        entityId: context.entityId,
        entityType: context.entityType,
        bobbinId: context.bobbinId,
        label: context.metadata?.title || context.metadata?.name || 'Untitled',
      })
    }
  }, [context?.entityId, context?.entityType, context?.bobbinId, context?.metadata?.title, context?.metadata?.name])

  // Listen for navigation events
  useEffect(() => {
    function handleNavigate(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.entityId) return
      setActiveEntity(entityFromDetail(detail))
      resetToolState()
    }

    function handleContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.entityId) return
      setActiveEntity((prev) => {
        if (prev?.entityId !== detail.entityId) {
          resetToolState()
        }
        return entityFromDetail(detail)
      })
    }

    window.addEventListener('bobbinry:navigate', handleNavigate)
    window.addEventListener('bobbinry:view-context-change', handleContextChange)
    return () => {
      window.removeEventListener('bobbinry:navigate', handleNavigate)
      window.removeEventListener('bobbinry:view-context-change', handleContextChange)
    }
  }, [])

  // Load existing review when a content chapter becomes active
  useEffect(() => {
    if (!activeEntity || !projectId || toolContext !== 'content') return

    async function loadExistingReview() {
      try {
        const resp = await fetch(
          `${apiBase}/ai-tools/review/existing?projectId=${encodeURIComponent(projectId!)}&entityId=${encodeURIComponent(activeEntity!.entityId)}`,
          { headers }
        )
        if (resp.ok) {
          const data = await resp.json()
          if (data.exists) {
            setExistingReview({
              review: data.review,
              model: data.model,
              focus: data.focus,
              generatedAt: data.generatedAt,
            })
          }
        }
      } catch {
        // Non-critical — don't show error
      }
    }

    loadExistingReview()
  }, [activeEntity?.entityId, toolContext, projectId, apiBase, headers])

  // --- Action handlers ---

  async function handleGenerateSynopsis() {
    if (!activeEntity || !projectId) return
    try {
      setSynopsisLoading(true)
      setSynopsisSaved(false)
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/synopsis`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, entityId: activeEntity.entityId }),
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

  async function handleSaveSynopsis() {
    if (!synopsisResult || !activeEntity || !projectId) return
    try {
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/synopsis/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          entityId: activeEntity.entityId,
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

  async function handleGenerateReview() {
    if (!activeEntity || !projectId) return
    try {
      setReviewLoading(true)
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          entityId: activeEntity.entityId,
          focus: reviewFocus.trim() || undefined,
        }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Review generation failed')
        return
      }

      setReviewResult(data.review)
      setExistingReview({
        review: data.review,
        model: data.model,
        focus: data.focus,
        generatedAt: data.generatedAt,
      })
    } catch {
      setError('Failed to generate review')
    } finally {
      setReviewLoading(false)
    }
  }

  async function handleGenerateNames() {
    if (!activeEntity || !projectId) return
    try {
      setNamesLoading(true)
      setError(null)
      setCopiedName(null)

      const resp = await fetch(`${apiBase}/ai-tools/names`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          entityId: activeEntity.entityId,
          genre: namesGenre.trim() || undefined,
        }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Name generation failed')
        return
      }

      setNamesResult(data.names)
    } catch {
      setError('Failed to generate names')
    } finally {
      setNamesLoading(false)
    }
  }

  async function handleGenerateBrainstorm() {
    if (!activeEntity || !projectId) return
    try {
      setBrainstormLoading(true)
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/brainstorm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, entityId: activeEntity.entityId }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Brainstorm generation failed')
        return
      }

      setBrainstormResult(data.brainstorm)
    } catch {
      setError('Failed to generate brainstorm')
    } finally {
      setBrainstormLoading(false)
    }
  }

  async function handleGenerateFleshOut() {
    if (!activeEntity || !projectId) return
    try {
      setFleshOutLoading(true)
      setError(null)

      const resp = await fetch(`${apiBase}/ai-tools/flesh-out`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, entityId: activeEntity.entityId }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Flesh-out generation failed')
        return
      }

      setFleshOutResult(data.details)
    } catch {
      setError('Failed to flesh out event')
    } finally {
      setFleshOutLoading(false)
    }
  }

  function handleCopyName(name: string) {
    navigator.clipboard.writeText(name)
    setCopiedName(name)
    setTimeout(() => setCopiedName(null), 2000)
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

  // --- Settings gear icon (reused across views) ---
  const settingsGearIcon = (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )

  const providerPill = config?.provider === 'anthropic' ? 'Claude' : 'OpenAI'

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
            description="Enter your API key to enable AI-powered writing tools."
            action={<PanelActionButton onClick={() => setViewMode('settings')}>Configure</PanelActionButton>}
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  // No entity selected or unsupported context
  if (!activeEntity || toolContext === 'unsupported') {
    return (
      <PanelFrame>
        <PanelActions>
          <PanelIconButton onClick={() => setViewMode('settings')} title="Settings">
            {settingsGearIcon}
          </PanelIconButton>
          <PanelPill>{providerPill}</PanelPill>
        </PanelActions>
        <PanelBody>
          <PanelEmptyState
            title="No supported context"
            description="Open a chapter, entity, note, or timeline event to use AI tools."
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  // --- Content tools (manuscript chapters) ---
  function renderContentTools() {
    return (
      <>
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

          {/* Focus steering textarea */}
          <textarea
            value={reviewFocus}
            onChange={(e) => setReviewFocus(e.target.value)}
            placeholder="Focus on... (e.g., pacing, dialogue, opening hook)"
            rows={2}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />

          {/* Existing review (loaded from DB) */}
          {existingReview && !reviewResult ? (
            <PanelCard className="space-y-2 px-3 py-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Previous feedback{' '}
                {existingReview.generatedAt
                  ? `\u00b7 ${new Date(existingReview.generatedAt).toLocaleDateString()}`
                  : ''}
                {existingReview.focus ? ` \u00b7 Focus: ${existingReview.focus}` : ''}
              </p>
              <div
                className="prose prose-sm max-w-none text-gray-800 dark:prose-invert dark:text-gray-200"
                dangerouslySetInnerHTML={getSanitizedHtmlProps(renderMarkdown(existingReview.review))}
              />
              <PanelActionButton onClick={handleGenerateReview}>
                {reviewFocus.trim() ? 'Get Focused Feedback' : 'Regenerate'}
              </PanelActionButton>
            </PanelCard>
          ) : null}

          {reviewLoading ? (
            <PanelLoadingState label="Generating feedback..." />
          ) : reviewResult ? (
            <PanelCard className="space-y-2 px-3 py-2">
              <div
                className="prose prose-sm max-w-none text-gray-800 dark:prose-invert dark:text-gray-200"
                dangerouslySetInnerHTML={getSanitizedHtmlProps(renderMarkdown(reviewResult))}
              />
              <PanelActionButton onClick={handleGenerateReview}>Regenerate</PanelActionButton>
            </PanelCard>
          ) : !existingReview ? (
            <PanelActionButton onClick={handleGenerateReview}>
              {reviewFocus.trim() ? 'Get Focused Feedback' : 'Get Feedback'}
            </PanelActionButton>
          ) : null}
        </div>
      </>
    )
  }

  // --- Entity tools (name generator) ---
  function renderEntityTools() {
    return (
      <div className="space-y-2">
        <PanelSectionTitle>Name Generator</PanelSectionTitle>

        <input
          type="text"
          value={namesGenre}
          onChange={(e) => setNamesGenre(e.target.value)}
          placeholder="e.g., medieval fantasy, sci-fi Japanese"
          className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
        />

        {namesLoading ? (
          <PanelLoadingState label="Generating names..." />
        ) : namesResult ? (
          <PanelCard className="space-y-1 px-3 py-2">
            {namesResult.map((name) => (
              <button
                key={name}
                onClick={() => handleCopyName(name)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <span>{name}</span>
                <span className="text-xs text-gray-400">
                  {copiedName === name ? 'Copied!' : 'Click to copy'}
                </span>
              </button>
            ))}
            <div className="mt-2">
              <PanelActionButton onClick={handleGenerateNames}>Regenerate</PanelActionButton>
            </div>
          </PanelCard>
        ) : (
          <PanelActionButton onClick={handleGenerateNames}>Generate Names</PanelActionButton>
        )}
      </div>
    )
  }

  // --- Notes tools (brainstorm) ---
  function renderNotesTools() {
    return (
      <div className="space-y-2">
        <PanelSectionTitle>Brainstorm</PanelSectionTitle>

        {brainstormLoading ? (
          <PanelLoadingState label="Brainstorming..." />
        ) : brainstormResult ? (
          <PanelCard className="space-y-2 px-3 py-2">
            <div
              className="prose prose-sm max-w-none text-gray-800 dark:prose-invert dark:text-gray-200"
              dangerouslySetInnerHTML={getSanitizedHtmlProps(renderMarkdown(brainstormResult))}
            />
            <PanelActionButton onClick={handleGenerateBrainstorm}>Regenerate</PanelActionButton>
          </PanelCard>
        ) : (
          <PanelActionButton onClick={handleGenerateBrainstorm}>Brainstorm</PanelActionButton>
        )}
      </div>
    )
  }

  // --- Timeline tools (flesh out) ---
  function renderTimelineTools() {
    return (
      <div className="space-y-2">
        <PanelSectionTitle>Flesh Out</PanelSectionTitle>

        {fleshOutLoading ? (
          <PanelLoadingState label="Fleshing out event..." />
        ) : fleshOutResult ? (
          <PanelCard className="space-y-2 px-3 py-2">
            <div
              className="prose prose-sm max-w-none text-gray-800 dark:prose-invert dark:text-gray-200"
              dangerouslySetInnerHTML={getSanitizedHtmlProps(renderMarkdown(fleshOutResult))}
            />
            <PanelActionButton onClick={handleGenerateFleshOut}>Regenerate</PanelActionButton>
          </PanelCard>
        ) : (
          <PanelActionButton onClick={handleGenerateFleshOut}>Flesh Out</PanelActionButton>
        )}
      </div>
    )
  }

  // Main tools view
  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton onClick={() => setViewMode('settings')} title="Settings">
          {settingsGearIcon}
        </PanelIconButton>
        <PanelPill>{providerPill}</PanelPill>
      </PanelActions>

      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>{activeEntity.label}</PanelSectionTitle>
        </div>

        {error ? (
          <PanelCard className="text-xs text-red-700 dark:text-red-300">{error}</PanelCard>
        ) : null}

        {toolContext === 'content' && renderContentTools()}
        {toolContext === 'entity' && renderEntityTools()}
        {toolContext === 'notes' && renderNotesTools()}
        {toolContext === 'timeline' && renderTimelineTools()}
      </PanelBody>
    </PanelFrame>
  )
}
