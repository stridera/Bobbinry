'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'
import { fetchReaderBobbinCatalog, type ReaderBobbinCatalogEntry } from '@/hooks/useReaderBobbins'

interface InstalledReaderBobbin {
  id: string
  bobbinId: string
  bobbinType: string
  config: Record<string, any> | null
  isEnabled: boolean
  installedAt: string
}

const CARD_CLASS =
  'p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4'

export default function ReaderBobbinsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [installed, setInstalled] = useState<InstalledReaderBobbin[]>([])
  const [catalog, setCatalog] = useState<ReaderBobbinCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const userId = session?.user?.id
  const apiToken = (session as any)?.apiToken

  const loadAll = useCallback(async () => {
    if (!userId || !apiToken) return
    try {
      const [catalogEntries, res] = await Promise.all([
        fetchReaderBobbinCatalog(),
        apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken),
      ])
      setCatalog(catalogEntries)
      if (res.ok) {
        const data = await res.json()
        setInstalled(data.bobbins || [])
      }
    } catch (err) {
      console.error('Failed to load reader bobbins:', err)
    } finally {
      setLoading(false)
    }
  }, [userId, apiToken])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
      return
    }
    if (status === 'authenticated') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      loadAll()
    }
  }, [status, loadAll, router])

  const rowFor = (bobbinId: string) => installed.find(b => b.bobbinId === bobbinId)

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    if (!userId || !apiToken) return
    setActionInProgress(key)
    try {
      await action()
      await loadAll()
    } catch (err) {
      console.error('Reader bobbin action failed:', err)
    } finally {
      setActionInProgress(null)
    }
  }

  /**
   * Reader-type bobbins are on for everyone by default. Disabling records an
   * opt-out row (isEnabled=false); re-enabling flips that row back.
   */
  const setReaderBobbinEnabled = (bobbinId: string, enabled: boolean) =>
    runAction(bobbinId, async () => {
      const row = rowFor(bobbinId)
      if (row) {
        await apiFetch(`/api/users/${userId}/reader-bobbins/${row.id}`, apiToken, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isEnabled: enabled }),
        })
      } else if (!enabled) {
        await apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bobbinId, bobbinType: 'reader_enhancement', isEnabled: false }),
        })
      }
    })

  const installAutomation = (bobbinId: string) =>
    runAction(bobbinId, () =>
      apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bobbinId, bobbinType: 'delivery_channel' }),
      })
    )

  const toggleRow = (row: InstalledReaderBobbin) =>
    runAction(row.id, () =>
      apiFetch(`/api/users/${userId}/reader-bobbins/${row.id}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !row.isEnabled }),
      })
    )

  const removeRow = (row: InstalledReaderBobbin) =>
    runAction(row.id, () =>
      apiFetch(`/api/users/${userId}/reader-bobbins/${row.id}`, apiToken, { method: 'DELETE' })
    )

  const catalogIds = new Set(catalog.map(b => b.id))
  const readerBobbins = catalog.filter(b => b.readerBobbinType === 'reader')
  const automationBobbins = catalog.filter(b => b.readerBobbinType === 'automation')
  // Rows for bobbins that no longer exist in the catalog (legacy installs).
  const orphanRows = installed.filter(row => !catalogIds.has(row.bobbinId))

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href="/settings" className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            &larr; Settings
          </Link>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
            Reader Bobbins
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Customize your reading experience. Reading extensions are on for everyone; switch off any you don&apos;t want.
          </p>
        </div>

        {/* Reader-type bobbins: on by default, opt-out */}
        <section className="mb-10">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Reading Extensions
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            These bobbins add controls to the chapter reader.
          </p>
          <div className="space-y-3">
            {readerBobbins.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500">No reading extensions are available right now.</p>
            )}
            {readerBobbins.map(bobbin => {
              const row = rowFor(bobbin.id)
              const enabled = row ? row.isEnabled : true
              const busy = actionInProgress === bobbin.id
              return (
                <div key={bobbin.id} className={CARD_CLASS}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{bobbin.name}</h3>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">v{bobbin.version}</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{bobbin.description}</p>
                  </div>
                  <button
                    onClick={() => setReaderBobbinEnabled(bobbin.id, !enabled)}
                    disabled={busy}
                    aria-pressed={enabled}
                    className={`px-3 py-1.5 text-xs rounded transition-colors flex-shrink-0 disabled:opacity-50 ${
                      enabled
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {busy ? 'Saving...' : enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        {/* Automation bobbins: install to enable */}
        <section className="mb-10">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Automations
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            These run automatically when new content becomes available in your subscribed tiers.
          </p>
          <div className="space-y-3">
            {automationBobbins.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500">No automations are available yet.</p>
            )}
            {automationBobbins.map(bobbin => {
              const row = rowFor(bobbin.id)
              const busy = actionInProgress === bobbin.id || actionInProgress === row?.id
              return (
                <div key={bobbin.id} className={CARD_CLASS}>
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{bobbin.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{bobbin.description}</p>
                  </div>
                  {row ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleRow(row)}
                        disabled={busy}
                        className={`px-3 py-1.5 text-xs rounded transition-colors disabled:opacity-50 ${
                          row.isEnabled
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {row.isEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={() => removeRow(row)}
                        disabled={busy}
                        className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded transition-colors disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => installAutomation(bobbin.id)}
                      disabled={busy}
                      className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {busy ? 'Installing...' : 'Install'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Legacy rows for bobbins that are no longer offered */}
        {orphanRows.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Other installed
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              These bobbins are no longer available. You can remove them.
            </p>
            <div className="space-y-3">
              {orphanRows.map(row => (
                <div key={row.id} className={CARD_CLASS}>
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{row.bobbinId}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {row.bobbinType === 'delivery_channel' ? 'Automation' : 'Reader extension'}
                    </p>
                  </div>
                  <button
                    onClick={() => removeRow(row)}
                    disabled={actionInProgress === row.id}
                    className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
