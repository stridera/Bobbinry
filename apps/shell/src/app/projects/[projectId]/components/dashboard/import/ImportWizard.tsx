'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface ImportWizardProps {
  projectId: string
  onClose: () => void
  onComplete: () => void
}

interface Segment {
  tempId: string
  suggestedTitle: string
  html: string
  wordCount: number
  firstLine: string
}

interface Warning {
  code: string
  message: string
}

interface ContainerOption {
  id: string
  title: string
  type: string
}

type Phase =
  | { kind: 'pick' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'parsing' }
  | { kind: 'preview'; segments: Segment[]; warnings: Warning[]; sourceFormat: string }
  | { kind: 'committing' }
  | { kind: 'done'; createdCount: number }
  | { kind: 'error'; message: string; retryTo: 'pick' | 'preview' }

const ACCEPT_ATTR = [
  '.txt', '.md', '.markdown',
  '.html', '.htm',
  '.docx', '.epub', '.pdf', '.odt', '.rtf',
  'text/plain',
  'text/markdown',
  'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/epub+zip',
  'application/pdf',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
].join(',')

const MAX_FILE_BYTES = 25 * 1024 * 1024 // matches free-tier server cap

function detectMime(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'txt': return 'text/plain'
    case 'md':
    case 'markdown': return 'text/markdown'
    case 'html':
    case 'htm': return 'text/html'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'epub': return 'application/epub+zip'
    case 'pdf': return 'application/pdf'
    case 'odt': return 'application/vnd.oasis.opendocument.text'
    case 'rtf': return 'application/rtf'
    default: return 'application/octet-stream'
  }
}

function putWithProgress(url: string, file: File, contentType: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed with status ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Upload failed: network error'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    xhr.send(file)
  })
}

