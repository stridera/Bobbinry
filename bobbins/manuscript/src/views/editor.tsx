import { useState, useEffect, useRef } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { useEditor, EditorContent } from '@tiptap/react'
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

/**
 * Editor View for Manuscript bobbin
 * Provides rich text editing for content with auto-save
 */
export default function EditorView({ sdk, entityType, entityId }: EditorViewProps) {
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Debounce timer for selection events
  const selectionTimeoutRef = useRef<number | null>(null)
  const lastSelectionRef = useRef<string>('')

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
        class: 'prose prose-lg dark:prose-invert max-w-none min-h-full outline-none text-gray-900 dark:text-gray-100'
      }
    },
    onUpdate: ({ editor }) => {
      const count = editor.storage.characterCount.words()
      setWordCount(count)
      debouncedSave(editor.getHTML())
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

  useEffect(() => {
    if (entityType === 'content' && entityId && editor) {
      loadContent()
    } else {
      setLoading(false)
    }
  }, [entityId, entityType, editor])

  async function loadContent() {
    if (!entityId) return

    try {
      setLoading(true)
      const result = await sdk.entities.get('content', entityId)
      const content = result as any

      setTitle(content.title || '')
      editor?.commands.setContent(content.body || '')
      setWordCount(content.word_count || 0)
    } catch (error) {
      console.error('[EditorView] Failed to load content:', error)
    } finally {
      setLoading(false)
    }
  }

  function debouncedSave(html: string) {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      handleAutoSave(html)
    }, 1000) // Wait 1 second after typing stops
  }

  async function handleAutoSave(html: string) {
    if (!entityId || saving) return

    try {
      setSaving(true)
      await sdk.entities.update('content', entityId, {
        body: html,
        word_count: wordCount,
        updated_at: new Date()
      })
    } catch (error) {
      console.error('[EditorView] Auto-save failed:', error)
    } finally {
      setSaving(false)
    }
  }

  async function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    if (!entityId) return

    try {
      await sdk.entities.update('content', entityId, {
        title: newTitle,
        updated_at: new Date()
      })
    } catch (error) {
      console.error('[EditorView] Failed to update title:', error)
    }
  }

  function handleEditorClick() {
    if (editor && !editor.isFocused) {
      editor.commands.focus('end')
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        Loading...
      </div>
    )
  }

  if (!entityId || entityType !== 'content') {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        Select a content item from the navigation panel to edit
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          className="w-full text-2xl font-bold bg-transparent border-none outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <div className="flex justify-between mt-2 text-sm text-gray-500 dark:text-gray-400">
          <span>{wordCount} words</span>
          {saving && <span>Saving...</span>}
        </div>
      </div>

      <div 
        className="flex-1 overflow-y-auto p-4 cursor-text"
        onClick={handleEditorClick}
      >
        <EditorContent
          editor={editor}
          className="h-full"
        />
      </div>
    </div>
  )
}