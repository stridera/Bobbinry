# Development Testing Guide

This guide provides test credentials, test scenarios, and verification steps for local development testing.

## Test User Accounts

**IMPORTANT**: The current authentication implementation uses NextAuth credentials provider, but password storage may not be fully implemented. You'll need to use the signup flow to create test accounts.

### Creating Test Accounts

1. Navigate to http://localhost:3000/signup
2. Create accounts with these credentials:

| Email | Password | Purpose |
|-------|----------|---------|
| `test@example.com` | `Test123!` | Basic testing account |
| `demo@bobbinry.com` | `Demo123!` | Demo writer account |
| `writer@bobbinry.com` | `Writer123!` | Active writer with projects |

### Alternative: Seed Database (if auth is incomplete)

If password auth isn't working, seed test users directly:

```bash
# Run seed script
docker exec -i $(docker ps -q -f name=postgres) psql -U bobbinry -d bobbinry < infra/db/seeds/dev-users.sql

# Verify users created
docker exec -i $(docker ps -q -f name=postgres) psql -U bobbinry -d bobbinry -c "SELECT email, name, id FROM users;"
```

**Note**: Seeded users won't have passwords. You may need to implement a dev-only auth bypass or use OAuth providers.

---

## Authentication Testing

### 1. Signup Flow

**Test Steps:**
1. Go to http://localhost:3000/signup
2. Enter email: `test@example.com`
3. Enter password: `Test123!`
4. Submit form

**Expected Results:**
- ✅ User created in database
- ✅ Automatically logged in
- ✅ Redirected to dashboard
- ✅ Session cookie set

**Verification:**
```bash
# Check user in database
docker exec -i $(docker ps -q -f name=postgres) psql -U bobbinry -d bobbinry -c "SELECT * FROM users WHERE email = 'test@example.com';"
```

### 2. Login Flow

**Test Steps:**
1. Go to http://localhost:3000/login
2. Enter email: `test@example.com`
3. Enter password: `Test123!`
4. Submit form

**Expected Results:**
- ✅ Authentication successful
- ✅ Redirected to dashboard
- ✅ Session persisted

### 3. Session Management

**Test Steps:**
1. Login successfully
2. Navigate to `/dashboard`
3. Refresh page
4. Close and reopen browser
5. Return to http://localhost:3000

**Expected Results:**
- ✅ Session persists across page refreshes
- ✅ Session persists across browser restarts
- ✅ Protected routes remain accessible
- ✅ Redirects to dashboard when already logged in

### 4. Protected Routes

**Test Steps:**
1. Logout (if logged in)
2. Try accessing:
   - http://localhost:3000/dashboard
   - http://localhost:3000/projects/new
   - Any `/projects/:id` URL

**Expected Results:**
- ✅ Redirected to `/login?callbackUrl=<requested-url>`
- ✅ After login, redirected to original URL

---

## Project & Bobbin Testing

### 1. Project Creation

**Test Steps:**
1. Login as `test@example.com`
2. Click "New Project" on dashboard
3. Enter project details:
   - Name: "Test Novel"
   - Description: "My first novel project"
4. Select template: "Novel" (installs Manuscript)
5. Submit

**Expected Results:**
- ✅ Project created in database
- ✅ Manuscript bobbin auto-installed
- ✅ Redirected to project workspace
- ✅ Manuscript editor appears

**Verification:**
```bash
# Check project created
docker exec -i $(docker ps -q -f name=postgres) psql -U bobbinry -d bobbinry -c "SELECT * FROM projects WHERE name = 'Test Novel';"

# Check bobbin installed
docker exec -i $(docker ps -q -f name=postgres) psql -U bobbinry -d bobbinry -c "SELECT * FROM bobbins_installed WHERE bobbin_id = 'manuscript';"
```

### 2. Bobbin Installation

**Test Steps:**
1. Create a blank project
2. Click "Browse Bobbins" on welcome screen
3. Install each bobbin:
   - Manuscript
   - Corkboard
   - Dictionary

**Expected Results:**
- ✅ Each bobbin installs without errors
- ✅ Bobbin UI appears in workspace
- ✅ Can switch between installed bobbins
- ✅ Data persists across page reloads

