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
import {
  BobbinrySDK,
  PanelActionButton,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelLoadingState,
  PanelPill,
} from '@bobbinry/sdk'
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
    return <PanelLoadingState label="Loading entity preview…" />
  }

  // Disambiguation UI
  if (disambiguate.length > 1) {
    return (
      <PanelFrame>
        <PanelBody className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">Select which entity should appear in the preview panel.</div>
            <PanelPill>{disambiguate.length} matches</PanelPill>
          </div>
          {disambiguate.map((entry) => (
            <button
              key={entry.id}
              onClick={() => selectForPreview(entry)}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:bg-gray-700/50"
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
        </PanelBody>
      </PanelFrame>
    )
  }

  if (error) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelCard className="text-sm text-red-700 dark:text-red-300">{error}</PanelCard>
        </PanelBody>
      </PanelFrame>
    )
  }

  if (!preview) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelEmptyState
            title="Nothing selected"
            description="Click a highlighted entity or choose a record from the entity list to preview it here."
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame>
      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {preview.entity.name || 'Untitled'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{preview.typeName}</div>
          </div>
          <span className="text-lg">{preview.typeIcon}</span>
        </div>

        <LayoutRenderer
          layout={preview.typeConfig.editorLayout}
          fields={preview.typeConfig.customFields}
          entity={preview.entity}
          onFieldChange={() => {}}
          readonly={true}
        />
      </PanelBody>

      <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-700">
        <PanelActionButton
          onClick={() => openInEditor(preview)}
          tone="primary"
          className="w-full"
        >
          Open in Editor
        </PanelActionButton>
      </div>
    </PanelFrame>
  )
}
