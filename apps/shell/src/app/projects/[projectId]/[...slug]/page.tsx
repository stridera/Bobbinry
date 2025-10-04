'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ViewRouter } from '@/components/ViewRouter'
import { useManifestExtensions } from '@/components/ExtensionProvider'

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
  const projectId = params.projectId as string
  const slug = params.slug as string[]

  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>([])
  const [loading, setLoading] = useState(true)

  // Memoize context to prevent unnecessary re-renders
  const shellContext = useMemo(() => ({ projectId }), [projectId])

  // Get extension registration hooks
  const { registerManifestExtensions, unregisterManifestExtensions } = useManifestExtensions()

  // Load installed bobbins and their views
  useEffect(() => {
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
  }, [projectId, sdk])

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
      <ShellLayout currentView="project" context={shellContext}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading project...</div>
        </div>
      </ShellLayout>
    )
  }

  return (
    <ShellLayout currentView="project" context={shellContext}>
      <ViewRouter projectId={projectId} sdk={sdk} />
    </ShellLayout>
  )
}
