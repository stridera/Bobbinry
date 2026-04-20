/**
 * Seed Elena's "The Last Starweaver" with codex entities.
 *
 * Characters / locations / concepts / items drawn from the project's
 * chapters so the author's Publishing view + public reader Entities tab
 * have real-feeling test data. Idempotent: deletes any existing
 * starweaver codex rows for this project before re-inserting.
 *
 * Run from apps/api/:
 *   DATABASE_URL=postgres://strider@localhost:5432/bobbins_dev \
 *     npx tsx src/db/seed-starweaver-entities.ts
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './connection'
import { entities } from './schema'

const PROJECT_ID = '1b494f01-1b2e-4ff7-a9d5-1b010639e4bc' // The Last Starweaver
const COLLECTION_ID = '042f3f64-157c-4655-b5ba-4a4e74e356d1' // Starweaver Saga
const BOBBIN_ID = 'entities'
const SCOPE: 'project' | 'collection' | 'global' = 'collection'
const SCOPE_OWNER = { collectionId: COLLECTION_ID }

const STANDARD_EDITOR_LAYOUT = {
  template: 'hero-image',
  imagePosition: 'top-right',
  imageSize: 'medium',
  headerFields: ['name'],
  sections: [
    { title: 'Overview', fields: ['description'], display: 'stacked' },
  ],
}
const STANDARD_LIST_LAYOUT = { display: 'grid', cardSize: 'medium', showFields: ['name', 'description'] }

const STANDARD_BASE_FIELDS = ['name', 'description', 'tags', 'image_url']

type SeedType = {
  type_id: string
  label: string
  icon: string
  publish_order: number
  versionable_base_fields?: string[]
  custom_fields?: any[]
  variant_axis?: { id: string; label: string; kind: 'ordered' | 'unordered' } | null
}

const TYPES: SeedType[] = [
  { type_id: 'characters', label: 'Characters', icon: '👤', publish_order: 0, versionable_base_fields: ['description'], variant_axis: { id: 'timeline', label: 'Timeline', kind: 'ordered' } },
  { type_id: 'locations',  label: 'Locations',  icon: '🗺️', publish_order: 1 },
  { type_id: 'concepts',   label: 'Concepts',   icon: '✨', publish_order: 2 },
  { type_id: 'items',      label: 'Items',      icon: '📜', publish_order: 3 },
]

type SeedEntity = {
  type: string
  name: string
  description: string
  tags?: string[]
  image_url?: string
  publish_order: number
  is_published?: boolean
  minimum_tier_level?: number
  variants?: { order: string[]; active?: string | null; items: Record<string, { label: string; axis_value?: number; overrides?: Record<string, unknown> }> }
  publish_base?: boolean
  published_variant_ids?: string[]
}

// All entities default to is_published=true, public tier. Drafts + gated
// entries are flagged explicitly so the author can see those states in the
// Publishing view.
const ENTITIES: SeedEntity[] = [
  // Characters
  {
    type: 'characters',
    name: 'Lira',
    description:
      'A young astronomer from Thornhaven who can see what others cannot — old magic in forgotten places, ley lines beneath the cobblestones, and the starthreads themselves. She spends her nights at the abandoned observatory reading the sky.',
    tags: ['protagonist', 'threadweaver'],
    publish_order: 0,
    publish_base: true,
    published_variant_ids: ['ch1', 'ch2'],
    variants: {
      order: ['ch1', 'ch2', 'ch3'],
      active: 'ch1',
      items: {
        ch1: {
          label: 'The Observatory',
          axis_value: 1,
          overrides: {
            description:
              'A young astronomer from Thornhaven. Quiet, curious, stubborn — she sees more than she lets on. Has not yet spoken to anyone about the starthread she glimpsed tonight.',
          },
        },
        ch2: {
          label: 'First Thread',
          axis_value: 2,
          overrides: {
            description:
              "Lira has felt a starthread plunge into her wrist. Her senses are newly sharpened — frost crystals, chimney heat — and she is alone with a secret she cannot explain. Her grandmother's lessons on patience are all she has to go on.",
          },
        },
        ch3: {
          label: 'Unraveling',
          axis_value: 3,
          // Not published yet — future-book spoilers live here.
          overrides: {
            description:
              '[Spoiler — not yet published] Lira can no longer deny that the threadwork has changed her. The Keeper has noticed. The Academy will notice next.',
          },
        },
      },
    },
  },
  {
    type: 'characters',
    name: "Lira's Grandmother",
    description:
      'A storyteller who raised Lira on the old myths of the Loom and the starthreads. Scholars call them superstition; she called them memory. Her hands were the ones that taught Lira how to quiet frightened creatures.',
    tags: ['family', 'mentor'],
    publish_order: 1,
  },
  {
    type: 'characters',
    name: 'Maren',
    description:
      'The baker of Thornhaven. Stokes her ovens before dawn. Her bread is how the village knows morning has arrived — and tonight, Lira can feel the heat of them three streets away.',
    tags: ['thornhaven'],
    publish_order: 2,
  },
  {
    type: 'characters',
    name: 'E. Voss',
    description:
      'Long-dead author of "A Practical Guide to Threadwork," a slim volume bound in blue leather that Lira unearthed from the restricted archive. Nothing else is known of them — the Academy\'s records list no such scholar.',
    tags: ['historical', 'mystery'],
    publish_order: 3,
  },
  {
    type: 'characters',
    name: 'The Keeper',
    description:
      'The archivist who locks the restricted stacks at dawn. They have served the Academy for longer than any of Thornhaven\'s elders can remember, and they have noticed more about Lira than she realises.',
    tags: ['academy'],
    publish_order: 4,
    minimum_tier_level: 1, // Tier-gated — late-chapter character
  },

  // Locations
  {
    type: 'locations',
    name: 'The Observatory',
    description:
      'Abandoned long before Lira was born, its brass telescope tarnished and its star charts still faintly shimmering with old magic. From its spiral staircase and rooftop railing the whole of Thornhaven lies sleeping below.',
    tags: ['thornhaven', 'magical'],
    publish_order: 0,
  },
  {
    type: 'locations',
    name: 'Thornhaven',
    description:
      'A quiet village of thatched roofs and narrow lanes, nestled beneath the observatory hill. Ley lines run under its market square; most of its residents have never noticed.',
    tags: ['village'],
    publish_order: 1,
  },
  {
    type: 'locations',
    name: 'The Restricted Archive',
    description:
      'Deep beneath the Academy, a vault of treatises, natural philosophy, and things the Academy prefers to forget. The Keeper locks the stacks at dawn. Lira has learned which floorboards creak.',
    tags: ['academy', 'forbidden'],
    publish_order: 2,
  },
  {
    type: 'locations',
    name: 'The Academy',
    description:
      'The arbiters of what is real. Their curriculum has no room for starthreads or the Loom, and their scholars dismiss both as the ramblings of older, more superstitious ages.',
    tags: ['organization'],
    publish_order: 3,
  },
  {
    type: 'locations',
    name: "Maren's Bakery",
    description:
      'Three streets from the observatory. The chimney vents heat into the cold night like a quiet heartbeat. Lira can feel it now, whether she means to or not.',
    tags: ['thornhaven'],
    publish_order: 4,
    is_published: false, // Draft — author hasn't decided if this is reader-worthy yet
  },

  // Concepts
  {
    type: 'concepts',
    name: 'Starthread',
    description:
      'A filament of raw creation, alive and beckoning. Most scholars dismiss them as myth; those who can see them describe them as threads of silver light that weave through the void between stars with purpose and intention.',
    tags: ['magic', 'loom'],
    publish_order: 0,
  },
  {
    type: 'concepts',
    name: 'The Loom',
    description:
      'The mythic structure said to hold the universe together. If it is real, everything the Academy teaches about the nature of reality is wrong.',
    tags: ['magic', 'cosmology'],
    publish_order: 1,
  },
  {
    type: 'concepts',
    name: 'Threadwork',
    description:
      'The practice of inviting starthreads rather than commanding them. "The first lesson of Threadwork is patience. A thread cannot be seized or commanded. It must be invited."',
    tags: ['magic', 'practice'],
    publish_order: 2,
  },
  {
    type: 'concepts',
    name: 'Ley Lines',
    description:
      "Rivers of faint magic that run beneath the earth. Lira noticed their shimmer under the market square's cobblestones when she was seven. No one else seemed to see them.",
    tags: ['magic'],
    publish_order: 3,
  },

  // Items
  {
    type: 'items',
    name: 'A Practical Guide to Threadwork',
    description:
      'A slim volume bound in blue leather, buried in the restricted archive between treatises on astronomy and natural philosophy. Its pages are brittle, but its instructions are remarkably clear. Author: E. Voss.',
    tags: ['book', 'threadwork'],
    publish_order: 0,
  },
  {
    type: 'items',
    name: 'The Ancient Telescope',
    description:
      'Brass fittings, tarnished by centuries of neglect. Still points where it was left pointing — between Orion and Cassiopeia, the place Lira first saw the starthread.',
    tags: ['observatory'],
    publish_order: 1,
  },
  {
    type: 'items',
    name: 'The Star Charts',
    description:
      'Pinned to the walls of the observatory. They shimmer faintly, as if remembering the constellations they once mapped. Most eyes would miss the glow; Lira never has.',
    tags: ['observatory'],
    publish_order: 2,
  },
]

async function wipeExistingCodex() {
  // Remove any previously-seeded codex rows so reseeding is idempotent.
  await db.delete(entities).where(and(
    eq(entities.collectionId, COLLECTION_ID),
    inArray(entities.collectionName, ['characters', 'locations', 'concepts', 'items']),
  ))
}

async function upsertType(t: SeedType) {
  const existing = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(
      eq(entities.collectionId, COLLECTION_ID),
      eq(entities.collectionName, 'entity_type_definitions'),
      sql`${entities.entityData}->>'type_id' = ${t.type_id}`,
    ))
    .limit(1)

  const entityData = {
    type_id: t.type_id,
    label: t.label,
    icon: t.icon,
    template_id: null,
    template_version: null,
    base_fields: STANDARD_BASE_FIELDS,
    versionable_base_fields: t.versionable_base_fields ?? [],
    custom_fields: t.custom_fields ?? [],
    editor_layout: STANDARD_EDITOR_LAYOUT,
    list_layout: STANDARD_LIST_LAYOUT,
    subtitle_fields: [],
    allow_duplicates: true,
    variant_axis: t.variant_axis ?? null,
    schema_version: 1,
    _field_history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing.length > 0) {
    await db
      .update(entities)
      .set({
        entityData,
        isPublished: true,
        publishOrder: t.publish_order,
        updatedAt: new Date(),
      })
      .where(eq(entities.id, existing[0]!.id))
    console.log(`  updated type ${t.type_id}`)
  } else {
    await db.insert(entities).values({
      id: crypto.randomUUID(),
      projectId: null,
      collectionId: SCOPE_OWNER.collectionId,
      userId: null,
      scope: SCOPE,
      bobbinId: BOBBIN_ID,
      collectionName: 'entity_type_definitions',
      entityData,
      isPublished: true,
      publishOrder: t.publish_order,
    })
    console.log(`  inserted type ${t.type_id}`)
  }
}

async function insertEntity(e: SeedEntity) {
  const now = new Date().toISOString()
  const entityData: Record<string, any> = {
    name: e.name,
    description: e.description,
    tags: e.tags ?? [],
    image_url: e.image_url ?? null,
    created_at: now,
    updated_at: now,
  }
  if (e.variants) {
    entityData._variants = e.variants
  }
  await db.insert(entities).values({
    id: crypto.randomUUID(),
    projectId: null,
    collectionId: SCOPE_OWNER.collectionId,
    userId: null,
    scope: SCOPE,
    bobbinId: BOBBIN_ID,
    collectionName: e.type,
    entityData,
    isPublished: e.is_published ?? true,
    publishedAt: (e.is_published ?? true) ? new Date() : null,
    publishOrder: e.publish_order,
    minimumTierLevel: e.minimum_tier_level ?? 0,
    publishBase: e.publish_base ?? true,
    publishedVariantIds: e.published_variant_ids ?? [],
  })
}

async function main() {
  console.log(`\nSeeding Starweaver codex — project ${PROJECT_ID}, collection ${COLLECTION_ID}\n`)

  console.log('Upserting type definitions…')
  for (const t of TYPES) await upsertType(t)

  console.log('\nWiping previous codex rows…')
  await wipeExistingCodex()

  console.log('\nInserting entities…')
  let i = 0
  for (const e of ENTITIES) {
    await insertEntity(e)
    i++
    const flags = [
      e.is_published === false ? 'draft' : null,
      e.minimum_tier_level && e.minimum_tier_level > 0 ? `tier ${e.minimum_tier_level}` : null,
      e.variants ? 'variants' : null,
    ].filter(Boolean).join(', ')
    console.log(`  ${e.type} · ${e.name}${flags ? `  (${flags})` : ''}`)
  }

  console.log(`\nSeeded ${i} entities across ${TYPES.length} types.`)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
