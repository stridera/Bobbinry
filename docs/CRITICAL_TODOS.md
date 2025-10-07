# Critical TODOs - Implementation Tracker

This document tracks critical TODO items that need implementation before production deployment.

## 🔴 High Priority - Security & Core Functionality

### 1. Signature Verification (packages/compiler/src/index.ts:174)
**Status**: Not Implemented  
**Location**: `packages/compiler/src/index.ts:174`  
**Description**: Ed25519 signature verification for manifest integrity  
**Current Behavior**: All signatures rejected in production  
**Required For**: Production manifest security  
**Estimated Effort**: 2-3 days  

```typescript
// TODO: Implement actual Ed25519 signature verification
// For now, reject all signatures in production (will be implemented in Phase 2)
```

### 2. Migration Generation (packages/compiler/src/index.ts:217-230)
**Status**: Stub Implementation  
**Location**: `packages/compiler/src/index.ts:217-230`  
**Description**: Generate actual Drizzle migrations for collections  
**Current Behavior**: Returns placeholder comments  
**Required For**: Dynamic collection creation  
**Estimated Effort**: 1 week  

```typescript
// TODO: Transform collection definition to SQL DDL
return `-- Migration for ${collection.name} [${tier}] (TODO: implement)`
```

### 3. Atomic Batch Operations (apps/shell/src/services/BobbinBridge.ts:337)
**Status**: Not Implemented  
**Location**: `apps/shell/src/services/BobbinBridge.ts:337`  
**Description**: Implement atomic batch operations with transaction support  
**Current Behavior**: Throws NOT_IMPLEMENTED error  
**Required For**: Data consistency in multi-entity operations  
**Estimated Effort**: 3-4 days  

```typescript
// TODO: Implement atomic batch operations when database supports transactions
throw new BobbinError('Atomic batch operations not yet supported', 'NOT_IMPLEMENTED')
```

### 4. IndexedDB Sync Operations (apps/shell/public/sw.js:251-266)
**Status**: Stubbed Out  
**Location**: `apps/shell/public/sw.js`  
**Description**: Implement IndexedDB operations for offline sync  
**Current Behavior**: Returns empty arrays  
**Required For**: Offline functionality  
**Estimated Effort**: 2-3 days  

```javascript
async function getPendingChanges() {
  // TODO: Implement IndexedDB read
  return []
}
```

## 🟡 Medium Priority - Features & Enhancement

### 5. Extension System TODOs (packages/compiler/src/index.ts:273-276)
**Location**: `packages/compiler/src/index.ts:273-276`  
**Items**:
- Register with shell extension registry
- Validate slot exists and is available
- Set up conditional rendering based on 'when' conditions
- Configure pub/sub subscriptions for extension

**Estimated Effort**: 1 week

### 6. Pub/Sub Implementation (packages/compiler/src/index.ts:285-295)
**Items**:
- Register topic with Local Event Bus
- Set up rate limiting based on producer.rate
- Configure topic QoS and sensitivity levels
- Validate topic exists in registry
- Check sensitivity level compatibility

**Estimated Effort**: 1 week

### 7. Offline/Sync Configuration (packages/compiler/src/index.ts:308-327)
**Items**:
- Set up Service Worker caching strategy
- Configure IndexedDB storage policies
- Set up field redaction for offline storage
- Configure conflict resolution strategies
- Set up field-level sync policies
- Integrate with offline storage layer

**Estimated Effort**: 1-2 weeks

### 8. Collection Augmentation (packages/compiler/src/index.ts:345-348)
**Items**:
- Validate target collection exists
- Generate migration to add fields to existing collection
- Update entity map with new field definitions
- Preserve existing data during augmentation

**Estimated Effort**: 3-4 days

## 🔵 Low Priority - Publisher Bobbins

### 9. Google Drive Publisher
**Location**: `bobbins/google-drive-publisher/actions/`  
**Status**: Placeholder implementation  
**Items**:
- Implement actual token refresh with Google OAuth
- Convert to DOCX format (use library like docx or mammoth)
- Test connection with googleapis

### 10. Web Publisher  
**Location**: `bobbins/web-publisher/actions/`  
**Items**:
- Implement actual email sending
- Configure SMTP or email service integration

## 📋 Implementation Priority Order

1. **Phase 1 (Pre-Production)**:
   - Signature verification
   - Migration generation
   - Atomic batch operations
   - IndexedDB sync operations

2. **Phase 2 (Post-Launch)**:
   - Extension system completion
   - Pub/Sub implementation
   - Offline/Sync full implementation

3. **Phase 3 (Feature Complete)**:
   - Collection augmentation
   - Publisher bobbins completion

## 🚦 Decision Required

Some TODOs need architectural decisions:

1. **Sandboxed Views in ViewRouter** (apps/shell/src/components/ViewRouter.tsx:160)
   - Current: "TODO: Handle sandboxed views with iframe"
   - Decision: Keep existing SandboxedViewRenderer or integrate into ViewRouter?

2. **Theme Management** (apps/shell/src/services/BobbinBridge.ts:476)
   - Current: Hardcoded theme
   - Decision: Create global theme provider or use existing context?

3. **Project Context Tracking** (apps/shell/src/lib/offline/offline-sdk.ts:231)
   - Current: Returns null
   - Decision: How to track current project in offline SDK?

## 📝 Notes

- All critical TODOs should be converted to GitHub issues
- Each TODO should have acceptance criteria before implementation
- Consider deprecating incomplete features rather than shipping with TODOs
