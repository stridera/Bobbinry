# @bobbinry/action-runtime

Sandboxed action SDK for workflows and external integrations in Bobbinry.

## Purpose

This package provides a secure runtime environment for executing user-defined actions within bobbins. It enables bobbins to define custom workflows, integrations with external services, and automated behaviors while maintaining security through sandboxing.

## Features

- **Sandboxed Execution**: Safe execution environment for user-defined actions
- **Workflow Support**: Enable complex multi-step workflows within bobbins
- **External Integrations**: Secure interface for connecting to external services
- **Type Safety**: Full TypeScript support with shared types from `@bobbinry/types`

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
```

### Project Structure

```
src/
├── index.ts          # Main exports
├── runtime.ts        # Core runtime logic
├── sandbox.ts        # Sandboxing utilities
└── types.ts          # Runtime-specific types
```

## Usage

```typescript
import { ActionRuntime } from '@bobbinry/action-runtime';

const runtime = new ActionRuntime({
  sandboxed: true,
  timeout: 30000
});

// Execute an action safely
const result = await runtime.execute(actionDefinition, context);
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
4. Ensure sandbox security is maintained