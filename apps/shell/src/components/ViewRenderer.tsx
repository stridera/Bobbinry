'use client'

import { BobbinrySDK } from '@bobbinry/sdk'
import { viewRegistry } from '../lib/view-registry'
import { NativeViewRenderer } from './NativeViewRenderer'
import { SandboxedViewRenderer } from './SandboxedViewRenderer'

interface ViewRendererProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
}

/**
 * Main ViewRenderer component that routes to either NativeViewRenderer or SandboxedViewRenderer
 * based on the execution mode registered in the ViewRegistry.
 *
 * - Native views: First-party bobbins loaded as direct React components (max performance, SSR-capable)
 * - Sandboxed views: Third-party bobbins loaded in iframes (security isolation)
 */

export function ViewRenderer({ projectId, bobbinId, viewId, sdk }: ViewRendererProps) {
  // If viewId already includes the bobbinId prefix, use it as-is, otherwise construct it
  const fullViewId = viewId.includes('.') ? viewId : `${bobbinId}.${viewId}`

  // Look up the view in the registry to determine execution mode
  const viewEntry = viewRegistry.get(fullViewId)
  
  console.log(`[ViewRenderer] Looking up view: ${fullViewId}`)
  console.log(`[ViewRenderer] Registry entry:`, viewEntry)
  console.log(`[ViewRenderer] All registered views:`, viewRegistry.getAll())

  // If not in registry, default to sandboxed for safety
  const executionMode = viewEntry?.execution || 'sandboxed'

  console.log(`[ViewRenderer] Routing ${fullViewId} to ${executionMode} renderer`)

  // Route to appropriate renderer based on execution mode
  if (executionMode === 'native' && viewEntry) {
    return (
      <NativeViewRenderer
        projectId={projectId}
        bobbinId={bobbinId}
        viewId={viewId}
        sdk={sdk}
        {...(viewEntry.componentLoader && { componentLoader: viewEntry.componentLoader })}
      />
    )
  }

  // Default to sandboxed rendering
  return (
    <SandboxedViewRenderer
      projectId={projectId}
      bobbinId={bobbinId}
      viewId={viewId}
      sdk={sdk}
    />
  )
}