/**
 * Configuration View
 *
 * Visual interface for creating and managing entity types
 *
 * TODO: Implement features:
 * - Template selection screen with grid of available templates
 * - Template preview modal showing fields and layout
 * - "Use Template" / "Create from Scratch" flow
 * - Field builder with drag-and-drop
 * - Layout designer with live preview
 * - Save functionality that writes to entity_type_definitions table
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { useClickOutside } from '@bobbinry/sdk'
import { Toast, ToastContainer } from '@bobbinry/ui-components'
import { templates } from '../templates'
import { getTypeId } from '../types'
import type { EntityTemplate, EntityTypeDefinition, FieldDefinition, FieldType, EditorLayout, ListLayout } from '../types'
import { TemplatePreviewModal } from '../components/TemplatePreviewModal'
import { FieldBuilder } from '../components/FieldBuilder'
import { LayoutDesigner } from '../components/LayoutDesigner'

/** Detect structural changes between old and new field definitions */
function detectFieldChanges(
  original: FieldDefinition[],
  updated: FieldDefinition[]
): {
  hasChanges: boolean
  typeChanges: Array<{ fieldName: string; fieldLabel: string; oldType: FieldType; newType: FieldType }>
  added: string[]
  removed: string[]
} {
  const typeChanges: Array<{ fieldName: string; fieldLabel: string; oldType: FieldType; newType: FieldType }> = []
  const originalNames = new Set(original.map(f => f.name))
  const updatedNames = new Set(updated.map(f => f.name))

  for (const updatedField of updated) {
    const originalField = original.find(f => f.name === updatedField.name)
    if (originalField && originalField.type !== updatedField.type) {
      typeChanges.push({
        fieldName: updatedField.name,
        fieldLabel: updatedField.label,
        oldType: originalField.type,
        newType: updatedField.type,
      })
    }
  }

  const added = updated.filter(f => !originalNames.has(f.name)).map(f => f.name)
  const removed = original.filter(f => !updatedNames.has(f.name)).map(f => f.name)

  return {
    hasChanges: typeChanges.length > 0 || added.length > 0 || removed.length > 0,
    typeChanges,
    added,
    removed,
  }
}

interface ConfigViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  metadata?: Record<string, any>
}

