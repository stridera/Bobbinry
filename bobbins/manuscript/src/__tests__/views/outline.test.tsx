/**
 * Tests for Manuscript Outline View
 *
 * Tests the native Outline view component for hierarchical book/chapter/scene display
 */

import React from 'react'
import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import OutlineView from '../../views/outline'
import type { BobbinrySDK } from '@bobbinry/sdk'

// Mock SDK
const createMockSDK = (): BobbinrySDK => ({
  entities: {
    query: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'book-1',
          title: 'Test Book',
          order: 1,
          _meta: {
            bobbinId: 'manuscript',
            collection: 'books',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }
      ],
      total: 1
    }),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  views: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn()
  }
} as any)

describe('Outline View', () => {
  let mockSDK: BobbinrySDK

  beforeEach(() => {
    mockSDK = createMockSDK()
  })

  it('should render outline view', async () => {
    render(
      <OutlineView
        projectId="test-project"
        bobbinId="manuscript"
        viewId="outline"
        sdk={mockSDK}
      />
    )

    // Should show loading state initially
    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    // Wait for data to load
    await waitFor(() => {
      const bookElements = screen.getAllByText(/Test Book/)
      expect(bookElements.length).toBeGreaterThan(0)
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    })
  })

  it('should query books from SDK', async () => {
    render(
      <OutlineView
        projectId="test-project"
        bobbinId="manuscript"
        viewId="outline"
        sdk={mockSDK}
      />
    )

    await waitFor(() => {
      expect(mockSDK.entities.query).toHaveBeenCalledWith({
        collection: 'books',
        sort: [{ field: 'order', direction: 'asc' }]
      })
    })
  })

  it('should display empty state when no books', async () => {
    const emptySDK = createMockSDK()
    ;(emptySDK.entities.query as jest.Mock).mockResolvedValue({ data: [], total: 0 })

    render(
      <OutlineView
        projectId="test-project"
        bobbinId="manuscript"
        viewId="outline"
        sdk={emptySDK}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    })

    // Should show empty state or create prompt
    const text = screen.getByText(/(no books|create|empty)/i)
    expect(text).toBeInTheDocument()
  })

  it('should handle SDK errors gracefully', async () => {
    const errorSDK = createMockSDK()
    ;(errorSDK.entities.query as jest.Mock).mockRejectedValue(new Error('Network error'))

    // Suppress console.error for this test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    render(
      <OutlineView
        projectId="test-project"
        bobbinId="manuscript"
        viewId="outline"
        sdk={errorSDK}
      />
    )

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled()
    })

    consoleSpy.mockRestore()
  })
})
