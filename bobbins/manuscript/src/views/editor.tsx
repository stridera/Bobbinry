import { useEffect, useRef, useState } from 'react'
import { registerShortcuts } from '@bobbinry/sdk'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { paletteClasses, EntityHoverCard } from '@bobbinry/ui-components'
import { resolveChapterColor, resolveFeaturedCharacters } from '../lib/chapterColors'
import {
  countsTowardWordCount,
  displaySettingsToClass,
  isContentType,
  type ContentType,
  type PartialManuscriptDisplaySettings,
} from '@bobbinry/types'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import TextAlign from '@tiptap/extension-text-align'
import { ImageUpload } from '../extensions/image-upload'
import { EntityHighlight } from '../extensions/entity-highlight'
import { SearchHighlight } from '../extensions/search-highlight'
import { SmartTypography } from '../extensions/smart-typography'
import { useDisplaySettings } from './display-settings'
import { loadDraft, saveDraft } from '../lib/drafts'
import { getParentOrigin } from '../lib/editor-types'
import { EditorToolbar } from '../components/EditorToolbar'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConflictDialog, SessionExpiredBanner } from '../components/EditorOverlays'
import { ContentTypeMenu } from '../components/ContentTypeMenu'
import { ChapterMetaMenu, type ChapterMetaPatch } from '../components/ChapterMetaMenu'
import { useEntityHighlightNames } from '../hooks/useEntityHighlightNames'
import { useChapterCharacters } from '../hooks/useChapterCharacters'
import { useFindSession } from '../hooks/useFindSession'
import { useChapterPersistence } from '../hooks/useChapterPersistence'

interface EditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
  entityId?: string
  metadata?: { focusTitle?: boolean }
}

const EDITOR_SHORTCUTS = [
  { keys: 'Mod+Enter', description: 'Finish chapter — new chapter below, keep typing', group: 'Editor' },
  { keys: 'Enter / ↓', description: 'Jump from the title into the prose', group: 'Editor' },
  { keys: 'Mod+B', description: 'Bold', group: 'Formatting' },
  { keys: 'Mod+I', description: 'Italic', group: 'Formatting' },
  { keys: 'Mod+Shift+S', description: 'Strikethrough', group: 'Formatting' },
  { keys: 'Mod+E', description: 'Inline code', group: 'Formatting' },
  { keys: 'Shift+Enter', description: 'Line break', group: 'Formatting' },
  { keys: 'Mod+Z', description: 'Undo', group: 'Formatting' },
  { keys: 'Mod+Shift+Z', description: 'Redo', group: 'Formatting' },
]

