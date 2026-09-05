import { useState, useEffect, useRef } from 'react'
import { AuthError, ConflictError, registerShortcuts } from '@bobbinry/sdk'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { paletteClasses } from '@bobbinry/ui-components'
import { resolveChapterColor, resolveFeaturedCharacters } from '../lib/chapterColors'
import { countsTowardWordCount, isContentType, type ContentType } from '@bobbinry/types'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TextAlign from '@tiptap/extension-text-align'
import { ImageUpload } from '../extensions/image-upload'
import { EntityHighlight } from '../extensions/entity-highlight'
import { EntityHoverCard } from '@bobbinry/ui-components'
import {
  SearchHighlight,
  setSearchHighlight,
  getSearchHighlightStorage,
  findMatchRanges,
  MAX_FIND_MATCHES,
} from '../extensions/search-highlight'
import type { FindOptions } from '../extensions/search-highlight'
import { SmartTypography } from '../extensions/smart-typography'
import {
  displaySettingsToClass,
  sanitizeDisplaySettings,
  type PartialManuscriptDisplaySettings,
} from '@bobbinry/types'
import { useDisplaySettings } from './display-settings'
import { getDraftKey, loadDraft, saveDraft, versionDebug, type DraftEntry } from '../lib/drafts'
import { AUTH_TOKEN_RENEWED_EVENT, getParentOrigin, type ConflictInfo, type SaveStatus } from '../lib/editor-types'
import {
  clearPendingHighlight,
  getPendingSearchHighlight,
  isPendingHighlightExpired,
  runSearchHighlight,
  scrollEditorToPos,
  setApplyPendingHighlightHook,
} from '../lib/search-highlight-bridge'
import { EditorToolbar } from '../components/EditorToolbar'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConflictDialog, SessionExpiredBanner } from '../components/EditorOverlays'
import { ContentTypeMenu } from '../components/ContentTypeMenu'
import { ChapterMetaMenu, type ChapterMetaPatch } from '../components/ChapterMetaMenu'
import { useEntityHighlightNames } from '../hooks/useEntityHighlightNames'
import { useChapterCharacters } from '../hooks/useChapterCharacters'

interface EditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
}

/**
 * Editor View for Manuscript bobbin
 * Provides rich text editing for content with auto-save and local draft caching.
 *
 * Content persistence strategy:
 * 1. Every edit is immediately written to localStorage as a draft
 * 2. Server saves are debounced (1s after last edit)
 * 3. On navigation away, pending edits are flushed to the draft cache
 * 4. On navigation back, local draft takes priority over server content
 *    if the draft is newer and hasn't been confirmed saved
 */
