# @bobbinry/types

Shared TypeScript types for the Bobbinry platform.

## Entity Types

### API Response Structure

All entity data is **spread directly** on the response object, NOT nested in a `.data` property:

```typescript
// ✅ Correct - data is spread on the entity
const book: BookEntity = {
  id: '123',
  title: 'My Book',      // ← Direct access
  order: 1,
  _meta: { ... }
}

// ❌ Wrong - data is NOT nested
const book = {
  id: '123',
  data: {                // ← This structure doesn't exist
    title: 'My Book'
  }
}
```

### Using Entity Types

Import the typed entities to ensure correct data access:

```typescript
import type { BookEntity, ChapterEntity, SceneEntity } from '@bobbinry/types'

// TypeScript will enforce correct property access
for (const book of books.data as BookEntity[]) {
  console.log(book.title)        // ✅ Correct
  console.log(book.data.title)   // ❌ TypeScript error
}
```

### Available Types

- **`Entity`** - Base entity with `id` and `_meta`
- **`EntityMetadata`** - Metadata attached to all entities (`bobbinId`, `collection`, timestamps)
- **`EntityQueryResponse`** - Response from entity query endpoints
- **`BookEntity`** - Typed book entity
- **`ChapterEntity`** - Typed chapter entity  
- **`SceneEntity`** - Typed scene entity

### Type Safety

The types include compile-time checks to prevent common mistakes:

```typescript
// TypeScript will catch this error at compile time
const book: BookEntity = await api.getBook('123')
const wrongAccess = book.data.title  // ❌ Error: Property 'data' does not exist
```

### Testing

See `bobbins/manuscript/src/__tests__/types.test.ts` for examples of how to test entity types.

Run tests with:
```bash
pnpm --filter @bobbinry/manuscript test
```