/**
 * Chapter color resolution.
 *
 * A chapter's effective color comes from one of two sources, in order:
 *   1. its own manual_color (used for interludes / no-POV chapters)
 *   2. the color of its linked POV character
 *
 * If neither is set, the chapter renders without a stripe.
 */

import { isPaletteToken, type PaletteToken } from '@bobbinry/ui-components'

export interface ChapterColorFields {
  pov_character_id?: string | null
  featured_character_ids?: string[]
  manual_color?: string | null
}

export interface CharacterColorRef {
  id: string
  name?: string
  color?: PaletteToken | null
}

export type CharactersById = Map<string, CharacterColorRef>

/**
 * Effective palette token for a chapter, or `null` if no color resolves.
 */
export function resolveChapterColor(
  chapter: ChapterColorFields | null | undefined,
  charactersById: CharactersById,
): PaletteToken | null {
  if (!chapter) return null

  if (isPaletteToken(chapter.manual_color)) {
    return chapter.manual_color
  }

  const povId = chapter.pov_character_id
  if (povId) {
    const character = charactersById.get(povId)
    if (character && isPaletteToken(character.color)) {
      return character.color
    }
  }

  return null
}

/**
 * Resolve featured characters to a stable, deduped list of refs.
 * Missing ids (character deleted) are dropped silently.
 */
export function resolveFeaturedCharacters(
  chapter: ChapterColorFields | null | undefined,
  charactersById: CharactersById,
): CharacterColorRef[] {
  const ids = chapter?.featured_character_ids
  if (!ids || ids.length === 0) return []

  const seen = new Set<string>()
  const out: CharacterColorRef[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const ref = charactersById.get(id)
    if (ref) out.push(ref)
  }
  return out
}

/**
 * Take the first grapheme of a name for chip initials, uppercased.
 * Falls back to "?" for missing names.
 */
export function characterInitial(name: string | undefined): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.charAt(0).toUpperCase()
}
