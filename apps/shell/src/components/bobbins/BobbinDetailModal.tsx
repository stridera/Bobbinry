'use client'

import { ReactNode } from 'react'
import { BobbinMetadata } from './types'

interface BobbinDetailModalProps {
  bobbin: BobbinMetadata
  onClose: () => void
  actionSlot?: ReactNode
}

export function BobbinDetailModal({ bobbin, onClose, actionSlot }: BobbinDetailModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto border border-gray-200 dark:border-gray-800">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">{bobbin.name}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-2xl"
          >
            &times;
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Description</h3>
            <p className="text-gray-600 dark:text-gray-400">{bobbin.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Version</h3>
              <p className="text-gray-600 dark:text-gray-400">{bobbin.version}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Author</h3>
              <p className="text-gray-600 dark:text-gray-400">{bobbin.author}</p>
            </div>
            {bobbin.license && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">License</h3>
                <p className="text-gray-600 dark:text-gray-400">{bobbin.license}</p>
              </div>
            )}
          </div>

          {bobbin.tags && bobbin.tags.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {bobbin.tags.map(tag => (
                  <span key={tag} className="px-3 py-1 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-400 rounded-full text-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {bobbin.capabilities && Object.keys(bobbin.capabilities).length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Capabilities</h3>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-1">
                {bobbin.capabilities.publishable && <li>Publishable content</li>}
                {bobbin.capabilities.external && <li>External API access</li>}
                {bobbin.capabilities.ai && <li>AI integration</li>}
                {bobbin.capabilities.customViews && <li>Custom UI views</li>}
              </ul>
            </div>
          )}

          {bobbin.isInstalled && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-green-800 dark:text-green-300 text-sm">
                This bobbin is currently installed (v{bobbin.installedVersion})
              </p>
            </div>
          )}

          {actionSlot && (
            <div className="mt-6 flex justify-end">
              {actionSlot}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
