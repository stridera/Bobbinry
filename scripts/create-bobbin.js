#!/usr/bin/env node

/**
 * Bobbin Template Generator
 *
 * Creates a new bobbin with best practices:
 * - Manifest with sensible defaults
 * - Sample React view with theme support
 * - TypeScript configuration
 * - Package.json with dependencies
 * - Basic test setup
 *
 * Usage: node scripts/create-bobbin.js <bobbin-name>
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments
const bobbinName = process.argv[2]

if (!bobbinName) {
  console.error('❌ Error: Please provide a bobbin name')
  console.log('Usage: node scripts/create-bobbin.js <bobbin-name>')
  console.log('Example: node scripts/create-bobbin.js my-bobbin')
  process.exit(1)
}

// Validate bobbin name
if (!/^[a-z][a-z0-9-]*$/.test(bobbinName)) {
  console.error('❌ Error: Bobbin name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens')
  process.exit(1)
}

const bobbinsDir = path.join(__dirname, '..', 'bobbins')
const bobbinDir = path.join(bobbinsDir, bobbinName)

// Check if bobbin already exists
if (fs.existsSync(bobbinDir)) {
  console.error(`❌ Error: Bobbin "${bobbinName}" already exists`)
  process.exit(1)
}

console.log(`\n🎨 Creating bobbin: ${bobbinName}\n`)

// Create directory structure
const dirs = [
  bobbinDir,
  path.join(bobbinDir, 'src'),
  path.join(bobbinDir, 'src', 'views'),
  path.join(bobbinDir, 'src', 'panels'),
  path.join(bobbinDir, 'src', '__tests__'),
]

dirs.forEach(dir => {
  fs.mkdirSync(dir, { recursive: true })
  console.log(`✓ Created ${path.relative(bobbinsDir, dir)}`)
})

// Generate files
const files = generateFiles(bobbinName)

Object.entries(files).forEach(([relativePath, content]) => {
  const filePath = path.join(bobbinDir, relativePath)
  fs.writeFileSync(filePath, content)
  console.log(`✓ Created ${relativePath}`)
})

console.log(`\n✅ Bobbin "${bobbinName}" created successfully!\n`)
console.log('Next steps:')
console.log(`  1. cd bobbins/${bobbinName}`)
console.log(`  2. pnpm install`)
console.log(`  3. pnpm build`)
console.log(`  4. Edit manifest.yaml to define your data model`)
console.log(`  5. Customize src/views/main.tsx for your UI\n`)
console.log(`📚 See docs/BOBBIN_DEVELOPMENT_GUIDE.md for more info\n`)

/**
 * Generate all template files
 */
function generateFiles(name) {
  const pascalName = toPascalCase(name)
  const titleName = toTitleCase(name)

  return {
    'manifest.yaml': generateManifest(name, titleName),
    'package.json': generatePackageJson(name),
    'tsconfig.json': generateTsConfig(),
    'src/index.ts': generateIndex(name),
    'src/views/main.tsx': generateMainView(pascalName),
    'src/panels/sidebar.tsx': generateSidebarPanel(pascalName),
    'src/__tests__/main.test.tsx': generateTest(pascalName),
    'README.md': generateReadme(name, titleName),
  }
}

function generateManifest(id, name) {
  return `id: ${id}
name: ${name}
version: 0.1.0
author: Your Name
description: A new bobbin for Bobbinry
tags: []
license: MIT

capabilities:
  publishable: false
  external: false
  ai: false
  customViews: true

execution:
  mode: native
  signature: dev_mode_skip

data:
  collections:
    - name: Item
      fields:
        - { name: title, type: text, required: true }
        - { name: description, type: text }
        - { name: status, type: text }
        - { name: created_at, type: timestamp }
        - { name: updated_at, type: timestamp }

ui:
  views:
    - id: main
      name: Main View
      type: list
      source: Item
      layout:
        display:
          title: title
          subtitle: description

interactions:
  actions:
    - id: create_item
      name: Create Item
      type: create
      target: Item

compatibility:
  minShellVersion: 1.0.0
  migrations: []
`
}

function generatePackageJson(name) {
  return `{
  "name": "@bobbins/${name}",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest"
  },
  "dependencies": {
    "@bobbinry/sdk": "workspace:*",
    "@bobbinry/types": "workspace:*",
    "@bobbinry/ui-components": "workspace:*",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.6",
    "@types/react-dom": "^19.0.6",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
`
}

function generateTsConfig() {
  return `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
}
`
}

