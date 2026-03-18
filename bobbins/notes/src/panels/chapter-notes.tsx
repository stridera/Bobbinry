import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  BobbinrySDK,
  PanelActions,
  PanelBody,
  PanelEmptyState,
  PanelFrame,
  PanelPill,
} from '@bobbinry/sdk'

interface ChapterNotesPanelProps {
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

type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

export default function ChapterNotesPanel({ context }: ChapterNotesPanelProps) {
  const [noteText, setNoteText] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
  const [activeChapter, setActiveChapter] = useState<ChapterContext | null>(null)

  const [sdk] = useState(() => new BobbinrySDK('notes'))
  const projectId = useMemo(() => context?.projectId || context?.currentProject, [context?.projectId, context?.currentProject])

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTextRef = useRef<string | null>(null)
  const activeEntityRef = useRef<string | null>(null)

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

  // Flush pending save for a given entity
  const flushSave = useCallback(async (entityId: string, text: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    pendingTextRef.current = null

    try {
      setSaveStatus('saving')
      const result = await sdk.entities.update('content', entityId, { notes: text }) as any

      // Notify the manuscript editor about the version change
      const newVersion = result?._meta?.version ?? null
      if (newVersion != null) {
        window.dispatchEvent(new CustomEvent('bobbinry:entity-version-changed', {
          detail: { entityId, version: newVersion }
        }))
      }

      setSaveStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus(prev => prev === 'saved' ? 'clean' : prev)
      }, 2000)
    } catch (err) {
      console.error('[Chapter Notes] Save failed:', err)
      setSaveStatus('error')
    }
  }, [sdk])

  // Initialize activeChapter from context on mount (handles page refresh)
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

  // Listen for navigation events to detect active manuscript chapter
  useEffect(() => {
    function handleNavigate(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail) return

      if (detail.bobbinId === 'manuscript' && detail.entityType === 'content' && detail.entityId) {
        setActiveChapter({
          entityId: detail.entityId,
          entityType: detail.entityType,
          bobbinId: 'manuscript',
          label: detail.metadata?.title || detail.metadata?.name || 'Chapter'
        })
      }
    }

    function handleContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail) return

      if (detail.bobbinId === 'manuscript' && detail.entityType === 'content' && detail.entityId) {
        setActiveChapter(prev => {
          const label = detail.metadata?.title || detail.metadata?.name || prev?.label || 'Chapter'
          return {
            entityId: detail.entityId,
            entityType: detail.entityType,
            bobbinId: 'manuscript',
            label
          }
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

  // Flush pending save on chapter change
  useEffect(() => {
    const prevEntityId = activeEntityRef.current
    const newEntityId = activeChapter?.entityId ?? null

    if (prevEntityId && prevEntityId !== newEntityId && pendingTextRef.current !== null) {
      flushSave(prevEntityId, pendingTextRef.current)
    }

    activeEntityRef.current = newEntityId
  }, [activeChapter?.entityId, flushSave])

  // Load notes when active chapter changes
  useEffect(() => {
    if (!activeChapter || !projectId || !context?.apiToken) {
      setNoteText('')
      setSaveStatus('clean')
      return
    }

    let cancelled = false

    async function load() {
      try {
        const entity = await sdk.entities.get('content', activeChapter!.entityId) as any
        if (!cancelled) {
          setNoteText(entity?.notes || '')
          setSaveStatus('clean')
        }
      } catch (err) {
        console.error('[Chapter Notes] Failed to load:', err)
        if (!cancelled) {
          setNoteText('')
          setSaveStatus('error')
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [activeChapter?.entityId, projectId, context?.apiToken, sdk])

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      const eid = activeEntityRef.current
      if (eid && pendingTextRef.current !== null) {
        // Fire-and-forget flush on unmount
        sdk.entities.update('content', eid, { notes: pendingTextRef.current }).catch(() => {})
      }
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [sdk])

  function handleChange(value: string) {
    setNoteText(value)
    setSaveStatus('dirty')
    pendingTextRef.current = value

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

    const entityId = activeChapter?.entityId
    if (!entityId) return

    saveTimeoutRef.current = setTimeout(() => {
      flushSave(entityId, value)
    }, 2000)
  }

  if (!projectId) {
    return <PanelEmptyState title="No project selected" description="Open a project to see chapter notes." />
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
            description="Open a manuscript chapter to jot notes here."
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  const statusLabel = saveStatus === 'dirty' ? 'Unsaved' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : null

  return (
    <PanelFrame>
      <PanelActions>
        <PanelPill>{activeChapter.label}</PanelPill>
        {statusLabel ? (
          <span className={`text-[11px] ${saveStatus === 'error' ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
            {statusLabel}
          </span>
        ) : null}
      </PanelActions>
      <PanelBody className="flex flex-1 flex-col">
        <textarea
          value={noteText}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Jot notes for this chapter..."
          className="flex-1 w-full resize-none bg-transparent p-2 text-sm font-mono text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
        />
      </PanelBody>
    </PanelFrame>
  )
}
