'use client'

import { useState, useEffect } from 'react'

interface BobbinInfo {
  id: string
  name: string
  description: string
  version: string
  manifestPath: string
  installed: boolean
}

interface BobbinMarketplaceProps {
  projectId: string
  installedBobbins: Array<{ id: string }>
  onInstallComplete?: () => void
  onClose?: () => void
}

const AVAILABLE_BOBBINS: Omit<BobbinInfo, 'installed'>[] = [
  {
    id: 'manuscript',
    name: 'Manuscript',
    description: 'Complete writing system with books, chapters, and scenes. Includes rich text editor with formatting tools.',
    version: '1.0.0',
    manifestPath: 'bobbins/manuscript.manifest.yaml'
  },
  {
    id: 'corkboard',
    name: 'Corkboard',
    description: 'Visual organization tool with drag-and-drop cards. Perfect for plotting and scene arrangement.',
    version: '1.0.0',
    manifestPath: 'bobbins/corkboard.manifest.yaml'
  },
  {
    id: 'dictionary-panel',
    name: 'Dictionary',
    description: 'Glossary and terminology management. Define and track terms, names, and worldbuilding elements.',
    version: '1.0.0',
    manifestPath: 'bobbins/dictionary-panel.manifest.yaml'
  }
]

export function BobbinMarketplace({ projectId, installedBobbins, onInstallComplete, onClose }: BobbinMarketplaceProps) {
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bobbins, setBobbins] = useState<BobbinInfo[]>([])

  useEffect(() => {
    const installedIds = installedBobbins.map(b => b.id)
    setBobbins(
      AVAILABLE_BOBBINS.map(b => ({
        ...b,
        installed: installedIds.includes(b.id)
      }))
    )
  }, [installedBobbins])

  const handleInstall = async (bobbin: BobbinInfo) => {
    if (bobbin.installed) return

    setInstalling(bobbin.id)
    setError(null)

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}/bobbins/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manifestPath: bobbin.manifestPath
          })
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Installation failed' }))
        throw new Error(errorData.error || 'Installation failed')
      }

      // Update local state
      setBobbins(prev => prev.map(b =>
        b.id === bobbin.id ? { ...b, installed: true } : b
      ))

      // Notify parent
      if (onInstallComplete) {
        onInstallComplete()
      }
    } catch (err) {
      console.error('Failed to install bobbin:', err)
      setError(err instanceof Error ? err.message : 'Failed to install bobbin')
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Bobbin Marketplace</h2>
            <p className="text-sm text-gray-600 mt-1">Add functionality to your project</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <p className="ml-3 text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Bobbin list */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid gap-4">
            {bobbins.map((bobbin) => (
              <div
                key={bobbin.id}
                className={`
                  border-2 rounded-lg p-6 transition-all
                  ${bobbin.installed
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 bg-white hover:border-blue-300'
                  }
                `}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{bobbin.name}</h3>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        v{bobbin.version}
                      </span>
                      {bobbin.installed && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full flex items-center gap-1">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Installed
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600">{bobbin.description}</p>
                  </div>

                  <div className="ml-4">
                    <button
                      onClick={() => handleInstall(bobbin)}
                      disabled={bobbin.installed || installing === bobbin.id}
                      className={`
                        px-4 py-2 rounded-lg font-medium transition-colors
                        ${bobbin.installed
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : installing === bobbin.id
                          ? 'bg-blue-400 text-white cursor-wait'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                        }
                      `}
                    >
                      {installing === bobbin.id ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Installing...
                        </span>
                      ) : bobbin.installed ? (
                        'Installed'
                      ) : (
                        'Install'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-600">
            More bobbins coming soon! You can also create your own using the Bobbin SDK.
          </p>
        </div>
      </div>
    </div>
  )
}
