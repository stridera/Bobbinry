'use client'

interface StatsCardsProps {
  analytics: {
    totalChapters: number
    publishedChapters: number
    totalViews: number
    totalCompletions: number
    avgViewsPerChapter: number
  }
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  )
}

export function StatsCards({ analytics }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-fade-in">
      <StatCard label="Total Views" value={analytics.totalViews.toLocaleString()} />
      <StatCard
        label="Published Chapters"
        value={`${analytics.publishedChapters}/${analytics.totalChapters}`}
      />
      <StatCard label="Total Completions" value={analytics.totalCompletions.toLocaleString()} />
      <StatCard label="Avg Views / Chapter" value={analytics.avgViewsPerChapter.toLocaleString()} />
    </div>
  )
}
