'use client'

interface ProjectWelcomeProps {
  projectId: string
  onInstallBobbins?: () => void
}

export function ProjectWelcome({ projectId, onInstallBobbins }: ProjectWelcomeProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center animate-fade-in">
        <div className="mb-8">
          <svg
            className="mx-auto h-20 w-20 text-blue-400/60 dark:text-blue-400/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
            />
          </svg>
        </div>

        <h2 className="font-display text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">Begin Your Story</h2>
        <p className="text-lg text-gray-500 dark:text-gray-400 mb-8">
          Install bobbins to add tools and structure to your project.
        </p>

        <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-lg p-6 mb-8 text-left">
          <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-3">Available bobbins</h3>
          <ul className="space-y-3">
            <li className="flex items-start">
              <svg className="w-5 h-5 text-blue-500 dark:text-blue-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-gray-900 dark:text-gray-100">Manuscript</strong> &mdash; Writing with chapters, scenes, and rich text editing
              </span>
            </li>
            <li className="flex items-start">
              <svg className="w-5 h-5 text-blue-500 dark:text-blue-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-gray-900 dark:text-gray-100">Corkboard</strong> &mdash; Visual organization with drag-and-drop cards
              </span>
            </li>
            <li className="flex items-start">
              <svg className="w-5 h-5 text-blue-500 dark:text-blue-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-gray-900 dark:text-gray-100">Dictionary</strong> &mdash; Glossary and terminology management
              </span>
            </li>
          </ul>
        </div>

        <button
          onClick={onInstallBobbins}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium text-lg transition-colors"
        >
          Browse Bobbins
        </button>

        <p className="text-sm text-gray-400 dark:text-gray-500 mt-6">
          You can always add more bobbins later from project settings
        </p>
      </div>
    </div>
  )
}
