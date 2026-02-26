'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

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
  const [coverImage, setCoverImage] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (session?.apiToken) {
      loadProject()
      loadBobbins()
    }
  }, [projectId, session?.apiToken])

  const loadProject = async () => {
    const token = session?.apiToken
    if (!token) return
    try {
      const response = await apiFetch(`/api/projects/${projectId}`, token)
      if (response.ok) {
        const data = await response.json()
        setProject(data.project)
        setName(data.project.name)
        setDescription(data.project.description || '')
        setCoverImage(data.project.coverImage || '')
      }
    } catch (err) {
      console.error('Failed to load project:', err)
      setError('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const loadBobbins = async () => {
    const token = session?.apiToken
    if (!token) return
    try {
      const response = await apiFetch(`/api/projects/${projectId}/bobbins`, token)
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
      const response = await apiFetch(
        `/api/projects/${projectId}`,
        session!.apiToken,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            coverImage: coverImage || null
          })
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
      const response = await apiFetch(
        `/api/projects/${projectId}/${endpoint}`,
        session!.apiToken,
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
      const response = await apiFetch(
        `/api/projects/${projectId}/bobbins/${bobbinId}`,
        session!.apiToken,
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-32 mb-2" />
              <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded w-48" />
            </div>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Dashboard</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <Link href={`/projects/${projectId}`} className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">{project?.name}</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 dark:text-gray-100">Settings</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Project Settings</h1>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">
        {/* Success/Error messages */}
        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* General Settings */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">General Settings</h2>

          <form onSubmit={handleSaveGeneral} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Project Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
                required
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Cover Image
              </label>
              {coverImage ? (
                <div className="relative inline-block">
                  <img
                    src={coverImage}
                    alt="Cover preview"
                    className="w-full max-w-md h-48 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => setCoverImage('')}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 cursor-pointer shadow"
                    title="Remove cover image"
                  >
                    x
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => document.getElementById('coverImageInput')?.click()}
                  onDrop={async (e) => {
                    e.preventDefault()
                    const file = e.dataTransfer.files[0]
                    if (file && file.type.startsWith('image/') && session?.apiToken) {
                      setUploading(true)
                      try {
                        const presignRes = await apiFetch('/api/uploads/presign', session.apiToken, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, context: 'cover', projectId }),
                        })
                        if (!presignRes.ok) throw new Error('Presign failed')
                        const { uploadUrl, fileKey } = await presignRes.json()
                        await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
                        const confirmRes = await apiFetch('/api/uploads/confirm', session.apiToken, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ fileKey, filename: file.name, contentType: file.type, size: file.size, context: 'cover', projectId }),
                        })
                        if (!confirmRes.ok) throw new Error('Confirm failed')
                        const { url } = await confirmRes.json()
                        setCoverImage(url)
                      } catch (err) {
                        console.error('Cover upload failed:', err)
                        setError('Failed to upload cover image')
                      } finally {
                        setUploading(false)
                      }
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  className="w-full max-w-md h-48 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors bg-gray-50/50 dark:bg-gray-900/50"
                >
                  {uploading ? (
                    <span className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">Uploading...</span>
                  ) : (
                    <>
                      <svg className="w-10 h-10 text-gray-400 dark:text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Drop image here or click to browse
                      </span>
                    </>
                  )}
                </div>
              )}
              <input
                id="coverImageInput"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file || !session?.apiToken) return
                  e.target.value = ''
                  setUploading(true)
                  try {
                    const presignRes = await apiFetch('/api/uploads/presign', session.apiToken, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, context: 'cover', projectId }),
                    })
                    if (!presignRes.ok) throw new Error('Presign failed')
                    const { uploadUrl, fileKey } = await presignRes.json()
                    await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
                    const confirmRes = await apiFetch('/api/uploads/confirm', session.apiToken, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ fileKey, filename: file.name, contentType: file.type, size: file.size, context: 'cover', projectId }),
                    })
                    if (!confirmRes.ok) throw new Error('Confirm failed')
                    const { url } = await confirmRes.json()
                    setCoverImage(url)
                  } catch (err) {
                    console.error('Cover upload failed:', err)
                    setError('Failed to upload cover image')
                  } finally {
                    setUploading(false)
                  }
                }}
              />
              <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">Upload a cover image for your project (max 10MB)</p>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Installed Bobbins */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Installed Bobbins</h2>
            {bobbins.length > 0 && (
              <a
                href={`/projects/${params.projectId}/marketplace`}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                Browse Marketplace
              </a>
            )}
          </div>

          {bobbins.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 italic">No bobbins installed yet.</p>
          ) : (
            <div className="space-y-3">
              {bobbins.map((bobbin) => (
                <div key={bobbin.id} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{bobbin.manifest.name}</h3>
                    {bobbin.manifest.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{bobbin.manifest.description}</p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Version {bobbin.version}</p>
                  </div>
                  <button
                    onClick={() => handleUninstallBobbin(bobbin.id)}
                    className="ml-4 px-4 py-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-red-200 dark:border-red-800 rounded-lg hover:border-red-300 dark:hover:border-red-700 transition-colors text-sm"
                  >
                    Uninstall
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Archive/Unarchive */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Archive Project</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {project?.isArchived
              ? 'This project is archived. Unarchive it to make it visible in your active projects.'
              : 'Archive this project to hide it from your active projects. You can unarchive it later.'}
          </p>
          <button
            onClick={handleArchive}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              project?.isArchived
                ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white'
                : 'bg-gray-600 hover:bg-gray-700 text-white'
            }`}
          >
            {project?.isArchived ? 'Unarchive Project' : 'Archive Project'}
          </button>
        </div>

        {/* Danger Zone */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border-2 border-red-200 dark:border-red-900 p-6">
          <h2 className="font-display text-lg font-semibold text-red-600 dark:text-red-400 mb-4">Danger Zone</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Once you delete a project, there is no going back. This action cannot be undone.
          </p>
          <button
            onClick={() => alert('Delete functionality not yet implemented')}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            Delete Project
          </button>
        </div>
      </div>
    </div>
  )
}
