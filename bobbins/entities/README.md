# Entities Bobbin - Implementation Plan

## Overview

A **reusable, configurable entity bobbin** that allows users to create custom entity types (characters, locations, spells, items, classes, factions, etc.) with:

- **Visual configuration interface** - No YAML editing required
- **Pre-configured templates** - Common entity types ready to use
- **Customizable layouts** - Configure how entities are displayed
- **Universal preview panel** - Context-aware entity lookup
- **Smart disambiguation** - Handle duplicate names gracefully

## Key Features

### 1. Pre-Configured Entity Templates

Users can choose from built-in templates and customize them, or create entirely new entity types from scratch.

#### Available Templates

##### 🧙 Characters Template
```typescript
{
  label: "Characters",
  icon: "🧙",
  description: "People, creatures, or NPCs in your world",
  fields: [
    { name: "age", type: "number", label: "Age" },
    { name: "class", type: "select", label: "Class",
      options: ["Warrior", "Mage", "Rogue", "Cleric", "Ranger"] },
    { name: "level", type: "number", label: "Level", default: 1 },
    { name: "race", type: "text", label: "Race" },
    { name: "alignment", type: "select", label: "Alignment" },
    { name: "stats", type: "json", label: "Stats" },
    { name: "background", type: "rich-text", label: "Background" },
    { name: "abilities", type: "json", label: "Special Abilities" }
  ],
  layout: "compact-card",
  imagePosition: "top-right",
  headerFields: ["name", "age", "class"],
  subtitleFields: ["level", "class"] // For disambiguation
}
```

##### ✨ Spells Template
```typescript
{
  label: "Spells",
  icon: "✨",
  description: "Magical abilities and incantations",
  fields: [
    { name: "spell_level", type: "number", label: "Spell Level", min: 0, max: 9 },
    { name: "school", type: "select", label: "School of Magic",
      options: ["Abjuration", "Conjuration", "Divination", "Enchantment",
                "Evocation", "Illusion", "Necromancy", "Transmutation"] },
    { name: "casting_time", type: "text", label: "Casting Time" },
    { name: "range", type: "text", label: "Range" },
    { name: "components", type: "text", label: "Components (V, S, M)" },
    { name: "duration", type: "text", label: "Duration" },
    { name: "classes", type: "multi-select", label: "Available to Classes" },
    { name: "damage_type", type: "select", label: "Damage Type" },
    { name: "save_type", type: "select", label: "Saving Throw" }
  ],
  layout: "list-details",
  imagePosition: "left-sidebar",
  headerFields: ["name", "spell_level", "school"],
  subtitleFields: ["spell_level", "school"]
}
```

##### 🗺️ Locations Template
```typescript
{
  label: "Locations",
  icon: "🗺️",
  description: "Places, regions, and landmarks",
  fields: [
    { name: "location_type", type: "select", label: "Type",
      options: ["City", "Town", "Village", "Dungeon", "Forest", "Mountain",
                "Desert", "Ocean", "Ruins", "Castle", "Temple", "Tavern", "Shop"] },
    { name: "terrain", type: "text", label: "Terrain" },
    { name: "climate", type: "select", label: "Climate" },
    { name: "population", type: "number", label: "Population" },
    { name: "government", type: "text", label: "Government Type" },
    { name: "notable_npcs", type: "json", label: "Notable NPCs" },
    { name: "resources", type: "text", label: "Resources/Economy" },
    { name: "dangers", type: "text", label: "Dangers" },
    { name: "history", type: "rich-text", label: "History" }
  ],
  layout: "hero-image",
  imagePosition: "top-full-width",
  headerFields: ["name"],
  subtitleFields: ["location_type", "terrain"]
}
```

