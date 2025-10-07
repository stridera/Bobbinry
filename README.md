# Bobbinry

A modular, open-source platform for writers and worldbuilders. Create projects, install powerful bobbins (modular extensions), and bring your stories to life.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- PostgreSQL 14+
- Docker & Docker Compose (optional, for local infrastructure)

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd bobbins
   pnpm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:
   - `DATABASE_URL` - PostgreSQL connection string
   - `NEXTAUTH_SECRET` - Random secret for session signing (generate with `openssl rand -base64 32`)
   - `NEXTAUTH_URL` - `http://localhost:3000` for local development
   - `NEXT_PUBLIC_API_URL` - `http://localhost:4000` for local development

3. **Start infrastructure** (optional - uses Docker)
   ```bash
   docker compose up -d  # Starts PostgreSQL + MinIO
   ```

   Or use your own PostgreSQL instance and update `DATABASE_URL` accordingly.

4. **Database migrations**

   Migrations run automatically when the API server starts. If you need to generate new migrations after schema changes:

   ```bash
   # Generate migration from schema changes
   pnpm --filter api db:generate

   # Migrations will apply automatically on next server start
   # Or manually apply with:
   pnpm --filter api db:migrate

   # Reset database (drops all tables, regenerates migrations)
   # WARNING: This destroys all data - use only in development!
   pnpm --filter api db:reset

   # Reset and seed with test users
   pnpm --filter api db:reset -- --seed

   # Seed test users into existing database
   pnpm --filter api db:seed
   ```

   **Test Users** (created by `db:seed`):
   - `test@bobbinry.dev` / `password123`
   - `alice@bobbinry.dev` / `password123`
   - `bob@bobbinry.dev` / `password123`

5. **Start development servers**
   ```bash
   # From project root
   pnpm dlx turbo run dev
   ```

   This starts:
   - Shell (Next.js frontend): http://localhost:3000
   - API (Fastify backend): http://localhost:4000

### First Time Setup

1. **Create an account**
   - Navigate to http://localhost:3000
   - Click "Sign up" and create your account
   - You'll be automatically logged in

2. **Create your first project**
   - Click "New Project" from the dashboard
   - Enter a name and description
   - Choose a template:
     - **Blank**: Empty project (install bobbins later)
     - **Novel**: Pre-installed with Manuscript bobbin
     - **Worldbuilding**: Manuscript + Corkboard bobbins

3. **Start creating**
   - Install additional bobbins from the marketplace
   - Use Manuscript for writing chapters and scenes
   - Use Corkboard for visual organization
   - Use Dictionary for glossary management

## 📚 Documentation

### Core Concepts

**Bobbins** are modular extensions that add functionality to your project. Each bobbin defines:
- Data structures (collections, fields, relationships)
- UI views (tree, editor, board, kanban)
- Interactions and workflows
- Publishing capabilities

**Projects** are workspaces where you install bobbins and create content. Each project can have multiple bobbins working together.

**Collections** let you group projects into series or categories for organization.

### Available Bobbins

- **Manuscript** - Complete writing system with books, chapters, and scenes
- **Corkboard** - Visual organization with drag-and-drop cards
- **Dictionary** - Glossary and terminology management
- **Debugger** - Developer tools for inspecting the message bus

### Architecture Documentation

- **[Development History](docs/DEVELOPMENT_HISTORY.md)** - Complete development timeline and feature list
- **[Execution Modes](docs/EXECUTION_MODES.md)** - How bobbins run (native vs sandboxed)
- **[View Routing](docs/VIEW_ROUTING_ARCHITECTURE.md)** - View management and navigation
- **[Manifest Security](docs/MANIFEST_SECURITY.md)** - Security model for bobbins
- **[Compiler Spec](docs/bobbinry_compiler_spec_tiered_storage.md)** - Tiered storage architecture
- **[Bobbin Development Guide](docs/BOBBIN_DEVELOPMENT_GUIDE.md)** - Creating custom bobbins

## 🛠️ Development

### Project Structure

```
bobbins/
├── apps/
│   ├── api/          # Fastify backend API
│   └── shell/        # Next.js frontend application
├── packages/
│   ├── compiler/     # Manifest compiler
│   ├── types/        # Shared TypeScript types
│   └── ui-components/# Shared UI component library
├── bobbins/          # Example bobbin manifests
├── infra/
│   └── db/          # Database migrations and schema
└── docs/            # Documentation
```

### Development Commands

```bash
# Install dependencies
pnpm install

# Run all development servers
pnpm dlx turbo run dev

# Build all packages
pnpm dlx turbo run build

# Type checking
pnpm dlx turbo run typecheck

# Linting
pnpm dlx turbo run lint

# Run tests (when available)
pnpm dlx turbo run test
```

### Working with Bobbins

Create a new bobbin using the template generator:

```bash
pnpm create-bobbin my-custom-bobbin
```

See **[Bobbin Development Guide](docs/BOBBIN_DEVELOPMENT_GUIDE.md)** for detailed instructions.

### Database Migrations

```bash
# Edit schema
vim apps/api/src/db/schema.ts

# Generate migration from schema changes
pnpm --filter api db:generate

# Migrations run automatically on server startup
# Or manually apply with:
pnpm --filter api db:migrate

# Push schema directly without migrations (dev only)
pnpm --filter api db:push

# Open Drizzle Studio to browse database
pnpm --filter api db:studio
```

