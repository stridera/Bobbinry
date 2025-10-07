# Development History

This document tracks the major development phases of the Bobbinry platform, from initial scaffolding to the current MVP state.

## Current Status: Phase 8 Complete (MVP Ready)

The platform now supports the complete user journey from authentication through project creation, bobbin installation, and content editing.

---

## Phase 1: Initial Scaffolding
- Monorepo setup with pnpm workspaces and Turbo
- Database schema with Drizzle ORM
- Core manifest compiler architecture
- Basic bobbin examples (Manuscript, Corkboard, Dictionary)

## Phase 2: User Management API
**Focus**: User profiles and account management

**Key Features**:
- User profile management (bio, avatar, social links)
- Username validation and uniqueness
- Profile update endpoints
- Social platform integration fields

**Endpoints**:
- `GET/PUT /api/users/:userId/profile` - Profile CRUD

## Phase 3: Payment & Subscriptions
**Focus**: Monetization infrastructure

**Key Features**:
- Subscription management system
- Stripe integration (webhook-ready)
- Tier-based subscriptions
- Discount code validation
- Subscriber relationship tracking

**Endpoints**:
- `GET /api/users/:userId/subscriptions` - List subscriptions
- `POST /api/users/:userId/subscribe` - Create subscription
- `PUT/DELETE /api/subscriptions/:id` - Manage subscription
- `GET /api/authors/:authorId/subscribers` - Subscriber list

## Phase 4: Publishing Backend
**Focus**: Chapter publication workflow

**Key Features**:
- Chapter publication with versioning
- Publish snapshots and metadata
- Embargo management
- Destination synchronization
- Analytics tracking (views, completion rates)
- Access control (public, subscriber-only, tier-gated)

**Endpoints**:
- `POST /api/projects/:projectId/chapters/:chapterId/publish` - Publish chapter
- `POST /api/projects/:projectId/chapters/:chapterId/unpublish` - Unpublish chapter
- `GET /api/projects/:projectId/publications` - List publications
- `GET /api/projects/:projectId/chapters/:chapterId/publication` - Publication status

## Phase 5: Google Drive Bobbin
**Focus**: Google Drive integration for publishing

**Key Features**:
- OAuth flow for Google Drive access
- Chapter synchronization to Drive
- Batch sync operations
- Error handling and retry logic
- Token refresh management

**Endpoints**:
- `POST /api/projects/:projectId/google-drive/oauth/initiate` - Start OAuth
- `GET /api/google-drive/oauth/callback` - OAuth callback
- `POST /api/projects/:projectId/google-drive/sync` - Sync chapter
- `POST /api/projects/:projectId/google-drive/sync/batch` - Batch sync

## Phase 6: Core Bobbins & SDK
**Focus**: Essential bobbins and developer experience

**Bobbins Implemented**:
- **Manuscript**: Writing system with books, chapters, scenes
- **Corkboard**: Visual organization with drag & drop
- **Dictionary**: Glossary and terminology management
- **Debugger**: Developer tools for message bus inspection

**SDK Enhancements**:
- Entity management hooks (useEntityList, useCreateEntity, useUpdateEntity, useDeleteEntity)
- Utility hooks (useDebounce, useLocalStorage, usePrevious, useClickOutside, useBoolean)
- Message bus for shell ↔ bobbin communication
- Theme system with light/dark mode

**Components**:
- UI components library (@bobbinry/ui-components)
- ResizablePanelStack for collapsible panels
- ViewRouter for view management

## Phase 7: Authentication & Dashboard
**Focus**: User authentication and project management UI

**Authentication**:
- NextAuth v5 with credentials provider
- Protected routes middleware
- Login/signup pages with auto-redirect
- Session management with JWT
- API endpoints for auth (`/api/auth/login`, `/api/auth/signup`, `/api/auth/session`)

**Collections System**:
- Database schema for series/groups
- Many-to-many project memberships
- Short URL support for collections
- 12 API endpoints for collection management
- Drag & drop reordering

**Dashboard UI** (Campfire-style):
- Project cards with metadata
- Recent activity feed
- Collections grouping with drag & drop
- Archive/unarchive functionality
- Short URL management
- Search and filtering
- Empty states and loading skeletons

**Database Enhancements**:
- `project_collections` table
- `project_collection_memberships` table
- `projects`: added `short_url`, `is_archived`, `archived_at`
- `entities`: added `last_edited_at`, `last_edited_by`

**API Endpoints** (22 total):
- Authentication: 3 endpoints
- Collections: 12 endpoints
- Dashboard: 10 endpoints

## Phase 8: Project Creation & Workspace (Current)
**Focus**: Complete user journey from creation to editing

**Project Creation**:
- Creation form with name and description
- Template system (Blank, Novel, Worldbuilding)
- Automatic bobbin installation based on template
- Auto-redirect to workspace after creation

