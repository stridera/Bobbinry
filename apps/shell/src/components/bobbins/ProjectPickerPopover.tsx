'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { ModalFrame } from '@bobbinry/ui-components'
import { apiFetch } from '@/lib/api'
import { BobbinMetadata } from './types'

/**
 * Pull the most useful error string out of an API error response. Prefers the
 * server's `message` field (added by typed errors / `ApiError`), falls back to
 * `error`, then to a caller-provided default. Used so users see "Manifest path
 * must be within the bobbins directory" instead of an opaque "Installation
 * failed".
 */
async function extractApiError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null) as { message?: string; error?: string } | null
  return data?.message || data?.error || fallback
}

interface Project {
  id: string
  name: string
  hasBobbinInstalled: boolean
}

interface UserCollection {
  id: string
  name: string
  hasBobbinInstalled: boolean
}

interface ProjectPickerModalProps {
  bobbin: BobbinMetadata
  onClose: () => void
}

export function ProjectPickerPopover({ bobbin, onClose }: ProjectPickerModalProps) {
  const { data: session } = useSession()
  const [projects, setProjects] = useState<Project[]>([])
  const [collections, setCollections] = useState<UserCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ targetId: string; type: 'success' | 'error'; text: string } | null>(null)

  const userId = session?.user?.id
  const apiToken = session?.apiToken

  // Determine supported scopes from the bobbin's manifest
  const manifestScopes: string[] = (bobbin as any).install?.scopes || (bobbin as any).scopes || ['project']
  const supportsCollection = manifestScopes.includes('collection')

  useEffect(() => {
    if (!userId || !apiToken) return
    const load = async () => {
      try {
        const [projectsRes, collectionsRes] = await Promise.all([
          apiFetch('/api/users/me/projects/grouped', apiToken),
          supportsCollection ? apiFetch('/api/users/me/collections', apiToken) : Promise.resolve(null),
        ])

        // --- Projects ---
        const allProjects: { id: string; name: string }[] = []
        if (projectsRes.ok) {
          const data = await projectsRes.json()
          if (data.collections) {
            for (const col of data.collections) {
              for (const p of col.projects) {
                allProjects.push({ id: p.id, name: p.name })
              }
            }
          }
          if (data.uncategorized) {
            for (const p of data.uncategorized) {
              allProjects.push({ id: p.id, name: p.name })
            }
          }
        }

        // Check which projects already have this bobbin installed
        const enrichedProjects = await Promise.all(
          allProjects.map(async (project) => {
            try {
              const bobbinRes = await apiFetch(`/api/projects/${project.id}/bobbins`, apiToken)
              if (bobbinRes.ok) {
                const bobbinData = await bobbinRes.json()
                const installed = (bobbinData.bobbins || []).some(
                  (b: { id: string }) => b.id === bobbin.id
                )
                return { ...project, hasBobbinInstalled: installed }
              }
            } catch {
              // Fall through
            }
            return { ...project, hasBobbinInstalled: false }
          })
        )
        setProjects(enrichedProjects)

        // --- Collections ---
        if (collectionsRes && collectionsRes.ok) {
          const colData = await collectionsRes.json()
          const userCols: { id: string; name: string }[] = (colData.collections || []).map((c: any) => ({ id: c.id, name: c.name }))

          const enrichedCols = await Promise.all(
            userCols.map(async (col) => {
              try {
                const bobbinRes = await apiFetch(`/api/collections/${col.id}/bobbins`, apiToken)
                if (bobbinRes.ok) {
                  const bobbinData = await bobbinRes.json()
                  const installed = (bobbinData.bobbins || []).some(
                    (b: { id: string }) => b.id === bobbin.id
                  )
                  return { ...col, hasBobbinInstalled: installed }
                }
              } catch {
                // Fall through
              }
              return { ...col, hasBobbinInstalled: false }
            })
          )
          setCollections(enrichedCols)
        }
      } catch (err) {
        console.error('Failed to load targets:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [userId, apiToken, bobbin.id, supportsCollection])

  const handleInstallToProject = async (projectId: string) => {
    if (!apiToken) return
    setBusy(projectId)
    setResult(null)

    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/bobbins/install`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifestContent: bobbin.manifestContent, manifestType: 'yaml' })
        }
      )
      if (!response.ok) {
        throw new Error(await extractApiError(response, 'Installation failed'))
      }
      setResult({ targetId: projectId, type: 'success', text: 'Installed!' })
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, hasBobbinInstalled: true } : p
      ))
    } catch (err) {
      setResult({ targetId: projectId, type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setBusy(null)
    }
  }

  const handleUninstallFromProject = async (projectId: string) => {
    if (!apiToken) return
    setBusy(projectId)
    setResult(null)

    try {
      const response = await apiFetch(`/api/projects/${projectId}/bobbins/${bobbin.id}`, apiToken, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await extractApiError(response, 'Uninstall failed'))
      }
      setResult({ targetId: projectId, type: 'success', text: 'Uninstalled!' })
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, hasBobbinInstalled: false } : p
      ))
    } catch (err) {
      setResult({ targetId: projectId, type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setBusy(null)
    }
  }

  const handleInstallToCollection = async (collectionId: string) => {
    if (!apiToken) return
    setBusy(collectionId)
    setResult(null)

    try {
      const response = await apiFetch(
        `/api/collections/${collectionId}/bobbins/install`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifestContent: bobbin.manifestContent, manifestType: 'yaml' })
        }
      )
      if (!response.ok) {
        throw new Error(await extractApiError(response, 'Installation failed'))
      }
      setResult({ targetId: collectionId, type: 'success', text: 'Installed!' })
      setCollections(prev => prev.map(c =>
        c.id === collectionId ? { ...c, hasBobbinInstalled: true } : c
      ))
    } catch (err) {
      setResult({ targetId: collectionId, type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setBusy(null)
    }
  }

  const handleUninstallFromCollection = async (collectionId: string) => {
    if (!apiToken) return
    setBusy(collectionId)
    setResult(null)

    try {
      const response = await apiFetch(`/api/collections/${collectionId}/bobbins/${bobbin.id}`, apiToken, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await extractApiError(response, 'Uninstall failed'))
      }
      setResult({ targetId: collectionId, type: 'success', text: 'Uninstalled!' })
      setCollections(prev => prev.map(c =>
        c.id === collectionId ? { ...c, hasBobbinInstalled: false } : c
      ))
    } catch (err) {
      setResult({ targetId: collectionId, type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setBusy(null)
    }
  }

  function renderTarget(
    target: { id: string; name: string; hasBobbinInstalled: boolean },
    onInstall: (id: string) => void,
    onUninstall: (id: string) => void,
    badge?: string
  ) {
    return (
      <div
        key={target.id}
        className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800/50 last:border-b-0"
      >
        <div className="flex items-center gap-2 truncate mr-3">
          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
            {target.name}
          </span>
          {badge && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {badge}
            </span>
          )}
        </div>
        {result?.targetId === target.id ? (
          <span className={`text-xs font-medium px-2 py-1 rounded ${
            result.type === 'success'
              ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
              : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
          }`}>
            {result.text}
          </span>
        ) : target.hasBobbinInstalled ? (
          <button
            onClick={() => onUninstall(target.id)}
            disabled={busy === target.id}
            className="shrink-0 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
          >
            {busy === target.id ? 'Removing...' : 'Uninstall'}
          </button>
        ) : (
          <button
            onClick={() => onInstall(target.id)}
            disabled={busy === target.id}
            className="shrink-0 px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {busy === target.id ? 'Installing...' : 'Install'}
          </button>
        )}
      </div>
    )
  }

  return (
    <ModalFrame onClose={onClose} ariaLabel={`Install ${bobbin.name}`}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Install <span className="font-semibold">{bobbin.name}</span> to:
          </p>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Target list */}
        <div className="max-h-80 overflow-auto">
          {loading ? (
            <div className="p-6 text-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 dark:border-blue-400 mx-auto" />
            </div>
          ) : (projects.length === 0 && collections.length === 0) ? (
            <div className="p-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">No projects yet</p>
              <Link
                href="/dashboard"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Go to Dashboard
              </Link>
            </div>
          ) : (
            <>
              {/* Collections section */}
              {collections.length > 0 && (
                <>
                  <div className="px-5 py-2 bg-gray-50 dark:bg-gray-800/50 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Series
                  </div>
                  {collections.map(col =>
                    renderTarget(col, handleInstallToCollection, handleUninstallFromCollection, 'series')
                  )}
                </>
              )}

              {/* Projects section */}
              {projects.length > 0 && (
                <>
                  <div className="px-5 py-2 bg-gray-50 dark:bg-gray-800/50 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Projects
                  </div>
                  {projects.map(project =>
                    renderTarget(project, handleInstallToProject, handleUninstallFromProject)
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </ModalFrame>
  )
}
