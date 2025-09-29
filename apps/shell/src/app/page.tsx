'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { useManifestExtensions } from '@/components/ExtensionProvider'

interface InstalledBobbin {
  id: string
  version: string
  manifest: {
    name: string
    description?: string
    author?: string
    extensions?: {
      contributions?: any[]
    }
  }
  installedAt: string
}

// Module-level state to prevent duplicate loading across component instances
let globalBobbinsLoaded = false
let globalInstalledBobbins: InstalledBobbin[] = []

function HomeContent() {
  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [currentProject, setCurrentProject] = useState<string>('550e8400-e29b-41d4-a716-446655440001')
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>(globalInstalledBobbins)
  const [manifestContent, setManifestContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Safe hook call with error boundary
  let registerManifestExtensions: any = () => { }
  let unregisterManifestExtensions: any = () => { }

  try {
    const manifestHooks = useManifestExtensions()
    registerManifestExtensions = manifestHooks.registerManifestExtensions
    unregisterManifestExtensions = manifestHooks.unregisterManifestExtensions
  } catch (error) {
    console.error('ExtensionProvider not ready:', error)
    // Return loading state if providers aren't ready
    return <div>Loading extensions...</div>
  }

  // Track if we've already loaded bobbins to prevent Service Worker duplicates
  const [hasLoadedBobbins, setHasLoadedBobbins] = useState(globalBobbinsLoaded)

  // Load installed bobbins
  const loadBobbins = async () => {
    console.log('[BOBBINS] loadBobbins called', {
      hasLoadedBobbins,
      globalBobbinsLoaded,
      currentProject,
      isServer: typeof window === 'undefined',
      timestamp: Date.now()
    })

    // Skip loading during SSR to prevent hydration mismatches
    if (typeof window === 'undefined') {
      console.log('[BOBBINS] Skipping loadBobbins (SSR)')
      return
    }

    // Prevent duplicate loads from Service Worker cache events or multiple component instances
    if (hasLoadedBobbins || globalBobbinsLoaded) {
      console.log('[BOBBINS] Skipping duplicate loadBobbins call (already loaded)', { hasLoadedBobbins, globalBobbinsLoaded })
      return
    }

    // Set global flag immediately to prevent race conditions
    globalBobbinsLoaded = true

    try {
      setLoading(true)
      const response = await sdk.api.getInstalledBobbins(currentProject)
      const bobbins = response.bobbins || []

      // Update both local and global state
      setInstalledBobbins(bobbins)
      setHasLoadedBobbins(true)
      globalInstalledBobbins = bobbins

      console.log('[BOBBINS] Successfully loaded bobbins:', bobbins.length)
    } catch (error) {
      console.error('Failed to load bobbins:', error)
      setInstalledBobbins([])
    } finally {
      setLoading(false)
    }
  }

  // Install a bobbin
  const installBobbin = async () => {
    if (!manifestContent.trim()) {
      setMessage('Please enter a manifest')
      return
    }

    try {
      setLoading(true)
      setMessage('Installing bobbin...')

      const result = await sdk.api.installBobbin(
        currentProject,
        manifestContent,
        'yaml'
      )

      setMessage(`Success: ${result.action} ${result.bobbin.name}`)

      // Register extensions if manifest has them
      try {
        const manifest = JSON.parse(manifestContent)
        if (manifest.extensions?.contributions) {
          registerManifestExtensions(manifest.id, manifest)
        }
      } catch (manifestError) {
        // Try as YAML
        try {
          const yaml = await import('yaml')
          const manifest = yaml.parse(manifestContent)
          if (manifest.extensions?.contributions) {
            registerManifestExtensions(manifest.id, manifest)
          }
        } catch (yamlError) {
          console.warn('Could not parse manifest for extension registration:', yamlError)
        }
      }

      setManifestContent('')
      await loadBobbins()
    } catch (error) {
      setMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  // Load example manifest
  const loadExampleManifest = (type: 'manuscript' | 'corkboard') => {
    if (type === 'manuscript') {
      fetch('/bobbins/manuscript/manifest.yaml')
        .then(res => res.text())
        .then(content => setManifestContent(content))
        .catch(() => setMessage('Failed to load example manifest'))
    } else {
      fetch('/bobbins/corkboard/manifest.yaml')
        .then(res => res.text())
        .then(content => setManifestContent(content))
        .catch(() => setMessage('Failed to load example manifest'))
    }
  }

  // Load bobbins on mount and when currentProject changes
  useEffect(() => {
    console.log('[BOBBINS] useEffect for loadBobbins triggered', {
      currentProject,
      hasLoadedBobbins,
      globalBobbinsLoaded,
      timestamp: Date.now()
    })
    // Reset loaded state when project changes
    if (!globalBobbinsLoaded) {
      setHasLoadedBobbins(false)
    }
    // Only run on client side to prevent hydration issues
    if (typeof window !== 'undefined') {
      loadBobbins()
    }
  }, [currentProject]) // Only depend on currentProject, not the function

  // Track which bobbins have had their extensions registered to prevent duplicates
  const [registeredBobbins, setRegisteredBobbins] = useState<Set<string>>(new Set())

  // Auto-register extensions for installed bobbins when they are loaded
  useEffect(() => {
    if (installedBobbins.length > 0 && hasLoadedBobbins) {
      console.log('[BOBBINS] Checking for new bobbins to register extensions:', installedBobbins.length)

      installedBobbins.forEach((bobbin) => {
        // Only register if we haven't already registered this bobbin
        if (bobbin.manifest?.extensions?.contributions && !registeredBobbins.has(bobbin.id)) {
          console.log('[BOBBINS] Auto-registering extensions for new bobbin:', bobbin.id)
          registerManifestExtensions(bobbin.id, bobbin.manifest)
          setRegisteredBobbins(prev => new Set([...prev, bobbin.id]))
        }
      })
    }
  }, [installedBobbins, hasLoadedBobbins, registerManifestExtensions])

  // Reset registered bobbins when project changes
  useEffect(() => {
    setRegisteredBobbins(new Set())
    // Reset global state when project changes
    globalBobbinsLoaded = false
    globalInstalledBobbins = []
  }, [currentProject])

  // Auto-install dictionary panel - REMOVED FOR DEBUGGING

  return (
    <ShellLayout currentView="home" context={{ currentProject }}>
      <div className="p-8 overflow-auto">
        <div className="max-w-4xl mx-auto">
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Bobbinry Shell</h1>
            <p className="text-gray-600 mt-2">
              Modular platform for writers and worldbuilders
            </p>
          </header>

          {/* Project Selection */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Current Project</h2>
            <div className="flex items-center gap-4">
              <input
                type="text"
                value={currentProject}
                onChange={(e) => setCurrentProject(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Project ID"
              />
              <button
                onClick={loadBobbins}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Load Project'}
              </button>
              <Link
                href={`/projects/${currentProject}`}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Open Project Views
              </Link>
            </div>
          </div>

          {/* Installed Bobbins */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Installed Bobbins</h2>
            {installedBobbins.length > 0 ? (
              <div className="grid gap-4">
                {installedBobbins.map((bobbin, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium text-gray-900">{bobbin.manifest.name}</h3>
                        <p className="text-sm text-gray-600">{bobbin.manifest.description}</p>
                        <div className="mt-2 flex gap-2 text-xs text-gray-500">
                          <span>v{bobbin.version}</span>
                          <span>•</span>
                          <span>{bobbin.manifest.author}</span>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(bobbin.installedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No bobbins installed yet.</p>
            )}
          </div>

          {/* Install Bobbin */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Install Bobbin</h2>

            {/* Example buttons */}
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Load example:</p>
              <div className="flex gap-2">
                <button
                  onClick={() => loadExampleManifest('manuscript')}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Manuscript
                </button>
                <button
                  onClick={() => loadExampleManifest('corkboard')}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Corkboard
                </button>
              </div>
            </div>

            <textarea
              value={manifestContent}
              onChange={(e) => setManifestContent(e.target.value)}
              placeholder="Paste bobbin manifest (YAML or JSON)..."
              className="w-full h-64 p-3 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="mt-4 flex justify-between items-center">
              <button
                onClick={installBobbin}
                disabled={loading || !manifestContent.trim()}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Installing...' : 'Install Bobbin'}
              </button>

              {message && (
                <div className={`text-sm p-2 rounded ${message.startsWith('Error')
                  ? 'bg-red-100 text-red-700'
                  : message.startsWith('Success')
                    ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700'
                  }`}>
                  {message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ShellLayout>
  )
}

export default function Home() {
  return <HomeContent />
}
