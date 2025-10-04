/**
 * =============================================================================
 * HELLO WORLD TUTORIAL BOBBIN - Main View
 * =============================================================================
 *
 * This is a complete tutorial for building Bobbinry views with best practices.
 *
 * KEY CONCEPTS DEMONSTRATED:
 *
 * 1. **Theme-Aware Styling**
 *    - Using Tailwind's dark mode with light/dark color pairs
 *    - Example: "bg-white dark:bg-gray-900" (white in light, dark gray in dark)
 *    - Always provide both light and dark variants for colors
 *
 * 2. **SDK Integration**
 *    - Using the Bobbinry SDK hooks for data operations
 *    - CRUD operations made simple with useEntityList, useCreateEntity
 *    - Automatic loading states and error handling
 *
 * 3. **Entity Management**
 *    - Entities are stored in collections defined in manifest.yaml
 *    - SDK hooks handle fetching, creating, updating, deleting
 *    - Auto-refetch after mutations for fresh data
 *
 * 4. **TypeScript Types**
 *    - Define interfaces for your data structures
 *    - Use the BobbinrySDK type from '@bobbinry/sdk'
 *    - Type your props interface for better IDE support
 *
 * 5. **Loading States**
 *    - SDK hooks provide loading/error states automatically
 *    - Always show loading indicators for async operations
 *
 * =============================================================================
 */

import { useState } from 'react'
import { useEntityList, useCreateEntity } from '@bobbinry/sdk'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { Card } from '@bobbinry/ui-components'

/**
 * Props interface for the view component
 *
 * The Bobbinry shell passes these props to all views:
 * - projectId: Current project context (required for all SDK calls)
 * - bobbinId: ID of this bobbin instance
 * - viewId: ID of this specific view
 * - sdk: The Bobbinry SDK instance for data operations
 * - entityType: (Optional) Type of entity being viewed
 * - entityId: (Optional) Specific entity ID being viewed
 * - metadata: (Optional) Additional context from the shell
 */
interface HelloWorldViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
}

/**
 * Item type definition
 *
 * This matches the "items" collection in manifest.yaml
 * Define all fields your entity can have, mark optional ones with "?"
 */
interface Item {
  id: string
  title: string
  description?: string
  status?: string
}

/**
 * =============================================================================
 * MAIN VIEW COMPONENT
 * =============================================================================
 */
export default function HelloWorldView({ sdk, projectId }: HelloWorldViewProps) {
  // ===== STATE MANAGEMENT =====
  const [newTitle, setNewTitle] = useState('')

  // ===== SDK HOOKS =====
  // Use SDK hooks for simplified data management
  const { data: items, loading, refetch } = useEntityList<Item>(sdk, {
    collection: 'items',
    limit: 100,
    sort: [{ field: 'created_at', direction: 'desc' }]
  })

  const { create, creating } = useCreateEntity<Item>(sdk, 'items', {
    onSuccess: () => {
      setNewTitle('')
      refetch()
    }
  })

  /**
   * Create a new item using SDK hook
   */
  async function createItem() {
    if (!newTitle.trim()) return

    await create({
      title: newTitle,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  }

  // ===== LOADING STATE =====
  if (loading) {
    return (
      <div className="p-5 text-center text-gray-600 dark:text-gray-400">
        Loading...
      </div>
    )
  }

  // ===== MAIN UI =====
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/*
        HEADER SECTION
        - Fixed height header with title
        - Uses theme-aware colors: gray-900 (light) / gray-100 (dark)
        - Border bottom for visual separation
      */}
      <header className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Items
        </h1>
      </header>

      {/*
        CREATE FORM SECTION
        - Input + button for creating new items
        - Keyboard shortcut: Press Enter to create
        - Theme-aware form controls

        THEME PATTERN:
        Input: bg-white dark:bg-gray-700 (white -> dark gray)
        Text: text-gray-900 dark:text-gray-100 (dark -> light)
        Placeholder: placeholder-gray-500 dark:placeholder-gray-400
        Border: border-gray-300 dark:border-gray-600
      */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createItem()}
            placeholder="New item title..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
          />
          <button
            onClick={createItem}
            disabled={creating}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {/*
        ITEMS LIST SECTION
        - Scrollable content area (flex-1 overflow-auto)
        - Empty state when no items exist
        - Card-style item display

        ACCESSIBILITY:
        - Use semantic HTML (main, key props)
        - Provide empty states with helpful messages
        - Use adequate contrast ratios for text
      */}
      <main className="flex-1 overflow-auto p-4">
        {items.length === 0 ? (
          // Empty state - encourage user to take action
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            No items yet. Create one above!
          </div>
        ) : (
          // Items grid with spacing
          <div className="space-y-2">
            {items.map((item) => (
              <Card
                key={item.id}
                title={item.title}
                subtitle={item.description}
                hover
              >
                {/* Optional status badge */}
                {item.status && (
                  <span className="inline-block px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                    {item.status}
                  </span>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

/**
 * =============================================================================
 * NEXT STEPS & ENHANCEMENTS
 * =============================================================================
 *
 * This tutorial covers the basics. Here are ideas to extend this bobbin:
 *
 * 1. **Use UI Components Library**
 *    import { Button, Input, Card } from '@bobbinry/ui-components'
 *    Replace custom styled elements with pre-built components
 *
 * 2. **Add Edit/Delete Functionality**
 *    - Show edit form inline or in modal
 *    - Use useUpdateEntity(sdk, 'items') hook
 *    - Use useDeleteEntity(sdk, 'items') hook
 *
 * 3. **Add Message Bus Communication**
 *    import { useMessageBus } from '@bobbinry/sdk'
 *    Listen for events from other bobbins
 *    Broadcast events when items are created/updated
 *
 * 4. **Implement Search & Filtering**
 *    import { useDebounce } from '@bobbinry/sdk'
 *    Add search input with debounced query
 *
 * 5. **Add Error Handling**
 *    - Show toast notifications for errors
 *    - Use onError callbacks in SDK hooks
 *
 * =============================================================================
 *
 * For more information:
 * - Read the Bobbin Development Guide in docs/BOBBIN_DEVELOPMENT_GUIDE.md
 * - Check out the @bobbinry/ui-components package for ready-to-use components
 * - Explore the SDK documentation for advanced patterns
 *
 * =============================================================================
 */
