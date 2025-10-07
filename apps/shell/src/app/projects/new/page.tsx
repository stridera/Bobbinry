'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

interface Template {
  id: string
  name: string
  description: string
  bobbins: string[]
  icon: string
}

const templates: Template[] = [
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'Start with an empty project and add bobbins as needed',
    bobbins: [],
    icon: '📄'
  },
  {
    id: 'novel',
    name: 'Novel',
    description: 'Writing template with Manuscript bobbin pre-installed',
    bobbins: ['manuscript'],
    icon: '📖'
  },
  {
    id: 'worldbuilding',
    name: 'Worldbuilding',
    description: 'Complete worldbuilding setup with Manuscript and Corkboard',
    bobbins: ['manuscript', 'corkboard'],
    icon: '🗺️'
  }
]

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

    if (!session?.user?.id) {
      setError('You must be logged in to create a project')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Create project
      const projectRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects`, {
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

      // Install template bobbins if selected
      const template = templates.find(t => t.id === selectedTemplate)
      if (template && template.bobbins.length > 0) {
        for (const bobbinId of template.bobbins) {
          try {
            await fetch(
              `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}/bobbins/install`,
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
            // Continue with other bobbins even if one fails
          }
        }
      }

      // Redirect to project workspace
      router.push(`/projects/${projectId}`)
    } catch (err) {
      console.error('Failed to create project:', err)
      setError(err instanceof Error ? err.message : 'Failed to create project')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-gray-900 mt-2">Create New Project</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Project Details */}
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Project Details</h2>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Project Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="My Awesome Project"
                disabled={loading}
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
                placeholder="A brief description of your project (optional)"
                disabled={loading}
              />
            </div>
          </div>

          {/* Template Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Choose a Template</h2>
              <p className="text-sm text-gray-600 mt-1">Select a starting point for your project</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplate(template.id)}
                  disabled={loading}
                  className={`
                    relative p-6 rounded-lg border-2 text-left transition-all
                    ${selectedTemplate === template.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                    }
                    ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className="text-3xl mb-3">{template.icon}</div>
                  <h3 className="font-semibold text-gray-900 mb-2">{template.name}</h3>
                  <p className="text-sm text-gray-600">{template.description}</p>

                  {template.bobbins.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-500">Includes:</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {template.bobbins.map((bobbin) => (
                          <span key={bobbin} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            {bobbin}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedTemplate === template.id && (
                    <div className="absolute top-4 right-4">
                      <svg className="w-6 h-6 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
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
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="ml-3 text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-4">
            <Link
              href="/dashboard"
              className="px-6 py-2 text-gray-700 hover:text-gray-900"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </span>
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
