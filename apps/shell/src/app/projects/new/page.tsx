'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { UserMenu } from '@/components/UserMenu'

interface Template {
  id: string
  name: string
  description: string
  bobbins: string[]
}

const templates: Template[] = [
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'Start with an empty canvas and add bobbins as needed',
    bobbins: [],
  },
  {
    id: 'novel',
    name: 'Novel',
    description: 'Writing template with Manuscript bobbin for chapters, scenes, and rich text',
    bobbins: ['manuscript'],
  },
  {
    id: 'worldbuilding',
    name: 'Worldbuilding',
    description: 'Full creative suite with Manuscript and Corkboard for organizing your world',
    bobbins: ['manuscript', 'corkboard'],
  }
]

const templateIcons: Record<string, JSX.Element> = {
  blank: (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  novel: (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  worldbuilding: (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  ),
}

export default function NewProjectPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('blank')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Project name is required')
      return
    }

    if (!session?.user?.id || !session?.apiToken) {
      setError('You must be logged in to create a project')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const projectRes = await apiFetch('/api/projects', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          ownerId: session.user.id
        })
      })

      if (!projectRes.ok) {
        const errorData = await projectRes.json().catch(() => ({ error: 'Failed to create project' }))
        throw new Error(errorData.error || 'Failed to create project')
      }

      const project = await projectRes.json()
      const projectId = project.id

      const template = templates.find(t => t.id === selectedTemplate)
      if (template && template.bobbins.length > 0) {
        for (const bobbinId of template.bobbins) {
          try {
            await apiFetch(
              `/api/projects/${projectId}/bobbins/install`,
              session.apiToken,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  manifestPath: `bobbins/${bobbinId}.manifest.yaml`
                })
              }
            )
          } catch (bobbinError) {
            console.error(`Failed to install bobbin ${bobbinId}:`, bobbinError)
          }
        }
      }

      router.push(`/projects/${projectId}`)
    } catch (err) {
      console.error('Failed to create project:', err)
      setError(err instanceof Error ? err.message : 'Failed to create project')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/dashboard" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
                &larr; Back to Dashboard
              </Link>
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">Create New Project</h1>
            </div>
            {session?.user && <UserMenu user={session.user} />}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Project Details */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-5">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Project Details</h2>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Project Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
                placeholder="The Great Novel"
                disabled={loading}
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
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors resize-y"
                placeholder="A brief description of your project"
                disabled={loading}
              />
            </div>
          </div>

          {/* Template Selection */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Choose a Template</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Select a starting point for your project</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplate(template.id)}
                  disabled={loading}
                  className={`
                    relative p-5 rounded-lg border-2 text-left transition-all
                    ${selectedTemplate === template.id
                      ? 'border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }
                    ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className={`mb-3 ${selectedTemplate === template.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {templateIcons[template.id]}
                  </div>
                  <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 mb-1.5">{template.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{template.description}</p>

                  {template.bobbins.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Includes:</p>
                      <div className="flex flex-wrap gap-1">
                        {template.bobbins.map((bobbin) => (
                          <span key={bobbin} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                            {bobbin}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedTemplate === template.id && (
                    <div className="absolute top-3 right-3">
                      <svg className="w-5 h-5 text-blue-500 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4">
              <div className="flex">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="ml-3 text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-4">
            <Link
              href="/dashboard"
              className="px-6 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="inline-flex items-center px-6 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
