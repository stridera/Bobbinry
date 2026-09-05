import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Editor } from '@tiptap/react'
import { AuthError, ConflictError, type BobbinrySDK } from '@bobbinry/sdk'
import { isContentType, sanitizeDisplaySettings, type ContentType, type PartialManuscriptDisplaySettings } from '@bobbinry/types'
import { getDraftKey, loadDraft, removeDraft, saveDraft, versionDebug, type DraftEntry } from '../lib/drafts'
import { AUTH_TOKEN_RENEWED_EVENT, type ConflictInfo, type SaveStatus } from '../lib/editor-types'
import { clearPendingHighlight, getPendingSearchHighlight } from '../lib/search-highlight-bridge'

interface UseChapterPersistenceArgs {
  sdk: BobbinrySDK
  /** The TipTap editor; null until it mounts (immediatelyRender: false). */
  editor: Editor | null
  editorRef: MutableRefObject<Editor | null>
  entityId: string | undefined
  entityType: string | undefined
  /** Shared with other hooks: the entity currently shown. */
  activeEntityRef: MutableRefObject<string | null>
  /** Called after content is placed in the editor (search highlight re-anchor). */
  onContentApplied: (editor: Editor) => void
  onContentType: (ct: ContentType) => void
  onContentDisplay: (settings: PartialManuscriptDisplaySettings) => void
}

/**
 * Content persistence for the manuscript editor.
 *
 * 1. Every edit is immediately written to localStorage as a draft
 * 2. Server saves are debounced (800ms after last edit) through one accumulator,
 *    so title and body can never race on the entity version
 * 3. On navigation away, pending edits are flushed to the server
 * 4. On navigation back, the local draft shows instantly and is reconciled
 *    against the server version (HEAD first, full fetch only when needed)
 *
 * Everything reads the editor through `editorRef` so the debounced callbacks
 * and window listeners never act on a stale instance.
 */
