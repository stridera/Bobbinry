import Link from 'next/link'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  action?: { label: string; href?: string; onClick?: () => void }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
      {icon && <div className="flex justify-center mb-5">{icon}</div>}
      <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
      <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">{description}</p>
      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="inline-flex px-6 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
          >
            {action.label}
          </Link>
        ) : (
          <button
            onClick={action.onClick}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  )
}
