'use client'

import { useCallback, useMemo, useRef, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { getSanitizedHtmlProps } from '@bobbinry/sdk'
import { displaySettingsToClass } from '@bobbinry/types'
import { EntityHoverCard } from '@bobbinry/ui-components'
import { ReaderNav } from '@/components/ReaderNav'
import { ExtensionSlot } from '@/components/ExtensionSlot'
import { useReaderBobbins } from '@/hooks/useReaderBobbins'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { AnnotationSelectionPopover } from '@/components/AnnotationSelectionPopover'
import { AnnotationForm } from '@/components/AnnotationForm'
import EntityModal from '../EntityModal'
import EntitySidebar from '../EntitySidebar'
import { useEntityStack } from '../useEntityStack'
import { FONT_SIZES, READER_CONTENT_ID, WIDTHS } from './types'
import { readerThemeClasses } from './reader-theme'
import { useReaderPrefs } from './useReaderPrefs'
import { useChapterLoader } from './useChapterLoader'
import { useChapterInteractions } from './useChapterInteractions'
import { useAnnotations } from './useAnnotations'
import { useEntityHighlights } from './useEntityHighlights'
import { useReadingProgress } from './useReadingProgress'
import { ChapterErrorState, ChapterLoadingState } from './ChapterStates'
import { EntityHighlightStyles } from './EntityHighlightStyles'
import { ReaderToolbar } from './ReaderToolbar'
import { ReaderSettingsPanel } from './ReaderSettingsPanel'
import { ReactionsBar } from './ReactionsBar'
import { CommentsSection } from './CommentsSection'
import { AnnotationSidebar } from './AnnotationSidebar'

export default function ChapterReaderPage() {
  return (
    <Suspense>
      <ChapterReaderContent />
    </Suspense>
  )
}

function ChapterReaderContent() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, status: sessionStatus } = useSession()
  const sessionUserId = session?.user?.id
  // Depend on the token string, not the session object: NextAuth re-creates
  // the object on every focus refetch.
  const apiToken = session?.apiToken
  const signedIn = !!session?.user

  // Reader bobbins (read-aloud, etc.) register into the reader.* slots.
  useReaderBobbins({ userId: sessionUserId, apiToken, sessionStatus })

  const authorUsername = params.authorUsername as string
  const projectSlug = params.projectSlug as string
  const chapterParam = params.chapterId as string
  const viewAs = searchParams.get('viewAs') || ''
  const viewAsQuery = viewAs ? `viewAs=${encodeURIComponent(viewAs)}` : ''
  const basePath = `/read/${authorUsername}/${projectSlug}`
  const withViewAs = (href: string) => `${href}${viewAsQuery ? `?${viewAsQuery}` : ''}`

  const { prefs, setPref } = useReaderPrefs()
  const theme = readerThemeClasses(prefs.readerTheme)
  const [showSettings, setShowSettings] = useState(false)
  const [showAnnotationSidebar, setShowAnnotationSidebar] = useState(false)

  const {
    chapter, chapterId, nav, displaySettings, projectId, projectName, authorDisplayName, loading, error, embargoUntil,
  } = useChapterLoader({ authorUsername, projectSlug, chapterParam, viewAsQuery, basePath, apiToken, sessionStatus, sessionUserId })

  const { reactions, comments, toggleReaction, postComment } = useChapterInteractions({ chapterId, projectId, apiToken })

  // The column (progress is measured against it) and the prose inside it
  // (highlight passes run against it).
  const contentRef = useRef<HTMLDivElement>(null)
  const proseRef = useRef<HTMLDivElement>(null)

  const { annotations, canAnnotate, pendingAnchor, setPendingAnchor, submitAnnotation, deleteAnnotation } =
    useAnnotations({ chapterId, projectId, apiToken, proseRef, readerTheme: prefs.readerTheme })

  const isDesktop = useIsDesktop()
  const showEntitySidebar = prefs.entityInfoDisplay === 'sidebar' && isDesktop
  // Hover has no touch equivalent, and a reader who turned highlights off has
  // asked not to be shown entities at all.
  const enableEntityPeek = prefs.entityPeekOnHover && isDesktop && prefs.entityHighlightStyle !== 'off'

  // Published-entity click-to-open state. The stack lets relation pills inside
  // the open entity navigate in place (no reload).
  const entityStack = useEntityStack({ projectId: projectId ?? '', apiToken })
  const { navigate: navigateEntity } = entityStack
  const { publishedEntityNames } = useEntityHighlights({
    proseRef, projectId, apiToken, style: prefs.entityHighlightStyle, enablePeek: enableEntityPeek,
    annotations, chapter, loading, entityStack,
  })

  const { progress, isBookmarked, saveBookmark, removeBookmark, restoreBookmark } = useReadingProgress({
    contentRef, chapterId, projectId, userId: sessionUserId, apiToken, active: !loading && !!chapter,
  })

  // Context handed to reader.* extension slots. Memoized so bobbin panels only
  // re-render when something they can see changes.
  const nextChapterHref = nav.next ? withViewAs(`${basePath}/${nav.next.slug ?? nav.next.id}`) : null
  const navigateTo = useCallback((href: string) => { router.push(href) }, [router])
  const slotContext = useMemo(() => ({
    chapterId,
    projectId,
    readerTheme: prefs.readerTheme,
    chapterTitle: chapter?.title ?? null,
    contentElementId: READER_CONTENT_ID,
    nextChapterHref,
    navigate: navigateTo,
  }), [chapterId, projectId, prefs.readerTheme, chapter?.title, nextChapterHref, navigateTo])

  if (loading) {
    return <ChapterLoadingState authorUsername={authorUsername} projectSlug={projectSlug} basePath={basePath} />
  }
  if (error) {
    return (
      <ChapterErrorState
        error={error}
        embargoUntil={embargoUntil}
        authorUsername={authorUsername}
        projectSlug={projectSlug}
        authorDisplayName={authorDisplayName}
        projectName={projectName}
        basePath={basePath}
      />
    )
  }
  if (!chapter) return null

  const entityHrefBase = `${basePath}/entity`
  const onSubscribeNudge = () => router.push(`${basePath}?tab=support`)

  return (
    <div className={`min-h-screen ${theme.wrapper}`}>
      {/* Progress bar */}
      <div className={`fixed top-0 left-0 right-0 h-0.5 ${theme.progressTrack} z-50`}>
        <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <ReaderNav
        crumbs={[
          { label: authorDisplayName || authorUsername, href: `/read/${authorUsername}` },
          { label: projectName || projectSlug, href: basePath },
          { label: chapter.title || 'Chapter' }
        ]}
        themed={theme.navTheme}
      />

      <div className={`border-b ${theme.borderColor} bg-inherit`}>
        <ReaderToolbar
          theme={theme}
          width={prefs.readerWidth}
          slotContext={slotContext}
          isBookmarked={isBookmarked}
          onSaveBookmark={saveBookmark}
          onRemoveBookmark={removeBookmark}
          onRestoreBookmark={restoreBookmark}
          canAnnotate={canAnnotate}
          annotationCount={annotations.length}
          showAnnotationSidebar={showAnnotationSidebar}
          onToggleAnnotationSidebar={() => setShowAnnotationSidebar(v => !v)}
          onToggleSettings={() => setShowSettings(v => !v)}
        />
        {showSettings && (
          <ReaderSettingsPanel theme={theme} prefs={prefs} onChange={setPref} hasEntities={publishedEntityNames.length > 0} />
        )}
      </div>

      <EntityHighlightStyles />

      {/* Chapter content + annotation sidebar layout */}
      <div className="flex justify-center">
        <div ref={contentRef} className={`${WIDTHS[prefs.readerWidth]} flex-1 min-w-0 px-4 py-8`}>
          <h1 className="font-display text-3xl font-bold mb-6">{chapter.title}</h1>

          <div
            id={READER_CONTENT_ID}
            ref={proseRef}
            className={`${FONT_SIZES[prefs.fontSize]} prose ${theme.proseClass} max-w-none ${displaySettingsToClass(displaySettings)}`}
            dangerouslySetInnerHTML={getSanitizedHtmlProps(chapter.content)}
          />

          {canAnnotate && (
            <AnnotationSelectionPopover
              contentRef={contentRef}
              onAnnotate={setPendingAnchor}
              isDark={theme.isDark}
              isSepia={theme.isSepia}
            />
          )}
          {pendingAnchor && (
            <AnnotationForm
              anchor={pendingAnchor}
              onSubmit={submitAnnotation}
              onClose={() => setPendingAnchor(null)}
              isDark={theme.isDark}
              isSepia={theme.isSepia}
            />
          )}

          <ReactionsBar theme={theme} reactions={reactions} signedIn={signedIn} onToggle={toggleReaction} />

          {/* Reader bobbin after-chapter panels */}
          <ExtensionSlot
            slotId="reader.afterChapter"
            context={slotContext}
            className={`mt-8 pt-6 border-t ${theme.borderColor} space-y-4`}
            fallback={null}
          />

          <div className="mt-8 flex justify-between">
            {nav.previous ? (
              <Link href={withViewAs(`${basePath}/${nav.previous.slug ?? nav.previous.id}`)} className={`text-sm ${theme.linkColor} hover:underline`}>
                &larr; Previous Chapter
              </Link>
            ) : <div />}
            {nav.next ? (
              <Link href={withViewAs(`${basePath}/${nav.next.slug ?? nav.next.id}`)} className={`text-sm ${theme.linkColor} hover:underline`}>
                Next Chapter &rarr;
              </Link>
            ) : <div />}
          </div>

          <CommentsSection theme={theme} comments={comments} signedIn={signedIn} onPost={postComment} />
        </div>

        {canAnnotate && showAnnotationSidebar && (
          <AnnotationSidebar theme={theme} annotations={annotations} onDelete={deleteAnnotation} />
        )}

        {/* Entity sidebar — docked beside the text so reading can continue */}
        {entityStack.current && projectId && showEntitySidebar && (
          <EntitySidebar
            entry={entityStack.current}
            projectId={projectId}
            apiToken={apiToken}
            entityHrefBase={entityHrefBase}
            onNavigateEntity={id => { void navigateEntity(id) }}
            onBack={entityStack.canGoBack ? entityStack.back : undefined}
            onSubscribeNudge={onSubscribeNudge}
            onClose={entityStack.close}
          />
        )}
      </div>

      {enableEntityPeek && <EntityHoverCard />}

      {entityStack.current && projectId && !showEntitySidebar && (
        <EntityModal
          entry={entityStack.current}
          projectId={projectId}
          apiToken={apiToken}
          entityHrefBase={entityHrefBase}
          onNavigateEntity={id => { void navigateEntity(id) }}
          onBack={entityStack.canGoBack ? entityStack.back : undefined}
          onSubscribeNudge={onSubscribeNudge}
          onClose={entityStack.close}
        />
      )}
      {entityStack.fetching && !entityStack.current && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-start justify-center p-8">
          <div className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
            Loading entity…
          </div>
        </div>
      )}
    </div>
  )
}
