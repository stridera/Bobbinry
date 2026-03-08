'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const CAT_API_URL = 'https://api.thecatapi.com/v1/images/search'
const WORDS_PER_CAT = 1000
const MEOW_COOLDOWN_MS = 3000
const MEOW_COUNT = 5

// Paths relative to the public directory
const MEOW_SOUNDS = Array.from({ length: MEOW_COUNT }, (_, i) => `/sounds/meow-${i + 1}.wav`)

interface CatImage {
  url: string
  id: string
}

export default function CatPanel() {
  const [catImage, setCatImage] = useState<CatImage | null>(null)
  const [milestone, setMilestone] = useState(0)
  const [bonusCats, setBonusCats] = useState(0)
  const [lastCatSource, setLastCatSource] = useState<'milestone' | 'bonus'>('milestone')
  const [loading, setLoading] = useState(false)
  const [fadeIn, setFadeIn] = useState(false)
  const lastMilestoneRef = useRef(0)
  const lastMeowTimeRef = useRef(0)
  const recentTextRef = useRef('')

  const fetchCatImage = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(CAT_API_URL)
      if (!res.ok) throw new Error('Failed to fetch cat')
      const data = await res.json()
      if (data?.[0]) {
        setFadeIn(false)
        // Small delay to reset animation
        requestAnimationFrame(() => {
          setCatImage({ url: data[0].url, id: data[0].id })
          setFadeIn(true)
        })
      }
    } catch (err) {
      console.warn('Cat API error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const playMeow = useCallback(() => {
    const now = Date.now()
    if (now - lastMeowTimeRef.current < MEOW_COOLDOWN_MS) return
    lastMeowTimeRef.current = now

    const index = Math.floor(Math.random() * MEOW_COUNT)
    const audio = new Audio(MEOW_SOUNDS[index])
    audio.volume = 0.3
    audio.play().catch(() => {
      // Autoplay blocked — silently ignore
    })
  }, [])

  // Track word count milestones via view-context-change events
  useEffect(() => {
    const handleContextChange = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, any>>).detail
      if (typeof detail?.wordCount !== 'number') return

      const currentMilestone = Math.floor(detail.wordCount / WORDS_PER_CAT)
      if (currentMilestone > lastMilestoneRef.current && currentMilestone > 0) {
        lastMilestoneRef.current = currentMilestone
        setMilestone(currentMilestone)
        setLastCatSource('milestone')
        fetchCatImage()
      } else if (lastMilestoneRef.current === 0 && currentMilestone === 0) {
        // Initialize — no cat yet
        lastMilestoneRef.current = 0
      }
    }

    window.addEventListener('bobbinry:view-context-change', handleContextChange)
    return () => window.removeEventListener('bobbinry:view-context-change', handleContextChange)
  }, [fetchCatImage])

  // Listen for editor content updates to detect "cat" or "meow" typed
  useEffect(() => {
    const handleContentUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail
      if (!detail?.text) return

      const text = detail.text.toLowerCase()
      const prev = recentTextRef.current
      recentTextRef.current = text

      // Only check newly added text at the end
      if (text.length <= prev.length) return

      // Check if the tail of the full text ends with our triggers
      const tail = text.slice(-10)
      if (
        (tail.endsWith('cat') || tail.endsWith('meow')) &&
        !(prev.slice(-10).endsWith('cat') && tail.endsWith('cat')) &&
        !(prev.slice(-10).endsWith('meow') && tail.endsWith('meow'))
      ) {
        playMeow()
        setBonusCats(b => b + 1)
        setLastCatSource('bonus')
        fetchCatImage()
      }
    }

    window.addEventListener('bobbinry:editor-content-update', handleContentUpdate)
    return () => window.removeEventListener('bobbinry:editor-content-update', handleContentUpdate)
  }, [playMeow, fetchCatImage])

  return (
    <div className="flex flex-col items-center gap-3 p-3 h-full">
      {catImage ? (
        <div className="w-full flex flex-col items-center gap-2">
          <div
            className={`w-full rounded-lg overflow-hidden transition-opacity duration-500 ${
              fadeIn ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <img
              src={catImage.url}
              alt="Your reward cat"
              className="w-full h-auto object-cover rounded-lg"
              loading="lazy"
            />
          </div>
          <p className="text-sm text-center text-gray-700 dark:text-gray-300">
            {lastCatSource === 'bonus'
              ? 'Bonus cat!'
              : `${(milestone * WORDS_PER_CAT).toLocaleString()} words! Here\u2019s your cat!`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="text-4xl">🐱</span>
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Fetching a cat...
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Write {WORDS_PER_CAT.toLocaleString()} words to unlock your first cat!
            </p>
          )}
        </div>
      )}

      {(milestone > 0 || bonusCats > 0) && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-auto">
          {milestone + bonusCats} {milestone + bonusCats === 1 ? 'cat' : 'cats'} earned
          {bonusCats > 0 && ` (${bonusCats} bonus)`}
        </p>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center italic">
        Type &quot;cat&quot; or &quot;meow&quot; for a bonus cat
      </p>
    </div>
  )
}
