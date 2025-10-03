# @bobbinry/ui-components

Theme-aware React UI components for building Bobbinry bobbins.

## Features

- ✅ Full light/dark theme support
- ✅ TypeScript definitions included
- ✅ Consistent design system
- ✅ Accessible components
- ✅ Minimal dependencies (only React)

## Installation

```bash
pnpm add @bobbinry/ui-components
```

## Components

### Core Components

#### Button

A versatile button component with multiple variants and sizes.

```tsx
import { Button } from '@bobbinry/ui-components'

<Button variant="primary" onClick={handleClick}>
  Save
</Button>

<Button variant="secondary" size="sm">
  Cancel
</Button>

<Button variant="danger" loading={isDeleting}>
  Delete
</Button>
```

**Props:**
- `variant`: 'primary' | 'secondary' | 'danger' | 'ghost'
- `size`: 'sm' | 'md' | 'lg'
- `fullWidth`: boolean
- `loading`: boolean
- All standard button HTML attributes

### Input

Form input with label, error, and helper text support.

```tsx
import { Input } from '@bobbinry/ui-components'

<Input
  label="Email"
  type="email"
  placeholder="you@example.com"
  error={errors.email}
  fullWidth
/>

<Input
  label="Username"
  helperText="Choose a unique username"
/>
```

**Props:**
- `label`: string
- `error`: string
- `helperText`: string
- `fullWidth`: boolean
- All standard input HTML attributes

### Card

Container component for grouping content.

```tsx
import { Card } from '@bobbinry/ui-components'

<Card
  title="My Item"
  subtitle="Description here"
  headerActions={<Button size="sm">Edit</Button>}
>
  <p>Card content goes here</p>
</Card>

<Card hover onClick={() => console.log('clicked')}>
  <p>Clickable card</p>
</Card>
```

**Props:**
- `title`: string
- `subtitle`: string
- `headerActions`: ReactNode
- `onClick`: () => void
- `hover`: boolean
- `className`: string

#### Panel

Sidebar panel component with optional collapse.

```tsx
import { Panel } from '@bobbinry/ui-components'

<Panel title="Statistics">
  <div>Panel content</div>
</Panel>

<Panel
  title="Options"
  collapsible
  defaultCollapsed
>
  <div>Collapsible content</div>
</Panel>
```

**Props:**
- `title`: string
- `collapsible`: boolean
- `defaultCollapsed`: boolean
- `className`: string

### Form Components

#### Select

Dropdown select component with theme support.

```tsx
import { Select } from '@bobbinry/ui-components'

<Select
  label="Status"
  options={[
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'archived', label: 'Archived', disabled: true }
  ]}
  placeholder="Choose status..."
  fullWidth
/>
```

**Props:**
- `label`: string
- `error`: string
- `helperText`: string
- `fullWidth`: boolean
- `options`: SelectOption[] (array of { value, label, disabled? })
- `placeholder`: string
- All standard select HTML attributes

#### Textarea

Multi-line text input with auto-resize option.

```tsx
import { Textarea } from '@bobbinry/ui-components'

<Textarea
  label="Description"
  placeholder="Enter description..."
  rows={4}
  autoResize
  fullWidth
/>

<Textarea
  label="Notes"
  helperText="Markdown supported"
  error={errors.notes}
/>
```

**Props:**
- `label`: string
- `error`: string
- `helperText`: string
- `fullWidth`: boolean
- `autoResize`: boolean - Auto-grows with content
- All standard textarea HTML attributes

### Feedback Components

#### Badge

Status badge for labels and indicators.

```tsx
import { Badge } from '@bobbinry/ui-components'

<Badge variant="success">Active</Badge>
<Badge variant="danger" size="sm">Error</Badge>
<Badge variant="warning" dot>3 pending</Badge>
```

**Props:**
- `variant`: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
- `size`: 'sm' | 'md' | 'lg'
- `dot`: boolean - Show dot indicator
- `className`: string

#### Toast

Notification toast with auto-dismiss.

```tsx
import { Toast, ToastContainer } from '@bobbinry/ui-components'

function MyView() {
  const [toast, setToast] = useState<string | null>(null)

  return (
    <>
      <button onClick={() => setToast('Item saved!')}>
        Save
      </button>

      {toast && (
        <ToastContainer position="top-right">
          <Toast
            message={toast}
            variant="success"
            duration={3000}
            onDismiss={() => setToast(null)}
          />
        </ToastContainer>
      )}
    </>
  )
}
```

**Toast Props:**
- `message`: string
- `variant`: 'default' | 'success' | 'warning' | 'danger' | 'info'
- `duration`: number (milliseconds, 0 = no auto-dismiss)
- `onDismiss`: () => void
- `dismissible`: boolean

**ToastContainer Props:**
- `position`: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'
- `className`: string

## Theme Support

All components automatically adapt to light and dark themes using Tailwind CSS classes. They work seamlessly with the Bobbinry shell's theme system.

## Complete Example

```tsx
import {
  Button,
  Input,
  Select,
  Textarea,
  Card,
  Panel,
  Badge,
  Toast,
  ToastContainer
} from '@bobbinry/ui-components'
import { useState } from 'react'

export function MyView() {
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState('')
  const [description, setDescription] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const handleSubmit = () => {
    // Save logic here
    setToast('Item created successfully!')
  }

  return (
    <div className="p-4">
      <Card title="Create Item">
        <div className="space-y-4">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />

          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' }
            ]}
            fullWidth
          />

          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            autoResize
            fullWidth
          />

          <Button variant="primary" onClick={handleSubmit}>
            Create
          </Button>
        </div>
      </Card>

      <Panel title="Recent Items" className="mt-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span>Example Item</span>
            <Badge variant="success">Active</Badge>
          </div>
        </div>
      </Panel>

      {toast && (
        <ToastContainer position="top-right">
          <Toast
            message={toast}
            variant="success"
            duration={3000}
            onDismiss={() => setToast(null)}
          />
        </ToastContainer>
      )}
    </div>
  )
}
```

## License

MIT
