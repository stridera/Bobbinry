# Bobbinry (Scaffold)

This repository contains the initial scaffolding and governance files for Bobbinry.

- See **docs/CLI_BLUEPRINT.md** for the step-by-step plan your CLI should follow.
- Example bobbin manifests are in `/bobbins`.
- JSON Schema for manifests is in `/packages/types/manifest.schema.json`.

## Quickstart

1. Copy `.env.example` to `.env` and adjust values.
2. `docker compose up -d` (Postgres + MinIO, optional).
3. Follow **docs/CLI_BLUEPRINT.md** to scaffold apps and packages.
