'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'

interface InstalledReaderBobbin {
  id: string
  bobbinId: string
  bobbinType: string
  config: Record<string, any> | null
  isEnabled: boolean
  installedAt: string
}

interface AvailableReaderBobbin {
  id: string
  name: string
  description: string
  type: 'automation' | 'reader'
  icon?: string
}

// Available reader bobbins (in production, fetched from a registry)
const AVAILABLE_READER_BOBBINS: AvailableReaderBobbin[] = [
  {
    id: 'default-reader',
    name: 'Default Reader',
    description: 'The standard on-platform reading experience with themes, font sizes, and progress tracking.',
    type: 'reader',
  },
  {
    id: 'kindle-sender',
    name: 'Kindle Sender',
    description: 'Automatically send new chapters to your Kindle email when content becomes available.',
    type: 'automation',
  },
  {
    id: 'translation-reader',
    name: 'Translation Reader',
    description: 'Translate chapter content to your preferred language while reading.',
    type: 'reader',
  },
]

export default function ReaderBobbinsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [installed, setInstalled] = useState<InstalledReaderBobbin[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const userId = session?.user?.id
  const apiToken = (session as any)?.apiToken

  const loadInstalled = useCallback(async () => {
    if (!userId || !apiToken) return
    try {
      const res = await apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken)
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
      loadInstalled()
    }
  }, [status, loadInstalled, router])

  const installBobbin = async (bobbinId: string, bobbinType: string) => {
    if (!userId || !apiToken) return
    setActionInProgress(bobbinId)
    try {
      const res = await apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bobbinId, bobbinType }),
      })
      if (res.ok) {
        await loadInstalled()
      }
    } catch (err) {
      console.error('Failed to install reader bobbin:', err)
    } finally {
      setActionInProgress(null)
    }
  }

  const uninstallBobbin = async (installId: string) => {
    if (!userId || !apiToken) return
    setActionInProgress(installId)
    try {
      const res = await apiFetch(`/api/users/${userId}/reader-bobbins/${installId}`, apiToken, {
        method: 'DELETE',
      })
      if (res.ok) {
        await loadInstalled()
      }
    } catch (err) {
      console.error('Failed to uninstall reader bobbin:', err)
    } finally {
      setActionInProgress(null)
    }
  }

  const toggleBobbin = async (installId: string, enabled: boolean) => {
    if (!userId || !apiToken) return
    setActionInProgress(installId)
    try {
      await apiFetch(`/api/users/${userId}/reader-bobbins/${installId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: enabled }),
      })
      await loadInstalled()
    } catch (err) {
      console.error('Failed to toggle reader bobbin:', err)
    } finally {
      setActionInProgress(null)
    }
  }

  const installedIds = new Set(installed.map(b => b.bobbinId))

  const automationBobbins = AVAILABLE_READER_BOBBINS.filter(b => b.type === 'automation')
  const readerBobbins = AVAILABLE_READER_BOBBINS.filter(b => b.type === 'reader')

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
            Customize your reading experience with installable extensions.
          </p>
        </div>

        {/* Installed bobbins */}
        {installed.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Installed
            </h2>
            <div className="space-y-3">
              {installed.map(bobbin => {
                const info = AVAILABLE_READER_BOBBINS.find(b => b.id === bobbin.bobbinId)
                return (
                  <div
                    key={bobbin.id}
                    className="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900 dark:text-gray-100">
                          {info?.name || bobbin.bobbinId}
                        </h3>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          bobbin.bobbinType === 'automation'
                            ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
                            : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        }`}>
                          {bobbin.bobbinType === 'automation' ? 'Automation' : 'Reader'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {info?.description || 'Reader bobbin'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleBobbin(bobbin.id, !bobbin.isEnabled)}
                        disabled={actionInProgress === bobbin.id}
                        className={`px-3 py-1.5 text-xs rounded transition-colors ${
                          bobbin.isEnabled
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {bobbin.isEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={() => uninstallBobbin(bobbin.id)}
                        disabled={actionInProgress === bobbin.id}
                        className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded transition-colors disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Available reader bobbins */}
        <section className="mb-10">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Reading Extensions
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            These bobbins add UI features to your reading experience.
          </p>
          <div className="space-y-3">
            {readerBobbins.map(bobbin => {
              const isInstalled = installedIds.has(bobbin.id)
              return (
                <div
                  key={bobbin.id}
                  className="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{bobbin.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{bobbin.description}</p>
                  </div>
                  {isInstalled ? (
                    <span className="text-xs text-green-600 dark:text-green-400 flex-shrink-0">Installed</span>
                  ) : (
                    <button
                      onClick={() => installBobbin(bobbin.id, 'reader_enhancement')}
                      disabled={actionInProgress === bobbin.id}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {actionInProgress === bobbin.id ? 'Installing...' : 'Install'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Available automation bobbins */}
        <section className="mb-10">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Automations
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            These run automatically when new content becomes available in your subscribed tiers.
          </p>
          <div className="space-y-3">
            {automationBobbins.map(bobbin => {
              const isInstalled = installedIds.has(bobbin.id)
              return (
                <div
                  key={bobbin.id}
                  className="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{bobbin.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{bobbin.description}</p>
                  </div>
                  {isInstalled ? (
                    <span className="text-xs text-green-600 dark:text-green-400 flex-shrink-0">Installed</span>
                  ) : (
                    <button
                      onClick={() => installBobbin(bobbin.id, 'delivery_channel')}
                      disabled={actionInProgress === bobbin.id}
                      className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {actionInProgress === bobbin.id ? 'Installing...' : 'Install'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
