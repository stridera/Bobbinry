'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ViewRouter } from '@/components/ViewRouter'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { apiFetch } from '@/lib/api'

interface InstalledBobbin {
  id: string
  version: string
  manifest: {
    name: string
    description?: string
    execution?: {
      mode: 'native' | 'sandboxed'
    }
    ui?: {
      views?: Array<{
        id: string
        type: string
        source: string
      }>
    }
  }
  installedAt: string
}

export default function ProjectDeepLinkPage() {
  const params = useParams()
  const { data: session } = useSession()
  const projectId = params.projectId as string
  const slug = params.slug as string[]

  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>([])
  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState<string | null>(null)

  // Fetch project name
  useEffect(() => {
    if (!session?.apiToken || !projectId) return
    const loadProjectInfo = async () => {
      try {
        const response = await apiFetch(`/api/projects/${projectId}`, session.apiToken)
        if (response.ok) {
          const data = await response.json()
          setProjectName(data.project?.name || null)
        }
      } catch (error) {
        console.error('Failed to load project info:', error)
      }
    }
    loadProjectInfo()
  }, [projectId, session?.apiToken])

  // Memoize context to prevent unnecessary re-renders
  const shellContext = useMemo(() => ({
    projectId,
    apiToken: session?.apiToken,
  }), [projectId, session?.apiToken])

  // Get extension registration hooks
  const { registerManifestExtensions, unregisterManifestExtensions } = useManifestExtensions()

  // Pass auth token to SDK
  useEffect(() => {
    if (session?.apiToken) {
      sdk.api.setAuthToken(session.apiToken)
    }
  }, [session?.apiToken, sdk])

  // Load installed bobbins and their views
  useEffect(() => {
    if (!session?.apiToken) return

    const loadProject = async () => {
      try {
        console.log('🔄 DEEP LINK PAGE: Starting loadProject for:', projectId)
        setLoading(true)
        sdk.setProject(projectId)

        const response = await sdk.api.getInstalledBobbins(projectId)
        const newBobbins = response.bobbins || []
        const oldBobbinIds = installedBobbins.map(b => b.id)
        const newBobbinIds = newBobbins.map((b: InstalledBobbin) => b.id)

        // Unregister extensions for bobbins that were removed
        const removedBobbinIds = oldBobbinIds.filter(id => !newBobbinIds.includes(id))
        removedBobbinIds.forEach(bobbinId => {
          unregisterManifestExtensions(bobbinId)
        })

        setInstalledBobbins(newBobbins)

        // Register extensions for all installed bobbins
        if (newBobbins.length > 0) {
          newBobbins.forEach((bobbin: InstalledBobbin) => {
            registerManifestExtensions(bobbin.id, bobbin.manifest)
          })
        }
      } catch (error) {
        console.error('❌ DEEP LINK PAGE: Failed to load project:', error)
      } finally {
        setLoading(false)
      }
    }
    
    if (projectId) {
      loadProject()
    }
  }, [projectId, sdk, session?.apiToken])

  // Parse the slug and trigger navigation once loaded
  useEffect(() => {
    if (loading || !slug || slug.length < 3) return

    // Expected format: [bobbinId, entityType, entityId]
    const [bobbinId, entityType, entityId] = slug

    console.log('[DEEP LINK PAGE] Restoring navigation from URL:', { bobbinId, entityType, entityId })

    // Dispatch navigation event to restore the view
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType,
            entityId,
            bobbinId
          }
        })
      )
    }
  }, [slug, loading])
  
  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <header className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-3 gap-1">
          <Link
            href="/dashboard"
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 dark:text-gray-500 transition-colors"
            title="Back to dashboard"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          {projectName ? (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{projectName}</span>
          ) : (
            <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          )}
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400">Loading project...</div>
        </div>
      </div>
    )
  }

  return (
    <ShellLayout
      currentView="project"
      context={shellContext}
      projectId={projectId}
      projectName={projectName || undefined}
      user={session?.user}
    >
      <ViewRouter projectId={projectId} sdk={sdk} />
    </ShellLayout>
  )
}