**API Verification:**
```bash
# Test bobbin installation API
curl -X POST http://localhost:4000/api/projects/PROJECT_ID/bobbins/install \
  -H "Content-Type: application/json" \
  -d '{
    "manifestPath": "bobbins/manuscript.manifest.yaml"
  }'
```

### 3. Bobbin Uninstallation

**Test Steps:**
1. Go to project settings
2. Find installed bobbin
3. Click "Uninstall"
4. Confirm action

**Expected Results:**
- ✅ Bobbin removed from project
- ✅ Views no longer appear
- ✅ Data preserved (not deleted)

---

## Publishing System Testing

### 1. Chapter Publication

**API Endpoint:** `POST /api/projects/:projectId/chapters/:chapterId/publish`

**Test Steps:**
```bash
# First, create a chapter entity (via Manuscript bobbin UI or API)
# Then publish it

curl -X POST http://localhost:4000/api/projects/PROJECT_ID/chapters/CHAPTER_ID/publish \
  -H "Content-Type: application/json" \
  -d '{
    "publishStatus": "published",
    "publishedVersion": "1.0"
  }'
```

**Expected Results:**
- ✅ Chapter publication record created
- ✅ Publish snapshot saved
- ✅ Timestamps set correctly
- ✅ Version number tracked

**Verification:**
```bash
# Check publication record
docker exec -i $(docker ps -q -f name=postgres) psql -U bobbinry -d bobbinry -c "SELECT * FROM chapter_publications WHERE chapter_id = 'CHAPTER_ID';"

# Check snapshot
docker exec -i $(docker ps -q -f name=postgres) psql -U bobbinry -d bobbinry -c "SELECT * FROM publish_snapshots WHERE entity_id = 'CHAPTER_ID';"
```

### 2. Publish Configuration

**API Endpoint:** `PUT /api/projects/:projectId/publish-config`

**Test Steps:**
```bash
curl -X PUT http://localhost:4000/api/projects/PROJECT_ID/publish-config \
  -H "Content-Type: application/json" \
  -d '{
    "publishingMode": "scheduled",
    "defaultVisibility": "subscribers",
    "enableComments": true,
    "moderationMode": "moderate"
  }'
```

**Expected Results:**
- ✅ Configuration saved
- ✅ Defaults applied for missing fields
- ✅ Settings persist across requests

### 3. Embargo Schedules

**API Endpoint:** `POST /api/projects/:projectId/embargoes`

**Test Steps:**
```bash
curl -X POST http://localhost:4000/api/projects/PROJECT_ID/embargoes \
  -H "Content-Type: application/json" \
  -d '{
    "entityId": "CHAPTER_ID",
    "publishMode": "tiered",
    "publicReleaseDate": "2025-11-01T00:00:00Z",
    "tierSchedules": [
      {
        "tierId": "TIER_ID",
        "releaseDate": "2025-10-25T00:00:00Z"
      }
    ]
  }'
```

**Expected Results:**
- ✅ Embargo created with tier schedules
- ✅ Access checks respect embargo dates
- ✅ Public release date enforced

### 4. Access Control

**API Endpoint:** `GET /api/projects/:projectId/chapters/:chapterId/access?userId=USER_ID`

**Test Scenarios:**

| User Type | Expected Access | Reason |
|-----------|----------------|--------|
| Anonymous (no userId) | Denied if embargo active | Public embargo not lifted |
| Anonymous (after embargo) | Allowed | Public release date passed |
| Beta Reader | Allowed | Beta reader access |
| Active Subscriber (Tier 1) | Allowed if tier embargo passed | Tier-specific release |
| Active Subscriber (Tier 2) | Allowed if tier embargo passed | Higher tier access |
| Non-subscriber | Denied | Requires subscription |

**Test Steps:**
```bash
# Anonymous access (should fail if embargoed)
curl http://localhost:4000/api/projects/PROJECT_ID/chapters/CHAPTER_ID/access

# Beta reader access
curl http://localhost:4000/api/projects/PROJECT_ID/chapters/CHAPTER_ID/access?userId=BETA_READER_ID

# Subscriber access
curl http://localhost:4000/api/projects/PROJECT_ID/chapters/CHAPTER_ID/access?userId=SUBSCRIBER_ID
```

