import { useEffect, useState, useCallback, useRef } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import {
  MANUSCRIPT_DISPLAY_DEFAULTS,
  DISPLAY_PRESETS,
  resolveDisplaySettings,
  sanitizeDisplaySettings,
  PARAGRAPH_SPACING_VALUES,
  PARAGRAPH_INDENT_VALUES,
  SCENE_BREAK_VALUES,
  type ManuscriptDisplaySettings,
  type PartialManuscriptDisplaySettings,
  type ParagraphSpacing,
  type ParagraphIndent,
  type SceneBreakStyle,
} from '@bobbinry/types'

type Scope = 'user' | 'project' | 'content'

interface UserSettings extends PartialManuscriptDisplaySettings {
  showFormattingMarks?: boolean
}

export interface DisplaySettingsState {
  resolved: ManuscriptDisplaySettings
  showFormattingMarks: boolean
  user: UserSettings
  project: PartialManuscriptDisplaySettings
  content: PartialManuscriptDisplaySettings
  loading: boolean
  saveUser: (patch: UserSettings) => Promise<void>
  saveProject: (patch: PartialManuscriptDisplaySettings) => Promise<void>
  saveContent: (patch: PartialManuscriptDisplaySettings) => Promise<void>
  toggleFormattingMarks: () => Promise<void>
}

/**
 * Loads and caches the user → project → content display cascade. The
 * `contentDisplay` prop comes from the entity body's `entityData.displaySettings`
 * which the editor already loads — we don't re-fetch it here.
 *
 * `saveContent` writes back to `entityData.displaySettings` via sdk.entities.update.
 */
export function useDisplaySettings(
  sdk: BobbinrySDK,
  projectId: string,
  entityId: string | undefined,
  contentDisplay: PartialManuscriptDisplaySettings,
): DisplaySettingsState {
  const [user, setUser] = useState<UserSettings>({})
  const [project, setProject] = useState<PartialManuscriptDisplaySettings>({})
  const [loading, setLoading] = useState(true)
  const apiUrl = sdk.api.apiBaseUrl
  const lastEntityIdRef = useRef<string | undefined>(undefined)

  // Track latest contentDisplay locally so saves can optimistic-update before
  // the editor pushes a fresh prop in.
  const [content, setContent] = useState<PartialManuscriptDisplaySettings>(contentDisplay)
  useEffect(() => {
    if (lastEntityIdRef.current !== entityId) {
      lastEntityIdRef.current = entityId
      setContent(contentDisplay)
    }
  }, [entityId, contentDisplay])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`${apiUrl}/users/me/manuscript-display-settings`, {
        headers: sdk.api.getAuthHeaders(),
      })
        .then(r => (r.ok ? r.json() : { settings: {} }))
        .catch(() => ({ settings: {} })),
      fetch(`${apiUrl}/projects/${projectId}/manuscript-display-settings`, {
        headers: sdk.api.getAuthHeaders(),
      })
        .then(r => (r.ok ? r.json() : { settings: {} }))
        .catch(() => ({ settings: {} })),
    ]).then(([userRes, projectRes]) => {
      if (cancelled) return
      const u = sanitizeDisplaySettings(userRes.settings) as UserSettings
      if (typeof userRes.settings?.showFormattingMarks === 'boolean') {
        u.showFormattingMarks = userRes.settings.showFormattingMarks
      }
      setUser(u)
      setProject(sanitizeDisplaySettings(projectRes.settings))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [sdk, apiUrl, projectId])

  const saveUser = useCallback(
    async (patch: UserSettings) => {
      const next = { ...user, ...patch }
      setUser(next)
      try {
        await fetch(`${apiUrl}/users/me/manuscript-display-settings`, {
          method: 'PUT',
          headers: sdk.api.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(patch),
        })
      } catch (err) {
        console.error('[manuscript] Failed to save user display settings', err)
      }
    },
    [user, apiUrl, sdk],
  )

  const saveProject = useCallback(
    async (patch: PartialManuscriptDisplaySettings) => {
      const next = { ...project, ...patch }
      setProject(next)
      try {
        await fetch(`${apiUrl}/projects/${projectId}/manuscript-display-settings`, {
          method: 'PUT',
          headers: sdk.api.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(patch),
        })
      } catch (err) {
        console.error('[manuscript] Failed to save project display settings', err)
      }
    },
    [project, apiUrl, sdk, projectId],
  )

  const saveContent = useCallback(
    async (patch: PartialManuscriptDisplaySettings) => {
      if (!entityId) return
      // Merge with existing local content settings; entityData merge is shallow
      // server-side, so we must send the full displaySettings object.
      const next = { ...content, ...patch }
      setContent(next)
      try {
        await sdk.entities.update('content', entityId, { displaySettings: next } as any)
      } catch (err) {
        console.error('[manuscript] Failed to save content display settings', err)
      }
    },
    [content, sdk, entityId],
  )

  const toggleFormattingMarks = useCallback(async () => {
    const next = !user.showFormattingMarks
    await saveUser({ showFormattingMarks: next })
  }, [user.showFormattingMarks, saveUser])

  const resolved = resolveDisplaySettings(user, project, content)
  const showFormattingMarks = user.showFormattingMarks === true

  return {
    resolved,
    showFormattingMarks,
    user,
    project,
    content,
    loading,
    saveUser,
    saveProject,
    saveContent,
    toggleFormattingMarks,
  }
}

