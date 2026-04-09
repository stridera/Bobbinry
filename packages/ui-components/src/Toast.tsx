import React, { useEffect } from 'react'

export interface ToastProps {
  /** Toast message */
  message: string
  /** Toast variant */
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  /** Duration in milliseconds before auto-dismiss (0 = no auto-dismiss) */
  duration?: number
  /** Callback when toast is dismissed */
  onDismiss?: () => void
  /** Show close button */
  dismissible?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Theme-aware Toast notification component
 *
 * @example
 * const [showToast, setShowToast] = useState(false)
 *
 * {showToast && (
 *   <Toast
 *     message="Item saved successfully!"
 *     variant="success"
 *     duration={3000}
 *     onDismiss={() => setShowToast(false)}
 *   />
 * )}
 */
export function Toast({
  message,
  variant = 'default',
  duration = 5000,
  onDismiss,
  dismissible = true,
  className = ''
}: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss?.()
      }, duration)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [duration, onDismiss])

  const baseClasses = 'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border max-w-md'

  const variantClasses = {
    default: 'bg-gray-700 border-gray-500 text-gray-100',
    success: 'bg-green-800 border-green-600 text-green-100',
    warning: 'bg-yellow-800 border-yellow-600 text-yellow-100',
    danger: 'bg-red-800 border-red-500 text-red-100',
    info: 'bg-blue-800 border-blue-600 text-blue-100'
  }

  const iconClasses = {
    default: 'text-gray-400',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    danger: 'text-red-400',
    info: 'text-blue-400'
  }

  const icons = {
    default: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    danger: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }

  const toastClasses = [baseClasses, variantClasses[variant], className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={toastClasses} role="alert">
      <div className={iconClasses[variant]}>
        {icons[variant]}
      </div>

      <p className="flex-1 text-sm font-medium">
        {message}
      </p>

      {dismissible && onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * Toast container for positioning toasts on the screen
 *
 * @example
 * <ToastContainer position="top-right">
 *   {toasts.map(toast => (
 *     <Toast key={toast.id} {...toast} />
 *   ))}
 * </ToastContainer>
 */
export function ToastContainer({
  children,
  position = 'top-right',
  className = ''
}: {
  children: React.ReactNode
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'
  className?: string
}) {
  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2'
  }

  return (
    <div
      className={`fixed z-50 flex flex-col gap-2 ${positionClasses[position]} ${className}`}
    >
      {children}
    </div>
  )
}