### 5. Analytics Tracking

**API Endpoint:** `POST /api/chapters/:chapterId/views`

**Test Steps:**
```bash
# Track a view
curl -X POST http://localhost:4000/api/chapters/CHAPTER_ID/views \
  -H "Content-Type: application/json" \
  -d '{
    "readerId": "USER_ID",
    "sessionId": "SESSION_ID",
    "deviceType": "desktop"
  }'

# Update reading progress
curl -X PUT http://localhost:4000/api/chapter-views/VIEW_ID/progress \
  -H "Content-Type: application/json" \
  -d '{
    "lastPositionPercent": "75",
    "readTimeSeconds": "300",
    "completed": false
  }'

# Mark complete
curl -X PUT http://localhost:4000/api/chapter-views/VIEW_ID/progress \
  -H "Content-Type: application/json" \
  -d '{
    "lastPositionPercent": "100",
    "readTimeSeconds": "450",
    "completed": true
  }'
```

**Expected Results:**
- ✅ View count increments
- ✅ Reading progress tracked
- ✅ Completion count increments
- ✅ Analytics accessible via GET

**Get Analytics:**
```bash
# Chapter analytics
curl http://localhost:4000/api/projects/PROJECT_ID/chapters/CHAPTER_ID/analytics

# Project analytics
curl http://localhost:4000/api/projects/PROJECT_ID/analytics
```

---

## Dashboard & Collections Testing

### 1. Dashboard Load

**Test Steps:**
1. Login
2. Navigate to `/dashboard`
3. Observe:
   - Projects list
   - Recent activity
   - Collections (if any)

**Expected Results:**
- ✅ User's projects displayed
- ✅ Recent edits shown
- ✅ Empty state if no projects
- ✅ "New Project" CTA visible

### 2. Collections Management

**Test Steps:**
1. Create collection: "My Series"
2. Add projects to collection
3. Reorder projects (drag & drop)
4. Create short URL for collection
5. Access via short URL

**Expected Results:**
- ✅ Collection created
- ✅ Projects added to collection
- ✅ Order persists
- ✅ Short URL redirects correctly

**API Verification:**
```bash
# Create collection
curl -X POST http://localhost:4000/api/collections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Series",
    "description": "Test collection",
    "userId": "USER_ID"
  }'

# Add project to collection
curl -X POST http://localhost:4000/api/collections/COLLECTION_ID/projects/PROJECT_ID

# Reorder projects
curl -X PUT http://localhost:4000/api/collections/COLLECTION_ID/projects/reorder \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["PROJECT_ID_1", "PROJECT_ID_2", "PROJECT_ID_3"]
  }'
```

### 3. Short URLs

**Test Steps:**
1. Create short URL for project: `my-novel`
2. Access http://localhost:3000/p/my-novel
3. Create short URL for collection: `my-series`
4. Access http://localhost:3000/c/my-series

**Expected Results:**
- ✅ Redirects to full project URL
- ✅ Redirects to collection view
- ✅ 404 if short URL doesn't exist

---

## Edge Cases & Error Handling

### 1. Database Errors

**Test:** Disconnect database during operation
```bash
docker stop $(docker ps -q -f name=postgres)
```

**Expected Results:**
- ✅ Graceful error messages
- ✅ No app crashes
- ✅ Correlation IDs in errors

### 2. Invalid Input

**Test:** Send invalid data to APIs
```bash
# Invalid project ID format
curl http://localhost:4000/api/projects/invalid-uuid

# Missing required fields
curl -X POST http://localhost:4000/api/projects \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Results:**
- ✅ 400 Bad Request
- ✅ Descriptive error message
- ✅ No data corruption

### 3. Concurrency

**Test:** Multiple simultaneous operations
```bash
# Install same bobbin twice in quick succession
curl -X POST http://localhost:4000/api/projects/PROJECT_ID/bobbins/install \
  -H "Content-Type: application/json" \
  -d '{"manifestPath": "bobbins/manuscript.manifest.yaml"}' &

