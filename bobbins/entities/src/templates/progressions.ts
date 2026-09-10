/**
 * Power Progressions Template
 *
 * One entity per character's power sheet: passive and active abilities that
 * grow rank by rank. Each rank is a variant on an ordered axis, and both
 * ability lists carry forward, so a new rank starts as a copy of the last and
 * the author only edits what changed. The progression section shows every
 * rank side by side; the tables edit the rank that's selected.
 */

import type { EntityTemplate, JsonSchemaField } from '../types'

const abilityFields: Record<string, JsonSchemaField> = {
  name: { type: 'text', label: 'Ability' },
  school: {
    type: 'select',
    label: 'School',
    options: ['🔥 Elemental', '💥 Conjuration', '☄️ Spatial', '🧠 Cerebral', '🩸 Bonding', '🎭 Puppeteer', '💪 Somatic'],
  },
  // Labelled "Level" so readers don't mistake it for a subscription tier.
  tier: { type: 'number', label: 'Level', min: 1 },
  description: { type: 'text', label: 'What it does', multiline: true },
}

export const progressionsTemplate: EntityTemplate = {
  id: 'template-progressions',
  shareId: 'official-progressions',
  version: 2,
  label: 'Power Progressions',
  icon: '🌀',
  description: "How a character's abilities grow, rank by rank",
  tags: ['magic', 'progression', 'litrpg'],
  baseFields: ['name', 'description', 'image_url', 'tags'],
  variantAxis: {
    id: 'rank',
    label: 'Rank',
    kind: 'ordered',
    presets: ['Novice', 'Adept', 'Expert', 'Master'],
  },
  variantInheritance: { passives: 'forward', actives: 'forward' },
  customFields: [
    {
      name: 'character',
      type: 'relation',
      label: 'Character',
      targetEntityType: 'characters',
    },
    {
      name: 'passives',
      type: 'json',
      label: 'Passives',
      schema: { mode: 'list', itemLabel: 'Passive', fields: abilityFields },
      versionable: true,
    },
    {
      name: 'actives',
      type: 'json',
      label: 'Actives',
      schema: { mode: 'list', itemLabel: 'Active', fields: abilityFields },
      versionable: true,
    },
    {
      name: 'notes',
      type: 'rich-text',
      label: 'Notes',
      versionable: true,
    },
  ],
  editorLayout: {
    template: 'compact-card',
    imagePosition: 'none',
    imageSize: 'small',
    headerFields: ['name', 'character'],
    sections: [
      { title: 'Overview', fields: ['description'], display: 'stacked' },
      { title: 'Progression', fields: ['passives', 'actives'], display: 'progression' },
      { title: 'Passives', fields: ['passives'], display: 'table' },
      { title: 'Actives', fields: ['actives'], display: 'table' },
      { title: 'Notes', fields: ['notes'], display: 'rich-text' },
    ],
  },
  listLayout: {
    display: 'list',
    showFields: ['name', 'character'],
  },
  subtitleFields: ['character'],
}
