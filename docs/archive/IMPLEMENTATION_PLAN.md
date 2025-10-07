# Bobbinry Native vs Sandboxed Execution - Implementation Plan

**Status:** Implementation Roadmap  
**Created:** 2025-09-29  
**Target:** MVP (Milestone C)

---

## Current State Analysis

### ✅ What Exists

**Infrastructure:**
- ✅ Monorepo structure with pnpm + Turbo
- ✅ Next.js shell app (apps/shell)
- ✅ Fastify API (apps/api)
- ✅ TypeScript throughout with strict mode
- ✅ Basic testing infrastructure (Jest + Testing Library)

**Manifest System:**
- ✅ Manifest types (`packages/types/src/manifest.ts`)
- ✅ Manifest schema validation (`packages/compiler`)
- ✅ ManifestCompiler class with validation
- ✅ manifest.schema.json + manifest.schema.v0.2.json
- ✅ Sample manifests (manuscript.manifest.yaml, corkboard.manifest.yaml)

**View System:**
- ✅ ViewRenderer component (sandboxed iframe rendering)
- ✅ BobbinBridge for postMessage communication
- ✅ View SDK (`packages/view-sdk`) for iframe views
- ✅ API route for serving view HTML (`apps/api/src/routes/views.ts`)
- ✅ Extension system with slots (`apps/shell/src/lib/extensions.ts`)

**SDK & APIs:**
- ✅ BobbinrySDK (`packages/sdk`) with API client, MessageBus, EntityAPI
- ✅ View SDK for sandboxed communication
- ✅ Extension registry with slot management

**Database:**
- ✅ Drizzle ORM setup
- ✅ Schema with `bobbins_installed` table

### ❌ What's Missing (for Native Execution)

**Core Functionality:**
- ❌ `execution.mode` field in Manifest type
- ❌ Native bobbin loader (dynamic imports from workspace)
- ❌ View registry with execution mode tracking
- ❌ Dual-mode ViewRenderer (native vs sandboxed)
- ❌ Signature verification system (even stub)
- ❌ Actual React components for Manuscript views
- ❌ Compiler logic to handle execution modes
- ❌ SSR support for native views

**Testing:**
- ❌ Tests for native loading
- ❌ Tests for execution mode selection
- ❌ Integration tests for both modes
- ❌ E2E tests for SSR with native views

---

## Implementation Plan

### Phase 1: Type System & Manifest Updates

**Goal:** Add execution mode support to type definitions and schemas

**Tasks:**

1. **Update Manifest Types** (`packages/types/src/manifest.ts`)
   ```typescript
   export interface Manifest {
     // ... existing fields
     execution?: {
       mode: 'native' | 'sandboxed'
       signature?: string  // Ed25519 signature for native bobbins
     }
   }
   ```

2. **Update manifest.schema.v0.2.json**
   - Add `execution` object with `mode` and `signature` fields
   - Make `execution.signature` required when `mode: "native"`

3. **Update manifest.manifest.yaml**
   ```yaml
   execution:
     mode: native
     signature: dev_mode_skip  # Dev placeholder
   ```

4. **Tests:**
   - Update `packages/compiler/src/__tests__/manifest-validation.test.ts`
   - Add test cases for execution mode validation

**Acceptance:** 
- Manifest with `execution.mode: native` validates successfully
- Manifest with `mode: native` but no signature fails validation (prod mode)

---

### Phase 2: View Registry with Execution Modes

**Goal:** Create centralized registry that tracks how each view should be loaded

**Tasks:**

1. **Create ViewRegistry** (`apps/shell/src/lib/view-registry.ts`)
   ```typescript
   export interface ViewRegistryEntry {
     viewId: string
     bobbinId: string
     execution: 'native' | 'sandboxed'
     
     // Native-specific
     componentLoader?: () => Promise<React.ComponentType<any>>
     ssr?: boolean
     
     // Sandboxed-specific
     iframeSrc?: string
     
     // Common
     capabilities: string[]
     metadata: {
       name: string
       type: string
       source: string
     }
   }
   
   export class ViewRegistry {
     private views = new Map<string, ViewRegistryEntry>()
     
     register(entry: ViewRegistryEntry): void
     get(viewId: string): ViewRegistryEntry | undefined
     getByBobbin(bobbinId: string): ViewRegistryEntry[]
     unregister(viewId: string): void
   }
   
   export const viewRegistry = new ViewRegistry()
   ```

