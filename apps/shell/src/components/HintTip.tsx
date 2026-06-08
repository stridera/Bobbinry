'use client'

/**
 * Inline help icon with a CSS-only tooltip. Tooltip floats above the icon on
 * hover/focus. For longer-form help we'd build a popover; this covers the
 * common "what does this setting mean" case.
 */
export function HintTip({ children, width = 'w-56' }: { children: React.ReactNode; width?: string }) {
  return (
    <span className="relative inline-flex items-center group align-middle ml-1">
      <span
        tabIndex={0}
        role="img"
        aria-label="More info"
        className="cursor-help text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:text-gray-600 dark:focus:text-gray-300 transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <span
        role="tooltip"
        className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-2 ${width} px-2.5 py-1.5 rounded-md bg-gray-900 text-gray-50 dark:bg-gray-100 dark:text-gray-900 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity z-50 text-left font-normal`}
      >
        {children}
      </span>
    </span>
  )
}