interface DisplayDropdownProps {
  state: DisplaySettingsState
}

const SCOPE_LABEL: Record<Scope, string> = {
  user: 'Your default',
  project: 'This project',
  content: 'This chapter',
}

const PARAGRAPH_SPACING_LABELS: Record<ParagraphSpacing, string> = {
  standard: 'Standard (HTML spacing)',
  manuscript: 'Manuscript (no extra line)',
}

const PARAGRAPH_INDENT_LABELS: Record<ParagraphIndent, string> = {
  none: 'No indent',
  'first-line': 'First-line indent (after first ¶)',
  every: 'Every paragraph indented',
}

const SCENE_BREAK_LABELS: Record<SceneBreakStyle, string> = {
  asterism: 'Asterism (* * *)',
  rule: 'Horizontal rule',
  'blank-line': 'Blank line',
}

const HINTS: Record<keyof ManuscriptDisplaySettings, string> = {
  paragraphSpacing:
    'Standard adds extra space between paragraphs (HTML style). Manuscript removes that space — the look readers expect from printed novels.',
  paragraphIndent:
    'Whether paragraphs start with a tab indent. First-line is conventional for prose; every is rare; none is HTML style.',
  codeBlockWrap:
    'Wraps long lines inside code blocks instead of scrolling sideways. Useful when you use code blocks for in-fiction system messages (LitRPG, etc.).',
  sceneBreakStyle:
    'How horizontal rules (---) display between scenes. Asterism (* * *) is the publishing standard.',
  dropCaps:
    'Large ornamental first letter on the first paragraph after each heading. Editorial / magazine flourish — best used sparingly.',
}

const popoverInputClass =
  'w-full px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs ' +
  'focus:ring-2 focus:ring-blue-500/40 outline-none cursor-pointer'

/**
 * Toolbar dropdown that exposes the cascade. The scope switcher decides
 * which level each toggle writes to.
 */
