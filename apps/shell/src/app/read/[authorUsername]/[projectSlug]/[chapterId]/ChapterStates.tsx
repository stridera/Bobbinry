import Link from 'next/link'
import { ReaderNav } from '@/components/ReaderNav'

interface CrumbInfo {
  authorUsername: string
  projectSlug: string
  basePath: string
  authorDisplayName?: string
  projectName?: string
}

export function ChapterLoadingState({ authorUsername, projectSlug, basePath }: CrumbInfo) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={[
        { label: authorUsername, href: `/read/${authorUsername}` },
        { label: projectSlug, href: basePath }
      ]} />
      <div className="flex items-center justify-center py-32">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    </div>
  )
}

export function ChapterErrorState({
  error,
  embargoUntil,
  authorUsername,
  projectSlug,
  authorDisplayName,
  projectName,
  basePath,
}: CrumbInfo & { error: string; embargoUntil: string | null }) {
  const isTierLocked = error === 'Chapter not yet available for your tier'
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={[
        { label: authorDisplayName || authorUsername, href: `/read/${authorUsername}` },
        { label: projectName || projectSlug, href: basePath }
      ]} />
      <div className="flex items-center justify-center py-32">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {isTierLocked ? 'Chapter not available at your tier' : error}
          </h1>
          {isTierLocked ? (
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Subscribe or upgrade now to read instantly.
            </p>
          ) : null}
          {embargoUntil && (
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Available on {new Date(embargoUntil).toLocaleDateString()}
            </p>
          )}
          <div className="flex items-center justify-center gap-4">
            {isTierLocked ? (
              <Link href={`${basePath}#support`} className="text-blue-600 dark:text-blue-400 hover:underline">
                Subscribe or Upgrade
              </Link>
            ) : null}
            <Link href={basePath} className="text-blue-600 dark:text-blue-400 hover:underline">
              Back to Table of Contents
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
