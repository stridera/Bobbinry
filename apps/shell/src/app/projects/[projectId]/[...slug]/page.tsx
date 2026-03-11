'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
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
      mode: 'native'
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
  const router = useRouter()
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
  const previousBobbinIdsRef = useRef<string[]>([])
  const loadProject = useRef<(() => Promise<void>) | null>(null)

  // Keep loadProject ref up to date
  loadProject.current = async () => {
    try {
      console.log('🔄 DEEP LINK PAGE: Starting loadProject for:', projectId)
      setLoading(true)
      sdk.setProject(projectId)

      const response = await sdk.api.getInstalledBobbins(projectId)
      const newBobbins = response.bobbins || []
      const newBobbinIds = newBobbins.map((b: InstalledBobbin) => b.id)

      // Unregister extensions for bobbins that were removed (using ref for previous state)
      const removedBobbinIds = previousBobbinIdsRef.current.filter(id => !newBobbinIds.includes(id))
      removedBobbinIds.forEach(bobbinId => {
        unregisterManifestExtensions(bobbinId)
      })

      // Update the ref with current bobbin IDs
      previousBobbinIdsRef.current = newBobbinIds

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

  useEffect(() => {
    if (!session?.apiToken || !projectId) return
    loadProject.current?.()
  }, [projectId, sdk, session?.apiToken])

  // Re-load bobbins when install/uninstall happens via the popover
  useEffect(() => {
    const handleBobbinsChanged = () => {
      loadProject.current?.()
    }
    window.addEventListener('bobbinry:bobbins-changed', handleBobbinsChanged)
    return () => window.removeEventListener('bobbinry:bobbins-changed', handleBobbinsChanged)
  }, [])

  // Parse the slug and trigger navigation once loaded
  const slugKey = slug?.join('/') || ''
  const navigatedSlugRef = useRef<string | null>(null)

  useEffect(() => {
    if (loading || !slug || slug.length < 3) return
    if (navigatedSlugRef.current === slugKey) return
    navigatedSlugRef.current = slugKey

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey, loading])
  
  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
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

  const navigateToBobbins = (slot?: string) => {
    const url = `/projects/${projectId}/bobbins${slot ? `?slot=${encodeURIComponent(slot)}` : ''}`
    router.push(url)
  }

  return (
    <ShellLayout
      currentView="project"
      context={shellContext}
      onOpenMarketplace={navigateToBobbins}
      projectId={projectId}
      projectName={projectName || undefined}
      user={session?.user}
      installedBobbins={installedBobbins}
    >
      <ViewRouter projectId={projectId} sdk={sdk} />
    </ShellLayout>
  )
}
