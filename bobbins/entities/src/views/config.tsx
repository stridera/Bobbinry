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

import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { templates } from '../templates'
import type { EntityTemplate, EntityTypeDefinition, FieldDefinition, EditorLayout, ListLayout } from '../types'
import { TemplatePreviewModal } from '../components/TemplatePreviewModal'
import { FieldBuilder } from '../components/FieldBuilder'
import { LayoutDesigner } from '../components/LayoutDesigner'

interface ConfigViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
}

export default function ConfigView({ projectId, sdk }: ConfigViewProps) {
  const [entityTypes, setEntityTypes] = useState<EntityTypeDefinition[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<EntityTemplate | null>(null)
  const [showTemplateSelector, setShowTemplateSelector] = useState(true)
  const [previewTemplate, setPreviewTemplate] = useState<EntityTemplate | null>(null)
  
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

  async function loadEntityTypes() {
    try {
      console.log('[ConfigView] Loading entity types for project:', projectId)
      
      const response = await fetch(`/api/collections/entity_type_definitions/entities?projectId=${projectId}`)
      
      if (!response.ok) {
        throw new Error(`Failed to load entity types: ${response.statusText}`)
      }
      
      const data = await response.json()
      setEntityTypes(data.entities || [])
      console.log('[ConfigView] Loaded entity types:', data.entities)
    } catch (error) {
      console.error('[ConfigView] Error loading entity types:', error)
    }
  }

  async function handleUseTemplate(template: EntityTemplate) {
    console.log('[ConfigView] Using template:', template.id)
    setSelectedTemplate(template)
    setEntityLabel(template.label)
    setEntityIcon(template.icon)
    setCustomFields([...template.customFields])
    setEditorLayout({ ...template.editorLayout })
    setListLayout({ ...template.listLayout })
    setShowTemplateSelector(false)
  }

  async function handleCreateFromScratch() {
    console.log('[ConfigView] Creating entity type from scratch')
    setEntityLabel('')
    setEntityIcon('')
    setCustomFields([])
    setShowTemplateSelector(false)
  }

  async function handleSaveEntityType() {
    try {
      const typeId = entityLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      
      const entityTypeDefinition: Omit<EntityTypeDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
        projectId,
        bobbinId: 'entities',
        typeId,
        label: entityLabel,
        icon: entityIcon,
        templateId: selectedTemplate?.id || null,
        baseFields: ['name', 'description', 'tags', 'image_url'],
        customFields,
        editorLayout,
        listLayout,
        subtitleFields: selectedTemplate?.subtitleFields || [],
        allowDuplicates: true
      }

      console.log('[ConfigView] Saving entity type:', entityTypeDefinition)

      const response = await fetch('/api/entities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          collection: 'entity_type_definitions',
          projectId,
          data: {
            type_id: entityTypeDefinition.typeId,
            label: entityTypeDefinition.label,
            icon: entityTypeDefinition.icon,
            template_id: entityTypeDefinition.templateId,
            base_fields: entityTypeDefinition.baseFields,
            custom_fields: entityTypeDefinition.customFields,
            editor_layout: entityTypeDefinition.editorLayout,
            list_layout: entityTypeDefinition.listLayout,
            subtitle_fields: entityTypeDefinition.subtitleFields,
            allow_duplicates: entityTypeDefinition.allowDuplicates
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to save entity type: ${response.statusText}`)
      }

      const result = await response.json()
      console.log('[ConfigView] Entity type saved:', result)

      alert(`Entity type "${entityLabel}" saved successfully!

The entity type is now available in the navigation panel.`)

      // Reload entity types and return to template selector
      await loadEntityTypes()
      setShowTemplateSelector(true)
      setSelectedTemplate(null)
    } catch (error) {
      console.error('[ConfigView] Failed to save entity type:', error)
      alert('Failed to save entity type. Check console for details.')
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
        <div className="h-full overflow-y-auto p-8 max-w-6xl mx-auto scrollable-config">
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
            <div className="grid grid-cols-3 gap-4">
              {/* TODO: Render existing entity types */}
              {entityTypes.map(type => (
                <div key={type.id} className="p-4 border rounded bg-white dark:bg-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{type.icon}</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{type.label}</span>
                  </div>
                </div>
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
            <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              📚 Choose from Template
            </button>
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
            Popular Templates
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
      <div className="h-full overflow-y-auto p-8 max-w-6xl mx-auto scrollable-config">
      <button
        onClick={() => {
          setShowTemplateSelector(true)
          setSelectedTemplate(null)
        }}
        className="mb-6 text-blue-600 hover:text-blue-700 flex items-center gap-2"
      >
        ← Back to Templates
      </button>

      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">
          Customize Entity Type
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
          Save Entity Type
        </button>
      </div>
    </div>
    </>
  )
}