export function useChapterPersistence({
  sdk,
  editor,
  editorRef,
  entityId,
  entityType,
  activeEntityRef,
  onContentApplied,
  onContentType,
  onContentDisplay,
}: UseChapterPersistenceArgs) {
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
  const [wordCount, setWordCount] = useState(0)
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null)

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Unified dirty-fields accumulator. All saves (title, body, wordCount) flow
  // through a single debounce timer so that title and body can never race.
  const pendingFieldsRef = useRef<{ title?: string; body?: string; wordCount?: number } | null>(null)
  // Monotonic counter — only the latest loadContent call may update UI state
  const loadGenRef = useRef(0)
  // Suppress onUpdate save during programmatic setContent
  const suppressSaveRef = useRef(false)
  // Track in-flight save to avoid concurrent saves
  const savingRef = useRef(false)
  // Server version for optimistic locking
  const versionRef = useRef<number | null>(null)
  // Timestamp of last version check (throttles visibility-change checks)
  const lastVersionCheckRef = useRef(0)

  // ── Core operations ────────────────────────────────────────────────────

  /**
   * Apply content to the editor. Shared by the instant-load and server-load
   * paths.
   */
  function applyContent(body: string, titleVal: string, count: number) {
    setTitle(titleVal)
    setWordCount(count)
    const ed = editorRef.current
    if (!ed) return
    suppressSaveRef.current = true
    // addToHistory: false so chapter loads don't bloat the undo stack. Without
    // this, each setContent adds a full-document-replacement entry and after
    // ~10 switches TipTap slows down processing the history on every transaction.
    ed.chain()
      .command(({ tr }) => {
        tr.setMeta('addToHistory', false)
        return true
      })
      .setContent(body)
      .run()
    queueMicrotask(() => {
      suppressSaveRef.current = false
      onContentApplied(ed)

      // If stored word count is 0 but the editor has text, recalculate and
      // persist so the count is accurate without requiring an edit.
      if (count === 0 && body && body !== '<p></p>') {
        const actualCount = ed.storage.characterCount.words()
        if (actualCount > 0) {
          setWordCount(actualCount)
          const currentEntityId = activeEntityRef.current
          if (currentEntityId) {
            saveDraft(currentEntityId, { html: body, title: titleVal, wordCount: actualCount, savedToServer: false })
            serverSave(currentEntityId, body, actualCount)
          }
        }
      }
    })
  }

  /**
   * Merge dirty fields into the pending accumulator and restart the single
   * debounce timer. Title, body and word count changes all flow through here.
   */
  function scheduleSave(fields: { title?: string; body?: string; wordCount?: number }, targetEntityId: string) {
    pendingFieldsRef.current = { ...pendingFieldsRef.current, ...fields }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      fireScheduledSave(targetEntityId)
    }, 800)
  }

  /** Drain pendingFieldsRef into a serverSave call. */
  function fireScheduledSave(targetEntityId: string) {
    const pending = pendingFieldsRef.current
    if (!pending) return
    pendingFieldsRef.current = null
    serverSave(
      targetEntityId,
      pending.body,
      pending.wordCount,
      pending.title !== undefined ? { title: pending.title } : undefined
    )
  }

  /** Record a keystroke: cache the draft, mark dirty, schedule the server save. */
  function recordEdit(html: string, count: number) {
    const currentEntityId = activeEntityRef.current
    if (!currentEntityId) return
    // Immediately cache to localStorage — this is the safety net
    saveDraft(currentEntityId, { html, wordCount: count, savedToServer: false })
    setSaveStatus('dirty')
    scheduleSave({ body: html, wordCount: count }, currentEntityId)
  }

  /**
   * Actually persist content to the server. The entityId is captured at
   * schedule time, not read from the current prop.
   */
  async function serverSave(
    targetEntityId: string,
    html: string | undefined,
    count: number | undefined,
    opts?: { skipVersionCheck?: boolean; title?: string }
  ) {
    if (!targetEntityId || savingRef.current) return
    // Nothing to save — no body, no count, no title. Bail before hitting the network.
    if (html === undefined && count === undefined && opts?.title === undefined) return

    // Don't attempt server save when offline — stay in offline/dirty state
    if (!navigator.onLine) {
      setSaveStatus('offline')
      if (html !== undefined && count !== undefined) {
        saveDraft(targetEntityId, { html, wordCount: count, savedToServer: false })
      }
      return
    }

    const expectedVersion = opts?.skipVersionCheck ? undefined : (versionRef.current ?? undefined)

    const data: Record<string, any> = {}
    if (html !== undefined) data.body = html
    if (count !== undefined) data.word_count = count
    if (opts?.title !== undefined) data.title = opts.title

    try {
      savingRef.current = true
      setSaveStatus('saving')

      const result = await sdk.entities.update('content', targetEntityId, data, expectedVersion) as any

      const newVersion = result?._meta?.version ?? null
      versionDebug('save-ok', {
        eid: targetEntityId,
        expectedVersion: expectedVersion ?? null,
        newVersion,
        fields: Object.keys(data),
      }, 'debug')
      // Persist draft as saved. When the save was title-only, reuse the
      // existing draft's html/wordCount so we don't wipe the cached body.
      const existingDraft = loadDraft(targetEntityId)
      const draftUpdate: Partial<DraftEntry> & { html: string } = {
        html: html ?? existingDraft?.html ?? '',
        wordCount: count ?? existingDraft?.wordCount ?? 0,
        savedToServer: true,
        version: newVersion,
      }
      const nextTitle = opts?.title ?? existingDraft?.title
      if (nextTitle !== undefined) draftUpdate.title = nextTitle
      saveDraft(targetEntityId, draftUpdate)

      // Only update in-memory version + UI status if this entity is still active.
      // A flushed save for the previous entity can complete after navigation; without
      // this guard it would overwrite versionRef with the wrong entity's version.
      if (activeEntityRef.current === targetEntityId) {
        versionRef.current = newVersion
        setSaveStatus('saved')
        setConflictInfo(null)
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => {
          setSaveStatus(prev => prev === 'saved' ? 'clean' : prev)
        }, 2000)
      }
    } catch (error) {
      // Mark draft as unsaved. For title-only saves we don't have html/count
      // in scope, so merge onto the existing draft to avoid clobbering it.
      const markDirty = () => {
        const existing = loadDraft(targetEntityId)
        const draftUpdate: Partial<DraftEntry> & { html: string } = {
          html: html ?? existing?.html ?? '',
          wordCount: count ?? existing?.wordCount ?? 0,
          savedToServer: false,
        }
        const nextTitle = opts?.title ?? existing?.title
        if (nextTitle !== undefined) draftUpdate.title = nextTitle
        saveDraft(targetEntityId, draftUpdate)
      }

      if (error instanceof ConflictError) {
        versionDebug('save-conflict', {
          eid: targetEntityId,
          branch: 'CONFLICT: server rejected save (409)',
          expectedVersion: error.expectedVersion,
          serverVersion: error.currentVersion,
          versionRef: versionRef.current,
          draftVersion: loadDraft(targetEntityId)?.version ?? null,
          fields: Object.keys(data),
        }, 'warn')
        markDirty()
        if (activeEntityRef.current === targetEntityId) {
          setSaveStatus('conflict')
          setConflictInfo({ serverVersion: error.currentVersion, localVersion: versionRef.current })
        }
        return
      }
      if (error instanceof AuthError) {
        // Session expired. The SDK's 401 hook has already asked the shell to
        // renew the token; we'll get AUTH_TOKEN_RENEWED_EVENT and retry. If
        // renewal fails the shell redirects to /login, and beforeunload
        // flushes the draft. Either way the prose is safe in localStorage.
        console.warn('[EditorView] Auto-save rejected: session expired')
        markDirty()
        if (activeEntityRef.current === targetEntityId) setSaveStatus('auth')
        return
      }
      console.error('[EditorView] Auto-save failed:', error)
      markDirty()
      if (activeEntityRef.current === targetEntityId) {
        const isNetworkError = error instanceof TypeError && error.message.includes('fetch')
        setSaveStatus(isNetworkError || !navigator.onLine ? 'offline' : 'error')
      }
    } finally {
      savingRef.current = false

      // If new dirty fields accumulated during the in-flight save, fire them
      // immediately so we chain to the fresh version without waiting for the
      // debounce timer. Only re-fire if this entity is still active.
      if (pendingFieldsRef.current && activeEntityRef.current === targetEntityId) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }
        fireScheduledSave(targetEntityId)
      }
    }
  }

  /**
   * Flush any pending debounced save on navigation away.
   *
   * Only flushes drafts that onUpdate already wrote to localStorage. We do
   * NOT read editor.getHTML() here to create new drafts: during React strict
   * mode's double-invocation the editor may still hold the PREVIOUS entity's
   * content when the cleanup runs for the NEW entity, which would
   * cross-contaminate the draft cache.
   */
  function flushPendingState() {
    const outgoingEntityId = activeEntityRef.current

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    if (!outgoingEntityId) {
      pendingFieldsRef.current = null
      return
    }

    const draft = loadDraft(outgoingEntityId)
    const pending = pendingFieldsRef.current
    pendingFieldsRef.current = null

    if (draft && !draft.savedToServer) {
      // Draft is dirty — flush body + word count + any pending title via
      // serverSave so the write always carries expectedVersion.
      serverSave(
        outgoingEntityId,
        draft.html,
        draft.wordCount,
        pending?.title !== undefined ? { title: pending.title } : undefined
      )
    } else if (pending?.title !== undefined) {
      // Body was already saved, only a title change is pending.
      serverSave(outgoingEntityId, undefined, undefined, { title: pending.title })
    }
    // If there's an in-flight save (savingRef=true), serverSave() will bail
    // and the localStorage draft remains the safety net — the next load of
    // this entity will detect the unsaved draft and schedule a save.
  }

  /** Read one server record into the editor + draft cache. */
  function adoptServerContent(targetEntityId: string, serverContent: any, fallbackTitle: string, fallbackContainerId: string | null, fallbackVersion: number | null) {
    const serverTitle = serverContent?.title ?? ''
    const serverBody = serverContent?.body ?? ''
    const serverWordCount = serverContent?.word_count ?? 0
    const newVersion = serverContent?._meta?.version ?? fallbackVersion
    if (isContentType(serverContent?.contentType)) onContentType(serverContent.contentType)

    applyContent(serverBody, serverTitle || fallbackTitle, serverWordCount)
    versionRef.current = newVersion
    saveDraft(targetEntityId, {
      html: serverBody,
      title: serverTitle || fallbackTitle,
      wordCount: serverWordCount,
      savedToServer: true,
      version: newVersion,
      containerId: serverContent?.container_id ?? fallbackContainerId,
    })
  }

  async function loadContent(targetEntityId: string) {
    // Increment the generation counter. Only THIS call is allowed to update UI.
    const gen = ++loadGenRef.current
    const isStale = () => loadGenRef.current !== gen

    setConflictInfo(null)

    const draft = loadDraft(targetEntityId)

    // --- Fast path: if we have a local draft, show it instantly ---
    if (draft && draft.html && draft.html !== '<p></p>') {
      applyContent(draft.html, draft.title, draft.wordCount)
      versionRef.current = draft.version ?? null
      setSaveStatus(draft.savedToServer ? 'clean' : 'dirty')
      setLoading(false)

      if (!draft.savedToServer) {
        // Unsaved draft — schedule a server save to sync it
        scheduleSave({ body: draft.html, wordCount: draft.wordCount }, targetEntityId)
      }

      // Lightweight version check via HEAD — avoids downloading full content
      sdk.entities.getVersion('content', targetEntityId).then((versionInfo) => {
        if (isStale() || !versionInfo) return
        const serverVersion = versionInfo.version

        // Don't judge against a mid-flight save — its completion re-stamps
        // the draft and the next check will see consistent state.
        if (savingRef.current) {
          versionDebug('load-check', { eid: targetEntityId, branch: 'skip: save in flight' }, 'debug')
          return
        }

        // Re-read the draft: the scheduleSave above (or a keystroke save) may
        // have completed during the HEAD round-trip, bumping the server version
        // and re-stamping the draft. Judging against the stale pre-request
        // snapshot produced phantom conflict dialogs.
        const fresh = loadDraft(targetEntityId) ?? draft

        const ctx = {
          eid: targetEntityId,
          serverVersion,
          draftVersion: fresh.version,
          savedToServer: fresh.savedToServer,
          versionRef: versionRef.current,
          draftAgeMs: Date.now() - fresh.timestamp,
          savePending: pendingFieldsRef.current !== null,
        }

        if (fresh.version !== null && serverVersion === fresh.version) {
          versionDebug('load-check', { ...ctx, branch: 'match' }, 'debug')
          return
        }

        if (!fresh.savedToServer) {
          // CONFLICT: local unsaved edits AND server changed
          versionDebug('load-check', { ...ctx, branch: 'CONFLICT: unsaved local edits + server version differs' }, 'warn')
          setSaveStatus('conflict')
          setConflictInfo({ serverVersion, localVersion: fresh.version })
          return
        }

        versionDebug('load-check', { ...ctx, branch: 'server newer, draft clean — reconciling' })

        // Draft was saved — server is newer, fetch full content to update
        sdk.entities.get('content', targetEntityId).then((result: any) => {
          if (isStale()) return
          adoptServerContent(targetEntityId, result, fresh.title, fresh.containerId, serverVersion)
        }).catch(() => {})
      }).catch(() => {
        // HEAD failed — fall back to full fetch for reconciliation
        sdk.entities.get('content', targetEntityId).then((result: any) => {
          if (isStale()) return
          const serverContent = result as any
          const serverTitle = serverContent?.title ?? ''
          const serverBody = serverContent?.body ?? ''
          const newVersion = serverContent?._meta?.version ?? null
          if (isContentType(serverContent?.contentType)) onContentType(serverContent.contentType)

          versionRef.current = newVersion

          if (draft.savedToServer) {
            if (serverBody && serverBody !== draft.html) {
              adoptServerContent(targetEntityId, serverContent, draft.title, draft.containerId, newVersion)
            }
          } else if (serverTitle && serverTitle !== draft.title) {
            setTitle(serverTitle)
            saveDraft(targetEntityId, { html: draft.html, title: serverTitle, wordCount: draft.wordCount, savedToServer: false })
          }
        }).catch(() => {})
      })

      return
    }

    // --- Slow path: no local draft, must fetch from server ---
    setLoading(true)
    setSaveStatus('clean')

    try {
      const result = await sdk.entities.get('content', targetEntityId)
      const serverContent = result as any

      if (isStale()) return

      const body = serverContent.body || ''
      const titleVal = serverContent.title || ''
      const count = serverContent.word_count || 0
      const version = serverContent._meta?.version ?? null
      const containerId = serverContent.container_id ?? null
      const ct = isContentType(serverContent.contentType) ? serverContent.contentType : 'chapter'

      applyContent(body, titleVal, count)
      onContentType(ct)
      onContentDisplay(sanitizeDisplaySettings(serverContent.displaySettings))
      versionRef.current = version

      // Cache for instant loading next time
      saveDraft(targetEntityId, {
        html: body,
        title: titleVal,
        wordCount: count,
        savedToServer: true,
        version,
        containerId,
      })

      setLoading(false)
    } catch (error) {
      if (isStale()) return

      console.error('[EditorView] Failed to load content:', error)

      // Last resort: try local draft (might exist from a previous session)
      const fallbackDraft = loadDraft(targetEntityId)
      if (fallbackDraft && editorRef.current) {
        applyContent(fallbackDraft.html, fallbackDraft.title, fallbackDraft.wordCount)
        versionRef.current = fallbackDraft.version ?? null
        setSaveStatus('dirty')
      }

      setLoading(false)
    }
  }

  // ── User-facing handlers ───────────────────────────────────────────────

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    if (!entityId) return

    const draft = loadDraft(entityId)
    if (draft) {
      saveDraft(entityId, { ...draft, title: newTitle, savedToServer: false })
    }

    // Notify sidebar immediately so the tree updates in real-time.
    // Marked with source: 'editor' so the external-rename listener ignores it.
    window.dispatchEvent(
      new CustomEvent('bobbinry:entity-updated', {
        detail: { collection: 'content', entityId, changes: { title: newTitle }, source: 'editor' }
      })
    )

    // Route through the unified save path so title + body share one
    // serialized save cycle with the current expectedVersion.
    setSaveStatus('dirty')
    scheduleSave({ title: newTitle }, entityId)
  }

  function handleConflictReload() {
    const eid = activeEntityRef.current
    if (!eid) return
    // Clear local draft, reset version, re-fetch from server
    removeDraft(eid)
    versionRef.current = null
    setConflictInfo(null)
    setSaveStatus('clean')
    loadContent(eid)
  }

  async function handleConflictSaveAsNew() {
    const eid = activeEntityRef.current
    const ed = editorRef.current
    if (!eid || !ed) return
    const draft = loadDraft(eid)
    const html = ed.getHTML()
    const currentTitle = title || draft?.title || 'Untitled'
    const containerId = draft?.containerId ?? null

    try {
      const newData: Record<string, any> = {
        title: `${currentTitle} (copy)`,
        body: html,
        word_count: wordCount,
      }
      if (containerId) newData.container_id = containerId

      const created = await sdk.entities.create('content', newData) as any
      const newVersion = created?._meta?.version ?? null

      versionRef.current = newVersion
      setConflictInfo(null)
      setSaveStatus('saved')

      // Notify sidebar so it shows the new scene
      window.dispatchEvent(
        new CustomEvent('bobbinry:entity-updated', {
          detail: { collection: 'content', entityId: created.id, source: 'editor' }
        })
      )

      removeDraft(eid)
    } catch (error) {
      console.error('[EditorView] Failed to save as new scene:', error)
    }
  }

  function handleConflictOverwrite() {
    const eid = activeEntityRef.current
    const ed = editorRef.current
    if (!eid || !ed) return
    const html = ed.getHTML()
    setConflictInfo(null)
    // Retry save without expectedVersion — forces overwrite
    serverSave(eid, html, wordCount, { skipVersionCheck: true })
  }

  /**
   * Ctrl/Cmd+Enter: create a new chapter directly below the one being edited
   * (the server places it via insert_after) and navigate to it with the title
   * focused, so finishing a chapter and starting the next needs no mouse.
   * Any pending debounced save still targets the old entity id, so in-flight
   * edits aren't lost by the navigation.
   */
  async function createChapterBelow() {
    const eid = activeEntityRef.current
    if (!eid) return
    const containerId = loadDraft(eid)?.containerId ?? null

    try {
      const created = await sdk.entities.create('content', {
        title: 'New Content',
        type: 'scene',
        content_type: 'chapter',
        ...(containerId ? { container_id: containerId } : {}),
        insert_after: eid,
        order: Date.now(),
        word_count: 0,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }) as any

      // Tell the navigation panel to reload its tree (if mounted), then open
      // the new chapter.
      window.dispatchEvent(new CustomEvent('bobbinry:content-created', { detail: { entityId: created.id, containerId } }))
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: 'content',
          entityId: created.id,
          bobbinId: 'manuscript',
          metadata: { type: 'scene', parentId: containerId, focusTitle: true }
        }
      }))
    } catch (error) {
      console.error('[EditorView] Failed to create chapter below:', error)
    }
  }

  // ── Effects ────────────────────────────────────────────────────────────

  // Offline detection + session-renewal retry
  useEffect(() => {
    const retryDraft = (from: SaveStatus): SaveStatus => {
      const eid = activeEntityRef.current
      if (eid) {
        const draft = loadDraft(eid)
        if (draft && !draft.savedToServer) {
          setTimeout(() => serverSave(eid, draft.html, draft.wordCount), 500)
          return 'saving'
        }
      }
      return from
    }
    const goOnline = () => setSaveStatus(prev => (prev === 'offline' ? retryDraft('dirty') : prev))
    const goOffline = () => setSaveStatus(prev => ((prev === 'dirty' || prev === 'error') ? 'offline' : prev))
    // The shell renewed the API token after a 401 — retry the local draft.
    const onTokenRenewed = () => setSaveStatus(prev => (prev === 'auth' ? retryDraft('dirty') : prev))
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    window.addEventListener(AUTH_TOKEN_RENEWED_EVENT, onTokenRenewed)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.removeEventListener(AUTH_TOKEN_RENEWED_EVENT, onTokenRenewed)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for version changes from other panels (e.g. chapter notes saving to the same entity)
  useEffect(() => {
    function handleVersionChanged(e: Event) {
      const detail = (e as CustomEvent<{ entityId: string; version: number }>).detail
      if (!detail || detail.entityId !== activeEntityRef.current) return

      versionDebug('version-event', {
        eid: detail.entityId,
        newVersion: detail.version,
        prevVersionRef: versionRef.current,
      }, 'debug')
      versionRef.current = detail.version

      const draft = loadDraft(detail.entityId)
      if (draft) saveDraft(detail.entityId, { html: draft.html, version: detail.version })
    }
    window.addEventListener('bobbinry:entity-version-changed', handleVersionChanged)
    return () => window.removeEventListener('bobbinry:entity-version-changed', handleVersionChanged)
  }, [activeEntityRef])

  // Sync title when another view (e.g. sidebar) renames the current entity.
  // Events with source === 'editor' are ours — skip them to avoid bouncing
  // stale titles back during fast typing.
  useEffect(() => {
    function handleExternalRename(e: Event) {
      const { entityId: updatedId, changes, source } = (e as CustomEvent).detail
      if (source === 'editor') return
      if (updatedId === entityId && changes?.title != null) setTitle(changes.title)
    }
    window.addEventListener('bobbinry:entity-updated', handleExternalRename)
    return () => window.removeEventListener('bobbinry:entity-updated', handleExternalRename)
  }, [entityId])

  // --- Switch entities: record the new active entity, load it, flush the old one on cleanup ---
  useEffect(() => {
    activeEntityRef.current = entityId ?? null

    // Drop a stale search-highlight aimed at a chapter we just left.
    const pendingHighlight = getPendingSearchHighlight()
    if (pendingHighlight && pendingHighlight.entityId !== entityId) clearPendingHighlight()

    if (entityType === 'content' && entityId && editor) {
      loadContent(entityId)
    } else {
      setLoading(false)
    }

    return () => {
      flushPendingState()
    }
  }, [entityId, entityType, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh the editor when Search & Replace applies a bulk change that
  // includes this chapter. Drop the cached draft first so the local copy
  // can't clobber the new server content on the next save.
  // `editor` must be a dep: with immediatelyRender:false it is null on the
  // first render, and a handler bound then would capture a loadContent whose
  // applyContent can never write into the editor body.
  useEffect(() => {
    if (!editor) return
    function handleBulkUpdated(e: Event) {
      const ids = (e as CustomEvent<{ entityIds: string[] }>).detail?.entityIds
      const active = activeEntityRef.current
      if (!active || !Array.isArray(ids) || !ids.includes(active)) return
      removeDraft(active)
      if (entityType === 'content') loadContent(active)
    }
    window.addEventListener('bobbinry:entities-bulk-updated', handleBulkUpdated)
    return () => window.removeEventListener('bobbinry:entities-bulk-updated', handleBulkUpdated)
  }, [entityType, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-check server version when the tab becomes visible again (content may
  // have been edited on another device). `editor` is a dep for the same
  // reason as above.
  useEffect(() => {
    if (!editor) return
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return

      const eid = activeEntityRef.current
      if (!eid) return

      // Throttle: skip if checked less than 10 seconds ago
      const now = Date.now()
      if (now - lastVersionCheckRef.current < 10_000) return
      lastVersionCheckRef.current = now

      // Don't interrupt an in-flight save or a conflict the user is resolving
      if (savingRef.current) return
      if (!localStorage.getItem(getDraftKey(eid))) return

      sdk.entities.getVersion('content', eid).then((versionInfo) => {
        if (!versionInfo) return
        if (activeEntityRef.current !== eid) return
        if (savingRef.current) {
          versionDebug('visibility-check', { eid, branch: 'skip: save in flight' }, 'debug')
          return
        }

        // Re-read the draft — a debounced save may have completed during
        // the async getVersion round-trip, updating version/savedToServer.
        const draft = loadDraft(eid)
        if (!draft) return

        const serverVersion = versionInfo.version
        const ctx = {
          eid,
          serverVersion,
          draftVersion: draft.version,
          savedToServer: draft.savedToServer,
          versionRef: versionRef.current,
          draftAgeMs: Date.now() - draft.timestamp,
          savePending: pendingFieldsRef.current !== null,
        }
        if (draft.version !== null && serverVersion === draft.version) {
          versionDebug('visibility-check', { ...ctx, branch: 'match' }, 'debug')
          return
        }

        if (!draft.savedToServer) {
          versionDebug('visibility-check', { ...ctx, branch: 'CONFLICT: unsaved local edits + server version differs' }, 'warn')
          setSaveStatus('conflict')
          setConflictInfo({ serverVersion, localVersion: draft.version })
          return
        }

        versionDebug('visibility-check', { ...ctx, branch: 'server newer, draft clean — reconciling' })

        sdk.entities.get('content', eid).then((result: any) => {
          if (activeEntityRef.current !== eid) return
          adoptServerContent(eid, result, draft.title, draft.containerId, serverVersion)
        }).catch(() => {})
      }).catch(() => {})
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Also flush before page unload (tab close, refresh)
  useEffect(() => {
    const handleBeforeUnload = () => { flushPendingState() }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    title,
    setTitle,
    wordCount,
    setWordCount,
    saveStatus,
    loading,
    conflictInfo,
    setConflictInfo,
    versionRef,
    suppressSaveRef,
    recordEdit,
    handleTitleChange,
    handleConflictReload,
    handleConflictSaveAsNew,
    handleConflictOverwrite,
    createChapterBelow,
  }
}
