/** Draft / Live (+ Private or Unlisted) pill shown beside a project's name. */
export function StatusBadge({ isLive, visibility }: { isLive: boolean; visibility?: string | undefined }) {
  if (!isLive) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
        Draft
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
        Live
      </span>
      {visibility === 'private' && (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          Private
        </span>
      )}
      {visibility === 'unlisted' && (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Unlisted
        </span>
      )}
    </span>
  )
}
