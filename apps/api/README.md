# API

The Bobbinry API server - a Fastify-based backend that provides data management, authentication, and core platform services.

## Purpose

The API server is the backend foundation of Bobbinry, providing:
- RESTful API endpoints for data operations
- User authentication and authorization
- Database management with tiered storage
- Bobbin manifest compilation and installation
- Real-time updates and webhooks
- File storage and asset management

## Features

- **High Performance**: Built on Fastify for maximum speed
- **Type Safety**: Full TypeScript implementation with Zod validation
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Tiered Storage**: Automatic promotion from JSONB to physical tables
- **Authentication**: JWT-based auth with OAuth provider support
- **Rate Limiting**: Built-in rate limiting and security middleware
- **Real-time**: WebSocket support for live updates
- **Observability**: Structured logging with Pino

## Technology Stack

- **Framework**: Fastify 5.x
- **Language**: TypeScript
- **Database**: PostgreSQL 15+ with Drizzle ORM
- **Validation**: Zod for request/response validation
- **Authentication**: JWT with Auth.js integration
- **Logging**: Pino for structured logging
- **Migration**: Drizzle Kit for database migrations

## Development

### Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL 15+ (via Docker Compose recommended)

### Setup

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env

# Start PostgreSQL (if using Docker)
docker compose up -d postgres

# Run database migrations
pnpm db:migrate

# Start development server
pnpm dev

# The API will be available at http://localhost:4000
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/bobbinry

# Authentication
API_JWT_SECRET=your-jwt-secret-key
AUTH_TRUST_HOST=true

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Optional: Rate limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=900000

# Optional: Logging
LOG_LEVEL=info
```

### Available Scripts

```bash
# Development
pnpm dev          # Start development server with hot reload on port 4000

# Building
pnpm build        # Compile TypeScript to JavaScript
pnpm start        # Start production server

# Database
pnpm db:generate  # Generate database schema from models
pnpm db:migrate   # Run pending database migrations
pnpm db:reset     # Reset database (destructive)

# Quality Assurance
pnpm typecheck    # Run TypeScript compiler check
pnpm test         # Run Jest tests
pnpm test:watch   # Run tests in watch mode
```

## Project Structure

```
src/
├── index.ts              # Application entry point
├── server.ts             # Fastify server setup
├── db/                   # Database configuration
│   ├── connection.ts     # Database connection setup
│   ├── schema.ts         # Drizzle schema definitions
│   └── migrations/       # Database migration files
├── routes/               # API route handlers
│   ├── auth.ts          # Authentication endpoints
│   ├── projects.ts      # Project management endpoints
│   ├── entities.ts      # Entity CRUD endpoints
│   ├── views.ts         # View configuration endpoints
│   └── bobbins.ts       # Bobbin management endpoints
├── middleware/           # Custom middleware
│   ├── auth.ts          # JWT authentication middleware
│   ├── validation.ts    # Request validation middleware
│   └── cors.ts          # CORS configuration
├── services/            # Business logic services
│   ├── auth-service.ts  # Authentication service
│   ├── entity-service.ts # Entity management service
│   └── bobbin-service.ts # Bobbin compilation service
└── types/               # TypeScript type definitions
    ├── api.ts           # API request/response types
    └── auth.ts          # Authentication types
```

## API Endpoints

### Authentication

```bash
# Register new user
POST /auth/register
Content-Type: application/json
{
  "email": "user@example.com",
  "password": "secure-password",
  "name": "User Name"
}

# Sign in
POST /auth/signin
Content-Type: application/json
{
  "email": "user@example.com",
  "password": "secure-password"
}

# Refresh token
POST /auth/refresh
Authorization: Bearer <refresh-token>
```

### Projects

```bash
# List user projects
GET /projects
Authorization: Bearer <token>

# Create new project
POST /projects
Authorization: Bearer <token>
Content-Type: application/json
{
  "name": "My Novel",
  "description": "A fantasy adventure"
}

# Get project details
GET /projects/:id
Authorization: Bearer <token>

# Update project
PATCH /projects/:id
Authorization: Bearer <token>
Content-Type: application/json
{
  "name": "Updated Title"
}

# Delete project
DELETE /projects/:id
Authorization: Bearer <token>
```

### Entities

```bash
# List entities in a collection
GET /projects/:projectId/entities/:collection
Authorization: Bearer <token>
Query Parameters:
  - filter: JSON filter object
  - sort: Sort specification
  - limit: Number of results
  - offset: Pagination offset

# Create entity
POST /projects/:projectId/entities/:collection
Authorization: Bearer <token>
Content-Type: application/json
{
  "data": {
    "title": "Chapter 1",
    "content": "Once upon a time..."
  }
}

# Get entity by ID
GET /projects/:projectId/entities/:collection/:id
Authorization: Bearer <token>

# Update entity
PATCH /projects/:projectId/entities/:collection/:id
Authorization: Bearer <token>
Content-Type: application/json
{
  "data": {
    "title": "Updated Chapter 1"
  }
}

# Delete entity
DELETE /projects/:projectId/entities/:collection/:id
Authorization: Bearer <token>
```

### Bobbins

```bash
# List installed bobbins for project
GET /projects/:projectId/bobbins
Authorization: Bearer <token>

# Install bobbin
POST /projects/:projectId/bobbins
Authorization: Bearer <token>
Content-Type: application/json
{
  "manifestUrl": "https://registry.bobbinry.com/manuscript/1.0.0/manifest.yaml"
}

