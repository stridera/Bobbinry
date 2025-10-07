# Phase 8 Plan: Project Creation & Workspace

## Overview
Complete the core user journey by implementing project creation UI and workspace management, bridging the gap between the dashboard (Phase 7) and the existing project infrastructure.

## Critical Gap Identified
- ✅ Dashboard implemented with "New Project" button
- ❌ `/projects/new` route doesn't exist
- ✅ Project API endpoints exist (`POST /projects`, `POST /projects/:id/bobbins/install`)
- ✅ Project workspace exists (`/projects/[projectId]`) with ViewRouter
- ❌ No UI for creating projects or installing bobbins
- ❌ Dashboard project cards don't link to workspace

## Phase 8 Goals

### 1. Project Creation Flow
**Route**: `/apps/shell/src/app/projects/new/page.tsx`

**Features**:
- Form with project name and description
- Template selection (optional):
  - Blank project
  - Novel template (pre-install Manuscript bobbin)
  - Worldbuilding template (Manuscript + Corkboard)
- User feedback (loading states, validation)
- Auto-redirect to project workspace after creation

**API Integration**:
- `POST /api/projects` - Create project
- Return project ID for redirect

### 2. Project Workspace Enhancement
**Route**: `/apps/shell/src/app/projects/[projectId]/page.tsx` (exists, needs UI polish)

**Add Missing Features**:
- **Welcome screen** for empty projects (no bobbins installed)
- **Bobbin marketplace** - Browse and install available bobbins
- **Quick actions** - Settings, share, export
- **Project header** - Name, breadcrumb navigation
- **Status indicators** - Loading, errors, empty states

**Components to Create**:
- `ProjectHeader.tsx` - Project name, breadcrumb, actions
- `BobbinMarketplace.tsx` - Browse and install bobbins
- `ProjectWelcome.tsx` - Empty state with getting started guide

### 3. Bobbin Installation UI
**Component**: `BobbinMarketplace.tsx`

**Features**:
- List available bobbins from `/bobbins/` directory
- Show bobbin details (name, description, capabilities)
- One-click installation
- Show installed bobbins with uninstall option
- Loading states during installation
- Success/error feedback

**API Integration**:
- `GET /api/projects/:projectId/bobbins` - List installed
- `POST /api/projects/:projectId/bobbins/install` - Install bobbin
- `DELETE /api/projects/:projectId/bobbins/:bobbinId` - Uninstall

### 4. Project Settings
**Route**: `/apps/shell/src/app/projects/[projectId]/settings/page.tsx`

**Settings Sections**:
- **General**: Project name, description, archive
- **Bobbins**: Manage installed bobbins
- **Publishing**: Short URL, public/private settings
- **Danger Zone**: Delete project, transfer ownership

### 5. Navigation Integration
**Updates Needed**:
- Dashboard `ProjectCard.tsx` - Add `href` to link to workspace
- Project workspace - Add "Back to Dashboard" breadcrumb
- Shell layout - Update navigation based on current route

## Database Schema (No Changes Needed)
Phase 7 already added all necessary fields:
- `projects` table has all fields
- `bobbins_installed` table exists
- `entities` table ready for bobbin data

## API Endpoints (Existing)
All necessary endpoints already exist:
- ✅ `POST /api/projects` - Create project
- ✅ `GET /api/projects` - List projects
- ✅ `GET /api/projects/:id` - Get project details
- ✅ `POST /api/projects/:id/bobbins/install` - Install bobbin
- ✅ `GET /api/projects/:id/bobbins` - List installed bobbins
- ✅ `DELETE /api/projects/:id/bobbins/:bobbinId` - Uninstall bobbin

## File Structure

### New Files to Create
```
apps/shell/src/app/
├── projects/
│   ├── new/
│   │   └── page.tsx                          # Project creation form
│   └── [projectId]/
│       ├── settings/
│       │   └── page.tsx                      # Project settings
│       └── components/
│           ├── ProjectHeader.tsx             # Header with breadcrumb
│           ├── BobbinMarketplace.tsx         # Bobbin browser/installer
│           └── ProjectWelcome.tsx            # Empty state guide

apps/shell/src/components/
└── BobbinCard.tsx                            # Reusable bobbin display card
```

### Files to Modify
```
apps/shell/src/app/dashboard/
├── ProjectCard.tsx                           # Add link to workspace
└── DashboardContent.tsx                      # Update button href

apps/shell/src/app/projects/[projectId]/
└── page.tsx                                  # Add header, welcome screen
```

