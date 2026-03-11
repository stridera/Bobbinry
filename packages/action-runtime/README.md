# @bobbinry/action-runtime

Action runtime stubs for workflows and external integrations in Bobbinry.

## Purpose

This package provides the starting point for executing bobbin-defined actions. It is intended to grow into a permission-scoped runtime for workflows, integrations, and automation.

## Features

- **Permission-Scoped Execution**: Runtime hooks for reviewed bobbin actions
- **Workflow Support**: Enable complex multi-step workflows within bobbins
- **External Integrations**: Secure interface for connecting to external services
- **Type Safety**: Full TypeScript support with shared types from `@bobbinry/types`

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
import { ActionRuntime } from '@bobbinry/action-runtime';

const runtime = new ActionRuntime({
  actionId: 'sync',
  bobbinId: 'google-drive-backup',
  parameters: {},
  permissions: ['external.write']
});

// Execute an action
const result = await runtime.execute();
```

## Integration

This package is used by:
- **Compiler**: For generating executable action code
- **Shell**: For running bobbin actions in the UI
- **API**: For server-side action execution

## Contributing

1. Follow the existing TypeScript patterns
2. Add tests for new functionality
3. Update type definitions as needed
4. Keep permission boundaries explicit in the runtime API