**Note**: Migrations are automatically applied when the API server starts via `apps/api/src/db/migrate.ts`.

## 🔐 Authentication

Bobbinry uses NextAuth v5 for authentication with a credentials provider by default.

### Setting Up Authentication

1. **Generate secrets** (required for production):
   ```bash
   # NEXTAUTH_SECRET
   openssl rand -base64 32

   # API_JWT_SECRET (for API token validation)
   openssl rand -base64 32
   ```

2. **Configure OAuth providers** (optional):

   **GitHub OAuth**:
   - Create a GitHub OAuth app at https://github.com/settings/developers
   - Set callback URL to `http://localhost:3000/api/auth/callback/github`
   - Add to `.env`:
     ```
     GITHUB_ID=your_client_id
     GITHUB_SECRET=your_client_secret
     ```

   **Google OAuth**:
   - Create credentials at https://console.cloud.google.com/apis/credentials
   - Set authorized redirect URI to `http://localhost:3000/api/auth/callback/google`
   - Add to `.env`:
     ```
     GOOGLE_ID=your_client_id
     GOOGLE_SECRET=your_client_secret
     ```

3. **Default login**:
   - Email/password authentication works out of the box
   - User accounts stored in PostgreSQL
   - Passwords hashed with bcrypt

### Protected Routes

All routes except `/login` and `/signup` require authentication. Unauthenticated users are automatically redirected to the login page.

## 🗄️ Database Schema

### System Tables

- `users` - User accounts and authentication
- `user_profiles` - Extended user profile information
- `projects` - User projects and metadata
- `project_collections` - Series/groups of projects
- `project_collection_memberships` - Many-to-many project-collection relationships
- `bobbins_installed` - Installed bobbins per project
- `entities` - Unified storage for bobbin data (Tier 1)
- `manifests_versions` - Bobbin manifest version history

### Tiered Storage

Bobbinry uses a tiered storage architecture for optimal performance:

- **Tier 1 (Default)**: JSONB storage in `entities` table for fast installs
- **Tier 2 (Promoted)**: Dedicated physical tables for high-performance collections
- **Auto-promotion** based on: row count (>50K), latency (P95 >200ms), or index budget

See **[Compiler Spec](docs/bobbinry_compiler_spec_tiered_storage.md)** for details.

## 📦 Environment Variables

### Required

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bobbinry

# NextAuth (Shell)
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>

# API URLs
NEXT_PUBLIC_API_URL=http://localhost:4000

# JWT (API)
API_JWT_SECRET=<generate-with-openssl-rand-base64-32>
```

### Optional

```bash
# OAuth Providers
GITHUB_ID=
GITHUB_SECRET=
GOOGLE_ID=
GOOGLE_SECRET=

# Object Storage (S3/MinIO/R2)
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=auto
S3_BUCKET=bobbinry
S3_ACCESS_KEY=admin
S3_SECRET_KEY=adminadmin

# CORS / Origins
WEB_ORIGIN=http://localhost:3000
API_ORIGIN=http://localhost:4000

# Security
CSP_ENABLE_STRICT=true
```

## 🚢 Deployment

### Production Checklist

- [ ] Set strong `NEXTAUTH_SECRET` and `API_JWT_SECRET`
- [ ] Configure production `DATABASE_URL`
- [ ] Update `NEXTAUTH_URL` to production domain
- [ ] Set up OAuth providers (GitHub/Google)
- [ ] Configure S3/R2 for object storage
- [ ] Enable strict CSP (`CSP_ENABLE_STRICT=true`)
- [ ] Set up SSL/TLS certificates
- [ ] Configure CORS origins appropriately
- [ ] Run database migrations
- [ ] Build production assets: `pnpm dlx turbo run build`

### Infrastructure Requirements

- PostgreSQL 14+ database
- Node.js 18+ runtime
- 512MB+ RAM recommended
- Optional: S3-compatible object storage for file uploads
- Optional: Redis for session store (future enhancement)

## 🧪 Testing

Test framework is currently being established. Check individual `package.json` files for available test commands.

Manual testing coverage includes:
- Authentication flow (login, signup, logout)
- Project creation with templates
- Bobbin installation/uninstallation
- Dashboard and collections management
- Settings and project management
- Error handling and edge cases

## 🤝 Contributing

This is currently a scaffolding repository. Contribution guidelines will be added as the project matures.

### Development Workflow

1. Create a feature branch
2. Make changes with proper TypeScript types
3. Test manually (automated tests coming soon)
4. Submit pull request

### Code Standards

- TypeScript strict mode enabled
- Follow existing patterns in the monorepo
- Use Drizzle ORM for database operations
- Validate manifests against JSON Schema

## 📄 License

[License details to be added]

## 🔗 Links

- Documentation: `docs/`
- Example Manifests: `bobbins/`
- JSON Schema: `packages/types/manifest.schema.json`
- Development History: [docs/DEVELOPMENT_HISTORY.md](docs/DEVELOPMENT_HISTORY.md)

---

**Current Status**: Phase 8 Complete (MVP Ready)

The platform supports the complete user journey from authentication through project creation, bobbin installation, and content editing. See [Development History](docs/DEVELOPMENT_HISTORY.md) for detailed feature list and roadmap.
