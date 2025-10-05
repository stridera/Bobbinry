# Entities Bobbin - Integration Test Plan

**Purpose**: Verify end-to-end functionality of the Entities bobbin in the Bobbinry shell.

---

## Test Scenario 1: Install Bobbin from Marketplace

### Steps:
1. Navigate to http://localhost:3000/marketplace
2. Find "Entities" bobbin in the list
3. Click "Install" button
4. Wait for installation to complete

### Expected Results:
- ✓ Installation succeeds without errors
- ✓ Success message displays: "Entities installed successfully!"
- ✓ Bobbin card shows "✓ Installed" badge
- ✓ Install button changes to "Uninstall" button

### API Calls:
```
POST /api/bobbins/install
{
  "projectId": "550e8400-e29b-41d4-a716-446655440001",
  "manifestContent": "<manifest.yaml content>",
  "format": "yaml"
}
```

---

## Test Scenario 2: Create Entity Type from Template

### Pre-requisites:
- Entities bobbin installed

### Steps:
1. Navigate to Entity Configuration view
2. Browse pre-configured templates
3. Select "Characters" template
4. Click "Use This Template"
5. Customize fields (optional)
6. Click "Save Entity Type"

### Expected Results:
- ✓ Template preview shows all fields and layout
- ✓ Field builder loads with template fields
- ✓ Layout designer shows template configuration
- ✓ Save succeeds without errors
- ✓ Entity type appears in navigation panel

### API Calls:
```
POST /api/entities
{
  "collection": "entity_type_definitions",
  "projectId": "550e8400-e29b-41d4-a716-446655440001",
  "data": {
    "type_id": "characters",
    "label": "Characters",
    "icon": "🧙",
    "template_id": "characters",
    "base_fields": { ... },
    "custom_fields": [ ... ],
    "editor_layout": { ... },
    "list_layout": { ... },
    "subtitle_fields": [ ... ],
    "allow_duplicates": true
  }
}
```

---

## Test Scenario 3: Create Entity

### Pre-requisites:
- Entities bobbin installed
- "Characters" entity type created

### Steps:
1. Select "Characters" from navigation panel
2. Click "New Character" button
3. Fill in required fields:
   - Name: "Gandalf"
   - Description: "A wise wizard"
   - Class: "Wizard"
   - Level: 20
4. Wait for auto-save (2 seconds)

### Expected Results:
- ✓ Entity editor loads with correct layout
- ✓ All fields render correctly
- ✓ Required fields show validation
- ✓ Auto-save triggers after 2 seconds
- ✓ Save status shows "Saved"
- ✓ Entity appears in entity list

### API Calls:
```
POST /api/entities
{
  "collection": "characters",
  "projectId": "550e8400-e29b-41d4-a716-446655440001",
  "data": {
    "name": "Gandalf",
    "description": "A wise wizard",
    "class": "Wizard",
    "level": 20,
    "tags": ["wizard", "fellowship"]
  }
}
```

---

## Test Scenario 4: List and Search Entities

### Pre-requisites:
- Entities bobbin installed
- "Characters" entity type created
- At least 3 character entities created

### Steps:
1. Navigate to Characters list view
2. Observe all entities displayed
3. Enter "Gandalf" in search box
4. Observe filtered results

### Expected Results:
- ✓ All entities display in grid/list
- ✓ Entity cards show name, subtitle, image
- ✓ Search filters entities correctly
- ✓ Result count updates
- ✓ Click entity opens editor

### API Calls:
```
GET /api/collections/characters/entities?projectId=550e8400-e29b-41d4-a716-446655440001&limit=20&offset=0
GET /api/collections/characters/entities?projectId=550e8400-e29b-41d4-a716-446655440001&search=Gandalf
```

---

## Test Scenario 5: Update Entity

### Pre-requisites:
- Entities bobbin installed
- "Gandalf" character entity exists

### Steps:
1. Open "Gandalf" in entity editor
2. Change level from 20 to 21
3. Wait for auto-save
4. Refresh page
5. Verify level is still 21

### Expected Results:
- ✓ Editor loads with current data
- ✓ Field updates correctly
- ✓ Auto-save triggers
- ✓ Data persists after refresh
- ✓ Updated timestamp changes

### API Calls:
```
PUT /api/entities/:entityId
{
  "collection": "characters",
  "projectId": "550e8400-e29b-41d4-a716-446655440001",
  "data": {
    "name": "Gandalf",
    "description": "A wise wizard",
    "class": "Wizard",
    "level": 21,  // Changed
    "tags": ["wizard", "fellowship"]
  }
}
```

---

## Test Scenario 6: Delete Entity

### Pre-requisites:
- Entities bobbin installed
- Test character entity exists

### Steps:
1. Open entity in editor
2. Click "Delete" button
3. Confirm deletion in dialog
4. Observe redirect to list view

### Expected Results:
- ✓ Delete confirmation dialog appears
- ✓ Deletion succeeds
- ✓ Entity removed from list
- ✓ Redirect to entity list view