##### ⚔️ Items Template
```typescript
{
  label: "Items",
  icon: "⚔️",
  description: "Weapons, armor, magical items, and equipment",
  fields: [
    { name: "item_type", type: "select", label: "Type",
      options: ["Weapon", "Armor", "Potion", "Scroll", "Wondrous Item",
                "Ring", "Wand", "Rod", "Staff", "Artifact"] },
    { name: "rarity", type: "select", label: "Rarity",
      options: ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"] },
    { name: "attunement", type: "boolean", label: "Requires Attunement" },
    { name: "weight", type: "number", label: "Weight (lbs)" },
    { name: "value", type: "number", label: "Value (gold)" },
    { name: "damage", type: "text", label: "Damage (if weapon)" },
    { name: "armor_class", type: "text", label: "AC (if armor)" },
    { name: "properties", type: "text", label: "Properties" },
    { name: "effects", type: "rich-text", label: "Magical Effects" }
  ],
  layout: "compact-card",
  imagePosition: "top-right",
  headerFields: ["name", "item_type", "rarity"],
  subtitleFields: ["item_type", "rarity"]
}
```

##### 🎭 Classes Template
##### ⚜️ Factions Template

(See src/templates/ for complete definitions)

### 2. Configuration View

Visual interface for managing entity types without touching code or YAML.

**Features:**
- Template selection screen with previews
- Field builder with drag-and-drop
- Layout designer with live preview
- Customization of existing templates
- Create entirely new entity types from scratch

**User Flow:**
1. Install entities bobbin
2. Click "Configure Entities"
3. Choose template (or create from scratch)
4. Customize fields and layout
5. Save → Compiler generates collection
6. Start creating entities

### 3. Configurable Editor Layouts

Each entity type can have a custom layout:

**Layout Templates:**
- **Compact Card**: Image top-right, info fields in header, sections below
- **Hero Image**: Full-width image, name overlaid, minimal info
- **List Details**: Image left sidebar, stacked info fields

**Layout Configuration:**
```typescript
{
  template: 'compact-card',
  imagePosition: 'top-right' | 'top-full-width' | 'left-sidebar' | 'none',
  imageSize: 'small' | 'medium' | 'large',
  headerFields: ['name', 'level', 'class'], // First row fields
  sections: [
    {
      title: 'Stats',
      fields: ['stats'],
      display: 'json-editor' | 'rich-text' | 'inline' | 'stacked'
    }
  ]
}
```

### 4. Disambiguation System

Handle duplicate names across entity types gracefully.

**Problem:** Multiple entities named "Bane":
- Character: Bane (the villain)
- Spell: Bane (curse spell)
- Location: Bane (cursed forest)

**Solution:**

#### Multi-Entity Preview
```
┌─── Entity Preview ─────────────────────────┐
│ Multiple matches for "Bane"                │
├────────────────────────────────────────────┤
│                                             │
│ 🧙 Character: Bane                         │
│ ├─ Level 15 Rogue                          │
│ ├─ "A cunning assassin who..."             │
│ └─ [Open Full →]                           │
│                                             │
│ ✨ Spell: Bane                             │
│ ├─ Level 1 Enchantment                     │
│ ├─ "Up to three creatures must..."         │
│ └─ [Open Full →]                           │
│                                             │
│ 🗺️ Location: Bane                          │
│ ├─ Forest, Temperate                       │
│ ├─ "A dark woodland where..."              │
│ └─ [Open Full →]                           │
└────────────────────────────────────────────┘
```

**Disambiguation Features:**
- Entity type icons and labels (🧙 Character, ✨ Spell)
- Contextual subtitles (Level 15 Rogue, Level 1 Enchantment)
- Smart context-aware ranking ("cast Bane" → spell first)
- Recently accessed prioritization
- User preference settings

#### Context-Aware Search
```typescript
// Detect keywords to boost relevant entity types
const contextHints = {
  spells: ['cast', 'spell', 'magic', 'enchant', 'conjure'],
  locations: ['traveled to', 'went to', 'arrived at', 'in the', 'at the'],
  characters: ['talked to', 'met', 'fought', 'killed', 'befriended'],
  items: ['equipped', 'wielded', 'used', 'found', 'looted']
}
```

User writes: "He cast Bane on..."
→ Search detects "cast" keyword
→ Spell entity shown first (highest score)

### 5. Universal Preview Panel

Context-aware panel that listens to text selection across all editors.

**Features:**
- Subscribes to `manuscript.editor.selection.v1` topic
- Searches across ALL entity types
- Shows quick preview with key info
- "Open Full" button navigates to entity editor
- Handles multiple matches gracefully
- Works with any text editor, not just manuscript

