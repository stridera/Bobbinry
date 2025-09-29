# @bobbinry/connectors

First-party connectors for external integrations (drive, webhook, etc.) in Bobbinry.

## Purpose

This package provides secure, standardized connectors for integrating Bobbinry with external services. It enables bobbins to interact with cloud storage, receive webhooks, sync with external APIs, and more while maintaining security and consistency.

## Features

- **Cloud Storage**: Google Drive, Dropbox, OneDrive integration
- **Webhooks**: Receive and process external webhook events
- **API Integrations**: Connect to REST APIs, GraphQL endpoints
- **File Sync**: Bidirectional file synchronization
- **Authentication**: OAuth2, API key, and token-based auth
- **Rate Limiting**: Built-in rate limiting and retry logic

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
├── base/             # Base connector interfaces
├── storage/          # Cloud storage connectors
│   ├── google-drive.ts
│   ├── dropbox.ts
│   └── onedrive.ts
├── webhooks/         # Webhook handlers
├── api/              # API connectors
└── auth/             # Authentication utilities
```

## Available Connectors

### Cloud Storage

#### Google Drive

```typescript
import { GoogleDriveConnector } from '@bobbinry/connectors';

const drive = new GoogleDriveConnector({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: 'https://app.bobbinry.com/auth/google/callback'
});

// Upload file
const file = await drive.upload('/manuscripts/novel.docx', fileBuffer);

// Download file
const content = await drive.download(fileId);

// Sync folder
await drive.syncFolder('/manuscripts', localPath);
```

#### Dropbox

```typescript
import { DropboxConnector } from '@bobbinry/connectors';

const dropbox = new DropboxConnector({
  accessToken: userToken
});

// List files
const files = await dropbox.listFiles('/Apps/Bobbinry');

// Upload with versioning
await dropbox.upload('/manuscripts/draft.md', content, {
  mode: 'add',
  autorename: true
});
```

### Webhooks

```typescript
import { WebhookConnector } from '@bobbinry/connectors';

const webhook = new WebhookConnector({
  secret: process.env.WEBHOOK_SECRET,
  endpoints: {
    '/webhooks/github': 'github',
    '/webhooks/notion': 'notion'
  }
});

// Handle GitHub webhook
webhook.on('github.push', (event) => {
  // Update manuscript from repository
  updateManuscriptFromRepo(event.repository, event.commits);
});

// Handle Notion webhook
webhook.on('notion.page.updated', (event) => {
  // Sync changes from Notion
  syncNotionPage(event.page_id, event.properties);
});
```

### API Integrations

#### REST API Connector

```typescript
import { RestAPIConnector } from '@bobbinry/connectors';

const api = new RestAPIConnector({
  baseURL: 'https://api.example.com',
  auth: {
    type: 'bearer',
    token: process.env.API_TOKEN
  },
  rateLimit: {
    requests: 100,
    window: 60000 // 1 minute
  }
});

// Make authenticated requests
const data = await api.get('/manuscripts', {
  params: { status: 'published' }
});

await api.post('/manuscripts', manuscriptData);
```

#### GraphQL Connector

```typescript
import { GraphQLConnector } from '@bobbinry/connectors';

const graphql = new GraphQLConnector({
  endpoint: 'https://api.example.com/graphql',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// Execute queries
const result = await graphql.query(`
  query GetManuscripts($filter: ManuscriptFilter) {
    manuscripts(filter: $filter) {
      id
      title
      status
      chapters {
        id
        title
        content
      }
    }
  }
`, { filter: { published: true } });
```

## Authentication

### OAuth2 Flow

```typescript
import { OAuth2Handler } from '@bobbinry/connectors';

const oauth = new OAuth2Handler({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  authorizeURL: 'https://api.example.com/oauth/authorize',
  tokenURL: 'https://api.example.com/oauth/token',
  scope: ['read', 'write']
});

// Start OAuth flow
const authURL = oauth.getAuthorizationURL(state);

// Handle callback
const tokens = await oauth.handleCallback(code, state);

// Refresh token
const newTokens = await oauth.refreshToken(refreshToken);
```

### API Key Authentication

```typescript
import { APIKeyAuth } from '@bobbinry/connectors';

const auth = new APIKeyAuth({
  key: process.env.API_KEY,
  header: 'X-API-Key' // or 'Authorization'
});

// Use with connectors
const connector = new RestAPIConnector({
  baseURL: 'https://api.example.com',
  auth: auth
});
```

## Configuration

### Connector Registry

```typescript
import { ConnectorRegistry } from '@bobbinry/connectors';

const registry = new ConnectorRegistry();

// Register connectors
registry.register('google-drive', GoogleDriveConnector);
registry.register('dropbox', DropboxConnector);
registry.register('webhook', WebhookConnector);

// Create connector instances
const drive = registry.create('google-drive', config);
```

### Environment Configuration

```typescript
// .env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
DROPBOX_APP_KEY=your_dropbox_app_key
WEBHOOK_SECRET=your_webhook_secret
API_RATE_LIMIT=100
```

## Security Features

- **Credential Encryption**: All stored credentials are encrypted
- **Token Rotation**: Automatic refresh of expired tokens
- **Rate Limiting**: Per-connector and global rate limiting
- **Input Validation**: All external data is validated and sanitized
- **Audit Logging**: All connector activities are logged
- **Sandboxing**: Connectors run in isolated contexts

## Error Handling

```typescript
import { ConnectorError, RetryableError } from '@bobbinry/connectors';

try {
  await connector.upload(file);
} catch (error) {
  if (error instanceof RetryableError) {
    // Automatic retry with exponential backoff
    await connector.retry(() => connector.upload(file));
  } else if (error instanceof ConnectorError) {
    console.error('Connector error:', error.message);
  }
}
```

## Integration

This package is used by:
- **API Server**: For server-side external integrations
- **Shell**: For user-initiated connector actions
- **Compiler**: For publish-time integrations
- **Bobbins**: For bobbin-specific external connections

## Creating Custom Connectors

```typescript
import { BaseConnector, ConnectorConfig } from '@bobbinry/connectors';

class CustomConnector extends BaseConnector {
  constructor(config: ConnectorConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    // Implementation
  }

  async disconnect(): Promise<void> {
    // Implementation
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    // Implementation
  }
}

// Register custom connector
registry.register('custom', CustomConnector);
```

## Contributing

1. Follow the base connector interface patterns
2. Implement comprehensive error handling
3. Add rate limiting for all external calls
4. Include authentication flow documentation
5. Add integration tests with mock services
6. Document any required environment variables