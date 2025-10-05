/**
 * Layout Designer Component
 *
 * Visual editor for configuring entity editor and list layouts
 */

import { useState } from 'react'
import type { EditorLayout, ListLayout, LayoutSection, LayoutTemplate, ImagePosition, ImageSize, SectionDisplay, FieldDefinition } from '../types'

interface LayoutDesignerProps {
  fields: FieldDefinition[]
  editorLayout: EditorLayout
  listLayout: ListLayout
  onChange: (editorLayout: EditorLayout, listLayout: ListLayout) => void
}

const LAYOUT_TEMPLATES: { value: LayoutTemplate; label: string; description: string }[] = [
  { value: 'compact-card', label: 'Compact Card', description: 'Minimal layout with small image' },
  { value: 'hero-image', label: 'Hero Image', description: 'Prominent full-width image' },
  { value: 'list-details', label: 'List & Details', description: 'Two-column layout' }
]

const IMAGE_POSITIONS: { value: ImagePosition; label: string }[] = [
  { value: 'top-right', label: 'Top Right' },
  { value: 'top-full-width', label: 'Top Full Width' },
  { value: 'left-sidebar', label: 'Left Sidebar' },
  { value: 'none', label: 'No Image' }
]

const IMAGE_SIZES: { value: ImageSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' }
]

const SECTION_DISPLAYS: { value: SectionDisplay; label: string }[] = [
  { value: 'inline', label: 'Inline (horizontal)' },
  { value: 'stacked', label: 'Stacked (vertical)' },
  { value: 'json-editor', label: 'JSON Editor' },
  { value: 'rich-text', label: 'Rich Text Editor' }
]

