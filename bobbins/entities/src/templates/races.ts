/**
 * Races Template
 *
 * For playable races, species, and ancestries
 */

import type { EntityTemplate } from '../types'

export const racesTemplate: EntityTemplate = {
  id: 'template-races',
  shareId: 'official-races',
  version: 1,
  label: 'Races',
  icon: '🧝',
  description: 'Playable races, species, and ancestries',
  tags: ['rpg', 'worldbuilding', 'races'],
  baseFields: ['name', 'description', 'image_url', 'tags'],
  customFields: [
    {
      name: 'size',
      type: 'select',
      label: 'Size',
      options: ['Tiny', 'Small', 'Medium', 'Large', 'Huge']
    },
    {
      name: 'speed',
      type: 'number',
      label: 'Speed (ft)',
      default: 30,
      min: 0
    },
    {
      name: 'ability_bonuses',
      type: 'json',
      label: 'Ability Score Bonuses',
      schema: {
        mode: 'object',
        fields: {
          strength:     { type: 'number', label: 'Strength',     default: 0 },
          dexterity:    { type: 'number', label: 'Dexterity',    default: 0 },
          constitution: { type: 'number', label: 'Constitution', default: 0 },
          intelligence: { type: 'number', label: 'Intelligence', default: 0 },
          wisdom:       { type: 'number', label: 'Wisdom',       default: 0 },
          charisma:     { type: 'number', label: 'Charisma',     default: 0 },
        }
      }
    },
    {
      name: 'traits',
      type: 'json',
      label: 'Racial Traits',
      schema: {
        mode: 'list',
        itemLabel: 'Trait',
        fields: {
          name:        { type: 'text', label: 'Trait Name' },
          description: { type: 'text', label: 'Description' },
        }
      }
    },
    {
      name: 'languages',
      type: 'text',
      label: 'Languages'
    },
    {
      name: 'lifespan',
      type: 'text',
      label: 'Lifespan'
    },
    {
      name: 'subraces',
      type: 'relation',
      label: 'Subraces',
      targetEntityType: 'races',
      allowMultiple: true
    },
    {
      name: 'lore',
      type: 'rich-text',
      label: 'Lore & History'
    }
  ],
  editorLayout: {
    template: 'compact-card',
    imagePosition: 'top-right',
    imageSize: 'small',
    headerFields: ['name', 'size'],
    sections: [
      {
        title: 'Basics',
        fields: ['speed', 'languages', 'lifespan'],
        display: 'inline'
      },
      {
        title: 'Ability Score Bonuses',
        fields: ['ability_bonuses'],
        display: 'json-editor'
      },
      {
        title: 'Racial Traits',
        fields: ['traits'],
        display: 'json-editor'
      },
      {
        title: 'Description',
        fields: ['description'],
        display: 'rich-text'
      },
      {
        title: 'Lore & History',
        fields: ['lore'],
        display: 'rich-text'
      },
      {
        title: 'Subraces',
        fields: ['subraces'],
        display: 'stacked'
      }
    ]
  },
  listLayout: {
    display: 'grid',
    cardSize: 'medium',
    showFields: ['name', 'size', 'speed', 'image_url']
  },
  subtitleFields: ['size']
}
