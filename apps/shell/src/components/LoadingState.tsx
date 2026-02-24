/**
 * Loading State Components
 *
 * Reusable loading indicators and skeleton screens
 */

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  }

  return (
    <div className={`animate-spin rounded-full border-b-2 border-blue-600 dark:border-blue-400 ${sizeClasses[size]}`} />
  )
}

export function SkeletonCard() {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-1 h-12 bg-gray-100 dark:bg-gray-700 rounded" />
        <div className="flex-1">
          <div className="h-5 bg-gray-100 dark:bg-gray-700 rounded w-3/4 mb-2" />
          <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-1/2 mb-3" />
          <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/4" />
        </div>
      </div>
    </div>
  )
}

export function SkeletonPanel() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
      <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded w-1/3 mb-6" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardLoadingState() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header skeleton */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between animate-pulse">
            <div>
              <div className="h-8 bg-gray-100 dark:bg-gray-700 rounded w-32 mb-2" />
              <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-48" />
            </div>
            <div className="flex gap-4">
              <div className="h-10 bg-gray-100 dark:bg-gray-700 rounded w-28" />
              <div className="h-10 bg-gray-100 dark:bg-gray-700 rounded-full w-10" />
            </div>
          </div>

          {/* Stats skeleton */}
          <div className="mt-6 grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-4 animate-pulse">
                <div className="h-8 bg-gray-100 dark:bg-gray-600 rounded w-12 mb-2" />
                <div className="h-4 bg-gray-100 dark:bg-gray-600 rounded w-24" />
              </div>
            ))}
          </div>

          {/* Search skeleton */}
          <div className="mt-6 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        </div>
      </header>

      {/* Content skeleton */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
              <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded w-1/4 mb-4" />
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            </div>
          </div>
          <div className="lg:col-span-1">
            <SkeletonPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
