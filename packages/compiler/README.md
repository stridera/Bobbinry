# @bobbinry/compiler

Manifest compiler for Bobbinry bobbins that transforms manifest files into executable database migrations and UI registrations.

## Purpose

The compiler is the core transformation engine of Bobbinry. It takes bobbin manifest files (YAML/JSON) and generates:
- Database migrations for tiered storage (JSONB → physical tables)
- Type definitions for data collections
- UI component registrations
- Action runtime code

## Features

- **Manifest Validation**: JSON Schema validation against `manifest.schema.json`
- **Tiered Storage**: Automatic promotion from JSONB to physical tables based on performance
- **Zero-downtime Migrations**: Safe database schema changes with rollback capability
- **Type Generation**: TypeScript definitions from manifest schemas
- **Entity Routing**: Logical view abstraction over physical storage tiers

## Architecture

### Tiered Storage System

1. **Tier 1 (Default)**: JSONB storage in unified `entities` table
2. **Tier 2 (Promoted)**: Dedicated physical tables for high-performance collections

### Promotion Triggers
- Row count >50K
- P95 latency >200ms
- Index budget exceeded (default: 30 indexes per project)

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run type checking
pnpm typecheck

# Run tests
pnpm test

# Watch mode for tests
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

### Project Structure

```
src/
├── index.ts           # Main compiler exports
├── manifest/          # Manifest parsing and validation
├── migrations/        # Database migration generation
├── types/            # Type generation utilities
├── storage/          # Tiered storage logic
└── __tests__/        # Test files
```

## Usage

### Basic Compilation

```typescript
import { ManifestCompiler } from '@bobbinry/compiler';

const compiler = new ManifestCompiler();

// Compile a manifest file
const result = await compiler.compile('./manuscript.manifest.yaml');

// Access generated migrations
console.log(result.migrations);

// Access type definitions
console.log(result.types);
```

### Validation Only

```typescript
import { validateManifest } from '@bobbinry/compiler';

const isValid = await validateManifest(manifestContent);
```

## Configuration

The compiler supports various options:

```typescript
const compiler = new ManifestCompiler({
  indexBudget: 30,           // Max indexes per project
  promotionThreshold: 50000, // Row count for promotion
  latencyThreshold: 200,     // P95 latency threshold (ms)
  outputDir: './generated'   // Output directory
});
```

## Integration Points

- **CLI Tools**: For manifest compilation during development
- **API Server**: Runtime manifest processing and installation
- **Development Server**: Hot reload of manifest changes

## Manifest Schema

See `packages/types/manifest.schema.json` for the complete schema definition.

Key sections:
- `data.collections`: Database entity definitions
- `ui.views`: View component specifications  
- `interactions`: Action and workflow definitions
- `capabilities`: Feature flags and permissions

## Contributing

1. Add tests for new compilation features
2. Update the JSON schema when adding new manifest capabilities
3. Ensure backward compatibility for existing manifests
4. Document any breaking changes to the compilation output