**Integration:**
```typescript
useMessageBus('manuscript.editor.selection.v1', (message) => {
  const selectedText = message.payload.data.text
  const context = message.payload.data.context // Surrounding text

  searchEntitiesAcrossTypes(selectedText, context)
})
```

## Architecture

### Data Model

#### System Tables

```sql
-- User-created entity type definitions
entity_type_definitions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  bobbin_id text NOT NULL,
  type_id text NOT NULL,  -- 'characters', 'spells', etc.
  label text,
  icon text,
  template_id text,  -- NULL if from scratch, or 'template-characters'
  base_fields jsonb,  -- name, description, image_url, tags
  custom_fields jsonb,  -- User-defined fields
  editor_layout jsonb,  -- Layout configuration
  list_layout jsonb,  -- Grid/list display config
  subtitle_fields text[],  -- For disambiguation
  allow_duplicates boolean DEFAULT true,
  created_at timestamp,
  updated_at timestamp,
  UNIQUE(project_id, type_id)
)

-- Built-in template definitions
entity_templates (
  id text PRIMARY KEY,  -- 'template-characters'
  bobbin_id text,
  label text,
  icon text,
  description text,
  definition jsonb,  -- Full template
  version text,
  created_at timestamp
)

-- Track entity access for "recently accessed" sorting
entity_access_log (
  entity_id uuid,
  user_id uuid,
  accessed_at timestamp,
  PRIMARY KEY (entity_id, user_id)
)
```

#### Dynamic Collections

For each entity type, the compiler generates a collection:

```typescript
// Example: Characters collection
{
  id: uuid,
  name: text,
  description: text,
  image_url: text,
  tags: text[],
  // Custom fields from template:
  age: number,
  class: text,
  level: number,
  race: text,
  stats: jsonb,
  background: text,
  created_at: timestamp,
  updated_at: timestamp
}
```

### Components

#### Views

**1. Configuration View** (`src/views/config.tsx`)
- Template selection screen
- Field builder with drag-and-drop
- Layout designer with live preview
- Save button → writes to `entity_type_definitions`

**2. Entity Editor View** (`src/views/entity-editor.tsx`)
- Loads type definition from DB
- Renders using LayoutRenderer component
- Dynamic form based on field types
- Auto-save functionality

**3. Entity List View** (`src/views/entity-list.tsx`)
- Grid/card layout
- Search and filter by tags
- "Create New" button
- Click to navigate to editor

#### Panels

**4. Entity Navigation Panel** (`src/panels/entity-nav.tsx`)
- Shows all entity types with icons
- Click to navigate
- Entity count per type

**5. Entity Preview Panel** (`src/panels/entity-preview.tsx`)
- Listens to selection events
- Searches across all types
- Shows previews with disambiguation
- "Open Full" navigation

#### Components

**LayoutRenderer** (`src/components/LayoutRenderer.tsx`)
- Renders editor based on layout configuration
- Handles image placement
- Renders sections dynamically

**FieldRenderers** (`src/components/FieldRenderers.tsx`)
- Text input
- Number input
- Select dropdown
- Multi-select
- Boolean checkbox
- JSON editor
- Rich text editor (TipTap)
- Image upload

### Message Bus Integration

**Topics:**
- Consumes: `manuscript.editor.selection.v1`
- Produces: `bobbinry:navigate` events

**Example:**
```typescript
// Navigation panel emits
window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
  detail: {
    entityType: 'character',
    entityId: 'char_abc123',
    bobbinId: 'entities',
    metadata: { class: 'Warrior', level: 15 }
  }
}))

// ViewRouter picks it up and renders entity editor
```

## Implementation Phases

### Phase 1: Core Structure ✓
- [x] Create bobbin directory structure
- [ ] Set up package.json and dependencies
- [ ] Create manifest file
- [ ] Create stub files for all components

### Phase 2: Templates Library
- [ ] Define all 6 template objects
- [ ] Create template exports
- [ ] Add template validation

### Phase 3: Configuration View
- [ ] Template selection UI
- [ ] Template preview modal
- [ ] Field builder interface
- [ ] Layout designer
- [ ] Save functionality

### Phase 4: Layout System
- [ ] LayoutRenderer component
- [ ] Field renderer components
- [ ] Template implementations (compact-card, hero-image, list-details)

