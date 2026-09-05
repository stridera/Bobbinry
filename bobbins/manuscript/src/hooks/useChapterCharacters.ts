import { useEffect, useState } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { isPaletteToken } from '@bobbinry/ui-components'
import type { ChapterColorFields, CharactersById } from '../lib/chapterColors'

/**
 * The project's characters (for the POV colour cascade) and the current
 * chapter's colour fields. Both stay in sync with edits made elsewhere via the
 * `bobbinry:entities-changed` and `bobbinry:chapter-color-changed` events.
 */
export function useChapterCharacters(sdk: BobbinrySDK, projectId: string, entityId: string | undefined, entityType: string | undefined) {
  const [characters, setCharacters] = useState<CharactersById>(() => new Map())
  const [chapterColor, setChapterColor] = useState<ChapterColorFields>({})

  // Load characters once per project for the color cascade. Also re-runs when
  // the entities module reports a change to the characters collection so the
  // POV cascade stays in sync after a color edit.
  useEffect(() => {
    let cancelled = false

    function refresh() {
      sdk.entities.query({ collection: 'characters', limit: 1000 })
        .then(res => {
          if (cancelled) return
          const map: CharactersById = new Map()
          for (const c of (res.data as any[]) ?? []) {
            if (!c?.id) continue
            map.set(c.id, {
              id: c.id,
              name: typeof c.name === 'string' ? c.name : undefined,
              color: isPaletteToken(c.color) ? c.color : null,
            })
          }
          setCharacters(map)
        })
        .catch(() => {
          if (!cancelled) setCharacters(new Map())
        })
    }

    function handleEntitiesChanged(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.collection !== 'characters') return
      refresh()
    }

    refresh()
    window.addEventListener('bobbinry:entities-changed', handleEntitiesChanged)
    return () => {
      cancelled = true
      window.removeEventListener('bobbinry:entities-changed', handleEntitiesChanged)
    }
  }, [projectId, sdk])

  // Pull color fields off the chapter entity when it loads/changes.
  useEffect(() => {
    if (entityType !== 'content' || !entityId) {
      setChapterColor({})
      return
    }
    let cancelled = false
    sdk.entities.get('content', entityId)
      .then((result: any) => {
        if (cancelled) return
        setChapterColor({
          pov_character_id: result?.pov_character_id ?? null,
          featured_character_ids: Array.isArray(result?.featured_character_ids)
            ? result.featured_character_ids
            : [],
          manual_color: result?.manual_color ?? null,
        })
      })
      .catch(() => {
        if (!cancelled) setChapterColor({})
      })
    return () => { cancelled = true }
  }, [entityId, entityType, sdk])

  // Sync stripe when the user changes color/POV from the navigation panel.
  useEffect(() => {
    function handleChapterColorChanged(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.entityId || detail.entityId !== entityId) return
      setChapterColor(prev => ({
        ...prev,
        ...(detail.patch ?? {}),
      }))
    }
    window.addEventListener('bobbinry:chapter-color-changed', handleChapterColorChanged)
    return () => window.removeEventListener('bobbinry:chapter-color-changed', handleChapterColorChanged)
  }, [entityId])

  return { characters, chapterColor, setChapterColor }
}
