/**
 * Classes Template
 *
 * For character classes and professions
 */

import type { EntityTemplate } from '../types'

export const classesTemplate: EntityTemplate = {
  id: 'template-classes',
  shareId: 'official-classes',
  version: 2,
  label: 'Classes',
  icon: '🎭',
  description: 'Character classes and professions',
  tags: ['rpg', 'classes', 'professions'],
  baseFields: ['name', 'description', 'image_url', 'tags'],
  customFields: [
    {
      name: 'hit_die',
      type: 'text',
      label: 'Hit Die',
      default: 'd8'
    },
    {
      name: 'primary_ability',
      type: 'multi-select',
      label: 'Primary Abilities',
      options: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']
    },
    {
      name: 'saving_throws',
      type: 'multi-select',
      label: 'Saving Throw Proficiencies',
      options: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']
    },
    {
      name: 'armor_proficiency',
      type: 'text',
      label: 'Armor Proficiency'
    },
    {
      name: 'weapon_proficiency',
      type: 'text',
      label: 'Weapon Proficiency'
    },
    {
      name: 'starting_equipment',
      type: 'text',
      label: 'Starting Equipment'
    },
    {
      name: 'class_features',
      type: 'json',
      label: 'Class Features by Level',
      schema: {
        mode: 'keyed-list',
        keyLabel: 'Level',
        keyType: 'number',
        itemLabel: 'Feature',
        fields: {
          name:        { type: 'text', label: 'Feature Name' },
          description: { type: 'text', label: 'Description' },
        }
      }
    },
    {
      name: 'subclasses',
      type: 'relation',
      label: 'Subclasses / Archetypes',
      targetEntityType: 'classes',
      allowMultiple: true
    }
  ],
  editorLayout: {
    template: 'list-details',
    imagePosition: 'left-sidebar',
    imageSize: 'medium',
    headerFields: ['name', 'hit_die'],
    sections: [
      {
        title: 'Core',
        fields: ['primary_ability', 'saving_throws'],
        display: 'inline'
      },
      {
        title: 'Proficiencies',
        fields: ['armor_proficiency', 'weapon_proficiency'],
        display: 'stacked'
      },
      {
        title: 'Starting Equipment',
        fields: ['starting_equipment'],
        display: 'rich-text'
      },
      {
        title: 'Description',
        fields: ['description'],
        display: 'rich-text'
      },
      {
        title: 'Class Features',
        fields: ['class_features'],
        display: 'json-editor'
      },
      {
        title: 'Subclasses',
        fields: ['subclasses'],
        display: 'stacked'
      }
    ]
  },
  listLayout: {
    display: 'list',
    showFields: ['name', 'hit_die', 'primary_ability']
  },
  subtitleFields: ['hit_die']
}
