'use client'

/**
 * Read-only summary of the manuscript display settings readers will get for
 * this project (user defaults + project overrides resolved). Surfaces the
 * effective values on the publisher page so authors don't have to hunt
 * through the settings cascade to know what's live.
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import {
  resolveDisplaySettings,
  sanitizeDisplaySettings,
  summarizeDisplaySettings,
  displayValueLabel,
  DISPLAY_FIELD_LABELS,
  MANUSCRIPT_DISPLAY_DEFAULTS,
  type ManuscriptDisplaySettings,
  type PartialManuscriptDisplaySettings,
} from '@bobbinry/types'

type Provenance = 'project' | 'user' | 'default'

const PROVENANCE_LABEL: Record<Provenance, string> = {
  project: 'From project',
  user: 'Your default',
  default: 'Bobbinry default',
}

const PROVENANCE_CLASS: Record<Provenance, string> = {
  project:
    'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  user:
    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  default:
    'bg-gray-50 text-gray-400 dark:bg-gray-800/60 dark:text-gray-500',
}

const FIELD_ORDER = Object.keys(DISPLAY_FIELD_LABELS) as (keyof ManuscriptDisplaySettings)[]

export function DisplaySettingsSummary({ projectId, apiToken }: { projectId: string; apiToken: string }) {
  const [userSettings, setUserSettings] = useState<PartialManuscriptDisplaySettings | null>(null)
  const [projectSettings, setProjectSettings] = useState<PartialManuscriptDisplaySettings | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [userRes, projectRes] = await Promise.all([
        apiFetch('/api/users/me/manuscript-display-settings', apiToken),
        apiFetch(`/api/projects/${projectId}/manuscript-display-settings`, apiToken),
      ])
      if (userRes.ok) {
        const data = await userRes.json()
        setUserSettings(sanitizeDisplaySettings(data.settings))
      }
      if (projectRes.ok) {
        const data = await projectRes.json()
        setProjectSettings(sanitizeDisplaySettings(data.settings))
      }
    } finally {
      setLoading(false)
    }
  }, [apiToken, projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load()
  }, [load])

  const resolved = resolveDisplaySettings(userSettings, projectSettings, null)

  function provenance(field: keyof ManuscriptDisplaySettings): Provenance {
    if (projectSettings?.[field] !== null && projectSettings?.[field] !== undefined) return 'project'
    if (userSettings?.[field] !== undefined && userSettings[field] !== MANUSCRIPT_DISPLAY_DEFAULTS[field]) return 'user'
    return 'default'
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-gray-900 dark:text-gray-100">
          Manuscript Display
        </h3>
        <Link
          href={`/projects/${projectId}#manuscript-display`}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Edit
        </Link>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            How chapters render for readers: {summarizeDisplaySettings(resolved)}.
          </p>
          <dl className="space-y-2">
            {FIELD_ORDER.map(field => (
              <div key={field} className="flex items-center justify-between gap-2">
                <dt className="text-sm text-gray-700 dark:text-gray-300">{DISPLAY_FIELD_LABELS[field]}</dt>
                <dd className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {displayValueLabel(field, resolved[field])}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${PROVENANCE_CLASS[provenance(field)]}`}>
                    {PROVENANCE_LABEL[provenance(field)]}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Individual chapters can override these from the editor.
          </p>
        </>
      )}
    </section>
  )
}
