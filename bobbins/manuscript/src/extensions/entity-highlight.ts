/**
 * Entity Highlight Extension for TipTap
 *
 * Uses ProseMirror Decorations (not Marks) to overlay dotted underlines
 * on entity names found in the document text. Decorations are ephemeral —
 * they don't modify the stored HTML.
 *
 * Click handling dispatches a `bobbinry:entity-preview` custom event
 * so the entities right panel can show a preview.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface EntityEntry {
  id: string
  name: string
  typeId: string
  typeIcon: string
  typeLabel: string
}

const entityHighlightPluginKey = new PluginKey('entityHighlight')

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildEntityRegex(entities: EntityEntry[]): RegExp | null {
  if (entities.length === 0) return null

  // Sort by name length descending so longer names match first
  const sorted = [...entities].sort((a, b) => b.name.length - a.name.length)

  // Deduplicate names (case-insensitive)
  const seen = new Set<string>()
  const patterns: string[] = []
  for (const e of sorted) {
    const key = e.name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      patterns.push(escapeRegExp(e.name))
    }
  }

  if (patterns.length === 0) return null
  return new RegExp(`\\b(${patterns.join('|')})\\b`, 'gi')
}

// Cache compiled regex and name map — only rebuild when entity list changes
let cachedEntities: EntityEntry[] = []
let cachedRegex: RegExp | null = null
let cachedNameMap: Map<string, EntityEntry[]> = new Map()

function getEntityMatcher(entities: EntityEntry[]): { regex: RegExp | null; nameMap: Map<string, EntityEntry[]> } {
  if (entities === cachedEntities) {
    return { regex: cachedRegex, nameMap: cachedNameMap }
  }

  cachedEntities = entities
  cachedRegex = buildEntityRegex(entities)
  cachedNameMap = new Map()
  for (const e of entities) {
    const key = e.name.toLowerCase()
    const list = cachedNameMap.get(key) || []
    list.push(e)
    cachedNameMap.set(key, list)
  }

  return { regex: cachedRegex, nameMap: cachedNameMap }
}

function buildDecorations(doc: ProseMirrorNode, entities: EntityEntry[]): DecorationSet {
  const { regex, nameMap } = getEntityMatcher(entities)
  if (!regex) return DecorationSet.empty

  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return

    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(node.text)) !== null) {
      const from = pos + match.index
      const to = from + match[0].length
      const matchedName = match[0].toLowerCase()
      const entries = nameMap.get(matchedName)
      if (!entries) continue

      const entityIds = entries.map(e => e.id).join(',')
      const firstEntry = entries[0]!

      decorations.push(
        Decoration.inline(from, to, {
          class: 'entity-highlight',
          'data-entity-id': entityIds,
          'data-entity-type': firstEntry.typeId,
          'data-entity-name': match[0],
        })
      )
    }
  })

  return DecorationSet.create(doc, decorations)
}

export const EntityHighlight = Extension.create({
  name: 'entityHighlight',

  addStorage() {
    return {
      entityList: [] as EntityEntry[],
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: entityHighlightPluginKey,

        state: {
          init(_, { doc }) {
            return buildDecorations(doc, extension.storage.entityList)
          },
          apply(tr, oldDecoSet) {
            if (tr.getMeta('entityListUpdated') || tr.docChanged) {
              return buildDecorations(tr.doc, extension.storage.entityList)
            }
            return oldDecoSet
          },
        },

        props: {
          decorations(state) {
            return entityHighlightPluginKey.getState(state) as DecorationSet
          },

          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement
            if (!target.classList.contains('entity-highlight')) return false

            const entityId = target.dataset.entityId
            const entityType = target.dataset.entityType
            const entityName = target.dataset.entityName
            if (!entityId || !entityType || !entityName) return false

            window.dispatchEvent(
              new CustomEvent('bobbinry:entity-preview', {
                detail: { entityId, entityType, entityName },
              })
            )
            return true
          },
        },
      }),
    ]
  },
})
