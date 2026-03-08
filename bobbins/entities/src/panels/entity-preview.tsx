/**
 * Entity Preview Panel (Right Panel)
 *
 * Listens for `bobbinry:entity-preview` events dispatched by the
 * entity-highlight TipTap extension when a highlighted entity name
 * is clicked in the manuscript editor.
 *
 * Shows entity details with a link to the full entity editor.
 */

import { useState, useEffect, useMemo } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'
import type { EntityTypeDefinition } from '../types'
import { LayoutRenderer } from '../components/LayoutRenderer'

interface EntityPreviewPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
}

interface PreviewEntity {
  id: string
  typeId: string
  typeName: string
  typeIcon: string
  entity: Record<string, any>
  typeConfig: EntityTypeDefinition
}

export default function EntityPreviewPanel({ context }: EntityPreviewPanelProps) {
  const [preview, setPreview] = useState<PreviewEntity | null>(null)
  const [disambiguate, setDisambiguate] = useState<PreviewEntity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sdk] = useState(() => new BobbinrySDK('entities'))
  const projectId = useMemo(
    () => context?.projectId || context?.currentProject,
    [context?.projectId, context?.currentProject]
  )

  useEffect(() => {
    if (context?.apiToken) {
      sdk.api.setAuthToken(context.apiToken)
    }
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId) {
      sdk.setProject(projectId)
    }
  }, [projectId, sdk])

  // Listen for entity-preview events from the editor's highlight extension
  useEffect(() => {
    function handlePreview(event: Event) {
      const { entityId, entityType, entityName } = (event as CustomEvent).detail
      if (!entityId || !projectId || !context?.apiToken) return
      loadPreview(entityId, entityType, entityName)
    }

    window.addEventListener('bobbinry:entity-preview', handlePreview)
    return () => window.removeEventListener('bobbinry:entity-preview', handlePreview)
  }, [projectId, context?.apiToken]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPreview(entityId: string, entityType: string, entityName: string) {
    try {
      setLoading(true)
      setError(null)
      setDisambiguate([])
      setPreview(null)

      // Load type definition for this entity type
      const typeDefsRes = await sdk.entities.query({
        collection: 'entity_type_definitions',
        limit: 100,
      })
      const typeDefs = (typeDefsRes.data as any[]) || []
      const typeDef = typeDefs.find((td: any) => (td.typeId || td.type_id) === entityType)

      if (!typeDef) {
        setError(`Unknown entity type: ${entityType}`)
        setLoading(false)
        return
      }

      const typeConfig: EntityTypeDefinition = {
        id: typeDef.id,
        projectId: typeDef.projectId || typeDef.project_id,
        bobbinId: typeDef.bobbinId || typeDef.bobbin_id,
        typeId: typeDef.typeId || typeDef.type_id,
        label: typeDef.label,
        icon: typeDef.icon || '',
        templateId: typeDef.templateId || typeDef.template_id,
        baseFields: typeDef.baseFields || typeDef.base_fields || [],
        customFields: typeDef.customFields || typeDef.custom_fields || [],
        editorLayout: typeDef.editorLayout || typeDef.editor_layout || { template: 'compact-card', imagePosition: 'none', imageSize: 'small', headerFields: [], sections: [] },
        listLayout: typeDef.listLayout || typeDef.list_layout || { display: 'list', showFields: [] },
        subtitleFields: typeDef.subtitleFields || typeDef.subtitle_fields || [],
        allowDuplicates: typeDef.allowDuplicates ?? typeDef.allow_duplicates ?? false,
        createdAt: new Date(typeDef.createdAt || typeDef.created_at),
        updatedAt: new Date(typeDef.updatedAt || typeDef.updated_at),
      }

      // Multiple IDs? Disambiguate.
      const ids = entityId.split(',')
      if (ids.length > 1) {
        const entities: PreviewEntity[] = []
        for (const id of ids) {
          try {
            const entityData = await sdk.entities.get(entityType, id.trim())
            entities.push({
              id: id.trim(),
              typeId: entityType,
              typeName: typeConfig.label,
              typeIcon: typeConfig.icon,
              entity: entityData as Record<string, any>,
              typeConfig,
            })
          } catch {
            // Skip entities that fail to load
          }
        }
        if (entities.length === 1) {
          setPreview(entities[0]!)
        } else if (entities.length > 1) {
          setDisambiguate(entities)
        } else {
          setError(`Could not load entities for "${entityName}"`)
        }
      } else {
        const entityData = await sdk.entities.get(entityType, entityId)
        setPreview({
          id: entityId,
          typeId: entityType,
          typeName: typeConfig.label,
          typeIcon: typeConfig.icon,
          entity: entityData as Record<string, any>,
          typeConfig,
        })
      }

      setLoading(false)
    } catch (err: any) {
      console.error('[EntityPreview] Failed to load:', err)
      setError(err.message || 'Failed to load entity')
      setLoading(false)
    }
  }

  function openInEditor(entry: PreviewEntity) {
    window.dispatchEvent(
      new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: entry.typeId,
          entityId: entry.id,
          bobbinId: 'entities',
          metadata: {
            view: 'entity-editor',
            typeId: entry.typeId,
            typeLabel: entry.typeName,
            typeIcon: entry.typeIcon,
          },
        },
      })
    )
  }

  function selectForPreview(entry: PreviewEntity) {
    setPreview(entry)
    setDisambiguate([])
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        <div className="animate-pulse">Loading entity...</div>
      </div>
    )
  }

  // Disambiguation UI
  if (disambiguate.length > 1) {
    return (
      <div className="h-full flex flex-col bg-white dark:bg-gray-800">
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Multiple Matches</h3>
          <p className="text-xs text-gray-400 mt-1">Select which entity to preview:</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {disambiguate.map((entry) => (
            <button
              key={entry.id}
              onClick={() => selectForPreview(entry)}
              className="w-full px-3 py-2 rounded flex items-center gap-3 text-left bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
            >
              <span className="text-lg">{entry.typeIcon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {entry.entity.name}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {entry.typeName}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col bg-white dark:bg-gray-800">
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Entity Preview</h3>
        </div>
        <div className="p-4">
          <div className="text-sm text-red-400">{error}</div>
        </div>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="h-full flex flex-col bg-white dark:bg-gray-800">
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Entity Preview</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-gray-500 text-center">
            Click a highlighted entity name in the editor to preview it here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-lg">{preview.typeIcon}</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {preview.entity.name}
            </h3>
            <p className="text-xs text-gray-400">{preview.typeName}</p>
          </div>
        </div>
      </div>

      {/* Entity fields */}
      <div className="flex-1 overflow-y-auto p-3">
        <LayoutRenderer
          layout={preview.typeConfig.editorLayout}
          fields={preview.typeConfig.customFields}
          entity={preview.entity}
          onFieldChange={() => {}}
          readonly={true}
        />
      </div>

      {/* Open in Editor button */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={() => openInEditor(preview)}
          className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors"
        >
          Open in Editor
        </button>
      </div>
    </div>
  )
}
