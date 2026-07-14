/**
 * Seed Elena's "Clockwork Dreams" with Classes + Spells test entities.
 *
 * Purpose: exercise the class↔spell relation rendering — `spell_list` uses
 * relationDisplay {mode:'grouped', groupByField:'unlock_level'} so the class
 * page can render its kit as level-grouped links with synopses. Includes
 * deliberate edge cases:
 *   - unpublished spells referenced from a published class (→ Locked rows)
 *   - tier-gated spells (minimumTierLevel 1)
 *   - a spell with no unlock_level (→ "Other" bucket)
 *   - an overlong description (→ synopsis truncation)
 * Idempotent: wipes previous classes/spells rows for this project first.
 *
 * Run from apps/api/:
 *   DATABASE_URL=postgres://strider@localhost:5432/bobbins_dev \
 *     npx tsx src/db/seed-clockwork-entities.ts
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './connection'
import { entities, bobbinsInstalled } from './schema'

const PROJECT_ID = '301d3f29-55cf-4917-a635-f0451ec37948' // Clockwork Dreams
const BOBBIN_ID = 'entities'

// ---------------------------------------------------------------- types ---

const STANDARD_BASE_FIELDS = ['name', 'description', 'tags', 'image_url']

const CLASSES_FIELDS = [
  { name: 'role', type: 'select', label: 'Party Role', options: ['Tank', 'Healer', 'Support', 'Ranged DPS', 'Melee DPS', 'Controller', 'Crafter'] },
  { name: 'resource', type: 'select', label: 'Primary Resource', options: ['Mana', 'Pressure', 'Reverie', 'Charge'] },
  { name: 'theme', type: 'text', label: 'Theme / Flavor' },
  { name: 'design_philosophy', type: 'rich-text', label: 'Design Philosophy' },
  {
    name: 'unique_mechanics', type: 'json', label: 'Unique Mechanics',
    schema: { mode: 'list', fields: { name: { type: 'text', label: 'Mechanic' }, description: { type: 'text', label: 'How it works' } }, itemLabel: 'Mechanic' },
  },
  { name: 'capstone', type: 'text', label: 'Capstone (Level 20)' },
  {
    name: 'spell_list', type: 'relation', label: 'Spells & Abilities', targetEntityType: 'spells', allowMultiple: true,
    relationDisplay: { mode: 'grouped', groupByField: 'unlock_level', groupLabel: 'Level', synopsisField: 'description' },
  },
]

const CLASSES_LAYOUT = {
  template: 'hero-image', imagePosition: 'top-right', imageSize: 'medium', headerFields: ['name'],
  sections: [
    { title: 'Core', fields: ['role', 'resource'], display: 'inline' },
    { title: 'Theme', fields: ['theme'], display: 'stacked' },
    { title: 'Design Philosophy', fields: ['design_philosophy'], display: 'rich-text' },
    { title: 'Unique Mechanics', fields: ['unique_mechanics'], display: 'json-editor' },
    { title: 'Spells & Abilities', fields: ['spell_list'], display: 'stacked' },
    { title: 'Capstone', fields: ['capstone'], display: 'stacked' },
  ],
}

const SPELLS_FIELDS = [
  { name: 'spell_type', type: 'select', label: 'Type', options: ['Spell', 'Skill', 'Stance', 'Passive', 'Reaction', 'Summon', 'Capstone'] },
  { name: 'school', type: 'text', label: 'School / Source', hint: 'Cogwork, Somnial, Galvanic, Aetheric…' },
  { name: 'unlock_level', type: 'number', label: 'Unlock Level', min: 1, max: 20 },
  { name: 'class_source', type: 'relation', label: 'Class', targetEntityType: 'classes' },
  { name: 'cost', type: 'text', label: 'Cost' },
  { name: 'cooldown', type: 'text', label: 'Cooldown' },
  { name: 'duration', type: 'text', label: 'Duration' },
  { name: 'targeting', type: 'select', label: 'Targeting', options: ['Self', 'Ally', 'Enemy', 'Area', 'Any', 'Passive'] },
  { name: 'tags', type: 'multi-select', label: 'Spell Tags', options: ['Damage', 'Healing', 'Buff', 'Debuff', 'Control', 'Movement', 'Utility', 'Summon'] },
  { name: 'effect', type: 'rich-text', label: 'Effect / Rules' },
  { name: 'scaling', type: 'text', label: 'Scaling' },
]

const SPELLS_LAYOUT = {
  template: 'hero-image', imagePosition: 'top-right', imageSize: 'small', headerFields: ['name'],
  sections: [
    { title: 'Core', fields: ['spell_type', 'school', 'unlock_level', 'class_source'], display: 'inline' },
    { title: 'Casting', fields: ['cost', 'cooldown', 'duration', 'targeting'], display: 'inline' },
    { title: 'Effect', fields: ['effect'], display: 'rich-text' },
    { title: 'Scaling', fields: ['scaling'], display: 'stacked' },
  ],
}

const LIST_LAYOUT = { display: 'grid', cardSize: 'medium', showFields: ['name', 'description'] }

const TYPES = [
  { type_id: 'classes', label: 'Classes', icon: '⚙️', publish_order: 0, custom_fields: CLASSES_FIELDS, editor_layout: CLASSES_LAYOUT },
  { type_id: 'spells', label: 'Spells', icon: '✨', publish_order: 1, custom_fields: SPELLS_FIELDS, editor_layout: SPELLS_LAYOUT },
]

// --------------------------------------------------------------- content ---

const CLASS_IDS = {
  templar: crypto.randomUUID(),
  cartographer: crypto.randomUUID(),
  duelist: crypto.randomUUID(),
  artificer: crypto.randomUUID(),
}

type SpellSeed = {
  id: string
  cls: keyof typeof CLASS_IDS
  name: string
  desc: string
  type: string
  school: string
  level?: number           // absent → "Other" bucket test case
  cost?: string
  cooldown?: string
  duration?: string
  targeting: string
  tags: string[]
  effect: string
  scaling?: string
  published?: boolean      // default true
  tier?: number            // minimumTierLevel, default 0
}

function spell(cls: keyof typeof CLASS_IDS, name: string, level: number | undefined, type: string, school: string,
  targeting: string, tags: string[], desc: string, effect: string, extra: Partial<SpellSeed> = {}): SpellSeed {
  const s: SpellSeed = { id: crypto.randomUUID(), cls, name, type, school, targeting, tags, desc, effect, ...extra }
  if (level !== undefined) s.level = level
  return s
}

const SPELLS: SpellSeed[] = [
  // ---- Cogwork Templar (tank; resource: Pressure) ----
  spell('templar', 'Boiler Guard', 1, 'Stance', 'Cogwork', 'Self', ['Buff'],
    'Vent steam into a defensive stance; blocks harden as pressure builds.',
    '<p>+15% block efficiency while pressure is above half. Blocking builds 5 pressure per hit.</p>', { cost: '—', duration: 'Stance' }),
  spell('templar', 'Rivet Shot', 1, 'Skill', 'Cogwork', 'Enemy', ['Damage'],
    'Fire a superheated rivet from the gauntlet launcher.',
    '<p>8–12 physical damage, 20 ft. Costs 10 pressure.</p>', { cost: '10 pressure', cooldown: '4s' }),
  spell('templar', 'Pressure Taunt', 2, 'Skill', 'Cogwork', 'Area', ['Control'],
    'A shriek of escaping steam that no construct or coward can ignore.',
    '<p>Hostiles within 15 ft target the Templar for 6s.</p>', { cost: '15 pressure', cooldown: '10s' }),
  spell('templar', 'Brass Bulwark', 3, 'Spell', 'Cogwork', 'Ally', ['Buff'],
    'Unfold a clockwork tower shield in front of an ally.',
    '<p>Intercepts the next 3 hits against the target within 8s.</p>', { cost: '20 pressure', cooldown: '15s' }),
  spell('templar', 'Overpressure Slam', 5, 'Skill', 'Cogwork', 'Area', ['Damage', 'Control'],
    'Dump the boiler into one ground-shaking blow.',
    '<p>18–26 damage in 10 ft, knockdown 1s. Empties all pressure; damage scales with pressure spent.</p>', { cost: 'All pressure', cooldown: '20s' }),
  spell('templar', 'Escapement Reflex', 7, 'Reaction', 'Cogwork', 'Self', ['Buff'],
    'The suit itself steps you out of harm on borrowed clock-ticks.',
    '<p>Once per 30s, automatically block a lethal hit and gain 20 pressure.</p>', { cooldown: '30s' }),
  spell('templar', 'Oath of the Mainspring', 10, 'Spell', 'Cogwork', 'Ally', ['Buff'],
    'Bind your mainspring to an ally\'s heartbeat.',
    '<p>Redirect 30% of an ally\'s incoming damage to yourself for 10s.</p>', { cost: '25 pressure', cooldown: '25s', duration: '10s', published: false }),
  spell('templar', 'Steamwall', 13, 'Spell', 'Cogwork', 'Area', ['Control'],
    'Vent a scalding wall of steam that the enemy must respect.',
    '<p>15 ft steam wall for 8s; enemies crossing it take 12 damage and are slowed 20%.</p>', { cost: '30 pressure', cooldown: '30s', tier: 1 }),
  spell('templar', 'Governor Override', 17, 'Passive', 'Cogwork', 'Passive', ['Buff'],
    'Remove the safety governor. The suit stops asking permission.',
    '<p>Pressure cap +50%; abilities may be used at double cost for +50% effect.</p>', { published: false }),
  spell('templar', 'Perpetual Engine', 20, 'Capstone', 'Cogwork', 'Self', ['Buff'],
    'For one glorious minute, the boiler burns without fuel.',
    '<p>60s: pressure no longer drains, all cooldowns halved, immune to knockdown. Once per day.</p>', { cooldown: 'Daily' }),

  // ---- Somnial Cartographer (support/controller; resource: Reverie) ----
  spell('cartographer', 'Sketch the Threshold', 1, 'Spell', 'Somnial', 'Area', ['Utility'],
    'Chart the boundary between waking and dream; see what crosses it.',
    '<p>Reveals sleeping, dreaming, and dream-touched entities within 30 ft.</p>', { cost: '5 reverie', duration: '60s' }),
  spell('cartographer', 'Lull', 1, 'Spell', 'Somnial', 'Enemy', ['Control'],
    'Fold a corner of the target\'s mind toward sleep.',
    '<p>Target is drowsy 4s: −15% attack speed and accuracy.</p>', { cost: '10 reverie', cooldown: '8s' }),
  spell('cartographer', 'Paper Lantern', 2, 'Spell', 'Somnial', 'Ally', ['Buff', 'Healing'],
    'Hang a dream-light over an ally; their wounds knit while they breathe slow.',
    '<p>Heal 4/s for 8s. Doubled if the target stands still.</p>', { cost: '15 reverie', cooldown: '10s', duration: '8s' }),
  spell('cartographer', 'Redraw the Route', 3, 'Spell', 'Somnial', 'Ally', ['Movement', 'Utility'],
    'Erase an ally\'s last three steps and ink them somewhere better.',
    '<p>Teleport an ally 15 ft to a position they occupied within the last 3s.</p>', { cost: '20 reverie', cooldown: '15s' }),
  spell('cartographer', 'Contour of Nightmares', 5, 'Spell', 'Somnial', 'Area', ['Debuff'],
    'Trace the enemy\'s fears onto the terrain around them.',
    '<p>12 ft zone, 6s: enemies inside deal −10% damage and may hesitate (10% chance to skip an attack).</p>', { cost: '25 reverie', cooldown: '20s' }),
  spell('cartographer', 'Atlas of the Sleeping City', 7, 'Spell', 'Somnial', 'Area', ['Utility'],
    'Unfold the master map. Every dreamer in the district is a candle on its streets — and tonight the city is burning with them. The map remembers avenues that were never built, stairways that only exist on the third dream of a rainy night, and the one alley every sleeper crosses eventually. Cartographers guard this page with their lives.',
    '<p>Project a 200 ft map of all sleeping minds, dream corridors, and somnial currents for 30s. Allies gain +10% movement while it is open.</p>', { cost: '40 reverie', cooldown: '60s', duration: '30s' }),
  spell('cartographer', 'Fold the Distance', 10, 'Spell', 'Somnial', 'Ally', ['Movement'],
    'Two points on the map, pinched together.',
    '<p>Party blink: allies within 10 ft teleport with you up to 40 ft.</p>', { cost: '35 reverie', cooldown: '45s', tier: 1 }),
  spell('cartographer', 'Legend and Key', 13, 'Passive', 'Somnial', 'Passive', ['Buff'],
    'You no longer read the map. You annotate it.',
    '<p>All somnial zones you draw are 25% larger and last 25% longer.</p>'),
  spell('cartographer', 'Terra Somnia', 17, 'Spell', 'Somnial', 'Area', ['Control', 'Debuff'],
    'Declare this ground part of the dream. The dream agrees.',
    '<p>20 ft zone, 10s: enemies move as if wading through deep water (−40% movement, −20% attack speed).</p>', { cost: '50 reverie', cooldown: '90s', published: false }),
  spell('cartographer', 'The Uncharted Hour', 20, 'Capstone', 'Somnial', 'Area', ['Control'],
    'There is one hour no map has ever held. Take the party there.',
    '<p>The party steps outside the map for 5s: untargetable, unmoving, wounds and cooldowns settling as if 30s passed. Once per day.</p>', { cooldown: 'Daily' }),

  // ---- Aether Duelist (melee DPS; resource: Charge) ----
  spell('duelist', 'Galvanic Draw', 1, 'Skill', 'Galvanic', 'Enemy', ['Damage'],
    'The blade leaves the sheath already sparking.',
    '<p>Opener: 10–14 lightning damage, +25% if drawn from stealth or first strike.</p>', { cost: '—', cooldown: '6s' }),
  spell('duelist', 'Static Footwork', 1, 'Passive', 'Galvanic', 'Passive', ['Movement', 'Buff'],
    'Every step stores a little of the storm.',
    '<p>Moving builds charge; at full charge, next attack chains to a second target.</p>'),
  spell('duelist', 'Parry-Capacitor', 2, 'Reaction', 'Galvanic', 'Self', ['Buff'],
    'Catch their blow on the flat and drink its momentum.',
    '<p>Successful parry converts 50% of blocked damage into charge.</p>', { cooldown: '5s' }),
  spell('duelist', 'Arc Lunge', 3, 'Skill', 'Galvanic', 'Enemy', ['Damage', 'Movement'],
    'Cross the distance as a line of light.',
    '<p>Dash 20 ft to a target, 14–18 lightning damage on arrival.</p>', { cost: '20 charge', cooldown: '10s' }),
  spell('duelist', 'Faraday Waltz', 5, 'Stance', 'Galvanic', 'Self', ['Buff'],
    'A dance in which the partner is every blade around you.',
    '<p>Stance: +15% evasion; each dodge builds 10 charge.</p>', { duration: 'Stance' }),
  spell('duelist', 'Chain Riposte', 7, 'Reaction', 'Galvanic', 'Enemy', ['Damage'],
    'The answer arrives before the question finishes.',
    '<p>After a parry: instant counter for 16–22 damage that chains to one nearby enemy.</p>', { cost: '15 charge', cooldown: '12s' }),
  spell('duelist', 'Storm Brand', 10, 'Skill', 'Galvanic', 'Enemy', ['Damage', 'Debuff'],
    'Sign your name on them in lightning.',
    '<p>Mark 8s: your hits on the marked target deal +20% and restore 5 charge.</p>', { cost: '25 charge', cooldown: '20s', tier: 1 }),
  spell('duelist', 'Zero Resistance', 13, 'Passive', 'Galvanic', 'Passive', ['Buff'],
    'The current has stopped asking your body for permission.',
    '<p>At full charge, movement no longer breaks stealth and dashes cost nothing.</p>', { published: false }),
  spell('duelist', 'Tempest Cadenza', 17, 'Skill', 'Galvanic', 'Area', ['Damage'],
    'Every duel you have ever fought, replayed in a single second.',
    '<p>Strike every enemy within 15 ft once: 20–28 lightning each. Consumes all charge.</p>', { cost: 'All charge', cooldown: '45s' }),
  spell('duelist', 'The Living Circuit', 20, 'Capstone', 'Galvanic', 'Self', ['Buff', 'Damage'],
    'Stop carrying the storm. Become its wire.',
    '<p>20s: attacks arc to all enemies in 10 ft, dashes are free, +30% attack speed. Once per day.</p>', { cooldown: 'Daily' }),

  // ---- Dreamsmith Artificer (crafter/summoner) ----
  spell('artificer', 'Wind-Up Familiar', 1, 'Summon', 'Aetheric', 'Any', ['Summon'],
    'A pocket-watch beetle that fetches, bites, and judges.',
    '<p>Summon a clockwork familiar (15 HP). It can carry, distract, or nip for 3–5 damage.</p>', { cost: '10 mana', cooldown: '20s' }),
  spell('artificer', 'Dream Solder', 1, 'Spell', 'Aetheric', 'Any', ['Utility', 'Healing'],
    'Mend metal or flesh with cooling dream-stuff.',
    '<p>Repair a construct 15 HP or heal a person 8 HP. Constructs prefer it.</p>', { cost: '8 mana' }),
  spell('artificer', 'Blueprint Trance', 2, 'Passive', 'Aetheric', 'Passive', ['Utility'],
    'You see the exploded diagram of everything.',
    '<p>Inspect any construct or mechanism to learn its weakest joint (+10% party damage to it).</p>'),
  spell('artificer', 'Cog Golem', 5, 'Summon', 'Aetheric', 'Area', ['Summon', 'Control'],
    'Assemble a hulking chassis from spare parts and stubbornness.',
    '<p>Summon a golem (60 HP) that taunts nearby enemies. One at a time.</p>', { cost: '30 mana', cooldown: '60s' }),
  spell('artificer', 'Recall Springs', 7, 'Spell', 'Aetheric', 'Ally', ['Movement', 'Utility'],
    'Everything you build wants to come home.',
    '<p>Recall all your constructs to your side instantly; they shield you for 3s.</p>', { cost: '15 mana', cooldown: '30s' }),
  spell('artificer', 'Somnium Alloy', 10, 'Passive', 'Aetheric', 'Passive', ['Buff'],
    'Metal quenched in dreams remembers being light.',
    '<p>Your constructs gain +20% HP and weigh nothing to carry.</p>', { tier: 1 }),
  spell('artificer', 'Swarm Directive', 13, 'Summon', 'Aetheric', 'Area', ['Summon', 'Damage'],
    'One beetle is a curiosity. Forty are a policy.',
    '<p>Release a swarm of familiars: 6/s area damage in 12 ft for 8s, then they disperse.</p>', { cost: '45 mana', cooldown: '90s', published: false }),
  spell('artificer', 'The Unfinished Machine', 20, 'Capstone', 'Aetheric', 'Area', ['Summon'],
    'Your masterwork. It has never been completed. That is its power.',
    '<p>Summon the Unfinished Machine for 30s: it adapts each round, gaining whichever ability the fight most needs. Once per day.</p>', { cooldown: 'Daily' }),
  // Edge case: no unlock_level → should land in the "Other" bucket of grouped display
  spell('artificer', 'Tinker\'s Habit', undefined, 'Passive', 'Aetheric', 'Passive', ['Utility'],
    'Idle hands find gears.',
    '<p>Out of combat, slowly generates spare parts used by summon abilities.</p>'),
]

const CLASSES = [
  {
    id: CLASS_IDS.templar, name: 'Cogwork Templar', role: 'Tank', resource: 'Pressure',
    desc: 'Oath-bound knights in brass pressure-armor. The boiler on their back is both engine and altar.',
    theme: 'Steam, oaths, and standing exactly where you said you would.',
    philosophy: '<p>Role: tank and promise-keeper. Pressure is built by blocking and spent on protection — the Templar\'s power is literally made of the hits they take for others.</p>',
    mechanics: [
      { name: 'Pressure', description: 'Builds from blocked hits, spent on abilities. Empty boiler = quiet Templar.' },
      { name: 'Oathbinding', description: 'Defensive abilities are stronger on allies the Templar has sworn to (one oath at a time).' },
    ],
    capstone: 'Perpetual Engine — 60s of a boiler that burns without fuel.',
    publish_order: 0,
  },
  {
    id: CLASS_IDS.cartographer, name: 'Somnial Cartographer', role: 'Controller', resource: 'Reverie',
    desc: 'Mapmakers of the sleeping world. They chart dream corridors under the waking city — and redraw them mid-fight.',
    theme: 'Maps, sleep, and the conviction that geography is negotiable.',
    philosophy: '<p>Role: battlefield control and utility. Everything is drawn as zones and routes — the Cartographer wins by deciding where the fight happens.</p>',
    mechanics: [
      { name: 'Reverie', description: 'Regenerates near sleeping minds; the class is strongest in inhabited places at night.' },
      { name: 'Cartography', description: 'Zones are drawn, not cast — they persist on the map and can be re-inked.' },
    ],
    capstone: 'The Uncharted Hour — take the party to the hour no map has ever held.',
    publish_order: 1,
  },
  {
    id: CLASS_IDS.duelist, name: 'Aether Duelist', role: 'Melee DPS', resource: 'Charge',
    desc: 'Fencers who bottle the storm. Their footwork is a circuit diagram; their blades close it.',
    theme: 'Lightning, tempo, and the beautiful arithmetic of the counter-attack.',
    philosophy: '<p>Role: single-target burst built on movement. Charge comes from footwork and parries — a stationary Duelist is a dead battery.</p>',
    mechanics: [
      { name: 'Charge', description: 'Built by moving and parrying, spent on dashes and finishers.' },
      { name: 'Tempo', description: 'Reactions are the core loop: parry → riposte → reposition.' },
    ],
    capstone: 'The Living Circuit — stop carrying the storm; become its wire.',
    publish_order: 2,
  },
  {
    id: CLASS_IDS.artificer, name: 'Dreamsmith Artificer', role: 'Crafter', resource: 'Mana',
    desc: 'Engineers who quench their alloys in dreams. Their workshops follow them into battle on tiny brass legs.',
    theme: 'Constructs, repair, and the love of the almost-finished.',
    philosophy: '<p>Role: summoner-crafter. The Artificer\'s power is a household of constructs — build, mend, recall, repeat.</p>',
    mechanics: [
      { name: 'Constructs', description: 'Persistent summons with HP; healing metal is cheaper than healing flesh.' },
      { name: 'Spare Parts', description: 'Passive out-of-combat resource that discounts summons.' },
    ],
    capstone: 'The Unfinished Machine — the masterwork whose power is its incompleteness.',
    publish_order: 3,
  },
]

// --------------------------------------------------------------- helpers ---

async function ensureBobbinInstalled() {
  const existing = await db
    .select({ id: bobbinsInstalled.id })
    .from(bobbinsInstalled)
    .where(and(eq(bobbinsInstalled.projectId, PROJECT_ID), eq(bobbinsInstalled.bobbinId, BOBBIN_ID)))
    .limit(1)
  if (existing.length > 0) { console.log('entities bobbin already installed'); return }
  // Copy the manifest from any existing entities install.
  const src = await db
    .select({ manifestJson: bobbinsInstalled.manifestJson, version: bobbinsInstalled.version })
    .from(bobbinsInstalled)
    .where(eq(bobbinsInstalled.bobbinId, BOBBIN_ID))
    .limit(1)
  if (src.length === 0) throw new Error('No existing entities install to copy the manifest from')
  await db.insert(bobbinsInstalled).values({
    id: crypto.randomUUID(),
    projectId: PROJECT_ID,
    collectionId: null,
    userId: null,
    scope: 'project',
    bobbinId: BOBBIN_ID,
    version: src[0]!.version,
    manifestJson: src[0]!.manifestJson,
    enabled: true,
  } as any)
  console.log('installed entities bobbin (project scope)')
}

async function upsertType(t: (typeof TYPES)[number]) {
  const existing = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(
      eq(entities.projectId, PROJECT_ID),
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
    versionable_base_fields: [],
    custom_fields: t.custom_fields,
    editor_layout: t.editor_layout,
    list_layout: LIST_LAYOUT,
    subtitle_fields: [],
    allow_duplicates: true,
    variant_axis: null,
    schema_version: 1,
    _field_history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing.length > 0) {
    await db.update(entities)
      .set({ entityData, isPublished: true, publishOrder: t.publish_order, updatedAt: new Date() })
      .where(eq(entities.id, existing[0]!.id))
    console.log(`  updated type ${t.type_id}`)
  } else {
    await db.insert(entities).values({
      id: crypto.randomUUID(),
      projectId: PROJECT_ID,
      collectionId: null,
      userId: null,
      scope: 'project',
      bobbinId: BOBBIN_ID,
      collectionName: 'entity_type_definitions',
      entityData,
      isPublished: true,
      publishOrder: t.publish_order,
    })
    console.log(`  inserted type ${t.type_id}`)
  }
}

async function wipeExisting() {
  await db.delete(entities).where(and(
    eq(entities.projectId, PROJECT_ID),
    inArray(entities.collectionName, ['classes', 'spells']),
  ))
}

async function main() {
  console.log(`\nSeeding Clockwork Dreams classes + spells — project ${PROJECT_ID}\n`)

  await ensureBobbinInstalled()

  console.log('Upserting type definitions…')
  for (const t of TYPES) await upsertType(t)

  console.log('\nWiping previous classes/spells rows…')
  await wipeExisting()

  const now = new Date().toISOString()

  console.log('\nInserting classes…')
  for (const c of CLASSES) {
    const spellIds = SPELLS.filter(s => CLASS_IDS[s.cls] === c.id).map(s => s.id)
    await db.insert(entities).values({
      id: c.id,
      projectId: PROJECT_ID, collectionId: null, userId: null,
      scope: 'project', bobbinId: BOBBIN_ID, collectionName: 'classes',
      entityData: {
        name: c.name, description: c.desc, tags: ['class', 'clockwork-dreams'], image_url: null,
        role: c.role, resource: c.resource, theme: c.theme, design_philosophy: c.philosophy,
        unique_mechanics: c.mechanics, capstone: c.capstone, spell_list: spellIds,
        created_at: now, updated_at: now,
      },
      isPublished: true, publishedAt: new Date(), publishOrder: c.publish_order,
      minimumTierLevel: 0, publishBase: true, publishedVariantIds: [],
    })
    console.log(`  classes · ${c.name} (${spellIds.length} spells linked)`)
  }

  console.log('\nInserting spells…')
  let order = 0
  for (const s of SPELLS) {
    const published = s.published ?? true
    await db.insert(entities).values({
      id: s.id,
      projectId: PROJECT_ID, collectionId: null, userId: null,
      scope: 'project', bobbinId: BOBBIN_ID, collectionName: 'spells',
      entityData: {
        name: s.name, description: s.desc, tags: s.tags.map(t => t.toLowerCase()), image_url: null,
        spell_type: s.type, school: s.school,
        ...(s.level !== undefined ? { unlock_level: s.level } : {}),
        class_source: CLASS_IDS[s.cls],
        cost: s.cost ?? '—', cooldown: s.cooldown ?? '—', duration: s.duration ?? '—',
        targeting: s.targeting, effect: s.effect,
        ...(s.scaling ? { scaling: s.scaling } : {}),
        created_at: now, updated_at: now,
      },
      isPublished: published, publishedAt: published ? new Date() : null, publishOrder: order++,
      minimumTierLevel: s.tier ?? 0, publishBase: true, publishedVariantIds: [],
    })
    const flags = [
      published ? null : 'draft',
      s.tier ? `tier ${s.tier}` : null,
      s.level === undefined ? 'no-level' : null,
    ].filter(Boolean).join(', ')
    console.log(`  spells · ${s.name}${flags ? `  (${flags})` : ''}`)
  }

  console.log(`\nSeeded ${CLASSES.length} classes + ${SPELLS.length} spells.`)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
