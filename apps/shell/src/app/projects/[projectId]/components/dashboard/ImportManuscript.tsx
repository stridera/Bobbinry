'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { ImportWizard } from './import/ImportWizard'

interface ImportManuscriptProps {
  projectId: string
  onImportComplete?: () => void
}

const SUPPORTED_FORMATS_HINT = '.txt, .md, .docx, .epub, .odt, .rtf, .pdf — .html coming soon'

export function ImportManuscript({ projectId, onImportComplete }: ImportManuscriptProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { data: session } = useSession()
  const { registerManifestExtensions } = useManifestExtensions()
  const [sdk] = useState(() => new BobbinrySDK('import-wizard'))

  // The dashboard page doesn't load bobbin manifests into the extension
  // registry (only the editor pages do), so register them when the wizard
  // opens — that's what populates the shell.importSource slot. Registration
  // is idempotent; bobbins already registered by another page are skipped.
  useEffect(() => {
    if (!isOpen || !session?.apiToken) return
    sdk.api.setAuthToken(session.apiToken)
    sdk.setProject(projectId)
    sdk.api.getInstalledBobbins(projectId)
      .then((response: { bobbins?: Array<{ id: string; manifest: unknown }> }) => {
        for (const bobbin of response.bobbins || []) {
          registerManifestExtensions(bobbin.id, bobbin.manifest)
        }
      })
      .catch((error: unknown) => {
        console.error('[ImportManuscript] Failed to load bobbins for import sources:', error)
      })
  }, [isOpen, session?.apiToken, projectId, sdk, registerManifestExtensions])

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
          sdk={sdk}
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
