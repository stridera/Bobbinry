# @bobbinry/types

Shared TypeScript types for Bobbinry platform.

## Purpose

This package contains all shared TypeScript type definitions used across the Bobbinry ecosystem. It provides a centralized location for types that need to be consistent between the shell, views, compiler, and other packages.

## Features

- **Manifest Types**: Complete type definitions for bobbin manifest files
- **Entity Types**: Database entity and collection type definitions
- **API Types**: Request/response types for shell ↔ view communication
- **Event Types**: Event payload definitions for the event bus
- **Configuration Types**: System and user configuration interfaces

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run type checking
pnpm typecheck
```

### Project Structure

```
src/
├── index.ts          # Main type exports
├── manifest.ts       # Manifest file type definitions
├── entities.ts       # Database entity types
├── api.ts           # API request/response types
├── events.ts        # Event payload types
├── config.ts        # Configuration types
└── schema/          # JSON Schema files
    └── manifest.schema.json
```

## Core Types

### Manifest Types

```typescript
import { BobbinManifest, Collection, View, Interaction } from '@bobbinry/types';

// Complete manifest structure
interface BobbinManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  data: {
    collections: Record<string, Collection>;
  };
  ui: {
    views: Record<string, View>;
  };
  interactions?: Record<string, Interaction>;
  capabilities?: Capabilities;
  publish?: PublishConfig;
}
```

### Entity Types

```typescript
import { Entity, EntityMetadata, QueryOptions } from '@bobbinry/types';

// Base entity structure
interface Entity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  projectId: string;
  bobbinId: string;
  collection: string;
  data: Record<string, any>;
  metadata: EntityMetadata;
}

// Query options for data operations
interface QueryOptions {
  filter?: Record<string, any>;
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: string[];
}
```

### API Types

```typescript
import { APIRequest, APIResponse, DataOperation } from '@bobbinry/types';

// Standard API request structure
interface APIRequest<T = any> {
  id: string;
  type: string;
  data: T;
  timestamp: number;
  requestId?: string;
}

// Standard API response structure
interface APIResponse<T = any> {
  id: string;
  success: boolean;
  data?: T;
  error?: APIError;
  timestamp: number;
}
```

### Event Types

```typescript
import { EntityEvent, SystemEvent, ViewEvent } from '@bobbinry/types';

// Entity change events
interface EntityEvent {
  type: 'created' | 'updated' | 'deleted';
  entityId: string;
  collection: string;
  entity?: Entity;
  changes?: Record<string, any>;
  timestamp: number;
}

// System-level events
interface SystemEvent {
  type: 'startup' | 'shutdown' | 'error' | 'bobbin.installed';
  data: any;
  timestamp: number;
}
```

## JSON Schema

The package includes JSON Schema definitions for manifest validation:

```typescript
import manifestSchema from '@bobbinry/types/schema/manifest.schema.json';

// Use with AJV or other JSON Schema validators
const ajv = new Ajv();
const validate = ajv.compile(manifestSchema);
const isValid = validate(manifestData);
```

## Usage Examples

### Type-Safe Manifest Parsing

```typescript
import { BobbinManifest, validateManifest } from '@bobbinry/types';

function parseManifest(data: unknown): BobbinManifest {
  if (!validateManifest(data)) {
    throw new Error('Invalid manifest structure');
  }
  return data as BobbinManifest;
}
```

### Entity Operations

```typescript
import { Entity, CreateEntityRequest } from '@bobbinry/types';

async function createBook(bookData: CreateEntityRequest): Promise<Entity> {
  const request: APIRequest<CreateEntityRequest> = {
    id: generateId(),
    type: 'entity.create',
    data: bookData,
    timestamp: Date.now()
  };
  
  return await apiClient.send(request);
}
```

### Event Handling

```typescript
import { EntityEvent } from '@bobbinry/types';

eventBus.subscribe('entity.updated', (event: EntityEvent) => {
  if (event.collection === 'Book') {
    updateBookInUI(event.entity);
  }
});
```

## Type Guards

The package includes type guard functions for runtime type checking:

```typescript
import { isEntity, isManifest, isAPIRequest } from '@bobbinry/types';

function handleMessage(message: unknown) {
  if (isAPIRequest(message)) {
    processAPIRequest(message);
  } else {
    console.warn('Invalid message format');
  }
}
```

## Utility Types

### Generic Helper Types

```typescript
// Extract collection types from manifest
type ManifestCollections<T extends BobbinManifest> = T['data']['collections'];

// Create type-safe entity data
type EntityData<T extends Collection> = {
  [K in keyof T['fields']]: FieldTypeMap[T['fields'][K]['type']];
};

// API response helper
type APIResult<T> = Promise<APIResponse<T>>;
```

## Integration

This package is used by:
- **All Packages**: Every package in the monorepo depends on these types
- **Compiler**: For manifest validation and code generation
- **Shell**: For API and data type safety
- **Views**: For consistent data interfaces
- **API**: For request/response validation

## Schema Validation

The package provides runtime validation utilities:

```typescript
import { validateManifest, validateEntity, validateAPIRequest } from '@bobbinry/types';

// Validate manifest before compilation
if (!validateManifest(manifestData)) {
  throw new Error('Invalid manifest');
}

// Validate entity data before storage
if (!validateEntity(entityData, collectionSchema)) {
  throw new Error('Invalid entity data');
}
```

## Contributing

1. **Backward Compatibility**: Never make breaking changes to existing types
2. **Documentation**: Document all new types with JSDoc comments
3. **Validation**: Add JSON Schema definitions for complex types
4. **Testing**: Include type tests to prevent regressions
5. **Exports**: Update index.ts when adding new type files

### Adding New Types

1. Create the type definition
2. Add to appropriate category file (manifest.ts, entities.ts, etc.)
3. Export from index.ts
4. Add JSON Schema if applicable
5. Include type guards if needed
6. Update documentation