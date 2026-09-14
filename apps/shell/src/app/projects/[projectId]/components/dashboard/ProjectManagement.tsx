'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { ConfirmModal } from '@bobbinry/sdk'
import { CollapsibleCard } from './CollapsibleCard'

interface ProjectManagementProps {
  projectId: string
  isArchived: boolean
  onArchiveChange: (isArchived: boolean) => void
  onDelete?: () => void
}

type ConfirmAction =
  | { type: 'archive' }
  | { type: 'delete' }

/**
 * Archive and trash. Installed-bobbin management lives on the project's
 * Bobbins page, which already handles install and uninstall.
 */
export function ProjectManagement({ projectId, isArchived, onArchiveChange, onDelete }: ProjectManagementProps) {
  const { data: session } = useSession()
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

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

  const handleConfirm = async () => {
    if (!session?.apiToken || !confirmAction) return
    setActionLoading(true)

    try {
      switch (confirmAction.type) {
        case 'archive': {
          const endpoint = isArchived ? 'unarchive' : 'archive'
          const response = await apiFetch(`/api/projects/${projectId}/${endpoint}`, session.apiToken, { method: 'PUT' })
          if (response.ok) {
            onArchiveChange(!isArchived)
            showMessage(`Project ${isArchived ? 'unarchived' : 'archived'} successfully`, 'success')
          } else {
            throw new Error()
          }
          break
        }
        case 'delete': {
          const response = await apiFetch(`/api/projects/${projectId}`, session.apiToken, { method: 'DELETE' })
          if (response.ok || response.status === 204) {
            onDelete?.()
          } else {
            throw new Error()
          }
          break
        }
      }
    } catch {
      const messages = {
        archive: 'Failed to archive/unarchive project',
        delete: 'Failed to delete project',
      }
      showMessage(messages[confirmAction.type], 'error')
    } finally {
      setActionLoading(false)
      setConfirmAction(null)
    }
  }

  const confirmModalProps = (() => {
    if (!confirmAction) return null
    switch (confirmAction.type) {
      case 'delete':
        return {
          title: 'Move to Trash',
          description: 'This project will be moved to trash and automatically deleted after 30 days. You can restore it anytime before then.',
          confirmLabel: 'Move to Trash',
          variant: 'danger' as const,
        }
      case 'archive':
        return {
          title: isArchived ? 'Unarchive Project' : 'Archive Project',
          description: isArchived
            ? 'This will make the project visible in your active projects again.'
            : 'This will hide the project from your active projects. You can unarchive it at any time.',
          confirmLabel: isArchived ? 'Unarchive' : 'Archive',
          variant: 'warning' as const,
        }
    }
  })()

  return (
    <>
      <CollapsibleCard title="Project" id="project" collapsible={false}>
        <div className="space-y-6">
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

            {/* Bobbins */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Bobbins</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Install, update, and uninstall this project&rsquo;s bobbins on the{' '}
                <Link href={`/projects/${projectId}/bobbins`} className="text-blue-600 dark:text-blue-400 hover:underline">Bobbins page</Link>.
              </p>
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
                onClick={() => setConfirmAction({ type: 'archive' })}
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
                Move this project to trash. It can be restored within 30 days before being permanently deleted.
              </p>
              <button
                onClick={() => setConfirmAction({ type: 'delete' })}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium cursor-pointer transition-colors"
              >
                Delete Project
              </button>
            </div>
        </div>
      </CollapsibleCard>

      {confirmModalProps && (
        <ConfirmModal
          open={!!confirmAction}
          loading={actionLoading}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
          {...confirmModalProps}
        />
      )}
    </>
  )
}
