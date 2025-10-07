'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

interface Project {
  id: string
  name: string
  description: string | null
  shortUrl: string | null
  isArchived: boolean
  ownerId: string
}

interface InstalledBobbin {
  id: string
  version: string
  manifest: {
    name: string
    description?: string
  }
  installedAt: string
}

export default function ProjectSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const projectId = params.projectId as string

  const [project, setProject] = useState<Project | null>(null)
  const [bobbins, setBobbins] = useState<InstalledBobbin[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    loadProject()
    loadBobbins()
  }, [projectId])

  const loadProject = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}`)
      if (response.ok) {
        const data = await response.json()
        setProject(data.project)
        setName(data.project.name)
        setDescription(data.project.description || '')
      }
    } catch (err) {
      console.error('Failed to load project:', err)
      setError('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const loadBobbins = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}/bobbins`)
      if (response.ok) {
        const data = await response.json()
        setBobbins(data.bobbins || [])
      }
    } catch (err) {
      console.error('Failed to load bobbins:', err)
    }
  }

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Project name is required')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null })
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to save settings' }))
        throw new Error(errorData.error || 'Failed to save settings')
      }

      const data = await response.json()
      setProject(data.project)
      setSuccess('Settings saved successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      console.error('Failed to save settings:', err)
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!project) return

    if (!confirm(`Are you sure you want to ${project.isArchived ? 'unarchive' : 'archive'} this project?`)) {
      return
    }

    try {
      const endpoint = project.isArchived ? 'unarchive' : 'archive'
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}/${endpoint}`,
        { method: 'PUT' }
      )

      if (response.ok) {
        await loadProject()
        setSuccess(`Project ${project.isArchived ? 'unarchived' : 'archived'} successfully`)
        setTimeout(() => setSuccess(null), 3000)
      } else {
        throw new Error('Failed to archive/unarchive project')
      }
    } catch (err) {
      console.error('Failed to archive/unarchive:', err)
      setError('Failed to archive/unarchive project')
    }
  }

  const handleUninstallBobbin = async (bobbinId: string) => {
    if (!confirm('Are you sure you want to uninstall this bobbin? Associated data will be preserved but views will be removed.')) {
      return
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}/bobbins/${bobbinId}`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        await loadBobbins()
        setSuccess('Bobbin uninstalled successfully')
        setTimeout(() => setSuccess(null), 3000)
      } else {
        throw new Error('Failed to uninstall bobbin')
      }
    } catch (err) {
      console.error('Failed to uninstall bobbin:', err)
      setError('Failed to uninstall bobbin')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
              <div className="h-6 bg-gray-200 rounded w-48" />
            </div>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
            <Link href="/dashboard" className="hover:text-gray-900">Dashboard</Link>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <Link href={`/projects/${projectId}`} className="hover:text-gray-900">{project?.name}</Link>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900">Settings</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Project Settings</h1>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Success/Error messages */}
        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* General Settings */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">General Settings</h2>

          <form onSubmit={handleSaveGeneral} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Project Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Installed Bobbins */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Installed Bobbins</h2>

          {bobbins.length === 0 ? (
            <p className="text-gray-600">No bobbins installed yet.</p>
          ) : (
            <div className="space-y-3">
              {bobbins.map((bobbin) => (
                <div key={bobbin.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{bobbin.manifest.name}</h3>
                    {bobbin.manifest.description && (
                      <p className="text-sm text-gray-600 mt-1">{bobbin.manifest.description}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">Version {bobbin.version}</p>
                  </div>
                  <button
                    onClick={() => handleUninstallBobbin(bobbin.id)}
                    className="ml-4 px-4 py-2 text-red-600 hover:text-red-700 border border-red-300 rounded-lg hover:border-red-400"
                  >
                    Uninstall
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Archive/Unarchive */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Archive Project</h2>
          <p className="text-sm text-gray-600 mb-4">
            {project?.isArchived
              ? 'This project is archived. Unarchive it to make it visible in your active projects.'
              : 'Archive this project to hide it from your active projects. You can unarchive it later.'}
          </p>
          <button
            onClick={handleArchive}
            className={`px-6 py-2 rounded-lg font-medium ${
              project?.isArchived
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
          >
            {project?.isArchived ? 'Unarchive Project' : 'Archive Project'}
          </button>
        </div>

        {/* Danger Zone */}
        <div className="bg-white rounded-lg shadow p-6 border-2 border-red-200">
          <h2 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h2>
          <p className="text-sm text-gray-600 mb-4">
            Once you delete a project, there is no going back. This action cannot be undone.
          </p>
          <button
            onClick={() => alert('Delete functionality not yet implemented')}
            className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
          >
            Delete Project
          </button>
        </div>
      </div>
    </div>
  )
}
