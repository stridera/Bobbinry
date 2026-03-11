# @bobbinry/action-runtime

Shared action contracts for reviewed bobbin actions in Bobbinry.

## Purpose

This package provides the starting point for executing bobbin-defined actions. It is intended to grow into a permission-scoped runtime for workflows, integrations, and automation.

## Features

- **Shared Contracts**: One handler/context/runtime interface for API and bobbins
- **Permission Hooks**: Explicit runtime permission checks for server-executed actions
- **Structured Logging**: Host-provided logger instead of direct framework instances
- **Type Safety**: Full TypeScript support with shared action types

## Development

### Setup

```bash
# Install dependencies
bun install

# Build the package
bun build

# Run type checking
bun typecheck

# Run tests
bun test
```

### Project Structure

```
src/
├── index.ts          # Main exports
├── runtime.ts        # Core runtime logic
├── runtime.ts        # Future runtime utilities
└── types.ts          # Runtime-specific types
```

## Usage

```typescript
import type { ActionHandler } from '@bobbinry/action-runtime';

export const syncToDrive: ActionHandler = async (params, context, runtime) => {
  runtime.log.info({ actionId: context.actionId }, 'Running drive sync');

  if (!runtime.hasPermission('external.write')) {
    return { success: false, error: 'Missing permission' };
  }

  return { success: true, data: { synced: true } };
};
```

## Integration

This package is used by:
- **Compiler**: Manifest validation for custom action handlers
- **API**: Server-side action loading and execution
- **Bobbins**: Action modules that export reviewed handlers

## Contributing

1. Follow the existing TypeScript patterns
2. Add tests for new functionality
3. Update type definitions as needed
4. Keep permission boundaries explicit in the runtime API
