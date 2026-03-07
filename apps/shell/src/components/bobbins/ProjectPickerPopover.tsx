'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { BobbinMetadata } from './types'

interface Project {
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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ projectId: string; type: 'success' | 'error'; text: string } | null>(null)

  const userId = session?.user?.id
  const apiToken = session?.apiToken
  useEffect(() => {
    if (!userId || !apiToken) return
    const loadProjects = async () => {
      try {
        const res = await apiFetch('/api/users/me/projects/grouped', apiToken)
        if (!res.ok) return

        const data = await res.json()
        // Flatten collections + uncategorized into a simple project list
        const allProjects: { id: string; name: string }[] = []
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

        // Check which projects already have this bobbin installed
        const enriched = await Promise.all(
          allProjects.map(async (project) => {
            try {
              const bobbinRes = await apiFetch(
                `/api/projects/${project.id}/bobbins`,
                apiToken
              )
              if (bobbinRes.ok) {
                const bobbinData = await bobbinRes.json()
                const installed = (bobbinData.bobbins || []).some(
                  (b: { id: string }) => b.id === bobbin.id
                )
                return { ...project, hasBobbinInstalled: installed }
              }
            } catch {
              // Fall through — treat as not installed
            }
            return { ...project, hasBobbinInstalled: false }
          })
        )

        setProjects(enriched)
      } catch (err) {
        console.error('Failed to load projects:', err)
      } finally {
        setLoading(false)
      }
    }
    loadProjects()
  }, [userId, apiToken, bobbin.id])

  const handleInstall = async (projectId: string) => {
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
          body: JSON.stringify({ manifestPath: `bobbins/${bobbin.id}.manifest.yaml` })
        }
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Installation failed' }))
        throw new Error(err.error || 'Installation failed')
      }

      setResult({ projectId, type: 'success', text: 'Installed!' })
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, hasBobbinInstalled: true } : p
      ))
    } catch (err) {
      setResult({
        projectId,
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed'
      })
    } finally {
      setBusy(null)
    }
  }

  const handleUninstall = async (projectId: string) => {
    if (!apiToken) return
    setBusy(projectId)
    setResult(null)

    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/bobbins/${bobbin.id}`,
        apiToken,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Uninstall failed' }))
        throw new Error(err.error || 'Uninstall failed')
      }

      setResult({ projectId, type: 'success', text: 'Uninstalled!' })
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, hasBobbinInstalled: false } : p
      ))
    } catch (err) {
      setResult({
        projectId,
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed'
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
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

        {/* Project list */}
        <div className="max-h-72 overflow-auto">
          {loading ? (
            <div className="p-6 text-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 dark:border-blue-400 mx-auto" />
            </div>
          ) : projects.length === 0 ? (
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
            projects.map(project => (
              <div
                key={project.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800/50 last:border-b-0"
              >
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate mr-3">
                  {project.name}
                </span>
                {result?.projectId === project.id ? (
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    result.type === 'success'
                      ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                      : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                  }`}>
                    {result.text}
                  </span>
                ) : project.hasBobbinInstalled ? (
                  <button
                    onClick={() => handleUninstall(project.id)}
                    disabled={busy === project.id}
                    className="shrink-0 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                  >
                    {busy === project.id ? 'Removing...' : 'Uninstall'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleInstall(project.id)}
                    disabled={busy === project.id}
                    className="shrink-0 px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {busy === project.id ? 'Installing...' : 'Install'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
