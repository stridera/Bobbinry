'use client'

/**
 * PublishManager View
 *
 * Author-facing view for manually publishing chapters to tiers.
 * Uses the SDK's PublishingAPI to publish, schedule, and embargo chapters.
 */

import { useState, useEffect } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'

interface ChapterEntry {
  id: string
  title: string
  status: string
  order: number
  publishStatus?: string
  publishedAt?: string
  publicReleaseDate?: string
  isPublished?: boolean
}

interface PublishManagerProps {
  sdk: BobbinrySDK
  projectId: string
}

export default function PublishManager({ sdk, projectId }: PublishManagerProps) {
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [scheduleModal, setScheduleModal] = useState<string | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadChapters()
  }, [projectId])

  const loadChapters = async () => {
    setLoading(true)
    try {
      // Query chapters from manuscript bobbin
      const result = await sdk.entities.query<any>({
        collection: 'Chapter',
        sort: [{ field: 'order', direction: 'asc' }],
        limit: 200
      })

      // For each chapter, get publication status
      const chaptersWithStatus = await Promise.all(
        result.data.map(async (entity: any) => {
          const chapter = entity.entityData || entity
          let pubStatus: any = null
          try {
            pubStatus = await sdk.publishing.getPublicationStatus(projectId, entity.id)
          } catch {}
          return {
            id: entity.id,
            title: chapter.title || 'Untitled',
            status: chapter.status || 'draft',
            order: chapter.order || 0,
            publishStatus: pubStatus?.publication?.publishStatus,
            publishedAt: pubStatus?.publication?.publishedAt,
            publicReleaseDate: pubStatus?.publication?.publicReleaseDate,
            isPublished: pubStatus?.publication?.isPublished
          }
        })
      )

      setChapters(chaptersWithStatus)
    } catch (err) {
      console.error('Failed to load chapters:', err)
    } finally {
      setLoading(false)
    }
  }

  const publishNow = async (chapterId: string) => {
    setActionLoading(chapterId)
    setMessage(null)
    try {
      await sdk.publishing.publishChapter(projectId, chapterId, { accessLevel: 'public' })
      setMessage({ type: 'success', text: 'Chapter published!' })
      await loadChapters()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to publish' })
    } finally {
      setActionLoading(null)
    }
  }

  const unpublish = async (chapterId: string) => {
    if (!confirm('Unpublish this chapter? Readers will lose access.')) return
    setActionLoading(chapterId)
    setMessage(null)
    try {
      await sdk.publishing.unpublishChapter(projectId, chapterId)
      setMessage({ type: 'success', text: 'Chapter unpublished' })
      await loadChapters()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to unpublish' })
    } finally {
      setActionLoading(null)
    }
  }

  const schedulePublish = async (chapterId: string) => {
    if (!scheduleDate) return
    setActionLoading(chapterId)
    setMessage(null)
    try {
      await sdk.publishing.publishChapter(projectId, chapterId, {
        accessLevel: 'public',
        publicReleaseDate: new Date(scheduleDate).toISOString()
      })
      setMessage({ type: 'success', text: 'Chapter scheduled!' })
      setScheduleModal(null)
      setScheduleDate('')
      await loadChapters()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to schedule' })
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Loading chapters...</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Publish Manager</h2>
        <button
          onClick={loadChapters}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Refresh
        </button>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded text-sm ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {chapters.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 italic">
          No chapters found. Create chapters in the Manuscript bobbin first.
        </p>
      ) : (
        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
            <div className="col-span-1">#</div>
            <div className="col-span-4">Title</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Published</div>
            <div className="col-span-3">Actions</div>
          </div>

          {chapters.map((chapter, index) => (
            <div
              key={chapter.id}
              className="grid grid-cols-12 gap-2 items-center px-3 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800"
            >
              <div className="col-span-1 text-sm text-gray-400">{index + 1}</div>
              <div className="col-span-4 font-medium text-gray-900 dark:text-gray-100 truncate">
                {chapter.title}
              </div>
              <div className="col-span-2">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  chapter.isPublished
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : chapter.publishStatus === 'scheduled'
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}>
                  {chapter.isPublished ? 'Published' : chapter.publishStatus || 'Draft'}
                </span>
              </div>
              <div className="col-span-2 text-xs text-gray-500">
                {chapter.publishedAt
                  ? new Date(chapter.publishedAt).toLocaleDateString()
                  : chapter.publicReleaseDate
                  ? `Scheduled: ${new Date(chapter.publicReleaseDate).toLocaleDateString()}`
                  : '-'}
              </div>
              <div className="col-span-3 flex gap-2">
                {chapter.isPublished ? (
                  <button
                    onClick={() => unpublish(chapter.id)}
                    disabled={actionLoading === chapter.id}
                    className="text-xs px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50"
                  >
                    Unpublish
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => publishNow(chapter.id)}
                      disabled={actionLoading === chapter.id}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actionLoading === chapter.id ? '...' : 'Publish'}
                    </button>
                    <button
                      onClick={() => setScheduleModal(chapter.id)}
                      disabled={actionLoading === chapter.id}
                      className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      Schedule
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Schedule modal */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-96">
            <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-4">Schedule Publication</h3>
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={e => setScheduleDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setScheduleModal(null); setScheduleDate('') }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={() => schedulePublish(scheduleModal)}
                disabled={!scheduleDate || actionLoading === scheduleModal}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
