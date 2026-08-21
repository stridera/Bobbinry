/**
 * NoteContentEditor — rich text editor for the note body.
 *
 * Basic formatting only: bold, italic, strikethrough, headings, bullet and
 * numbered lists, blockquote. Content is stored as HTML in `notes.content`.
 */

import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

interface NoteContentEditorProps {
  /** HTML content. Call normalizeNoteContent() before passing legacy plain text. */
  content: string
  onChange: (html: string) => void
  onBlur?: () => void
  placeholder?: string
  /** Tighter toolbar/padding and no minimum height, for sidebar panels. */
  compact?: boolean
}

export function NoteContentEditor({ content, onChange, onBlur, placeholder, compact = false }: NoteContentEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        code: false,
        horizontalRule: false,
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start writing...',
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    onBlur: () => {
      onBlur?.()
    },
  })

  // Sync content from parent when it changes externally (e.g. switching notes)
  const lastContent = useRef(content)
  useEffect(() => {
    if (editor && content !== lastContent.current) {
      lastContent.current = content
      if (editor.getHTML() !== content) {
        editor.commands.setContent(content || '', { emitUpdate: false })
      }
    }
  }, [editor, content])

  if (!editor) return null

  return (
    <div className={compact ? 'flex flex-col' : 'flex flex-col h-full'}>
      <Toolbar editor={editor} compact={compact} />
      <EditorContent
        editor={editor}
        className={`${compact ? '' : 'flex-1 overflow-auto'} prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100 [&_li>p]:my-0 [&_li]:my-0.5 [&_.tiptap]:outline-none ${compact ? 'px-2 py-2 [&_.tiptap]:min-h-[120px]' : 'px-6 py-4 [&_.tiptap]:min-h-[400px]'} [&_.tiptap_p.is-editor-empty:first-child::before]:text-gray-400 [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none`}
      />
    </div>
  )
}

// --- Toolbar ---

function ToolbarButton({ onClick, isActive, children, title }: {
  onClick: () => void
  isActive?: boolean
  children: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      title={title}
      aria-pressed={isActive}
      className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
        isActive
          ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 mx-1" />
}

function Toolbar({ editor, compact }: { editor: Editor; compact: boolean }) {
  const [, setTick] = useState(0)
  const rafRef = useRef(0)

  // Re-render toolbar when formatting state changes
  useEffect(() => {
    const handler = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => setTick(n => n + 1))
    }
    editor.on('selectionUpdate', handler)
    editor.on('transaction', handler)
    return () => {
      cancelAnimationFrame(rafRef.current)
      editor.off('selectionUpdate', handler)
      editor.off('transaction', handler)
    }
  }, [editor])

  return (
    <div className={`flex items-center flex-wrap gap-0.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 sticky top-0 z-10 ${compact ? 'px-1 py-1' : 'px-4 py-1.5'}`}>
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
        title="Strikethrough (Ctrl+Shift+S)"
      >
        <s>S</s>
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="Heading"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive('heading', { level: 3 })}
        title="Subheading"
      >
        H3
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet List (Ctrl+Shift+8)"
      >
        &bull;{!compact && ' List'}
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Numbered List (Ctrl+Shift+7)"
      >
        1.{!compact && ' List'}
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="Quote"
      >
        &ldquo;{!compact && ' Quote'}
      </ToolbarButton>
    </div>
  )
}
