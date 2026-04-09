/**
 * Seed official entity type templates into the shared_templates collection.
 *
 * Runs on startup. Inserts new templates and updates existing ones
 * when the code version is higher than the DB version.
 *
 * Template definitions are maintained as a minimal registry here (shareId + version).
 * The full template content is fetched from the entities bobbin's built dist
 * at runtime via dynamic import, but since that crosses rootDir boundaries,
 * we use the SDK's entity API pattern instead: the shell seeds via a startup
 * API call. For now, we inline the official template metadata and let the
 * config UI handle the full content from the hardcoded templates.
 *
 * UPDATE: Since we can't import across rootDir, the seed script reads the
 * template data from a JSON file generated at build time.
 */

import { db } from '../db/connection'
import { entities } from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'

const COLLECTION = 'shared_templates'
const BOBBIN_ID = 'entities'
const SCOPE = 'global'

// Official template registry — maps shareId to version.
// The full template content is written by the config UI when it creates types.
// This seed only ensures the DB entries exist and are versioned.
const OFFICIAL_TEMPLATES: Array<{
  shareId: string
  version: number
  label: string
  icon: string
  description: string
  tags: string[]
}> = [
  { shareId: 'official-characters', version: 2, label: 'Characters', icon: '🧙', description: 'People, creatures, or NPCs in your world', tags: ['rpg', 'worldbuilding', 'characters'] },
  { shareId: 'official-spells', version: 1, label: 'Spells', icon: '✨', description: 'Magical abilities and incantations', tags: ['rpg', 'magic', 'spells'] },
  { shareId: 'official-locations', version: 2, label: 'Locations', icon: '🗺️', description: 'Places, regions, and landmarks', tags: ['worldbuilding', 'locations', 'geography'] },
  { shareId: 'official-items', version: 1, label: 'Items', icon: '⚔️', description: 'Weapons, armor, magical items, and equipment', tags: ['rpg', 'items', 'equipment'] },
  { shareId: 'official-classes', version: 2, label: 'Classes', icon: '🎭', description: 'Character classes and professions', tags: ['rpg', 'classes', 'professions'] },
  { shareId: 'official-factions', version: 2, label: 'Factions', icon: '⚜️', description: 'Organizations, guilds, and political groups', tags: ['worldbuilding', 'factions', 'organizations'] },
]

export async function seedOfficialTemplates(): Promise<void> {
  for (const tmpl of OFFICIAL_TEMPLATES) {
    const existing = await db
      .select({ id: entities.id, entityData: entities.entityData })
      .from(entities)
      .where(and(
        eq(entities.collectionName, COLLECTION),
        eq(entities.bobbinId, BOBBIN_ID),
        sql`${entities.entityData}->>'share_id' = ${tmpl.shareId}`
      ))
      .limit(1)

    if (existing.length === 0) {
      // Insert a placeholder — the full field/layout content will be populated
      // when a user first uses this template (from the hardcoded TypeScript definitions)
      // or via the "Sync Template" flow.
      await db.insert(entities).values({
        bobbinId: BOBBIN_ID,
        collectionName: COLLECTION,
        scope: SCOPE,
        entityData: {
          share_id: tmpl.shareId,
          version: tmpl.version,
          label: tmpl.label,
          icon: tmpl.icon,
          description: tmpl.description,
          tags: tmpl.tags,
          official: true,
          author_id: null,
          author_name: 'Bobbinry',
          base_fields: ['name', 'description', 'image_url', 'tags'],
          custom_fields: [],  // Populated from TypeScript templates on first use
          editor_layout: null,
          list_layout: null,
          subtitle_fields: [],
          installs: 0,
          published_at: new Date().toISOString(),
        },
      })
      console.log(`[SeedTemplates] Created official template: ${tmpl.label} (${tmpl.shareId})`)
    } else {
      // Update version if code is newer
      const dbVersion = (existing[0]!.entityData as any)?.version || 0
      if (tmpl.version > dbVersion) {
        await db
          .update(entities)
          .set({
            entityData: sql`${entities.entityData} || ${JSON.stringify({
              version: tmpl.version,
              label: tmpl.label,
              icon: tmpl.icon,
              description: tmpl.description,
              tags: tmpl.tags,
            })}::jsonb`,
          })
          .where(eq(entities.id, existing[0]!.id))
        console.log(`[SeedTemplates] Updated official template version: ${tmpl.label} v${dbVersion} → v${tmpl.version}`)
      }
    }
  }
}
