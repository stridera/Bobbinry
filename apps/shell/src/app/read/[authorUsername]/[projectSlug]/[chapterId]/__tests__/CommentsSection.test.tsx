import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CommentsSection } from '../CommentsSection'
import { readerThemeClasses } from '../reader-theme'
import type { Comment } from '../types'

const theme = readerThemeClasses('light')

function comment(id: string, content: string, replies: Comment[] = []): Comment {
  return { id, content, parentId: null, authorId: 'u', authorName: `Author ${id}`, likeCount: 0, createdAt: '2026-09-01T00:00:00Z', replies }
}

describe('CommentsSection', () => {
  it('renders nested replies and hides the reply control when signed out', () => {
    render(
      <CommentsSection
        theme={theme}
        signedIn={false}
        comments={[comment('a', 'top level', [comment('b', 'a reply')])]}
        onPost={jest.fn()}
      />
    )
    expect(screen.getByText('Comments (1)')).toBeInTheDocument()
    expect(screen.getByText('top level')).toBeInTheDocument()
    expect(screen.getByText('a reply')).toBeInTheDocument()
    expect(screen.queryByText('Reply')).toBeNull()
    expect(screen.getByText('Sign in')).toBeInTheDocument()
  })

  it('posts a top-level comment and clears the box on success', async () => {
    const onPost = jest.fn().mockResolvedValue(true)
    render(<CommentsSection theme={theme} signedIn comments={[]} onPost={onPost} />)

    const box = screen.getByPlaceholderText('Share your thoughts...')
    fireEvent.change(box, { target: { value: '  hello  ' } })
    fireEvent.click(screen.getByText('Comment'))

    expect(onPost).toHaveBeenCalledWith('hello', undefined)
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''))
  })

  it('opens one reply box at a time and passes the parent id', async () => {
    const onPost = jest.fn().mockResolvedValue(true)
    render(<CommentsSection theme={theme} signedIn comments={[comment('a', 'first'), comment('b', 'second')]} onPost={onPost} />)

    fireEvent.click(screen.getAllByText('Reply')[0])
    const replyBox = screen.getByPlaceholderText('Write a reply...')
    fireEvent.change(replyBox, { target: { value: 'me too' } })
    // After opening, comment a's toggle reads Cancel, so the first remaining
    // "Reply" button in DOM order is the submit inside its reply box.
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]!)

    expect(onPost).toHaveBeenCalledWith('me too', 'a')
    await waitFor(() => expect(screen.queryByPlaceholderText('Write a reply...')).toBeNull())
  })

  it('keeps the draft when the server rejects the post', async () => {
    const onPost = jest.fn().mockResolvedValue(false)
    render(<CommentsSection theme={theme} signedIn comments={[]} onPost={onPost} />)
    const box = screen.getByPlaceholderText('Share your thoughts...')
    fireEvent.change(box, { target: { value: 'keep me' } })
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() => expect(onPost).toHaveBeenCalled())
    expect((box as HTMLTextAreaElement).value).toBe('keep me')
  })
})
