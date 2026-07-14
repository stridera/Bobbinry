'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'
import { HintTip } from '@/components/HintTip'
import { CollapsibleCard } from './CollapsibleCard'
import {
  DISPLAY_PRESETS,
  PARAGRAPH_SPACING_VALUES,
  PARAGRAPH_INDENT_VALUES,
  SCENE_BREAK_VALUES,
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

const rowSelectClass =
  'w-56 px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 ' +
  'text-gray-900 dark:text-gray-100 rounded-md text-xs focus:ring-2 focus:ring-blue-500/40 outline-none ' +
  'disabled:opacity-50 cursor-pointer'

function SettingRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center text-sm text-gray-700 dark:text-gray-300">
        {label}
        <HintTip>{hint}</HintTip>
      </span>
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

  const inheritLabel = (effective: string | undefined) =>
    effective ? `Inherit — currently ${effective}` : 'Inherit from your default'

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
          Overrides for this project. Empty fields inherit from your defaults;
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

      <div className="space-y-3">
        <SettingRow label="Paragraph spacing" hint={HINTS.paragraphSpacing}>
          <select
            className={rowSelectClass}
            value={settings.paragraphSpacing ?? ''}
            onChange={e => save({ paragraphSpacing: (e.target.value || null) as ParagraphSpacing | null })}
          >
            <option value="">{inheritLabel(userDefaults && PARAGRAPH_SPACING_LABELS[userDefaults.paragraphSpacing] || undefined)}</option>
            {PARAGRAPH_SPACING_VALUES.map(v => (
              <option key={v} value={v}>{PARAGRAPH_SPACING_LABELS[v]}</option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="Paragraph indent" hint={HINTS.paragraphIndent}>
          <select
            className={rowSelectClass}
            value={settings.paragraphIndent ?? ''}
            onChange={e => save({ paragraphIndent: (e.target.value || null) as ParagraphIndent | null })}
          >
            <option value="">{inheritLabel(userDefaults && PARAGRAPH_INDENT_LABELS[userDefaults.paragraphIndent] || undefined)}</option>
            {PARAGRAPH_INDENT_VALUES.map(v => (
              <option key={v} value={v}>{PARAGRAPH_INDENT_LABELS[v]}</option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="Scene break style" hint={HINTS.sceneBreakStyle}>
          <select
            className={rowSelectClass}
            value={settings.sceneBreakStyle ?? ''}
            onChange={e => save({ sceneBreakStyle: (e.target.value || null) as SceneBreakStyle | null })}
          >
            <option value="">{inheritLabel(userDefaults && SCENE_BREAK_LABELS[userDefaults.sceneBreakStyle] || undefined)}</option>
            {SCENE_BREAK_VALUES.map(v => (
              <option key={v} value={v}>{SCENE_BREAK_LABELS[v]}</option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="Code block wrap" hint={HINTS.codeBlockWrap}>
          <TriSelect
            value={settings.codeBlockWrap}
            inheritLabel={inheritLabel(userDefaults ? (userDefaults.codeBlockWrap ? 'On' : 'Off') : undefined)}
            onChange={v => save({ codeBlockWrap: v })}
          />
        </SettingRow>

        <SettingRow label="Drop caps" hint={HINTS.dropCaps}>
          <TriSelect
            value={settings.dropCaps}
            inheritLabel={inheritLabel(userDefaults ? (userDefaults.dropCaps ? 'On' : 'Off') : undefined)}
            onChange={v => save({ dropCaps: v })}
          />
        </SettingRow>
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
            One-click sets the fields above to a known style. Useful for the most common layouts; the individual selects still override.
          </HintTip>
          <span className="text-xs text-gray-400 dark:text-gray-500">— applies to this project</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DISPLAY_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              title={preset.description}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                preset.id === 'inherit'
                  ? 'border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-900/70'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 text-gray-800 dark:text-gray-100'
              }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
    </CollapsibleCard>
  )
}

function TriSelect({
  value,
  inheritLabel,
  onChange,
}: {
  value: boolean | null
  inheritLabel?: string
  onChange: (v: boolean | null) => void
}) {
  return (
    <select
      className={rowSelectClass}
      value={value === null ? '' : value ? 'on' : 'off'}
      onChange={e => {
        const v = e.target.value
        onChange(v === '' ? null : v === 'on')
      }}
    >
      <option value="">{inheritLabel ?? 'Inherit from your default'}</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  )
}
