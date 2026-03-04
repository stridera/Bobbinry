# Bobbins Architecture Reference

## Service Architecture

**OFFICIAL PORT ASSIGNMENTS**:
- **Shell (Frontend)**: `localhost:3100` - Next.js React app
- **API (Backend)**: `localhost:4100` - Fastify server
- **PostgreSQL**: `localhost:5432` (native)
- **MinIO**: `localhost:9100` (Docker, optional)

## Iframe View System

**Correct URL Pattern**:
```
http://localhost:4100/api/views/{bobbinId}/{viewId}?projectId={projectId}
```

**Examples**:
- Outline view: `http://localhost:4100/api/views/manuscript/outline?projectId=550e8400-e29b-41d4-a716-446655440001`
- Editor view: `http://localhost:4100/api/views/manuscript/editor?projectId=550e8400-e29b-41d4-a716-446655440001`

## Components Responsible for Iframe URLs

1. **ViewRenderer.tsx** (Primary): Creates iframes for bobbin views
2. **ExtensionSlot.tsx** (Secondary): Creates iframes for extension panels

## Known Issues

- Iframe URLs sometimes default to shell origin instead of API origin
- Bobbin IDs sometimes default to "test" instead of actual bobbin ID
- These cause 404 errors and "bridge not available" messages

## Debugging Guidelines

1. Always verify iframe src attribute points to the API origin (port 4100)
2. Verify bobbin ID matches installed bobbins (e.g., "manuscript")
3. Check project ID parameter is included
4. Use browser dev tools to inspect actual iframe src vs expected
