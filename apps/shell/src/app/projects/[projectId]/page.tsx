'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ViewRouter } from '@/components/ViewRouter'
import { UserMenu } from '@/components/UserMenu'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { ProjectWelcome } from './components/ProjectWelcome'
import { BobbinMarketplace } from './components/BobbinMarketplace'
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

export default function ProjectPage() {
  const params = useParams()
  const { data: session } = useSession()
  const projectId = params.projectId as string
  const [hasInitialNavigation, setHasInitialNavigation] = useState(false)

  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>([])
  const [loading, setLoading] = useState(true)
  const [showMarketplace, setShowMarketplace] = useState(false)
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
  useEffect(() => {
    if (!session?.apiToken) return

    const loadProject = async () => {
      try {
        console.log('🔄 PROJECT PAGE: Starting loadProject for:', projectId)
        setLoading(true)
        sdk.setProject(projectId)

        console.log('🔄 PROJECT PAGE: About to call getInstalledBobbins...')
        const response = await sdk.api.getInstalledBobbins(projectId)
        console.log('🚀 PROJECT PAGE: getInstalledBobbins response:', response)
        console.log('🚀 PROJECT PAGE: response.bobbins:', response.bobbins)
        console.log('🚀 PROJECT PAGE: response.bobbins type:', typeof response.bobbins)
        console.log('🚀 PROJECT PAGE: response.bobbins length:', response.bobbins?.length)

        const newBobbins = response.bobbins || []
        const oldBobbinIds = installedBobbins.map(b => b.id)
        const newBobbinIds = newBobbins.map((b: InstalledBobbin) => b.id)

        // Unregister extensions for bobbins that were removed
        const removedBobbinIds = oldBobbinIds.filter(id => !newBobbinIds.includes(id))
        removedBobbinIds.forEach(bobbinId => {
          console.log('🗑️ PROJECT PAGE: Unregistering extensions for removed bobbin:', bobbinId)
          unregisterManifestExtensions(bobbinId)
        })

        setInstalledBobbins(newBobbins)

        // Register extensions for all installed bobbins
        if (newBobbins.length > 0) {
          console.log('🚀 PROJECT PAGE: Registering extensions for', newBobbins.length, 'bobbins')
          newBobbins.forEach((bobbin: InstalledBobbin) => {
            console.log('🚀 PROJECT PAGE: Registering extensions for bobbin:', bobbin.id, 'mode:', bobbin.manifest.execution?.mode)
            registerManifestExtensions(bobbin.id, bobbin.manifest)
          })
        }

        console.log('✅ PROJECT PAGE: Bobbins loaded and registered')
      } catch (error) {
        console.error('❌ PROJECT PAGE: Failed to load project:', error)
        console.error('❌ PROJECT PAGE: Error details:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          error
        })
      } finally {
        console.log('✅ PROJECT PAGE: Setting loading=false')
        setLoading(false)
      }
    }
    
    if (projectId) {
      loadProject()
    }
  }, [projectId, sdk, session?.apiToken])
  
  const handleInstallComplete = () => {
    // Reload bobbins after installation
    const loadBobbins = async () => {
      try {
        const response = await sdk.api.getInstalledBobbins(projectId)
        const newBobbins = response.bobbins || []
        setInstalledBobbins(newBobbins)
        
        // Register extensions for newly installed bobbins
        newBobbins.forEach((bobbin: InstalledBobbin) => {
          registerManifestExtensions(bobbin.id, bobbin.manifest)
        })
      } catch (error) {
        console.error('Failed to reload bobbins:', error)
      }
    }
    loadBobbins()
  }

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

  const hasBobbins = installedBobbins.length > 0

  return (
    <>
      {!hasBobbins ? (
        <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
          {/* Compact header for welcome state */}
          <header className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-3 gap-1">
            <Link
              href="/dashboard"
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 dark:text-gray-500 transition-colors shrink-0"
              title="Back to dashboard"
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
            projectId={projectId}
            onInstallBobbins={() => setShowMarketplace(true)}
          />
        </div>
      ) : (
        <ShellLayout
          currentView="project"
          context={shellContext}
          onOpenMarketplace={() => setShowMarketplace(true)}
          projectId={projectId}
          projectName={projectName || undefined}
          user={session?.user}
        >
          <ViewRouter projectId={projectId} sdk={sdk} />
        </ShellLayout>
      )}

      {showMarketplace && (
        <BobbinMarketplace
          projectId={projectId}
          installedBobbins={installedBobbins}
          onInstallComplete={handleInstallComplete}
          onClose={() => setShowMarketplace(false)}
        />
      )}
    </>
  )
}