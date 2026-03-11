# Bobbin Development Guide

A comprehensive guide for building bobbins for the Bobbinry platform.

## Table of Contents
1. [Bobbin Types](#bobbin-types)
2. [Quick Start](#quick-start)
3. [Manifest Structure](#manifest-structure)
4. [Theming Best Practices](#theming-best-practices)
5. [Message Bus Communication](#message-bus-communication)
6. [Entity Data Access](#entity-data-access)
7. [View Development](#view-development)
8. [Testing](#testing)

## Bobbin Types

Bobbins fall into four categories based on their purpose:

### Workspace Bobbins
Add tools to the writing environment. These are project-scoped and installed per-project.

Examples: `manuscript`, `entities`, `notes`, `corkboard`, `timeline`, `goals`

### Publisher Bobbins
Distribute content to readers. Use `capabilities.publishable: true`.

Examples: `web-publisher`, `smart-publisher`

### Backup Bobbins
Sync project content to external storage. Use `capabilities.backup: true`. Installed per-user (not per-project) — once connected, all projects are backed up by default. Users can opt individual projects out. Contribute panels to the `shell.projectBackup` slot.

Examples: `google-drive-backup`

```yaml
# Minimal backup bobbin manifest
id: my-backup
name: My Backup Service
version: 1.0.0
author: Your Name
description: Back up projects to My Service

capabilities:
  external: true
  backup: true
  customViews: true

external:
  endpoints:
    - id: backup-api
      url: https://api.example.com/v1/backups
      method: POST
      description: Upload project backup snapshots
  permissions:
    - endpoint: api.example.com/v1
      reason: Send encrypted project backups to the configured storage provider
      required: true

extensions:
  contributions:
    - slot: shell.projectBackup
      type: panel
      id: status-panel
      title: "My Backup"
      entry: panels/status
```

### Reader Bobbins
Enhance the reading experience. Installed per-user via reader-bobbins settings. Use `capabilities.readerBobbinType`.

Examples: text-to-speech, translation, annotations

## Quick Start

### Project Structure

```
bobbins/my-bobbin/
├── manifest.yaml           # Bobbin configuration
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── src/
│   ├── index.ts          # Entry point (for native views)
│   ├── views/            # Native React views
│   │   └── my-view.tsx
│   └── panels/           # Native React panels
│       └── my-panel.tsx
└── dist/                 # Compiled output
```

### Execution Modes

Current bobbins run in native mode:
- Views are React components rendered directly in the shell
- Full access to shell's React context (theme, extensions, etc.)
- Type-safe with TypeScript
- Faster performance

## Manifest Structure

```yaml
id: my-bobbin
name: My Bobbin
version: 1.0.0
author: Your Name
description: What this bobbin does
capabilities:
  customViews: true        # Can define custom views

# If you enable capabilities.external: true, you must also add:
# external:
#   endpoints: [...]
#   permissions: [...]

data:
  collections:
    - name: MyEntity
      fields:
        - { name: title, type: text, required: true }
        - { name: content, type: markdown }

ui:
  views:
    - id: my-view
      name: My View
      type: editor
      source: MyEntity
```

## Theming Best Practices

### For Native React Views

Always use Tailwind classes with dark mode variants:

```tsx
import { useTheme } from '@/contexts/ThemeContext'

export default function MyView() {
  const { theme } = useTheme()

  return (
    <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-700 p-4">
        <h1 className="text-xl font-semibold">My View</h1>
      </header>

      <button className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600">
        Action
      </button>
    </div>
  )
}
```

**Common Pattern:**
```tsx
// Backgrounds
className="bg-white dark:bg-gray-900"
className="bg-gray-50 dark:bg-gray-800"

// Text
className="text-gray-900 dark:text-gray-100"
className="text-gray-600 dark:text-gray-400"

// Borders
className="border-gray-200 dark:border-gray-700"
className="border-gray-300 dark:border-gray-600"

// Interactive elements
className="hover:bg-gray-100 dark:hover:bg-gray-700"
className="bg-blue-600 dark:bg-blue-700"
```

### External Access Rules

If a bobbin calls third-party services:

1. Set `capabilities.external: true`
2. Declare every host under `external.endpoints`
3. Add a user-facing reason for each permission under `external.permissions`
4. Prefer server/API routes for sensitive tokens and OAuth flows

## Message Bus Communication

The shell exposes shared native event patterns for bobbin-to-bobbin communication.

### Sending Messages (Native Views)

```tsx
window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
  detail: {
    entityType: 'content',
    entityId: 'scene-123',
    bobbinId: 'my-bobbin',
    metadata: { view: 'editor' }
  }
}))
```

### Receiving Messages

```tsx
import { useMessageBus } from '@bobbinry/sdk'

useMessageBus('manuscript.editor.selection.v1', (message) => {
  const text = message.data?.text
  if (text) {
    updateDisplay(text)
  }
})
```

### Common Events

- `bobbinry:navigate` - Route to a new entity/view
- `bobbinry:view-context-change` - Active view context changed
- `bobbinry:entity-updated` - Entity metadata changed in-place
- `manuscript.editor.selection.v1` - Editor selection changed

## Entity Data Access

Use the SDK's EntityAPI for CRUD operations:

```tsx
import type { BobbinrySDK } from '@bobbinry/sdk'

export default function MyView({ sdk, projectId }: { sdk: BobbinrySDK; projectId: string }) {
  const [items, setItems] = useState([])

  // Set project context
  useEffect(() => {
    sdk.setProject(projectId)
  }, [projectId])

  // Query entities
  useEffect(() => {
    async function loadItems() {
      const result = await sdk.entities.query({
        collection: 'my_entities',
        limit: 50,
        sort: [{ field: 'created_at', direction: 'desc' }]
      })
      setItems(result.data)
    }
    loadItems()
  }, [])

  // Create entity
  const createItem = async (data) => {
    const newItem = await sdk.entities.create('my_entities', {
      title: data.title,
      content: data.content
    })
    setItems([...items, newItem])
  }

  // Update entity
  const updateItem = async (id, data) => {
    const updated = await sdk.entities.update('my_entities', id, data)
    setItems(items.map(item => item.id === id ? updated : item))
  }

  // Delete entity
  const deleteItem = async (id) => {
    await sdk.entities.delete('my_entities', id)
    setItems(items.filter(item => item.id !== id))
  }

  return <div>...</div>
}
```

## View Development

### Native React View Template

```tsx
import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface MyViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
}

export default function MyView({ sdk, projectId, entityId }: MyViewProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => {
    sdk.setProject(projectId)
    loadData()
  }, [projectId, entityId])

  async function loadData() {
    try {
      if (entityId) {
        const entity = await sdk.entities.get('my_collection', entityId)
        setData(entity)
      }
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-5 text-center">Loading...</div>
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-700 p-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          My View
        </h1>
      </header>

      <main className="flex-1 overflow-auto p-4">
        {/* Your content here */}
      </main>
    </div>
  )
}
```

### Native Panel Event Pattern

```tsx
import { useMessageBus } from '@bobbinry/sdk'

export default function MyPanel() {
  const { latestMessage } = useMessageBus('manuscript.editor.selection.v1')

  return (
    <section className="p-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        My Panel
      </h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        {latestMessage?.payload?.selectedText || 'Select text in the editor to see updates here.'}
      </p>
    </section>
  )
}
```

## Testing

### Native View Tests

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MyView from '../views/my-view'

describe('MyView', () => {
  it('renders correctly', () => {
    const mockSDK = {
      setProject: vi.fn(),
      entities: {
        query: vi.fn().mockResolvedValue({ data: [], total: 0 })
      }
    }

    render(
      <MyView
        sdk={mockSDK}
        projectId="test-project"
        bobbinId="my-bobbin"
        viewId="my-view"
      />
    )

    expect(screen.getByText('My View')).toBeInTheDocument()
  })
})
```

## Reference Implementations

- **Manuscript Bobbin** (`bobbins/manuscript/`) - Complex native views with editor and outline
- **Dictionary Panel** (`bobbins/dictionary-panel/`) - Simple native panel consuming editor selection events

## Best Practices

1. **Always handle both light and dark themes** - Use Tailwind dark: variants or CSS variables
2. **Use TypeScript** - Provides better DX and catches errors early
3. **Follow the message format** - Include source, target, and type in all messages
4. **Handle loading states** - Show feedback while data is loading
5. **Clean up listeners** - Remove event listeners when components unmount
6. **Test your views** - Write unit tests for critical functionality
7. **Document your manifest** - Add comments explaining custom fields
8. **Use semantic versioning** - Follow semver for bobbin versions

## Common Pitfalls

- ❌ Forgetting to call `sdk.setProject()` before entity operations
- ❌ Recreating transport or event plumbing instead of using the SDK hooks
- ❌ Reimplementing message transport instead of using `useMessageBus` or `bobbinry:*` events
- ❌ Using inline styles instead of Tailwind classes
- ❌ Not cleaning up event listeners
- ❌ Hardcoding light-mode colors

## Getting Help

- Check existing bobbins for examples
- Read the architecture docs in `docs/`
- Ask questions in GitHub issues
