# Phase 7: Authentication, Project Dashboard & Collections

## Overview
Implement user authentication, a Campfire-style project dashboard, project collections/series management, and short URL support for projects.

## Features

### 1. Authentication Flow
- Login/signup pages with Auth.js (NextAuth)
- Protected route middleware
- Redirect unauthenticated users to login page
- Post-login redirect to last visited page or project list
- Session management with JWT

### 2. Project Short URLs (Paid Feature)
- Optional custom short URLs for projects (e.g., `/p/my-novel`)
- Automatic 6-8 character code generation
- Route mapping: `/p/abc123` → project UUID
- Reserved words blacklist (admin, api, public, login, etc.)
- Custom short URLs for premium users
- Automatic fallback to UUID if no short URL claimed

### 3. Project Collections/Series
**Purpose**: Group related projects (e.g., Book 1, Book 2, Book 3 of a series)

**Features**:
- Create named collections (e.g., "My Fantasy Series")
- Add/remove projects from collections
- Reorder projects within collections
- Collection metadata: name, description, cover image
- Optional short URLs for collections (`/c/fantasy-series`)
- View all projects in a collection
- Analytics across entire collection

### 4. Campfire-Style Project Dashboard

```
┌─────────────────────────────────────┬──────────────────────┐
│  My Projects                        │  Recent Activity     │
│                                      │                      │
│  📚 My Fantasy Series (3)           │  ┌─────────────────┐ │
│  ├─ 📘 Book 1: Origins              │  │ Book 2, Ch 5    │ │
│  │  Last edited: 2h ago             │  │ 2 minutes ago   │ │
│  │  23 chapters • 87k words         │  │                 │ │
│  ├─ 📘 Book 2: Journey              │  │ Book 1, Ch 12   │ │
│  │  Last edited: 1h ago             │  │ 1 hour ago      │ │
│  │  15 chapters • 52k words         │  │                 │ │
│  └─ 📘 Book 3: Return (Draft)       │  │ Short Story #3  │ │
│     Last edited: 3d ago             │  │ 3 days ago      │ │
│     5 chapters • 18k words          │  └─────────────────┘ │
│                                      │                      │
│  📂 Standalone Projects (2)         │  Quick Actions       │
│  ├─ 📗 Short Story Collection       │  • New Project       │
│  │  Last edited: 1d ago             │  • New Collection    │
│  │  12 stories • 34k words          │  • Import Project    │
│  └─ 📙 Blog Posts                   │                      │
│     Last edited: 5d ago             │                      │
│     48 posts • 102k words           │                      │
└─────────────────────────────────────┴──────────────────────┘
```

**Left Panel Features**:
- Grouped by collection (expandable/collapsible)
- "Uncategorized" section for standalone projects
- Drag-and-drop to reorder within collections
- Drag-and-drop to move between collections
- Search across all projects
- Filter: All / Collections / Standalone / Archived
- Sort: Recent, Name, Created Date, Word Count

**Right Panel Features**:
- Recent activity feed across all projects
- Shows last edited chapters with timestamps
- Click to jump directly to chapter editor
- Filter by project/collection
- "Continue where you left off" quick action
- Recently archived or deleted items (undo)

## Database Schema

### New Tables

```sql
-- Project collections (series)
CREATE TABLE project_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  short_url VARCHAR(12) UNIQUE,
  cover_image VARCHAR(500),
  color_theme VARCHAR(20),  -- For UI color coding
  is_public BOOLEAN DEFAULT FALSE,  -- For future sharing features
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_collections_user ON project_collections(user_id);
CREATE INDEX idx_collections_short_url ON project_collections(short_url);

-- Project membership in collections
CREATE TABLE project_collection_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES project_collections(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(collection_id, project_id)
);

CREATE INDEX idx_memberships_collection ON project_collection_memberships(collection_id);
CREATE INDEX idx_memberships_project ON project_collection_memberships(project_id);
CREATE INDEX idx_memberships_order ON project_collection_memberships(collection_id, order_index);
```

### Schema Modifications

```sql
-- Add short URL support to projects
ALTER TABLE projects ADD COLUMN short_url VARCHAR(12) UNIQUE;
ALTER TABLE projects ADD COLUMN short_url_claimed_at TIMESTAMP;
CREATE INDEX idx_projects_short_url ON projects(short_url);

-- Track last edited time for recent activity
ALTER TABLE entities ADD COLUMN last_edited_at TIMESTAMP DEFAULT NOW();
ALTER TABLE entities ADD COLUMN last_edited_by UUID REFERENCES users(id);
CREATE INDEX idx_entities_last_edited ON entities(last_edited_at DESC);
CREATE INDEX idx_entities_project_edited ON entities(project_id, last_edited_at DESC);

-- Add archiving support
ALTER TABLE projects ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN archived_at TIMESTAMP;
CREATE INDEX idx_projects_user_archived ON projects(user_id, is_archived);
```

