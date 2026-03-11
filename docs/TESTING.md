# Testing Guide

Comprehensive test suite for Bobbinry platform covering API, views, message passing, and end-to-end workflows.

## Test Structure

```
apps/api/src/__tests__/
  └── integration/
      └── bobbin-lifecycle.test.ts          # API & database tests

apps/shell/src/__tests__/
  ├── integration/
  │   ├── view-rendering.test.tsx           # View loading tests
  │   └── message-passing.test.tsx          # SDK communication tests
  └── e2e/
      └── complete-workflow.test.tsx        # Full workflow tests

bobbins/manuscript/src/__tests__/
  └── types.test.ts                         # Type safety tests
```

---

## Running Tests

### All Tests

```bash
# Run all tests across the monorepo
pnpm dlx turbo run test

# Run tests for specific package
pnpm --filter api test
pnpm --filter shell test
pnpm --filter @bobbinry/manuscript test
```

### Specific Test Suites

```bash
# API integration tests
pnpm --filter api test -- bobbin-lifecycle

# View rendering tests
pnpm --filter shell test -- view-rendering

# Message passing tests
pnpm --filter shell test -- message-passing

# End-to-end workflow tests
pnpm --filter shell test -- complete-workflow

# Type safety tests
pnpm --filter @bobbinry/manuscript test
```

### Watch Mode

```bash
pnpm --filter shell test:watch
pnpm --filter api test:watch
```

---

## Test Coverage

### 1. API Integration Tests (`bobbin-lifecycle.test.ts`)

Tests database operations and manifest/runtime guardrails.

