'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface ExportProjectProps {
  projectId: string
  projectName: string
  totalChapters: number
}

type ExportFormat = 'pdf' | 'epub' | 'markdown' | 'txt'
type ExportMode = 'full' | 'chapters'

interface FormatOption {
  id: ExportFormat
  name: string
  description: string
  icon: React.ReactNode
  extension: string
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: 'pdf',
    name: 'PDF',
    description: 'Print-ready document with chapter headings and page breaks',
    extension: '.pdf',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  {
    id: 'epub',
    name: 'EPUB',
    description: 'Standard ebook format for Kindle, Apple Books, and e-readers',
    extension: '.epub',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    id: 'markdown',
    name: 'Markdown',
    description: 'Portable markup format for other writing tools or version control',
    extension: '.md',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
  {
    id: 'txt',
    name: 'Plain Text',
    description: 'Universal format — no formatting, just words',
    extension: '.txt',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

export function ExportProject({ projectId, projectName, totalChapters }: ExportProjectProps) {
  const { data: session } = useSession()
  const [mode, setMode] = useState<ExportMode>('full')
  const [downloading, setDownloading] = useState<ExportFormat | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleExport = async (format: ExportFormat) => {
    if (!session?.apiToken || downloading) return

    setDownloading(format)
    setMessage(null)

    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/export/${format}?mode=${mode}`,
        session.apiToken
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Export failed' }))
        throw new Error(err.error || `Export failed (${response.status})`)
      }

      // Get filename from Content-Disposition header or construct one
      const disposition = response.headers.get('Content-Disposition')
      let filename = `${projectName || 'export'}`
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/)
        if (match?.[1]) filename = match[1]
      } else {
        const fmt = FORMAT_OPTIONS.find((f) => f.id === format)
        const ext = mode === 'chapters' ? '.zip' : (fmt?.extension || '.bin')
        filename = `${filename}${ext}`
      }

      // Download via blob URL
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setMessage({ type: 'success', text: `Downloaded ${filename}` })
      setTimeout(() => setMessage(null), 4000)
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Export failed',
      })
    } finally {
      setDownloading(null)
    }
  }

  const hasContent = totalChapters > 0

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
              Export
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {hasContent
                ? `Download your manuscript in multiple formats (${totalChapters} chapter${totalChapters === 1 ? '' : 's'})`
                : 'Add chapters to your manuscript to enable export'}
            </p>
          </div>
        </div>

        {hasContent && (
          <>
            {/* Mode toggle */}
            <div className="mt-5 flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-900/50 rounded-lg w-fit">
              <button
                onClick={() => setMode('full')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  mode === 'full'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Complete manuscript
              </button>
              <button
                onClick={() => setMode('chapters')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  mode === 'chapters'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Individual chapters (ZIP)
              </button>
            </div>

            {/* Format grid */}
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {FORMAT_OPTIONS.map((fmt) => {
                const isActive = downloading === fmt.id
                return (
                  <button
                    key={fmt.id}
                    onClick={() => handleExport(fmt.id)}
                    disabled={!!downloading}
                    className={`group relative flex items-start gap-4 rounded-lg border p-4 text-left transition-all cursor-pointer ${
                      isActive
                        ? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10'
                        : 'border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/30 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900/50'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <div
                      className={`flex-shrink-0 mt-0.5 ${
                        isActive
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300'
                      } transition-colors`}
                    >
                      {isActive ? (
                        <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      ) : (
                        fmt.icon
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                          {fmt.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200/80 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-mono">
                          {mode === 'chapters' ? '.zip' : fmt.extension}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        {fmt.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Status message */}
            {message && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  message.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                {message.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
