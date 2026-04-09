'use client'

/**
 * App-wide toast notifications.
 *
 * Replaces the hand-rolled `errorToast` state that was being copy-pasted into
 * individual pages (see the original `apps/shell/src/app/membership/page.tsx`
 * and `apps/shell/src/app/admin/users/page.tsx` implementations). The goal is
 * one canonical `useToast()` API so future features don't invent their own.
 *
 * Not using `@bobbinry/ui-components`'s `Toast` component directly because
 * the shell needs a stack manager + dismiss queue and the package-level
 * component is designed to be rendered as a single instance.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export type ToastVariant = 'error' | 'success' | 'info' | 'warning'

export interface ToastOptions {
  /** Auto-dismiss duration in ms. 0 = sticky. Default: 5000. */
  duration?: number
}

interface Toast {
  id: number
  message: string
  variant: ToastVariant
  duration: number
}

interface ToastContextValue {
  /** Show a toast of any variant. Returns the toast id. */
  showToast: (message: string, variant?: ToastVariant, opts?: ToastOptions) => number
  /** Shortcut: show an error toast. */
  showError: (message: string, opts?: ToastOptions) => number
  /** Shortcut: show a success toast. */
  showSuccess: (message: string, opts?: ToastOptions) => number
  /** Dismiss a toast by id. */
  dismissToast: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>')
  }
  return ctx
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  error:   'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100',
  success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100',
  info:    'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-900 dark:text-yellow-100',
}

const DISMISS_ICON_CLASSES: Record<ToastVariant, string> = {
  error:   'text-red-400 hover:text-red-600 dark:hover:text-red-300',
  success: 'text-green-400 hover:text-green-600 dark:hover:text-green-300',
  info:    'text-blue-400 hover:text-blue-600 dark:hover:text-blue-300',
  warning: 'text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextIdRef = useRef(1)

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, variant: ToastVariant = 'info', opts?: ToastOptions): number => {
    const id = nextIdRef.current++
    const duration = opts?.duration ?? 5000
    setToasts((prev) => [...prev, { id, message, variant, duration }])
    return id
  }, [])

  const showError = useCallback((message: string, opts?: ToastOptions) => showToast(message, 'error', opts), [showToast])
  const showSuccess = useCallback((message: string, opts?: ToastOptions) => showToast(message, 'success', opts), [showToast])

  const value = useMemo<ToastContextValue>(
    () => ({ showToast, showError, showSuccess, dismissToast }),
    [showToast, showError, showSuccess, dismissToast]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} dismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return
    const timer = setTimeout(() => dismiss(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, dismiss])

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border max-w-md ${VARIANT_CLASSES[toast.variant]}`}
    >
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={() => dismiss(toast.id)}
        className={`flex-shrink-0 ${DISMISS_ICON_CLASSES[toast.variant]}`}
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
