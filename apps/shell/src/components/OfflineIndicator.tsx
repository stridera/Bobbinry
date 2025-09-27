'use client'

import { useOfflineStatus } from '@/lib/service-worker'
import { useState } from 'react'

export function OfflineIndicator() {
  const { isOnline, hasUpdates, updateApp, isHydrated } = useOfflineStatus()
  const [isUpdating, setIsUpdating] = useState(false)

  // Don't render until hydrated to prevent mismatch
  if (!isHydrated) {
    return (
      <div className="fixed top-4 right-4 z-50 space-y-2">
        <div className="px-3 py-1 rounded-full text-sm font-medium transition-all duration-300 bg-red-100 text-red-800 border border-red-200 shadow-lg">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>Offline</span>
          </div>
        </div>
        <div className="bg-amber-100 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg shadow-lg max-w-xs">
          <div className="flex items-start space-x-2">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium">Working offline</p>
              <p className="text-xs text-amber-600 mt-1">Changes will sync when you reconnect</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleUpdate = async () => {
    setIsUpdating(true)
    try {
      await updateApp()
    } catch (error) {
      console.error('Update failed:', error)
      setIsUpdating(false)
    }
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {/* Online/Offline Status */}
      <div
        className={`px-3 py-1 rounded-full text-sm font-medium transition-all duration-300 ${
          isOnline
            ? 'bg-green-100 text-green-800 border border-green-200'
            : 'bg-red-100 text-red-800 border border-red-200 shadow-lg'
        }`}
      >
        <div className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-green-500' : 'bg-red-500'
            } animate-pulse`}
          />
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      {/* Update Available Banner */}
      {hasUpdates && (
        <div className="bg-blue-100 border border-blue-200 text-blue-800 px-3 py-2 rounded-lg shadow-lg">
          <div className="flex items-center justify-between space-x-3">
            <div className="flex items-center space-x-2">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              <span className="text-sm font-medium">Update available</span>
            </div>
            <button
              onClick={handleUpdate}
              disabled={isUpdating}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isUpdating ? 'Updating...' : 'Update'}
            </button>
          </div>
        </div>
      )}

      {/* Offline Mode Info */}
      {!isOnline && (
        <div className="bg-amber-100 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg shadow-lg max-w-xs">
          <div className="flex items-start space-x-2">
            <svg
              className="w-4 h-4 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium">Working offline</p>
              <p className="text-xs text-amber-600 mt-1">
                Changes will sync when you reconnect
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OfflineIndicator