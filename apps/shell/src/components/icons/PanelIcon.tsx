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
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>
  ),
  message: (
    <>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />
    </>
  ),
  castle: (
    <>
      <path d="M4 21V9l2-2V4h3v3h2V4h2v3h2V4h3v3l2 2v12z" />
      <path d="M10 21v-5a2 2 0 0 1 4 0v5" />
    </>
  ),
  paw: (
    <>
      <circle cx="8" cy="8" r="1.8" />
      <circle cx="16" cy="8" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="19.5" cy="12.5" r="1.6" />
      <path d="M12 12c-2.8 0-5 2.6-5 4.8 0 1.4 1 2.2 2.3 2.2 1 0 1.8-.6 2.7-.6s1.7.6 2.7.6c1.3 0 2.3-.8 2.3-2.2 0-2.2-2.2-4.8-5-4.8z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
      <path d="M5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9.5C7.2 20.2 4 16.5 4 12V6z" />
      <path d="M9 12l2 2 4-4" />
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
