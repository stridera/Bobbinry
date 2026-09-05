import { useCallback, useEffect, useState } from 'react'
import { trackEvent } from '@bobbinry/sdk'
import { readerApi } from './reader-api'
import type { Comment, ReactionCount } from './types'

interface UseChapterInteractionsArgs {
  chapterId: string | null
  projectId: string | null
  apiToken: string | undefined
}

/** Reactions and threaded comments for the loaded chapter. */
export function useChapterInteractions({ chapterId, projectId, apiToken }: UseChapterInteractionsArgs) {
  const [reactions, setReactions] = useState<ReactionCount[]>([])
  const [comments, setComments] = useState<Comment[]>([])

  useEffect(() => {
    if (!chapterId) return
    let cancelled = false
    Promise.all([readerApi.fetchReactions(chapterId), readerApi.fetchComments(chapterId)])
      .then(([r, c]) => {
        if (cancelled) return
        if (r) setReactions(r)
        if (c) setComments(c)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [chapterId])

  const toggleReaction = useCallback(async (reactionType: string) => {
    if (!apiToken || !chapterId) return
    try {
      const action = await readerApi.toggleReaction(chapterId, apiToken, reactionType)
      // The endpoint toggles, so only count the adds — otherwise removing a
      // reaction would register as engagement.
      if (action === 'added') {
        trackEvent('reaction_added', { projectId, chapterId, reactionType })
      }
      const fresh = await readerApi.fetchReactions(chapterId)
      if (fresh) setReactions(fresh)
    } catch {}
  }, [apiToken, chapterId, projectId])

  const postComment = useCallback(async (content: string, parentId?: string): Promise<boolean> => {
    if (!apiToken || !chapterId || !content.trim()) return false
    try {
      const ok = await readerApi.postComment(chapterId, apiToken, content.trim(), parentId)
      if (!ok) return false
      trackEvent('comment_posted', { projectId, chapterId, isReply: !!parentId })
      const fresh = await readerApi.fetchComments(chapterId)
      if (fresh) setComments(fresh)
      return true
    } catch {
      return false
    }
  }, [apiToken, chapterId, projectId])

  return { reactions, comments, toggleReaction, postComment }
}
