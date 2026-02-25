import { useState, useEffect, useRef } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'

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
      savedToServer: draft.savedToServer ?? false,
      timestamp: Date.now(),
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
type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

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

function EditorToolbar({ editor, onFocusMode }: { editor: Editor | null; onFocusMode: () => void }) {
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
export default function EditorView({ sdk, entityType, entityId }: EditorViewProps) {
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
  const [wordCount, setWordCount] = useState(0)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track the entity that's currently being edited so we can flush on navigate
  const activeEntityRef = useRef<string | null>(null)
  // Monotonic counter — only the latest loadContent call may update UI state
  const loadGenRef = useRef(0)
  // Suppress onUpdate save during programmatic setContent
  const suppressSaveRef = useRef(false)
  // Track in-flight save to avoid concurrent saves
  const savingRef = useRef(false)

  const [focusMode, setFocusMode] = useState(false)

  // Debounce timer for selection events
  const selectionTimeoutRef = useRef<number | null>(null)
  const lastSelectionRef = useRef<string>('')

  // Listen for focus mode changes from shell
  useEffect(() => {
    const handleFocusMode = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean }>).detail
      setFocusMode(detail.active)
    }
    window.addEventListener('bobbinry:focus-mode-change', handleFocusMode)
    return () => window.removeEventListener('bobbinry:focus-mode-change', handleFocusMode)
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing...'
      }),
      CharacterCount
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
            }, '*')
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
    // Cancel any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    const outgoingEntityId = activeEntityRef.current
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
      })
    }
  }

  async function loadContent(targetEntityId: string) {
    // Increment the generation counter. Only THIS call is allowed to update UI.
    const gen = ++loadGenRef.current
    const isStale = () => loadGenRef.current !== gen

    const draft = loadDraft(targetEntityId)

    // --- Fast path: if we have a local draft, show it instantly ---
    // This covers both unsaved edits AND confirmed-saved content.
    // The user sees their content immediately with no loading spinner.
    if (draft && draft.html && draft.html !== '<p></p>') {
      applyContent(draft.html, draft.title, draft.wordCount)
      setSaveStatus(draft.savedToServer ? 'clean' : 'dirty')
      setLoading(false)

      if (!draft.savedToServer) {
        // Unsaved draft — schedule a server save to sync it
        debouncedSave(draft.html, targetEntityId, draft.wordCount)
      }
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

      applyContent(body, titleVal, count)

      // Cache for instant loading next time
      saveDraft(targetEntityId, {
        html: body,
        title: titleVal,
        wordCount: count,
        savedToServer: true,
      })

      setLoading(false)
    } catch (error) {
      if (isStale()) return

      console.error('[EditorView] Failed to load content:', error)

      // Last resort: try local draft (might exist from a previous session)
      const fallbackDraft = loadDraft(targetEntityId)
      if (fallbackDraft && editor) {
        applyContent(fallbackDraft.html, fallbackDraft.title, fallbackDraft.wordCount)
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
  async function serverSave(targetEntityId: string, html: string, count: number) {
    if (!targetEntityId || savingRef.current) return

    try {
      savingRef.current = true
      setSaveStatus('saving')

      await sdk.entities.update('content', targetEntityId, {
        body: html,
        word_count: count
      })

      // Mark the draft as saved to server
      saveDraft(targetEntityId, { html, wordCount: count, savedToServer: true })

      // Show "saved" briefly, then go clean
      setSaveStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus(prev => prev === 'saved' ? 'clean' : prev)
      }, 2000)
    } catch (error) {
      console.error('[EditorView] Auto-save failed:', error)
      setSaveStatus('error')
      // Keep the draft marked as unsaved so it will retry
      saveDraft(targetEntityId, { html, wordCount: count, savedToServer: false })
    } finally {
      savingRef.current = false
    }
  }

  async function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    if (!entityId) return

    // Update draft with new title
    const draft = loadDraft(entityId)
    if (draft) {
      saveDraft(entityId, { ...draft, title: newTitle, savedToServer: false })
    }

    try {
      await sdk.entities.update('content', entityId, {
        title: newTitle
      })

      // Notify navigation panel of title change
      window.dispatchEvent(
        new CustomEvent('bobbinry:entity-updated', {
          detail: {
            collection: 'content',
            entityId,
            changes: { title: newTitle }
          }
        })
      )
    } catch (error) {
      console.error('[EditorView] Failed to update title:', error)
    }
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
        <EditorToolbar editor={editor} onFocusMode={() => {
          window.dispatchEvent(new CustomEvent('bobbinry:request-focus-mode', { detail: { active: true } }))
        }} />
      </div>

      {/* Writing surface */}
      <div
        className="flex-1 overflow-y-auto cursor-text"
        onClick={handleEditorClick}
      >
        <div className="max-w-2xl mx-auto px-8 pt-12 pb-[40vh]">
          {/* Title - integrated into writing surface */}
          <input
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

      {/* Floating status - word count + save indicator */}
      <div className={`absolute bottom-3 right-4 flex items-center gap-3 text-xs transition-opacity duration-300 ${focusMode ? 'opacity-20 hover:opacity-50' : 'opacity-60 hover:opacity-100'}`}>
        <SaveIndicator status={saveStatus} focusMode={false} />
        <span className="text-gray-400 dark:text-gray-500">{wordCount.toLocaleString()} words</span>
      </div>
    </div>
  )
}
