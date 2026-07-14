'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'
import { HintTip } from '@/components/HintTip'
import { CollapsibleCard } from './CollapsibleCard'
import { Segmented } from '@bobbinry/ui-components'
import {
  DISPLAY_PRESETS,
  PARAGRAPH_SPACING_VALUES,
  PARAGRAPH_SPACING_LABELS,
  PARAGRAPH_INDENT_LABELS,
  SCENE_BREAK_LABELS,
  resolveDisplaySettings,
  sanitizeDisplaySettings,
  summarizeDisplaySettings,
  type ManuscriptDisplaySettings as ResolvedDisplaySettings,
  type PartialManuscriptDisplaySettings,
  type ParagraphSpacing,
  type ParagraphIndent,
  type SceneBreakStyle,
} from '@bobbinry/types'

const HINTS = {
  paragraphSpacing:
    'Standard adds extra space between paragraphs (HTML style). Manuscript removes that space — the look readers expect from printed novels.',
  paragraphIndent:
    'Whether paragraphs start with a tab indent. First-line is conventional for prose; every is rare; none is HTML style.',
  codeBlockWrap:
    'Wraps long lines inside code blocks instead of scrolling sideways. Useful when you use code blocks for in-fiction system messages (LitRPG, etc.).',
  sceneBreakStyle:
    'How horizontal rules (---) display between scenes. Asterism (* * *) is the publishing standard.',
  dropCaps:
    'Large ornamental first letter on the first paragraph after each heading. Editorial flourish — best used sparingly.',
}

interface ProjectSettings {
  paragraphSpacing: ParagraphSpacing | null
  paragraphIndent: ParagraphIndent | null
  codeBlockWrap: boolean | null
  sceneBreakStyle: SceneBreakStyle | null
  dropCaps: boolean | null
}

const empty: ProjectSettings = {
  paragraphSpacing: null,
  paragraphIndent: null,
  codeBlockWrap: null,
  sceneBreakStyle: null,
  dropCaps: null,
}

/** The subset of cascade fields this card edits (smart dashes/ellipsis live in the editor). */
const CARD_FIELDS = ['paragraphSpacing', 'paragraphIndent', 'codeBlockWrap', 'sceneBreakStyle', 'dropCaps'] as const

function Field({
  label,
  hint,
  inheritNote,
  children,
}: {
  label: string
  hint: string
  /** Shown right-aligned when the field is inheriting, e.g. "your default: Standard". */
  inheritNote?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="flex items-center text-xs font-medium text-gray-700 dark:text-gray-300">
          {label}
          <HintTip>{hint}</HintTip>
        </span>
        {inheritNote && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{inheritNote}</span>
        )}
      </div>
      {children}
    </div>
  )
}