curl -X POST http://localhost:4000/api/projects/PROJECT_ID/bobbins/install \
  -H "Content-Type: application/json" \
  -d '{"manifestPath": "bobbins/manuscript.manifest.yaml"}' &
```

**Expected Results:**
- ✅ Second request updates existing installation
- ✅ No duplicate records
- ✅ Consistent state

---

## Publishing System Completeness Checklist

### Backend Endpoints (All Implemented ✅)

**Chapter Publication:**
- ✅ `POST /projects/:id/chapters/:id/publish` - Publish chapter
- ✅ `POST /projects/:id/chapters/:id/unpublish` - Unpublish chapter
- ✅ `GET /projects/:id/chapters/:id/publication` - Get publication status
- ✅ `GET /projects/:id/publications` - List all publications

**Configuration:**
- ✅ `GET /projects/:id/publish-config` - Get publish settings
- ✅ `PUT /projects/:id/publish-config` - Update publish settings

**Embargoes:**
- ✅ `POST /projects/:id/embargoes` - Create embargo
- ✅ `GET /projects/:id/chapters/:id/embargo` - Get embargo
- ✅ `PUT /embargoes/:id` - Update embargo
- ✅ `DELETE /embargoes/:id` - Delete embargo

**Destinations:**
- ✅ `GET /projects/:id/destinations` - List destinations
- ✅ `POST /projects/:id/destinations` - Create destination
- ✅ `PUT /destinations/:id` - Update destination
- ✅ `DELETE /destinations/:id` - Delete destination
- ✅ `POST /destinations/:id/sync` - Record sync

**Analytics:**
- ✅ `POST /chapters/:id/views` - Track view
- ✅ `PUT /chapter-views/:id/progress` - Update progress
- ✅ `GET /projects/:id/chapters/:id/analytics` - Chapter analytics
- ✅ `GET /projects/:id/analytics` - Project analytics

**Access Control:**
- ✅ `GET /projects/:id/chapters/:id/access` - Check access

**Content Warnings:**
- ✅ `GET /projects/:id/content-warnings` - List warnings
- ✅ `POST /projects/:id/content-warnings` - Create warning
- ✅ `DELETE /content-warnings/:id` - Delete warning

### Frontend UI (Needs Implementation ⏳)

**Publishing Dashboard:**
- ⏳ Chapter list with publish status
- ⏳ Publish/unpublish buttons
- ⏳ Embargo date picker
- ⏳ Tier-based release scheduler
- ⏳ Analytics dashboard
- ⏳ Publication history

**Reader Interface:**
- ⏳ Public reading view
- ⏳ Chapter navigation
- ⏳ Progress tracking UI
- ⏳ Subscription prompts
- ⏳ Content warnings display

**Configuration UI:**
- ⏳ Publish settings panel
- ⏳ Destination management
- ⏳ Content warnings manager

---

## Troubleshooting

### Authentication Not Working

**Symptoms:** Can't login, signup fails

**Solutions:**
1. Check NextAuth configuration exists
2. Verify `NEXTAUTH_SECRET` in `.env`
3. Check database users table schema
4. Implement password hashing if missing

### Bobbins Not Installing

**Symptoms:** Installation fails, errors in console

**Solutions:**
1. Check manifest file exists: `bobbins/manuscript.manifest.yaml`
2. Verify API is running on port 4000
3. Check database `bobbins_installed` table
4. Review API logs: Check background process output

### Publishing API Returns 404

**Symptoms:** Publishing endpoints not found

**Solutions:**
1. Verify publishing routes registered in API
2. Check `apps/api/src/server.ts` includes publishing plugin
3. Restart API server

---

## Next Steps

After verifying these test scenarios:

1. **Implement Frontend UI** for publishing system
2. **Add Reader Experience** for public chapter access
3. **Implement Subscriptions UI** (backend exists)
4. **Add Payment Integration** (Stripe setup)
5. **Build Analytics Dashboard** (data collection works)

See `/docs/DEVELOPMENT_HISTORY.md` for full feature list and roadmap.
