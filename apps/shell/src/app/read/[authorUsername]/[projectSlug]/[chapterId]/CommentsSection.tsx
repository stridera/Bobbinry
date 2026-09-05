import { useState } from 'react'
import Link from 'next/link'
import type { ReaderThemeClasses } from './reader-theme'
import { MAX_REPLY_DEPTH, type Comment } from './types'

interface CommentsSectionProps {
  theme: ReaderThemeClasses
  comments: Comment[]
  signedIn: boolean
  /** Resolves true when the server accepted the comment; the box clears on success. */
  onPost: (content: string, parentId?: string) => Promise<boolean>
}

/** Threaded comments. Owns the draft and reply-box state so the page does not have to. */
export function CommentsSection({ theme, comments, signedIn, onPost }: CommentsSectionProps) {
  const { borderColor, mutedText, linkColor } = theme
  const [newComment, setNewComment] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')

  const post = async (parentId?: string) => {
    const content = (parentId ? replyContent : newComment).trim()
    if (!content) return
    const ok = await onPost(content, parentId)
    if (!ok) return
    if (parentId) {
      setReplyContent('')
      setReplyingTo(null)
    } else {
      setNewComment('')
    }
  }

  return (
    <div className={`mt-12 pt-6 border-t ${borderColor}`}>
      <h2 className="font-display text-lg font-semibold mb-4">Comments ({comments.length})</h2>

      {signedIn ? (
        <div className="mb-6">
          <textarea
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder="Share your thoughts..."
            rows={3}
            className={`w-full px-3 py-2 border ${borderColor} bg-transparent rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={() => post()}
              disabled={!newComment.trim()}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>
      ) : (
        <p className={`text-sm ${mutedText} mb-6`}>
          <Link href="/login" className={`${linkColor} hover:underline`}>Sign in</Link> to comment.
        </p>
      )}

      <div className="space-y-4">
        {comments.map(comment => (
          <CommentThread
            key={comment.id}
            comment={comment}
            depth={0}
            theme={theme}
            isLoggedIn={signedIn}
            replyingTo={replyingTo}
            replyContent={replyContent}
            onSetReplyingTo={setReplyingTo}
            onSetReplyContent={setReplyContent}
            onPostReply={post}
          />
        ))}
      </div>
    </div>
  )
}

interface CommentThreadProps {
  comment: Comment
  depth: number
  theme: ReaderThemeClasses
  isLoggedIn: boolean
  replyingTo: string | null
  replyContent: string
  onSetReplyingTo: (id: string | null) => void
  onSetReplyContent: (s: string) => void
  onPostReply: (parentId?: string) => void
}

export function CommentThread({
  comment,
  depth,
  theme,
  isLoggedIn,
  replyingTo,
  replyContent,
  onSetReplyingTo,
  onSetReplyContent,
  onPostReply
}: CommentThreadProps) {
  const { mutedText, borderColor, contentColor } = theme
  const isReplying = replyingTo === comment.id

  return (
    <div className={depth > 0 ? `ml-6 pl-4 border-l-2 ${borderColor}` : ''}>
      <div className="text-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium">{comment.authorName || 'Anonymous'}</span>
          <span className={`${mutedText} text-xs`}>
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
        </div>
        <p className={`${contentColor} whitespace-pre-line`}>{comment.content}</p>
        {isLoggedIn && depth < MAX_REPLY_DEPTH && (
          <button
            onClick={() => onSetReplyingTo(isReplying ? null : comment.id)}
            className={`${mutedText} text-xs mt-1 hover:underline`}
          >
            {isReplying ? 'Cancel' : 'Reply'}
          </button>
        )}
        {isReplying && (
          <div className="mt-2 mb-2">
            <textarea
              value={replyContent}
              onChange={e => onSetReplyContent(e.target.value)}
              placeholder="Write a reply..."
              rows={2}
              className={`w-full px-3 py-2 border ${borderColor} bg-transparent rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
            />
            <div className="flex justify-end mt-1 gap-2">
              <button
                onClick={() => onSetReplyingTo(null)}
                className={`px-3 py-1 text-xs ${mutedText} hover:underline`}
              >
                Cancel
              </button>
              <button
                onClick={() => onPostReply(comment.id)}
                disabled={!replyContent.trim()}
                className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Reply
              </button>
            </div>
          </div>
        )}
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map(reply => (
            <CommentThread
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              theme={theme}
              isLoggedIn={isLoggedIn}
              replyingTo={replyingTo}
              replyContent={replyContent}
              onSetReplyingTo={onSetReplyingTo}
              onSetReplyContent={onSetReplyContent}
              onPostReply={onPostReply}
            />
          ))}
        </div>
      )}
    </div>
  )
}
