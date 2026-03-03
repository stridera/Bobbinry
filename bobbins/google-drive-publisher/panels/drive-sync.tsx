'use client'

/**
 * Google Drive Sync Dashboard Panel
 *
 * Placeholder panel shown on the /publish page when a project
 * has google-drive-publisher installed. Shows sync status summary.
 */

interface DriveSyncPanelProps {
  projectId: string
  apiToken?: string
  context?: {
    projectId: string
    apiToken?: string
  }
}

export default function DriveSyncPanel(props: DriveSyncPanelProps) {
  const projectId = props.projectId || props.context?.projectId

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Google Drive Sync
        </h4>
      </div>

      <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          <span className="text-gray-500 dark:text-gray-400">Not connected</span>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Connect your Google Drive account to automatically sync chapters to a Drive folder.
        </p>
      </div>

      {projectId && (
        <button
          disabled
          className="w-full px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded transition-colors cursor-not-allowed"
          title="Requires external API egress (coming soon)"
        >
          Configure Google Drive
        </button>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
        External API connections are not yet available. This feature requires the egress proxy.
      </p>
    </div>
  )
}