export function ManuscriptDisplaySettings({ projectId }: { projectId: string }) {
  const { data: session } = useSession()
  const apiToken = session?.apiToken
  const [settings, setSettings] = useState<ProjectSettings>(empty)
  const [projectExtras, setProjectExtras] = useState<PartialManuscriptDisplaySettings>({})
  const [userDefaults, setUserDefaults] = useState<ResolvedDisplaySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!apiToken) return
    setLoading(true)
    try {
      const [res, userRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/manuscript-display-settings`, apiToken),
        apiFetch('/api/users/me/manuscript-display-settings', apiToken),
      ])
      if (res.ok) {
        const data = await res.json()
        setSettings({
          paragraphSpacing: data.settings?.paragraphSpacing ?? null,
          paragraphIndent: data.settings?.paragraphIndent ?? null,
          codeBlockWrap: data.settings?.codeBlockWrap ?? null,
          sceneBreakStyle: data.settings?.sceneBreakStyle ?? null,
          dropCaps: data.settings?.dropCaps ?? null,
        })
        // smartDashes/smartEllipsis are edited from the editor, not this card,
        // but still shape what readers get — keep them for the summary line.
        const sanitized = sanitizeDisplaySettings(data.settings)
        setProjectExtras({
          ...(sanitized.smartDashes !== undefined && { smartDashes: sanitized.smartDashes }),
          ...(sanitized.smartEllipsis !== undefined && { smartEllipsis: sanitized.smartEllipsis }),
        })
      }
      if (userRes.ok) {
        const userData = await userRes.json()
        setUserDefaults(resolveDisplaySettings(sanitizeDisplaySettings(userData.settings), null, null))
      }
    } finally {
      setLoading(false)
    }
  }, [apiToken, projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load()
  }, [load])

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  function flash(message: string) {
    setSavedFlash(message)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setSavedFlash(null), 1800)
  }

  async function save(patch: Partial<ProjectSettings>, flashMessage = 'Saved') {
    if (!apiToken) return
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/manuscript-display-settings`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) flash(flashMessage)
    } catch {
      // surface a passive error? keep optimistic state for now
    }
  }

  function applyPreset(presetId: string) {
    const preset = DISPLAY_PRESETS.find(p => p.id === presetId)
    if (!preset) return
    save(preset.values, `${preset.name} preset applied`)
  }

  function clearOverrides() {
    save(empty, 'Cleared — inheriting from your defaults')
  }

  const hasAnyOverride = Object.values(settings).some(v => v !== null)

  /** A preset is "active" when the project overrides exactly match its values for the fields this card edits. */
  function presetMatches(preset: (typeof DISPLAY_PRESETS)[number]): boolean {
    return CARD_FIELDS.every(f => (settings[f] ?? null) === (preset.values[f] ?? null))
  }

  const inheritNote = (effective: string | undefined) =>
    effective !== undefined ? `your default: ${effective}` : undefined

  if (loading) {
    return (
      <CollapsibleCard title="Manuscript Display">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      </CollapsibleCard>
    )
  }

  const resolved = resolveDisplaySettings(userDefaults, { ...settings, ...projectExtras }, null)

  return (
    <CollapsibleCard title="Manuscript Display">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Overrides for this project. Inherit uses your defaults;
          chapters can override in the editor.
        </p>
        <div className="flex items-center gap-3 flex-shrink-0">
          {savedFlash && (
            <span className="inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 transition-opacity whitespace-nowrap">
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42L8.5 12.08l6.79-6.79a1 1 0 011.41 0z" clipRule="evenodd" />
              </svg>
              {savedFlash}
            </span>
          )}
          {hasAnyOverride && (
            <button
              type="button"
              onClick={clearOverrides}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
        <Field
          label="Paragraph spacing"
          hint={HINTS.paragraphSpacing}
          inheritNote={settings.paragraphSpacing === null
            ? inheritNote(userDefaults ? PARAGRAPH_SPACING_LABELS[userDefaults.paragraphSpacing] : undefined)
            : undefined}
        >
          <Segmented
            ariaLabel="Paragraph spacing"
            value={settings.paragraphSpacing ?? ''}
            onChange={v => save({ paragraphSpacing: (v || null) as ParagraphSpacing | null })}
            options={[
              { value: '', label: 'Inherit' },
              ...PARAGRAPH_SPACING_VALUES.map(v => ({ value: v, label: PARAGRAPH_SPACING_LABELS[v] })),
            ]}
          />
        </Field>

        <Field
          label="Paragraph indent"
          hint={HINTS.paragraphIndent}
          inheritNote={settings.paragraphIndent === null
            ? inheritNote(userDefaults ? PARAGRAPH_INDENT_LABELS[userDefaults.paragraphIndent] : undefined)
            : undefined}
        >
          <Segmented
            ariaLabel="Paragraph indent"
            value={settings.paragraphIndent ?? ''}
            onChange={v => save({ paragraphIndent: (v || null) as ParagraphIndent | null })}
            options={[
              { value: '', label: 'Inherit' },
              { value: 'none', label: 'None' },
              { value: 'first-line', label: 'First-line' },
              { value: 'every', label: 'Every' },
            ]}
          />
        </Field>

        <Field
          label="Scene break style"
          hint={HINTS.sceneBreakStyle}
          inheritNote={settings.sceneBreakStyle === null
            ? inheritNote(userDefaults ? SCENE_BREAK_LABELS[userDefaults.sceneBreakStyle] : undefined)
            : undefined}
        >
          <Segmented
            ariaLabel="Scene break style"
            value={settings.sceneBreakStyle ?? ''}
            onChange={v => save({ sceneBreakStyle: (v || null) as SceneBreakStyle | null })}
            options={[
              { value: '', label: 'Inherit' },
              { value: 'asterism', label: 'Asterism' },
              { value: 'rule', label: 'Rule' },
              { value: 'blank-line', label: 'Blank line' },
            ]}
          />
        </Field>

        <Field
          label="Code block wrap"
          hint={HINTS.codeBlockWrap}
          inheritNote={settings.codeBlockWrap === null
            ? inheritNote(userDefaults ? (userDefaults.codeBlockWrap ? 'On' : 'Off') : undefined)
            : undefined}
        >
          <Segmented
            ariaLabel="Code block wrap"
            value={settings.codeBlockWrap === null ? '' : settings.codeBlockWrap ? 'on' : 'off'}
            onChange={v => save({ codeBlockWrap: v === '' ? null : v === 'on' })}
            options={[
              { value: '', label: 'Inherit' },
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
          />
        </Field>

        <Field
          label="Drop caps"
          hint={HINTS.dropCaps}
          inheritNote={settings.dropCaps === null
            ? inheritNote(userDefaults ? (userDefaults.dropCaps ? 'On' : 'Off') : undefined)
            : undefined}
        >
          <Segmented
            ariaLabel="Drop caps"
            value={settings.dropCaps === null ? '' : settings.dropCaps ? 'on' : 'off'}
            onChange={v => save({ dropCaps: v === '' ? null : v === 'on' })}
            options={[
              { value: '', label: 'Inherit' },
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
          />
        </Field>
      </div>

      {userDefaults && (
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Readers get: {summarizeDisplaySettings(resolved)}.
        </p>
      )}

      <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Quick styles</span>
          <HintTip>
            One-click sets the fields above to a known style. The highlighted style is the one the
            current settings match; the individual controls still override.
          </HintTip>
          <span className="text-xs text-gray-400 dark:text-gray-500">— applies to this project</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DISPLAY_PRESETS.map(preset => {
            const active = presetMatches(preset)
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                title={preset.description}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : preset.id === 'inherit'
                      ? 'border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-900/70'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 text-gray-800 dark:text-gray-100'
                }`}
              >
                {preset.name}
              </button>
            )
          })}
        </div>
      </div>
    </CollapsibleCard>
  )
}
