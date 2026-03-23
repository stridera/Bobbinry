import { useState, useEffect, useRef } from 'react'
import { ConflictError } from '@bobbinry/sdk'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { ImageUpload } from '../extensions/image-upload'
import { EntityHighlight } from '../extensions/entity-highlight'
import type { EntityEntry } from '../extensions/entity-highlight'

interface EditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
}

interface ToolbarButtonProps {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}

// --- Local draft cache ---
// Stores content per-entity in localStorage so we never lose edits,
// even if the server save hasn't completed when the user navigates away.

const DRAFT_PREFIX = 'bobbinry:draft:'

interface DraftEntry {
  html: string
  title: string
  wordCount: number
  savedToServer: boolean
  timestamp: number
  version: number | null
  containerId: string | null
}

function getParentOrigin(): string {
  if (typeof window === 'undefined') {
    return '*'
  }

  try {
    return document.referrer ? new URL(document.referrer).origin : window.location.origin
  } catch {
    return window.location.origin
  }
}

function getDraftKey(entityId: string): string {
  return `${DRAFT_PREFIX}${entityId}`
}

function saveDraft(entityId: string, draft: Partial<DraftEntry> & { html: string }) {
  try {
    const existing = loadDraft(entityId)
    const entry: DraftEntry = {
      html: draft.html,
      title: draft.title ?? existing?.title ?? '',
      wordCount: draft.wordCount ?? existing?.wordCount ?? 0,
      savedToServer: draft.savedToServer ?? existing?.savedToServer ?? false,
      timestamp: Date.now(),
      version: draft.version !== undefined ? draft.version : (existing?.version ?? null),
      containerId: draft.containerId !== undefined ? draft.containerId : (existing?.containerId ?? null),
    }
    localStorage.setItem(getDraftKey(entityId), JSON.stringify(entry))
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

function loadDraft(entityId: string): DraftEntry | null {
  try {
    const raw = localStorage.getItem(getDraftKey(entityId))
    if (!raw) return null
    return JSON.parse(raw) as DraftEntry
  } catch {
    return null
  }
}

// --- Save state ---
type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict'

interface ConflictInfo {
  serverVersion: number
  localVersion: number | null
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
        isActive
          ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" />
}

function EditorToolbar({ editor, onFocusMode, onInsertImage }: { editor: Editor | null; onFocusMode: () => void; onInsertImage: () => void }) {
  const [, setForceUpdate] = useState(0)
  const rafRef = useRef(0)

  // Re-render toolbar when editor state changes (selection, formatting).
  // Batched with rAF so rapid transactions (e.g. during setContent) only
  // trigger one re-render per frame instead of one per transaction.
  useEffect(() => {
    if (!editor) return
    const handler = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => setForceUpdate(n => n + 1))
    }
    editor.on('selectionUpdate', handler)
    editor.on('transaction', handler)
    return () => {
      cancelAnimationFrame(rafRef.current)
      editor.off('selectionUpdate', handler)
      editor.off('transaction', handler)
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-gray-200/50 dark:border-gray-700/40 flex-wrap">
      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        ↩
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        ↪
      </ToolbarButton>

      <ToolbarDivider />

      {/* Text formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold (Ctrl+B)"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic (Ctrl+I)"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough (Ctrl+Shift+X)"
      >
        <s>S</s>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive('code')}
        title="Inline code (Ctrl+E)"
      >
        <code className="text-xs">&lt;/&gt;</code>
      </ToolbarButton>

      <ToolbarDivider />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive('heading', { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarButton>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet list"
      >
        •&thinsp;List
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Numbered list"
      >
        1.&thinsp;List
      </ToolbarButton>

      <ToolbarDivider />

      {/* Block elements */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="Blockquote"
      >
        &ldquo;&thinsp;Quote
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive('codeBlock')}
        title="Code block"
      >
        Code
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        ―
      </ToolbarButton>
      <ToolbarButton
        onClick={onInsertImage}
        title="Insert image"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </ToolbarButton>

      <div className="flex-1" />

      <ToolbarButton
        onClick={onFocusMode}
        title="Focus mode (Ctrl+Shift+F)"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      </ToolbarButton>
    </div>
  )
}

function SaveIndicator({ status, focusMode }: { status: SaveStatus; focusMode: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 transition-opacity duration-300 ${focusMode ? 'opacity-20 hover:opacity-50' : 'opacity-60 hover:opacity-100'}`}>
      {status === 'dirty' && (
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Unsaved changes" />
      )}
      {status === 'saving' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Saving..." />
      )}
      {status === 'saved' && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Saved" />
      )}
      {status === 'error' && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" title="Save failed — will retry" />
      )}
      {status === 'offline' && (
        <span className="flex items-center gap-1" title="Offline — changes saved locally">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
          <span className="text-[10px] text-orange-400 font-medium">Offline</span>
        </span>
      )}
      {status === 'conflict' && (
        <span className="flex items-center gap-1" title="Conflict — this scene was edited elsewhere">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="text-[10px] text-red-500 font-medium">Conflict</span>
        </span>
      )}
    </div>
  )
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
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Track the entity that's currently being edited so we can flush on navigate
  const activeEntityRef = useRef<string | null>(null)
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
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
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

  // Listen for version changes from other panels (e.g. chapter notes saving to the same entity)
  useEffect(() => {
    function handleVersionChanged(e: Event) {
      const detail = (e as CustomEvent<{ entityId: string; version: number }>).detail
      if (!detail || detail.entityId !== activeEntityRef.current) return

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

  // Re-check server version when the tab becomes visible again.
  // Handles the case where content was edited on another device while
  // this tab was in the background.
  useEffect(() => {
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

      const draft = loadDraft(eid)
      if (!draft) return

      sdk.entities.getVersion('content', eid).then((versionInfo) => {
        if (!versionInfo) return
        // Bail if user navigated elsewhere while the request was in flight
        if (activeEntityRef.current !== eid) return

        const serverVersion = versionInfo.version
        if (draft.version !== null && serverVersion === draft.version) {
          // Versions match — nothing to do
          return
        }

        if (!draft.savedToServer) {
          // Local unsaved edits AND server changed — conflict
          setSaveStatus('conflict')
          setConflictInfo({ serverVersion, localVersion: draft.version })
          return
        }

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const imageUploadFileRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing...'
      }),
      CharacterCount,
      ImageUpload.configure({
        sdk,
        projectId,
        inline: false,
        allowBase64: false,
      } as any),
      EntityHighlight,
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
        detail: { wordCount: count }
      }))
      // Broadcast text content for bobbins that need to detect typed words
      window.dispatchEvent(new CustomEvent('bobbinry:editor-content-update', {
        detail: { text: editor.state.doc.textContent }
      }))
      const html = editor.getHTML()
      const currentEntityId = activeEntityRef.current

      if (currentEntityId) {
        // Immediately cache to localStorage — this is the safety net
        saveDraft(currentEntityId, { html, wordCount: count, savedToServer: false })
        setSaveStatus('dirty')
        debouncedSave(html, currentEntityId, count)
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

  // --- Flush the current entity's content before switching ---
  // This runs whenever entityId changes. The cleanup of the *previous* effect
  // captures the outgoing entity and editor state.
  useEffect(() => {
    // On mount or entityId change: record the new active entity
    activeEntityRef.current = entityId ?? null

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

  // Also flush before page unload (tab close, refresh)
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingState()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // --- Entity highlight: load entity names for decoration ---
  useEffect(() => {
    if (!editor || !projectId) return

    async function loadEntityNames() {
      try {
        const typeDefsRes = await sdk.entities.query({
          collection: 'entity_type_definitions',
          limit: 100,
        })
        const typeDefs = (typeDefsRes.data as any[]) || []

        const entityResults = await Promise.all(
          typeDefs.map(async (td) => {
            const typeId = (td.typeId || td.type_id) as string
            const typeIcon = (td.icon || '') as string
            const typeLabel = (td.label || typeId) as string
            try {
              const entitiesRes = await sdk.entities.query({
                collection: typeId,
                limit: 500,
              })
              return ((entitiesRes.data as any[]) || [])
                .filter((entity: any) => entity.name)
                .map((entity: any) => ({
                  id: entity.id,
                  name: entity.name,
                  typeId,
                  typeIcon,
                  typeLabel,
                }))
            } catch {
              return [] // Skip types that fail to query
            }
          })
        )
        const entries: EntityEntry[] = entityResults.flat()

        // Update extension storage and trigger decoration rebuild
        if (!editor) return
        ;(editor.storage as any).entityHighlight.entityList = entries
        editor.view.dispatch(
          editor.state.tr.setMeta('entityListUpdated', true)
        )
      } catch (err) {
        console.error('[EditorView] Failed to load entity names:', err)
      }
    }

    loadEntityNames()

    // Re-load when entities are added/renamed/deleted.
    // Skip editor-originated title changes — those don't affect entity names.
    function handleEntityUpdated(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.source === 'editor') return
      loadEntityNames()
    }
    window.addEventListener('bobbinry:entity-updated', handleEntityUpdated)
    return () => window.removeEventListener('bobbinry:entity-updated', handleEntityUpdated)
  }, [editor, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

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

    // Cancel any pending debounced body save and flush it
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    // Cancel any pending debounced title save and flush it
    if (titleSaveTimeoutRef.current) {
      clearTimeout(titleSaveTimeoutRef.current)
      titleSaveTimeoutRef.current = null
      // Fire the title save immediately with the latest draft title
      if (outgoingEntityId) {
        const draft = loadDraft(outgoingEntityId)
        if (draft?.title) {
          sdk.entities.update('content', outgoingEntityId, { title: draft.title }).catch(() => {})
        }
      }
    }

    if (outgoingEntityId) {
      const draft = loadDraft(outgoingEntityId)
      if (draft && !draft.savedToServer) {
        // Draft was already written by onUpdate — just trigger the server save
        serverSave(outgoingEntityId, draft.html, draft.wordCount)
      }
    }
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
        debouncedSave(draft.html, targetEntityId, draft.wordCount)
      }

      // Lightweight version check via HEAD — avoids downloading full content
      sdk.entities.getVersion('content', targetEntityId).then((versionInfo) => {
        if (isStale() || !versionInfo) return
        const serverVersion = versionInfo.version

        if (draft.version !== null && serverVersion === draft.version) {
          // Versions match — cache is fresh
          if (draft.savedToServer) {
            // Nothing to do, we're in sync
            return
          }
          // Local unsaved edits, but server hasn't changed — safe to save normally
          return
        }

        // Versions differ
        if (!draft.savedToServer) {
          // CONFLICT: local unsaved edits AND server changed
          setSaveStatus('conflict')
          setConflictInfo({ serverVersion, localVersion: draft.version })
          return
        }

        // Draft was saved — server is newer, fetch full content to update
        sdk.entities.get('content', targetEntityId).then((result: any) => {
          if (isStale()) return
          const serverContent = result as any
          const serverTitle = serverContent?.title ?? ''
          const serverBody = serverContent?.body ?? ''
          const serverWordCount = serverContent?.word_count ?? 0
          const newVersion = serverContent?._meta?.version ?? serverVersion

          applyContent(serverBody, serverTitle || draft.title, serverWordCount)
          versionRef.current = newVersion
          saveDraft(targetEntityId, {
            html: serverBody,
            title: serverTitle || draft.title,
            wordCount: serverWordCount,
            savedToServer: true,
            version: newVersion,
            containerId: serverContent?.container_id ?? draft.containerId,
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

      applyContent(body, titleVal, count)
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
   * Schedule a debounced server save. Captures the target entityId at call time
   * so the save always goes to the correct entity regardless of navigation.
   */
  function debouncedSave(html: string, targetEntityId: string, count: number) {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      serverSave(targetEntityId, html, count)
    }, 1000) // Wait 1 second after typing stops
  }

  /**
   * Actually persist content to the server. The entityId is captured at
   * schedule time, not read from the current prop.
   */
  async function serverSave(targetEntityId: string, html: string, count: number, skipVersionCheck?: boolean) {
    if (!targetEntityId || savingRef.current) return

    // Don't attempt server save when offline — stay in offline/dirty state
    if (!navigator.onLine) {
      setSaveStatus('offline')
      saveDraft(targetEntityId, { html, wordCount: count, savedToServer: false })
      return
    }

    try {
      savingRef.current = true
      setSaveStatus('saving')

      const expectedVersion = skipVersionCheck ? undefined : (versionRef.current ?? undefined)

      const result = await sdk.entities.update('content', targetEntityId, {
        body: html,
        word_count: count
      }, expectedVersion) as any

      // Extract new version from response and update refs + draft
      const newVersion = result?._meta?.version ?? null
      versionRef.current = newVersion

      // Mark the draft as saved to server
      saveDraft(targetEntityId, { html, wordCount: count, savedToServer: true, version: newVersion })

      // Show "saved" briefly, then go clean
      setSaveStatus('saved')
      setConflictInfo(null)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus(prev => prev === 'saved' ? 'clean' : prev)
      }, 2000)
    } catch (error) {
      if (error instanceof ConflictError) {
        console.warn('[EditorView] Save conflict detected:', error.currentVersion, 'vs expected', error.expectedVersion)
        setSaveStatus('conflict')
        setConflictInfo({ serverVersion: error.currentVersion, localVersion: versionRef.current })
        saveDraft(targetEntityId, { html, wordCount: count, savedToServer: false })
        return
      }
      console.error('[EditorView] Auto-save failed:', error)
      // Detect network errors and set offline status
      const isNetworkError = error instanceof TypeError && error.message.includes('fetch')
      setSaveStatus(isNetworkError || !navigator.onLine ? 'offline' : 'error')
      // Keep the draft marked as unsaved so it will retry
      saveDraft(targetEntityId, { html, wordCount: count, savedToServer: false })
    } finally {
      savingRef.current = false
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
    serverSave(eid, html, wordCount, true)
  }

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

    // Debounce the actual API save to avoid hammering the server on every keystroke
    if (titleSaveTimeoutRef.current) {
      clearTimeout(titleSaveTimeoutRef.current)
    }
    titleSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await sdk.entities.update('content', entityId, {
          title: newTitle
        })
      } catch (error) {
        console.error('[EditorView] Failed to update title:', error)
      }
    }, 500)
  }

  function handleEditorClick(e: React.MouseEvent) {
    // Don't steal focus from the title input
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (editor && !editor.isFocused) {
      editor.commands.focus('end')
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

  return (
    <div className="h-full flex flex-col relative bg-gray-50 dark:bg-gray-900">
      {/* Toolbar - hidden in focus mode */}
      <div className={`transition-all duration-200 overflow-hidden ${focusMode ? 'h-0 opacity-0' : ''}`}>
        <EditorToolbar
          editor={editor}
          onFocusMode={() => {
            window.dispatchEvent(new CustomEvent('bobbinry:request-focus-mode', { detail: { active: true } }))
          }}
          onInsertImage={() => imageUploadFileRef.current?.click()}
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
        <div className="max-w-2xl mx-auto px-8 pt-12 pb-[40vh]">
          {/* Title - integrated into writing surface */}
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled"
            className="w-full font-display text-3xl font-semibold bg-transparent border-none outline-none text-gray-800 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-700 mb-6 leading-tight"
          />

          {/* Prose content */}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Conflict resolution dialog */}
      {conflictInfo && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Editing conflict
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  This scene was edited in another session. Your local changes can't be saved without resolving this.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConflictInfo(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 -mt-1 -mr-1 p-1"
                title="Dismiss (conflict will resurface on next save)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleConflictReload}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
              >
                Reload server version
              </button>
              <button
                type="button"
                onClick={handleConflictSaveAsNew}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition-colors cursor-pointer"
              >
                Save as new scene
              </button>
              <button
                type="button"
                onClick={handleConflictOverwrite}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 transition-colors cursor-pointer"
              >
                Overwrite server version
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating status - word count + save indicator */}
      <div className={`absolute bottom-3 right-4 flex items-center gap-3 text-xs transition-opacity duration-300 ${focusMode ? 'opacity-20 hover:opacity-50' : 'opacity-60 hover:opacity-100'}`}>
        <SaveIndicator status={saveStatus} focusMode={false} />
        <span className="text-gray-400 dark:text-gray-500">{wordCount.toLocaleString()} words</span>
      </div>
    </div>
  )
}
