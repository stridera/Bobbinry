/**
 * Integration tests for complete entity type configuration flow
 */

import { describe, it, expect, jest } from '@jest/globals'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ConfigView from '../views/config'
import { templates } from '../templates'

// Mock SDK
const mockSDK = {
  entities: {
    query: jest.fn(),
    create: jest.fn()
  },
  setProject: jest.fn()
} as any

describe('Entity Configuration Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Template Selection Flow', () => {
    it('should display all available templates', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      templates.forEach(template => {
        expect(screen.getByText(template.label)).toBeInTheDocument()
      })
    })

    it('should show template descriptions', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      expect(screen.getByText(/People, creatures, or NPCs/i)).toBeInTheDocument()
      expect(screen.getByText(/Magical effects and abilities/i)).toBeInTheDocument()
    })

    it('should have preview button for each template', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const previewButtons = screen.getAllByText('Preview')
      expect(previewButtons).toHaveLength(templates.length)
    })

    it('should have use template button for each template', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      expect(useButtons).toHaveLength(templates.length)
    })
  })

  describe('Template Preview Modal', () => {
    it('should open preview modal when clicking Preview', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const previewButtons = screen.getAllByText('Preview')
      fireEvent.click(previewButtons[0]) // Characters template

      expect(screen.getByText('Base Fields (included in all entities)')).toBeInTheDocument()
      expect(screen.getByText(/Custom Fields/i)).toBeInTheDocument()
    })

    it('should close modal when clicking Cancel', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const previewButtons = screen.getAllByText('Preview')
      fireEvent.click(previewButtons[0])

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)

      expect(screen.queryByText('Base Fields (included in all entities)')).not.toBeInTheDocument()
    })

    it('should proceed to customization when clicking Use This Template from modal', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const previewButtons = screen.getAllByText('Preview')
      fireEvent.click(previewButtons[0])

      const useButton = screen.getByRole('button', { name: /use this template/i })
      fireEvent.click(useButton)

      expect(screen.getByText('Customize Entity Type')).toBeInTheDocument()
    })
  })

  describe('Customization Flow', () => {
    it('should transition to customization view when using template', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0]) // Characters

      expect(screen.getByText('Customize Entity Type')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Characters')).toBeInTheDocument()
    })

    it('should populate fields from template', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0]) // Characters

      // Check that characters template fields are loaded
      expect(screen.getByText(/Level/i)).toBeInTheDocument()
      expect(screen.getByText(/Class/i)).toBeInTheDocument()
    })

    it('should allow editing entity type name', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0])

      const nameInput = screen.getByDisplayValue('Characters')
      fireEvent.change(nameInput, { target: { value: 'NPCs' } })

      expect(screen.getByDisplayValue('NPCs')).toBeInTheDocument()
    })

    it('should allow editing entity icon', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0])

      const iconInput = screen.getByDisplayValue('🧙')
      fireEvent.change(iconInput, { target: { value: '👤' } })

      expect(screen.getByDisplayValue('👤')).toBeInTheDocument()
    })

    it('should show base fields info', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0])

      expect(screen.getByText(/name, description, tags, image_url/i)).toBeInTheDocument()
    })

    it('should return to template selector when clicking back', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0])

      const backButton = screen.getByText(/back to templates/i)
      fireEvent.click(backButton)

      expect(screen.getByText('Entity Types Configuration')).toBeInTheDocument()
    })
  })

  describe('Field Customization', () => {
    beforeEach(() => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0]) // Characters
    })

    it('should allow adding new fields', () => {
      const addButton = screen.getByText('+ Add Field')
      fireEvent.click(addButton)

      // Characters template has 8 fields, so new one should make it 9
      expect(screen.getByText(/Custom Fields \(9\)/i)).toBeInTheDocument()
    })

    it('should allow removing fields', () => {
      const removeButtons = screen.getAllByText('Remove')
      const initialCount = removeButtons.length

      fireEvent.click(removeButtons[0])

      const updatedRemoveButtons = screen.getAllByText('Remove')
      expect(updatedRemoveButtons).toHaveLength(initialCount - 1)
    })

    it('should allow editing field properties', () => {
      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[0])

      // Should show field editor
      expect(screen.getByText('Field Name (internal)')).toBeInTheDocument()
      expect(screen.getByText('Field Type')).toBeInTheDocument()
    })
  })

  describe('Layout Configuration', () => {
    beforeEach(() => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0])
    })

    it('should show layout configuration section', () => {
      expect(screen.getByText('Layout Configuration')).toBeInTheDocument()
    })

    it('should have editor and list layout tabs', () => {
      expect(screen.getByText('Editor Layout')).toBeInTheDocument()
      expect(screen.getByText('List Layout')).toBeInTheDocument()
    })

    it('should allow changing layout template', () => {
      expect(screen.getByText('Compact Card')).toBeInTheDocument()
      expect(screen.getByText('Hero Image')).toBeInTheDocument()
      expect(screen.getByText('List & Details')).toBeInTheDocument()
    })
  })

  describe('Save Functionality', () => {
    beforeEach(() => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const useButtons = screen.getAllByText('Use Template')
      fireEvent.click(useButtons[0])
    })

    it('should have save button', () => {
      expect(screen.getByText('Save Entity Type')).toBeInTheDocument()
    })

    it('should disable save button when name is empty', () => {
      const nameInput = screen.getByDisplayValue('Characters')
      fireEvent.change(nameInput, { target: { value: '' } })

      const saveButton = screen.getByText('Save Entity Type')
      expect(saveButton).toBeDisabled()
    })

    it('should disable save button when icon is empty', () => {
      const iconInput = screen.getByDisplayValue('🧙')
      fireEvent.change(iconInput, { target: { value: '' } })

      const saveButton = screen.getByText('Save Entity Type')
      expect(saveButton).toBeDisabled()
    })

    it('should enable save button when all required fields are filled', () => {
      const saveButton = screen.getByText('Save Entity Type')
      expect(saveButton).not.toBeDisabled()
    })
  })

  describe('Create from Scratch Flow', () => {
    it('should have create from scratch button', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      expect(screen.getByText('🎨 Create from Scratch')).toBeInTheDocument()
    })

    it('should transition to customization with empty state', () => {
      render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      const createButton = screen.getByText('🎨 Create from Scratch')
      fireEvent.click(createButton)

      expect(screen.getByText('Customize Entity Type')).toBeInTheDocument()
      expect(screen.getByText(/No custom fields yet/i)).toBeInTheDocument()
    })
  })

  describe('Complete Flow', () => {
    it('should support full template to save workflow', async () => {
      const { container } = render(
        <ConfigView
          projectId="test-project"
          bobbinId="entities"
          viewId="config"
          sdk={mockSDK}
        />
      )

      // 1. Preview template
      const previewButtons = screen.getAllByText('Preview')
      fireEvent.click(previewButtons[0])
      expect(screen.getByText('Base Fields (included in all entities)')).toBeInTheDocument()

      // 2. Use template from modal
      const useFromModal = screen.getByRole('button', { name: /use this template/i })
      fireEvent.click(useFromModal)

      // 3. Verify we're in customization
      expect(screen.getByText('Customize Entity Type')).toBeInTheDocument()

      // 4. Modify entity type name
      const nameInput = screen.getByDisplayValue('Characters')
      fireEvent.change(nameInput, { target: { value: 'My Characters' } })

      // 5. Add a new field
      const addFieldButton = screen.getByText('+ Add Field')
      fireEvent.click(addFieldButton)

      // 6. Configure layout
      const listLayoutTab = screen.getByText('List Layout')
      fireEvent.click(listLayoutTab)

      // 7. Verify save button is enabled
      const saveButton = screen.getByText('Save Entity Type')
      expect(saveButton).not.toBeDisabled()

      // Note: Actual save would trigger alert, which we can't easily test in jsdom
    })
  })
})
