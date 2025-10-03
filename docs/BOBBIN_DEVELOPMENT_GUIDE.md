# Bobbin Development Guide

A comprehensive guide for building bobbins for the Bobbinry platform.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Manifest Structure](#manifest-structure)
3. [Theming Best Practices](#theming-best-practices)
4. [Message Bus Communication](#message-bus-communication)
5. [Entity Data Access](#entity-data-access)
6. [View Development](#view-development)
7. [Testing](#testing)

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
    └── views/            # Sandboxed HTML/JS views
        └── my-view.html
```

### Execution Modes

Bobbins can run in two modes:

**Native Mode** (Recommended for complex UIs):
- Views are React components rendered directly in the shell
- Full access to shell's React context (theme, extensions, etc.)
- Type-safe with TypeScript
- Faster performance

**Sandboxed Mode** (For simple panels or security isolation):
- Views are HTML/JS loaded in iframes
- Isolated from shell
- Communication via postMessage
- Good for simple panels or untrusted code

## Manifest Structure

```yaml
id: my-bobbin
name: My Bobbin
version: 1.0.0
author: Your Name
description: What this bobbin does
capabilities:
  customViews: true        # Can define custom views
execution:
  mode: native             # or 'sandboxed'
  signature: dev_mode_skip

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

### For Sandboxed HTML Views

Use CSS variables that respond to theme messages:

```css
/* style.css */
body.light {
  --bg-primary: #ffffff;
  --bg-secondary: #f3f4f6;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --border-color: #e5e7eb;
}

body.dark {
  --bg-primary: #0b0b0c;
  --bg-secondary: #1a1a1b;
  --text-primary: #e7e7ea;
  --text-secondary: #9a9aa1;
  --border-color: #2a2a2e;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: background-color 0.2s, color 0.2s;
}
```

```javascript
// view.js
// Set initial theme
document.body.classList.add('light')

// Listen for theme changes from shell
window.addEventListener('message', (event) => {
  if (event.data.type === 'shell:theme') {
    document.body.classList.remove('light', 'dark')
    document.body.classList.add(event.data.theme)
  }
})
```

## Message Bus Communication

The message bus allows views and panels to communicate.

### Message Format

All messages follow this structure:

```typescript
interface Message {
  type: string        // Message type (e.g., 'bus:event', 'shell:theme')
  source: string      // Sender ID (e.g., 'manuscript.editor')
  target: string      // Recipient ID or '*' for broadcast
  topic?: string      // Optional topic for bus events
  payload?: any       // Message data
}
```

### Sending Messages (Native Views)

```tsx
import type { BobbinrySDK } from '@bobbinry/sdk'

export default function EditorView({ sdk }: { sdk: BobbinrySDK }) {
  const handleSelection = (text: string) => {
    // Broadcast a selection event
    window.postMessage({
      type: 'bus:event',
      source: 'my-bobbin.editor',
      target: '*',
      topic: 'my-bobbin.selection.v1',
      payload: { text, length: text.length }
    }, '*')
  }

  return <div>...</div>
}
```

### Receiving Messages (Sandboxed Views)

```javascript
window.addEventListener('message', (event) => {
  const msg = event.data

  // Handle theme changes
  if (msg.type === 'shell:theme') {
    applyTheme(msg.theme)
    return
  }

  // Handle bus events
  if (msg.type === 'bus:event' && msg.topic === 'my-bobbin.selection.v1') {
    const { text, length } = msg.payload
    updateDisplay(text)
  }
})
```

### Common Message Types

- `shell:theme` - Theme changed (light/dark)
- `bus:event` - Generic event with topic
- `view:ready` - View finished loading
- `entity:updated` - Entity was modified
- `entity:created` - Entity was created
- `entity:deleted` - Entity was deleted

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

### Sandboxed HTML View Template

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>My View</title>
  <link rel="stylesheet" href="style.css">
</head>
<body class="light">
  <header>
    <h1>My Panel</h1>
  </header>
  <main id="content">
    <p id="status">Ready</p>
  </main>

  <script type="module">
    // Initialize theme
    document.body.classList.add('light')

    // Listen for messages
    window.addEventListener('message', (event) => {
      const msg = event.data

      // Handle theme
      if (msg.type === 'shell:theme') {
        document.body.classList.remove('light', 'dark')
        document.body.classList.add(msg.theme)
        return
      }

      // Handle events
      if (msg.type === 'bus:event') {
        handleEvent(msg.topic, msg.payload)
      }
    })

    function handleEvent(topic, payload) {
      const status = document.getElementById('status')
      status.textContent = `Received: ${topic}`
    }

    // Announce ready
    parent.postMessage({
      type: 'view:ready',
      id: 'my-bobbin.my-view'
    }, '*')
  </script>
</body>
</html>
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
- **Dictionary Panel** (`bobbins/dictionary-panel/`) - Simple sandboxed HTML panel
- **Debugger** (`bobbins/debugger/`) - Sandboxed panel with message bus integration

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
- ❌ Not handling theme changes in sandboxed views
- ❌ Missing `source` and `target` fields in messages
- ❌ Using inline styles instead of Tailwind classes
- ❌ Not cleaning up event listeners
- ❌ Hardcoding light-mode colors

## Getting Help

- Check existing bobbins for examples
- Read the architecture docs in `docs/`
- Ask questions in GitHub issues
