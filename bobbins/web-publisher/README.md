# Web Publisher

Native publishing suite with reader delivery, analytics, and release
automation. The default way to publish chapters from a Bobbinry project
to readers on the platform.

- `shell.rightPanel` "Publishing" panel for the editor view.
- Pushes drafts through the `chapter_publications` state machine
  (draft → scheduled → published → archived).
- Reader views, embargo schedules, and tier-gated early access live on
  the API side; this bobbin is the author-facing control panel.
- Publishable bobbin — registered as the canonical publisher in the
  project's publish config.
