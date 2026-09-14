'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { ImportWizard } from './import/ImportWizard'

interface ImportManuscriptProps {
  projectId: string
  onImportComplete?: () => void
  /**
   * Renders the trigger. Receives an `open` callback so the caller controls
   * the button's look (the dashboard rail renders it as a list row).
   */
  children: (open: () => void) => ReactNode
}

/**
 * Owns the import wizard's lifecycle. Renders nothing of its own besides the
 * trigger supplied by the caller and the wizard modal while it's open.
 */
export function ImportManuscript({ projectId, onImportComplete, children }: ImportManuscriptProps) {
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
      {children(() => setIsOpen(true))}

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
