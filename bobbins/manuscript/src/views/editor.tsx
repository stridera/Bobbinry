import { useState, useEffect, useRef } from 'react'
import { ConflictError } from '@bobbinry/sdk'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { paletteClasses, isPaletteToken, PALETTE_TOKENS } from '@bobbinry/ui-components'
import {
  resolveChapterColor,
  resolveFeaturedCharacters,
  characterInitial,
  type ChapterColorFields,
  type CharactersById,
  type CharacterColorRef,
} from '../lib/chapterColors'
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  countsTowardWordCount,
  isContentType,
  type ContentType,
} from '@bobbinry/types'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TextAlign from '@tiptap/extension-text-align'
import { ImageUpload } from '../extensions/image-upload'
import { EntityHighlight } from '../extensions/entity-highlight'
import type { EntityEntry } from '../extensions/entity-highlight'
import { SmartTypography } from '../extensions/smart-typography'
import {
  displaySettingsToClass,
  sanitizeDisplaySettings,
  type PartialManuscriptDisplaySettings,
} from '@bobbinry/types'
import { DisplayDropdown, useDisplaySettings } from './display-settings'

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

function EditorToolbar({
  editor,
  onFocusMode,
  onInsertImage,
  displayState,
}: {
  editor: Editor | null
  onFocusMode: () => void
  onInsertImage: () => void
  displayState: ReturnType<typeof useDisplaySettings>
}) {
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
        onClick={() => displayState.toggleFormattingMarks()}
        isActive={displayState.showFormattingMarks}
        title={displayState.showFormattingMarks ? 'Hide formatting marks' : 'Show formatting marks (¶, ↵)'}
      >
        <span className="text-sm leading-none">¶</span>
      </ToolbarButton>

      <DisplayDropdown state={displayState} />

      <ToolbarDivider />

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

  // Chapter color fields + character lookup, used to render the top stripe
  // and the inline POV/featured/color picker.
  const [chapterColor, setChapterColor] = useState<ChapterColorFields>({})
  const [editorCharacters, setEditorCharacters] = useState<CharactersById>(() => new Map())
  const [chapterMetaMenuOpen, setChapterMetaMenuOpen] = useState(false)
  const [chapterMetaView, setChapterMetaView] = useState<'main' | 'pov' | 'featured' | 'color'>('main')

  // Load characters once per project for the color cascade. Also re-runs when
  // the entities module reports a change to the characters collection so the
  // POV cascade stays in sync after a color edit.
  useEffect(() => {
    let cancelled = false

    function refresh() {
      sdk.entities.query({ collection: 'characters', limit: 1000 })
        .then(res => {
          if (cancelled) return
          const map: CharactersById = new Map()
          for (const c of (res.data as any[]) ?? []) {
            if (!c?.id) continue
            map.set(c.id, {
              id: c.id,
              name: typeof c.name === 'string' ? c.name : undefined,
              color: isPaletteToken(c.color) ? c.color : null,
            })
          }
          setEditorCharacters(map)
        })
        .catch(() => {
          if (!cancelled) setEditorCharacters(new Map())
        })
    }

    function handleEntitiesChanged(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.collection !== 'characters') return
      refresh()
    }

    refresh()
    window.addEventListener('bobbinry:entities-changed', handleEntitiesChanged)
    return () => {
      cancelled = true
      window.removeEventListener('bobbinry:entities-changed', handleEntitiesChanged)
    }
  }, [projectId, sdk])

  // Pull color fields off the chapter entity when it loads/changes.
  useEffect(() => {
    if (entityType !== 'content' || !entityId) {
      setChapterColor({})
      return
    }
    let cancelled = false
    sdk.entities.get('content', entityId)
      .then((result: any) => {
        if (cancelled) return
        setChapterColor({
          pov_character_id: result?.pov_character_id ?? null,
          featured_character_ids: Array.isArray(result?.featured_character_ids)
            ? result.featured_character_ids
            : [],
          manual_color: result?.manual_color ?? null,
        })
      })
      .catch(() => {
        if (!cancelled) setChapterColor({})
      })
    return () => { cancelled = true }
  }, [entityId, entityType, sdk])

  // Sync stripe when the user changes color/POV from the navigation panel.
  useEffect(() => {
    function handleChapterColorChanged(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.entityId || detail.entityId !== entityId) return
      setChapterColor(prev => ({
        ...prev,
        ...(detail.patch ?? {}),
      }))
    }
    window.addEventListener('bobbinry:chapter-color-changed', handleChapterColorChanged)
    return () => window.removeEventListener('bobbinry:chapter-color-changed', handleChapterColorChanged)
  }, [entityId])

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

  // Refresh the editor when Search & Replace applies a bulk change that
  // includes this chapter. Drop the cached draft first so the local copy
  // can't clobber the new server content on the next save.
  useEffect(() => {
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
  }, [entityType]) // eslint-disable-line react-hooks/exhaustive-deps

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

      if (!localStorage.getItem(getDraftKey(eid))) return

      sdk.entities.getVersion('content', eid).then((versionInfo) => {
        if (!versionInfo) return
        // Bail if user navigated elsewhere while the request was in flight
        if (activeEntityRef.current !== eid) return
        // Bail if a save started (or finished) while the HEAD was in flight
        if (savingRef.current) return

        // Re-read the draft — a debounced save may have completed during
        // the async getVersion round-trip, updating version/savedToServer.
        const draft = loadDraft(eid)
        if (!draft) return

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
      SmartTypography,
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
                .flatMap((entity: any) => {
                  const base = {
                    id: entity.id,
                    typeId,
                    typeIcon,
                    typeLabel,
                  }
                  const out: EntityEntry[] = [{ ...base, name: entity.name }]
                  if (Array.isArray(entity.aliases)) {
                    for (const alias of entity.aliases) {
                      if (typeof alias === 'string' && alias.trim()) {
                        out.push({ ...base, name: alias.trim() })
                      }
                    }
                  }
                  return out
                })
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

  // --- Text focus: scroll editor to specific text when requested by any bobbin ---
  // Dispatchers send: { quote: string, paragraphIndex?: number }
  const editorRef = useRef(editor)
  editorRef.current = editor

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
          if (isContentType(serverContent?.contentType)) setContentType(serverContent.contentType)

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

    try {
      savingRef.current = true
      setSaveStatus('saving')

      const expectedVersion = opts?.skipVersionCheck ? undefined : (versionRef.current ?? undefined)

      const data: Record<string, any> = {}
      if (html !== undefined) data.body = html
      if (count !== undefined) data.word_count = count
      if (opts?.title !== undefined) data.title = opts.title

      const result = await sdk.entities.update('content', targetEntityId,
        data, expectedVersion) as any

      const newVersion = result?._meta?.version ?? null
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
        console.warn('[EditorView] Save conflict detected:', error.currentVersion, 'vs expected', error.expectedVersion)
        markDirty()
        // Only show conflict UI if this entity is still active
        if (activeEntityRef.current === targetEntityId) {
          setSaveStatus('conflict')
          setConflictInfo({ serverVersion: error.currentVersion, localVersion: versionRef.current })
        }
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
  const characterList: CharacterColorRef[] = Array.from(editorCharacters.values()).sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  )

  async function applyChapterMetaPatch(patch: {
    pov_character_id?: string | null
    featured_character_ids?: string[]
    manual_color?: string | null
  }) {
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

  function closeChapterMetaMenu() {
    setChapterMetaMenuOpen(false)
    setChapterMetaView('main')
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
            <div className="relative inline-block">
              <button
                type="button"
                onClick={() => setContentTypeMenuOpen(o => !o)}
                disabled={savingContentType}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${
                  countsForWords
                    ? 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800 dark:hover:bg-blue-900/50'
                    : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800 dark:hover:bg-amber-900/50'
                }`}
                title="Change content type"
              >
                <span>{CONTENT_TYPE_LABELS[contentType]}</span>
                {!countsForWords && (
                  <span className="opacity-70">· not counted</span>
                )}
                <svg className="w-3 h-3 opacity-60" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <path d="M2 4l4 4 4-4z" />
                </svg>
              </button>
              {contentTypeMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setContentTypeMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute left-0 top-full mt-1 z-20 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1">
                    {CONTENT_TYPES.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleContentTypeChange(t)}
                        disabled={t === contentType || savingContentType}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-default ${
                          t === contentType
                            ? 'font-semibold text-gray-900 dark:text-gray-100'
                            : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <span>{CONTENT_TYPE_LABELS[t]}</span>
                        {t === contentType && <span className="text-blue-500">✓</span>}
                        {!countsTowardWordCount(t) && t !== contentType && (
                          <span className="text-[10px] text-gray-400">not counted</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* POV character + color picker. Combined dropdown: pick POV character,
                add featured characters, or set a manual color override. Mirrors the
                right-click menu in the navigation panel; either path works. */}
            {entityType === 'content' && (
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => { setChapterMetaMenuOpen(o => !o); setChapterMetaView('main') }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset bg-white text-gray-700 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700/60 transition-colors"
                  title={povCharacter?.name ? `POV: ${povCharacter.name}` : 'Set POV character'}
                >
                  <span
                    aria-hidden
                    className={`inline-block h-3 w-3 rounded-full ${chapterColorClasses?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`}
                  />
                  <span>
                    {povCharacter?.name
                      ? `POV: ${povCharacter.name}`
                      : isPaletteToken(chapterColor.manual_color)
                        ? 'Custom color'
                        : 'POV'}
                  </span>
                  {featuredCharacters.length > 0 && (
                    <span className="flex items-center gap-0.5 ml-1">
                      {featuredCharacters.slice(0, 3).map(c => {
                        const cls = paletteClasses(c.color)
                        return (
                          <span
                            key={c.id}
                            title={c.name ?? 'Unnamed'}
                            className={`inline-flex items-center justify-center h-3 w-3 rounded-full text-[7px] font-semibold text-white ring-1 ring-white dark:ring-gray-800 ${cls?.chipBg ?? 'bg-gray-300 dark:bg-gray-600'}`}
                          >
                            {characterInitial(c.name)}
                          </span>
                        )
                      })}
                      {featuredCharacters.length > 3 && (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">+{featuredCharacters.length - 3}</span>
                      )}
                    </span>
                  )}
                  <svg className="w-3 h-3 opacity-60" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                    <path d="M2 4l4 4 4-4z" />
                  </svg>
                </button>
                {chapterMetaMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={closeChapterMetaMenu}
                      aria-hidden="true"
                    />
                    <div className="absolute left-0 top-full mt-1 z-20 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden">
                      {chapterMetaView === 'main' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setChapterMetaView('pov')}
                            className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                          >
                            <span className="flex items-center gap-2">
                              <span>🎭</span>
                              <span>POV character</span>
                            </span>
                            <span className="flex items-center gap-1 text-gray-400">
                              {povCharacter ? (
                                <>
                                  <span className={`h-2.5 w-2.5 rounded-full ${paletteClasses(povCharacter.color)?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                                  <span className="truncate max-w-[100px]">{povCharacter.name}</span>
                                </>
                              ) : (
                                <span className="italic">none</span>
                              )}
                              <span className="ml-1">▸</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setChapterMetaView('featured')}
                            className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-t border-gray-200 dark:border-gray-700"
                          >
                            <span className="flex items-center gap-2">
                              <span>👥</span>
                              <span>Featured characters</span>
                            </span>
                            <span className="flex items-center gap-0.5 text-gray-400">
                              <span>{featuredCharacters.length || '—'}</span>
                              <span className="ml-1">▸</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setChapterMetaView('color')}
                            className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-t border-gray-200 dark:border-gray-700"
                          >
                            <span className="flex items-center gap-2">
                              <span>🎨</span>
                              <span>Custom color</span>
                            </span>
                            <span className="flex items-center gap-1 text-gray-400">
                              {isPaletteToken(chapterColor.manual_color) ? (
                                <>
                                  <span className={`h-2.5 w-2.5 rounded-full ${paletteClasses(chapterColor.manual_color)?.swatchBg}`} />
                                  <span>{paletteClasses(chapterColor.manual_color)?.label}</span>
                                </>
                              ) : (
                                <span className="italic">none</span>
                              )}
                              <span className="ml-1">▸</span>
                            </span>
                          </button>
                        </>
                      )}

                      {chapterMetaView === 'pov' && (
                        <div className="max-h-72 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => setChapterMetaView('main')}
                            className="w-full text-left px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
                          >
                            ← POV character
                          </button>
                          <button
                            type="button"
                            onClick={() => { void applyChapterMetaPatch({ pov_character_id: null }); closeChapterMetaMenu() }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 ${chapterColor.pov_character_id == null ? 'font-semibold' : ''}`}
                          >
                            <span className="h-3 w-3 rounded-full border border-gray-300 dark:border-gray-600" />
                            <span className="italic text-gray-500 dark:text-gray-400">(none)</span>
                          </button>
                          {characterList.length === 0 && (
                            <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 italic">No characters yet</div>
                          )}
                          {characterList.map(char => {
                            const cls = paletteClasses(char.color)
                            const isCurrent = char.id === chapterColor.pov_character_id
                            return (
                              <button
                                key={char.id}
                                type="button"
                                onClick={() => { void applyChapterMetaPatch({ pov_character_id: char.id, manual_color: null }); closeChapterMetaMenu() }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 ${isCurrent ? 'font-semibold' : ''}`}
                              >
                                <span className={`h-3 w-3 rounded-full ${cls?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                                <span className="truncate flex-1 text-left">{char.name ?? 'Unnamed'}</span>
                                {isCurrent && <span className="text-blue-500">✓</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {chapterMetaView === 'featured' && (
                        <div className="max-h-72 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => setChapterMetaView('main')}
                            className="w-full text-left px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
                          >
                            ← Featured characters
                          </button>
                          {characterList.length === 0 && (
                            <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 italic">No characters yet</div>
                          )}
                          {characterList.map(char => {
                            const cls = paletteClasses(char.color)
                            const current = new Set(chapterColor.featured_character_ids ?? [])
                            const isOn = current.has(char.id)
                            return (
                              <button
                                key={char.id}
                                type="button"
                                onClick={() => {
                                  const next = new Set(current)
                                  if (isOn) next.delete(char.id)
                                  else next.add(char.id)
                                  void applyChapterMetaPatch({ featured_character_ids: Array.from(next) })
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                              >
                                <span className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded border ${isOn ? 'bg-gray-900 dark:bg-gray-100 border-gray-900 dark:border-gray-100 text-white dark:text-gray-900' : 'border-gray-400 dark:border-gray-500'}`}>
                                  {isOn && <span className="text-[10px] leading-none">✓</span>}
                                </span>
                                <span className={`h-3 w-3 rounded-full ${cls?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                                <span className="truncate flex-1 text-left">{char.name ?? 'Unnamed'}</span>
                              </button>
                            )
                          })}
                          <button
                            type="button"
                            onClick={closeChapterMetaMenu}
                            className="w-full text-left px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
                          >
                            Done
                          </button>
                        </div>
                      )}

                      {chapterMetaView === 'color' && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setChapterMetaView('main')}
                            className="w-full text-left px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
                          >
                            ← Custom color
                          </button>
                          <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                            Overrides POV character color.
                          </div>
                          <div className="px-3 pb-3 grid grid-cols-6 gap-2">
                            {PALETTE_TOKENS.map(token => {
                              const cls = paletteClasses(token)
                              if (!cls) return null
                              const isCurrent = token === chapterColor.manual_color
                              return (
                                <button
                                  key={token}
                                  type="button"
                                  title={cls.label}
                                  onClick={() => { void applyChapterMetaPatch({ manual_color: token }); closeChapterMetaMenu() }}
                                  className={`h-6 w-6 rounded-full ${cls.swatchBg} ring-offset-2 ring-offset-white dark:ring-offset-gray-800 transition ${isCurrent ? 'ring-2 ring-gray-900 dark:ring-gray-100' : 'hover:ring-2 hover:ring-gray-300 dark:hover:ring-gray-500'}`}
                                />
                              )
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => { void applyChapterMetaPatch({ manual_color: null }); closeChapterMetaMenu() }}
                            className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
                          >
                            Clear custom color
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

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
