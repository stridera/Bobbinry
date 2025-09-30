import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

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
export default function EditorView({ sdk }: EditorViewProps) {
  const [scene, _setScene] = useState<Scene | null>(null)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [_loading, _setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [wordCount, setWordCount] = useState(0)

  // Auto-save timer
  useEffect(() => {
    if (saveStatus === 'unsaved' && scene) {
      const timer = setTimeout(() => {
        saveScene()
      }, 2000) // Auto-save after 2 seconds of inactivity

      return () => clearTimeout(timer)
    }
    return undefined
  }, [content, title, saveStatus, scene])

  // Calculate word count
  useEffect(() => {
    const words = content
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 0).length
    setWordCount(words)
  }, [content])

  // TODO: Implement scene loading when scene selection is added
  /*
  async function loadScene(sceneId: string) {
    try {
      setLoading(true)
      const entity = await sdk.entities.get('scenes', sceneId)

      const sceneData: Scene = {
        id: entity.id,
        title: entity.data.title,
        content: entity.data.content || '',
        wordCount: entity.data.word_count || 0,
        chapterId: entity.data.chapter_id
      }

      setScene(sceneData)
      setTitle(sceneData.title)
      setContent(sceneData.content)
      setSaveStatus('saved')
    } catch (error) {
      console.error('[EditorView] Failed to load scene:', error)
    } finally {
      setLoading(false)
    }
  }
  */

  async function saveScene() {
    if (!scene) return

    try {
      setSaving(true)
      setSaveStatus('saving')

      await sdk.entities.update('scenes', scene.id, {
        title,
        content,
        word_count: wordCount,
        updated_at: new Date().toISOString()
      })

      setSaveStatus('saved')
    } catch (error) {
      console.error('[EditorView] Failed to save scene:', error)
      setSaveStatus('unsaved')
    } finally {
      setSaving(false)
    }
  }

  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    setSaveStatus('unsaved')
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTitle(e.target.value)
    setSaveStatus('unsaved')
  }

  if (_loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div>Loading scene...</div>
      </div>
    )
  }

  if (!scene) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <div style={{ marginBottom: '12px' }}>No scene selected</div>
        <div style={{ fontSize: '14px' }}>Select a scene from the outline to begin writing</div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: '1px solid #e0e0e0',
          padding: '16px 20px',
          backgroundColor: '#fafafa',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div style={{ flex: 1, marginRight: '20px' }}>
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

      {/* Editor */}
      <div style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
        <textarea
          value={content}
          onChange={handleContentChange}
          placeholder="Begin writing your scene..."
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: '16px',
            lineHeight: '1.6',
            fontFamily: "'Georgia', serif"
          }}
        />
      </div>
    </div>
  )
}