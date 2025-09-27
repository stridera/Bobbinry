'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ViewRenderer } from '@/components/ViewRenderer'

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

export default function ProjectPage() {
  const params = useParams()
  const projectId = params.projectId as string
  
  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>([])
  const [currentView, setCurrentView] = useState<string | null>(null)
  const [currentBobbin, setCurrentBobbin] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Load installed bobbins and their views
  useEffect(() => {
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
        setInstalledBobbins(response.bobbins || [])

        // Auto-select first view if available
        if (response.bobbins?.length > 0) {
          const firstBobbin = response.bobbins[0]
          const firstView = firstBobbin.manifest?.ui?.views?.[0]
          console.log('🚀 PROJECT PAGE: Auto-selecting:', { firstBobbin: firstBobbin.id, firstView: firstView?.id })
          if (firstView) {
            setCurrentBobbin(firstBobbin.id)
            setCurrentView(firstView.id)
          }
        } else {
          console.log('🚀 PROJECT PAGE: No bobbins found in response')
        }
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
  }, [projectId, sdk])
  
  const availableViews = installedBobbins.flatMap(bobbin => 
    (bobbin.manifest?.ui?.views || []).map(view => ({
      bobbinId: bobbin.id,
      bobbinName: bobbin.manifest.name,
      viewId: view.id,
      viewType: view.type,
      viewSource: view.source
    }))
  )
  
  if (loading) {
    return (
      <ShellLayout currentView="project" context={{ projectId }}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading project...</div>
        </div>
      </ShellLayout>
    )
  }
  
  return (
    <ShellLayout currentView="project" context={{ projectId }}>
      <div className="flex-1 flex overflow-hidden">
        {/* View Navigation */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Views</h2>
            <p className="text-sm text-gray-500">Project: {projectId.slice(0, 8)}...</p>
            {/* DEBUG INFO */}
            <div className="mt-2 p-2 bg-yellow-100 text-xs">
              <div>DEBUG: installedBobbins.length = {installedBobbins.length}</div>
              <div>DEBUG: availableViews.length = {availableViews.length}</div>
              <div>DEBUG: currentBobbin = {currentBobbin || 'null'}</div>
              <div>DEBUG: currentView = {currentView || 'null'}</div>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto">
            {availableViews.length === 0 ? (
              <div className="p-4 text-gray-500 text-sm">
                No views available. Install a bobbin with UI views.
              </div>
            ) : (
              <div className="py-2">
                {availableViews.map(view => (
                  <button
                    key={`${view.bobbinId}-${view.viewId}`}
                    onClick={() => {
                      setCurrentBobbin(view.bobbinId)
                      setCurrentView(view.viewId)
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                      currentView === view.viewId && currentBobbin === view.bobbinId
                        ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                        : 'text-gray-700'
                    }`}
                  >
                    <div className="font-medium">{view.viewId}</div>
                    <div className="text-xs text-gray-500">
                      {view.bobbinName} • {view.viewType}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* View Content */}
        <div className="flex-1 flex flex-col">
          {currentView && currentBobbin ? (
            <>
              <div style={{ background: 'yellow', padding: '8px', fontSize: '12px' }}>
                DEBUG: projectId={projectId}, bobbinId={currentBobbin}, viewId={currentView}
              </div>
              <ViewRenderer
                projectId={projectId}
                bobbinId={currentBobbin}
                viewId={currentView}
                sdk={sdk}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <p>Select a view to get started</p>
                {availableViews.length === 0 && (
                  <p className="text-sm mt-2">
                    Install bobbins with UI views from the{' '}
                    <a href="/" className="text-blue-600 hover:underline">
                      home page
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </ShellLayout>
  )
}