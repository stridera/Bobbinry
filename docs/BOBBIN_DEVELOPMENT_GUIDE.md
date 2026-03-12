# Bobbin Development Guide

This is the source of truth for building bobbins in this repo.

The current model is simple:

- Bobbins are native React/TypeScript packages checked into `bobbins/<id>/`
- Every bobbin is reviewed through a PR before it ships
- `bobbins/<id>/manifest.yaml` is the only canonical manifest path
- Panels, views, actions, and external access must follow the same baseline so new bobbins are good examples by default

## What a Bobbin Is

A bobbin is a reviewed package that extends the shell with one or more of:

- data collections
- native views
- shell panels
- custom server actions
- publishing or backup capabilities

Good examples in the repo:

- `entities`, `notes`, `goals`: project-scoped workspace bobbins
- `dictionary-panel`: minimal native right-panel example
- `google-drive-backup`: external backup bobbin with reviewed server actions
- `web-publisher`: publishing bobbin with multiple panels and custom actions

## Required Layout

Every bobbin should use this shape:

```text
bobbins/my-bobbin/
├── manifest.yaml
├── package.json
├── tsconfig.json
├── src/
│   ├── views/
│   └── panels/
└── actions/
    └── index.ts
```

Notes:

- `actions/index.ts` is only needed when the manifest declares custom actions
- `src/views/*` and `src/panels/*` should use kebab-case file names
- contribution entries in the manifest point to `views/...` or `panels/...` without file extensions
- do not add root-level `bobbins/<id>.manifest.yaml` files

## Manifest Rules

Every manifest must include:

- `id`, `name`, `version`, `author`, `description`, `tags`, `license`
- `capabilities`
- `compatibility.minShellVersion`

Use `custom` actions only for server-executed handlers. If an action is purely local UI state, do not model it as a custom server action.

```yaml
id: my-bobbin
name: My Bobbin
version: 1.0.0
author: Bobbins Core
description: Example bobbin
tags: [example]
license: MIT

capabilities:
  customViews: true
  external: false

extensions:
  contributions:
    - slot: shell.rightPanel
      type: panel
      id: my-bobbin-summary
      title: "Summary"
      entry: panels/summary

compatibility:
  minShellVersion: 1.0.0
```

## Panels

Panels are the most common bobbin extension surface. They should feel like they belong to the shell.

### Supported Slots

Use these slots intentionally:

- `shell.leftPanel`: navigation, entity trees, section lists
- `shell.rightPanel`: inspectors, context-aware tools, lightweight detail panels
- `shell.projectBackup`: project backup status and controls
- `shell.publishDashboard`: publishing and analytics surfaces
- `shell.editorFooter`: compact editor-adjacent tools

### Panel Pattern

Every panel should cover the same states:

- loading
- empty
- populated
- error

Every panel should also have:

- a clear title
- one primary action at most
- compact spacing
- light and dark theme support

Use the shared SDK primitives for new panel work:

- `PanelFrame` for the outer container
- `PanelBody` for the scrollable content region
- `PanelLoadingState`, `PanelEmptyState`, and `PanelMessage` for standard states
- `PanelSectionTitle`, `PanelCard`, `PanelPill`, `PanelActionButton`, and `PanelIconButton` for internal structure and controls

Important:

- For `shell.leftPanel` and `shell.rightPanel`, the shell already renders the docked panel title bar from the manifest contribution title.
- Do not add a second full-width bobbin header inside those docked panels.
- Use the panel body for content sections, badges, and inline context instead.
- Reserve `PanelHeader` for inline or standalone surfaces where the shell is not already providing the outer header chrome.

Use existing bobbins as visual references:

- `entities` navigation and preview panels
- `notes` navigation and chapter notes panels
- `goals` progress panel

Avoid:

- hard-coded dark-only styling
- duplicate headers inside docked shell panels
- bespoke sidebars that ignore shell spacing and borders
- custom transport logic inside the panel
- directly mutating unrelated shell state

## Views

Views should use the SDK for project context and entity access.

```tsx
import { useEffect, useState } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

export default function ExampleView({
  sdk,
  projectId,
}: {
  sdk: BobbinrySDK
  projectId: string
}) {
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    sdk.setProject(projectId)
  }, [sdk, projectId])

  useEffect(() => {
    async function load() {
      const result = await sdk.entities.query({ collection: 'items', limit: 50 })
      setItems(result.data)
    }

    load()
  }, [sdk])

  return <div>{items.length} items</div>
}
```

