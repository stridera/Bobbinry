# @bobbinry/event-bus

Local Event Bus (LEB) implementation with topic registry and rate limiting for Bobbinry.

## Purpose

The event bus provides a publish-subscribe messaging system that enables communication between different parts of the Bobbinry system, including:
- Shell ↔ View communication
- Cross-bobbin interactions
- System event notifications
- Real-time updates

## Features

- **Topic Registry**: Organized event channels with namespacing
- **Rate Limiting**: Prevents event flooding and ensures system stability
- **Type Safety**: Full TypeScript support with event type definitions
- **Local Events**: In-memory pub/sub for single-instance communication
- **Debugging**: Event logging and inspection capabilities

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
├── event-bus.ts      # Core event bus implementation
├── topics.ts         # Topic registry and management
├── rate-limit.ts     # Rate limiting utilities
└── types.ts          # Event type definitions
```

## Usage

### Basic Pub/Sub

```typescript
import { EventBus } from '@bobbinry/event-bus';

const eventBus = new EventBus();

// Subscribe to events
const unsubscribe = eventBus.subscribe('entity.created', (event) => {
  console.log('Entity created:', event.data);
});

// Publish events
eventBus.publish('entity.created', {
  entityId: 'book-123',
  type: 'Book',
  timestamp: Date.now()
});

// Clean up
unsubscribe();
```

### Topic Namespacing

```typescript
// System events
eventBus.subscribe('system.bobbin.installed', handler);
eventBus.subscribe('system.project.created', handler);

// Bobbin-specific events
eventBus.subscribe('manuscript.chapter.updated', handler);
eventBus.subscribe('corkboard.scene.reordered', handler);

// View events
eventBus.subscribe('view.focus.changed', handler);
```

### Rate Limiting

```typescript
const eventBus = new EventBus({
  rateLimit: {
    maxEvents: 100,     // Max events per window
    windowMs: 1000,     // Time window in milliseconds
    burstLimit: 10      // Max burst events
  }
});
```

## Event Types

### System Events
- `system.startup`: Application initialization
- `system.shutdown`: Application cleanup
- `system.error`: System-level errors

### Entity Events
- `entity.created`: New entity creation
- `entity.updated`: Entity modifications
- `entity.deleted`: Entity removal

### View Events
- `view.mounted`: View component mounted
- `view.unmounted`: View component unmounted
- `view.focus.changed`: Focus state changes

### Bobbin Events
- `bobbin.installed`: New bobbin installation
- `bobbin.uninstalled`: Bobbin removal
- `bobbin.updated`: Bobbin configuration changes

## Integration

This package is used by:
- **Shell**: For coordinating UI updates and user interactions
- **View SDK**: For view ↔ shell communication
- **SDK**: For general cross-component messaging
- **API**: For server-side event coordination

## Configuration

```typescript
interface EventBusConfig {
  rateLimit?: {
    maxEvents: number;    // Maximum events per time window
    windowMs: number;     // Time window in milliseconds
    burstLimit: number;   // Maximum burst events
  };
  debug?: boolean;        // Enable debug logging
  namespace?: string;     // Event namespace prefix
}
```

## Best Practices

1. **Use Namespaced Topics**: Organize events with clear hierarchical naming
2. **Handle Unsubscription**: Always clean up event listeners
3. **Rate Limit Awareness**: Design for rate limiting constraints
4. **Type Safety**: Use TypeScript interfaces for event payloads
5. **Error Handling**: Implement proper error boundaries for event handlers

## Contributing

1. Follow the existing event naming conventions
2. Add tests for new event types and features
3. Update type definitions for new event payloads
4. Consider rate limiting impact for new event types