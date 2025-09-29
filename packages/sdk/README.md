# @bobbinry/sdk

Client SDK for Bobbinry Shell and Views communication.

## Purpose

The SDK provides the core communication layer between the Bobbinry shell application and individual view components. It enables views to interact with the shell, access data, and participate in the Bobbinry ecosystem while maintaining security boundaries.

## Features

- **Message Bus Integration**: Built on top of `@bobbinry/event-bus`
- **Type-Safe Communication**: Full TypeScript support for all API calls
- **Data Access**: Standardized methods for CRUD operations
- **View Lifecycle**: Hooks for view mounting, unmounting, and state management
- **Security**: Controlled access to shell capabilities

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
```

### Project Structure

```
src/
├── index.ts          # Main SDK exports
├── shell-api.ts      # Shell communication interface
├── data-api.ts       # Data access methods
├── view-api.ts       # View lifecycle and utilities
├── types.ts          # SDK type definitions
└── __tests__/        # Test files
```

## Usage

### Basic Shell Communication

```typescript
import { BobbinrySDK } from '@bobbinry/sdk';

// Initialize SDK
const sdk = new BobbinrySDK();

// Listen for shell events
sdk.on('shell.ready', () => {
  console.log('Shell is ready for interaction');
});

// Send commands to shell
await sdk.shell.navigate('/projects/my-project');
await sdk.shell.showNotification('Hello from view!');
```

### Data Operations

```typescript
// Create entities
const book = await sdk.data.create('Book', {
  title: 'My New Novel',
  author: 'Jane Doe'
});

// Read entities
const books = await sdk.data.list('Book', {
  filter: { author: 'Jane Doe' },
  sort: { createdAt: 'desc' }
});

// Update entities
await sdk.data.update('Book', book.id, {
  title: 'My Updated Novel'
});

// Delete entities
await sdk.data.delete('Book', book.id);
```

### View Lifecycle

```typescript
import { ViewComponent } from '@bobbinry/sdk';

class MyView extends ViewComponent {
  async onMount() {
    // View initialization
    await this.loadData();
  }

  async onUnmount() {
    // Cleanup
    this.cleanup();
  }

  async onFocus() {
    // Handle view focus
    this.refreshData();
  }

  async onBlur() {
    // Handle view blur
    this.saveState();
  }
}
```

### Event Subscriptions

```typescript
// Subscribe to entity changes
const unsubscribe = sdk.data.subscribe('Book', (event) => {
  switch (event.type) {
    case 'created':
      this.addBookToList(event.entity);
      break;
    case 'updated':
      this.updateBookInList(event.entity);
      break;
    case 'deleted':
      this.removeBookFromList(event.entityId);
      break;
  }
});

// Clean up subscription
unsubscribe();
```

## API Reference

### Shell API

```typescript
interface ShellAPI {
  navigate(path: string): Promise<void>;
  showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): Promise<void>;
  openModal(component: string, props?: any): Promise<any>;
  closeModal(): Promise<void>;
  setTitle(title: string): Promise<void>;
  getTheme(): Promise<Theme>;
  setTheme(theme: Partial<Theme>): Promise<void>;
}
```

### Data API

```typescript
interface DataAPI {
  create<T>(collection: string, data: Partial<T>): Promise<T>;
  read<T>(collection: string, id: string): Promise<T | null>;
  update<T>(collection: string, id: string, data: Partial<T>): Promise<T>;
  delete(collection: string, id: string): Promise<void>;
  list<T>(collection: string, options?: QueryOptions): Promise<T[]>;
  subscribe(collection: string, callback: SubscriptionCallback): () => void;
}
```

### View API

```typescript
interface ViewAPI {
  getId(): string;
  getType(): string;
  getProps(): any;
  emit(event: string, data?: any): void;
  getState<T>(): T;
  setState<T>(state: Partial<T>): void;
}
```

## Integration

This package is used by:
- **Views**: All bobbin views use this SDK for shell communication
- **Shell**: The shell implements the counterpart to this SDK
- **View SDK**: Higher-level view utilities build on this foundation

## Security Model

The SDK implements several security measures:
- **Capability-based Access**: Views can only access permitted APIs
- **Origin Validation**: All messages are validated for proper origin
- **Rate Limiting**: API calls are rate-limited to prevent abuse
- **Sandboxing**: Views run in isolated contexts

## Contributing

1. Follow the existing API patterns and naming conventions
2. Add comprehensive tests for new API methods
3. Update type definitions for all new interfaces
4. Consider backward compatibility for API changes
5. Document security implications of new features