'use client'

import { useEffect, useState, ReactNode } from 'react'
import { extensionRegistry, RegisteredExtension, SlotDefinition } from '@/lib/extensions'
import { useExtensions } from './ExtensionProvider'

interface ExtensionSlotProps {
  slotId: string
  context?: any
  className?: string
  fallback?: ReactNode
  renderExtension?: (extension: RegisteredExtension) => ReactNode
}

export function ExtensionSlot({
  slotId,
  context = {},
  className,
  fallback,
  renderExtension
}: ExtensionSlotProps) {
  const [extensions, setExtensions] = useState<RegisteredExtension[]>([])
  const [slot, setSlot] = useState<SlotDefinition | undefined>()
  const { getExtensionsForSlot, getSlot } = useExtensions()

  useEffect(() => {
    // Get slot definition
    const slotDef = getSlot(slotId)
    setSlot(slotDef)

    if (!slotDef) {
      console.warn(`ExtensionSlot: Unknown slot "${slotId}"`)
      return
    }

    // Get initial extensions
    const initialExtensions = getExtensionsForSlot(slotId, context)
    setExtensions(initialExtensions)

    // Listen for changes
    const unsubscribe = extensionRegistry.onSlotChange(slotId, (newExtensions) => {
      setExtensions(newExtensions.filter(ext =>
        getExtensionsForSlot(slotId, context).includes(ext)
      ))
    })

    return unsubscribe
  }, [slotId, context, getExtensionsForSlot, getSlot])

  // Update extensions when context changes
  useEffect(() => {
    if (slot) {
      const updatedExtensions = getExtensionsForSlot(slotId, context)
      setExtensions(updatedExtensions)
    }
  }, [slotId, context, slot, getExtensionsForSlot])

  const defaultRenderExtension = (extension: RegisteredExtension): ReactNode => {
    const Component = extensionRegistry.getExtensionComponent(extension.id)

    if (Component) {
      return (
        <Component
          key={extension.id}
          extension={extension}
          context={context}
        />
      )
    }

    // Default rendering based on contribution type
    switch (extension.contribution.type) {
      case 'panel':
        return (
          <ExtensionPanel key={extension.id} extension={extension} context={context} />
        )
      case 'action':
        return (
          <ExtensionAction key={extension.id} extension={extension} context={context} />
        )
      case 'menu':
        return (
          <ExtensionMenu key={extension.id} extension={extension} context={context} />
        )
      default:
        return (
          <ExtensionDefault key={extension.id} extension={extension} context={context} />
        )
    }
  }

  const renderer = renderExtension || defaultRenderExtension

  if (!slot) {
    return (
      <div className="text-red-500 text-sm p-2">
        Unknown slot: {slotId}
      </div>
    )
  }

  if (extensions.length === 0) {
    if (fallback) {
      return <>{fallback}</>
    }

    if (slot.defaultComponent) {
      const DefaultComponent = slot.defaultComponent
      return <DefaultComponent slotId={slotId} context={context} />
    }

    return null
  }

  return (
    <div className={className} data-slot={slotId}>
      {extensions.map(renderer)}
    </div>
  )
}

// Default extension renderers
function ExtensionPanel({ extension, context }: { extension: RegisteredExtension; context: any }) {
  const { contribution } = extension

  if (contribution.entry) {
    // Convert relative entry paths to absolute URLs pointing to API server
    let entryUrl = contribution.entry
    if (!entryUrl.startsWith('http') && !entryUrl.startsWith('/')) {
      // Assume it's relative to the bobbin - point to API server
      entryUrl = `http://localhost:4000/bobbins/${extension.bobbinId}/${entryUrl}`
    } else if (entryUrl.startsWith('/')) {
      // Absolute path relative to domain - point to API server
      entryUrl = `http://localhost:4000${entryUrl}`
    }

    // Render iframe for sandboxed view
    return (
      <div className="extension-panel h-full">
        <div className="panel-header p-2 border-b bg-gray-50">
          <h3 className="text-sm font-medium">{contribution.title || contribution.id}</h3>
        </div>
        <div className="panel-content flex-1">
          <iframe
            src={entryUrl}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
            title={contribution.title || contribution.id}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="extension-panel p-4 border rounded">
      <h3 className="font-medium mb-2">{contribution.title || contribution.id}</h3>
      <p className="text-sm text-gray-600">Panel content loading...</p>
    </div>
  )
}

function ExtensionAction({ extension, context }: { extension: RegisteredExtension; context: any }) {
  const { contribution } = extension

  const handleClick = () => {
    // TODO: Execute action through action runtime
    console.log('Action clicked:', contribution.id)
  }

  return (
    <button
      onClick={handleClick}
      className="extension-action px-3 py-1 text-sm border rounded hover:bg-gray-50"
      title={contribution.title || contribution.id}
    >
      {contribution.title || contribution.id}
    </button>
  )
}

function ExtensionMenu({ extension, context }: { extension: RegisteredExtension; context: any }) {
  const { contribution } = extension

  return (
    <div className="extension-menu">
      <span className="text-sm font-medium">{contribution.title || contribution.id}</span>
      {/* TODO: Render menu items */}
    </div>
  )
}

function ExtensionDefault({ extension, context }: { extension: RegisteredExtension; context: any }) {
  const { contribution } = extension

  return (
    <div className="extension-default p-2 border rounded">
      <span className="text-sm">{contribution.title || contribution.id}</span>
      <span className="text-xs text-gray-500 ml-2">({contribution.type})</span>
    </div>
  )
}

export default ExtensionSlot