Use the SDK for:

- entity CRUD
- navigation
- shell notifications
- message bus subscriptions

Do not:

- hand-roll `postMessage`
- reach into shell internals from a view
- use raw `dangerouslySetInnerHTML` for content data

## Notifications

There are two supported notification patterns.

### 1. Local UI Feedback

Use inline success/error banners or local toast components inside the panel or view when the feedback is only relevant to the current surface.

Examples:

- `google-drive-backup` panel status messages
- `web-publisher` publish manager result messages

### 2. Shell-Level Toasts

Use the SDK when the user should see feedback outside the current component.

```tsx
await sdk.shell.showNotification('Saved note', 'success')
await sdk.shell.showNotification('Backup failed', 'error')
```

Use shell notifications for:

- save success
- failed actions
- background work completion

Do not use bobbin views to create persistent in-app notification records directly. Persistent notifications are a server/domain concern handled in API jobs and routes.

## Server Actions

Custom server actions are declared in the manifest and implemented in `actions/index.ts`.

Manifest:

```yaml
interactions:
  actions:
    - id: sync_to_drive
      name: Sync to Drive
      type: custom
      handler: syncChapterToDrive
      description: Upload the latest chapter content
```

Action module:

```ts
import type { ActionHandler } from '@bobbinry/action-runtime'

export const syncChapterToDrive: ActionHandler = async (params, context, runtime) => {
  runtime.log.info({ actionId: context.actionId }, 'Running action')
  return { success: true }
}

export const actions = {
  sync_to_drive: syncChapterToDrive,
}
```

Rules:

- every `type: custom` action must declare `handler`
- the handler must exist in `actions/index.ts`
- the API only runs custom actions declared in the installed bobbin manifest
- action handlers receive `ActionContext` and `ActionRuntimeHost`
- do not accept `FastifyInstance` in bobbin action handlers

Current reviewed bobbins may lazily import `apps/api` modules from `actions/index.ts` when they need DB or service access. Keep those imports inside action code only, not in views or panels.

## External Services

If a bobbin talks to third-party services:

1. set `capabilities.external: true`
2. declare every endpoint in `external.endpoints`
3. add a user-facing reason in `external.permissions`
4. keep OAuth tokens and secrets on the server side

Example:

```yaml
capabilities:
  external: true

external:
  endpoints:
    - id: drive_files_create
      url: https://www.googleapis.com/drive/v3/files
      method: POST
      description: Create or upload Google Drive files
  permissions:
    - endpoint: googleapis.com/drive
      reason: Sync chapters to Google Drive folders
      required: true
```

Do not:

- hard-code undeclared third-party URLs in bobbin code
- put access tokens in panel state unless the API explicitly returned a safe short-lived token
- render untrusted HTML from external services without sanitizing it first

## Theming and UX

All bobbins must support the shell’s light and dark themes.

Baseline expectations:

- `bg-white dark:bg-gray-900`
- `text-gray-900 dark:text-gray-100`
- `border-gray-200 dark:border-gray-700`
- hover and focus states in both themes
- clear empty/loading/error handling

Use shared shell spacing and panel density. Do not create a totally different visual language unless the bobbin is intentionally a full-screen product surface.

## Developer Checklist

Before opening a PR, make sure:

- `manifest.yaml` is in `bobbins/<id>/manifest.yaml`
- manifest version is bumped if the manifest changed
- panel IDs are namespaced and entries resolve to real files
- custom actions declare handlers and those handlers exist
- external URLs are declared in the manifest
- light/dark states both work
- loading, empty, and error states exist
- `bun run lint:bobbins` passes

Recommended verification:

```bash
bun run lint:bobbins
bun --cwd packages/compiler test -- manifest-validation
bun --cwd apps/shell typecheck
bun --cwd apps/api typecheck
```

## What to Copy

If you are creating a new bobbin, start from the closest real example:

- navigation and side-panel chrome: `entities`, `notes`
- compact dashboard/status panel: `goals`, `dictionary-panel`
- external integration and server actions: `google-drive-backup`
- multi-panel publishing workflow: `web-publisher`

If an example and this guide disagree, update the example or update this guide in the same PR. The guide should stay aligned with shipped bobbins.
