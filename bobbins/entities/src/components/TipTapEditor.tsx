/**
 * TipTapEditor — Lightweight rich text editor for entity fields.
 *
 * Compact toolbar with basic formatting. No image upload, no entity
 * highlighting, no draft caching — those live in the manuscript editor.
 */

import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

interface TipTapEditorProps {
  content: string
  onChange: (html: string) => void
  readonly?: boolean
  placeholder?: string
}

export function TipTapEditor({ content, onChange, readonly = false, placeholder }: TipTapEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        code: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start writing...',
      }),
    ],
    content,
    editable: !readonly,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  // Sync readonly prop changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readonly)
    }
  }, [editor, readonly])

  // Sync content from parent when it changes externally (e.g., entity load)
  const lastContent = useRef(content)
  useEffect(() => {
    if (editor && content !== lastContent.current) {
      lastContent.current = content
      // Only update if the editor content actually differs
      if (editor.getHTML() !== content) {
        editor.commands.setContent(content || '')
      }
    }
  }, [editor, content])

  if (!editor) return null

  return (
    <div className={`border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden ${readonly ? 'bg-transparent border-transparent' : 'bg-white dark:bg-gray-800'}`}>
      {!readonly && <Toolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className={`prose prose-sm dark:prose-invert max-w-none ${readonly ? 'px-0 py-0' : 'px-3 py-2 min-h-[80px]'} [&_.tiptap]:outline-none [&_.tiptap_p.is-editor-empty:first-child::before]:text-gray-400 [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none`}
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
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${
        isActive
          ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
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
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <s>S</s>
      </ToolbarButton>

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 mx-1" />

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

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      >
        &bull; List
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Numbered List"
      >
        1. List
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="Blockquote"
      >
        &ldquo; Quote
      </ToolbarButton>
    </div>
  )
}
