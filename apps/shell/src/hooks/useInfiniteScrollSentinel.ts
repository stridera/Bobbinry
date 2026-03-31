'use client'

import { useCallback, useEffect, useRef } from 'react'

interface UseInfiniteScrollSentinelOptions {
  enabled: boolean
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
  rootMargin?: string
}

export function useInfiniteScrollSentinel({
  enabled,
  hasMore,
  loading,
  onLoadMore,
  rootMargin = '200px',
}: UseInfiniteScrollSentinelOptions) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const stateRef = useRef({ hasMore, loading, onLoadMore })

  useEffect(() => {
    stateRef.current = { hasMore, loading, onLoadMore }
  }, [hasMore, loading, onLoadMore])

  useEffect(() => {
    return () => observerRef.current?.disconnect()
  }, [])

  return useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null

    if (!enabled || !node || typeof IntersectionObserver === 'undefined') {
      return
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && stateRef.current.hasMore && !stateRef.current.loading) {
          stateRef.current.onLoadMore()
        }
      },
      { rootMargin }
    )

    observerRef.current.observe(node)
  }, [enabled, rootMargin])
}
