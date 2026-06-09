'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ViewRouter } from '@/components/ViewRouter'
import { UserMenu } from '@/components/UserMenu'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { ProjectWelcome } from '../components/ProjectWelcome'
import { SearchReplaceLauncher } from '@/components/SearchReplaceLauncher'
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

type LoadError = 'forbidden' | 'not-found' | 'other'

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
  const [loadError, setLoadError] = useState<LoadError | null>(null)

  // Fetch project name. A 403 here means the signed-in user doesn't own this
  // project; surface that distinctly so we don't fall through to the
  // "Begin Your Story" empty state, which makes someone else's project look
  // like an unconfigured one.
  useEffect(() => {
    if (!session?.apiToken || !projectId) return
    const loadProjectInfo = async () => {
      try {
        const response = await apiFetch(`/api/projects/${projectId}`, session.apiToken)
        if (response.ok) {
          const data = await response.json()
          setProjectName(data.project?.name || null)
          return
        }
        if (response.status === 403) {
          setLoadError(prev => prev ?? 'forbidden')
        } else if (response.status === 404) {
          setLoadError(prev => prev ?? 'not-found')
        } else {
          setLoadError(prev => prev ?? 'other')
        }
      } catch (error) {
        console.error('Failed to load project info:', error)
        setLoadError(prev => prev ?? 'other')
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

  // skipLoading=true avoids unmounting ShellLayout (preserves view context)
  const loadProject = useCallback(async (skipLoading?: boolean) => {
    try {
      console.log('🔄 PROJECT PAGE: Starting loadProject for:', projectId)
      if (!skipLoading) setLoading(true)
      sdk.setProject(projectId)

      const response = await sdk.api.getInstalledBobbins(projectId)

      const newBobbins = response.bobbins || []
      const newBobbinIds = newBobbins.map((b: InstalledBobbin) => b.id)

      const removedBobbinIds = previousBobbinIdsRef.current.filter(id => !newBobbinIds.includes(id))
      removedBobbinIds.forEach(bobbinId => {
        unregisterManifestExtensions(bobbinId)
      })

      previousBobbinIdsRef.current = newBobbinIds

      setInstalledBobbins(newBobbins)
      // Clear stale error state if a retry succeeds.
      setLoadError(null)

      if (newBobbins.length > 0) {
        newBobbins.forEach((bobbin: InstalledBobbin) => {
          registerManifestExtensions(bobbin.id, bobbin.manifest)
        })
      }
    } catch (error) {
      console.error('Failed to load project:', error)
      const status = (error as { status?: number } | null)?.status
      if (status === 403) {
        setLoadError('forbidden')
      } else if (status === 404) {
        setLoadError('not-found')
      } else {
        setLoadError('other')
      }
    } finally {
      if (!skipLoading) setLoading(false)
    }
  }, [projectId, sdk, registerManifestExtensions, unregisterManifestExtensions])

  useEffect(() => {
    if (!session?.apiToken || !projectId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadProject()
  }, [loadProject, projectId, session?.apiToken])

  // Re-load bobbins when install/uninstall happens via the popover
  // skipLoading=true keeps ShellLayout mounted so view context is preserved
  useEffect(() => {
    const handleBobbinsChanged = () => {
      loadProject(true)
    }
    window.addEventListener('bobbinry:bobbins-changed', handleBobbinsChanged)
    return () => window.removeEventListener('bobbinry:bobbins-changed', handleBobbinsChanged)
  }, [loadProject])

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

  // A load error must beat the welcome screen — otherwise a 403 (someone
  // else's project) or a 404 (deleted project) silently renders as if this
  // project just hasn't installed any bobbins yet, prompting the user to
  // "Browse Bobbins" on a project they don't own.
  if (loadError) {
    return (
      <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
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
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">Project</span>
          <div className="flex-1" />
          {session?.user && <UserMenu user={session.user} />}
        </header>
        <ProjectErrorState
          variant={loadError}
          onRetry={() => { setLoadError(null); setLoading(true); loadProject() }}
        />
      </div>
    )
  }

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
          <SearchReplaceLauncher
            projectId={projectId}
            apiToken={session?.apiToken}
            buttonVariant="floating"
            defaultScope="chapter"
          />
        </ShellLayout>
      )}
    </>
  )
}

function ProjectErrorState({
  variant,
  onRetry,
}: {
  variant: LoadError
  onRetry: () => void
}) {
  const copy = (() => {
    switch (variant) {
      case 'forbidden':
        return {
          icon: '🔒',
          title: "You don't have access to this project",
          body: 'This project belongs to another author. Sign in as the owner, or head back to your dashboard.',
          showRetry: false,
        }
      case 'not-found':
        return {
          icon: '🗂️',
          title: 'Project not found',
          body: "We couldn't find this project. It may have been deleted, or the link might be wrong.",
          showRetry: false,
        }
      case 'other':
      default:
        return {
          icon: '⚠️',
          title: "Couldn't load this project",
          body: 'Something went wrong reaching the API. Please try again in a moment.',
          showRetry: true,
        }
    }
  })()

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4" aria-hidden>{copy.icon}</div>
        <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
          {copy.title}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">{copy.body}</p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Back to dashboard
          </Link>
          {copy.showRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
