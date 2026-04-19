/**
 * Locations Template
 *
 * For places, regions, and landmarks
 */

import type { EntityTemplate } from '../types'

export const locationsTemplate: EntityTemplate = {
  id: 'template-locations',
  shareId: 'official-locations',
  version: 4,
  label: 'Locations',
  icon: '🗺️',
  description: 'Places, regions, and landmarks',
  tags: ['worldbuilding', 'locations', 'geography'],
  baseFields: ['name', 'description', 'image_url', 'tags'],
  versionableBaseFields: ['description', 'image_url'],
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
      ],
      versionable: true
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
      min: 0,
      versionable: true
    },
    {
      name: 'government',
      type: 'text',
      label: 'Government Type',
      versionable: true
    },
    {
      name: 'notable_npcs',
      type: 'relation',
      label: 'Notable NPCs',
      targetEntityType: 'characters',
      allowMultiple: true,
      versionable: true
    },
    {
      name: 'resources',
      type: 'text',
      label: 'Resources/Economy',
      versionable: true
    },
    {
      name: 'dangers',
      type: 'text',
      label: 'Dangers',
      versionable: true
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
        display: 'stacked'
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