const HIGHLIGHT_CSS = `
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

/**
 * Editor View for the Manuscript bobbin: rich text editing with auto-save and
 * local draft caching. The persistence engine lives in useChapterPersistence,
 * the find/search bridge in useFindSession; this component wires TipTap to
 * them and renders the surface.
 */
export default function EditorView({ sdk, projectId, entityType, entityId, metadata }: EditorViewProps) {
  const [contentType, setContentType] = useState<ContentType>('chapter')
  const [contentTypeMenuOpen, setContentTypeMenuOpen] = useState(false)
  const [savingContentType, setSavingContentType] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const imageUploadFileRef = useRef<HTMLInputElement>(null)

  // The entity currently being edited — shared by the persistence and find
  // hooks so window listeners can tell "this chapter" from a stale one.
  const activeEntityRef = useRef<string | null>(null)
  // Latest createChapterBelow closure, read by the Mod-Enter editor shortcut
  // (the TipTap extension is created once, at editor init).
  const createChapterBelowRef = useRef<() => void>(() => {})
  // Always the current editor instance, for callbacks created before it mounts.
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  // Content-level manuscript display overrides — fed from the loaded entity's
  // `entityData.displaySettings`. Combined with user + project levels via
  // useDisplaySettings to produce the resolved cascade for the prose surface.
  const [contentDisplay, setContentDisplay] = useState<PartialManuscriptDisplaySettings>({})
  const displayState = useDisplaySettings(sdk, projectId, entityId, contentDisplay)

  const { characters: editorCharacters, chapterColor, setChapterColor } = useChapterCharacters(sdk, projectId, entityId, entityType)
  const find = useFindSession({ editorRef, activeEntityRef })

  // Debounce timer for selection events
  const selectionTimeoutRef = useRef<number | null>(null)
  const lastSelectionRef = useRef<string>('')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing...' }),
      CharacterCount,
      // Preserves `text-align` on imported paragraphs/headings (centered
      // chapter titles, etc.). Stored as inline style on the node so the
      // round-trip through the editor is lossless.
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      }),
      ImageUpload.configure({ sdk, projectId, inline: false, allowBase64: false } as any),
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
      if (persistence.suppressSaveRef.current) return

      const count = editor.storage.characterCount.words()
      persistence.setWordCount(count)
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
      if (find.findOptsRef.current.query) find.emitFindState(editor)
      persistence.recordEdit(editor.getHTML(), count)
    },
    onSelectionUpdate: ({ editor }) => {
      if (selectionTimeoutRef.current) clearTimeout(selectionTimeoutRef.current)
      // Debounce selection events
      selectionTimeoutRef.current = window.setTimeout(() => {
        const { from, to } = editor.state.selection
        const trimmedText = editor.state.doc.textBetween(from, to, ' ').trim()
        // Only publish if text is selected and different from last selection
        if (trimmedText && trimmedText !== lastSelectionRef.current) {
          lastSelectionRef.current = trimmedText
          window.parent.postMessage({
            namespace: 'BUS',
            type: 'BUS_EVENT',
            payload: {
              topic: 'manuscript.editor.selection.v1',
              data: { text: trimmedText, length: trimmedText.length },
              source: 'manuscript.editor'
            },
            metadata: { timestamp: Date.now() }
          }, getParentOrigin())
        }
      }, 300)
    }
  })
  editorRef.current = editor

  const persistence = useChapterPersistence({
    sdk,
    editor,
    editorRef,
    entityId,
    entityType,
    activeEntityRef,
    onContentApplied: find.afterContentApplied,
    onContentType: setContentType,
    onContentDisplay: setContentDisplay,
  })
  createChapterBelowRef.current = persistence.createChapterBelow
  const { title, wordCount, saveStatus, loading, conflictInfo, setConflictInfo, versionRef } = persistence

  useEntityHighlightNames(editor, sdk, projectId)

  // Sync resolved smart-typography settings into the extension's storage so
  // input rules pick up cascade changes without re-creating the editor.
  useEffect(() => {
    if (!editor) return
    const storage = (editor.storage as any).smartTypography
    if (!storage) return
    storage.dashes = displayState.resolved.smartDashes
    storage.ellipsis = displayState.resolved.smartEllipsis
  }, [editor, displayState.resolved.smartDashes, displayState.resolved.smartEllipsis])

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
    window.dispatchEvent(new CustomEvent('bobbinry:active-chapter', { detail: { id: entityId, title } }))
    return () => {
      window.dispatchEvent(new CustomEvent('bobbinry:active-chapter', { detail: null }))
    }
  }, [entityId, entityType, title])

  // Announce this view's shortcuts to the shell's help overlay (?).
  useEffect(() => registerShortcuts('manuscript.editor', EDITOR_SHORTCUTS), [])

  // Focus and select title when creating new content
  useEffect(() => {
    if (!loading && metadata?.focusTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [loading, metadata?.focusTitle])

  // Entity-highlight + search-match styles, scoped to this view's lifetime
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = HIGHLIGHT_CSS
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

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

  async function applyChapterMetaPatch(patch: ChapterMetaPatch) {
    if (!entityId || entityType !== 'content') return
    setChapterColor(prev => ({ ...prev, ...patch }))
    try {
      // Send expectedVersion so the server's optimistic-locking check passes,
      // then capture the bumped version and keep versionRef/draft in sync. If
      // we skip this, the next body autosave fires with a stale expectedVersion
      // and the user sees a phantom "Version Conflict" dialog.
      const result = await sdk.entities.update('content', entityId, patch, versionRef.current ?? undefined) as any
      const newVersion = result?._meta?.version ?? null
      if (newVersion != null) {
        versionRef.current = newVersion
        const draft = loadDraft(entityId)
        if (draft) saveDraft(entityId, { html: draft.html, version: newVersion })
      }
      window.dispatchEvent(new CustomEvent('bobbinry:chapter-color-changed', { detail: { entityId, patch } }))
      if (newVersion != null) {
        window.dispatchEvent(new CustomEvent('bobbinry:entity-version-changed', { detail: { entityId, version: newVersion } }))
      }
    } catch (err) {
      console.error('[EditorView] Failed to update chapter color fields:', err)
    }
  }

  async function handleImageFile(file: File) {
    if (!editor) return
    const placeholderSrc = URL.createObjectURL(file)
    editor.chain().focus().setImage({ src: placeholderSrc, alt: file.name, title: 'Uploading...' }).run()

    const swapPlaceholder = (update: (pos: number, nodeSize: number, attrs: Record<string, unknown>) => void) => {
      const { doc } = editor.state
      doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === placeholderSrc) {
          update(pos, node.nodeSize, node.attrs)
          return false
        }
        return true
      })
    }

    try {
      const result = await sdk.uploads.upload({ file, projectId, context: 'editor' })
      swapPlaceholder((pos, _size, attrs) => {
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...attrs, src: result.url, title: null }))
      })
    } catch (err) {
      console.error('[EditorView] Image upload failed:', err)
      swapPlaceholder((pos, size) => { editor.view.dispatch(editor.state.tr.delete(pos, pos + size)) })
    } finally {
      URL.revokeObjectURL(placeholderSrc)
    }
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

  const countsForWords = countsTowardWordCount(contentType)
  const chapterColorClasses = paletteClasses(resolveChapterColor(chapterColor, editorCharacters))
  const povCharacter = chapterColor.pov_character_id
    ? editorCharacters.get(chapterColor.pov_character_id) ?? null
    : null
  const featuredCharacters = resolveFeaturedCharacters(chapterColor, editorCharacters)

  return (
    <div className="h-full flex flex-col relative bg-gray-50 dark:bg-gray-900">
      {/* POV / manual color stripe — subtle visual confirmation of which
          character drives this chapter. Hidden when no color is set. */}
      {chapterColorClasses && (
        <div aria-hidden className={`h-[3px] flex-shrink-0 ${chapterColorClasses.stripe}`} />
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
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleImageFile(file)
        }}
      />

      {/* Writing surface */}
      <div className="flex-1 overflow-y-auto cursor-text" onClick={handleEditorClick}>
        <div className={`max-w-2xl mx-auto px-8 pt-12 pb-[40vh] ${displaySettingsToClass(displayState.resolved)} ${displayState.showFormattingMarks ? 'ms-show-marks' : ''}`}>
          {/* Title - integrated into writing surface */}
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => persistence.handleTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                // Ctrl/Cmd+Enter — same "finish chapter" gesture as in the prose
                e.preventDefault()
                void persistence.createChapterBelow()
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

          {/* stopPropagation: clicks inside these dropdowns (buttons, menu items,
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
            <ChapterMetaMenu
              chapterColor={chapterColor}
              characters={editorCharacters}
              colorClasses={chapterColorClasses}
              povCharacter={povCharacter}
              featuredCharacters={featuredCharacters}
              onPatch={patch => { void applyChapterMetaPatch(patch) }}
            />
          </div>

          <EditorContent editor={editor} />
        </div>
      </div>

      {saveStatus === 'auth' && <SessionExpiredBanner />}

      {conflictInfo && (
        <ConflictDialog
          onDismiss={() => setConflictInfo(null)}
          onReload={persistence.handleConflictReload}
          onSaveAsNew={persistence.handleConflictSaveAsNew}
          onOverwrite={persistence.handleConflictOverwrite}
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
