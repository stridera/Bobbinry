'use client'

import { ReactNode } from 'react'
import { BobbinMetadata } from './types'

interface BobbinCardProps {
  bobbin: BobbinMetadata
  onViewDetails: () => void
  actionSlot: ReactNode
}

export function BobbinCard({ bobbin, onViewDetails, actionSlot }: BobbinCardProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all overflow-hidden">
      {/* Bobbin Header */}
      <div className="p-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">{bobbin.name}</h3>
          {bobbin.isInstalled && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
              Installed
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{bobbin.description}</p>

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">v{bobbin.version}</span>
          <span className="text-gray-400 dark:text-gray-600">&middot;</span>
          <span className="text-gray-500 dark:text-gray-400">{bobbin.author}</span>
        </div>
      </div>

      {/* Tags */}
      {bobbin.tags && bobbin.tags.length > 0 && (
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex flex-wrap gap-2">
            {bobbin.tags.map(tag => (
              <span key={tag} className="inline-block px-2 py-1 text-xs bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-400 rounded">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities */}
      {bobbin.capabilities && Object.keys(bobbin.capabilities).length > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
            {bobbin.capabilities.publishable && <span>Publishable</span>}
            {bobbin.capabilities.external && <span>External</span>}
            {bobbin.capabilities.ai && <span>AI</span>}
            {bobbin.capabilities.customViews && <span>Custom Views</span>}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-800 flex gap-2">
        <button
          onClick={onViewDetails}
          className="flex-1 px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          View Details
        </button>
        {actionSlot}
      </div>
    </div>
  )
}
