import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function PanelFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cx('h-full flex flex-col bg-white dark:bg-gray-800', className)}>{children}</div>
}

export function PanelBody({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div className={cx('flex-1 overflow-y-auto', padded && 'px-3 py-3', className)}>
      {children}
    </div>
  )
}

export function PanelHeader({
  title,
  description,
  badge,
}: {
  title: string
  description?: string
  badge?: ReactNode
}) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
          ) : null}
        </div>
        {badge ? <div className="flex-shrink-0">{badge}</div> : null}
      </div>
    </div>
  )
}

export function PanelSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
      {children}
    </div>
  )
}

export function PanelLoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-8 text-sm text-gray-500 dark:text-gray-400">
      <div className="animate-pulse">{label}</div>
    </div>
  )
}

export function PanelEmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-6">
      <div className="w-full rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-4 py-6 text-center dark:border-gray-700 dark:bg-gray-900/30">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  )
}

export function PanelMessage({
  tone,
  children,
}: {
  tone: 'info' | 'success' | 'warning' | 'error'
  children: ReactNode
}) {
  const toneClasses = {
    info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300',
    success: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
    error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
  }

  return (
    <div className={cx('rounded-lg border px-3 py-2 text-xs leading-5', toneClasses[tone])}>
      {children}
    </div>
  )
}

export function PanelCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-gray-200 bg-gray-50/90 px-3 py-3 dark:border-gray-700 dark:bg-gray-900/40',
        className
      )}
    >
      {children}
    </div>
  )
}

export function PanelActionButton({
  children,
  className,
  tone = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  tone?: 'default' | 'primary' | 'danger'
}) {
  const tones = {
    default:
      'border-gray-200 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
    primary:
      'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500',
    danger:
      'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50',
  }

  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tones[tone],
        className
      )}
    />
  )
}

export function PanelIconButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  )
}

export function PanelPill({
  children,
  className,
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300',
        className
      )}
    >
      {children}
    </span>
  )
}
