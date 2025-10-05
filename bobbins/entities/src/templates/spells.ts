/**
 * Spells Template
 *
 * For magical abilities, incantations, and spells
 */

import type { EntityTemplate } from '../types'

export const spellsTemplate: EntityTemplate = {
  id: 'template-spells',
  label: 'Spells',
  icon: '✨',
  description: 'Magical abilities and incantations',
  baseFields: ['name', 'description', 'image_url', 'tags'],
  customFields: [
    {
      name: 'spell_level',
      type: 'number',
      label: 'Spell Level',
      min: 0,
      max: 9,
      required: true
    },
    {
      name: 'school',
      type: 'select',
      label: 'School of Magic',
      options: [
        'Abjuration',
        'Conjuration',
        'Divination',
        'Enchantment',
        'Evocation',
        'Illusion',
        'Necromancy',
        'Transmutation'
      ]
    },
    {
      name: 'casting_time',
      type: 'text',
      label: 'Casting Time',
      default: '1 action'
    },
    {
      name: 'range',
      type: 'text',
      label: 'Range'
    },
    {
      name: 'components',
      type: 'text',
      label: 'Components (V, S, M)'
    },
    {
      name: 'duration',
      type: 'text',
      label: 'Duration',
      default: 'Instantaneous'
    },
    {
      name: 'classes',
      type: 'multi-select',
      label: 'Available to Classes',
      options: [
        'Wizard',
        'Sorcerer',
        'Warlock',
        'Cleric',
        'Druid',
        'Bard',
        'Paladin',
        'Ranger'
      ]
    },
    {
      name: 'damage_type',
      type: 'select',
      label: 'Damage Type',
      options: [
        'None',
        'Fire',
        'Ice',
        'Lightning',
        'Acid',
        'Poison',
        'Necrotic',
        'Radiant',
        'Force',
        'Psychic',
        'Thunder'
      ]
    },
    {
      name: 'save_type',
      type: 'select',
      label: 'Saving Throw',
      options: [
        'None',
        'Strength',
        'Dexterity',
        'Constitution',
        'Intelligence',
        'Wisdom',
        'Charisma'
      ]
    }
  ],
  editorLayout: {
    template: 'list-details',
    imagePosition: 'left-sidebar',
    imageSize: 'medium',
    headerFields: ['name', 'spell_level', 'school'],
    sections: [
      {
        title: 'Casting',
        fields: ['casting_time', 'range', 'components', 'duration'],
        display: 'inline'
      },
      {
        title: 'Mechanics',
        fields: ['classes', 'damage_type', 'save_type'],
        display: 'inline'
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
    cardSize: 'small',
    showFields: ['name', 'spell_level', 'school', 'damage_type']
  },
  subtitleFields: ['spell_level', 'school']
}
