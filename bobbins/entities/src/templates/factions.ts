/**
 * Factions Template
 *
 * For organizations, guilds, and political groups
 */

import type { EntityTemplate } from '../types'

export const factionsTemplate: EntityTemplate = {
  id: 'template-factions',
  shareId: 'official-factions',
  version: 2,
  label: 'Factions',
  icon: '⚜️',
  description: 'Organizations, guilds, and political groups',
  tags: ['worldbuilding', 'factions', 'organizations'],
  baseFields: ['name', 'description', 'image_url', 'tags'],
  customFields: [
    {
      name: 'faction_type',
      type: 'select',
      label: 'Type',
      options: [
        'Guild',
        'Military',
        'Religious',
        'Political',
        'Criminal',
        'Academic',
        'Mercantile',
        'Secret Society',
        'Knightly Order'
      ]
    },
    {
      name: 'alignment',
      type: 'select',
      label: 'General Alignment',
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
      name: 'size',
      type: 'select',
      label: 'Size',
      options: [
        'Small (<50)',
        'Medium (50-500)',
        'Large (500-5000)',
        'Massive (5000+)'
      ]
    },
    {
      name: 'influence',
      type: 'select',
      label: 'Influence',
      options: ['Local', 'Regional', 'Continental', 'Global']
    },
    {
      name: 'leader',
      type: 'relation',
      label: 'Leader/Head',
      targetEntityType: 'characters'
    },
    {
      name: 'headquarters',
      type: 'relation',
      label: 'Headquarters',
      targetEntityType: 'locations'
    },
    {
      name: 'goals',
      type: 'text',
      label: 'Goals/Agenda'
    },
    {
      name: 'allies',
      type: 'relation',
      label: 'Allies',
      targetEntityType: 'factions',
      allowMultiple: true
    },
    {
      name: 'enemies',
      type: 'relation',
      label: 'Enemies',
      targetEntityType: 'factions',
      allowMultiple: true
    },
    {
      name: 'notable_members',
      type: 'relation',
      label: 'Notable Members',
      targetEntityType: 'characters',
      allowMultiple: true
    }
  ],
  editorLayout: {
    template: 'compact-card',
    imagePosition: 'top-right',
    imageSize: 'medium',
    headerFields: ['name', 'faction_type', 'influence'],
    sections: [
      {
        title: 'Overview',
        fields: ['alignment', 'size', 'leader', 'headquarters'],
        display: 'inline'
      },
      {
        title: 'Goals',
        fields: ['goals'],
        display: 'rich-text'
      },
      {
        title: 'Relations',
        fields: ['allies', 'enemies'],
        display: 'stacked'
      },
      {
        title: 'Description',
        fields: ['description'],
        display: 'rich-text'
      },
      {
        title: 'Notable Members',
        fields: ['notable_members'],
        display: 'stacked'
      }
    ]
  },
  listLayout: {
    display: 'grid',
    cardSize: 'medium',
    showFields: ['name', 'faction_type', 'influence', 'image_url']
  },
  subtitleFields: ['faction_type', 'influence']
}
