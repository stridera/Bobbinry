# @bobbinry/view-sdk

PostMessage bridge for sandboxed views/panels in Bobbinry.

## Purpose

The View SDK provides a secure communication bridge between the Bobbinry shell and sandboxed view components running in iframes. It handles the PostMessage protocol, security validation, and provides a clean API for view developers.

## Features

- **PostMessage Bridge**: Secure iframe ↔ shell communication
- **Security Validation**: Origin checking and message validation
- **Event Bus Integration**: Built on `@bobbinry/event-bus` for consistent messaging
- **Type Safety**: Full TypeScript support for all message types
- **Sandbox Support**: Designed for Content Security Policy (CSP) compliance

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
├── view-bridge.ts    # PostMessage bridge implementation
├── shell-bridge.ts   # Shell-side communication
├── security.ts       # Origin validation and security
└── types.ts          # Message type definitions
```

## Usage

### View Side (Inside iframe)

```typescript
import { ViewBridge } from '@bobbinry/view-sdk';

// Initialize the view bridge
const bridge = new ViewBridge({
  allowedOrigins: ['https://app.bobbinry.com'],
  debug: process.env.NODE_ENV === 'development'
});

// Wait for connection to shell
await bridge.connect();

// Send messages to shell
bridge.send('view.ready', {
  viewId: 'my-view',
  capabilities: ['data-access', 'navigation']
});

// Listen for messages from shell
bridge.on('shell.data.response', (data) => {
  console.log('Received data from shell:', data);
});

// Request data from shell
bridge.request('shell.data.query', {
  collection: 'Book',
  filter: { published: true }
});
```

### Shell Side (Parent window)

```typescript
import { ShellBridge } from '@bobbinry/view-sdk';

// Initialize shell bridge for a view iframe
const bridge = new ShellBridge(iframeElement, {
  allowedOrigins: ['https://view.bobbinry.com'],
  timeout: 5000
});

// Handle view messages
bridge.on('view.ready', (message) => {
  console.log('View is ready:', message.data);
  
  // Send initial data to view
  bridge.send('shell.initial.data', {
    user: currentUser,
    project: currentProject
  });
});

// Handle data requests from view
bridge.on('shell.data.query', async (message) => {
  const result = await dataService.query(message.data);
  bridge.respond(message.id, 'shell.data.response', result);
});
```

## Message Protocol

### Message Structure

```typescript
interface BridgeMessage {
  id: string;                    // Unique message ID
  type: string;                  // Message type
  data?: any;                    // Message payload
  timestamp: number;             // Message timestamp
  origin: string;                // Sender origin
  requestId?: string;            // For response correlation
}
```

### Standard Message Types

#### View → Shell
- `view.ready`: View initialization complete
- `view.resize`: Request shell to resize iframe
- `view.navigate`: Request navigation to different route
- `view.data.create`: Create new entity
- `view.data.read`: Read entity by ID
- `view.data.update`: Update existing entity
- `view.data.delete`: Delete entity
- `view.data.query`: Query entities with filters

#### Shell → View
- `shell.ready`: Shell ready for communication
- `shell.data.response`: Response to data operations
- `shell.theme.changed`: Theme/appearance updates
- `shell.focus.changed`: View focus state changes
- `shell.route.changed`: Route navigation events

## Security Features

### Origin Validation

```typescript
const bridge = new ViewBridge({
  allowedOrigins: [
    'https://app.bobbinry.com',
    'https://*.bobbinry.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
  ].filter(Boolean)
});
```

### Message Sanitization

All messages are automatically sanitized to prevent XSS attacks:
- HTML content is escaped
- Script tags are removed
- Event handlers are stripped

### Rate Limiting

```typescript
const bridge = new ViewBridge({
  rateLimit: {
    maxMessages: 100,    // Max messages per minute
    burstLimit: 10       // Max burst messages
  }
});
```

## Advanced Usage

### Custom Message Types

```typescript
// Define custom message types
interface CustomMessages {
  'custom.save.draft': { content: string };
  'custom.export.pdf': { format: 'a4' | 'letter' };
}

const bridge = new ViewBridge<CustomMessages>();

// Type-safe message sending
bridge.send('custom.save.draft', { content: 'My draft content' });
```

### Error Handling

```typescript
bridge.on('error', (error) => {
  console.error('Bridge error:', error);
  
  // Attempt reconnection
  if (error.type === 'connection-lost') {
    bridge.reconnect();
  }
});

// Handle timeout errors
bridge.request('shell.data.query', query, { timeout: 10000 })
  .catch(error => {
    if (error.type === 'timeout') {
      console.warn('Request timed out');
    }
  });
```

### Debugging

```typescript
const bridge = new ViewBridge({
  debug: true,
  logger: {
    log: console.log,
    warn: console.warn,
    error: console.error
  }
});

// Enable message tracing
bridge.enableTrace('all'); // 'all', 'sent', 'received', or 'errors'
```

## Integration

This package is used by:
- **Shell**: For managing iframe-based views
- **Views**: For communicating with the shell from sandboxed environments
- **SDK**: As the underlying transport layer

## CSP Compatibility

The View SDK is designed to work with strict Content Security Policies:

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               frame-src 'self' https://*.bobbinry.com;
               script-src 'self' 'unsafe-eval';
               connect-src 'self' https://api.bobbinry.com;">
```

## Contributing

1. Maintain security-first approach for all new features
2. Add tests for message validation and security checks
3. Update type definitions for new message types
4. Test across different browsers and iframe scenarios
5. Document any CSP implications of new features