'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  PanelActions,
  PanelActionButton,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelLoadingState,
  PanelMessage,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'
import { formatReadTime } from '../lib/format'
import {
  formatDate,
  formatDateTime,
  parseDateTimeInputValue,
  toDateTimeInputValue,
} from '../lib/time'

interface ChapterPublishProps {
  projectId: string
  apiToken?: string
  entityId?: string
  entityType?: string
  onChanged?: () => void
  context?: {
    projectId: string
    apiToken?: string
    entityId?: string
    entityType?: string
    onChanged?: () => void
  }
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  publicReleaseDate?: string | null
  viewCount?: number
}

interface ChapterAnalytics {
  totalViews: number
  uniqueReaders: number
  completions: number
  completionRate: string
  avgReadTimeSeconds: number
}

interface ProjectInfo {
  shortUrl: string | null
  ownerId: string | null
  ownerUsername: string | null
}

interface PublishConfig {
  autoReleaseEnabled?: boolean
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

async function apiFetchLocal(path: string, token: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

export default function ChapterPublishPanel(props: ChapterPublishProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const entityId = props.entityId || props.context?.entityId
  const entityType = props.entityType || props.context?.entityType
  const onChanged = props.onChanged || props.context?.onChanged

  const [publication, setPublication] = useState<ChapterPublication | null>(null)
  const [chapterAnalytics, setChapterAnalytics] = useState<ChapterAnalytics | null>(null)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)
  const [publishConfig, setPublishConfig] = useState<PublishConfig | null>(null)
  const [chapterTitle, setChapterTitle] = useState<string | null>(null)
  const [nextReleaseSlot, setNextReleaseSlot] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showScheduleEditor, setShowScheduleEditor] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      setError(null)

      const [projRes, publishConfigRes] = await Promise.all([
        apiFetchLocal(`/api/projects/${projectId}`, apiToken),
        apiFetchLocal(`/api/projects/${projectId}/publish-config`, apiToken),
      ])

      if (projRes.ok) {
        const data = await projRes.json()
        const project = data.project
        let ownerUsername: string | null = null

        if (project?.ownerId) {
          try {
            const profileRes = await fetch(`${API_URL}/api/users/${project.ownerId}/profile`)
            if (profileRes.ok) {
              const profileData = await profileRes.json()
              ownerUsername = profileData.profile?.username || null
            }
          } catch {}
        }

        setProjectInfo({
          shortUrl: project?.shortUrl || null,
          ownerId: project?.ownerId || null,
          ownerUsername,
        })
      }

      if (publishConfigRes.ok) {
        const publishConfigData = await publishConfigRes.json()
        setPublishConfig(publishConfigData.config || null)
      } else {
        setPublishConfig(null)
      }

