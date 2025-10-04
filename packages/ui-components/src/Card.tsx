import React from 'react'

export interface CardProps {
  /** Card title */
  title?: string
  /** Card subtitle */
  subtitle?: string
  /** Card children */
  children?: React.ReactNode
  /** Additional actions or content in the header */
  headerActions?: React.ReactNode
  /** Additional CSS classes */
  className?: string
  /** Clickable card */
  onClick?: () => void
  /** Hover effect */
  hover?: boolean
}

/**
 * Theme-aware Card component
 *
 * @example
 * <Card title="My Item" subtitle="Description">
 *   <p>Card content here</p>
 * </Card>
 */
export function Card({
  title,
  subtitle,
  children,
  headerActions,
  className = '',
  onClick,
  hover = false
}: CardProps) {
  const baseClasses = 'border rounded-lg bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
  const interactiveClasses = onClick || hover
    ? 'cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition-colors'
    : ''

  const classes = [baseClasses, interactiveClasses, className]
    .filter(Boolean)
    .join(' ')

  const CardComponent = onClick ? 'button' : 'div'
  const cardProps = onClick ? { onClick, type: 'button' as const } : {}

  return (
    <CardComponent className={classes} {...cardProps}>
      {(title || subtitle || headerActions) && (
        <div className="flex items-start justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1">
            {title && (
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {subtitle}
              </p>
            )}
          </div>
          {headerActions && (
            <div className="ml-4 flex-shrink-0">
              {headerActions}
            </div>
          )}
        </div>
      )}

      {children && (
        <div className="p-4">
          {children}
        </div>
      )}
    </CardComponent>
  )
}
