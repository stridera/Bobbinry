export interface SegmentedOption {
  value: string
  label: string
}

export interface SegmentedProps {
  /** All choices, in display order. */
  options: SegmentedOption[]
  /** Value of the selected option. */
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  /** md for cards/pages, sm for dense popovers. */
  size?: 'sm' | 'md'
  /** Additional CSS classes for the track. */
  className?: string
}

/**
 * Theme-aware segmented control: every option visible, selection shown by a
 * sliding pill. Equal-width segments keep the pill math trivial (translateX
 * in multiples of its own width).
 *
 * @example
 * <Segmented
 *   ariaLabel="Code block wrap"
 *   value={value ?? ''}
 *   onChange={v => setValue(v || null)}
 *   options={[
 *     { value: '', label: 'Inherit' },
 *     { value: 'off', label: 'Off' },
 *     { value: 'on', label: 'On' },
 *   ]}
 * />
 */
export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className = ''
}: SegmentedProps) {
  const activeIndex = Math.max(0, options.findIndex(o => o.value === value))
  const segmentClasses = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2 py-1.5 text-xs'

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative grid rounded-lg bg-gray-100 dark:bg-gray-900/50 p-0.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-md bg-white dark:bg-gray-700 shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: `calc((100% - 0.25rem) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`
        }}
      />
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={i === activeIndex}
          onClick={() => onChange(o.value)}
          title={o.label}
          className={`relative z-10 rounded-md font-medium transition-colors cursor-pointer text-center truncate ${segmentClasses} ${
            i === activeIndex
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
