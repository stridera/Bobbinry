'use client'

/**
 * Keyboard shortcuts help overlay, opened with `?` (outside text fields),
 * Ctrl/Cmd+/, the header keyboard button, or a `bobbinry:open-shortcuts-help`
 * event.
 *
 * The list is registry-driven: bobbins announce the shortcuts their mounted
 * panels/views handle via `registerShortcuts()` from @bobbinry/sdk
 * (bobbinry:shortcuts-register / -unregister window events), so the overlay
 * always reflects what's actually active instead of a hardcoded list that
 * goes stale as plugins add bindings.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  SHORTCUTS_REGISTER_EVENT,
  SHORTCUTS_UNREGISTER_EVENT,
  OPEN_SHORTCUTS_HELP_EVENT,
  type ShortcutEntry,
} from '@bobbinry/sdk'
import { ModalFrame } from '@bobbinry/ui-components'

const SHELL_GROUP = 'Shell'

const SHELL_SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Mod+K', description: 'Quick open — jump to chapter, entity, or note', group: SHELL_GROUP },
  { keys: 'Mod+F', description: 'Find in project', group: SHELL_GROUP },
  { keys: 'Mod+Shift+H', description: 'Search & replace', group: SHELL_GROUP },
  { keys: 'Ctrl+Shift+F', description: 'Toggle focus mode', group: SHELL_GROUP },
  { keys: '? / Mod+/', description: 'Show keyboard shortcuts', group: SHELL_GROUP },
]

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Render a 'Mod+Shift+K'-style combo as platform-aware <kbd> chips. */
function KeyCombo({ keys, isMac }: { keys: string; isMac: boolean }) {
  return (
    <span className="flex items-center gap-1">
      {keys.split(' / ').map((combo, i) => (
        <span key={combo} className="flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-gray-400 dark:text-gray-500">or</span>}
          {combo.split('+').map(part => (
            <kbd
              key={part}
              className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-mono text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
            >
              {part === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : part}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  )
}

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false)
  const [registered, setRegistered] = useState<Map<string, ShortcutEntry[]>>(() => new Map())
  // Safe to read directly: the overlay only renders after user interaction,
  // so the server-rendered output (open=false → null) never shows this.
  const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)

  // Collect bobbin announcements. Panels/views mount after this component
  // (they load async inside the shell), so registrations aren't missed.
  useEffect(() => {
    function handleRegister(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.ownerId || !Array.isArray(detail.shortcuts)) return
      setRegistered(prev => {
        const next = new Map(prev)
        next.set(detail.ownerId, detail.shortcuts)
        return next
      })
    }
    function handleUnregister(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.ownerId) return
      setRegistered(prev => {
        if (!prev.has(detail.ownerId)) return prev
        const next = new Map(prev)
        next.delete(detail.ownerId)
        return next
      })
    }
    function handleOpen() {
      setOpen(true)
    }

    window.addEventListener(SHORTCUTS_REGISTER_EVENT, handleRegister)
    window.addEventListener(SHORTCUTS_UNREGISTER_EVENT, handleUnregister)
    window.addEventListener(OPEN_SHORTCUTS_HELP_EVENT, handleOpen)
    return () => {
      window.removeEventListener(SHORTCUTS_REGISTER_EVENT, handleRegister)
      window.removeEventListener(SHORTCUTS_UNREGISTER_EVENT, handleUnregister)
      window.removeEventListener(OPEN_SHORTCUTS_HELP_EVENT, handleOpen)
    }
  }, [])

  // `?` outside text fields, Mod+/ anywhere. Capture phase so the shortcut
  // wins over TipTap (same idiom as QuickOpenPalette).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && !e.shiftKey && e.key === '/') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(prev => !prev)
      } else if (!mod && !e.altKey && e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])

  // Shell group first, then registered groups alphabetically.
  const groups = useMemo(() => {
    const byGroup = new Map<string, ShortcutEntry[]>()
    for (const entry of SHELL_SHORTCUTS) {
      byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry])
    }
    for (const shortcuts of registered.values()) {
      for (const entry of shortcuts) {
        if (!entry?.keys || !entry?.description) continue
        const group = entry.group || 'Other'
        byGroup.set(group, [...(byGroup.get(group) ?? []), entry])
      }
    }
    return Array.from(byGroup.entries()).sort(([a], [b]) => {
      if (a === SHELL_GROUP) return -1
      if (b === SHELL_GROUP) return 1
      return a.localeCompare(b)
    })
  }, [registered])

  if (!open) return null

  return (
    <ModalFrame onClose={() => setOpen(false)} ariaLabel="Keyboard shortcuts">
      <div
        className="w-full max-w-lg self-start mt-[10vh] rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Keyboard shortcuts</h2>
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {groups.map(([group, entries]) => (
            <div key={group} className="mb-3 last:mb-0">
              <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                {group}
              </div>
              {entries.map(entry => (
                <div
                  key={`${entry.keys}-${entry.description}`}
                  className="flex items-center justify-between gap-4 rounded px-1.5 py-1.5"
                >
                  <span className="text-sm text-gray-700 dark:text-gray-200">{entry.description}</span>
                  <KeyCombo keys={entry.keys} isMac={isMac} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </ModalFrame>
  )
}
