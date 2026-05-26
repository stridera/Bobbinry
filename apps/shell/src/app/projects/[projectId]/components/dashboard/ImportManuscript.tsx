'use client'

import { useState } from 'react'
import { ImportWizard } from './import/ImportWizard'

interface ImportManuscriptProps {
  projectId: string
  onImportComplete?: () => void
}

const SUPPORTED_FORMATS_HINT = '.txt, .md, .docx — .epub, .pdf, .odt, .rtf, .html coming soon'

export function ImportManuscript({ projectId, onImportComplete }: ImportManuscriptProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                Import
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Bring an existing manuscript into Bobbinry as chapters.
              </p>
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Supported: {SUPPORTED_FORMATS_HINT}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(true)}
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import manuscript
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <ImportWizard
          projectId={projectId}
          onClose={() => setIsOpen(false)}
          onComplete={() => {
            setIsOpen(false)
            onImportComplete?.()
          }}
        />
      )}
    </>
  )
}
