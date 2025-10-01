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
export default function EditorView({ sdk, projectId }: EditorViewProps) {
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
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene) return

    try {
      // Fetch fresh data from API
      const entity = await sdk.entities.get('scenes', sceneId)
      const sceneData = entity.data as any

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

  function handleSceneChange(sceneId: string) {
    // Save current scene before switching
    if (saveStatus === 'unsaved' && selectedSceneId) {
      saveScene()
    }
    setSelectedSceneId(sceneId)
  }

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div>Loading editor...</div>
      </div>
    )
  }

  if (scenes.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <div style={{ marginBottom: '12px' }}>No scenes available</div>
        <div style={{ fontSize: '14px' }}>Create chapters and scenes from the outline view</div>
      </div>
    )
  }

  const currentScene = scenes.find(s => s.id === selectedSceneId)
  const currentChapter = chapters.find(c => c.id === currentScene?.chapterId)

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      {/* Scene Navigation Sidebar */}
      <div
        style={{
          width: '250px',
          borderRight: '1px solid #e0e0e0',
          overflowY: 'auto',
          backgroundColor: '#fafafa'
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid #e0e0e0' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#666' }}>
            SCENES
          </h3>
        </div>
        {chapters.map(chapter => {
          const chapterScenes = scenes.filter(s => s.chapterId === chapter.id)
          if (chapterScenes.length === 0) return null

          return (
            <div key={chapter.id}>
              <div
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: '#444',
                  backgroundColor: '#f0f0f0',
                  borderBottom: '1px solid #e0e0e0'
                }}
              >
                {chapter.title}
              </div>
              {chapterScenes.map(scene => (
                <div
                  key={scene.id}
                  onClick={() => handleSceneChange(scene.id)}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    backgroundColor: selectedSceneId === scene.id ? '#e3f2fd' : 'transparent',
                    borderLeft: selectedSceneId === scene.id ? '3px solid #2196f3' : '3px solid transparent',
                    fontSize: '14px'
                  }}
                >
                  <div style={{ fontWeight: selectedSceneId === scene.id ? '600' : '400' }}>
                    {scene.title}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {scene.wordCount} words
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Editor Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            borderBottom: '1px solid #e0e0e0',
            padding: '16px 20px',
            backgroundColor: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ flex: 1, marginRight: '20px' }}>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
              {currentChapter?.title || 'Unknown Chapter'}
            </div>
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder="Scene Title"
              style={{
                width: '100%',
                border: 'none',
                backgroundColor: 'transparent',
                fontSize: '20px',
                fontWeight: '600',
                outline: 'none',
                padding: '4px 0'
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '14px' }}>
            <span style={{ color: '#666' }}>{wordCount} words</span>
            <span
              style={{
                color: saveStatus === 'saved' ? '#4caf50' : saveStatus === 'saving' ? '#ff9800' : '#666'
              }}
            >
              {saveStatus === 'saved' && '✓ Saved'}
              {saveStatus === 'saving' && 'Saving...'}
              {saveStatus === 'unsaved' && '• Unsaved'}
            </span>
            <button
              onClick={saveScene}
              disabled={saving || saveStatus === 'saved'}
              style={{
                padding: '6px 12px',
                backgroundColor: saveStatus === 'saved' ? '#e0e0e0' : '#2196f3',
                color: saveStatus === 'saved' ? '#999' : 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: saveStatus === 'saved' ? 'default' : 'pointer',
                fontSize: '14px'
              }}
            >
              Save Now
            </button>
          </div>
        </div>

        {/* Rich Text Editor */}
        <div style={{ flex: 1, overflow: 'auto', backgroundColor: '#fff' }}>
          {/* Toolbar */}
          {editor && (
            <div
              style={{
                padding: '8px 20px',
                borderBottom: '1px solid #e0e0e0',
                display: 'flex',
                gap: '4px',
                flexWrap: 'wrap'
              }}
            >
              <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                disabled={!editor.can().chain().focus().toggleBold().run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: editor.isActive('bold') ? '#e3f2fd' : 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600'
                }}
              >
                B
              </button>
              <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                disabled={!editor.can().chain().focus().toggleItalic().run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: editor.isActive('italic') ? '#e3f2fd' : 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontStyle: 'italic'
                }}
              >
                I
              </button>
              <button
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: editor.isActive('heading', { level: 1 }) ? '#e3f2fd' : 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                H1
              </button>
              <button
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: editor.isActive('heading', { level: 2 }) ? '#e3f2fd' : 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                H2
              </button>
              <button
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: editor.isActive('bulletList') ? '#e3f2fd' : 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                • List
              </button>
              <button
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: editor.isActive('blockquote') ? '#e3f2fd' : 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                " Quote
              </button>
              <div style={{ borderLeft: '1px solid #ddd', margin: '0 4px' }} />
              <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().chain().focus().undo().run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                ↶ Undo
              </button>
              <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().chain().focus().redo().run()}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #ddd',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                ↷ Redo
              </button>
            </div>
          )}

          {/* Editor Content */}
          <div style={{ padding: '0 20px', maxWidth: '800px', margin: '0 auto' }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}