export default function ConfigView({ projectId, sdk, metadata }: ConfigViewProps) {
  const [entityTypes, setEntityTypes] = useState<EntityTypeDefinition[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<EntityTemplate | null>(null)
  const [showTemplateSelector, setShowTemplateSelector] = useState(true)
  const [previewTemplate, setPreviewTemplate] = useState<EntityTemplate | null>(null)
  
  // Toast state
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'danger' } | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])

  // Editing state — null means creating new, string means editing existing
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)

  // Customization state
  const [customFields, setCustomFields] = useState<FieldDefinition[]>([])
  const [entityLabel, setEntityLabel] = useState('')
  const [entityIcon, setEntityIcon] = useState('')
  const [editorLayout, setEditorLayout] = useState<EditorLayout>({
    template: 'compact-card',
    imagePosition: 'top-right',
    imageSize: 'medium',
    headerFields: ['name'],
    sections: []
  })
  const [listLayout, setListLayout] = useState<ListLayout>({
    display: 'grid',
    cardSize: 'medium',
    showFields: ['name', 'description']
  })

  useEffect(() => {
    loadEntityTypes()
  }, [projectId])

  // Auto-edit a specific entity type when navigated with editTypeId metadata
  useEffect(() => {
    if (metadata?.editTypeId && entityTypes.length > 0) {
      const type = entityTypes.find(t => getTypeId(t) === metadata.editTypeId)
      if (type) {
        handleEditType(type)
      }
    }
  }, [metadata?.editTypeId, entityTypes])

  function navigateToNewEntity(typeId: string, type: EntityTypeDefinition) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: typeId,
          entityId: 'new',
          bobbinId: 'entities',
          metadata: {
            view: 'entity-editor',
            isNew: true,
            typeId,
            typeLabel: type.label,
            typeIcon: type.icon
          }
        }
      }))
    }
  }

  function navigateToEntityList(typeId: string, type: EntityTypeDefinition) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: typeId,
          entityId: 'list',
          bobbinId: 'entities',
          metadata: {
            view: 'entity-list',
            typeId,
            typeLabel: type.label,
            typeIcon: type.icon
          }
        }
      }))
    }
  }

  async function loadEntityTypes() {
    try {
      console.log('[ConfigView] Loading entity types for project:', projectId)

      const result = await sdk.entities.query({ collection: 'entity_type_definitions' })
      setEntityTypes(result.data)
      console.log('[ConfigView] Loaded entity types:', result.data)
    } catch (error) {
      console.error('[ConfigView] Error loading entity types:', error)
    }
  }

  async function handleUseTemplate(template: EntityTemplate) {
    setEditingTypeId(null)
    setSelectedTemplate(template)
    setEntityLabel(template.label)
    setEntityIcon(template.icon)
    setCustomFields([...template.customFields])
    setEditorLayout({ ...template.editorLayout })
    setListLayout({ ...template.listLayout })
    setShowTemplateSelector(false)
  }

  async function handleCreateFromScratch() {
    setEditingTypeId(null)
    setEntityLabel('')
    setEntityIcon('')
    setCustomFields([])
    setEditorLayout({ template: 'compact-card', imagePosition: 'top-right', imageSize: 'medium', headerFields: ['name'], sections: [] })
    setListLayout({ display: 'grid', cardSize: 'medium', showFields: ['name', 'description'] })
    setSelectedTemplate(null)
    setShowTemplateSelector(false)
  }

  function handleEditType(type: EntityTypeDefinition) {
    setEditingTypeId(type.id)
    setEntityLabel(type.label)
    setEntityIcon(type.icon)
    setCustomFields([...type.customFields])
    setEditorLayout({ ...type.editorLayout })
    setListLayout({ ...type.listLayout })
    setSelectedTemplate(null)
    setShowTemplateSelector(false)
  }

  async function handleDeleteType(type: EntityTypeDefinition) {
    try {
      await sdk.entities.delete('entity_type_definitions', type.id)

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bobbinry:entities-changed', {
          detail: { collection: 'entity_type_definitions', action: 'deleted' }
        }))
      }

      setToast({ message: `Entity type "${type.label}" deleted.`, variant: 'success' })
      await loadEntityTypes()
    } catch (error) {
      console.error('[ConfigView] Failed to delete entity type:', error)
      setToast({ message: 'Failed to delete entity type.', variant: 'danger' })
    }
  }

  async function handleSaveEntityType() {
    try {
      // When editing, preserve the original type_id (existing entities reference it)
      const editingType = editingTypeId ? entityTypes.find(t => t.id === editingTypeId) : null
      const typeIdValue = editingType ? getTypeId(editingType) : entityLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')

      // Detect field changes for schema versioning
      let schemaVersion = 1
      let fieldHistory: Array<{ version: number; fields: FieldDefinition[]; changedAt: string }> = []
      let versionBumped = false

      if (editingType) {
        const originalFields: FieldDefinition[] = editingType.customFields || (editingType as any).custom_fields || []
        const currentVersion: number = (editingType as any).schema_version || 1
        fieldHistory = (editingType as any)._field_history || []
        schemaVersion = currentVersion

        const changes = detectFieldChanges(originalFields, customFields)
        if (changes.hasChanges) {
          // Bump version and archive old fields
          fieldHistory = [...fieldHistory, {
            version: currentVersion,
            fields: originalFields,
            changedAt: new Date().toISOString(),
          }]
          schemaVersion = currentVersion + 1
          versionBumped = true
        }
      }

      const data = {
        type_id: typeIdValue,
        label: entityLabel,
        icon: entityIcon,
        template_id: selectedTemplate?.id || null,
        base_fields: ['name', 'description', 'tags', 'image_url'],
        custom_fields: customFields,
        editor_layout: editorLayout,
        list_layout: listLayout,
        subtitle_fields: selectedTemplate?.subtitleFields || [],
        allow_duplicates: true,
        schema_version: schemaVersion,
        _field_history: fieldHistory,
      }

      if (editingTypeId) {
        await sdk.entities.update('entity_type_definitions', editingTypeId, data)
      } else {
        await sdk.entities.create('entity_type_definitions', data)
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bobbinry:entities-changed', {
          detail: { collection: 'entity_type_definitions', action: editingTypeId ? 'updated' : 'created' }
        }))
      }

      setToast({
        message: editingTypeId
          ? versionBumped
            ? `Entity type "${entityLabel}" updated (schema v${schemaVersion}). Existing entities will show an update prompt.`
            : `Entity type "${entityLabel}" updated.`
          : `Entity type "${entityLabel}" created! It's now available in the navigation panel.`,
        variant: 'success'
      })

      await loadEntityTypes()
      setShowTemplateSelector(true)
      setSelectedTemplate(null)
      setEditingTypeId(null)
    } catch (error) {
      console.error('[ConfigView] Failed to save entity type:', error)
      setToast({ message: 'Failed to save entity type. Check console for details.', variant: 'danger' })
    }
  }

  if (showTemplateSelector) {
    return (
      <>
        <style>{`
          .scrollable-config::-webkit-scrollbar {
            width: 8px;
          }
          .scrollable-config::-webkit-scrollbar-track {
            background: rgb(243 244 246);
          }
          .dark .scrollable-config::-webkit-scrollbar-track {
            background: rgb(31 41 55);
          }
          .scrollable-config::-webkit-scrollbar-thumb {
            background: rgb(209 213 219);
            border-radius: 9999px;
          }
          .dark .scrollable-config::-webkit-scrollbar-thumb {
            background: rgb(75 85 99);
          }
          .scrollable-config::-webkit-scrollbar-thumb:hover {
            background: rgb(156 163 175);
          }
          .dark .scrollable-config::-webkit-scrollbar-thumb:hover {
            background: rgb(107 114 128);
          }
        `}</style>
        <div className="h-full overflow-y-auto p-8 scrollable-config">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-gray-100">
            Entity Types Configuration
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Create custom entity types for your worldbuilding
          </p>
        </div>

        {/* Existing Entity Types */}
        {entityTypes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Your Entity Types ({entityTypes.length})
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {entityTypes.map(type => (
                <EntityTypeCard
                  key={type.id}
                  type={type}
                  onEdit={handleEditType}
                  onDelete={handleDeleteType}
                  onViewAll={navigateToEntityList}
                  onNewEntity={navigateToNewEntity}
                />
              ))}
            </div>
          </div>
        )}

        {/* Create New */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
            Create New Entity Type
          </h2>
          <div className="flex gap-4 mb-6">
            <button
              onClick={handleCreateFromScratch}
              className="px-6 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              🎨 Create from Scratch
            </button>
          </div>
        </div>

        {/* Template Grid */}
        <div>
          <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">
            Templates
          </h3>
          <div className="grid grid-cols-2 gap-6">
            {templates.map(template => (
              <div
                key={template.id}
                className="p-6 border-2 border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-600 bg-white dark:bg-gray-800"
              >
                <div className="flex items-start gap-4 mb-3">
                  <span className="text-4xl">{template.icon}</span>
                  <div className="flex-1">
                    <h4 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                      {template.label}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {template.description}
                    </p>
                  </div>
                </div>

                <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  <strong>Includes:</strong> {template.customFields.slice(0, 4).map(f => f.label).join(', ')}
                  {template.customFields.length > 4 && `, +${template.customFields.length - 4} more`}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleUseTemplate(template)}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Use Template
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewTemplate(template)
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Preview
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Preview Modal */}
        {previewTemplate && (
          <TemplatePreviewModal
            template={previewTemplate}
            onClose={() => setPreviewTemplate(null)}
            onUseTemplate={(template) => {
              setPreviewTemplate(null)
              handleUseTemplate(template)
            }}
          />
        )}
      </div>
      {toast && (
        <ToastContainer position="bottom-center">
          <Toast message={toast.message} variant={toast.variant} duration={4000} onDismiss={dismissToast} />
        </ToastContainer>
      )}
      </>
    )
  }

  // Customization view
  return (
    <>
      <style>{`
        .scrollable-config::-webkit-scrollbar {
          width: 8px;
        }
        .scrollable-config::-webkit-scrollbar-track {
          background: rgb(243 244 246);
        }
        .dark .scrollable-config::-webkit-scrollbar-track {
          background: rgb(31 41 55);
        }
        .scrollable-config::-webkit-scrollbar-thumb {
          background: rgb(209 213 219);
          border-radius: 9999px;
        }
        .dark .scrollable-config::-webkit-scrollbar-thumb {
          background: rgb(75 85 99);
        }
        .scrollable-config::-webkit-scrollbar-thumb:hover {
          background: rgb(156 163 175);
        }
        .dark .scrollable-config::-webkit-scrollbar-thumb:hover {
          background: rgb(107 114 128);
        }
      `}</style>
      <div className="h-full overflow-y-auto p-8 scrollable-config">
      <button
        onClick={() => {
          setShowTemplateSelector(true)
          setSelectedTemplate(null)
          setEditingTypeId(null)
        }}
        className="mb-6 text-blue-600 hover:text-blue-700 flex items-center gap-2"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">
          {editingTypeId ? `Edit "${entityLabel}"` : 'New Entity Type'}
        </h2>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Entity Type Name
            </label>
            <input
              type="text"
              value={entityLabel}
              onChange={(e) => setEntityLabel(e.target.value)}
              placeholder="e.g., Characters, Locations, Spells"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Icon (emoji)
            </label>
            <input
              type="text"
              value={entityIcon}
              onChange={(e) => setEntityIcon(e.target.value)}
              placeholder="🧙"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-2xl"
            />
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Base Fields (automatically included):</strong> name, description, tags, image_url
          </div>
        </div>
      </div>

      {/* Field Builder */}
      <FieldBuilder
        fields={customFields}
        onChange={setCustomFields}
        entityTypes={entityTypes.map(et => ({
          typeId: getTypeId(et),
          label: et.label,
          icon: et.icon,
        }))}
      />

      {/* Layout Designer */}
      <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
        <LayoutDesigner
          fields={customFields}
          editorLayout={editorLayout}
          listLayout={listLayout}
          onChange={(newEditorLayout, newListLayout) => {
            setEditorLayout(newEditorLayout)
            setListLayout(newListLayout)
          }}
        />
      </div>

      {/* Save Actions */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
        <button
          onClick={() => {
            setShowTemplateSelector(true)
            setSelectedTemplate(null)
            setEditingTypeId(null)
          }}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            await handleSaveEntityType()
          }}
          disabled={!entityLabel || !entityIcon}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {editingTypeId ? 'Save Changes' : 'Save Entity Type'}
        </button>
      </div>
    </div>
    {toast && (
      <ToastContainer position="bottom-center">
        <Toast message={toast.message} variant={toast.variant} duration={4000} onDismiss={dismissToast} />
      </ToastContainer>
    )}
    </>
  )
}

