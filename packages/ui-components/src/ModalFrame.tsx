import React, { useEffect } from 'react'

export interface ModalFrameProps {
  /** Called when the user dismisses the modal (ESC key or backdrop click). */
  onClose: () => void
  /** Accessible label for the dialog. */
  ariaLabel?: string
  children: React.ReactNode
}

/**
 * Low-level overlay primitive for full-screen modals. Handles backdrop click,
 * ESC-to-close, and ARIA attributes. Content styling is the caller's job.
 *
 * This component assumes it is only mounted when visible — there is no `open`
 * prop. The parent controls mounting (e.g. `{showModal && <ModalFrame …>}`),
 * or a higher-level wrapper like `<Dialog>` gates on its own `open` prop.
 */
export function ModalFrame({ onClose, ariaLabel, children }: ModalFrameProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
}
