# Testing Guide

Test suite for the Bobbinry platform covering API routes, shell components, and integration workflows.

## Test Structure

```
apps/api/src/
├── routes/__tests__/
│   ├── auth.test.ts                  # Auth signup/login/session
│   ├── auth-internal.test.ts         # Internal auth (NextAuth lookup)
│   ├── bobbins.test.ts               # Bobbin install/uninstall
│   ├── collections.test.ts           # Collection CRUD
│   ├── health.test.ts                # Health check endpoint
│   ├── notifications.test.ts         # Notification endpoints
│   ├── projects.test.ts              # Project CRUD
│   ├── publishing.test.ts            # Chapter publishing flow
│   ├── subscriptions-access.test.ts  # Subscription + access grants
│   └── users-follow.test.ts          # Follow/unfollow
├── lib/__tests__/unit/
│   ├── bobbin-actions.test.ts        # Action handler logic
│   └── bobbin-upgrader.test.ts       # Bobbin upgrade logic
└── __tests__/
    ├── integration/
    │   ├── bobbin-lifecycle.test.ts   # End-to-end bobbin lifecycle
    │   └── e2e-workflow.test.ts       # Full user workflow
    └── unit/
        └── export-converters.test.ts  # PDF/EPUB/MD/TXT export

apps/shell/src/
├── components/__tests__/
│   └── Button.test.tsx               # UI component tests
├── hooks/__tests__/
│   └── useInfiniteScrollSentinel.test.tsx
├── lib/__tests__/
│   ├── native-view-loader.test.ts    # View loading
���   └── view-registry.test.ts         # View registration
└── app/
    ├── __tests__/
    │   └── LandingPage.test.tsx       # Landing page
    └── dashboard/__tests__/
        └── DashboardContent.test.tsx  # Dashboard
```

## Running Tests

```bash
# Run all tests across the monorepo
bun run test

# Run tests for a specific app
bun run --filter api test
bun run --filter shell test

# Run a specific test file
bun run --filter api test -- bobbin-lifecycle

# Watch mode
bun run --filter api test -- --watch
bun run --filter shell test -- --watch
```

## Test Data

Tests use the real database with isolated test data. See `apps/api/src/db/seed.ts` for the main seed and `seed-test-follows.ts` for follow/subscribe test data.

Test accounts (created by seed):
- `elena@bobbinry.dev` / `password123` — Author with projects and tiers
- `marcus@bobbinry.dev` / `password123` — Reader for follow/subscribe testing

## Best Practices

- Test behavior, not implementation
- Use descriptive test names
- Isolate test data (create/cleanup in beforeAll/afterAll)
- Mock external dependencies (Stripe, S3, email)
- Test error cases and security boundaries
- Verify type safety with `@ts-expect-error` where appropriate