      if (entityId && entityType === 'content') {
        try {
          const [chapterRes, pubRes, nextSlotRes] = await Promise.all([
            apiFetchLocal(`/api/entities/${entityId}?projectId=${projectId}&collection=content`, apiToken),
            apiFetchLocal(`/api/projects/${projectId}/chapters/${entityId}/publication`, apiToken),
            apiFetchLocal(`/api/projects/${projectId}/chapters/${entityId}/next-release-slot`, apiToken),
          ])

          if (chapterRes.ok) {
            const chapterData = await chapterRes.json()
            setChapterTitle(chapterData.title || chapterData.name || 'Untitled chapter')
          } else {
            setChapterTitle(null)
          }

          if (pubRes.ok) {
            const data = await pubRes.json()
            const nextPublication = data.publication || null
            setPublication(nextPublication)
            setScheduledFor(toDateTimeInputValue(nextPublication?.publishedAt || nextPublication?.publicReleaseDate, 'local'))

            if (nextPublication?.publishStatus === 'published') {
              const analyticsRes = await apiFetchLocal(
                `/api/projects/${projectId}/chapters/${entityId}/analytics`,
                apiToken
              )
              if (analyticsRes.ok) {
                const analyticsData = await analyticsRes.json()
                setChapterAnalytics(analyticsData.analytics || null)
              } else {
                setChapterAnalytics(null)
              }
            } else {
              setChapterAnalytics(null)
            }
          } else {
            setPublication(null)
            setChapterAnalytics(null)
            setScheduledFor('')
          }

          if (nextSlotRes.ok) {
            const nextSlotData = await nextSlotRes.json()
            setNextReleaseSlot(nextSlotData.nextReleaseSlot || null)
          } else {
            setNextReleaseSlot(null)
          }
        } catch {
          setChapterTitle(null)
          setPublication(null)
          setChapterAnalytics(null)
          setScheduledFor('')
          setNextReleaseSlot(null)
        }
      } else {
        setChapterTitle(null)
        setPublication(null)
        setChapterAnalytics(null)
        setScheduledFor('')
        setNextReleaseSlot(null)
      }
    } catch (err) {
      console.error('ChapterPublishPanel: Failed to load data', err)
      setError('Failed to load chapter publishing data')
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken, entityId, entityType])

  useEffect(() => {
    loadData()
  }, [loadData])

  const publishChapter = async () => {
    if (!projectId || !apiToken || !entityId) return
    setActionInProgress(true)
    setError(null)
    try {
      const isEarlyRelease = autoReleaseEnabled && isScheduled && !!publication?.publishedAt && new Date(publication.publishedAt).getTime() > Date.now()
      const response = await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${entityId}/publish`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publishStatus: 'published',
            publishEarly: isEarlyRelease,
          }),
        }
      )
      if (!response.ok) {
        throw new Error('Failed to publish chapter')
      }
      setShowScheduleEditor(false)
      await loadData()
      onChanged?.()
    } catch (err) {
      console.error('Failed to publish chapter', err)
      setError('Failed to publish chapter')
    } finally {
      setActionInProgress(false)
    }
  }

  const unpublishChapter = async () => {
    if (!projectId || !apiToken || !entityId) return
    setActionInProgress(true)
    setError(null)
    try {
      const response = await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${entityId}/unpublish`,
        apiToken,
        { method: 'POST' }
      )
      if (!response.ok) {
        throw new Error('Failed to unpublish chapter')
      }
      setShowScheduleEditor(false)
      await loadData()
      onChanged?.()
    } catch (err) {
      console.error('Failed to unpublish chapter', err)
      setError('Failed to unpublish chapter')
    } finally {
      setActionInProgress(false)
    }
  }

  const scheduleChapter = async () => {
    if (!projectId || !apiToken || !entityId || !scheduledFor) return
    setActionInProgress(true)
    setError(null)
    try {
      const scheduledDate = parseDateTimeInputValue(scheduledFor, 'local')
      if (!scheduledDate) {
        throw new Error('Invalid scheduled release time')
      }

      const response = await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${entityId}/publish`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publishStatus: 'scheduled',
            scheduledFor: scheduledDate.toISOString(),
          }),
        }
      )
      if (!response.ok) {
        throw new Error('Failed to schedule chapter')
      }
      setShowScheduleEditor(false)
      await loadData()
      onChanged?.()
    } catch (err) {
      console.error('Failed to schedule chapter', err)
      setError('Failed to schedule chapter')
    } finally {
      setActionInProgress(false)
    }
  }

  const markComplete = async () => {
    if (!projectId || !apiToken || !entityId) return
    setActionInProgress(true)
    setError(null)
    try {
      const response = await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${entityId}/complete`,
        apiToken,
        { method: 'POST' }
      )
      if (!response.ok) {
        throw new Error('Failed to mark chapter complete')
      }
      setShowScheduleEditor(false)
      await loadData()
      onChanged?.()
    } catch (err) {
      console.error('Failed to mark chapter complete', err)
      setError('Failed to mark chapter complete')
    } finally {
      setActionInProgress(false)
    }
  }

  const isProjectPublished = !!projectInfo?.shortUrl
  const isPublished = publication?.publishStatus === 'published'
  const isScheduled = publication?.publishStatus === 'scheduled'
  const isComplete = publication?.publishStatus === 'complete'
  const autoReleaseEnabled = !!publishConfig?.autoReleaseEnabled
  const isFutureScheduled = isScheduled && !!publication?.publishedAt && new Date(publication.publishedAt).getTime() > Date.now()
  const chapterReadUrl = isPublished && projectInfo?.ownerUsername && projectInfo.shortUrl && entityId
    ? `/read/${projectInfo.ownerUsername}/${projectInfo.shortUrl}/${entityId}`
    : null

  return (
    <PanelFrame>
      <PanelActions>
        <a href="/publish" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
          Dashboard
        </a>
      </PanelActions>

      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>Chapter Publishing</PanelSectionTitle>
          {isProjectPublished ? (
            <PanelPill className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
              Live
            </PanelPill>
          ) : null}
        </div>

        {loading ? (
          <PanelLoadingState label="Loading chapter publishing…" />
        ) : !isProjectPublished ? (
          <PanelEmptyState
            title="Project is not published"
            description="Enable publishing from the dashboard before you publish individual chapters."
            action={
              <a
                href="/publish"
                className="inline-flex items-center gap-1 rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                Open dashboard
              </a>
            }
          />
        ) : (
          <>
            {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}

            {entityId && entityType === 'content' ? (
              <>
                <PanelCard className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                        {chapterTitle || 'Selected chapter'}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        {isPublished
                          ? 'This chapter is live on the reader.'
                          : isScheduled
                            ? 'This chapter is scheduled for release.'
                          : autoReleaseEnabled
                            ? 'Mark this chapter complete to place it into the next auto-release slot.'
                          : isComplete
                            ? 'This chapter is complete and ready to publish.'
                          : 'Publish this chapter to the live reader.'}
                      </div>
                    </div>
                    <PanelPill className={
                      isPublished
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : isScheduled
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          : isComplete
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : ''
                    }>
                      {isPublished ? 'Published' : isScheduled ? 'Scheduled' : isComplete ? 'Complete' : 'Draft'}
                    </PanelPill>
                  </div>

                  {chapterReadUrl ? (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Reader URL</div>
                      <a
                        href={chapterReadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {chapterReadUrl}
                      </a>
                    </div>
                  ) : null}

                  {isScheduled && publication?.publishedAt ? (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Scheduled Release</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDateTime(publication.publishedAt, 'local')}
                      </div>
                    </div>
                  ) : null}

                  {publication?.publishedAt && !isScheduled ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Published {formatDate(publication.publishedAt, 'local')}
                    </p>
                  ) : null}

                  {!isPublished ? (
                    autoReleaseEnabled ? (
                      <div className="space-y-3">
                        {isScheduled ? (
                          <>
                            {isFutureScheduled ? (
                              <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                                Publish now to release this chapter immediately and move later scheduled chapters up one slot.
                              </div>
                            ) : null}
                            <div className="grid grid-cols-2 gap-2">
                              <PanelActionButton tone="primary" onClick={publishChapter} disabled={actionInProgress} className="w-full">
                                {actionInProgress ? 'Updating…' : 'Publish Now'}
                              </PanelActionButton>
                              <PanelActionButton
                                tone="danger"
                                onClick={unpublishChapter}
                                disabled={actionInProgress}
                                className="w-full"
                              >
                                {actionInProgress ? 'Updating…' : 'Unschedule'}
                              </PanelActionButton>
                            </div>
                          </>
                        ) : (
                          <>
                            {nextReleaseSlot ? (
                              <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
                                Will be published at {formatDateTime(nextReleaseSlot, 'local')}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
                                Auto-scheduling is enabled, but no release slot is currently available.
                              </div>
                            )}

                            <PanelActionButton tone="primary" onClick={markComplete} disabled={actionInProgress} className="w-full">
                              {actionInProgress ? 'Updating…' : isComplete ? 'Refresh Schedule' : 'Mark Complete'}
                            </PanelActionButton>
                          </>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <PanelActionButton tone="primary" onClick={publishChapter} disabled={actionInProgress} className="w-full">
                            {actionInProgress && !showScheduleEditor ? 'Updating…' : isScheduled ? 'Publish Now' : 'Publish Chapter'}
                          </PanelActionButton>
                          <PanelActionButton
                            onClick={() => setShowScheduleEditor((value) => !value)}
                            disabled={actionInProgress}
                            className="w-full"
                          >
                            {showScheduleEditor ? 'Hide Schedule' : isScheduled ? 'Edit Schedule' : 'Schedule'}
                          </PanelActionButton>
                        </div>

                        {showScheduleEditor ? (
                          <div className="space-y-2 rounded-lg border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-800/70">
                            <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                              Release At
                            </label>
                            <input
                              type="datetime-local"
                              value={scheduledFor}
                              onChange={(event) => setScheduledFor(event.target.value)}
                              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-100"
                            />
                            <div className="flex gap-2">
                              <PanelActionButton
                                onClick={scheduleChapter}
                                disabled={actionInProgress || !scheduledFor}
                                className="flex-1"
                              >
                                {actionInProgress ? 'Saving…' : isScheduled ? 'Update Schedule' : 'Schedule Chapter'}
                              </PanelActionButton>
                              <PanelActionButton
                                tone="danger"
                                onClick={unpublishChapter}
                                disabled={actionInProgress}
                                className="flex-1"
                              >
                                {isScheduled ? 'Cancel Schedule' : 'Clear'}
                              </PanelActionButton>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )
                  ) : (
                    <PanelActionButton tone="danger" onClick={unpublishChapter} disabled={actionInProgress} className="w-full">
                      {actionInProgress ? 'Updating…' : 'Unpublish Chapter'}
                    </PanelActionButton>
                  )}
                </PanelCard>

                {chapterAnalytics ? (
                  <PanelCard className="space-y-3">
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Chapter Stats</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-white px-2.5 py-2 dark:bg-gray-800">
                        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {chapterAnalytics.totalViews.toLocaleString()}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">views</div>
                      </div>
                      <div className="rounded-lg bg-white px-2.5 py-2 dark:bg-gray-800">
                        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {chapterAnalytics.uniqueReaders.toLocaleString()}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">readers</div>
                      </div>
                      <div className="rounded-lg bg-white px-2.5 py-2 dark:bg-gray-800">
                        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {chapterAnalytics.completions.toLocaleString()}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">completions</div>
                      </div>
                      <div className="rounded-lg bg-white px-2.5 py-2 dark:bg-gray-800">
                        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {chapterAnalytics.completionRate}%
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">finish rate</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      Avg read time {formatReadTime(chapterAnalytics.avgReadTimeSeconds)}
                    </div>
                  </PanelCard>
                ) : null}
              </>
            ) : entityType === 'container' ? (
              <PanelEmptyState
                title="Folders are not published directly"
                description="Publishing is chapter-based. Open a manuscript chapter to publish it or check its reader URL and stats."
              />
            ) : (
              <PanelEmptyState
                title="Select a chapter"
                description="Choose a manuscript chapter to publish it, unpublish it, or check its reader stats."
              />
            )}
          </>
        )}
      </PanelBody>
    </PanelFrame>
  )
}