export default function EditorView({ sdk, projectId, entityType, entityId, metadata }: EditorViewProps) {
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
  const [wordCount, setWordCount] = useState(0)
  const [contentType, setContentType] = useState<ContentType>('chapter')
  const [contentTypeMenuOpen, setContentTypeMenuOpen] = useState(false)
  const [savingContentType, setSavingContentType] = useState(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Unified dirty-fields accumulator. All saves (title, body, wordCount) flow
  // through a single debounce timer so that title and body can never race.
  const pendingFieldsRef = useRef<{ title?: string; body?: string; wordCount?: number } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Track the entity that's currently being edited so we can flush on navigate
  const activeEntityRef = useRef<string | null>(null)
  // Latest createChapterBelow closure, read by the Mod-Enter editor shortcut
  // (the TipTap extension is created once, at editor init).
  const createChapterBelowRef = useRef<() => void>(() => {})
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
  // Conflict state
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null)

  const [focusMode, setFocusMode] = useState(false)

  // Characters (POV colour cascade) + this chapter's colour fields.
  const { characters: editorCharacters, chapterColor, setChapterColor } = useChapterCharacters(sdk, projectId, entityId, entityType)

  // Content-level manuscript display overrides — fed from the loaded entity's
  // `entityData.displaySettings`. Combined with user + project levels via
  // useDisplaySettings to produce the resolved cascade that's applied to the
  // editor's prose surface.
  const [contentDisplay, setContentDisplay] = useState<PartialManuscriptDisplaySettings>({})
  const displayState = useDisplaySettings(sdk, projectId, entityId, contentDisplay)

  // Debounce timer for selection events
  const selectionTimeoutRef = useRef<number | null>(null)
  const lastSelectionRef = useRef<string>('')

  // Offline detection
  useEffect(() => {
    const goOnline = () => {
      setSaveStatus(prev => {
        if (prev === 'offline') {
          // Retry save from local draft when reconnecting
          const eid = activeEntityRef.current
          if (eid) {
            const draft = loadDraft(eid)
            if (draft && !draft.savedToServer) {
              setTimeout(() => serverSave(eid, draft.html, draft.wordCount), 500)
              return 'saving'
            }
          }
          return 'dirty'
        }
        return prev
      })
    }
    const goOffline = () => {
      setSaveStatus(prev => (prev === 'dirty' || prev === 'error') ? 'offline' : prev)
    }
    // The shell renewed the API token after a 401 — retry the local draft.
    const onTokenRenewed = () => {
      setSaveStatus(prev => {
        if (prev !== 'auth') return prev
        const eid = activeEntityRef.current
        if (eid) {
          const draft = loadDraft(eid)
          if (draft && !draft.savedToServer) {
            setTimeout(() => serverSave(eid, draft.html, draft.wordCount), 500)
            return 'saving'
          }
        }
        return 'dirty'
      })
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    window.addEventListener(AUTH_TOKEN_RENEWED_EVENT, onTokenRenewed)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.removeEventListener(AUTH_TOKEN_RENEWED_EVENT, onTokenRenewed)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for focus mode changes from shell
  useEffect(() => {
    const handleFocusMode = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean }>).detail
      setFocusMode(detail.active)
    }
    window.addEventListener('bobbinry:focus-mode-change', handleFocusMode)
    return () => window.removeEventListener('bobbinry:focus-mode-change', handleFocusMode)
  }, [])

  // Broadcast the active chapter so the shell's Search & Replace launcher can
  // offer a "This chapter" scope. Cleared on unmount/entity change.
  useEffect(() => {
    if (entityType !== 'content' || !entityId) return
    window.dispatchEvent(new CustomEvent('bobbinry:active-chapter', {
      detail: { id: entityId, title },
    }))
    return () => {
      window.dispatchEvent(new CustomEvent('bobbinry:active-chapter', { detail: null }))
    }
  }, [entityId, entityType, title])

  async function handleContentTypeChange(next: ContentType) {
    if (!entityId || next === contentType) {
      setContentTypeMenuOpen(false)
      return
    }
    const previous = contentType
    setSavingContentType(true)
    // Optimistic: update locally so the badge reflects the choice instantly.
    setContentType(next)
    setContentTypeMenuOpen(false)
    try {
      const result = await sdk.entities.setContentType(entityId, next)
      if (isContentType(result.contentType)) setContentType(result.contentType)
    } catch (err) {
      console.error('[EditorView] Failed to change content type:', err)
      setContentType(previous)
    } finally {
      setSavingContentType(false)
    }
  }

  const countsForWords = countsTowardWordCount(contentType)

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

      // Also update the draft's stored version so it stays in sync
      const draft = loadDraft(detail.entityId)
      if (draft) {
        saveDraft(detail.entityId, { html: draft.html, version: detail.version })
      }
    }
    window.addEventListener('bobbinry:entity-version-changed', handleVersionChanged)
    return () => window.removeEventListener('bobbinry:entity-version-changed', handleVersionChanged)
  }, [])

  const imageUploadFileRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing...'
      }),
      CharacterCount,
      // Preserves `text-align` on imported paragraphs/headings (centered
      // chapter titles, etc.). Stored as inline style on the node so the
      // round-trip through the editor is lossless.
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      }),
      ImageUpload.configure({
        sdk,
        projectId,
        inline: false,
        allowBase64: false,
      } as any),
      EntityHighlight,
      SearchHighlight,
      SmartTypography,
      // Ctrl/Cmd+Enter: finish this chapter and start the next one. Outranks
      // StarterKit's HardBreak, which binds Mod-Enter to a line break by
      // default (Shift+Enter still inserts hard breaks).
      Extension.create({
        name: 'finishChapter',
        priority: 1000,
        addKeyboardShortcuts() {
          return {
            'Mod-Enter': () => {
              createChapterBelowRef.current()
              return true
            },
          }
        },
      }),
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-lg dark:prose-invert max-w-none min-h-[50vh] outline-none text-gray-900 dark:text-gray-100'
      }
    },
    onUpdate: ({ editor }) => {
      // Skip saves triggered by programmatic setContent (e.g., loading a different chapter)
      if (suppressSaveRef.current) return

      const count = editor.storage.characterCount.words()
      setWordCount(count)
      // Broadcast word count for shell.editorFooter session stats
      window.dispatchEvent(new CustomEvent('bobbinry:view-context-change', {
        detail: { wordCount: count, entityId: activeEntityRef.current }
      }))
      // Broadcast text content for bobbins that need to detect typed words
      window.dispatchEvent(new CustomEvent('bobbinry:editor-content-update', {
        detail: { text: editor.state.doc.textContent }
      }))
      // Keep the find counter honest while the doc is edited mid-search
      // (decorations rebuild automatically on docChanged).
      if (findOptsRef.current.query) emitFindState(editor)
      const html = editor.getHTML()
      const currentEntityId = activeEntityRef.current

      if (currentEntityId) {
        // Immediately cache to localStorage — this is the safety net
        saveDraft(currentEntityId, { html, wordCount: count, savedToServer: false })
        setSaveStatus('dirty')
        scheduleSave({ body: html, wordCount: count }, currentEntityId)
      }
    },
    onSelectionUpdate: ({ editor }) => {
      // Clear existing timeout
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current)
      }

      // Debounce selection events
      selectionTimeoutRef.current = window.setTimeout(() => {
        // Get selected text
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        const trimmedText = text.trim()

        // Only publish if text is selected and different from last selection
        if (trimmedText && trimmedText !== lastSelectionRef.current) {
          lastSelectionRef.current = trimmedText

          // Post message using new envelope format
          if (typeof window !== 'undefined') {
            window.parent.postMessage({
              namespace: 'BUS',
              type: 'BUS_EVENT',
              payload: {
                topic: 'manuscript.editor.selection.v1',
                data: {
                  text: trimmedText,
                  length: trimmedText.length
                },
                source: 'manuscript.editor'
              },
              metadata: {
                timestamp: Date.now()
              }
            }, getParentOrigin())
          }
        }
      }, 300) // 300ms debounce
    }
  })

  // Sync resolved smart-typography settings into the extension's storage so
  // input rules pick up cascade changes without re-creating the editor.
  useEffect(() => {
    if (!editor) return
    const storage = (editor.storage as any).smartTypography
    if (!storage) return
    storage.dashes = displayState.resolved.smartDashes
    storage.ellipsis = displayState.resolved.smartEllipsis
  }, [editor, displayState.resolved.smartDashes, displayState.resolved.smartEllipsis])

  // --- Flush the current entity's content before switching ---
  // This runs whenever entityId changes. The cleanup of the *previous* effect
  // captures the outgoing entity and editor state.
  useEffect(() => {
    // On mount or entityId change: record the new active entity
    activeEntityRef.current = entityId ?? null

    // Drop a stale search-highlight aimed at a chapter we just left.
    const pendingHighlight = getPendingSearchHighlight()
    if (pendingHighlight && pendingHighlight.entityId !== entityId) {
      clearPendingHighlight()
    }

    if (entityType === 'content' && entityId && editor) {
      loadContent(entityId)
    } else {
      setLoading(false)
    }

    // Cleanup: flush the outgoing entity
    return () => {
      flushPendingState()
    }
  }, [entityId, entityType, editor])

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
      try {
        localStorage.removeItem(getDraftKey(active))
      } catch {
        // ignore quota/security errors — the reload below still works.
      }
      if (entityType === 'content') {
        loadContent(active)
      }
    }
    window.addEventListener('bobbinry:entities-bulk-updated', handleBulkUpdated)
    return () => window.removeEventListener('bobbinry:entities-bulk-updated', handleBulkUpdated)
  }, [entityType, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-check server version when the tab becomes visible again.
  // Handles the case where content was edited on another device while
  // this tab was in the background.
  // `editor` must be a dep (same reason as the bulk-update effect below):
  // with immediatelyRender:false it is null on the first render, and a handler
  // bound then captures an applyContent that can never write into the editor —
  // it would mark the draft saved with the new version while the stale body
  // stays on screen, and the next keystroke would overwrite the server copy.
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
        // Bail if user navigated elsewhere while the request was in flight
        if (activeEntityRef.current !== eid) return
        // Bail if a save started (or finished) while the HEAD was in flight
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
          // Versions match — nothing to do
          versionDebug('visibility-check', { ...ctx, branch: 'match' }, 'debug')
          return
        }

        if (!draft.savedToServer) {
          // Local unsaved edits AND server changed — conflict
          versionDebug('visibility-check', { ...ctx, branch: 'CONFLICT: unsaved local edits + server version differs' }, 'warn')
          setSaveStatus('conflict')
          setConflictInfo({ serverVersion, localVersion: draft.version })
          return
        }

        versionDebug('visibility-check', { ...ctx, branch: 'server newer, draft clean — reconciling' })

        // Draft was saved, server is newer — fetch and apply fresh content
        sdk.entities.get('content', eid).then((result: any) => {
          if (activeEntityRef.current !== eid) return
          const serverBody = result?.body ?? ''
          const serverTitle = result?.title ?? ''
          const serverWordCount = result?.word_count ?? 0
          const newVersion = result?._meta?.version ?? serverVersion

          applyContent(serverBody, serverTitle || draft.title, serverWordCount)
          versionRef.current = newVersion
          saveDraft(eid, {
            html: serverBody,
            title: serverTitle || draft.title,
            wordCount: serverWordCount,
            savedToServer: true,
            version: newVersion,
            containerId: result?.container_id ?? draft.containerId,
          })
        }).catch(() => {})
      }).catch(() => {})
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Also flush before page unload (tab close, refresh)
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingState()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEntityHighlightNames(editor, sdk, projectId)

  // Sync title when another view (e.g. sidebar) renames the current entity.
  // Events with source === 'editor' are ones we dispatched ourselves — skip them
  // to avoid bouncing stale titles back during fast typing.
  useEffect(() => {
    function handleExternalRename(e: Event) {
      const { entityId: updatedId, changes, source } = (e as CustomEvent).detail
      if (source === 'editor') return
      if (updatedId === entityId && changes?.title != null) {
        setTitle(changes.title)
      }
    }
    window.addEventListener('bobbinry:entity-updated', handleExternalRename)
    return () => window.removeEventListener('bobbinry:entity-updated', handleExternalRename)
  }, [entityId])

  // --- Text focus: scroll editor to specific text when requested by any bobbin ---
  // Dispatchers send: { quote: string, paragraphIndex?: number }
  const editorRef = useRef(editor)
  editorRef.current = editor

  // The live find session (browser-style Ctrl+F). Mirrors the SearchHighlight
  // extension storage; kept in a ref so window-event handlers and applyContent
  // see the latest values without re-subscribing.
  const findOptsRef = useRef<FindOptions>({ query: '', caseSensitive: false, wholeWord: false })

  // Tell the search UI how many in-chapter matches exist and which is active.
  const emitFindState = (ed: Editor) => {
    const storage = getSearchHighlightStorage(ed)
    const total = findOptsRef.current.query
      ? findMatchRanges(ed.state.doc, findOptsRef.current).length
      : 0
    window.dispatchEvent(new CustomEvent('bobbinry:find-state', {
      detail: {
        total,
        activeIndex: total === 0 ? -1 : storage.activeIndex,
        capped: total >= MAX_FIND_MATCHES,
        query: findOptsRef.current.query,
        entityId: activeEntityRef.current,
      },
    }))
  }

  // Apply a stashed search-highlight once the editor holds the matching chapter.
  // Called both when the event arrives and after a chapter's content loads.
  const tryApplySearchHighlightRef = useRef<() => void>(() => {})
  tryApplySearchHighlightRef.current = () => {
    const req = getPendingSearchHighlight()
    const ed = editorRef.current
    if (!req || !ed || req.entityId !== activeEntityRef.current) return
    if (isPendingHighlightExpired()) {
      clearPendingHighlight()
      return
    }
    // Don't clear on apply: a follow-up content reconcile would otherwise reset
    // the selection with nothing left to re-apply. The grace window above bounds
    // how long we keep re-selecting.
    runSearchHighlight(ed, req)
    // Adopt the click's query as the live find session so Enter keeps cycling
    // from the landing spot and the top-bar counter updates.
    findOptsRef.current = { query: req.query, caseSensitive: req.caseSensitive, wholeWord: req.wholeWord }
    emitFindState(ed)
  }

  useEffect(() => {
    function handleFocus(e: Event) {
      const { quote, paragraphIndex } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!quote || !ed) return
      const doc = ed.state.doc
      let found = false

      // Search for the quote text in the document
      doc.descendants((node, pos) => {
        if (found || !node.isText || !node.text) return
        const idx = node.text.indexOf(quote)
        if (idx !== -1) {
          const from = pos + idx
          const to = from + quote.length
          ed.commands.setTextSelection({ from, to })
          ed.commands.focus()

          // Scroll into view
          requestAnimationFrame(() => {
            try {
              const domAtPos = ed.view.domAtPos(from)
              const targetNode = domAtPos.node instanceof HTMLElement
                ? domAtPos.node
                : domAtPos.node.parentElement
              if (targetNode) {
                targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            } catch {
              const coords = ed.view.coordsAtPos(from)
              const scrollParent = ed.view.dom.closest('.overflow-y-auto')
              if (scrollParent) {
                const parentRect = scrollParent.getBoundingClientRect()
                scrollParent.scrollTo({
                  top: scrollParent.scrollTop + (coords.top - parentRect.top) - parentRect.height / 3,
                  behavior: 'smooth'
                })
              }
            }
          })

          found = true
        }
      })

      // If not found by exact match, try searching block by paragraph index
      if (!found && paragraphIndex != null) {
        let blockIdx = 0
        doc.descendants((node, pos) => {
          if (found) return
          if (node.isBlock && node.isTextblock) {
            if (blockIdx === paragraphIndex) {
              ed.chain()
                .setTextSelection(pos + 1)
                .scrollIntoView()
                .run()
              found = true
            }
            blockIdx++
          }
        })
      }
    }

    window.addEventListener('bobbinry:editor-focus-text', handleFocus)
    return () => window.removeEventListener('bobbinry:editor-focus-text', handleFocus)
  }, [])

  // --- Search & replace: scroll to the clicked match occurrence ---
  // The window listener lives at module scope (see top of file) so requests
  // aren't lost while this view is unmounted; register to be poked when a
  // request arrives while we're already showing the chapter.
  useEffect(() => {
    setApplyPendingHighlightHook(() => tryApplySearchHighlightRef.current())
    return () => setApplyPendingHighlightHook(null)
  }, [])

  // --- Live find session (browser-style Ctrl+F, driven by the shell) ---
  useEffect(() => {
    function handleFindUpdate(e: Event) {
      const detail = (e as CustomEvent<FindOptions>).detail
      const ed = editorRef.current
      if (!ed || !detail) return
      const query = (detail.query ?? '').trim()
      const opts: FindOptions = {
        query,
        caseSensitive: Boolean(detail.caseSensitive),
        wholeWord: Boolean(detail.wholeWord),
      }
      findOptsRef.current = opts
      if (!query) {
        setSearchHighlight(ed, { ...opts, activeIndex: -1 })
        emitFindState(ed)
        return
      }
      const ranges = findMatchRanges(ed.state.doc, opts)
      // Start from the match at/after the caret — where the user last was —
      // matching how browser find picks its first hit.
      const caret = ed.state.selection.from
      let activeIndex = ranges.findIndex(r => r.from >= caret)
      if (activeIndex === -1) activeIndex = ranges.length > 0 ? 0 : -1
      setSearchHighlight(ed, { ...opts, activeIndex })
      if (activeIndex >= 0) scrollEditorToPos(ed, ranges[activeIndex]!.from)
      emitFindState(ed)
    }

    function handleFindStep(e: Event) {
      const { dir } = (e as CustomEvent<{ dir: 1 | -1 }>).detail ?? {}
      const ed = editorRef.current
      if (!ed || (dir !== 1 && dir !== -1)) return
      const opts = findOptsRef.current
      if (!opts.query) return
      const ranges = findMatchRanges(ed.state.doc, opts)
      if (ranges.length === 0) {
        emitFindState(ed)
        return
      }
      const storage = getSearchHighlightStorage(ed)
      const activeIndex = (storage.activeIndex + dir + ranges.length) % ranges.length
      setSearchHighlight(ed, { activeIndex })
      scrollEditorToPos(ed, ranges[activeIndex]!.from)
      emitFindState(ed)
    }

    function handleFindClear() {
      const ed = editorRef.current
      findOptsRef.current = { query: '', caseSensitive: false, wholeWord: false }
      if (!ed) return
      setSearchHighlight(ed, { query: '', activeIndex: -1 })
      emitFindState(ed)
    }

    // Esc from the search bar: end the find session and hand the caret to the
    // editor at the active match (selected, ready to type over) — the "I
    // found it, let me edit" gesture. Without a session, just give the
    // manuscript its focus back.
    function handleFindCommit() {
      const ed = editorRef.current
      if (!ed) return
      const opts = findOptsRef.current
      if (opts.query) {
        const ranges = findMatchRanges(ed.state.doc, opts)
        const storage = getSearchHighlightStorage(ed)
        const target = storage.activeIndex >= 0 ? ranges[Math.min(storage.activeIndex, ranges.length - 1)] : undefined
        if (target) ed.commands.setTextSelection(target)
      }
      findOptsRef.current = { query: '', caseSensitive: false, wholeWord: false }
      setSearchHighlight(ed, { query: '', activeIndex: -1 })
      ed.commands.focus()
      emitFindState(ed)
    }

    window.addEventListener('bobbinry:find-update', handleFindUpdate)
    window.addEventListener('bobbinry:find-step', handleFindStep)
    window.addEventListener('bobbinry:find-clear', handleFindClear)
    window.addEventListener('bobbinry:find-commit', handleFindCommit)
    return () => {
      window.removeEventListener('bobbinry:find-update', handleFindUpdate)
      window.removeEventListener('bobbinry:find-step', handleFindStep)
      window.removeEventListener('bobbinry:find-clear', handleFindClear)
      window.removeEventListener('bobbinry:find-commit', handleFindCommit)
    }
  }, [])

  // --- Text replace: find and replace text in the live editor document ---
  useEffect(() => {
    function handleReplace(e: Event) {
      const { find, replace } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!find || !replace || !ed) return

      const doc = ed.state.doc
      let replaced = false
      doc.descendants((node, pos) => {
        if (replaced || !node.isText || !node.text) return
        const idx = node.text.indexOf(find)
        if (idx !== -1) {
          const from = pos + idx
          const to = from + find.length
          ed.chain()
            .setTextSelection({ from, to })
            .insertContent(replace)
            .run()
          replaced = true
        }
      })
    }

    window.addEventListener('bobbinry:editor-replace-text', handleReplace)
    return () => window.removeEventListener('bobbinry:editor-replace-text', handleReplace)
  }, [])

  // Announce this view's shortcuts to the shell's help overlay (?).
  // Formatting entries mirror TipTap StarterKit's default bindings for the
  // marks our toolbar exposes.
  useEffect(() => registerShortcuts('manuscript.editor', [
    { keys: 'Mod+Enter', description: 'Finish chapter — new chapter below, keep typing', group: 'Editor' },
    { keys: 'Enter / ↓', description: 'Jump from the title into the prose', group: 'Editor' },
    { keys: 'Mod+B', description: 'Bold', group: 'Formatting' },
    { keys: 'Mod+I', description: 'Italic', group: 'Formatting' },
    { keys: 'Mod+Shift+S', description: 'Strikethrough', group: 'Formatting' },
    { keys: 'Mod+E', description: 'Inline code', group: 'Formatting' },
    { keys: 'Shift+Enter', description: 'Line break', group: 'Formatting' },
    { keys: 'Mod+Z', description: 'Undo', group: 'Formatting' },
    { keys: 'Mod+Shift+Z', description: 'Redo', group: 'Formatting' },
  ]), [])

  // Focus and select title when creating new content
  useEffect(() => {
    if (!loading && metadata?.focusTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [loading, metadata?.focusTitle])

  // --- Inject entity-highlight CSS ---
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .entity-highlight {
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-color: rgb(147, 130, 220);
        text-underline-offset: 3px;
        cursor: pointer;
        border-radius: 2px;
      }
      .entity-highlight:hover {
        background-color: rgba(147, 130, 220, 0.15);
      }
      .search-match {
        background-color: rgba(250, 204, 21, 0.35);
        border-radius: 2px;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }
      .dark .search-match {
        background-color: rgba(202, 138, 4, 0.45);
      }
      .search-match-active {
        background-color: rgba(251, 146, 60, 0.75);
        box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.55);
        color: inherit;
      }
      .dark .search-match-active {
        background-color: rgba(234, 88, 12, 0.65);
        box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.5);
      }
    `
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  /**
   * Flush any pending debounced save on navigation away.
   *
   * Only flushes drafts that onUpdate already wrote to localStorage.
   * We intentionally do NOT read editor.getHTML() here to create new drafts,
   * because during React strict mode's double-invocation (mount → cleanup → mount),
   * the editor may still contain the PREVIOUS entity's content when the cleanup
   * runs for the NEW entity, which would cross-contaminate the draft cache.
   */
  function flushPendingState() {
    const outgoingEntityId = activeEntityRef.current

    // Cancel the unified debounce timer — we're flushing now.
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

  /**
   * Apply content to the editor. Extracted so both instant-load and
   * server-load paths can share it without duplication.
   */
  function applyContent(body: string, titleVal: string, count: number) {
    setTitle(titleVal)
    setWordCount(count)
    if (editor) {
      suppressSaveRef.current = true
      // Use addToHistory: false so chapter loads don't bloat the undo stack.
      // Without this, each setContent adds a full-document-replacement entry
      // to the undo history, and after ~10 switches TipTap slows down
      // processing the accumulated history on every transaction.
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta('addToHistory', false)
          return true
        })
        .setContent(body)
        .run()
      queueMicrotask(() => {
        suppressSaveRef.current = false

        // A search-match click may have navigated here before the content was
        // ready — now that it is, scroll to the requested occurrence.
        tryApplySearchHighlightRef.current()

        // A live find session survives chapter switches: re-anchor to this
        // chapter's first match (decorations already rebuilt via docChanged)
        // and refresh the top-bar count. No auto-scroll — the user navigated
        // here deliberately, not via a match click.
        if (findOptsRef.current.query && editor) {
          const ranges = findMatchRanges(editor.state.doc, findOptsRef.current)
          setSearchHighlight(editor, {
            ...findOptsRef.current,
            activeIndex: ranges.length > 0 ? 0 : -1,
          })
          emitFindState(editor)
        }

        // If stored word count is 0 but the editor has text, recalculate
        // and persist so the count is accurate without requiring an edit.
        if (count === 0 && body && body !== '<p></p>') {
          const actualCount = editor.storage.characterCount.words()
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
  }

  async function loadContent(targetEntityId: string) {
    // Increment the generation counter. Only THIS call is allowed to update UI.
    const gen = ++loadGenRef.current
    const isStale = () => loadGenRef.current !== gen

    // Clear any previous conflict state
    setConflictInfo(null)

    const draft = loadDraft(targetEntityId)

    // --- Fast path: if we have a local draft, show it instantly ---
    // The user sees their content immediately with no loading spinner.
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
        // snapshot produced phantom conflict dialogs — same race the
        // visibility-change handler guards against.
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
          // Versions match — cache is fresh. If there are local unsaved
          // edits the server hasn't changed underneath them, so the normal
          // save path is safe. Either way, nothing to do here.
          versionDebug('load-check', { ...ctx, branch: 'match' }, 'debug')
          return
        }

        // Versions differ
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
          const serverContent = result as any
          const serverTitle = serverContent?.title ?? ''
          const serverBody = serverContent?.body ?? ''
          const serverWordCount = serverContent?.word_count ?? 0
          const newVersion = serverContent?._meta?.version ?? serverVersion
          if (isContentType(serverContent?.contentType)) setContentType(serverContent.contentType)

          applyContent(serverBody, serverTitle || fresh.title, serverWordCount)
          versionRef.current = newVersion
          saveDraft(targetEntityId, {
            html: serverBody,
            title: serverTitle || fresh.title,
            wordCount: serverWordCount,
            savedToServer: true,
            version: newVersion,
            containerId: serverContent?.container_id ?? fresh.containerId,
          })
        }).catch(() => {})
      }).catch(() => {
        // HEAD failed — fall back to full fetch for reconciliation
        sdk.entities.get('content', targetEntityId).then((result: any) => {
          if (isStale()) return
          const serverContent = result as any
          const serverTitle = serverContent?.title ?? ''
          const serverBody = serverContent?.body ?? ''
          const serverWordCount = serverContent?.word_count ?? 0
          const newVersion = serverContent?._meta?.version ?? null
          if (isContentType(serverContent?.contentType)) setContentType(serverContent.contentType)

          versionRef.current = newVersion

          if (draft.savedToServer) {
            if (serverBody && serverBody !== draft.html) {
              applyContent(serverBody, serverTitle || draft.title, serverWordCount)
              saveDraft(targetEntityId, {
                html: serverBody,
                title: serverTitle || draft.title,
                wordCount: serverWordCount,
                savedToServer: true,
                version: newVersion,
                containerId: serverContent?.container_id ?? draft.containerId,
              })
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
      setContentType(ct)
      setContentDisplay(sanitizeDisplaySettings(serverContent.displaySettings))
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
      if (fallbackDraft && editor) {
        applyContent(fallbackDraft.html, fallbackDraft.title, fallbackDraft.wordCount)
        versionRef.current = fallbackDraft.version ?? null
        setSaveStatus('dirty')
      }

      setLoading(false)
    }
  }

  /**
   * Merge dirty fields into the pending accumulator and restart the single
   * debounce timer. Title changes, body changes, and word count updates all
   * flow through here — the timer fires one serverSave with whatever fields
   * are dirty, so title and body can never race against each other on the
   * entity version.
   */
  function scheduleSave(
    fields: { title?: string; body?: string; wordCount?: number },
    targetEntityId: string
  ) {
    pendingFieldsRef.current = { ...pendingFieldsRef.current, ...fields }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      fireScheduledSave(targetEntityId)
    }, 800)
  }

  /**
   * Drain pendingFieldsRef into a serverSave call. Safe to call directly
   * (e.g. from flushPendingState or the post-save re-check).
   */
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

      const result = await sdk.entities.update('content', targetEntityId,
        data, expectedVersion) as any

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
        // Only show conflict UI if this entity is still active
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
      // Only update status if this entity is still active
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

  // --- Conflict resolution handlers ---

  function handleConflictReload() {
    const eid = activeEntityRef.current
    if (!eid) return
    // Clear local draft, reset version, re-fetch from server
    localStorage.removeItem(getDraftKey(eid))
    versionRef.current = null
    setConflictInfo(null)
    setSaveStatus('clean')
    loadContent(eid)
  }

  async function handleConflictSaveAsNew() {
    const eid = activeEntityRef.current
    if (!eid || !editor) return
    const draft = loadDraft(eid)
    const html = editor.getHTML()
    const currentTitle = title || draft?.title || 'Untitled'
    const containerId = draft?.containerId ?? null

    try {
      const newData: Record<string, any> = {
        title: `${currentTitle} (copy)`,
        body: html,
        word_count: wordCount,
      }
      if (containerId) {
        newData.container_id = containerId
      }

      const created = await sdk.entities.create('content', newData) as any
      const newVersion = created?._meta?.version ?? null

      // Update editor to point at the new entity
      versionRef.current = newVersion
      setConflictInfo(null)
      setSaveStatus('saved')

      // Notify sidebar so it shows the new scene
      window.dispatchEvent(
        new CustomEvent('bobbinry:entity-updated', {
          detail: { collection: 'content', entityId: created.id, source: 'editor' }
        })
      )

      // Clean up old draft
      localStorage.removeItem(getDraftKey(eid))
    } catch (error) {
      console.error('[EditorView] Failed to save as new scene:', error)
    }
  }

  function handleConflictOverwrite() {
    const eid = activeEntityRef.current
    if (!eid || !editor) return
    const html = editor.getHTML()
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
      window.dispatchEvent(
        new CustomEvent('bobbinry:content-created', {
          detail: { entityId: created.id, containerId }
        })
      )
      window.dispatchEvent(
        new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: 'content',
            entityId: created.id,
            bobbinId: 'manuscript',
            metadata: {
              type: 'scene',
              parentId: containerId,
              focusTitle: true
            }
          }
        })
      )
    } catch (error) {
      console.error('[EditorView] Failed to create chapter below:', error)
    }
  }
  createChapterBelowRef.current = createChapterBelow

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    if (!entityId) return

    // Update draft with new title
    const draft = loadDraft(entityId)
    if (draft) {
      saveDraft(entityId, { ...draft, title: newTitle, savedToServer: false })
    }

    // Notify sidebar immediately so the tree updates in real-time.
    // Marked with source: 'editor' so handleExternalRename ignores it.
    window.dispatchEvent(
      new CustomEvent('bobbinry:entity-updated', {
        detail: {
          collection: 'content',
          entityId,
          changes: { title: newTitle },
          source: 'editor'
        }
      })
    )

    // Route through the unified save path so title + body share one
    // serialized save cycle with the current expectedVersion.
    setSaveStatus('dirty')
    scheduleSave({ title: newTitle }, entityId)
  }

  function handleEditorClick(e: React.MouseEvent) {
    // Don't steal focus from the title input
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (!editor) return
    // Clicks inside the prose are positioned by ProseMirror itself.
    if (editor.view.dom.contains(e.target as Node)) return
    // Gutter/padding clicks: clamp the coordinates into the prose and put
    // the cursor on the nearest line, rather than jumping to the end of
    // the document (which forces a scroll back up mid-edit).
    const rect = editor.view.dom.getBoundingClientRect()
    const hit = editor.view.posAtCoords({
      left: Math.min(Math.max(e.clientX, rect.left + 1), rect.right - 1),
      top: Math.min(Math.max(e.clientY, rect.top + 1), rect.bottom - 1),
    })
    if (hit) {
      editor.chain().focus().setTextSelection(hit.pos).run()
    } else {
      editor.commands.focus(e.clientY < rect.top ? 'start' : 'end')
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">Loading...</p>
      </div>
    )
  }

  if (!entityId || entityType !== 'content') {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="font-display text-xl text-gray-300 dark:text-gray-600 italic">
          Select a scene to begin writing
        </p>
      </div>
    )
  }

  const chapterColorToken = entityType === 'content'
    ? resolveChapterColor(chapterColor, editorCharacters)
    : null
  const chapterColorClasses = paletteClasses(chapterColorToken)
  const povCharacter = chapterColor.pov_character_id
    ? editorCharacters.get(chapterColor.pov_character_id) ?? null
    : null
  const featuredCharacters = resolveFeaturedCharacters(chapterColor, editorCharacters)

  async function applyChapterMetaPatch(patch: ChapterMetaPatch) {
    if (!entityId || entityType !== 'content') return
    setChapterColor(prev => ({ ...prev, ...patch }))
    try {
      // Send expectedVersion so the server's optimistic-locking check passes,
      // then capture the bumped version and keep versionRef/draft in sync. If
      // we skip this, the next body autosave fires with a stale expectedVersion
      // and the user sees a phantom "Version Conflict" dialog.
      const result = await sdk.entities.update(
        'content',
        entityId,
        patch,
        versionRef.current ?? undefined,
      ) as any
      const newVersion = result?._meta?.version ?? null
      if (newVersion != null) {
        versionRef.current = newVersion
        const draft = loadDraft(entityId)
        if (draft) saveDraft(entityId, { html: draft.html, version: newVersion })
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('bobbinry:chapter-color-changed', {
            detail: { entityId, patch },
          }),
        )
        if (newVersion != null) {
          window.dispatchEvent(
            new CustomEvent('bobbinry:entity-version-changed', {
              detail: { entityId, version: newVersion },
            }),
          )
        }
      }
    } catch (err) {
      console.error('[EditorView] Failed to update chapter color fields:', err)
    }
  }

  return (
    <div className="h-full flex flex-col relative bg-gray-50 dark:bg-gray-900">
      {/* POV / manual color stripe — subtle visual confirmation of which
          character drives this chapter. Hidden when no color is set. */}
      {chapterColorClasses && (
        <div
          aria-hidden
          className={`h-[3px] flex-shrink-0 ${chapterColorClasses.stripe}`}
        />
      )}

      {/* Hover peek for highlighted entities — inert, fixed-positioned overlay */}
      <EntityHoverCard />

      {/* Toolbar - hidden in focus mode */}
      <div className={`transition-all duration-200 overflow-hidden ${focusMode ? 'h-0 opacity-0' : ''}`}>
        <EditorToolbar
          editor={editor}
          onFocusMode={() => {
            window.dispatchEvent(new CustomEvent('bobbinry:request-focus-mode', { detail: { active: true } }))
          }}
          onInsertImage={() => imageUploadFileRef.current?.click()}
          displayState={displayState}
        />
      </div>

      {/* Hidden file input for toolbar image button */}
      <input
        ref={imageUploadFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file || !editor) return
          e.target.value = ''

          const placeholderSrc = URL.createObjectURL(file)
          editor.chain().focus().setImage({ src: placeholderSrc, alt: file.name, title: 'Uploading...' }).run()

          try {
            const result = await sdk.uploads.upload({
              file,
              projectId,
              context: 'editor',
            })

            // Replace placeholder with final URL
            const { doc, tr } = editor.state
            doc.descendants((node, pos) => {
              if (node.type.name === 'image' && node.attrs.src === placeholderSrc) {
                const updateTr = tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  src: result.url,
                  title: null,
                })
                editor.view.dispatch(updateTr)
                return false
              }
              return true
            })
          } catch (err) {
            console.error('[EditorView] Image upload failed:', err)
            // Remove placeholder on failure
            const { doc, tr } = editor.state
            doc.descendants((node, pos) => {
              if (node.type.name === 'image' && node.attrs.src === placeholderSrc) {
                editor.view.dispatch(tr.delete(pos, pos + node.nodeSize))
                return false
              }
              return true
            })
          } finally {
            URL.revokeObjectURL(placeholderSrc)
          }
        }}
      />

      {/* Writing surface */}
      <div
        className="flex-1 overflow-y-auto cursor-text"
        onClick={handleEditorClick}
      >
        <div className={`max-w-2xl mx-auto px-8 pt-12 pb-[40vh] ${displaySettingsToClass(displayState.resolved)} ${displayState.showFormattingMarks ? 'ms-show-marks' : ''}`}>
          {/* Title - integrated into writing surface */}
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                // Ctrl/Cmd+Enter — same "finish chapter" gesture as in the prose
                e.preventDefault()
                void createChapterBelow()
              } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                // Enter/down from the title drops the cursor into the prose so
                // a new chapter can be titled and written without the mouse.
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
            placeholder="Untitled"
            className="w-full font-display text-3xl font-semibold bg-transparent border-none outline-none text-gray-800 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-700 mb-2 leading-tight"
          />

          {/* Content type — author intent for this piece. Switching to a
              non-narrative type (outline / supporting doc) excludes the piece
              from project word totals. The visual treatment here is intentionally
              minimal; richer iconography belongs to a follow-up design pass. */}
          {/* stopPropagation: clicks inside this dropdown (button, menu items,
              and the fixed dismiss overlay) must not bubble to the writing
              surface's onClick, which would focus('end') and scroll the
              editor to the bottom of the document. */}
          <div className="flex flex-wrap items-center gap-2 mb-6" onClick={(e) => e.stopPropagation()}>
            <ContentTypeMenu
              contentType={contentType}
              open={contentTypeMenuOpen}
              saving={savingContentType}
              onToggle={() => setContentTypeMenuOpen(o => !o)}
              onClose={() => setContentTypeMenuOpen(false)}
              onChange={handleContentTypeChange}
            />
            {entityType === 'content' && (
              <ChapterMetaMenu
                chapterColor={chapterColor}
                characters={editorCharacters}
                colorClasses={chapterColorClasses}
                povCharacter={povCharacter}
                featuredCharacters={featuredCharacters}
                onPatch={patch => { void applyChapterMetaPatch(patch) }}
              />
            )}
          </div>

          {/* Prose content */}
          <EditorContent editor={editor} />
        </div>
      </div>

      {saveStatus === 'auth' && <SessionExpiredBanner />}

      {conflictInfo && (
        <ConflictDialog
          onDismiss={() => setConflictInfo(null)}
          onReload={handleConflictReload}
          onSaveAsNew={handleConflictSaveAsNew}
          onOverwrite={handleConflictOverwrite}
        />
      )}

      {/* Floating status - word count + save indicator */}
      <div className={`absolute bottom-3 right-4 flex items-center gap-3 text-xs transition-opacity duration-300 ${focusMode ? 'opacity-20 hover:opacity-50' : 'opacity-60 hover:opacity-100'}`}>
        <SaveIndicator status={saveStatus} focusMode={false} />
        <span
          className={countsForWords ? 'text-gray-400 dark:text-gray-500' : 'text-gray-300 dark:text-gray-600 italic'}
          title={countsForWords ? undefined : 'Not in manuscript total'}
        >
          {wordCount.toLocaleString()} words
          {!countsForWords && <span className="ml-1">· not in manuscript total</span>}
        </span>
      </div>
    </div>
  )
}
