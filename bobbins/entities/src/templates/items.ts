/**
 * Items Template
 *
 * For weapons, armor, magical items, and equipment
 */

import type { EntityTemplate } from '../types'

export const itemsTemplate: EntityTemplate = {
  id: 'template-items',
  shareId: 'official-items',
  version: 4,
  label: 'Items',
  icon: '⚔️',
  description: 'Weapons, armor, magical items, and equipment',
  tags: ['rpg', 'items', 'equipment'],
  baseFields: ['name', 'description', 'image_url', 'tags'],
  versionableBaseFields: ['description', 'image_url'],
  variantAxis: { id: 'state', label: 'State', kind: 'unordered' },
  customFields: [
    {
      name: 'item_type',
      type: 'select',
      label: 'Type',
      options: [
        'Weapon',
        'Armor',
        'Potion',
        'Scroll',
        'Wondrous Item',
        'Ring',
        'Wand',
        'Rod',
        'Staff',
        'Amulet',
        'Cloak',
        'Boots',
        'Gloves',
        'Helm',
        'Shield',
        'Artifact'
      ]
    },
    {
      name: 'rarity',
      type: 'select',
      label: 'Rarity',
      options: [
        'Common',
        'Uncommon',
        'Rare',
        'Very Rare',
        'Legendary',
        'Artifact'
      ],
      versionable: true
    },
    {
      name: 'attunement',
      type: 'boolean',
      label: 'Requires Attunement',
      default: false
    },
    {
      name: 'weight',
      type: 'number',
      label: 'Weight (lbs)',
      min: 0
    },
    {
      name: 'value',
      type: 'number',
      label: 'Value (gold)',
      min: 0,
      versionable: true
    },
    {
      name: 'damage',
      type: 'text',
      label: 'Damage (if weapon)',
      versionable: true
    },
    {
      name: 'armor_class',
      type: 'text',
      label: 'AC (if armor)',
      versionable: true
    },
    {
      name: 'properties',
      type: 'text',
      label: 'Properties',
      versionable: true
    },
    {
      name: 'effects',
      type: 'rich-text',
      label: 'Magical Effects',
      versionable: true
    }
  ],
  editorLayout: {
    template: 'compact-card',
    imagePosition: 'top-right',
    imageSize: 'small',
    headerFields: ['name', 'item_type', 'rarity'],
    sections: [
      {
        title: 'Stats',
        fields: ['weight', 'value', 'attunement'],
        display: 'inline'
      },
      {
        title: 'Combat',
        fields: ['damage', 'armor_class', 'properties'],
        display: 'inline'
      },
      {
        title: 'Description',
        fields: ['description'],
        display: 'rich-text'
      },
      {
        title: 'Magical Effects',
        fields: ['effects'],
        display: 'rich-text'
      }
    ]
  },
  listLayout: {
    display: 'grid',
    cardSize: 'small',
    showFields: ['name', 'item_type', 'rarity', 'image_url']
  },
  subtitleFields: ['item_type', 'rarity']
}
