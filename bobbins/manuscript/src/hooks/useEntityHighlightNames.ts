import { useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import type { EntityEntry } from '../extensions/entity-highlight'

/**
 * Loads every published entity name (and alias) in the project into the
 * EntityHighlight extension's storage so the prose decorates them. Reloads
 * when another view reports an entity change; ignores the editor's own title
 * broadcasts, which never affect entity names.
 */
export function useEntityHighlightNames(editor: Editor | null, sdk: BobbinrySDK, projectId: string) {
  useEffect(() => {
    if (!editor || !projectId) return

    async function loadEntityNames() {
      try {
        const typeDefsRes = await sdk.entities.query({
          collection: 'entity_type_definitions',
          limit: 100,
        })
        const typeDefs = (typeDefsRes.data as any[]) || []

        const entityResults = await Promise.all(
          typeDefs.map(async (td) => {
            const typeId = (td.typeId || td.type_id) as string
            const typeIcon = (td.icon || '') as string
            const typeLabel = (td.label || typeId) as string
            try {
              const entitiesRes = await sdk.entities.query({
                collection: typeId,
                limit: 500,
              })
              return ((entitiesRes.data as any[]) || [])
                .filter((entity: any) => entity.name)
                .flatMap((entity: any) => {
                  const base = {
                    id: entity.id,
                    typeId,
                    typeIcon,
                    typeLabel,
                    // Only used by the hover card. Already on the record we
                    // fetched, so carrying it costs nothing extra.
                    ...(typeof entity.description === 'string'
                      ? { description: entity.description }
                      : {}),
                    ...(typeof entity.image_url === 'string'
                      ? { imageUrl: entity.image_url }
                      : {}),
                  }
                  const out: EntityEntry[] = [{ ...base, name: entity.name }]
                  if (Array.isArray(entity.aliases)) {
                    for (const alias of entity.aliases) {
                      if (typeof alias === 'string' && alias.trim()) {
                        out.push({ ...base, name: alias.trim() })
                      }
                    }
                  }
                  return out
                })
            } catch {
              return [] // Skip types that fail to query
            }
          })
        )
        const entries: EntityEntry[] = entityResults.flat()

        // Update extension storage and trigger decoration rebuild
        if (!editor || editor.isDestroyed) return
        ;(editor.storage as any).entityHighlight.entityList = entries
        editor.view.dispatch(
          editor.state.tr.setMeta('entityListUpdated', true)
        )
      } catch (err) {
        console.error('[EditorView] Failed to load entity names:', err)
      }
    }

    loadEntityNames()

    function handleEntityUpdated(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.source === 'editor') return
      loadEntityNames()
    }
    window.addEventListener('bobbinry:entity-updated', handleEntityUpdated)
    return () => window.removeEventListener('bobbinry:entity-updated', handleEntityUpdated)
  }, [editor, projectId, sdk])
}
