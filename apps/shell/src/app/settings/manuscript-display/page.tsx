'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonPanel } from '@/components/LoadingState'
import { HintTip } from '@/components/HintTip'

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
  showFormattingMarks:
    'Adds pilcrows (¶) and break markers in the editor only. Helps spot extra blank lines or stray paragraph breaks while writing.',
}
import {
  DISPLAY_PRESETS,
  PARAGRAPH_SPACING_VALUES,
  PARAGRAPH_INDENT_VALUES,
  SCENE_BREAK_VALUES,
  type ParagraphSpacing,
  type ParagraphIndent,
  type SceneBreakStyle,
} from '@bobbinry/types'

interface UserDisplaySettings {
  paragraphSpacing: ParagraphSpacing
  paragraphIndent: ParagraphIndent
  codeBlockWrap: boolean
  sceneBreakStyle: SceneBreakStyle
  dropCaps: boolean
  showFormattingMarks: boolean
}

const defaults: UserDisplaySettings = {
  paragraphSpacing: 'standard',
  paragraphIndent: 'none',
  codeBlockWrap: false,
  sceneBreakStyle: 'asterism',
  dropCaps: false,
  showFormattingMarks: false,
}

const PARAGRAPH_SPACING_LABEL: Record<ParagraphSpacing, string> = {
  standard: 'Standard — extra space between paragraphs (HTML style)',
  manuscript: 'Manuscript — no extra space between paragraphs',
}
const PARAGRAPH_INDENT_LABEL: Record<ParagraphIndent, string> = {
  none: 'No indent',
  'first-line': 'First-line indent on every paragraph after the first',
  every: 'Indent every paragraph',
}
const SCENE_BREAK_LABEL: Record<SceneBreakStyle, string> = {
  asterism: 'Asterism — * * *',
  rule: 'Horizontal rule',
  'blank-line': 'Blank line',
}

function Toggle({
  enabled,
  onToggle,
  label,
  description,
  hint,
}: {
  enabled: boolean
  onToggle: () => void
  label: string
  description?: string
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 inline-flex items-center">
          {label}
          {hint && <HintTip>{hint}</HintTip>}
        </p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
          enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

export default function ManuscriptDisplaySettingsPage() {
  const { data: session, status } = useSession()
  const apiToken = session?.apiToken
  const [settings, setSettings] = useState<UserDisplaySettings>(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') redirect('/login')
  }, [status])

  const load = useCallback(async () => {
    if (!apiToken) return
    setLoading(true)
    try {
      const res = await apiFetch('/api/users/me/manuscript-display-settings', apiToken)
      if (res.ok) {
        const data = await res.json()
        setSettings({ ...defaults, ...data.settings })
      }
    } catch {
      setError('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [apiToken])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load()
  }, [load])

  async function save(patch: Partial<UserDisplaySettings>) {
    if (!apiToken) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    const optimistic = { ...settings, ...patch }
    setSettings(optimistic)
    try {
      const res = await apiFetch('/api/users/me/manuscript-display-settings', apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        setError('Failed to save')
        return
      }
      setSuccess('Saved')
      setTimeout(() => setSuccess(null), 1500)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <SiteNav />
        <div className="max-w-3xl mx-auto px-4 py-10">
          <SkeletonPanel />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link
            href="/settings"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            &larr; Settings
          </Link>
        </div>

        <h1 className="font-display text-3xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Manuscript Display
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Your defaults for how prose is rendered while you write and on your public reader page.
          Each project and each chapter can override these.
        </p>

        {error && (
          <div className="mb-4 px-4 py-2 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{error}</div>
        )}
        {success && (
          <div className="mb-4 px-4 py-2 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm">{success}</div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-5">
          <div>
            <label className="inline-flex items-center text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Paragraph spacing
              <HintTip>{HINTS.paragraphSpacing}</HintTip>
            </label>
            <select
              className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm"
              value={settings.paragraphSpacing}
              onChange={e => save({ paragraphSpacing: e.target.value as ParagraphSpacing })}
              disabled={saving}
            >
              {PARAGRAPH_SPACING_VALUES.map(v => (
                <option key={v} value={v}>{PARAGRAPH_SPACING_LABEL[v]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="inline-flex items-center text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Paragraph indent
              <HintTip>{HINTS.paragraphIndent}</HintTip>
            </label>
            <select
              className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm"
              value={settings.paragraphIndent}
              onChange={e => save({ paragraphIndent: e.target.value as ParagraphIndent })}
              disabled={saving}
            >
              {PARAGRAPH_INDENT_VALUES.map(v => (
                <option key={v} value={v}>{PARAGRAPH_INDENT_LABEL[v]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="inline-flex items-center text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Scene break style
              <HintTip>{HINTS.sceneBreakStyle}</HintTip>
            </label>
            <select
              className="w-full bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm"
              value={settings.sceneBreakStyle}
              onChange={e => save({ sceneBreakStyle: e.target.value as SceneBreakStyle })}
              disabled={saving}
            >
              {SCENE_BREAK_VALUES.map(v => (
                <option key={v} value={v}>{SCENE_BREAK_LABEL[v]}</option>
              ))}
            </select>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            <Toggle
              enabled={settings.codeBlockWrap}
              onToggle={() => save({ codeBlockWrap: !settings.codeBlockWrap })}
              label="Wrap long lines in code blocks"
              description="Useful when you use code blocks for in-fiction system messages."
              hint={HINTS.codeBlockWrap}
            />
            <Toggle
              enabled={settings.dropCaps}
              onToggle={() => save({ dropCaps: !settings.dropCaps })}
              label="Drop caps"
              description="Large first letter on the first paragraph after each heading."
              hint={HINTS.dropCaps}
            />
            <Toggle
              enabled={settings.showFormattingMarks}
              onToggle={() => save({ showFormattingMarks: !settings.showFormattingMarks })}
              label="Show formatting marks while editing"
              description="Pilcrows and line-break arrows in the editor only. Doesn’t affect the reader."
              hint={HINTS.showFormattingMarks}
            />
          </div>

          <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Quick styles</span>
              <HintTip>
                One-click sets every field above to a known style. The individual selects still override afterwards.
              </HintTip>
            </div>
            <div className="flex flex-wrap gap-2">
              {DISPLAY_PRESETS
                // User defaults have no layer above to inherit from.
                .filter(preset => preset.id !== 'inherit')
                .map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => save(preset.values as Partial<UserDisplaySettings>)}
                    disabled={saving}
                    title={preset.description}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 text-gray-800 dark:text-gray-100 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {preset.name}
                  </button>
                ))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-snug">
              Hover a preset to see what it sets.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
