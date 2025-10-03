import { useState, useEffect } from 'react'
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
  // New entity context props from ViewRouter
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
}

interface Scene {
  id: string
  title: string
  content: string
  wordCount: number
  chapterId: string
}

/**
 * Native Editor View for Manuscript bobbin
 * Provides rich text editing for scenes with auto-save
 */
export default function EditorView({ sdk, projectId, entityType, entityId }: EditorViewProps) {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [wordCount, setWordCount] = useState(0)
  const [chapters, setChapters] = useState<Array<{ id: string; title: string; bookId: string }>>([])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        }
      }),
      Placeholder.configure({
        placeholder: 'Begin writing your scene...'
      }),
      CharacterCount
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none',
        style: 'min-height: 400px; padding: 20px;'
      }
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      setContent(html)
      setSaveStatus('unsaved')
      setWordCount(editor.storage.characterCount.words())
    },
    onSelectionUpdate: ({ editor }) => {
      // Get selected text
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, ' ')
      
      // Publish selection event if text is selected
      if (text && text.trim()) {
        // Post message directly to window for sandboxed panels
        if (typeof window !== 'undefined') {
          window.postMessage({
            type: 'bus:event',
            source: 'manuscript.editor',
            target: '*',
            topic: 'manuscript.editor.selection.v1',
            payload: {
              text: text.trim(),
              length: text.trim().length
            }
          }, '*')
        }
      }
    }
  })

  // Load all scenes and chapters on mount
  useEffect(() => {
    loadScenes()
  }, [projectId])

  // Auto-save timer
  useEffect(() => {
    if (saveStatus === 'unsaved' && selectedSceneId) {
      const timer = setTimeout(() => {
        saveScene()
      }, 2000) // Auto-save after 2 seconds of inactivity

      return () => clearTimeout(timer)
    }
    return undefined
  }, [content, title, saveStatus, selectedSceneId])

  // Load scene content when selection changes
  useEffect(() => {
    if (selectedSceneId) {
      loadSceneContent(selectedSceneId)
    }
  }, [selectedSceneId])

  // Listen for navigation events from the navigation panel (backward compatibility)
  useEffect(() => {
    const handleNavigateToScene = (event: Event) => {
      const customEvent = event as CustomEvent<{ sceneId: string }>
      const { sceneId } = customEvent.detail
      console.log('[EditorView] Received navigate-to-scene event:', sceneId)
      
      // Save current scene before switching
      if (saveStatus === 'unsaved' && selectedSceneId) {
        saveScene()
      }
      setSelectedSceneId(sceneId)
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('manuscript:navigate-to-scene', handleNavigateToScene)
      console.log('[EditorView] Registered listener for manuscript:navigate-to-scene')
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('manuscript:navigate-to-scene', handleNavigateToScene)
      }
    }
  }, [saveStatus, selectedSceneId])

  // Handle entity context from ViewRouter
  useEffect(() => {
    if (entityType === 'scene' && entityId) {
      console.log('[EditorView] Received entity context:', { entityType, entityId })
      // Save current scene before switching
      if (saveStatus === 'unsaved' && selectedSceneId && selectedSceneId !== entityId) {
        saveScene()
      }
      setSelectedSceneId(entityId)
    }
  }, [entityType, entityId])

  async function loadScenes() {
    try {
      setLoading(true)

      // Load chapters first
      const chaptersResult = await sdk.entities.query({
        collection: 'chapters',
        sort: [{ field: 'order', direction: 'asc' }]
      })

      const chaptersList = (chaptersResult.data as any[]).map((c: any) => ({
        id: c.id,
        title: c.title || 'Untitled Chapter',
        bookId: c.book_id
      }))
      setChapters(chaptersList)

      // Load all scenes
      const scenesResult = await sdk.entities.query({
        collection: 'scenes',
        sort: [{ field: 'order', direction: 'asc' }]
      })

      const scenesList = (scenesResult.data as any[]).map((s: any) => ({
        id: s.id,
        title: s.title || 'Untitled Scene',
        content: s.body || '',
        wordCount: s.word_count || 0,
        chapterId: s.chapter_id
      }))

      setScenes(scenesList)

      // Auto-select first scene if available
      if (scenesList.length > 0 && !selectedSceneId) {
        setSelectedSceneId(scenesList[0]!.id)
      }
    } catch (error) {
      console.error('[EditorView] Failed to load scenes:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadSceneContent(sceneId: string) {

    try {
      // Fetch fresh data from API
      const entity = await sdk.entities.get('scenes', sceneId)
      const sceneData = entity as any

      setTitle(sceneData.title || '')
      const sceneContent = sceneData.body || ''
      setContent(sceneContent)
      
      if (editor) {
        editor.commands.setContent(sceneContent)
      }

      setSaveStatus('saved')
    } catch (error) {
      console.error('[EditorView] Failed to load scene content:', error)
    }
  }

  async function saveScene() {
    if (!selectedSceneId) return

    try {
      setSaving(true)
      setSaveStatus('saving')

      await sdk.entities.update('scenes', selectedSceneId, {
        title,
        body: content,
        word_count: wordCount,
        updated_at: new Date().toISOString()
      })

      // Update local scene list
      setScenes(prev =>
        prev.map(s =>
          s.id === selectedSceneId ? { ...s, title, content, wordCount } : s
        )
      )

      setSaveStatus('saved')
    } catch (error) {
      console.error('[EditorView] Failed to save scene:', error)
      setSaveStatus('unsaved')
    } finally {
      setSaving(false)
    }
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTitle(e.target.value)
    setSaveStatus('unsaved')
  }



  if (loading) {
    return (
      <div className="p-5 text-center text-gray-600 dark:text-gray-300">
        <div>Loading editor...</div>
      </div>
    )
  }

  if (scenes.length === 0) {
    return (
      <div className="p-5 text-center text-gray-600 dark:text-gray-400">
        <div className="mb-3">No scenes available</div>
        <div className="text-sm">Create chapters and scenes from the outline view</div>
      </div>
    )
  }

  const currentScene = scenes.find(s => s.id === selectedSceneId)
  const currentChapter = chapters.find(c => c.id === currentScene?.chapterId)

  return (
    <div className="flex flex-col h-full font-sans">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 flex justify-between items-center">
          <div className="flex-1 mr-5">
            <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
              {currentChapter?.title || 'Unknown Chapter'}
            </div>
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder="Scene Title"
              className="w-full border-none bg-transparent text-xl font-semibold outline-none py-1 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600 dark:text-gray-400">{wordCount} words</span>
            <span
              className={
                saveStatus === 'saved' ? 'text-green-600 dark:text-green-400' :
                saveStatus === 'saving' ? 'text-orange-600 dark:text-orange-400' :
                'text-gray-600 dark:text-gray-400'
              }
            >
              {saveStatus === 'saved' && '✓ Saved'}
              {saveStatus === 'saving' && 'Saving...'}
              {saveStatus === 'unsaved' && '• Unsaved'}
            </span>
            <button
              onClick={saveScene}
              disabled={saving || saveStatus === 'saved'}
              className={`px-3 py-1.5 rounded ${
                saveStatus === 'saved'
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-default'
                  : 'bg-blue-600 dark:bg-blue-700 text-white cursor-pointer hover:bg-blue-700 dark:hover:bg-blue-600'
              }`}
            >
              Save Now
            </button>
          </div>
        </div>

        {/* Rich Text Editor */}
        <div className="flex-1 overflow-auto bg-white dark:bg-gray-900">
          {/* Toolbar */}
          {editor && (
            <div className="p-2 px-5 border-b border-gray-200 dark:border-gray-700 flex gap-1 flex-wrap bg-gray-50 dark:bg-gray-800">

              <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                disabled={!editor.can().chain().focus().toggleBold().run()}
                className={`px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer text-sm font-semibold ${
                  editor.isActive('bold')
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                B
              </button>
              <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                disabled={!editor.can().chain().focus().toggleItalic().run()}
                className={`px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer text-sm italic ${
                  editor.isActive('italic')
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                I
              </button>
              <button
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                className={`px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer text-sm ${
                  editor.isActive('heading', { level: 1 })
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                H1
              </button>
              <button
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                className={`px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer text-sm ${
                  editor.isActive('heading', { level: 2 })
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                H2
              </button>
              <button
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={`px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer text-sm ${
                  editor.isActive('bulletList')
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                • List
              </button>
              <button
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                className={`px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer text-sm ${
                  editor.isActive('blockquote')
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                " Quote
              </button>
              <div className="border-l border-gray-300 dark:border-gray-600 mx-1" />
              <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().chain().focus().undo().run()}
                className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded cursor-pointer text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ↶ Undo
              </button>
              <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().chain().focus().redo().run()}
                className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded cursor-pointer text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ↷ Redo
              </button>
            </div>
          )}

          {/* Editor Content */}
          <div className="px-5 max-w-3xl mx-auto prose dark:prose-invert prose-gray">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    )
  }