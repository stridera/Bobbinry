import Link from 'next/link'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  action?: { label: string; href?: string; onClick?: () => void }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="bg-white rounded-lg shadow p-12 text-center">
      {icon && <div className="flex justify-center mb-4">{icon}</div>}
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-6">{description}</p>
      {action && (
        action.href ? (
          <Link href={action.href} className="inline-flex px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            {action.label}
          </Link>
        ) : (
          <button onClick={action.onClick} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            {action.label}
          </button>
        )
      )}
    </div>
  )
}