function generateIndex(name) {
  return `/**
 * ${toTitleCase(name)} Bobbin
 *
 * Entry point for native views
 */

// Export all views
export { default as MainView } from './views/main'
export { default as SidebarPanel } from './panels/sidebar'

// Export types if needed
export interface Item {
  id: string
  title: string
  description?: string
  status?: string
  created_at: string
  updated_at: string
}
`
}

function generateMainView(pascalName) {
  return `import { useState } from 'react'
import { useEntityList, useCreateEntity } from '@bobbinry/sdk'
import { Button, Input, Card } from '@bobbinry/ui-components'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface ${pascalName}ViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
}

interface Item {
  id: string
  title: string
  description?: string
  status?: string
}

/**
 * Main view for ${pascalName} bobbin
 * Uses UI components and SDK hooks for cleaner code
 */
export default function ${pascalName}View({ sdk, projectId }: ${pascalName}ViewProps) {
  const [newTitle, setNewTitle] = useState('')

  // Use SDK hooks for data management
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

  async function handleCreate() {
    if (!newTitle.trim()) return

    await create({
      title: newTitle,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  }

  if (loading) {
    return (
      <div className="p-5 text-center text-gray-600 dark:text-gray-400">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-4">
      {/* Create Form using UI Components */}
      <Card title="Create Item" className="mb-4">
        <div className="flex gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New item title..."
            fullWidth
          />
          <Button
            variant="primary"
            onClick={handleCreate}
            loading={creating}
          >
            Create
          </Button>
        </div>
      </Card>

      {/* Items List */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            No items yet. Create one above!
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Card key={item.id}>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {item.title}
                </h3>
                {item.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {item.description}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
`
}

function generateSidebarPanel(pascalName) {
  return `import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface ${pascalName}SidebarProps {
  projectId: string
  bobbinId: string
  slotId: string
  sdk: BobbinrySDK
}

/**
 * Sidebar panel for ${pascalName} bobbin
 * Displays contextual information
 */
export default function ${pascalName}Sidebar({ sdk, projectId }: ${pascalName}SidebarProps) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    sdk.setProject(projectId)
    loadCount()
  }, [projectId])

  async function loadCount() {
    try {
      const result = await sdk.entities.query({
        collection: 'items',
        limit: 1
      })
      setCount(result.total)
    } catch (error) {
      console.error('Failed to load count:', error)
    }
  }

  return (
    <div className="p-4 bg-white dark:bg-gray-800 h-full">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        Statistics
      </h3>
      <div className="space-y-2">
        <div className="p-3 rounded bg-gray-50 dark:bg-gray-700">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {count}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400">
            Total Items
          </div>
        </div>
      </div>
    </div>
  )
}
`
}

function generateTest(pascalName) {
  return `import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ${pascalName}View from '../views/main'

describe('${pascalName}View', () => {
  it('renders loading state initially', () => {
    const mockSDK = {
      setProject: vi.fn(),
      entities: {
        query: vi.fn().mockResolvedValue({ data: [], total: 0 })
      }
    } as any

    render(
      <${pascalName}View
        sdk={mockSDK}
        projectId="test-project"
        bobbinId="test-bobbin"
        viewId="main"
      />
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders empty state when no items', async () => {
    const mockSDK = {
      setProject: vi.fn(),
      entities: {
        query: vi.fn().mockResolvedValue({ data: [], total: 0 })
      }
    } as any

    render(
      <${pascalName}View
        sdk={mockSDK}
        projectId="test-project"
        bobbinId="test-bobbin"
        viewId="main"
      />
    )

    // Wait for loading to complete
    await screen.findByText(/No items yet/i)
    expect(screen.getByText(/No items yet/i)).toBeInTheDocument()
  })
})
`
}

function generateReadme(id, name) {
  return `# ${name} Bobbin

A bobbin for Bobbinry.

## Description

${name} provides [describe what your bobbin does].

## Features

- Create and manage items
- Theme-aware UI (light/dark mode)
- TypeScript support
- Tested with Vitest

## Development

\`\`\`bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test
\`\`\`

## Usage

1. Install the bobbin in a project
2. Access the main view to manage items
3. Use the sidebar panel for quick stats

## Data Model

### Item
- **title** (text, required) - Item title
- **description** (text) - Optional description
- **status** (text) - Item status
- **created_at** (timestamp) - Creation timestamp
- **updated_at** (timestamp) - Last update timestamp

## License

MIT
`
}

// Utility functions
function toPascalCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function toTitleCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
