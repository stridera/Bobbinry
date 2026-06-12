'use client'

// Icon registry for bobbin panel contributions (manifest `icon:` field).
// Unknown or missing names fall back to a letter badge so third-party
// bobbins without a registered icon still get a usable rail button.

const ICON_PATHS: Record<string, React.ReactNode> = {
  book: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  note: (
    <>
      <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z" />
      <path d="M15 3v6h6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
}

interface PanelIconProps {
  name?: string | undefined
  fallbackLabel: string
  className?: string
}

export function PanelIcon({ name, fallbackLabel, className = 'w-5 h-5' }: PanelIconProps) {
  const paths = name ? ICON_PATHS[name] : undefined

  if (!paths) {
    return (
      <span
        aria-hidden
        className={`${className} flex items-center justify-center rounded border border-current text-[10px] font-semibold leading-none`}
      >
        {(fallbackLabel.trim()[0] || '?').toUpperCase()}
      </span>
    )
  }

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths}
    </svg>
  )
}

export default PanelIcon
