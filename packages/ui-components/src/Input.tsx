import React from 'react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label for the input */
  label?: string
  /** Error message to display */
  error?: string
  /** Helper text */
  helperText?: string
  /** Full width input */
  fullWidth?: boolean
}

/**
 * Theme-aware Input component
 *
 * @example
 * <Input
 *   label="Email"
 *   type="email"
 *   placeholder="you@example.com"
 *   error={errors.email}
 * />
 */
export function Input({
  label,
  error,
  helperText,
  fullWidth = false,
  className = '',
  id,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  const hasError = Boolean(error)

  const baseClasses = 'px-3 py-2 border rounded transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed'

  const stateClasses = hasError
    ? 'border-red-500 dark:border-red-500 focus:ring-red-500 focus:border-red-500'
    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'

  const widthClass = fullWidth ? 'w-full' : ''

  const inputClasses = [baseClasses, stateClasses, widthClass, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {label}
        </label>
      )}

      <input
        id={inputId}
        className={inputClasses}
        {...props}
      />

      {(error || helperText) && (
        <p
          className={`mt-1 text-sm ${
            hasError
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          {error || helperText}
        </p>
      )}
    </div>
  )
}
