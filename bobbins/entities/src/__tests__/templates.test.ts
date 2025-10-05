/**
 * Template validation tests
 */

import { describe, it, expect } from '@jest/globals'
import { templates } from '../templates'
import type { EntityTemplate, FieldType } from '../types'

describe('Entity Templates', () => {
  describe('Template Structure', () => {
    it('should have 6 templates', () => {
      expect(templates).toHaveLength(6)
    })

    it('should have all required templates', () => {
      const templateIds = templates.map(t => t.id)
      expect(templateIds).toContain('template-characters')
      expect(templateIds).toContain('template-spells')
      expect(templateIds).toContain('template-locations')
      expect(templateIds).toContain('template-items')
      expect(templateIds).toContain('template-classes')
      expect(templateIds).toContain('template-factions')
    })

    it.each(templates)('$label template should have valid structure', (template) => {
      expect(template).toHaveProperty('id')
      expect(template).toHaveProperty('label')
      expect(template).toHaveProperty('icon')
      expect(template).toHaveProperty('description')
      expect(template).toHaveProperty('baseFields')
      expect(template).toHaveProperty('customFields')
      expect(template).toHaveProperty('editorLayout')
      expect(template).toHaveProperty('listLayout')
      expect(template).toHaveProperty('subtitleFields')
    })
  })

  describe('Base Fields', () => {
    it.each(templates)('$label should include standard base fields', (template) => {
      expect(template.baseFields).toEqual(
        expect.arrayContaining(['name', 'description', 'tags', 'image_url'])
      )
    })
  })

  describe('Custom Fields', () => {
    const validFieldTypes: FieldType[] = [
      'text', 'number', 'select', 'multi-select',
      'boolean', 'date', 'json', 'rich-text', 'image'
    ]

    it.each(templates)('$label should have valid custom fields', (template) => {
      expect(template.customFields.length).toBeGreaterThan(0)

      template.customFields.forEach(field => {
        expect(field).toHaveProperty('name')
        expect(field).toHaveProperty('type')
        expect(field).toHaveProperty('label')
        expect(validFieldTypes).toContain(field.type)
      })
    })

    it.each(templates)('$label field names should be valid identifiers', (template) => {
      template.customFields.forEach(field => {
        expect(field.name).toMatch(/^[a-z][a-z0-9_]*$/)
      })
    })

    it('select fields should have options', () => {
      templates.forEach(template => {
        template.customFields
          .filter(f => f.type === 'select' || f.type === 'multi-select')
          .forEach(field => {
            expect(field.options).toBeDefined()
            expect(field.options!.length).toBeGreaterThan(0)
          })
      })
    })

    it('number fields with min/max should have valid ranges', () => {
      templates.forEach(template => {
        template.customFields
          .filter(f => f.type === 'number' && f.min !== undefined && f.max !== undefined)
          .forEach(field => {
            expect(field.max!).toBeGreaterThan(field.min!)
          })
      })
    })
  })

  describe('Editor Layout', () => {
    it.each(templates)('$label should have valid editor layout', (template) => {
      const { editorLayout } = template
      expect(['compact-card', 'hero-image', 'list-details', 'custom']).toContain(editorLayout.template)
      expect(['top-right', 'top-full-width', 'left-sidebar', 'none']).toContain(editorLayout.imagePosition)
      expect(['small', 'medium', 'large']).toContain(editorLayout.imageSize)
      expect(Array.isArray(editorLayout.headerFields)).toBe(true)
      expect(Array.isArray(editorLayout.sections)).toBe(true)
    })

    it.each(templates)('$label header fields should exist in template', (template) => {
      const allFields = [...template.baseFields, ...template.customFields.map(f => f.name)]
      template.editorLayout.headerFields.forEach(field => {
        expect(allFields).toContain(field)
      })
    })

    it.each(templates)('$label section fields should exist in template', (template) => {
      const allFields = [...template.baseFields, ...template.customFields.map(f => f.name)]
      template.editorLayout.sections.forEach(section => {
        expect(section).toHaveProperty('title')
        expect(section).toHaveProperty('fields')
        expect(section).toHaveProperty('display')

        section.fields.forEach(field => {
          expect(allFields).toContain(field)
        })
      })
    })
  })

  describe('List Layout', () => {
    it.each(templates)('$label should have valid list layout', (template) => {
      const { listLayout } = template
      expect(['grid', 'list']).toContain(listLayout.display)
      expect(Array.isArray(listLayout.showFields)).toBe(true)
      expect(listLayout.showFields.length).toBeGreaterThan(0)
    })

    it.each(templates)('$label list showFields should exist in template', (template) => {
      const allFields = [...template.baseFields, ...template.customFields.map(f => f.name)]
      template.listLayout.showFields.forEach(field => {
        expect(allFields).toContain(field)
      })
    })
  })

  describe('Subtitle Fields', () => {
    it.each(templates)('$label subtitle fields should exist in template', (template) => {
      const allFields = [...template.baseFields, ...template.customFields.map(f => f.name)]
      template.subtitleFields.forEach(field => {
        expect(allFields).toContain(field)
      })
    })
  })

  describe('Template-Specific Tests', () => {
    it('Characters template should have character-specific fields', () => {
      const characters = templates.find(t => t.id === 'template-characters')!
      const fieldNames = characters.customFields.map(f => f.name)

      expect(fieldNames).toContain('class')
      expect(fieldNames).toContain('level')
      expect(fieldNames).toContain('race')
    })

    it('Spells template should have spell-specific fields', () => {
      const spells = templates.find(t => t.id === 'template-spells')!
      const fieldNames = spells.customFields.map(f => f.name)

      expect(fieldNames).toContain('school')
      expect(fieldNames).toContain('spell_level')
      expect(fieldNames).toContain('casting_time')
    })

    it('Locations template should have location-specific fields', () => {
      const locations = templates.find(t => t.id === 'template-locations')!
      const fieldNames = locations.customFields.map(f => f.name)

      expect(fieldNames).toContain('terrain')
      expect(fieldNames).toContain('climate')
      expect(fieldNames).toContain('population')
    })

    it('Items template should have item-specific fields', () => {
      const items = templates.find(t => t.id === 'template-items')!
      const fieldNames = items.customFields.map(f => f.name)

      expect(fieldNames).toContain('item_type')
      expect(fieldNames).toContain('rarity')
    })
  })
})
