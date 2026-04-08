import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BobbinrySDK,
  PanelActions,
  PanelBody,
  PanelEmptyState,
  PanelFrame,
  PanelPill,
} from '@bobbinry/sdk'

interface AnnotationPanelProps {
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
  label: string
}

interface Annotation {
  id: string
  chapterId: string
  authorId: string
  authorName?: string
  anchorParagraphIndex: number | null
  anchorQuote: string
  annotationType: string
  errorCategory: string | null
  content: string
  suggestedText: string | null
  status: string
  authorResponse: string | null
  chapterVersion: number
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  acknowledged: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  dismissed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

const TYPE_COLORS: Record<string, string> = {
  error: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  suggestion: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  feedback: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
}

export default function AnnotationPanel({ context }: AnnotationPanelProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(false)
  const [activeChapter, setActiveChapter] = useState<ChapterContext | null>(null)
  const [respondingTo, setRespondingTo] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const [confirmingAccept, setConfirmingAccept] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  const [sdk] = useState(() => new BobbinrySDK('feedback'))
  const projectId = useMemo(() => context?.projectId || context?.currentProject, [context?.projectId, context?.currentProject])

  useEffect(() => {
    if (context?.apiToken) sdk.api.setAuthToken(context.apiToken)
  }, [context?.apiToken, sdk])

  // Detect active chapter from context
  useEffect(() => {
    if (
      context?.bobbinId === 'manuscript' &&
      context?.entityType === 'content' &&
      context?.entityId
    ) {
      setActiveChapter({
        entityId: context.entityId,
        label: context.metadata?.title || context.metadata?.name || 'Chapter'
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
          label: detail.metadata?.title || detail.metadata?.name || 'Chapter'
        })
      }
    }

    function handleContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      if (detail.bobbinId === 'manuscript' && detail.entityType === 'content' && detail.entityId) {
        setActiveChapter(prev => ({
          entityId: detail.entityId,
          label: detail.metadata?.title || detail.metadata?.name || prev?.label || 'Chapter'
        }))
      }
    }

    window.addEventListener('bobbinry:navigate', handleNavigate)
    window.addEventListener('bobbinry:view-context-change', handleContextChange)
    return () => {
      window.removeEventListener('bobbinry:navigate', handleNavigate)
      window.removeEventListener('bobbinry:view-context-change', handleContextChange)
    }
  }, [])

  // Fetch annotations when chapter changes
  const fetchAnnotations = useCallback(async () => {
    if (!projectId || !activeChapter || !context?.apiToken) return
    setLoading(true)
    try {
      const baseUrl = sdk.api.apiBaseUrl
      const res = await fetch(
        `${baseUrl}/projects/${projectId}/annotations?chapterId=${activeChapter.entityId}`,
        { headers: sdk.api.getAuthHeaders() }
      )
      if (res.ok) {
        const data = await res.json()
        setAnnotations(data.annotations || [])
      }
    } catch (err) {
      console.error('[Feedback Panel] Failed to load annotations:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, activeChapter, context?.apiToken, sdk])

  useEffect(() => {
    fetchAnnotations()
  }, [fetchAnnotations])

  const updateStatus = async (annotationId: string, status: string, response?: string) => {
    if (!projectId) return
    try {
      const baseUrl = sdk.api.apiBaseUrl
      const res = await fetch(
        `${baseUrl}/projects/${projectId}/annotations/${annotationId}/status`,
        {
          method: 'PUT',
          headers: sdk.api.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ status, authorResponse: response })
        }
      )
      if (res.ok) {
        const data = await res.json()
        setAnnotations(prev => prev.map(a => a.id === annotationId ? { ...a, ...data.annotation } : a))
        setRespondingTo(null)
        setResponseText('')
      }
    } catch (err) {
      console.error('[Feedback Panel] Failed to update status:', err)
    }
  }

  const acceptSuggestion = async (annotationId: string) => {
    if (!projectId) return
    setAcceptError(null)
    const ann = annotations.find(a => a.id === annotationId)
    try {
      const baseUrl = sdk.api.apiBaseUrl
      const res = await fetch(
        `${baseUrl}/projects/${projectId}/annotations/${annotationId}/accept`,
        {
          method: 'POST',
          headers: sdk.api.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ editorWillApply: true })
        }
      )
      if (res.ok) {
        const data = await res.json()
        setAnnotations(prev => prev.map(a => a.id === annotationId ? { ...a, ...data.annotation } : a))
        setConfirmingAccept(null)
        // Tell the editor to apply the replacement in its live document
        if (ann?.suggestedText) {
          window.dispatchEvent(new CustomEvent('bobbinry:editor-replace-text', {
            detail: { find: ann.anchorQuote, replace: ann.suggestedText }
          }))
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        setAcceptError(err.error || 'Failed to apply suggestion')
        setTimeout(() => setAcceptError(null), 5000)
      }
    } catch (err) {
      console.error('[Feedback Panel] Failed to accept suggestion:', err)
      setAcceptError('Failed to apply suggestion')
      setTimeout(() => setAcceptError(null), 5000)
    }
  }

  const focusAnnotation = (ann: Annotation) => {
    window.dispatchEvent(new CustomEvent('bobbinry:editor-focus-text', {
      detail: {
        paragraphIndex: ann.anchorParagraphIndex,
        quote: ann.anchorQuote
      }
    }))
  }

  if (!projectId) {
    return <PanelEmptyState title="No project selected" description="Open a project to see reader feedback." />
  }

  if (!activeChapter) {
    return (
      <PanelFrame>
        <PanelActions>
          <PanelPill>Waiting</PanelPill>
        </PanelActions>
        <PanelBody>
          <PanelEmptyState
            title="No chapter selected"
            description="Open a manuscript chapter to see reader feedback."
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  const openAnnotations = annotations.filter(a => a.status === 'open' || a.status === 'acknowledged')
  const resolvedAnnotations = annotations.filter(a => a.status === 'resolved' || a.status === 'dismissed')

  return (
    <PanelFrame>
      <PanelActions>
        <PanelPill>{activeChapter.label}</PanelPill>
        {annotations.length > 0 && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {openAnnotations.length} open
          </span>
        )}
      </PanelActions>
      <PanelBody className="flex flex-1 flex-col p-2 space-y-2 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-gray-400 text-center py-4">Loading...</div>
        ) : annotations.length === 0 ? (
          <PanelEmptyState
            title="No feedback yet"
            description="Readers with annotation access can leave feedback on this chapter."
          />
        ) : (
          <>
            {openAnnotations.map(ann => (
              <div
                key={ann.id}
                className="p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                onClick={() => focusAnnotation(ann)}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TYPE_COLORS[ann.annotationType] || ''}`}>
                    {ann.annotationType}{ann.errorCategory ? `: ${ann.errorCategory}` : ''}
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLORS[ann.status] || ''}`}>
                    {ann.status}
                  </span>
                </div>

                <div className="text-[11px] text-gray-500 dark:text-gray-400 italic line-clamp-2 mb-1">
                  &ldquo;{ann.anchorQuote}&rdquo;
                </div>

                <div className="text-xs text-gray-800 dark:text-gray-200 mb-1.5">{ann.content}</div>

                {ann.suggestedText && (
                  <div className="text-[11px] text-blue-600 dark:text-blue-400 mb-1.5">
                    Suggested: &ldquo;{ann.suggestedText}&rdquo;
                  </div>
                )}

                <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">
                  {ann.authorName || 'Reader'} &middot; {new Date(ann.createdAt).toLocaleDateString()}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
                  {ann.status === 'open' && (
                    <button
                      onClick={() => updateStatus(ann.id, 'acknowledged')}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                    >
                      Acknowledge
                    </button>
                  )}
                  {ann.suggestedText && (
                    <button
                      onClick={() => setConfirmingAccept(confirmingAccept === ann.id ? null : ann.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50 font-medium"
                    >
                      Accept
                    </button>
                  )}
                  <button
                    onClick={() => updateStatus(ann.id, 'resolved')}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => updateStatus(ann.id, 'dismissed')}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => {
                      setRespondingTo(respondingTo === ann.id ? null : ann.id)
                      setResponseText(ann.authorResponse || '')
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  >
                    Reply
                  </button>
                </div>

                {/* Accept confirmation */}
                {confirmingAccept === ann.id && ann.suggestedText && (
                  <div className="mt-1.5 p-1.5 rounded border border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/20" onClick={e => e.stopPropagation()}>
                    <div className="text-[10px] font-medium text-gray-600 dark:text-gray-300 mb-1">Apply this change?</div>
                    <div className="text-[11px] space-y-0.5 mb-1.5">
                      <div className="flex items-start gap-1">
                        <span className="text-red-500 text-[10px] flex-shrink-0">-</span>
                        <span className="line-through text-gray-400">{ann.anchorQuote}</span>
                      </div>
                      <div className="flex items-start gap-1">
                        <span className="text-emerald-600 text-[10px] flex-shrink-0">+</span>
                        <span className="text-emerald-700 dark:text-emerald-300 font-medium">{ann.suggestedText}</span>
                      </div>
                    </div>
                    {acceptError && (
                      <div className="text-[10px] text-red-600 dark:text-red-400 mb-1">{acceptError}</div>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => acceptSuggestion(ann.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => setConfirmingAccept(null)}
                        className="text-[10px] px-1.5 py-0.5 text-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Response input */}
                {respondingTo === ann.id && (
                  <div className="mt-1.5" onClick={e => e.stopPropagation()}>
                    <textarea
                      value={responseText}
                      onChange={e => setResponseText(e.target.value)}
                      placeholder="Write a response..."
                      rows={2}
                      className="w-full text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 bg-transparent rounded resize-none"
                    />
                    <div className="flex justify-end gap-1 mt-1">
                      <button
                        onClick={() => { setRespondingTo(null); setResponseText('') }}
                        className="text-[10px] px-1.5 py-0.5 text-gray-500"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => updateStatus(ann.id, 'acknowledged', responseText)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {resolvedAnnotations.length > 0 && (
              <details className="mt-2">
                <summary className="text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer select-none">
                  {resolvedAnnotations.length} resolved/dismissed
                </summary>
                <div className="mt-1 space-y-1.5">
                  {resolvedAnnotations.map(ann => (
                    <div
                      key={ann.id}
                      className="p-2 rounded border border-gray-100 dark:border-gray-800 opacity-60"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TYPE_COLORS[ann.annotationType] || ''}`}>
                          {ann.annotationType}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLORS[ann.status] || ''}`}>
                          {ann.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 italic line-clamp-1">&ldquo;{ann.anchorQuote}&rdquo;</div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{ann.content}</div>
                      {ann.authorResponse && (
                        <div className="text-[11px] text-gray-500 mt-1 pl-2 border-l-2 border-blue-300 dark:border-blue-700">
                          {ann.authorResponse}
                        </div>
                      )}
                      {/* Re-open */}
                      <button
                        onClick={() => updateStatus(ann.id, 'open')}
                        className="text-[10px] text-gray-400 hover:text-gray-600 mt-1"
                      >
                        Re-open
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </PanelBody>
    </PanelFrame>
  )
}
