# Test Status

**Last Updated**: 2025-10-01

## Overall Status: 91/98 tests passing (93%)

### API Tests: ✅ 100% (20/20)
All API tests passing:
- Project creation and management
- Bobbin installation lifecycle
- Entity CRUD operations
- Security boundaries
- Data structure validation

### Shell Tests: ✅ 91% (71/78)

#### Passing Test Suites:
- ✅ View Registry (100%)
- ✅ Native View Loader (100%)
- ✅ Execution Modes (100%)
- ✅ Component Tests (100%)

#### Partially Passing:
- 🟡 View Rendering: 13/14 (93%)
  - ❌ 1 failure: Async loading state test (timing issue)
- 🟡 Message Passing: 4/9 (44%)
  - ❌ 5 failures: Event bus tests require MessageBus API refactor

#### Skipped:
- ⏭️ E2E Complete Workflow: Import path issues (cross-package imports)

## Known Issues

### 1. Message Passing Tests (5 failures)
**Issue**: Tests expect simple event emitter pattern, but MessageBus is designed for iframe postMessage
**Root Cause**: SDK MessageBus API mismatch
- Tests use: `sdk.messageBus.on('custom:event', handler)`
- Handler expects: `{ data: 'test' }`
- MessageBus provides: Full Message object with type/source/target/data structure

**Fix Required**:
- Option A: Add EventEmitter wrapper to SDK for simple events
- Option B: Update tests to use full MessageBus protocol
- Option C: Create separate EventBus class in SDK

**Affected Tests**:
- should allow views to emit custom events
- should allow views to listen for events
- should cleanup event listeners on unmount
- should use postMessage for sandboxed view communication
- should enforce capability restrictions for sandboxed views

### 2. Async Loading Test (1 failure)
**Issue**: Component never loads in test
**Root Cause**: Promise timing issue with componentLoader
**Test**: view-rendering.test.tsx - "should show loading state while component loads"

**Fix Required**:
- Add proper promise resolution handling
- Ensure React component updates after async load
- May need to use act() wrapper

### 3. E2E Test Suite (1 suite skipped)
**Issue**: Cannot import from `../../../api/src/db/connection`
**Root Cause**: Cross-package imports not resolved in test environment
**Test**: complete-workflow.test.tsx

**Fix Required**:
- Set up proper module resolution for cross-package imports
- Or mock the database connection
- Or restructure test to not require direct API imports

## Test Infrastructure

### Frameworks
- Jest 29.7.0
- React Testing Library
- @jest/globals for test utilities

### Configuration
- Shell tests: `apps/shell/jest.config.js`
- API tests: `apps/api/jest.config.js`
- Coverage: Not yet configured

### Running Tests
```bash
# All tests
pnpm dlx turbo run test

# Specific package
pnpm --filter api test
pnpm --filter shell test

# Specific test file
pnpm --filter shell test -- view-rendering
pnpm --filter shell test -- message-passing
```

## Recent Improvements

### Phase 3 Fixes (2025-10-01)
1. ✅ Added ErrorBoundary to NativeViewRenderer
2. ✅ Fixed SDK constructor calls (createBobbinrySDK → new BobbinrySDK)
3. ✅ Updated MessageBus API usage (sdk.views → sdk.messageBus)
4. ✅ Fixed sandbox restriction test expectations
5. ✅ Fixed jest.clearAllMocks() compatibility
6. ✅ Improved from 65/78 to 71/78 passing

## Recommendations

### Priority 1: High Value
- ❌ Skip remaining message-passing tests (require SDK refactor)
- ✅ Document test status (this file)
- ✅ Move to Phase 4 implementation

### Priority 2: Future Work
- Add EventBus/EventEmitter to SDK for simple pub/sub
- Fix async loading test timing
- Set up E2E test module resolution
- Add test coverage reporting

### Priority 3: Nice to Have
- Add integration tests for marketplace
- Add tests for view extensions
- Performance benchmarks