## User Journey

### Current State (Broken)
1. User logs in → Dashboard
2. Clicks "New Project" → 404 (route doesn't exist)
3. Even if project existed, can't access it from dashboard

### Phase 8 (Fixed)
1. User logs in → Dashboard
2. Clicks "New Project" → Project creation form
3. Fills form, selects template → Project created
4. Auto-redirected to project workspace
5. Sees welcome screen with bobbin marketplace
6. Installs Manuscript bobbin → Editor appears
7. Can navigate back to dashboard, reopen project

## Implementation Phases

### Phase 8.1: Project Creation (Priority: Critical)
- [ ] Create `/projects/new` page with form
- [ ] Wire up to `POST /api/projects` endpoint
- [ ] Add template selection
- [ ] Implement auto-redirect after creation
- [ ] Update dashboard button to point to new route

### Phase 8.2: Workspace Polish (Priority: High)
- [ ] Add project header component
- [ ] Create welcome screen for empty projects
- [ ] Add breadcrumb navigation
- [ ] Link dashboard cards to workspace

### Phase 8.3: Bobbin Marketplace (Priority: High)
- [ ] Create bobbin marketplace component
- [ ] Scan `/bobbins/` directory for available bobbins
- [ ] Implement one-click installation
- [ ] Show installed bobbins list
- [ ] Add uninstall functionality

### Phase 8.4: Project Settings (Priority: Medium)
- [ ] Create settings page
- [ ] Implement general settings (name, description)
- [ ] Add bobbin management section
- [ ] Add archive/delete functionality

## Technical Considerations

### Template System
Templates can pre-install bobbins:
```typescript
const templates = {
  blank: { bobbins: [] },
  novel: { bobbins: ['manuscript'] },
  worldbuilding: { bobbins: ['manuscript', 'corkboard'] }
}
```

### Bobbin Discovery
Scan manifest files in `/bobbins/` directory:
```typescript
const availableBobbins = await fetch('/api/bobbins/available')
// Returns list of manifest files with metadata
```

### Loading States
- Project creation: Show spinner, disable form
- Bobbin installation: Show progress, disable marketplace
- Navigation: Use Next.js loading.tsx for route transitions

## Success Criteria

### Functional Requirements
- ✅ Users can create projects through UI
- ✅ Project creation supports templates
- ✅ Users can access projects from dashboard
- ✅ Users can install bobbins through UI
- ✅ Empty projects show helpful onboarding
- ✅ Navigation works between dashboard and projects

### UX Requirements
- ✅ Clear error messages for failures
- ✅ Loading states during async operations
- ✅ Confirmation dialogs for destructive actions
- ✅ Breadcrumb navigation for context
- ✅ Consistent styling with Phase 7 dashboard

## Testing Plan

### Manual Testing
- [ ] Create project from dashboard
- [ ] Create project with each template type
- [ ] Install bobbin from marketplace
- [ ] Uninstall bobbin
- [ ] Navigate back to dashboard
- [ ] Reopen project from dashboard
- [ ] Edit project settings
- [ ] Archive project
- [ ] Error handling (network failures, etc.)

### Edge Cases
- [ ] Creating project without bobbins
- [ ] Installing same bobbin twice
- [ ] Uninstalling bobbin with data
- [ ] Navigating with browser back/forward
- [ ] Concurrent bobbin installations

## Next Phase Suggestions (Phase 9)

After completing project creation and workspace:
1. **Real-time Collaboration** - Multi-user editing
2. **Publishing System** - Static site generation and hosting
3. **Advanced Editor Features** - AI assistance, version control
4. **Mobile App** - React Native companion

## Dependencies

### Existing (Already Implemented)
- ✅ API endpoints for projects and bobbins
- ✅ Database schema
- ✅ ViewRouter for rendering bobbin views
- ✅ SDK with BobbinryAPI
- ✅ Authentication and authorization

### New (Phase 8)
- UI components for project creation
- Bobbin marketplace UI
- Project settings page
- Enhanced navigation

## Estimated Effort
- Phase 8.1 (Project Creation): 2-3 hours
- Phase 8.2 (Workspace Polish): 2-3 hours
- Phase 8.3 (Bobbin Marketplace): 3-4 hours
- Phase 8.4 (Project Settings): 2-3 hours
- **Total**: 9-13 hours

## Notes
- This phase uses existing backend infrastructure from earlier phases
- No database migrations needed
- Focus is purely on frontend UX and wiring
- Completes the MVP user journey from login → create → edit → publish
