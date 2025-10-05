/**
 * Template Preview Modal
 *
 * Shows detailed preview of a template before using it
 */

import { useState } from 'react'
import type { EntityTemplate } from '../types'

interface TemplatePreviewModalProps {
  template: EntityTemplate
  onClose: () => void
  onUseTemplate: (template: EntityTemplate) => void
}

export function TemplatePreviewModal({
  template,
  onClose,
  onUseTemplate
}: TemplatePreviewModalProps) {
  const [activeTab, setActiveTab] = useState<'fields' | 'layout'>('fields')

  return (
    <>
      <style>{`
        .scrollable-preview::-webkit-scrollbar {
          width: 8px;
        }
        .scrollable-preview::-webkit-scrollbar-track {
          background: rgb(243 244 246);
        }
        .dark .scrollable-preview::-webkit-scrollbar-track {
          background: rgb(31 41 55);
        }
        .scrollable-preview::-webkit-scrollbar-thumb {
          background: rgb(209 213 219);
          border-radius: 9999px;
        }
        .dark .scrollable-preview::-webkit-scrollbar-thumb {
          background: rgb(75 85 99);
        }
        .scrollable-preview::-webkit-scrollbar-thumb:hover {
          background: rgb(156 163 175);
        }
        .dark .scrollable-preview::-webkit-scrollbar-thumb:hover {
          background: rgb(107 114 128);
        }
      `}</style>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <span className="text-5xl">{template.icon}</span>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {template.label}
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    {template.description}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ×
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <div className="flex">
              <button
                onClick={() => setActiveTab('fields')}
                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === 'fields'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                Fields
              </button>
              <button
                onClick={() => setActiveTab('layout')}
                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === 'layout'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                Layout Preview
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 scrollable-preview">
            {activeTab === 'fields' ? (
              <>
                {/* Base Fields */}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Base Fields (included in all entities)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {template.baseFields.map(field => (
                      <div
                        key={field}
                        className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded text-sm text-gray-900 dark:text-gray-100"
                      >
                        {field}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Custom Fields */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Custom Fields ({template.customFields.length})
                  </h3>
                  <div className="space-y-2">
                    {template.customFields.map(field => (
                      <div
                        key={field.name}
                        className="p-3 border border-gray-200 dark:border-gray-700 rounded"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {field.label}
                          </span>
                          <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 rounded">
                            {field.type}
                          </span>
                        </div>
                        {field.required && (
                          <span className="text-xs text-red-600 dark:text-red-400">Required</span>
                        )}
                        {field.options && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            Options: {field.options.slice(0, 3).join(', ')}
                            {field.options.length > 3 && `, +${field.options.length - 3} more`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-6">
                {/* Editor Layout Preview */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Editor Layout Preview
                  </h3>
                  <div className="border-2 border-gray-300 dark:border-gray-600 rounded-lg p-6 bg-gray-50 dark:bg-gray-900">
                    {/* Header Section */}
                    <div className={`flex gap-6 mb-6 ${template.editorLayout.imagePosition === 'left-sidebar' ? 'flex-row' : 'flex-row-reverse'}`}>
                      {/* Image Placeholder */}
                      <div className="flex-shrink-0">
                        <div className="w-32 h-32 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">
                          Image
                        </div>
                      </div>
                      {/* Header Fields */}
                      <div className="flex-1 space-y-3">
                        {template.editorLayout.headerFields.map(field => (
                          <div key={field}>
                            <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">{field}</div>
                            <div className="h-8 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded"></div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Sections */}
                    <div className="space-y-4">
                      {template.editorLayout.sections.map((section, idx) => (
                        <div key={idx} className="border-t border-gray-300 dark:border-gray-600 pt-4">
                          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                            {section.title}
                          </h4>
                          <div className="space-y-2">
                            {section.fields.map(field => {
                              const fieldDef = template.customFields.find(f => f.name === field)
                              const isTextArea = fieldDef?.type === 'rich-text' || fieldDef?.multiline
                              return (
                                <div key={field}>
                                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                                    {fieldDef?.label || field}
                                  </div>
                                  <div className={`bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded ${isTextArea ? 'h-24' : 'h-8'}`}></div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* List Layout Preview */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    List View Preview
                  </h3>
                  <div className="border-2 border-gray-300 dark:border-gray-600 rounded-lg p-6 bg-gray-50 dark:bg-gray-900">
                    <div className={`grid gap-4 ${
                      template.listLayout.display === 'grid' 
                        ? 'grid-cols-3' 
                        : 'grid-cols-1'
                    }`}>
                      {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                          <div className="flex gap-3 mb-2">
                            <div className="w-12 h-12 bg-gray-300 dark:bg-gray-700 rounded"></div>
                            <div className="flex-1">
                              <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded mb-2"></div>
                              <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-2/3"></div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={() => onUseTemplate(template)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Use This Template
            </button>
          </div>
        </div>
      </div>
    </>
  )
}