## API Endpoints

### Collections
- `GET /api/users/me/collections` - List user's collections with project counts
- `POST /api/collections` - Create new collection
- `GET /api/collections/:collectionId` - Get collection details
- `PUT /api/collections/:collectionId` - Update collection metadata
- `DELETE /api/collections/:collectionId` - Delete collection
- `GET /api/collections/:collectionId/projects` - Get projects in collection (ordered)
- `GET /api/collections/:collectionId/stats` - Get aggregate stats for collection

### Collection Membership
- `POST /api/collections/:collectionId/projects/:projectId` - Add project to collection
- `DELETE /api/collections/:collectionId/projects/:projectId` - Remove project from collection
- `PUT /api/collections/:collectionId/projects/reorder` - Reorder projects (pass array of project IDs)

### Projects
- `GET /api/users/me/projects` - User's projects (includes collection info)
- `GET /api/users/me/projects/grouped` - Projects grouped by collection
- `GET /api/users/me/recent-activity` - Recent edits across all projects (last 50)
- `PUT /api/projects/:projectId/archive` - Archive a project
- `PUT /api/projects/:projectId/unarchive` - Unarchive a project

### Short URLs
- `POST /api/projects/:projectId/short-url` - Generate or claim short URL
- `DELETE /api/projects/:projectId/short-url` - Release short URL
- `GET /p/:shortUrl` - Resolve project short URL (redirect)
- `POST /api/collections/:collectionId/short-url` - Generate collection short URL
- `GET /c/:shortUrl` - Resolve collection short URL (redirect)
- `POST /api/short-urls/check` - Check if short URL is available

### Dashboard
- `GET /api/dashboard/stats` - Overall user stats (total projects, words, chapters, etc.)
- `GET /api/dashboard/activity` - Recent activity feed with rich context

## Frontend Components

### Pages
- `/login` - Login page
- `/signup` - Signup page
- `/dashboard` - Main project dashboard (protected)
- `/p/:shortUrl` - Project shortcut (redirect to `/projects/:id`)
- `/c/:shortUrl` - Collection shortcut (redirect to collection view)

### Components
- `CollectionCard` - Display collection with nested projects
- `CollectionManager` - Modal for creating/editing collections
- `ProjectCard` - Enhanced with collection badge, series position
- `ProjectGroupView` - Collapsible, grouped project list
- `RecentActivityPanel` - Right sidebar activity feed
- `DragDropReorder` - Reordering UI for projects
- `CollectionBadge` - Small indicator showing collection membership
- `ShortUrlManager` - UI for claiming/managing short URLs
- `ProtectedRoute` - Auth wrapper component

### Hooks
- `useAuth` - Authentication state and actions
- `useCollections` - Fetch and manage collections
- `useProjects` - Fetch user projects
- `useRecentActivity` - Fetch recent activity feed
- `useDragDrop` - Drag and drop logic for reordering

## Implementation Order

1. **Database Schema** (Day 1)
   - Add migrations for new tables and columns
   - Update Drizzle schema definitions

2. **Backend API** (Days 2-3)
   - Collections CRUD endpoints
   - Short URL management
   - User dashboard endpoints
   - Recent activity aggregation

3. **Authentication** (Day 4)
   - Configure Auth.js/NextAuth
   - Protected route middleware
   - Login/signup pages
   - Session management

4. **Frontend Dashboard** (Days 5-6)
   - Dashboard layout
   - Project list with collections
   - Recent activity panel
   - Search and filters

5. **Drag & Drop** (Day 7)
   - Reordering within collections
   - Moving between collections
   - Visual feedback

6. **Polish** (Day 8)
   - Loading states
   - Error handling
   - Empty states
   - Animations

## Future Enhancements

- Share collections publicly
- Collaborative collections (multiple authors)
- Collection templates (e.g., trilogy, anthology)
- Export entire collection
- Collection-wide search
- Cross-project character/location tracking
- Collection analytics dashboard

## Notes

- Short URLs are a paid feature (check user subscription tier)
- Free tier gets auto-generated 6-8 char codes
- Premium tier can customize short URLs
- Reserved words: admin, api, app, auth, blog, dashboard, docs, help, login, logout, public, settings, support, terms, privacy
- All timestamps in UTC
- Recent activity limited to last 100 items
- Soft delete for collections (mark inactive, don't hard delete immediately)
