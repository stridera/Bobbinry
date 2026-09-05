/** Overlays the editor shows above the writing surface: session-expired banner and the conflict dialog. */

export function SessionExpiredBanner() {
  return (
    <div className="absolute top-0 inset-x-0 z-40 flex items-center justify-center gap-3 px-4 py-2 bg-red-50 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
      <span>
        <strong>Your session has expired.</strong> Your writing is saved on this device but isn&apos;t syncing.
      </span>
      <button
        type="button"
        onClick={() => {
          const here = window.location.pathname + window.location.search
          window.location.assign(`/login?callbackUrl=${encodeURIComponent(here)}`)
        }}
        className="px-3 py-1 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
      >
        Sign in to keep saving
      </button>
    </div>
  )
}

interface ConflictDialogProps {
  onDismiss: () => void
  onReload: () => void
  onSaveAsNew: () => void
  onOverwrite: () => void
}

export function ConflictDialog({ onDismiss, onReload, onSaveAsNew, onOverwrite }: ConflictDialogProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Editing conflict
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              This scene was edited in another session. Your local changes can&apos;t be saved without resolving this.
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 -mt-1 -mr-1 p-1"
            title="Dismiss (conflict will resurface on next save)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onReload}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
          >
            Reload server version
          </button>
          <button
            type="button"
            onClick={onSaveAsNew}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition-colors cursor-pointer"
          >
            Save as new scene
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 transition-colors cursor-pointer"
          >
            Overwrite server version
          </button>
        </div>
      </div>
    </div>
  )
}
