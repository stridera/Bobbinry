/**
 * Every API call the public chapter reader makes, in one place.
 *
 * The reader endpoints are optional-auth: anonymous readers get public
 * chapters, signed-in readers get their beta/subscriber perks. So the bearer
 * header is attached only when a token is present. `lib/api.ts#apiFetch`
 * requires a token and refreshes on 401, which is the wrong shape here.
 */
import { config } from '@/lib/config'
import type { Annotation, Comment, PublishedEntityName, ReactionCount } from './types'
import type { TextAnchor } from '@/components/AnnotationSelectionPopover'

export function publicFetch(path: string, token?: string | null, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${config.apiUrl}/api${path}`, { ...init, headers })
}

function json(method: 'POST' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
}

async function jsonOrNull<T>(res: Response): Promise<T | null> {
  return res.ok ? ((await res.json()) as T) : null
}

const withViewAs = (viewAsQuery: string) => (viewAsQuery ? `?${viewAsQuery}` : '')

export const readerApi = {
  /** Resolve `/read/<author>/<slug>` to a project. Caller inspects the Response. */
  resolveProject(authorUsername: string, projectSlug: string, viewAsQuery: string, token?: string) {
    return publicFetch(
      `/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}${withViewAs(viewAsQuery)}`,
      token,
    )
  },

  /** Chapter by slug, old slug or UUID. Caller inspects the Response (403 carries embargo info). */
  fetchChapter(projectId: string, chapterParam: string, viewAsQuery: string, token?: string) {
    return publicFetch(
      `/public/projects/${projectId}/chapters/${encodeURIComponent(chapterParam)}${withViewAs(viewAsQuery)}`,
      token,
    )
  },

  async fetchReactions(chapterId: string): Promise<ReactionCount[] | null> {
    const data = await jsonOrNull<{ reactions?: ReactionCount[] }>(await publicFetch(`/public/chapters/${chapterId}/reactions`))
    return data ? data.reactions ?? [] : null
  },

  async fetchComments(chapterId: string): Promise<Comment[] | null> {
    const data = await jsonOrNull<{ comments?: Comment[] }>(await publicFetch(`/public/chapters/${chapterId}/comments`))
    return data ? data.comments ?? [] : null
  },

  async fetchCanAnnotate(projectId: string, token: string): Promise<boolean | null> {
    const data = await jsonOrNull<{ canAnnotate: boolean }>(await publicFetch(`/public/projects/${projectId}/can-annotate`, token))
    return data ? !!data.canAnnotate : null
  },

  async fetchAnnotations(chapterId: string, token: string): Promise<Annotation[] | null> {
    const data = await jsonOrNull<{ annotations?: Annotation[] }>(await publicFetch(`/public/chapters/${chapterId}/annotations`, token))
    return data ? data.annotations ?? [] : null
  },

  /** Null when the entities bobbin is not installed or the request failed. */
  async fetchPublishedEntityNames(projectId: string, token?: string): Promise<PublishedEntityName[] | null> {
    const data = await jsonOrNull<{ installed?: boolean; entities?: PublishedEntityName[] }>(
      await publicFetch(`/public/projects/${projectId}/entities/published-names`, token),
    )
    return data?.installed && Array.isArray(data.entities) ? data.entities : null
  },

  viewUrl(projectId: string, chapterId: string): string {
    return `${config.apiUrl}/api/public/projects/${projectId}/chapters/${chapterId}/view`
  },

  /** Fire-and-forget view / progress ping. */
  postView(projectId: string, chapterId: string, token: string | undefined, body: Record<string, unknown>): void {
    publicFetch(`/public/projects/${projectId}/chapters/${chapterId}/view`, token, json('POST', body)).catch(() => {})
  },

  /** The endpoint toggles; resolves to what it did, or null on failure. */
  async toggleReaction(chapterId: string, token: string, reactionType: string): Promise<'added' | 'removed' | null> {
    const res = await publicFetch(`/public/chapters/${chapterId}/reactions`, token, json('POST', { reactionType }))
    if (!res.ok) return null
    const data = await res.json().catch(() => ({ action: null }))
    return data.action === 'added' || data.action === 'removed' ? data.action : null
  },

  async postComment(chapterId: string, token: string, content: string, parentId?: string): Promise<boolean> {
    const res = await publicFetch(
      `/public/chapters/${chapterId}/comments`,
      token,
      json('POST', { content, parentId: parentId || undefined }),
    )
    return res.ok
  },

  async postAnnotation(
    chapterId: string,
    token: string,
    payload: {
      projectId: string
      anchor: TextAnchor
      annotationType: string
      errorCategory?: string
      content: string
      suggestedText?: string
    },
  ): Promise<boolean> {
    const res = await publicFetch(`/public/chapters/${chapterId}/annotations`, token, json('POST', {
      projectId: payload.projectId,
      anchorParagraphIndex: payload.anchor.paragraphIndex,
      anchorQuote: payload.anchor.quote,
      anchorCharOffset: payload.anchor.charOffset,
      anchorCharLength: payload.anchor.charLength,
      annotationType: payload.annotationType,
      errorCategory: payload.errorCategory,
      content: payload.content,
      suggestedText: payload.suggestedText,
      chapterVersion: 1, // TODO: track actual entity version
    }))
    return res.ok
  },

  async deleteAnnotation(chapterId: string, token: string, annotationId: string): Promise<void> {
    await publicFetch(`/public/chapters/${chapterId}/annotations/${annotationId}`, token, { method: 'DELETE' })
  },
}