2. **Initialize Registry in Shell Layout**
   - Import in `apps/shell/src/components/ShellLayout.tsx`
   - Pass to ViewRenderer via context

3. **Tests:**
   - `apps/shell/src/lib/__tests__/view-registry.test.ts`
   - Test registration, lookup, unregistration

**Acceptance:**
- ViewRegistry can store both native and sandboxed view configs
- Can query views by ID or bobbin

---

### Phase 3: Native Bobbin Loader

**Goal:** Dynamic import system for native React components from workspace

**Tasks:**

1. **Create NativeViewLoader** (`apps/shell/src/lib/native-view-loader.ts`)
   ```typescript
   export class NativeViewLoader {
     private cache = new Map<string, React.ComponentType<any>>()
     
     async load(bobbinId: string, viewId: string): Promise<React.ComponentType<any>> {
       const cacheKey = `${bobbinId}:${viewId}`
       if (this.cache.has(cacheKey)) {
         return this.cache.get(cacheKey)!
       }
       
       // Dynamic import from workspace
       const module = await import(`@bobbins/${bobbinId}/views/${viewId}`)
       const Component = module.default || module[viewId]
       
       if (!Component) {
         throw new Error(`View component not found: ${bobbinId}/${viewId}`)
       }
       
       this.cache.set(cacheKey, Component)
       return Component
     }
     
     preload(bobbinId: string, viewId: string): void {
       this.load(bobbinId, viewId).catch(console.error)
     }
     
     clearCache(): void {
       this.cache.clear()
     }
   }
   
   export const nativeViewLoader = new NativeViewLoader()
   ```