# Get bobbin configuration
GET /projects/:projectId/bobbins/:bobbinId
Authorization: Bearer <token>

# Update bobbin configuration
PATCH /projects/:projectId/bobbins/:bobbinId
Authorization: Bearer <token>
Content-Type: application/json
{
  "config": {
    "enableSpellCheck": true
  }
}

# Uninstall bobbin
DELETE /projects/:projectId/bobbins/:bobbinId
Authorization: Bearer <token>
```

## Database Schema

### Core Tables

```typescript
// src/db/schema.ts
import { pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

// Tier 1 storage: JSONB entities table
export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  collection: text('collection').notNull(),
  data: jsonb('data').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const bobbinsInstalled = pgTable('bobbins_installed', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  bobbinId: text('bobbin_id').notNull(),
  version: text('version').notNull(),
  config: jsonb('config'),
  installedAt: timestamp('installed_at').defaultNow()
});
```

### Tiered Storage

The API implements a tiered storage system that automatically promotes collections from JSONB to physical tables:

```typescript
// Tier 2: Physical tables (auto-generated by compiler)
export const manuscriptBooks = pgTable('manuscript_books', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').references(() => projects.id),
  title: text('title').notNull(),
  author: text('author'),
  genre: text('genre'),
  wordCount: integer('word_count'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});
```

## Services

### Entity Service

Handles CRUD operations with automatic tier detection:

```typescript
// src/services/entity-service.ts
export class EntityService {
  async create(projectId: string, collection: string, data: any) {
    const tier = await this.getStorageTier(projectId, collection);
    
    if (tier === 'physical') {
      return this.createInPhysicalTable(projectId, collection, data);
    } else {
      return this.createInEntitiesTable(projectId, collection, data);
    }
  }

  async list(projectId: string, collection: string, options: QueryOptions) {
    const tier = await this.getStorageTier(projectId, collection);
    
    if (tier === 'physical') {
      return this.queryPhysicalTable(projectId, collection, options);
    } else {
      return this.queryEntitiesTable(projectId, collection, options);
    }
  }
}
```

### Authentication Service

JWT-based authentication with refresh tokens:

```typescript
// src/services/auth-service.ts
export class AuthService {
  async signIn(email: string, password: string) {
    const user = await this.validateUser(email, password);
    
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);
    
    return { accessToken, refreshToken, user };
  }

  async refreshToken(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);
    const user = await this.getUser(payload.sub);
    
    const newAccessToken = this.generateAccessToken(user);
    return { accessToken: newAccessToken };
  }
}
```

## Middleware

### Authentication Middleware

```typescript
// src/middleware/auth.ts
export async function authMiddleware(request: FastifyRequest) {
  const token = request.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('Authentication required');
  }

  try {
    const payload = jwt.verify(token, process.env.API_JWT_SECRET!);
    request.user = await getUserById(payload.sub);
  } catch (error) {
    throw new Error('Invalid token');
  }
}
```

### Validation Middleware

```typescript
// src/middleware/validation.ts
import { z } from 'zod';

export function validateBody<T>(schema: z.ZodSchema<T>) {
  return async (request: FastifyRequest) => {
    try {
      request.body = schema.parse(request.body);
    } catch (error) {
      throw new Error('Validation failed');
    }
  };
}

// Usage
const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional()
});

fastify.post('/projects', {
  preHandler: [authMiddleware, validateBody(createProjectSchema)]
}, async (request, reply) => {
  // Handler implementation
});
```

## Testing

### Unit Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test services/entity-service.test.ts

# Run tests in watch mode
pnpm test:watch
```

### API Testing

```typescript
// src/__tests__/projects.test.ts
import { build } from '../server';

describe('/projects endpoints', () => {
  let app: any;

  beforeAll(async () => {
    app = build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a new project', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {
        authorization: 'Bearer valid-token'
      },
      payload: {
        name: 'Test Project',
        description: 'A test project'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toMatchObject({
      name: 'Test Project',
      description: 'A test project'
    });
  });
});
```

## Error Handling

```typescript
// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  if (error.validation) {
    reply.status(400).send({
      error: 'Validation Error',
      message: error.message,
      details: error.validation
    });
  } else if (error.statusCode) {
    reply.status(error.statusCode).send({
      error: error.name,
      message: error.message
    });
  } else {
    reply.status(500).send({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    });
  }
});
```

## Deployment

### Production Build

```bash
# Build for production
pnpm build

# Start production server
pnpm start
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN pnpm install --frozen-lockfile --prod
COPY . .
RUN pnpm build
EXPOSE 4000
CMD ["pnpm", "start"]
```

### Environment Configuration

```bash
# Production environment variables
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://user:pass@prod-db:5432/bobbinry
API_JWT_SECRET=production-jwt-secret
LOG_LEVEL=warn
RATE_LIMIT_MAX=1000
```

## Contributing

1. Follow RESTful API conventions
2. Add comprehensive input validation with Zod
3. Include authentication checks for protected endpoints
4. Write tests for all new endpoints and services
5. Use structured logging for debugging
6. Update API documentation when adding new endpoints

## Performance Considerations

- **Connection Pooling**: PostgreSQL connection pool configured for high concurrency
- **Query Optimization**: Use indexes and efficient queries with Drizzle ORM
- **Caching**: Implement Redis caching for frequently accessed data
- **Rate Limiting**: Protect against abuse with configurable rate limits
- **Pagination**: All list endpoints support pagination to handle large datasets