### Phase 5: Entity Editor & List
- [ ] Entity editor view
- [ ] Entity list view
- [ ] Auto-save logic
- [ ] Image upload

### Phase 6: Navigation & Preview
- [ ] Entity navigation panel
- [ ] Entity preview panel (basic)
- [ ] Search functionality

### Phase 7: Disambiguation
- [ ] Multi-match preview UI
- [ ] Context-aware search scoring
- [ ] Subtitle rendering
- [ ] User preferences

### Phase 8: Compiler Integration
- [ ] Generate collections from entity_type_definitions
- [ ] Register view handlers dynamically
- [ ] Migration system

### Phase 9: API Endpoints
- [ ] Template CRUD endpoints
- [ ] Entity type CRUD endpoints
- [ ] Entity CRUD endpoints
- [ ] Search endpoints

### Phase 10: Testing & Polish
- [ ] Unit tests
- [ ] Integration tests
- [ ] UI polish
- [ ] Documentation

## User Experience Examples

### Quick Start with Template
1. Install entities bobbin
2. Shell shows "Configure Entities" button
3. Click → Opens config view
4. Click "Characters" template card
5. Preview shows all fields
6. Click "Use Template"
7. Compiler generates 'characters' collection
8. Nav panel shows "🧙 Characters (0)"
9. Click "New Character" → Opens editor
10. Fill in name, class, level, etc.
11. Auto-saves

### Customizing a Template
1. Choose "Spells" template
2. Click "Customize"
3. Remove "components" field (not needed)
4. Add "cooldown" field (number)
5. Change layout from "list-details" to "compact-card"
6. Drag "name" and "spell_level" to header
7. Preview updates in real-time
8. Click "Save"
9. Start creating customized spells

### Using Preview Panel While Writing
1. User writes in manuscript editor:
   "Aragorn cast Fireball at the dragon"
2. User selects "Fireball"
3. Preview panel shows:
   - ✨ Spell: Fireball
   - Level 3 Evocation
   - "A bright streak flashes..."
   - [Open Full →]
4. User verifies it's the right spell
5. Continues writing

### Handling Duplicates
1. User has created:
   - Character: Bane (Level 15 Rogue)
   - Spell: Bane (Level 1 Enchantment)
   - Location: Bane (Cursed Forest)
2. User writes: "They traveled to Bane"
3. Selects "Bane"
4. Preview shows all 3 matches
5. Context hint: "traveled to" → Location shown first
6. User sees icons and subtitles
7. Clicks "Open Full" on Location
8. Navigates to Bane (Location) editor

## Technical Decisions

### Why Native Execution?
- First-party bobbin, full trust
- Needs direct React integration for complex UIs
- Performance critical for real-time search
- SSR-capable for faster loads

### Why JSONB Storage (Tier 1)?
- Fast installation (no schema migrations)
- Flexible field definitions
- Can promote to physical tables if needed
- Indexed JSONB queries are fast enough for most use cases

### Why Templates?
- Faster onboarding for users
- Showcases capabilities
- Provides best practices
- Easy to customize vs. starting from scratch

### Why Universal Preview Panel?
- Works with ANY editor (manuscript, custom, future)
- Consistent UX across all text editing
- No need for per-editor integration
- Message bus provides decoupling

## Future Enhancements

- [ ] Template marketplace (share custom templates)
- [ ] Import/export entity type definitions
- [ ] Relationship builder (link characters to locations, etc.)
- [ ] Custom field validators
- [ ] Conditional field visibility (show "armor_class" only if item_type = "Armor")
- [ ] Bulk operations on entities
- [ ] Entity versioning/history
- [ ] AI-assisted entity creation from descriptions
- [ ] Custom entity views (beyond editor/list)
- [ ] Inline entity creation from preview panel

## References

- Blueprint: `docs/CLI_BLUEPRINT_v0.2.md`
- Manifest Schema: `packages/types/manifest.schema.json`
- View Registry: `apps/shell/src/lib/view-registry.ts`
- ViewRouter: `apps/shell/src/components/ViewRouter.tsx`
- Message Bus: `packages/event-bus/`
- Existing Bobbins: `bobbins/manuscript/`, `bobbins/dictionary-panel/`