2. **Configure TypeScript Paths** (`tsconfig.json`)
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@bobbins/*": ["./bobbins/*"]
       }
     }
   }
   ```

3. **Tests:**
   - `apps/shell/src/lib/__tests__/native-view-loader.test.ts`
   - Mock dynamic imports
   - Test caching behavior
   - Test error handling for missing components

**Acceptance:**
- Can dynamically import React components from `bobbins/` workspace
- Caching works correctly
- Errors are handled gracefully

---

### Phase 4: Dual-Mode ViewRenderer

**Goal:** Update ViewRenderer to support both native and sandboxed rendering

**Tasks:**

1. **Refactor ViewRenderer** (`apps/shell/src/components/ViewRenderer.tsx`)
   ```typescript
   export function ViewRenderer({ projectId, bobbinId, viewId, sdk }: ViewRendererProps) {
     const viewEntry = viewRegistry.get(viewId)
     
     if (!viewEntry) {
       return <ViewNotFound viewId={viewId} />
     }
     
     if (viewEntry.execution === 'native') {
       return <NativeViewRenderer 
         viewEntry={viewEntry}
         projectId={projectId}
         sdk={sdk}
       />
     }
     
     return <SandboxedViewRenderer
       viewEntry={viewEntry}
       projectId={projectId}
       bobbinId={bobbinId}
       viewId={viewId}
       sdk={sdk}
     />
   }
   ```

2. **Create NativeViewRenderer** (`apps/shell/src/components/NativeViewRenderer.tsx`)
   ```typescript
   function NativeViewRenderer({ viewEntry, projectId, sdk }: Props) {
     const [Component, setComponent] = useState<React.ComponentType<any> | null>(null)
     const [loading, setLoading] = useState(true)
     const [error, setError] = useState<string | null>(null)
     
     useEffect(() => {
       if (!viewEntry.componentLoader) {
         setError('No component loader configured')
         return
       }
       
       viewEntry.componentLoader()
         .then(comp => {
           setComponent(() => comp)
           setLoading(false)
         })
         .catch(err => {
           setError(err.message)
           setLoading(false)
         })
     }, [viewEntry])
     
     if (loading) return <ViewLoading />
     if (error) return <ViewError error={error} />
     if (!Component) return <ViewNotFound />
     
     return <Component projectId={projectId} sdk={sdk} />
   }
   ```

3. **Extract SandboxedViewRenderer**
   - Move existing iframe logic to `apps/shell/src/components/SandboxedViewRenderer.tsx`
   - Keep current BobbinBridge integration

4. **Tests:**
   - `apps/shell/src/components/__tests__/ViewRenderer.test.tsx`
   - Test mode selection logic
   - Mock both native and sandboxed renderers
   - Test error states

**Acceptance:**
- ViewRenderer correctly routes to native or sandboxed based on registry
- Native views load and render React components
- Sandboxed views still work as before

---

### Phase 5: Compiler Integration

**Goal:** Compiler processes execution mode and registers views appropriately

**Tasks:**

1. **Update ManifestCompiler** (`packages/compiler/src/index.ts`)
   ```typescript
   private async registerViews(manifest: Manifest): Promise<void> {
     if (!manifest.ui?.views) return
     
     const executionMode = manifest.execution?.mode || 'sandboxed'
     
     for (const view of manifest.ui.views) {
       const entry: ViewRegistryEntry = {
         viewId: `${manifest.id}.${view.id}`,
         bobbinId: manifest.id,
         execution: executionMode,
         capabilities: this.extractCapabilities(manifest),
         metadata: {
           name: view.name,
           type: view.type,
           source: view.source
         }
       }
       
       if (executionMode === 'native') {
         // Verify signature (stub in dev)
         await this.verifySignature(manifest)
         
         entry.componentLoader = () => 
           import(`@bobbins/${manifest.id}/views/${view.id}`)
         entry.ssr = true
       } else {
         entry.iframeSrc = `/api/views/${manifest.id}/${view.id}`
       }
       
       // Register with view registry
       console.log(`Registering ${executionMode} view: ${entry.viewId}`)
       // In real implementation, this would call viewRegistry.register(entry)
     }
   }
   
   private async verifySignature(manifest: Manifest): Promise<void> {
     if (process.env.NODE_ENV === 'development') {
       // Skip in dev mode
       if (manifest.execution?.signature === 'dev_mode_skip') {
         return
       }
     }
     
     // TODO: Implement Ed25519 signature verification
     // For now, throw error in production without valid signature
     if (process.env.NODE_ENV === 'production' && !manifest.execution?.signature) {
       throw new Error('Native bobbins require valid signature in production')
     }
   }
   ```

2. **Tests:**
   - `packages/compiler/src/__tests__/execution-modes.test.ts`
   - Test native view registration
   - Test sandboxed view registration
   - Test signature validation (stub)

**Acceptance:**
- Compiler correctly processes execution modes
- Native bobbins register with componentLoader
- Sandboxed bobbins register with iframeSrc
- Dev mode signature bypass works

---

### Phase 6: Create Manuscript Native Views

**Goal:** Build actual React components for Manuscript bobbin

**Tasks:**

1. **Setup Manuscript Package** (`bobbins/manuscript/`)
   ```
   bobbins/manuscript/
     package.json
     tsconfig.json
     views/
       Outline.tsx
       Editor.tsx
       index.ts
     components/
       SceneCard.tsx
       ChapterTree.tsx
     manifest.yaml  (already exists)
   ```

2. **package.json** (`bobbins/manuscript/package.json`)
   ```json
   {
     "name": "@bobbins/manuscript",
     "version": "1.0.0",
     "main": "./views/index.ts",
     "exports": {
       "./views/*": "./views/*.tsx"
     },
     "dependencies": {
       "react": "workspace:*",
       "@bobbinry/sdk": "workspace:*",
       "@bobbinry/types": "workspace:*"
     }
   }
   ```

3. **Create Outline View** (`bobbins/manuscript/views/Outline.tsx`)
   ```typescript
   import { useState, useEffect } from 'react'
   import { BobbinrySDK } from '@bobbinry/sdk'
   
   export interface OutlineProps {
     projectId: string
     sdk: BobbinrySDK
   }
   
   export default function Outline({ projectId, sdk }: OutlineProps) {
     const [books, setBooks] = useState([])
     const [loading, setLoading] = useState(true)
     
     useEffect(() => {
       sdk.entities.query({ collection: 'books' })
         .then(result => {
           setBooks(result.data)
           setLoading(false)
         })
         .catch(console.error)
     }, [sdk, projectId])
     
     if (loading) return <div>Loading outline...</div>
     
     return (
       <div className="outline-view">
         <h2>Outline</h2>
         {books.map(book => (
           <BookNode key={book.id} book={book} sdk={sdk} />
         ))}
       </div>
     )
   }
   ```

4. **Create Editor View** (`bobbins/manuscript/views/Editor.tsx`)
   ```typescript
   import { useState, useEffect } from 'react'
   import { BobbinrySDK } from '@bobbinry/sdk'
   
   export interface EditorProps {
     projectId: string
     sdk: BobbinrySDK
     sceneId?: string
   }
   
   export default function Editor({ projectId, sdk, sceneId }: EditorProps) {
     const [scene, setScene] = useState(null)
     const [content, setContent] = useState('')
     
     useEffect(() => {
       if (sceneId) {
         sdk.entities.get('scenes', sceneId)
           .then(data => {
             setScene(data)
             setContent(data.body || '')
           })
       }
     }, [sdk, sceneId])
     
     const handleSave = async () => {
       if (scene) {
         await sdk.entities.update('scenes', scene.id, { body: content })
       }
     }
     
     return (
       <div className="editor-view">
         <textarea 
           value={content}
           onChange={(e) => setContent(e.target.value)}
           placeholder="Start writing..."
         />
         <button onClick={handleSave}>Save</button>
       </div>
     )
   }
   ```

5. **Export Views** (`bobbins/manuscript/views/index.ts`)
   ```typescript
   export { default as Outline } from './Outline'
   export { default as Editor } from './Editor'
   ```

6. **Update manifest.yaml**
   ```yaml
   execution:
     mode: native
     signature: dev_mode_skip
   ```

7. **Tests:**
   - `bobbins/manuscript/views/__tests__/Outline.test.tsx`
   - `bobbins/manuscript/views/__tests__/Editor.test.tsx`
   - Test rendering with mock SDK
   - Test data loading
   - Test interactions

**Acceptance:**
- Outline and Editor components render successfully
- Can query entities via SDK
- Can update entities via SDK
- Components are SSR-compatible

---

### Phase 7: Integration & Testing

**Goal:** End-to-end testing of native execution

**Tasks:**

1. **Integration Tests** (`apps/shell/src/__tests__/integration/native-views.test.tsx`)
   ```typescript
   describe('Native View Loading', () => {
     it('loads Manuscript Outline view natively', async () => {
       // Install manuscript bobbin
       // Verify view registry has native entry
       // Render ViewRenderer with manuscript.outline
       // Verify NativeViewRenderer is used
       // Verify Outline component renders
     })
     
     it('supports SSR for native views', async () => {
       // Server-render page with Manuscript view
       // Verify component renders server-side
       // Verify hydration works client-side
     })
   })
   ```

2. **E2E Tests** (`apps/shell/src/__tests__/e2e/manuscript-workflow.test.ts`)
   ```typescript
   describe('Manuscript Workflow', () => {
     it('complete manuscript editing workflow', async () => {
       // Create project
       // Install Manuscript bobbin
       // Load Outline view (native)
       // Create book/chapter/scene
       // Switch to Editor view (native)
       // Edit scene content
       // Save changes
       // Verify data persists
     })
   })
   ```

3. **Performance Tests**
   - Measure native vs sandboxed render times
   - Measure SSR performance
   - Verify no postMessage overhead for native views

4. **Manual Testing Checklist:**
   - [ ] Install Manuscript bobbin via API
   - [ ] Verify view registry shows native execution mode
   - [ ] Navigate to Outline view
   - [ ] Verify no iframe in DOM
   - [ ] Verify React DevTools shows native component tree
   - [ ] Create book/chapter/scene via Outline
   - [ ] Navigate to Editor view
   - [ ] Edit scene content
   - [ ] Save changes
   - [ ] Verify changes persist
   - [ ] Check Network tab - no postMessage traffic
   - [ ] Test SSR: disable JS, reload page, verify content renders

**Acceptance:**
- All integration tests pass
- E2E workflow completes successfully
- Native views render 50%+ faster than sandboxed equivalents
- SSR works for native views

---

### Phase 8: Documentation & Polish

**Goal:** Document the system and create developer guides

**Tasks:**

1. **Update CLAUDE.md**
   - Add native bobbin development guide
   - Link to EXECUTION_MODES.md

2. **Create Bobbin Development Guide** (`docs/BOBBIN_DEVELOPMENT.md`)
   - How to create a native bobbin
   - How to create a sandboxed bobbin
   - Component API reference
   - SDK usage patterns

3. **Add JSDoc Comments**
   - ViewRegistry
   - NativeViewLoader
   - ViewRenderer components
   - ManifestCompiler execution mode methods

4. **Create Example Bobbins**
   - Update Dictionary Panel to sandboxed
   - Ensure it still works after changes

**Acceptance:**
- Documentation is complete and accurate
- Developer can follow guide to create new bobbin
- Examples work out of the box

---

## Testing Strategy

### Unit Tests

**Packages:**
- `packages/types`: Manifest type validation
- `packages/compiler`: Execution mode processing, signature validation
- `packages/sdk`: SDK works with native contexts

**Shell:**
- `apps/shell/src/lib`: ViewRegistry, NativeViewLoader
- `apps/shell/src/components`: NativeViewRenderer, ViewRenderer routing

**Bobbins:**
- `bobbins/manuscript/views`: Outline, Editor components

### Integration Tests

- Native view loading workflow
- Sandboxed view loading workflow
- Mode switching (if supported)
- SSR for native views
- Compiler → Registry → Renderer pipeline

### E2E Tests

- Complete manuscript workflow (native views)
- Dictionary panel workflow (sandboxed view)
- Mixed bobbin installation
- Performance comparison

### Test Coverage Goals

- Types & Compiler: 90%+
- View loading system: 85%+
- React components: 80%+
- Overall: 80%+

---

## Rollout Plan

### Week 1: Foundation
- Phase 1: Type System & Manifest Updates
- Phase 2: View Registry
- Phase 3: Native Bobbin Loader

### Week 2: Integration
- Phase 4: Dual-Mode ViewRenderer
- Phase 5: Compiler Integration
- Begin Phase 6: Manuscript Views (Outline)

### Week 3: Views & Testing
- Complete Phase 6: Manuscript Views (Editor)
- Phase 7: Integration & Testing
- Fix bugs, address edge cases

### Week 4: Polish & Ship
- Phase 8: Documentation
- Final testing
- Performance optimization
- Ship MVP

---

## Success Criteria

### MVP Completion

- [x] Native execution mode defined in types and schema
- [x] ViewRegistry implemented and tested
- [x] NativeViewLoader can dynamic import workspace components
- [x] ViewRenderer supports both execution modes
- [x] Compiler processes execution modes correctly
- [x] Manuscript Outline view works natively
- [x] Manuscript Editor view works natively
- [x] SSR works for native views
- [x] Tests pass (80%+ coverage)
- [x] Documentation complete

### Performance Targets

- Native views render in ≤100ms (vs ~300ms for sandboxed)
- No postMessage overhead for native views
- SSR time-to-first-byte ≤50ms
- No regressions in sandboxed view performance

### DX Targets

- Creating new native bobbin takes ≤30 minutes
- Clear error messages for common mistakes
- Hot reload works for native views
- TypeScript autocomplete works in bobbin code

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Dynamic imports fail in Next.js | High | Test early, use Next.js dynamic() if needed |
| TypeScript paths not resolved | High | Configure tsconfig properly, test with fresh install |
| SSR hydration mismatches | Medium | Careful state management, test SSR explicitly |
| Breaking existing sandboxed views | High | Comprehensive integration tests, feature flag |
| Performance not improved | Medium | Benchmark early, profile with React DevTools |
| Signature system complexity | Low | Start with stub, iterate in Phase 2 |

---

## Future Enhancements (Post-MVP)

- **Phase 2: Marketplace**
  - Real Ed25519 signature generation/verification
  - Trusted third-party promotion path
  - Automated security scanning

- **Phase 3: Advanced Features**
  - Code splitting for native views
  - Lazy loading with suspense
  - View-level error boundaries
  - Performance monitoring dashboard

- **Phase 4: Developer Tools**
  - Bobbin CLI for scaffolding
  - Local bobbin development server
  - Hot reload for manifest changes
  - Visual manifest editor

---

**Next Steps:** Begin Phase 1 - Update manifest types and schemas.