**Project Workspace**:
- Project header with breadcrumb navigation
- Welcome screen for empty projects
- Bobbin marketplace (modal overlay)
- Conditional rendering based on bobbin installation
- Integration with existing ViewRouter

**Bobbin Marketplace**:
- Browse available bobbins
- One-click installation
- Installation status tracking
- Error handling with retry
- Shows installed vs available bobbins

**Project Settings**:
- General settings (name, description) with save
- Installed bobbins list with uninstall
- Archive/unarchive project
- Delete project (UI placeholder)
- Full breadcrumb navigation trail

**Navigation Integration**:
- Dashboard → Project creation
- Dashboard → Project workspace
- Project workspace → Settings
- Consistent breadcrumb navigation

**New API Endpoint**:
- `PUT /api/projects/:id` - Update project details

**File Structure**:
```
apps/shell/src/app/
├── projects/
│   ├── new/page.tsx                    # Project creation form
│   └── [projectId]/
│       ├── settings/page.tsx           # Project settings
│       └── components/
│           ├── ProjectHeader.tsx       # Header with breadcrumb
│           ├── BobbinMarketplace.tsx   # Bobbin installer
│           └── ProjectWelcome.tsx      # Empty state
```

---

## Key Architectural Decisions

### Tiered Storage
- **Tier 1 (Default)**: JSONB storage in unified `entities` table for fast installs
- **Tier 2 (Promoted)**: Dedicated physical tables for high-performance collections
- **Promotion triggers**: Row count >50K, P95 latency >200ms, index budget exceeded
- **Zero-downtime migrations** with automatic backfill and rollback

### Security
- Views run in sandboxed iframes with strict CSP
- External access disabled by default (requires explicit manifest declaration)
- All outbound calls routed through server-side egress proxy
- Provenance tracking for AI usage, external calls, and publish actions

### Message Bus
- Standardized envelope format for shell ↔ bobbin communication
- Type-safe message handling
- Event-driven architecture
- Support for both native and sandboxed execution modes

### Manifest System
- JSON Schema-validated YAML/JSON files
- Declarative data models with relationships
- UI view definitions (tree, editor, board, kanban)
- Interaction triggers and actions
- Capability flags (publishable, external, AI, custom views)

---

## MVP Completion Checklist

- ✅ User authentication and session management
- ✅ Project creation with templates
- ✅ Bobbin installation through UI
- ✅ Dashboard with collections
- ✅ Core editing bobbins (Manuscript, Corkboard, Dictionary)
- ✅ Project settings and management
- ✅ Theme system (light/dark mode)
- ✅ Developer tools and SDK
- ✅ Navigation and routing
- ⏳ Publishing system (backend ready, UI pending)
- ⏳ Reader experience (planned for Phase 9)
- ⏳ Analytics and insights (planned for Phase 9)

---

## Next Steps (Proposed Phase 9)

After completing the core project creation and workspace flow, potential next phases include:

1. **Publishing System UI**
   - Implement publishing bobbin frontend
   - Static site generation interface
   - Custom domains for short URLs
   - Analytics dashboard

2. **Reader Experience**
   - Public reading interface
   - Chapter navigation
   - Comments and engagement
   - Progress tracking

3. **Real-time Collaboration**
   - Multi-user editing
   - Presence indicators
   - Real-time sync with WebSockets

4. **Advanced Editor Features**
   - AI assistance (writing suggestions)
   - Version control/history
   - Advanced formatting tools

5. **Mobile Experience**
   - Responsive design improvements
   - Touch-optimized interfaces
   - Offline support

---

## Testing Status

### Manual Testing Coverage
- ✅ Authentication flow (login, signup, logout)
- ✅ Project creation with templates
- ✅ Bobbin installation/uninstallation
- ✅ Dashboard navigation
- ✅ Collections management
- ✅ Settings updates
- ✅ Archive/unarchive
- ✅ Error handling and edge cases

### Automated Testing
- Test framework to be established
- See individual package.json files for current test commands

---

## Deployment Readiness

### Environment Variables Required
See `.env.example` for complete list. Key variables:
- `DATABASE_URL` - PostgreSQL connection
- `NEXTAUTH_SECRET` - Auth signing key
- `NEXTAUTH_URL` - Application URL
- `NEXT_PUBLIC_API_URL` - API endpoint
- GitHub/Google OAuth credentials (optional)
- S3/MinIO storage configuration (optional)

### Infrastructure
- PostgreSQL 14+ database
- Node.js 18+ runtime
- Optional: MinIO/S3 for file storage
- Optional: Redis for session store

### Deployment Checklist
- ✅ All routes implemented and tested
- ✅ API endpoints working correctly
- ✅ Error handling in place
- ✅ Loading states implemented
- ✅ Navigation functional
- ⏳ Production testing needed
- ⏳ Performance testing under load
- ⏳ Security audit
