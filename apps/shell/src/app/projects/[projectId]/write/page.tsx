'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ViewRouter } from '@/components/ViewRouter'
import { UserMenu } from '@/components/UserMenu'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { ProjectWelcome } from '../components/ProjectWelcome'
import { apiFetch } from '@/lib/api'

interface InstalledBobbin {
  id: string
  version: string
  manifest: {
    name: string
    description?: string
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

export default function ProjectWritePage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const projectId = params.projectId as string
  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>([])
  const previousBobbinIdsRef = useRef<string[]>([])
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

  // Pass auth token to SDK when session is available
  useEffect(() => {
    if (session?.apiToken) {
      sdk.api.setAuthToken(session.apiToken)
    }
  }, [session?.apiToken, sdk])

  // Load installed bobbins and their views
  const loadProject = useRef<((skipLoading?: boolean) => Promise<void>) | null>(null)

  // Keep loadProject ref up to date
  // skipLoading=true avoids unmounting ShellLayout (preserves view context)
  loadProject.current = async (skipLoading?: boolean) => {
    try {
      console.log('🔄 PROJECT PAGE: Starting loadProject for:', projectId)
      if (!skipLoading) setLoading(true)
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
      console.error('Failed to load project:', error)
    } finally {
      if (!skipLoading) setLoading(false)
    }
  }

  useEffect(() => {
    if (!session?.apiToken || !projectId) return
    loadProject.current?.()
  }, [projectId, sdk, session?.apiToken])

  // Re-load bobbins when install/uninstall happens via the popover
  // skipLoading=true keeps ShellLayout mounted so view context is preserved
  useEffect(() => {
    const handleBobbinsChanged = () => {
      loadProject.current?.(true)
    }
    window.addEventListener('bobbinry:bobbins-changed', handleBobbinsChanged)
    return () => window.removeEventListener('bobbinry:bobbins-changed', handleBobbinsChanged)
  }, [])

  const navigateToBobbins = (slot?: string) => {
    const url = `/projects/${projectId}/bobbins${slot ? `?slot=${encodeURIComponent(slot)}` : ''}`
    router.push(url)
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
        <header className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-3 gap-1">
          <Link
            href={`/projects/${projectId}`}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 dark:text-gray-500 transition-colors"
            title="Back to project"
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

  const hasBobbins = installedBobbins.length > 0

  return (
    <>
      {!hasBobbins ? (
        <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
          {/* Compact header for welcome state */}
          <header className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-3 gap-1">
            <Link
              href={`/projects/${projectId}`}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 dark:text-gray-500 transition-colors shrink-0"
              title="Back to project"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
              {projectName || 'Project'}
            </span>
            <div className="flex-1" />
            {session?.user && <UserMenu user={session.user} />}
          </header>
          <ProjectWelcome
            onInstallBobbins={navigateToBobbins}
          />
        </div>
      ) : (
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
      )}
    </>
  )
}
