/**
 * Keyboard-shortcut announcements for the shell's shortcuts overlay (? / Ctrl+/).
 *
 * Bobbins register the shortcuts their mounted panels/views actually handle;
 * the shell collects them and renders the help overlay. Registration is
 * display-only — it does not bind any keys. Transport is window CustomEvents,
 * matching every other bobbin↔shell channel (bobbinry:navigate etc.).
 */

export interface ShortcutEntry {
  /** Display string, e.g. 'Alt+N' or 'Mod+Enter'. 'Mod' renders as ⌘ on macOS and Ctrl elsewhere. */
  keys: string
  /** What the shortcut does, e.g. 'New chapter below the selected one'. */
  description: string
  /** Overlay section, e.g. 'Manuscript', 'Editor', 'Formatting'. */
  group: string
}

export const SHORTCUTS_REGISTER_EVENT = 'bobbinry:shortcuts-register'
export const SHORTCUTS_UNREGISTER_EVENT = 'bobbinry:shortcuts-unregister'
export const OPEN_SHORTCUTS_HELP_EVENT = 'bobbinry:open-shortcuts-help'

/**
 * Announce shortcuts to the shell overlay. Returns an unregister function,
 * so a mounted component can register in a useEffect and clean up on unmount:
 *
 *   useEffect(() => registerShortcuts('manuscript.navigation', [...]), [])
 *
 * Re-registering the same ownerId replaces its previous entries.
 */
export function registerShortcuts(ownerId: string, shortcuts: ShortcutEntry[]): () => void {
  if (typeof window === 'undefined') return () => {}

  window.dispatchEvent(
    new CustomEvent(SHORTCUTS_REGISTER_EVENT, { detail: { ownerId, shortcuts } })
  )

  return () => {
    window.dispatchEvent(
      new CustomEvent(SHORTCUTS_UNREGISTER_EVENT, { detail: { ownerId } })
    )
  }
}