export function LayoutDesigner({ fields, editorLayout, listLayout, onChange }: LayoutDesignerProps) {
  const [activeTab, setActiveTab] = useState<'editor' | 'list'>('editor')

  const allFields = ['name', 'description', 'tags', 'image_url', ...fields.map(f => f.name)]
  const availableFields = allFields.filter(f => f !== 'image_url')

  function updateEditorLayout(updates: Partial<EditorLayout>) {
    onChange({ ...editorLayout, ...updates }, listLayout)
  }

  function updateListLayout(updates: Partial<ListLayout>) {
    onChange(editorLayout, { ...listLayout, ...updates })
  }

  function addSection() {
    const newSection: LayoutSection = {
      title: `Section ${editorLayout.sections.length + 1}`,
      fields: [],
      display: 'stacked'
    }
    updateEditorLayout({
      sections: [...editorLayout.sections, newSection]
    })
  }

  function updateSection(index: number, updates: Partial<LayoutSection>) {
    const newSections = editorLayout.sections.map((section, i) =>
      i === index ? { ...section, ...updates } : section
    )
    updateEditorLayout({ sections: newSections })
  }

  function removeSection(index: number) {
    updateEditorLayout({
      sections: editorLayout.sections.filter((_, i) => i !== index)
    })
  }

  function toggleHeaderField(field: string) {
    const current = editorLayout.headerFields
    const updated = current.includes(field)
      ? current.filter(f => f !== field)
      : [...current, field]
    updateEditorLayout({ headerFields: updated })
  }

  function toggleSectionField(sectionIndex: number, field: string) {
    const section = editorLayout.sections[sectionIndex]
    const updated = section.fields.includes(field)
      ? section.fields.filter(f => f !== field)
      : [...section.fields, field]
    updateSection(sectionIndex, { fields: updated })
  }

  function toggleListField(field: string) {
    const current = listLayout.showFields
    const updated = current.includes(field)
      ? current.filter(f => f !== field)
      : [...current, field]
    updateListLayout({ showFields: updated })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Layout Configuration
        </h3>
        <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-4 py-2 rounded ${
              activeTab === 'editor'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            Editor Layout
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 rounded ${
              activeTab === 'list'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            List Layout
          </button>
        </div>
      </div>

      {activeTab === 'editor' ? (
        <div className="space-y-6">
          {/* Template Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Layout Template
            </label>
            <div className="grid grid-cols-3 gap-3">
              {LAYOUT_TEMPLATES.map(template => (
                <button
                  key={template.value}
                  onClick={() => updateEditorLayout({ template: template.value })}
                  className={`p-4 border-2 rounded-lg text-left transition ${
                    editorLayout.template === template.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-blue-300'
                  }`}
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">{template.label}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {template.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Image Configuration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Image Position
              </label>
              <select
                value={editorLayout.imagePosition}
                onChange={(e) => updateEditorLayout({ imagePosition: e.target.value as ImagePosition })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                {IMAGE_POSITIONS.map(pos => (
                  <option key={pos.value} value={pos.value}>{pos.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Image Size
              </label>
              <select
                value={editorLayout.imageSize}
                onChange={(e) => updateEditorLayout({ imageSize: e.target.value as ImageSize })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                disabled={editorLayout.imagePosition === 'none'}
              >
                {IMAGE_SIZES.map(size => (
                  <option key={size.value} value={size.value}>{size.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Header Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Header Fields (shown at top)
            </label>
            <div className="flex flex-wrap gap-2">
              {availableFields.map(field => (
                <button
                  key={field}
                  onClick={() => toggleHeaderField(field)}
                  className={`px-3 py-1 rounded text-sm transition ${
                    editorLayout.headerFields.includes(field)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300'
                  }`}
                >
                  {field}
                </button>
              ))}
            </div>
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Content Sections ({editorLayout.sections.length})
              </label>
              <button
                onClick={addSection}
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              >
                + Add Section
              </button>
            </div>

            <div className="space-y-3">
              {editorLayout.sections.map((section, index) => (
                <div
                  key={index}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-800"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      type="text"
                      value={section.title}
                      onChange={(e) => updateSection(index, { title: e.target.value })}
                      className="flex-1 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Section title"
                    />
                    <select
                      value={section.display}
                      onChange={(e) => updateSection(index, { display: e.target.value as SectionDisplay })}
                      className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                    >
                      {SECTION_DISPLAYS.map(disp => (
                        <option key={disp.value} value={disp.value}>{disp.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeSection(index)}
                      className="px-3 py-1 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 rounded text-sm"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {availableFields.map(field => (
                      <button
                        key={field}
                        onClick={() => toggleSectionField(index, field)}
                        className={`px-2 py-1 rounded text-xs transition ${
                          section.fields.includes(field)
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300'
                        }`}
                      >
                        {field}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {editorLayout.sections.length === 0 && (
                <div className="text-center py-6 text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                  No sections yet. Click "Add Section" to organize your fields.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* List Display Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Display Mode
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => updateListLayout({ display: 'grid' })}
                className={`p-4 border-2 rounded-lg text-left ${
                  listLayout.display === 'grid'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-300'
                }`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">Grid</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Cards in a responsive grid
                </div>
              </button>
              <button
                onClick={() => updateListLayout({ display: 'list' })}
                className={`p-4 border-2 rounded-lg text-left ${
                  listLayout.display === 'list'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-300'
                }`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">List</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Compact list rows
                </div>
              </button>
            </div>
          </div>

          {/* Card Size */}
          {listLayout.display === 'grid' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Card Size
              </label>
              <select
                value={listLayout.cardSize || 'medium'}
                onChange={(e) => updateListLayout({ cardSize: e.target.value as 'small' | 'medium' | 'large' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          )}

          {/* Show Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Fields to Display
            </label>
            <div className="flex flex-wrap gap-2">
              {availableFields.map(field => (
                <button
                  key={field}
                  onClick={() => toggleListField(field)}
                  className={`px-3 py-1 rounded text-sm transition ${
                    listLayout.showFields.includes(field)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300'
                  }`}
                >
                  {field}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
