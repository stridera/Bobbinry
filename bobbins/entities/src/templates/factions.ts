/**
 * Factions Template
 *
 * For organizations, guilds, and political groups
 */

import type { EntityTemplate } from '../types'

export const factionsTemplate: EntityTemplate = {
  id: 'template-factions',
  label: 'Factions',
  icon: '⚜️',
  description: 'Organizations, guilds, and political groups',
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
      type: 'text',
      label: 'Leader/Head'
    },
    {
      name: 'headquarters',
      type: 'text',
      label: 'Headquarters'
    },
    {
      name: 'goals',
      type: 'text',
      label: 'Goals/Agenda'
    },
    {
      name: 'allies',
      type: 'text',
      label: 'Allies'
    },
    {
      name: 'enemies',
      type: 'text',
      label: 'Enemies'
    },
    {
      name: 'notable_members',
      type: 'json',
      label: 'Notable Members'
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
        display: 'json-editor'
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
