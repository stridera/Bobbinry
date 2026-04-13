import React, { useEffect, useRef, useState } from 'react'
import { ModalFrame } from './ModalFrame'

export type DialogVariant = 'default' | 'danger' | 'warning'

export interface DialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean
  /** Headline shown at the top of the dialog. */
  title: string
  /** Optional body text below the title. */
  message?: React.ReactNode
  /** Visual + button styling cue. `danger` is used for destructive confirmations. */
  variant?: DialogVariant
  /** Confirm button label. Default: `OK`. */
  confirmLabel?: string
  /** Cancel button label. Default: `Cancel`. */
  cancelLabel?: string
  /**
   * Set this to enable input mode. When defined, the dialog renders an input
   * field of the chosen type and passes its value to `onConfirm`. Used for
   * single-field prompts (replaces `window.prompt`).
   */
  inputType?: 'text' | 'number'
  inputPlaceholder?: string
  inputDefaultValue?: string
  /**
   * Called when the user presses confirm. The argument is the input field's
   * value when `inputType` is set, otherwise undefined.
   */
  onConfirm: (value?: string) => void
  /** Called when the user dismisses the dialog (cancel button, ESC, backdrop click). */
  onCancel: () => void
}

const VARIANT_CONFIRM_CLASSES: Record<DialogVariant, string> = {
  default: 'bg-blue-600 hover:bg-blue-700 text-white',
  danger:  'bg-red-600 hover:bg-red-700 text-white',
  warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
}

/**
 * Theme-aware modal dialog. Drop-in replacement for `window.confirm` and
 * `window.prompt` — both are banned project-wide because they block the event
 * loop, can't be styled, and break UX consistency.
 *
 * @example
 * // Confirmation
 * <Dialog
 *   open={confirmingDelete}
 *   title="Delete this timeline?"
 *   message="This will also delete all of its events. This cannot be undone."
 *   variant="danger"
 *   confirmLabel="Delete"
 *   onConfirm={() => { handleDelete(id); setConfirmingDelete(false) }}
 *   onCancel={() => setConfirmingDelete(false)}
 * />
 *
 * @example
 * // Prompt for input
 * <Dialog
 *   open={loggingSession}
 *   title="Log a writing session"
 *   message="How many words did you write?"
 *   inputType="number"
 *   inputPlaceholder="500"
 *   confirmLabel="Log"
 *   onConfirm={(value) => { handleLog(value); setLoggingSession(false) }}
 *   onCancel={() => setLoggingSession(false)}
 * />
 */
export function Dialog({
  open,
  title,
  message,
  variant = 'default',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  inputType,
  inputPlaceholder,
  inputDefaultValue = '',
  onConfirm,
  onCancel,
}: DialogProps) {
  const [inputValue, setInputValue] = useState(inputDefaultValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  // Reset the input value whenever the dialog reopens so stale state from a
  // previous invocation doesn't leak in.
  useEffect(() => {
    if (open) setInputValue(inputDefaultValue)
  }, [open, inputDefaultValue])

  // Focus management: input field if present, otherwise the confirm button.
  // Run after the DOM is in place so the focused element is actually mounted.
  useEffect(() => {
    if (!open) return
    const target = inputType ? inputRef.current : confirmButtonRef.current
    target?.focus()
  }, [open, inputType])

  if (!open) return null

  const handleConfirm = () => {
    onConfirm(inputType ? inputValue : undefined)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleConfirm()
  }

  return (
    <ModalFrame onClose={onCancel} ariaLabel={title}>
      <div className="w-full max-w-md rounded-lg shadow-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <form onSubmit={handleSubmit}>
          <div className="px-5 pt-5 pb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
            {message && (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {message}
              </div>
            )}
            {inputType && (
              <input
                ref={inputRef}
                type={inputType}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={inputPlaceholder}
                className="mt-4 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            )}
          </div>
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 rounded-b-lg">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm font-medium rounded text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmButtonRef}
              type="submit"
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${VARIANT_CONFIRM_CLASSES[variant]}`}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </ModalFrame>
  )
}
