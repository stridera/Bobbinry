/**
 * Locations Template
 *
 * For places, regions, and landmarks
 */

import type { EntityTemplate } from '../types'

export const locationsTemplate: EntityTemplate = {
  id: 'template-locations',
  label: 'Locations',
  icon: '🗺️',
  description: 'Places, regions, and landmarks',
  baseFields: ['name', 'description', 'image_url', 'tags'],
  customFields: [
    {
      name: 'location_type',
      type: 'select',
      label: 'Type',
      options: [
        'City',
        'Town',
        'Village',
        'Dungeon',
        'Forest',
        'Mountain',
        'Desert',
        'Ocean',
        'Ruins',
        'Castle',
        'Temple',
        'Tavern',
        'Shop',
        'Cave',
        'Fortress',
        'Island'
      ]
    },
    {
      name: 'terrain',
      type: 'text',
      label: 'Terrain'
    },
    {
      name: 'climate',
      type: 'select',
      label: 'Climate',
      options: [
        'Tropical',
        'Temperate',
        'Arid',
        'Arctic',
        'Mediterranean',
        'Continental',
        'Volcanic',
        'Magical'
      ]
    },
    {
      name: 'population',
      type: 'number',
      label: 'Population',
      min: 0
    },
    {
      name: 'government',
      type: 'text',
      label: 'Government Type'
    },
    {
      name: 'notable_npcs',
      type: 'json',
      label: 'Notable NPCs'
    },
    {
      name: 'resources',
      type: 'text',
      label: 'Resources/Economy'
    },
    {
      name: 'dangers',
      type: 'text',
      label: 'Dangers'
    },
    {
      name: 'history',
      type: 'rich-text',
      label: 'History'
    }
  ],
  editorLayout: {
    template: 'hero-image',
    imagePosition: 'top-full-width',
    imageSize: 'large',
    headerFields: ['name'],
    sections: [
      {
        title: 'Overview',
        fields: ['location_type', 'terrain', 'climate', 'population'],
        display: 'inline'
      },
      {
        title: 'Details',
        fields: ['government', 'resources', 'dangers'],
        display: 'stacked'
      },
      {
        title: 'Notable NPCs',
        fields: ['notable_npcs'],
        display: 'json-editor'
      },
      {
        title: 'Description',
        fields: ['description'],
        display: 'rich-text'
      },
      {
        title: 'History',
        fields: ['history'],
        display: 'rich-text'
      }
    ]
  },
  listLayout: {
    display: 'grid',
    cardSize: 'large',
    showFields: ['name', 'location_type', 'terrain', 'image_url']
  },
  subtitleFields: ['location_type', 'terrain']
}
