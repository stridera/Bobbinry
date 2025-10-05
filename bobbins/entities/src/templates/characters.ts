/**
 * Characters Template
 *
 * For people, creatures, NPCs, and player characters
 */

import type { EntityTemplate } from '../types'

export const charactersTemplate: EntityTemplate = {
  id: 'template-characters',
  label: 'Characters',
  icon: '🧙',
  description: 'People, creatures, or NPCs in your world',
  baseFields: ['name', 'description', 'image_url', 'tags'],
  customFields: [
    {
      name: 'age',
      type: 'number',
      label: 'Age'
    },
    {
      name: 'class',
      type: 'select',
      label: 'Class',
      options: ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Paladin', 'Barbarian', 'Druid', 'Monk', 'Bard', 'Warlock', 'Sorcerer']
    },
    {
      name: 'level',
      type: 'number',
      label: 'Level',
      default: 1,
      min: 1,
      max: 20
    },
    {
      name: 'race',
      type: 'text',
      label: 'Race'
    },
    {
      name: 'alignment',
      type: 'select',
      label: 'Alignment',
      options: [
        'Lawful Good',
        'Neutral Good',
        'Chaotic Good',
        'Lawful Neutral',
        'True Neutral',
        'Chaotic Neutral',
        'Lawful Evil',
        'Neutral Evil',
        'Chaotic Evil'
      ]
    },
    {
      name: 'stats',
      type: 'json',
      label: 'Stats',
      schema: {
        strength: 'number',
        dexterity: 'number',
        constitution: 'number',
        intelligence: 'number',
        wisdom: 'number',
        charisma: 'number'
      }
    },
    {
      name: 'background',
      type: 'rich-text',
      label: 'Background'
    },
    {
      name: 'abilities',
      type: 'json',
      label: 'Special Abilities'
    }
  ],
  editorLayout: {
    template: 'compact-card',
    imagePosition: 'top-right',
    imageSize: 'small',
    headerFields: ['name', 'age', 'class'],
    sections: [
      {
        title: 'Basic Info',
        fields: ['race', 'alignment', 'level'],
        display: 'inline'
      },
      {
        title: 'Stats',
        fields: ['stats'],
        display: 'json-editor'
      },
      {
        title: 'Background',
        fields: ['background'],
        display: 'rich-text'
      },
      {
        title: 'Abilities',
        fields: ['abilities'],
        display: 'json-editor'
      },
      {
        title: 'Description',
        fields: ['description'],
        display: 'rich-text'
      }
    ]
  },
  listLayout: {
    display: 'grid',
    cardSize: 'medium',
    showFields: ['name', 'level', 'class', 'image_url']
  },
  subtitleFields: ['level', 'class']
}
