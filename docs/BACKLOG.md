# Engineering Backlog

Known work that is understood but not yet done. Each item says what is wrong,
why it matters, and what the fix looks like, so it can be picked up cold.
Items leave this file when they land; history is in git.

Last reviewed: 2026-09-07 (after the `fix/slop-review-security` cleanup and its follow-ups).

## D. Verify / housekeeping

### D2. `@types/html-to-text` pinned to 9.x while runtime is 10.x
No v10 typings on DefinitelyTyped yet; compiles because the API is
compatible. Check `npm view @types/html-to-text version` occasionally and
bump `apps/api/package.json` when 10.x appears.

## E. Features

### E1. Shell layout preferences to the database
Panel stack layouts, view preferences, last-nav and panel widths live in
localStorage (`panelLayout:{slotId}`, `viewPreferences`,
`bobbinry:lastNav:{projectId}`, `shellPanelWidth:*`) and are lost on a
cookie clear. Plan: a `user_shell_preferences` table with a JSONB column,
read once at shell mount, written debounced, localStorage kept as the
offline cache.
