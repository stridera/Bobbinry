/**
 * LayoutDesigner component tests
 */

import { describe, it, expect, jest } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayoutDesigner } from '../components/LayoutDesigner'
import type { FieldDefinition, EditorLayout, ListLayout } from '../types'

describe('LayoutDesigner Component', () => {
  const mockOnChange = jest.fn()

  const sampleFields: FieldDefinition[] = [
    { name: 'age', type: 'number', label: 'Age' },
    { name: 'class', type: 'select', label: 'Class', options: ['Warrior'] }
  ]

  const sampleEditorLayout: EditorLayout = {
    template: 'compact-card',
    imagePosition: 'top-right',
    imageSize: 'medium',
    headerFields: ['name'],
    sections: [
      { title: 'Details', fields: ['age'], display: 'stacked' }
    ]
  }

  const sampleListLayout: ListLayout = {
    display: 'grid',
    cardSize: 'medium',
    showFields: ['name', 'description']
  }

  beforeEach(() => {
    mockOnChange.mockClear()
  })

  describe('Tab Navigation', () => {
    it('should default to editor tab', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText('Layout Template')).toBeInTheDocument()
    })

    it('should switch to list tab', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const listTab = screen.getByText('List Layout')
      fireEvent.click(listTab)

      expect(screen.getByText('Display Mode')).toBeInTheDocument()
    })
  })

  describe('Editor Layout - Template Selection', () => {
    it('should render all layout templates', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText('Compact Card')).toBeInTheDocument()
      expect(screen.getByText('Hero Image')).toBeInTheDocument()
      expect(screen.getByText('List & Details')).toBeInTheDocument()
    })

    it('should change template', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const heroButton = screen.getByText('Hero Image')
      fireEvent.click(heroButton)

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'hero-image' }),
        sampleListLayout
      )
    })
  })

  describe('Editor Layout - Image Configuration', () => {
    it('should change image position', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const positionSelect = screen.getByDisplayValue('Top Right')
      fireEvent.change(positionSelect, { target: { value: 'left-sidebar' } })

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ imagePosition: 'left-sidebar' }),
        sampleListLayout
      )
    })

    it('should change image size', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const sizeSelect = screen.getByDisplayValue('Medium')
      fireEvent.change(sizeSelect, { target: { value: 'large' } })

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ imageSize: 'large' }),
        sampleListLayout
      )
    })

    it('should disable image size when position is none', () => {
      const layoutWithNoImage: EditorLayout = {
        ...sampleEditorLayout,
        imagePosition: 'none'
      }

      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={layoutWithNoImage}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const sizeSelect = screen.getByDisplayValue('Medium')
      expect(sizeSelect).toBeDisabled()
    })
  })

  describe('Editor Layout - Header Fields', () => {
    it('should render available fields as toggles', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      expect(screen.getAllByText('name').length).toBeGreaterThan(0)
      expect(screen.getAllByText('description').length).toBeGreaterThan(0)
      expect(screen.getAllByText('age').length).toBeGreaterThan(0)
    })

    it('should toggle header field on click', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const ageButtons = screen.getAllByText('age')
      // Click the one in header fields section
      const headerSection = screen.getByText('Header Fields (shown at top)').parentElement!
      const ageButton = headerSection.querySelector('button:has-text("age")')
        || ageButtons[0]

      fireEvent.click(ageButton)

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          headerFields: expect.arrayContaining(['name', 'age'])
        }),
        sampleListLayout
      )
    })
  })

  describe('Editor Layout - Sections', () => {
    it('should show section count', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText(/Content Sections \(1\)/i)).toBeInTheDocument()
    })

    it('should add new section', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const addButton = screen.getByText('+ Add Section')
      fireEvent.click(addButton)

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: expect.arrayContaining([
            sampleEditorLayout.sections[0],
            expect.objectContaining({
              title: 'Section 2',
              fields: [],
              display: 'stacked'
            })
          ])
        }),
        sampleListLayout
      )
    })

    it('should remove section', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const removeButton = screen.getByText('Remove')
      fireEvent.click(removeButton)

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ sections: [] }),
        sampleListLayout
      )
    })

    it('should update section title', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      const titleInput = screen.getByDisplayValue('Details')
      fireEvent.change(titleInput, { target: { value: 'Character Details' } })

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: [
            expect.objectContaining({ title: 'Character Details' })
          ]
        }),
        sampleListLayout
      )
    })

    it('should show empty state when no sections', () => {
      const emptyLayout: EditorLayout = {
        ...sampleEditorLayout,
        sections: []
      }

      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={emptyLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      expect(screen.getByText(/No sections yet/i)).toBeInTheDocument()
    })
  })

  describe('List Layout - Display Mode', () => {
    it('should switch to list mode', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      fireEvent.click(screen.getByText('List Layout'))

      const listButton = screen.getByText('List')
      fireEvent.click(listButton)

      expect(mockOnChange).toHaveBeenCalledWith(
        sampleEditorLayout,
        expect.objectContaining({ display: 'list' })
      )
    })

    it('should switch to grid mode', () => {
      const listMode: ListLayout = {
        ...sampleListLayout,
        display: 'list'
      }

      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={listMode}
          onChange={mockOnChange}
        />
      )

      fireEvent.click(screen.getByText('List Layout'))

      const gridButton = screen.getByText('Grid')
      fireEvent.click(gridButton)

      expect(mockOnChange).toHaveBeenCalledWith(
        sampleEditorLayout,
        expect.objectContaining({ display: 'grid' })
      )
    })
  })

  describe('List Layout - Card Size', () => {
    it('should show card size selector in grid mode', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      fireEvent.click(screen.getByText('List Layout'))

      expect(screen.getByText('Card Size')).toBeInTheDocument()
    })

    it('should not show card size in list mode', () => {
      const listMode: ListLayout = {
        ...sampleListLayout,
        display: 'list'
      }

      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={listMode}
          onChange={mockOnChange}
        />
      )

      fireEvent.click(screen.getByText('List Layout'))

      expect(screen.queryByText('Card Size')).not.toBeInTheDocument()
    })

    it('should change card size', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      fireEvent.click(screen.getByText('List Layout'))

      const sizeSelect = screen.getByDisplayValue('Medium')
      fireEvent.change(sizeSelect, { target: { value: 'large' } })

      expect(mockOnChange).toHaveBeenCalledWith(
        sampleEditorLayout,
        expect.objectContaining({ cardSize: 'large' })
      )
    })
  })

  describe('List Layout - Show Fields', () => {
    it('should toggle list field on click', () => {
      render(
        <LayoutDesigner
          fields={sampleFields}
          editorLayout={sampleEditorLayout}
          listLayout={sampleListLayout}
          onChange={mockOnChange}
        />
      )

      fireEvent.click(screen.getByText('List Layout'))

      // Find age button in Fields to Display section
      const ageButtons = screen.getAllByText('age')
      fireEvent.click(ageButtons[ageButtons.length - 1])

      expect(mockOnChange).toHaveBeenCalledWith(
        sampleEditorLayout,
        expect.objectContaining({
          showFields: expect.arrayContaining(['name', 'description', 'age'])
        })
      )
    })
  })
})
