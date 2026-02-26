'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface Bobbin {
  id: string
  bobbinId: string
  version: string
  manifest: {
    name: string
    description: string
  }
}

interface ProjectManagementProps {
  projectId: string
  isArchived: boolean
  bobbins: Bobbin[]
  onArchiveChange: (isArchived: boolean) => void
  onBobbinUninstall: (bobbinId: string) => void
}

export function ProjectManagement({ projectId, isArchived, bobbins, onArchiveChange, onBobbinUninstall }: ProjectManagementProps) {
  const { data: session } = useSession()
  const [expanded, setExpanded] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    if (type === 'success') {
      setSuccess(msg)
      setError(null)
      setTimeout(() => setSuccess(null), 3000)
    } else {
      setError(msg)
      setSuccess(null)
    }
  }

  const handleArchive = async () => {
    if (!session?.apiToken) return
    if (!confirm(`Are you sure you want to ${isArchived ? 'unarchive' : 'archive'} this project?`)) return

    try {
      const endpoint = isArchived ? 'unarchive' : 'archive'
      const response = await apiFetch(`/api/projects/${projectId}/${endpoint}`, session.apiToken, { method: 'PUT' })
      if (response.ok) {
        onArchiveChange(!isArchived)
        showMessage(`Project ${isArchived ? 'unarchived' : 'archived'} successfully`, 'success')
      } else {
        throw new Error()
      }
    } catch {
      showMessage('Failed to archive/unarchive project', 'error')
    }
  }

  const handleUninstallBobbin = async (bobbinId: string) => {
    if (!session?.apiToken) return
    if (!confirm('Are you sure you want to uninstall this bobbin? Associated data will be preserved but views will be removed.')) return

    try {
      const response = await apiFetch(`/api/projects/${projectId}/bobbins/${bobbinId}`, session.apiToken, { method: 'DELETE' })
      if (response.ok) {
        onBobbinUninstall(bobbinId)
        showMessage('Bobbin uninstalled successfully', 'success')
      } else {
        throw new Error()
      }
    } catch {
      showMessage('Failed to uninstall bobbin', 'error')
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 cursor-pointer"
      >
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Project Management</h2>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-gray-100 dark:border-gray-700 pt-4 space-y-6">
          {/* Messages */}
          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Installed Bobbins */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Installed Bobbins</h3>
              {bobbins.length > 0 && (
                <a
                  href={`/projects/${projectId}/marketplace`}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  Browse Marketplace
                </a>
              )}
            </div>
            {bobbins.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">No bobbins installed yet.</p>
            ) : (
              <div className="space-y-2">
                {bobbins.map((bobbin) => (
                  <div key={bobbin.id} className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100">{bobbin.manifest.name}</h4>
                      {bobbin.manifest.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{bobbin.manifest.description}</p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">v{bobbin.version}</p>
                    </div>
                    <button
                      onClick={() => handleUninstallBobbin(bobbin.id)}
                      className="ml-3 px-3 py-1.5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-red-200 dark:border-red-800 rounded-lg hover:border-red-300 dark:hover:border-red-700 transition-colors text-xs cursor-pointer"
                    >
                      Uninstall
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Archive */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Archive Project</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {isArchived
                ? 'This project is archived. Unarchive it to make it visible in your active projects.'
                : 'Archive this project to hide it from your active projects. You can unarchive it later.'}
            </p>
            <button
              onClick={handleArchive}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isArchived
                  ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white'
                  : 'bg-gray-600 hover:bg-gray-700 text-white'
              }`}
            >
              {isArchived ? 'Unarchive Project' : 'Archive Project'}
            </button>
          </div>

          {/* Danger Zone */}
          <div className="border-2 border-red-200 dark:border-red-900 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">Danger Zone</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Once you delete a project, there is no going back. This action cannot be undone.
            </p>
            <button
              onClick={() => alert('Delete functionality not yet implemented')}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              Delete Project
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