### API Calls:
```
DELETE /api/entities/:entityId?projectId=550e8400-e29b-41d4-a716-446655440001&collection=characters
```

---

## Test Scenario 7: Entity Preview with Disambiguation

### Pre-requisites:
- Entities bobbin installed
- Multiple entities with similar names exist

### Steps:
1. Navigate to Manuscript editor
2. Type "Gandalf the Grey" in editor
3. Select text "Gandalf"
4. Observe preview panel

### Expected Results:
- ✓ Preview panel opens
- ✓ Search finds matching entities
- ✓ If multiple matches, disambiguation UI shows
- ✓ Can select correct match
- ✓ Entity details display in readonly mode
- ✓ "Open Editor" button works

### Message Bus:
```
{
  "topic": "manuscript.editor.selection.v1",
  "payload": {
    "selectedText": "Gandalf",
    "context": { ... }
  }
}
```

---

## Test Scenario 8: Filter and Sort Entities

### Pre-requisites:
- Entities bobbin installed
- Multiple character entities with different tags

### Steps:
1. Navigate to Characters list view
2. Select "wizard" tag filter
3. Observe filtered results
4. Click sort by "Name"
5. Observe alphabetical ordering

### Expected Results:
- ✓ Tag filter reduces entity list
- ✓ Only tagged entities shown
- ✓ Sorting works correctly
- ✓ Can combine search + filter + sort

---

## Test Scenario 9: Pagination

### Pre-requisites:
- Entities bobbin installed
- More than 20 character entities exist

### Steps:
1. Navigate to Characters list view
2. Observe first 20 entities
3. Click "Next Page"
4. Observe next 20 entities

### Expected Results:
- ✓ Pagination controls appear
- ✓ Correct page count shown
- ✓ Next/Previous buttons work
- ✓ Direct page navigation works

---

## Test Scenario 10: Multiple Entity Types

### Pre-requisites:
- Entities bobbin installed

### Steps:
1. Create "Characters" entity type
2. Create "Spells" entity type
3. Create entities in both types
4. Switch between types in navigation

### Expected Results:
- ✓ Both types appear in navigation
- ✓ Correct count shown for each type
- ✓ Switching loads correct entities
- ✓ No data cross-contamination

---

## Performance Tests

### Test P1: Entity Type Creation
- **Target**: < 500ms
- **Measure**: Time from save click to navigation update

### Test P2: Entity Creation
- **Target**: < 300ms
- **Measure**: Time from auto-save trigger to success

### Test P3: Entity List Load
- **Target**: < 500ms for 100 entities
- **Measure**: Time from navigation to render complete

### Test P4: Search Response
- **Target**: < 200ms
- **Measure**: Time from search input to results update

---

## Error Handling Tests

### Test E1: Invalid Field Data
1. Try to save entity with invalid number (non-numeric)
2. **Expected**: Validation error shown, save prevented

### Test E2: Missing Required Fields
1. Try to save entity with empty required field
2. **Expected**: Validation error shown, field highlighted

### Test E3: Network Error During Save
1. Disconnect network
2. Try to save entity
3. **Expected**: Error message shown, retry option available

### Test E4: Duplicate Entity Name (if not allowed)
1. Create entity with existing name
2. **Expected**: Validation error if duplicates not allowed

---

## Browser Compatibility Tests

### Browsers to Test:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

### Test Cases:
- ✓ Marketplace display
- ✓ Installation flow
- ✓ Entity CRUD operations
- ✓ Auto-save functionality
- ✓ Search and filter
- ✓ Dark mode toggle

---

## Accessibility Tests

### Test A1: Keyboard Navigation
- Navigate marketplace with Tab key
- Navigate entity list with arrow keys
- Submit forms with Enter

### Test A2: Screen Reader
- Marketplace announces bobbin info
- Entity fields have proper labels
- Validation errors announced

### Test A3: Color Contrast
- All text meets WCAG AA standards
- Dark mode meets standards

---

## Test Execution Checklist

- [ ] All API endpoints returning 200 OK
- [ ] Database migrations applied
- [ ] Shell server running
- [ ] API server running
- [ ] No console errors during tests
- [ ] All test scenarios pass
- [ ] Performance targets met
- [ ] Error handling verified
- [ ] Browser compatibility confirmed
- [ ] Accessibility validated

---

## Known Limitations (MVP)

1. **Screenshots**: Placeholder URLs, not actual screenshots
2. **Rich Text Editor**: Uses textarea, TipTap integration pending
3. **Image Upload**: URL input only, no file upload to S3/R2
4. **Relationships**: No entity-to-entity relationships yet
5. **Validation Rules**: Basic validation only, no custom rules
6. **Bulk Operations**: No CSV import/export yet
7. **Activity History**: No versioning or audit trail

---

## Success Criteria

✅ All 10 test scenarios pass
✅ All performance tests meet targets
✅ All error handling tests pass
✅ Works in all 3 major browsers
✅ Basic accessibility requirements met
✅ No critical bugs found
✅ User can install, configure, and use bobbin end-to-end

---

**Test Status**: READY TO EXECUTE
**Last Updated**: 2025-10-04
