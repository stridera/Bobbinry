'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'
import { HintTip } from '@/components/HintTip'
import {
  DISPLAY_PRESETS,
  PARAGRAPH_SPACING_VALUES,
  PARAGRAPH_INDENT_VALUES,
  SCENE_BREAK_VALUES,
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

const PARAGRAPH_SPACING_LABEL: Record<ParagraphSpacing, string> = {
  standard: 'Standard',
  manuscript: 'Manuscript',
}
const PARAGRAPH_INDENT_LABEL: Record<ParagraphIndent, string> = {
  none: 'No indent',
  'first-line': 'First-line indent',
  every: 'Every paragraph indented',
}
const SCENE_BREAK_LABEL: Record<SceneBreakStyle, string> = {
  asterism: 'Asterism (* * *)',
  rule: 'Horizontal rule',
  'blank-line': 'Blank line',
}

const inputClass =
  'w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 ' +
  'text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none ' +
  'disabled:opacity-50 cursor-pointer'

const labelClass = 'flex items-center text-xs text-gray-500 dark:text-gray-400 mb-1'

export function ManuscriptDisplaySettings({ projectId }: { projectId: string }) {
  const { data: session } = useSession()
  const apiToken = session?.apiToken
  const [settings, setSettings] = useState<ProjectSettings>(empty)
  const [loading, setLoading] = useState(true)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!apiToken) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/manuscript-display-settings`, apiToken)
      if (res.ok) {
        const data = await res.json()
        setSettings({
          paragraphSpacing: data.settings?.paragraphSpacing ?? null,
          paragraphIndent: data.settings?.paragraphIndent ?? null,
          codeBlockWrap: data.settings?.codeBlockWrap ?? null,
          sceneBreakStyle: data.settings?.sceneBreakStyle ?? null,
          dropCaps: data.settings?.dropCaps ?? null,
        })
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

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Manuscript Display</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Manuscript Display</h2>
        <div className="flex items-center gap-3">
          {savedFlash && (
            <span className="inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 transition-opacity">
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
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Project-level overrides. Empty fields inherit from your user defaults.
        Each chapter can override these from the editor.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            Paragraph spacing
            <HintTip>{HINTS.paragraphSpacing}</HintTip>
          </label>
          <select
            className={inputClass}
            value={settings.paragraphSpacing ?? ''}
            onChange={e => save({ paragraphSpacing: (e.target.value || null) as ParagraphSpacing | null })}
          >
            <option value="">Inherit from your default</option>
            {PARAGRAPH_SPACING_VALUES.map(v => (
              <option key={v} value={v}>{PARAGRAPH_SPACING_LABEL[v]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>
            Paragraph indent
            <HintTip>{HINTS.paragraphIndent}</HintTip>
          </label>
          <select
            className={inputClass}
            value={settings.paragraphIndent ?? ''}
            onChange={e => save({ paragraphIndent: (e.target.value || null) as ParagraphIndent | null })}
          >
            <option value="">Inherit from your default</option>
            {PARAGRAPH_INDENT_VALUES.map(v => (
              <option key={v} value={v}>{PARAGRAPH_INDENT_LABEL[v]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>
            Scene break style
            <HintTip>{HINTS.sceneBreakStyle}</HintTip>
          </label>
          <select
            className={inputClass}
            value={settings.sceneBreakStyle ?? ''}
            onChange={e => save({ sceneBreakStyle: (e.target.value || null) as SceneBreakStyle | null })}
          >
            <option value="">Inherit from your default</option>
            {SCENE_BREAK_VALUES.map(v => (
              <option key={v} value={v}>{SCENE_BREAK_LABEL[v]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>
            Code block wrap
            <HintTip>{HINTS.codeBlockWrap}</HintTip>
          </label>
          <TriSelect
            value={settings.codeBlockWrap}
            onChange={v => save({ codeBlockWrap: v })}
          />
        </div>

        <div>
          <label className={labelClass}>
            Drop caps
            <HintTip>{HINTS.dropCaps}</HintTip>
          </label>
          <TriSelect
            value={settings.dropCaps}
            onChange={v => save({ dropCaps: v })}
          />
        </div>
      </div>

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
    </div>
  )
}

function TriSelect({
  value,
  onChange,
}: {
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  return (
    <select
      className={inputClass}
      value={value === null ? '' : value ? 'on' : 'off'}
      onChange={e => {
        const v = e.target.value
        onChange(v === '' ? null : v === 'on')
      }}
    >
      <option value="">Inherit from your default</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  )
}
