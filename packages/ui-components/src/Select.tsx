import React from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Label for the select */
  label?: string
  /** Error message to display */
  error?: string
  /** Helper text */
  helperText?: string
  /** Full width select */
  fullWidth?: boolean
  /** Options to display */
  options: SelectOption[]
  /** Placeholder text when no option is selected */
  placeholder?: string
}

/**
 * Theme-aware Select component
 *
 * @example
 * <Select
 *   label="Status"
 *   options={[
 *     { value: 'active', label: 'Active' },
 *     { value: 'inactive', label: 'Inactive' }
 *   ]}
 *   placeholder="Select status..."
 * />
 */
export function Select({
  label,
  error,
  helperText,
  fullWidth = false,
  className = '',
  id,
  options,
  placeholder,
  ...props
}: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')
  const hasError = Boolean(error)

  const baseClasses = 'px-3 py-2 border rounded transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed'

  const stateClasses = hasError
    ? 'border-red-500 dark:border-red-500 focus:ring-red-500 focus:border-red-500'
    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'

  const widthClass = fullWidth ? 'w-full' : ''

  const selectClasses = [baseClasses, stateClasses, widthClass, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {label}
        </label>
      )}

      <select
        id={selectId}
        className={selectClasses}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>

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
