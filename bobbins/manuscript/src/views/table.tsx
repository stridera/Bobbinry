import { useState, useEffect, useCallback } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { Toast, ToastContainer } from '@bobbinry/ui-components'

interface TableViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
}

interface Row {
  id: string
  title: string
  synopsis: string
  order: number
  wordCount: number
  status: string
  type: string
  version?: number
  originalTitle: string
  originalSynopsis: string
}

type ToastState = { message: string; variant: 'success' | 'danger' | 'info' } | null

/**
 * Table View for Manuscript bobbin
 * Flat, editable spreadsheet of all chapters/scenes under a container (or the
 * whole project, when at ROOT). Title and synopsis are inline-editable with
 * per-cell auto-save on blur.
 */
export default function TableView({ sdk, entityId }: TableViewProps) {
  const [containerTitle, setContainerTitle] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState>(null)

  const isRoot = entityId === 'ROOT'

  const loadData = useCallback(async () => {
    if (!sdk || !entityId) return
    setLoading(true)
    try {
      const [containersRes, contentRes] = await Promise.all([
        sdk.entities.query({ collection: 'containers', limit: 1000 }),
        sdk.entities.query({ collection: 'content', limit: 1000 })
      ])

      const allContainers = (containersRes.data || []) as any[]
      const allContent = (contentRes.data || []) as any[]

      let scopedContent: any[]
      if (isRoot) {
        scopedContent = allContent
        setContainerTitle('Manuscript')
      } else {
        try {
          const container = await sdk.entities.get('containers', entityId) as any
          setContainerTitle(container?.title || 'Container')
        } catch {
          setContainerTitle('Container')
        }

        // Resolve every descendant container transitively.
        const descendants = new Set<string>([entityId])
        let changed = true
        while (changed) {
          changed = false
          for (const c of allContainers) {
            const pid = c.parent_id || c.parentId
            if (pid && descendants.has(pid) && !descendants.has(c.id)) {
              descendants.add(c.id)
              changed = true
            }
          }
        }

        scopedContent = allContent.filter((c: any) => {
          const cid = c.container_id || c.containerId
          return cid && descendants.has(cid)
        })
      }

      const sorted = scopedContent.sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      const next: Row[] = sorted.map((c: any) => ({
        id: c.id,
        title: c.title || '',
        synopsis: c.synopsis || '',
        order: c.order || 0,
        wordCount: getWordCount(c),
        status: c.status || 'draft',
        type: c.type || 'scene',
        version: c._meta?.version ?? c.version,
        originalTitle: c.title || '',
        originalSynopsis: c.synopsis || '',
      }))
      setRows(next)
    } catch (e) {
      console.error('[TableView] Failed to load:', e)
      setToast({ message: 'Failed to load chapters', variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [sdk, entityId, isRoot])

  useEffect(() => {
    if (!entityId) {
      setLoading(false)
      return
    }
    void loadData()
  }, [entityId, loadData])

  // Reflect external title/synopsis changes (rename from the navigation tree,
  // edits from the editor, etc.) without a full reload.
  useEffect(() => {
    function handleEntityUpdated(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.entityId) return
      const changes = detail.changes || {}
      if (changes.title === undefined && changes.synopsis === undefined) return

      setRows(prev => prev.map(r => {
        if (r.id !== detail.entityId) return r
        const next = { ...r }
        if (typeof changes.title === 'string') {
          next.title = changes.title
          next.originalTitle = changes.title
        }
        if (typeof changes.synopsis === 'string') {
          next.synopsis = changes.synopsis
          next.originalSynopsis = changes.synopsis
        }
        return next
      }))
    }
    window.addEventListener('bobbinry:entity-updated', handleEntityUpdated)
    return () => window.removeEventListener('bobbinry:entity-updated', handleEntityUpdated)
  }, [])

  const setRowField = useCallback((id: string, field: 'title' | 'synopsis', value: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }, [])

  const saveField = useCallback(async (row: Row, field: 'title' | 'synopsis') => {
    const current = field === 'title' ? row.title : row.synopsis
    const original = field === 'title' ? row.originalTitle : row.originalSynopsis
    const trimmed = current.trim()

    // Reject empty title — fall back to the previously-saved value.
    if (field === 'title' && !trimmed) {
      if (current !== original) setRowField(row.id, 'title', original)
      return
    }

    if (trimmed === original) {
      if (trimmed !== current) setRowField(row.id, field, trimmed)
      return
    }

    const key = `${row.id}:${field}`
    setSaving(prev => {
      const next = new Set(prev)
      next.add(key)
      return next
    })

    try {
      const result = await sdk.entities.update('content', row.id, {
        [field]: trimmed,
        updated_at: new Date().toISOString()
      }) as any

      const newVersion = result?._meta?.version

      setRows(prev => prev.map(r => {
        if (r.id !== row.id) return r
        const next = { ...r, [field]: trimmed }
        if (field === 'title') next.originalTitle = trimmed
        else next.originalSynopsis = trimmed
        if (typeof newVersion === 'number') next.version = newVersion
        return next
      }))

      // Same event payloads as navigation.tsx so the nav tree + any open editor
      // pick up the change without a full reload.
      if (typeof newVersion === 'number') {
        window.dispatchEvent(new CustomEvent('bobbinry:entity-version-changed', {
          detail: { entityId: row.id, version: newVersion }
        }))
      }
      window.dispatchEvent(new CustomEvent('bobbinry:entity-updated', {
        detail: { collection: 'content', entityId: row.id, changes: { [field]: trimmed } }
      }))
    } catch (e) {
      console.error('[TableView] Save failed:', e)
      const msg = e instanceof Error ? e.message : 'Save failed'
      setRowField(row.id, field, original)
      setToast({ message: `Failed to save: ${msg}`, variant: 'danger' })
    } finally {
      setSaving(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [sdk, setRowField])

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!entityId) {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        Select a folder from the navigation panel to view its contents.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{containerTitle}</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {rows.length} {rows.length === 1 ? 'chapter' : 'chapters'}
          {rows.length > 0 && ' · click any cell to edit · Tab between cells · Esc to cancel'}
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>No chapters in this section.</p>
            <p className="text-sm mt-2">Add chapters from the navigation panel.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-10">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-1/4">Title</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Synopsis</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-20">Words</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-24">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <TableRowItem
                  key={row.id}
                  index={i + 1}
                  row={row}
                  saving={saving}
                  setRowField={setRowField}
                  saveField={saveField}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <ToastContainer position="bottom-right">
          <Toast
            message={toast.message}
            variant={toast.variant}
            duration={4000}
            dismissible
            onDismiss={() => setToast(null)}
          />
        </ToastContainer>
      )}
    </div>
  )
}

interface TableRowItemProps {
  index: number
  row: Row
  saving: Set<string>
  setRowField: (id: string, field: 'title' | 'synopsis', value: string) => void
  saveField: (row: Row, field: 'title' | 'synopsis') => void | Promise<void>
}

function TableRowItem({ index, row, saving, setRowField, saveField }: TableRowItemProps) {
  const titleSaving = saving.has(`${row.id}:title`)
  const synopsisSaving = saving.has(`${row.id}:synopsis`)

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    field: 'title' | 'synopsis'
  ) {
    if (e.key === 'Escape') {
      const original = field === 'title' ? row.originalTitle : row.originalSynopsis
      setRowField(row.id, field, original)
      ;(e.currentTarget as HTMLElement).blur()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).blur()
    }
  }

  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60 dark:hover:bg-gray-800/30">
      <td className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 align-top tabular-nums">{index}</td>
      <td className="px-2 py-1 align-top">
        <div className="relative">
          <input
            type="text"
            value={row.title}
            onChange={(e) => setRowField(row.id, 'title', e.target.value)}
            onBlur={() => saveField(row, 'title')}
            onKeyDown={(e) => handleKeyDown(e, 'title')}
            placeholder="Untitled"
            className="w-full px-2 py-1 text-sm font-medium bg-transparent border border-transparent rounded hover:border-gray-200 dark:hover:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none text-gray-900 dark:text-gray-100"
          />
          {titleSaving && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-blue-500 pointer-events-none">
              Saving…
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1 align-top">
        <div className="relative">
          <textarea
            rows={2}
            value={row.synopsis}
            onChange={(e) => setRowField(row.id, 'synopsis', e.target.value)}
            onBlur={() => saveField(row, 'synopsis')}
            onKeyDown={(e) => handleKeyDown(e, 'synopsis')}
            placeholder="Add synopsis…"
            maxLength={300}
            className="w-full px-2 py-1 text-xs bg-transparent border border-transparent rounded resize-y hover:border-gray-200 dark:hover:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none text-gray-600 dark:text-gray-400 placeholder:text-gray-300 dark:placeholder:text-gray-600"
          />
          {synopsisSaving && (
            <span className="absolute right-1.5 top-1 text-[10px] text-blue-500 pointer-events-none">
              Saving…
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 align-top tabular-nums">
        {row.wordCount > 0 ? row.wordCount.toLocaleString() : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 capitalize align-top">
        {row.status}
      </td>
    </tr>
  )
}

function getWordCount(item: any): number {
  const wc = item.word_count ?? item.wordCount ?? 0
  return typeof wc === 'string' ? parseInt(wc, 10) || 0 : Number(wc) || 0
}
