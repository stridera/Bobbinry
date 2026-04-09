# Bobbins

Plugin modules that contribute panels, views, collections, and actions to
the Bobbinry shell. Each subdirectory is a self-contained bobbin with its
own `manifest.yaml`, `package.json`, and (preferably) `README.md`.

## Writing surface

| Bobbin | What it does |
|---|---|
| [`manuscript`](./manuscript) | Books, chapters, scenes; the canonical writing surface. |
| [`notes`](./notes) | Folders, tagging, entity linking, pinboard. |
| [`corkboard`](./corkboard) | Visual board for organizing scene cards. |
| [`goals`](./goals) | Word counts, sessions, streaks, progress. |
| [`cat`](./cat) | Morale-boosting cat companion (yes, really). |

## Worldbuilding

| Bobbin | What it does |
|---|---|
| [`entities`](./entities) | Characters, locations, items, custom entity types. |
| [`relationships`](./relationships) | Graph and matrix views across entities. |
| [`timeline`](./timeline) | Chronological events for plot and history. |
| [`dictionary-panel`](./dictionary-panel) | Editor-side definition + thesaurus lookup. |

## Publishing & feedback

| Bobbin | What it does |
|---|---|
| [`web-publisher`](./web-publisher) | Publish to Bobbinry readers, with analytics. |
| [`export`](./export) | PDF / EPUB / Markdown / plain-text export. |
| [`feedback`](./feedback) | Author inbox for reader annotations. |

## Integrations

| Bobbin | What it does |
|---|---|
| [`ai-tools`](./ai-tools) | Synopsis + structured review (analysis only, never generation). |
| [`discord-notifier`](./discord-notifier) | Announce publishes via Discord webhooks. |
| [`discord-roles`](./discord-roles) | Sync Discord roles to subscription tiers. |
| [`google-drive-backup`](./google-drive-backup) | Mirror chapters to Google Drive. |

## Reference

| Bobbin | What it does |
|---|---|
| [`hello-world`](./hello-world) | Tutorial bobbin — copy this to start building your own. |

## Anatomy of a bobbin

Each bobbin folder contains:

- `manifest.yaml` — id, name, version, capabilities, panel/view contributions, data collections.
- `package.json` — workspace package; usually exports compiled views via `tsc`.
- `src/` — TypeScript source for panels, views, and (sometimes) server-side actions.
- `dist/` — compiled output, consumed by the shell.
- `README.md` — short description: what it does, what panels/views it contributes, any
  external dependencies. Keep it under ~30 lines unless the bobbin is genuinely complex.

When adding a new bobbin, copy [`hello-world`](./hello-world) and rename
`id`, `name`, and the package name in `package.json`. Then `bun install` at
the repo root so the workspace symlinks update.
