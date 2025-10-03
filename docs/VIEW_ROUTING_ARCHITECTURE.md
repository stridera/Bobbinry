# View Routing Architecture

## Overview

The Bobbinry shell provides a unified navigation and view-switching system that allows users to install and choose between different views for the same type of content. This enables a pluggable, flexible UI where users can customize their experience.

## Core Concepts

### 1. Entity Types
Entities are the fundamental data types that views operate on:
- `book` - Top-level manuscript container
- `chapter` - Collection of scenes
- `scene` - Individual writing unit
- `character` - Character entity (from other bobbins)
- `location` - Location entity
- `collection` - Generic folder/container
- `document` - Generic editable document

### 2. View Types
Views are UI components that display and edit entities:
- `outline` - Hierarchical tree/list view (chapters, scenes)
- `editor` - Rich text editor for writing
- `board` - Corkboard/kanban style view
- `sheet` - Form-based detail view (character sheets)
- `timeline` - Chronological view
- `map` - Spatial/geographic view

### 3. View Handlers
Each view declares which entity types it can handle:

```yaml
# manuscript.manifest.yaml
ui:
  views:
    - id: outline
      type: outline
      handlers:
        - book        # Can display book structure
        - chapter     # Can display chapter with scenes

    - id: editor
      type: editor
      handlers:
        - scene       # Can edit individual scenes
```

## Navigation Flow

### Current Implementation (Phase 0)
```
Navigation Panel → Event → Editor View
```

### Target Implementation (Phase 1)
```
Navigation Panel
  ↓ (emits entity event)
View Router
  ↓ (selects appropriate view)
Main Content Area
  ↓ (renders selected view)
Outline View OR Editor View OR Character Sheet
```

## Architecture Components

### 1. Navigation Event System

Navigation panel emits events with entity context:

```typescript
interface NavigationEvent {
  entityType: 'scene' | 'chapter' | 'book' | 'character' | string
  entityId: string
  bobbinId: string
  metadata?: {
    title?: string
    parentId?: string
  }
}

window.dispatchEvent(
  new CustomEvent('bobbinry:navigate', {
    detail: navigationEvent
  })
)
```

### 2. View Registry Enhancement

Extend view registry to track entity handlers:

```typescript
interface ViewRegistration {
  viewId: string
  bobbinId: string
  type: 'outline' | 'editor' | 'board' | 'sheet'
  handlers: string[]  // Entity types this view can handle
  priority?: number   // For default selection
  component: React.ComponentType<ViewProps>
  // ... existing fields
}

interface ViewProps {
  projectId: string
  entityType: string
  entityId: string
  sdk: BobbinrySDK
}
```

### 3. View Router

New component to handle view selection:

```typescript
interface ViewRouterProps {
  projectId: string
  entityType: string
  entityId: string
  sdk: BobbinrySDK
}

function ViewRouter({ projectId, entityType, entityId, sdk }: ViewRouterProps) {
  // 1. Find all views that handle this entity type
  const compatibleViews = viewRegistry.getViewsByHandler(entityType)

  // 2. Check user preferences
  const preferredViewId = userPreferences.get(`view.${entityType}`)

  // 3. Select view (preference > first available)
  const selectedView = compatibleViews.find(v => v.viewId === preferredViewId)
    || compatibleViews[0]

  // 4. Render selected view
  const Component = selectedView.component
  return <Component projectId={projectId} entityType={entityType} entityId={entityId} sdk={sdk} />
}
```

### 4. User Preferences

Store user's preferred view per entity type:

```typescript
interface ViewPreferences {
  [entityType: string]: string  // entity type → viewId
}

// Example:
{
  'scene': 'manuscript.editor',
  'chapter': 'manuscript.outline',
  'book': 'corkboard.board',
  'character': 'characters.sheet'
}
```

## Implementation Phases

### Phase 1: Basic Routing ✅ Starting Now
**Goal**: Route navigation events to appropriate view

**Changes**:
1. Update navigation panel to emit entity-based events
2. Create ViewRouter component
3. Update project page to use ViewRouter
4. Modify views to accept entity context props
5. Add handler declarations to manuscript manifest

