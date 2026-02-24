'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ViewRouter } from '@/components/ViewRouter'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { ProjectHeader } from './components/ProjectHeader'
import { ProjectWelcome } from './components/ProjectWelcome'
import { BobbinMarketplace } from './components/BobbinMarketplace'

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
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <ProjectHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading project...</div>
        </div>
      </div>
    )
  }

  const hasBobbins = installedBobbins.length > 0

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <ProjectHeader />
      
      {!hasBobbins ? (
        <ProjectWelcome
          projectId={projectId}
          onInstallBobbins={() => setShowMarketplace(true)}
        />
      ) : (
        <ShellLayout currentView="project" context={shellContext}>
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
    </div>
  )
}