export function ImportWizard({ projectId, onClose, onComplete }: ImportWizardProps) {
  const { data: session } = useSession()
  const apiToken = session?.apiToken
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const [editedSegments, setEditedSegments] = useState<Segment[]>([])
  const [containers, setContainers] = useState<ContainerOption[]>([])
  const [containerId, setContainerId] = useState<string>('')
  const [containersLoading, setContainersLoading] = useState(false)

  const loadContainers = useCallback(async () => {
    if (!apiToken) return
    setContainersLoading(true)
    try {
      const res = await apiFetch(`/api/collections/containers/entities?projectId=${projectId}&limit=500`, apiToken)
      const data = await res.json()
      const list: ContainerOption[] = (data.entities ?? []).map((e: { id: string; title?: string; type?: string }) => ({
        id: e.id,
        title: e.title || 'Untitled container',
        type: e.type || 'folder',
      }))
      setContainers(list)
      if (list.length > 0) setContainerId(prev => prev || list[0]!.id)
    } catch {
      setContainers([])
    } finally {
      setContainersLoading(false)
    }
  }, [apiToken, projectId])

  useEffect(() => {
    if (phase.kind === 'preview') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch when entering preview
      loadContainers()
    }
  }, [phase.kind, loadContainers])

  const handleFile = useCallback(async (file: File) => {
    if (!apiToken) {
      setPhase({ kind: 'error', message: 'You are not signed in', retryTo: 'pick' })
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      setPhase({
        kind: 'error',
        message: `File is ${mb} MB — limit is 25 MB on the free tier.`,
        retryTo: 'pick',
      })
      return
    }

    const contentType = detectMime(file)
    setPhase({ kind: 'uploading', percent: 0 })

    try {
      const presignRes = await apiFetch('/api/uploads/presign', apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType,
          size: file.size,
          context: 'import',
          projectId,
        }),
      })
      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({ error: 'Presign failed' }))
        throw new Error(err.error || 'Upload could not start')
      }
      const { uploadUrl, fileKey } = await presignRes.json()

      await putWithProgress(uploadUrl, file, contentType, (p) => {
        setPhase({ kind: 'uploading', percent: p })
      })

      const confirmRes = await apiFetch('/api/uploads/confirm', apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileKey,
          filename: file.name,
          contentType,
          size: file.size,
          context: 'import',
          projectId,
        }),
      })
      if (!confirmRes.ok) {
        const err = await confirmRes.json().catch(() => ({ error: 'Confirm failed' }))
        throw new Error(err.error || 'Upload could not finalize')
      }

      setPhase({ kind: 'parsing' })

      const parseRes = await apiFetch('/api/import/parse', apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey, projectId }),
      })
      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({ error: 'Parse failed' }))
        throw new Error(err.error || `Parsing failed (${parseRes.status})`)
      }
      const parseData = await parseRes.json()
      const segments: Segment[] = parseData.segments ?? []
      const warnings: Warning[] = parseData.warnings ?? []

      if (segments.length === 0) {
        throw new Error('No chapters were detected in this file.')
      }

      setEditedSegments(segments)
      setPhase({
        kind: 'preview',
        segments,
        warnings,
        sourceFormat: parseData.sourceFormat ?? 'unknown',
      })
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Import failed',
        retryTo: 'pick',
      })
    }
  }, [apiToken, projectId])

  const renameSegment = (tempId: string, title: string) => {
    setEditedSegments(prev => prev.map(s => s.tempId === tempId ? { ...s, suggestedTitle: title } : s))
  }

  const discardSegment = (tempId: string) => {
    setEditedSegments(prev => prev.filter(s => s.tempId !== tempId))
  }

  const mergeWithNext = (tempId: string) => {
    setEditedSegments(prev => {
      const idx = prev.findIndex(s => s.tempId === tempId)
      if (idx === -1 || idx === prev.length - 1) return prev
      const a = prev[idx]!
      const b = prev[idx + 1]!
      const merged: Segment = {
        tempId: a.tempId,
        suggestedTitle: a.suggestedTitle,
        html: `${a.html}\n${b.html}`,
        wordCount: a.wordCount + b.wordCount,
        firstLine: a.firstLine,
      }
      return [...prev.slice(0, idx), merged, ...prev.slice(idx + 2)]
    })
  }

  const move = (tempId: string, dir: -1 | 1) => {
    setEditedSegments(prev => {
      const idx = prev.findIndex(s => s.tempId === tempId)
      const target = idx + dir
      if (idx === -1 || target < 0 || target >= prev.length) return prev
      const copy = prev.slice()
      ;[copy[idx], copy[target]] = [copy[target]!, copy[idx]!]
      return copy
    })
  }

  const commit = async () => {
    if (!apiToken) return
    if (!containerId) {
      setPhase({ kind: 'error', message: 'Pick a container before committing', retryTo: 'preview' })
      return
    }
    if (editedSegments.length === 0) {
      setPhase({ kind: 'error', message: 'No segments left to commit', retryTo: 'preview' })
      return
    }

    setPhase({ kind: 'committing' })

    try {
      const res = await apiFetch('/api/import/commit', apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          containerId,
          segments: editedSegments.map(s => ({
            title: s.suggestedTitle.trim() || 'Untitled chapter',
            html: s.html,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Commit failed' }))
        throw new Error(err.error || `Commit failed (${res.status})`)
      }
      const data = await res.json()
      const createdCount = (data.entities ?? []).length
      setPhase({ kind: 'done', createdCount })
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Commit failed',
        retryTo: 'preview',
      })
    }
  }

  const totalWords = useMemo(
    () => editedSegments.reduce((sum, s) => sum + s.wordCount, 0),
    [editedSegments]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
              Import manuscript
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {phase.kind === 'pick' && 'Choose a file to import'}
              {phase.kind === 'uploading' && 'Uploading source file…'}
              {phase.kind === 'parsing' && 'Splitting into chapters…'}
              {phase.kind === 'preview' && `${editedSegments.length} chapters detected · ${totalWords.toLocaleString()} words`}
              {phase.kind === 'committing' && 'Saving chapters…'}
              {phase.kind === 'done' && `Imported ${phase.createdCount} chapter${phase.createdCount === 1 ? '' : 's'}`}
              {phase.kind === 'error' && 'Something went wrong'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={phase.kind === 'uploading' || phase.kind === 'parsing' || phase.kind === 'committing'}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {phase.kind === 'pick' && (
            <PickStep onPickFile={handleFile} />
          )}

          {phase.kind === 'uploading' && (
            <LoadingStep
              title="Uploading…"
              hint={`${phase.percent}%`}
              progress={phase.percent}
            />
          )}

          {phase.kind === 'parsing' && (
            <LoadingStep title="Parsing your manuscript…" hint="This usually takes a few seconds." />
          )}

          {phase.kind === 'preview' && (
            <PreviewStep
              segments={editedSegments}
              warnings={phase.warnings}
              sourceFormat={phase.sourceFormat}
              containers={containers}
              containersLoading={containersLoading}
              containerId={containerId}
              setContainerId={setContainerId}
              onRename={renameSegment}
              onDiscard={discardSegment}
              onMergeNext={mergeWithNext}
              onMove={move}
            />
          )}

          {phase.kind === 'committing' && (
            <LoadingStep title="Saving chapters…" hint="Almost done." />
          )}

          {phase.kind === 'done' && (
            <DoneStep count={phase.createdCount} />
          )}

          {phase.kind === 'error' && (
            <ErrorStep
              message={phase.message}
              onRetry={() => {
                if (phase.retryTo === 'preview' && editedSegments.length > 0) {
                  setPhase({ kind: 'preview', segments: editedSegments, warnings: [], sourceFormat: 'unknown' })
                } else {
                  setPhase({ kind: 'pick' })
                  setEditedSegments([])
                }
              }}
            />
          )}
        </div>

        {/* Footer */}
        {(phase.kind === 'preview' || phase.kind === 'done') && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            {phase.kind === 'preview' && (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={commit}
                  disabled={editedSegments.length === 0 || !containerId}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Import {editedSegments.length} chapter{editedSegments.length === 1 ? '' : 's'}
                </button>
              </>
            )}
            {phase.kind === 'done' && (
              <button
                onClick={onComplete}
                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Sub-step components ----------

function PickStep({ onPickFile }: { onPickFile: (file: File) => void }) {
  return (
    <div className="text-center py-10">
      <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-1">
        Choose a manuscript file
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-md mx-auto">
        Currently supported: <code className="font-mono text-xs">.txt</code>,{' '}
        <code className="font-mono text-xs">.md</code>,{' '}
        <code className="font-mono text-xs">.docx</code>,{' '}
        <code className="font-mono text-xs">.epub</code>,{' '}
        <code className="font-mono text-xs">.odt</code>,{' '}
        <code className="font-mono text-xs">.rtf</code>, and{' '}
        <code className="font-mono text-xs">.pdf</code>. HTML lands later.
      </p>

      <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors cursor-pointer">
        Choose file…
        <input
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onPickFile(file)
          }}
        />
      </label>
      <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
        Up to 25 MB on the free tier · 50 MB for supporters
      </p>
    </div>
  )
}

function LoadingStep({ title, hint, progress }: { title: string; hint?: string; progress?: number }) {
  return (
    <div className="text-center py-12">
      <svg className="w-10 h-10 mx-auto animate-spin text-blue-600 dark:text-blue-400 mb-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
      {hint && <p className="text-sm text-gray-500 dark:text-gray-400">{hint}</p>}
      {typeof progress === 'number' && (
        <div className="mt-4 max-w-xs mx-auto h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}

interface PreviewStepProps {
  segments: Segment[]
  warnings: Warning[]
  sourceFormat: string
  containers: ContainerOption[]
  containersLoading: boolean
  containerId: string
  setContainerId: (id: string) => void
  onRename: (tempId: string, title: string) => void
  onDiscard: (tempId: string) => void
  onMergeNext: (tempId: string) => void
  onMove: (tempId: string, dir: -1 | 1) => void
}

function PreviewStep({
  segments, warnings, sourceFormat,
  containers, containersLoading, containerId, setContainerId,
  onRename, onDiscard, onMergeNext, onMove,
}: PreviewStepProps) {
  return (
    <div className="space-y-4">
      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-800 dark:text-amber-300">
              <span className="font-medium">Note:</span> {w.message}
            </p>
          ))}
        </div>
      )}

      {/* Container picker */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
          Add to container:
        </label>
        <select
          value={containerId}
          onChange={(e) => setContainerId(e.target.value)}
          disabled={containersLoading || containers.length === 0}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-50 cursor-pointer"
        >
          {containersLoading && <option>Loading containers…</option>}
          {!containersLoading && containers.length === 0 && (
            <option value="">No containers — create one in the manuscript outline first</option>
          )}
          {containers.map(c => (
            <option key={c.id} value={c.id}>{c.title} ({c.type})</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Detected format: <code className="font-mono">{sourceFormat}</code>. Rename, reorder,
        merge with next, or discard any chapter before importing.
      </p>

      {/* Segments */}
      <ul className="space-y-2">
        {segments.map((s, idx) => (
          <li
            key={s.tempId}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 p-3"
          >
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => onMove(s.tempId, -1)}
                  disabled={idx === 0}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer p-0.5"
                  aria-label="Move up"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => onMove(s.tempId, 1)}
                  disabled={idx === segments.length - 1}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer p-0.5"
                  aria-label="Move down"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <input
                  value={s.suggestedTitle}
                  onChange={(e) => onRename(s.tempId, e.target.value)}
                  className="w-full px-2 py-1 text-sm font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100"
                />
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                  <span>{s.wordCount.toLocaleString()} words</span>
                  {s.firstLine && (
                    <span className="truncate italic">“{s.firstLine}”</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <button
                  onClick={() => onMergeNext(s.tempId)}
                  disabled={idx === segments.length - 1}
                  className="text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer px-2 py-1"
                  title="Merge with next chapter"
                >
                  Merge ↓
                </button>
                <button
                  onClick={() => onDiscard(s.tempId)}
                  className="text-xs text-gray-500 hover:text-red-600 dark:hover:text-red-400 cursor-pointer px-2 py-1"
                  title="Discard this chapter"
                >
                  Discard
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DoneStep({ count }: { count: number }) {
  return (
    <div className="text-center py-12">
      <svg className="w-12 h-12 mx-auto text-green-600 dark:text-green-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-1">
        {count} chapter{count === 1 ? '' : 's'} imported
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Open the manuscript outline to find the new chapters.
      </p>
    </div>
  )
}

function ErrorStep({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-10">
      <svg className="w-10 h-10 mx-auto text-red-500 dark:text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-1">
        Import failed
      </h3>
      <p className="text-sm text-red-600 dark:text-red-400 mb-4 max-w-md mx-auto">
        {message}
      </p>
      <button
        onClick={onRetry}
        className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg transition-colors cursor-pointer"
      >
        Try again
      </button>
    </div>
  )
}