export function DisplayDropdown({ state }: DisplayDropdownProps) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('content')
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // The toolbar wrapper has `overflow-hidden`, which clips absolutely-positioned
  // children. position: fixed anchored to the trigger's rect escapes the
  // overflow bound — no portal required.
  useEffect(() => {
    if (!open) return
    function recompute() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        setPosition({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        })
      }
    }
    recompute()
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [open])

  const scoped = scope === 'user' ? state.user : scope === 'project' ? state.project : state.content
  const save = scope === 'user' ? state.saveUser : scope === 'project' ? state.saveProject : state.saveContent

  function setField<K extends keyof ManuscriptDisplaySettings>(
    field: K,
    value: ManuscriptDisplaySettings[K] | null,
  ) {
    save({ [field]: value } as PartialManuscriptDisplaySettings)
  }

  const inheritedFrom = (field: keyof ManuscriptDisplaySettings): Scope | 'default' => {
    if (state.content[field] !== undefined && state.content[field] !== null) return 'content'
    if (state.project[field] !== undefined && state.project[field] !== null) return 'project'
    if (state.user[field] !== undefined && state.user[field] !== null) return 'user'
    return 'default'
  }

  const popover = open && position ? (
    <div
      ref={popoverRef}
      style={{ position: 'fixed', top: position.top, right: position.right }}
      className="z-[60] w-[22rem] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl text-xs text-gray-900 dark:text-gray-100"
    >
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
          Editing
        </div>
        <div className="inline-flex rounded-md bg-gray-100 dark:bg-gray-900/50 p-0.5">
          {(['user', 'project', 'content'] as Scope[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer ${
                scope === s
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <FieldRow
          label="Paragraph spacing"
          hint={HINTS.paragraphSpacing}
          inherited={inheritedFrom('paragraphSpacing')}
          currentScope={scope}
        >
          <select
            className={popoverInputClass}
            value={(scoped.paragraphSpacing ?? '') as string}
            onChange={e => setField('paragraphSpacing', (e.target.value || null) as ParagraphSpacing | null)}
          >
            <option value="">Inherit</option>
            {PARAGRAPH_SPACING_VALUES.map(v => (
              <option key={v} value={v}>{PARAGRAPH_SPACING_LABELS[v]}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow
          label="Paragraph indent"
          hint={HINTS.paragraphIndent}
          inherited={inheritedFrom('paragraphIndent')}
          currentScope={scope}
        >
          <select
            className={popoverInputClass}
            value={(scoped.paragraphIndent ?? '') as string}
            onChange={e => setField('paragraphIndent', (e.target.value || null) as ParagraphIndent | null)}
          >
            <option value="">Inherit</option>
            {PARAGRAPH_INDENT_VALUES.map(v => (
              <option key={v} value={v}>{PARAGRAPH_INDENT_LABELS[v]}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow
          label="Scene break style"
          hint={HINTS.sceneBreakStyle}
          inherited={inheritedFrom('sceneBreakStyle')}
          currentScope={scope}
        >
          <select
            className={popoverInputClass}
            value={(scoped.sceneBreakStyle ?? '') as string}
            onChange={e => setField('sceneBreakStyle', (e.target.value || null) as SceneBreakStyle | null)}
          >
            <option value="">Inherit</option>
            {SCENE_BREAK_VALUES.map(v => (
              <option key={v} value={v}>{SCENE_BREAK_LABELS[v]}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow
          label="Code block wrap"
          hint={HINTS.codeBlockWrap}
          inherited={inheritedFrom('codeBlockWrap')}
          currentScope={scope}
        >
          <TriToggle
            value={scoped.codeBlockWrap ?? null}
            onChange={v => setField('codeBlockWrap', v)}
          />
        </FieldRow>

        <FieldRow
          label="Drop caps"
          hint={HINTS.dropCaps}
          inherited={inheritedFrom('dropCaps')}
          currentScope={scope}
        >
          <TriToggle
            value={scoped.dropCaps ?? null}
            onChange={v => setField('dropCaps', v)}
          />
        </FieldRow>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Quick styles → {SCOPE_LABEL[scope].toLowerCase()}
          </div>
          <PopoverHint text="One-click sets the fields above to a known style. Applies to whichever scope is selected at the top." />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {DISPLAY_PRESETS
            // User scope has no layer above to inherit from — hide the Inherit preset there.
            .filter(preset => !(scope === 'user' && preset.id === 'inherit'))
            .map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => save(preset.values)}
                title={preset.description}
                className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer text-left ${
                  preset.id === 'inherit'
                    ? 'border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-900/70'
                    : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 text-gray-800 dark:text-gray-100'
                }`}
              >
                {preset.name}
              </button>
            ))}
        </div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug pt-1">
          <span className="text-gray-400 dark:text-gray-500">Now showing: </span>
          {summarize(state.resolved)}
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Display settings"
        className={`px-2 py-1 rounded text-sm font-medium transition-colors cursor-pointer ${
          open
            ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
        }`}
      >
        <svg className="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h12M3 18h6" />
        </svg>
        <span className="ml-1 text-xs">Display</span>
      </button>
      {popover}
    </>
  )
}

function FieldRow({
  label,
  hint,
  inherited,
  currentScope,
  children,
}: {
  label: string
  hint?: string
  inherited: Scope | 'default'
  currentScope: Scope
  children: React.ReactNode
}) {
  const overriddenHere = currentScope === inherited
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="inline-flex items-center font-medium text-gray-700 dark:text-gray-300 text-[11px]">
          {label}
          {hint && <PopoverHint text={hint} />}
        </label>
        <span className={`text-[10px] ${overriddenHere ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
          {overriddenHere
            ? 'set here'
            : inherited === 'default'
              ? 'default'
              : `from ${SCOPE_LABEL[inherited as Scope].toLowerCase()}`}
        </span>
      </div>
      {children}
    </div>
  )
}

function PopoverHint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group ml-1.5">
      <span
        tabIndex={0}
        role="img"
        aria-label="More info"
        className="cursor-help text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
      >
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <span
        role="tooltip"
        className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 px-2.5 py-1.5 rounded-md bg-gray-900 text-gray-50 dark:bg-gray-100 dark:text-gray-900 text-[11px] leading-snug shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity z-50 text-left font-normal"
      >
        {text}
      </span>
    </span>
  )
}

function TriToggle({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  const opts: Array<{ k: string; v: boolean | null; label: string }> = [
    { k: 'inherit', v: null, label: 'Inherit' },
    { k: 'off', v: false, label: 'Off' },
    { k: 'on', v: true, label: 'On' },
  ]
  return (
    <div className="inline-flex rounded-md bg-gray-100 dark:bg-gray-900/50 p-0.5">
      {opts.map(o => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer ${
            value === o.v
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function summarize(s: ManuscriptDisplaySettings): string {
  const parts: string[] = []
  parts.push(s.paragraphSpacing === 'manuscript' ? 'manuscript ¶ spacing' : 'standard spacing')
  if (s.paragraphIndent === 'first-line') parts.push('first-line indent')
  else if (s.paragraphIndent === 'every') parts.push('all ¶ indented')
  if (s.codeBlockWrap) parts.push('code wrap')
  if (s.dropCaps) parts.push('drop caps')
  if (s.sceneBreakStyle !== MANUSCRIPT_DISPLAY_DEFAULTS.sceneBreakStyle) parts.push(`${s.sceneBreakStyle} breaks`)
  return parts.join(', ')
}
