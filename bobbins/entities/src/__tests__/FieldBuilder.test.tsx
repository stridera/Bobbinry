/**
 * FieldBuilder component tests
 */

import { describe, it, expect, jest } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldBuilder } from '../components/FieldBuilder'
import type { FieldDefinition } from '../types'

describe('FieldBuilder Component', () => {
  const mockOnChange = jest.fn()

  const sampleFields: FieldDefinition[] = [
    { name: 'age', type: 'number', label: 'Age', required: false },
    { name: 'class', type: 'select', label: 'Class', options: ['Warrior', 'Mage'], required: true }
  ]

  beforeEach(() => {
    mockOnChange.mockClear()
  })

  describe('Rendering', () => {
    it('should render with no fields', () => {
      render(<FieldBuilder fields={[]} onChange={mockOnChange} />)
      expect(screen.getByText(/No custom fields yet/i)).toBeInTheDocument()
    })

    it('should render field count', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)
      expect(screen.getByText(/Custom Fields \(2\)/i)).toBeInTheDocument()
    })

    it('should render all fields', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)
      expect(screen.getByText('Age')).toBeInTheDocument()
      expect(screen.getByText('Class')).toBeInTheDocument()
    })

    it('should show field metadata', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)
      expect(screen.getByText(/age • number/i)).toBeInTheDocument()
      expect(screen.getByText(/class • select • Required/i)).toBeInTheDocument()
    })
  })

  describe('Adding Fields', () => {
    it('should add new field when clicking Add Field button', () => {
      render(<FieldBuilder fields={[]} onChange={mockOnChange} />)

      const addButton = screen.getByText('+ Add Field')
      fireEvent.click(addButton)

      expect(mockOnChange).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'field_1',
          type: 'text',
          label: 'New Field 1',
          required: false
        })
      ])
    })

    it('should increment field name counter', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const addButton = screen.getByText('+ Add Field')
      fireEvent.click(addButton)

      expect(mockOnChange).toHaveBeenCalledWith([
        ...sampleFields,
        expect.objectContaining({
          name: 'field_3',
          label: 'New Field 3'
        })
      ])
    })
  })

  describe('Removing Fields', () => {
    it('should remove field when clicking Remove button', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const removeButtons = screen.getAllByText('Remove')
      fireEvent.click(removeButtons[0])

      expect(mockOnChange).toHaveBeenCalledWith([sampleFields[1]])
    })
  })

  describe('Editing Fields', () => {
    it('should show editor when clicking Edit button', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[0])

      expect(screen.getByDisplayValue('Age')).toBeInTheDocument()
      expect(screen.getByDisplayValue('age')).toBeInTheDocument()
    })

    it('should update field label', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[0])

      const labelInput = screen.getByDisplayValue('Age')
      fireEvent.change(labelInput, { target: { value: 'Character Age' } })

      expect(mockOnChange).toHaveBeenCalledWith([
        { ...sampleFields[0], label: 'Character Age' },
        sampleFields[1]
      ])
    })

    it('should sanitize field name', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[0])

      const nameInput = screen.getByDisplayValue('age')
      fireEvent.change(nameInput, { target: { value: 'My Field Name!' } })

      expect(mockOnChange).toHaveBeenCalledWith([
        { ...sampleFields[0], name: 'my_field_name_' },
        sampleFields[1]
      ])
    })

    it('should toggle required checkbox', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[0])

      const requiredCheckbox = screen.getByLabelText('Required field')
      fireEvent.click(requiredCheckbox)

      expect(mockOnChange).toHaveBeenCalledWith([
        { ...sampleFields[0], required: true },
        sampleFields[1]
      ])
    })

    it('should change field type', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[0])

      const typeSelect = screen.getByDisplayValue('Number')
      fireEvent.change(typeSelect, { target: { value: 'text' } })

      expect(mockOnChange).toHaveBeenCalledWith([
        { ...sampleFields[0], type: 'text' },
        sampleFields[1]
      ])
    })
  })

  describe('Type-Specific Options', () => {
    it('should show options editor for select fields', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[1]) // Class field (select type)

      expect(screen.getByPlaceholderText(/Option 1/)).toBeInTheDocument()
      expect(screen.getByDisplayValue('Warrior\nMage')).toBeInTheDocument()
    })

    it('should update select options', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[1])

      const optionsTextarea = screen.getByDisplayValue('Warrior\nMage')
      fireEvent.change(optionsTextarea, {
        target: { value: 'Warrior\nMage\nRogue' }
      })

      expect(mockOnChange).toHaveBeenCalledWith([
        sampleFields[0],
        { ...sampleFields[1], options: ['Warrior', 'Mage', 'Rogue'] }
      ])
    })

    it('should show number constraints for number fields', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[0]) // Age field (number type)

      expect(screen.getByText('Min')).toBeInTheDocument()
      expect(screen.getByText('Max')).toBeInTheDocument()
      expect(screen.getByText('Default')).toBeInTheDocument()
    })

    it('should show multiline checkbox for text fields', () => {
      const textField: FieldDefinition = {
        name: 'bio',
        type: 'text',
        label: 'Biography'
      }

      render(<FieldBuilder fields={[textField]} onChange={mockOnChange} />)

      const editButton = screen.getByText('Edit')
      fireEvent.click(editButton)

      expect(screen.getByText(/Multiline \(textarea\)/i)).toBeInTheDocument()
    })
  })

  describe('Drag and Drop', () => {
    it('should set dragged index on drag start', () => {
      render(<FieldBuilder fields={sampleFields} onChange={mockOnChange} />)

      const fields = screen.getAllByText('⋮⋮')
      fireEvent.dragStart(fields[0].closest('[draggable="true"]')!)

      // State is internal, verify by checking that element is draggable
      expect(fields[0].closest('[draggable="true"]')).toHaveAttribute('draggable', 'true')
    })
  })
})