/** Entity type card with edit/delete actions */
function EntityTypeCard({
  type,
  onEdit,
  onDelete,
  onViewAll,
  onNewEntity,
}: {
  type: EntityTypeDefinition
  onEdit: (type: EntityTypeDefinition) => void
  onDelete: (type: EntityTypeDefinition) => void
  onViewAll: (typeId: string, type: EntityTypeDefinition) => void
  onNewEntity: (typeId: string, type: EntityTypeDefinition) => void
}) {
  const typeId = getTypeId(type)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fieldCount = (type.baseFields?.length || 4) + (type.customFields?.length || 0)

  useClickOutside(menuRef, () => { setMenuOpen(false); setConfirmDelete(false) })

  return (
    <div className="group relative rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-all hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600">
      {/* Gear menu — top right, visible on hover */}
      <div className="absolute top-2.5 right-2.5 z-10" ref={menuRef}>
        <button
          onClick={() => { setMenuOpen(!menuOpen); setConfirmDelete(false) }}
          className="p-1 rounded-md text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all cursor-pointer"
          title="Edit type"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
            <button
              onClick={() => { setMenuOpen(false); onEdit(type) }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Fields
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            ) : (
              <button
                onClick={() => { setMenuOpen(false); setConfirmDelete(false); onDelete(type) }}
                className="w-full text-left px-3 py-2 text-sm text-white bg-red-600 hover:bg-red-700 flex items-center gap-2 cursor-pointer font-medium"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Confirm Delete
              </button>
            )}
          </div>
        )}
      </div>

      {/* Card body — clickable to view all */}
      <button
        onClick={() => onViewAll(typeId, type)}
        className="w-full text-left p-5 pb-3 cursor-pointer"
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl w-10 h-10 flex items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700/50">{type.icon}</span>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{type.label}</div>
            <div className="text-xs text-gray-400 dark:text-gray-500">{fieldCount} fields</div>
          </div>
        </div>
      </button>

      {/* Quick action */}
      <div className="px-5 pb-4">
        <button
          onClick={() => onNewEntity(typeId, type)}
          className="w-full px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
        >
          + New {type.label}
        </button>
      </div>
    </div>
  )
}