**Covers:**
- ✅ Bobbin installation
- ✅ Entity CRUD operations
- ✅ Project isolation
- ✅ Security boundaries (manifest can't override config)
- ✅ Data structure consistency (no nested `.data`)
- ✅ Approved bobbin registration

**Key Scenarios:**
```typescript
// Approved bobbin installation
it('should install reviewed bobbin with native execution')

// Manifest security
it('should not allow manifest to override execution mode')

// Data structure verification
it('should maintain entity data structure (not nested in .data)')
```

---

### 2. View Rendering Tests (`view-rendering.test.tsx`)

Tests native view loading and registration.

**Covers:**
- ✅ Native view rendering as React components
- ✅ Props passing to native views
- ✅ Native view routing
- ✅ View registry operations
- ✅ Loading states
- ✅ Error boundaries

**Key Scenarios:**
```typescript
// Native rendering
it('should load native view as React component')
it('should pass props correctly to native view')

// Routing
it('should route native bobbins to NativeViewRenderer')
```

---

### 3. Message Passing Tests (`message-passing.test.tsx`)

Tests SDK communication between native shell views.

**Covers:**
- ✅ Native view SDK calls (query, create, update, delete)
- ✅ Capability enforcement
- ✅ Event bus (emit/on/off)
- ✅ Event cleanup on unmount
- ✅ Type safety in message passing

**Key Scenarios:**
```typescript
// Native SDK
it('should allow native view to query entities via SDK')
it('should allow native view to create entities via SDK')
it('should handle API errors gracefully')

// SDK guardrails
it('should enforce capability restrictions for bobbins')

// Event bus
it('should allow views to emit custom events')
it('should allow views to listen for events')
it('should cleanup event listeners on unmount')
```

---

### 4. End-to-End Workflow Tests (`complete-workflow.test.tsx`)

Tests complete user workflows from project creation to data visualization.

**Covers:**
- ✅ Complete manuscript workflow (install → create → query)
- ✅ Multi-bobbin scenarios
- ✅ Data isolation between bobbins
- ✅ View rendering with real data
- ✅ Security enforcement through complete workflow

**Key Workflow:**
```typescript
it('should complete full workflow: install → create book → add chapters → add scenes', async () => {
  // 1. Install Manuscript bobbin
  // 2. Create a book
  // 3. Create chapters
  // 4. Create scenes
  // 5. Query complete hierarchy
  // 6. Verify data structure
  // 7. Test type safety
})
```

---

### 5. Type Safety Tests (`types.test.ts`)

Tests TypeScript type definitions for entities.

**Covers:**
- ✅ Correct entity structure (BookEntity, ChapterEntity, SceneEntity)
- ✅ Compile-time error detection for wrong access patterns
- ✅ Optional field handling

**Key Scenarios:**
```typescript
it('should have correct structure for BookEntity', () => {
  const apiResponse: BookEntity = { id: '123', title: 'My Book', ... }
  
  // ✅ Correct access
  expect(apiResponse.title).toBe('My Book')
  
  // ❌ Wrong access (caught by TypeScript)
  // @ts-expect-error
  const wrongAccess = apiResponse.data.title
})
```

---

## Test Data Setup

### Database Setup

Tests use the real database with isolated test data:

```typescript
beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: 'test@bobbins.test',
    name: 'Test User'
  }).returning()
  
  // Create test project
  const [project] = await db.insert(projects).values({
    ownerId: user.id,
    name: 'Test Project'
  }).returning()
})

afterAll(async () => {
  // Cleanup test data
  await db.delete(entities).where(eq(entities.projectId, testProjectId))
  await db.delete(bobbinsInstalled).where(eq(bobbinsInstalled.projectId, testProjectId))
  await db.delete(projects).where(eq(projects.id, testProjectId))
  await db.delete(users).where(eq(users.id, testUserId))
})
```

### Mock Setup

```typescript
// Mock fetch for API calls
global.fetch = jest.fn()

// Default successful response
;(global.fetch as jest.Mock).mockResolvedValue({
  ok: true,
  json: async () => ({ entities: [], total: 0 })
})

// Mock SDK
const createMockSDK = (): BobbinrySDK => ({
  entities: {
    query: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    create: jest.fn().mockResolvedValue({ id: 'test-id' }),
    // ...
  }
})
```

---

## Test Assertions

### Security Assertions

```typescript
// Manifest cannot override execution mode
const [installation] = await db.insert(bobbinsInstalled).values({
  manifestJson: { execution: { mode: 'native' } } // ← Ignored
  executionMode: 'native'
}).returning()

expect(installation.executionMode).toBe('native')
```

### Data Structure Assertions

```typescript
// Data is spread directly, NOT nested
const entity = await db.insert(entities).values({
  entityData: { title: 'Test', order: 1 }
}).returning()

const data = entity.entityData as any
expect(data.title).toBeDefined()        // ✅ Direct access
expect(data.data).toBeUndefined()       // ✅ NOT nested
```

### Execution Mode Assertions

```typescript
// Native view renders directly
render(<ViewRenderer viewId="manuscript.outline" ... />)

await waitFor(() => {
  expect(screen.getByTestId('native-view')).toBeInTheDocument()
  expect(screen.queryByTagName('iframe')).not.toBeInTheDocument()
})
```

---

## CI/CD Integration

### GitHub Actions (Future)

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: bobbinry
          POSTGRES_PASSWORD: password
          POSTGRES_DB: bobbinry
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm dlx turbo run test
      - run: pnpm dlx turbo run typecheck
```

---

## Debugging Tests

### Verbose Output

```bash
# Run tests with detailed output
pnpm --filter shell test -- --verbose

# Run specific test file
pnpm --filter shell test -- view-rendering.test.tsx

# Debug single test
pnpm --filter shell test -- -t "should load native view"
```

### Console Logging

Tests include step-by-step logging:

```typescript
it('should complete full workflow', async () => {
  console.log('📦 Step 1: Installing bobbin...')
  // ... installation code
  console.log('✅ Bobbin installed')
  
  console.log('📖 Step 2: Creating book...')
  // ... creation code
  console.log('✅ Book created')
})
```

---

## Test Maintenance

### Adding New Tests

1. **Identify test category**: API, View, Message Passing, or E2E
2. **Create test file** in appropriate directory
3. **Follow naming convention**: `feature-name.test.ts(x)`
4. **Include setup/teardown** for test isolation
5. **Document test purpose** in file header comment

### Best Practices

- ✅ Test behavior, not implementation
- ✅ Use descriptive test names
- ✅ Isolate test data (create/cleanup)
- ✅ Mock external dependencies
- ✅ Test error cases
- ✅ Verify security boundaries
- ✅ Test type safety with `@ts-expect-error`

---

## Coverage Goals

| Area | Current | Target |
|------|---------|--------|
| API Routes | 🟡 Partial | 80%+ |
| View Rendering | ✅ Complete | 90%+ |
| SDK Functions | ✅ Complete | 90%+ |
| Security Boundaries | ✅ Complete | 100% |
| Type Safety | ✅ Complete | 100% |
| E2E Workflows | 🟡 Partial | 70%+ |

---

## Summary

The test suite ensures:
- ✅ **Security**: Manifests can't override trust decisions
- ✅ **Type Safety**: Compile-time checks for data access
- ✅ **Execution Model**: Native bobbin views work correctly
- ✅ **Data Integrity**: Entities maintain correct structure
- ✅ **Message Passing**: SDK communication works across native bobbins
- ✅ **Workflows**: Complete user scenarios function end-to-end