**Files to modify**:
- `bobbins/manuscript/src/panels/navigation.tsx` - Emit entity events
- `apps/shell/src/components/ViewRouter.tsx` - NEW
- `apps/shell/src/app/projects/[projectId]/page.tsx` - Use ViewRouter
- `bobbins/manuscript/src/views/outline.tsx` - Accept entity context
- `bobbins/manuscript/src/views/editor.tsx` - Accept entity context
- `bobbins/manuscript/manifest.yaml` - Add handlers
- `apps/shell/src/lib/view-registry.ts` - Track handlers

### Phase 2: Multiple View Options (Future)
**Goal**: Allow multiple views per entity type with user selection

**Changes**:
1. View switcher UI (tabs/dropdown in main area)
2. Settings page for view preferences
3. Preference storage (localStorage or DB)
4. Default view hints in manifest

### Phase 3: Advanced Features (Future)
**Goal**: Smart defaults and compatibility

**Changes**:
1. View capability checking (read-only vs editable)
2. Context-aware view suggestions
3. Quick-switch keyboard shortcuts
4. View history/breadcrumbs

## Example Use Cases

### Use Case 1: Default Manuscript Workflow
```
1. User clicks "Chapter 1" in navigation
2. Event: { entityType: 'chapter', entityId: 'ch-123' }
3. Router finds: manuscript.outline (handles 'chapter')
4. Renders outline view showing scenes in Chapter 1
5. User clicks "Scene 2" in outline
6. Event: { entityType: 'scene', entityId: 'sc-456' }
7. Router finds: manuscript.editor (handles 'scene')
8. Renders editor view for Scene 2
```

### Use Case 2: Alternative Outline Bobbin
```
1. User installs "corkboard" bobbin
2. Corkboard declares: handlers: ['book', 'chapter']
3. User sets preference: chapter → corkboard.board
4. User clicks "Chapter 1"
5. Router finds: manuscript.outline, corkboard.board (both handle 'chapter')
6. Router checks preference → corkboard.board
7. Renders corkboard view instead of outline
```

### Use Case 3: Character Navigation
```
1. User installs "characters" bobbin
2. Characters bobbin adds panel contribution to shell.leftPanel
3. Navigation panel shows:
   📚 Manuscript
     📑 Chapter 1
   👤 Characters
     Alice
     Bob
4. User clicks "Alice"
5. Event: { entityType: 'character', entityId: 'char-789', bobbinId: 'characters' }
6. Router finds: characters.sheet (handles 'character')
7. Renders character sheet for Alice
```

## Manifest Schema Updates

### Add `handlers` to view definitions

```yaml
ui:
  views:
    - id: outline
      name: "Outline View"
      type: outline
      source: views/outline
      handlers:        # NEW: Entity types this view handles
        - book
        - chapter
      priority: 10     # NEW: Higher = preferred default

    - id: editor
      name: "Scene Editor"
      type: editor
      source: views/editor
      handlers:
        - scene
        - document
      capabilities:    # NEW: What the view can do
        - read
        - write
        - autosave
```

## Technical Notes

### Event Names
- Old: `manuscript:navigate-to-scene` (bobbin-specific)
- New: `bobbinry:navigate` (universal)

### Backward Compatibility
Phase 1 should maintain backward compatibility:
- Keep old event names working
- Emit both old and new events during transition
- Views can still use hardcoded scene selection

### View Communication
Views should NOT directly communicate. Instead:
- Navigation events are the single source of truth
- Views update URL/history for deep linking (future)
- SDK provides data access layer

## Open Questions

1. **URL Routing**: Should navigation state be in URL?
   - Pros: Deep linking, browser back/forward
   - Cons: Complexity, SSR considerations

2. **View State Persistence**: How to handle unsaved changes when switching?
   - Auto-save before switch?
   - Confirmation dialog?
   - Keep state in background?

3. **Multi-Pane Views**: Support side-by-side views?
   - Example: Outline + Editor split view
   - Requires layout management system

4. **View Discovery**: How do users find alternative views?
   - Marketplace tags?
   - "Try different view" button?
   - Settings page with previews?
