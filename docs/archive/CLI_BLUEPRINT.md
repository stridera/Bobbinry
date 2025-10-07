# Bobbinry — CLI Build Blueprint (v0.1)

> **Purpose:** A single, actionable document your CLI (and collaborators) can follow to scaffold the Bobbinry project from scratch. It encodes the decisions we’ve made so far and lists concrete steps, folder structure, env vars, and milestone tasks. No app logic yet — only structure, wiring, and the “walking skeleton.”

---

## 0) Project Summary (for README and package.json)
- **Name:** Bobbinry
- **Tagline:** Modular, open‑source tools (“bobbins”) for writers and worldbuilders.
- **Core concept:** A shell app that becomes powerful when users install bobbins that declare data (collections/fields), UI (views), interactions, and optional external access.
- **Open‑core:** OSS shell + SDK + compiler. Hosted SaaS and marketplace later.
- **MVP goal (walking skeleton):**
  1) Create a project.
  2) Install the **Manuscript** bobbin (manifest‑driven).
  3) Compiler generates DB schema for Book/Chapter/Scene.
  4) Shell shows Outline + Editor views.
  5) Install **Corkboard** UI‑only bobbin; drag a Scene to reorder.
  6) Snapshot Publish → create a static bundle artifact.

---

## 1) Tech Stack (locked for MVP)
- **Language:** TypeScript (strict)
- **Monorepo:** pnpm + Turborepo
- **Frontend (Shell):** React + Next.js (App Router, SSR/SSG), TipTap editor, Leaflet (later)
- **Backend (API):** Node.js + Fastify (tRPC)
- **DB:** PostgreSQL + Drizzle ORM (SQL‑forward)
- **Search:** Postgres FTS (upgrade path to Meilisearch later)
- **Auth:** Auth.js (NextAuth) with email magic links + OAuth (GitHub/Google) via the Shell, API validates sessions with JWT
- **Storage:** S3‑compatible (Cloudflare R2 in prod; MinIO locally), presigned uploads
- **Real‑time:** WebSocket gateway (socket.io) + Postgres LISTEN/NOTIFY (phase 2)
- **Compiler:** Manifest → SQL migrations (Drizzle) + UI wiring registry
- **Sandbox:** Views run in iframes with strict CSP; data via SDK message bus
- **Publish:** Next SSG → static HTML/JSON bundle → object storage → CDN
- **CI:** GitHub Actions (lint, typecheck, test, build)
- **License:** Apache‑2.0 for core; (reserve option for premium first‑party bobbins later)

---

## 2) Monorepo Layout
```
bobbinry/
  apps/
    shell/          # Next.js app (user shell)
    api/            # Fastify REST API server
  packages/
    sdk/            # Client SDK (Shell ↔ Views ↔ API message bus helpers)
    compiler/       # Manifest parser + migrator + UI registry writer
    ui/             # Shared UI components (cards, table, board, inspector)
    types/          # Shared TypeScript types (manifest, entities, API contracts)
    config/         # eslint, prettier, tsconfig bases, jest config
  bobbins/
    manuscript/     # Example first-party bobbin (manifest + assets)
    corkboard/      # UI-only bobbin (manifest + assets)
  infra/
    db/             # migrations, seed scripts
    scripts/        # bootstrap, local dev helpers
  .github/
    workflows/      # CI pipelines
  .env.example
  turbo.json
  package.json
  pnpm-workspace.yaml
  README.md
```

---

## 3) Environment Variables (.env.example)
```
# Postgres
DATABASE_URL=postgres://bobbinry:password@localhost:5432/bobbinry

# Auth (NextAuth in Shell)
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace_with_strong_secret
GITHUB_ID=
GITHUB_SECRET=
GOOGLE_ID=
GOOGLE_SECRET=

# JWT (API validates requests)
API_JWT_SECRET=replace_with_strong_secret

# Object Storage (R2 or S3/MinIO)
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=auto
S3_BUCKET=bobbinry
S3_ACCESS_KEY=
S3_SECRET_KEY=

# CORS / Allowed Origins
WEB_ORIGIN=http://localhost:3000
API_ORIGIN=http://localhost:4000

# CSP Nonces/Keys (generated at runtime in dev)
CSP_ENABLE_STRICT=true
```

---

## 4) CLI Scaffolding Steps (copy/paste)
> **Assumes:** Node 20+, pnpm installed, Docker (optional) for local Postgres + MinIO.

### 4.1 Initialize repo and workspace
```bash
mkdir bobbinry && cd bobbinry
git init
pnpm init -y
pnpm dlx turbo@latest init
```

### 4.2 Create workspace manifest
```bash
cat > pnpm-workspace.yaml <<'YAML'
packages:
  - "apps/*"
  - "packages/*"
  - "bobbins/*"
  - "infra/*"
YAML
```

### 4.3 Apps: Shell (Next.js) and API (Fastify)
```bash
# Shell
pnpm dlx create-next-app@latest apps/shell --ts --eslint --src-dir --app --no-tailwind --use-pnpm

# API
mkdir -p apps/api && cd apps/api && pnpm init -y && cd ../..
pnpm -C apps/api add fastify fastify-cors fastify-plugin zod pino
pnpm -C apps/api add -D typescript tsx @types/node @types/pino
```

### 4.4 Packages
```bash
# Shared configs and types
mkdir -p packages/{types,sdk,compiler,ui,config}
pnpm -C packages/types init -y
pnpm -C packages/sdk init -y
pnpm -C packages/compiler init -y
pnpm -C packages/ui init -y
pnpm -C packages/config init -y

# Add common dev deps
pnpm add -D -w typescript eslint prettier turbo tsx zod
```

### 4.5 Database: Postgres + Drizzle
```bash
pnpm -C apps/api add drizzle-orm pg postgres
pnpm -C apps/api add -D drizzle-kit

mkdir -p infra/db/migrations infra/db/seeds
```

### 4.6 Storage (local MinIO optional)
```bash
# (Optional) run MinIO locally for object storage
# docker run -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=admin -v $(pwd)/.minio:/data quay.io/minio/minio server /data --console-address ":9001"
```

### 4.7 Basic scripts (root package.json)
Add scripts for dev, build, lint, and app-level start (CLI will edit package.json accordingly).

---

## 5) System Tables (compiler will add dynamic ones later)
**Create these via Drizzle migrations (no app logic yet):**
- `users` (id, email, name, created_at)
- `projects` (id, owner_id, name, created_at)
- `memberships` (user_id, project_id, role)
- `bobbins_installed` (id, project_id, bobbin_id, version, manifest_json, enabled)
- `manifests_versions` (id, bobbin_id, version, manifest_json, signature, created_at)
- `publish_targets` (id, project_id, type[snapshot|live|preview], status, url, version_id)
- `provenance_events` (id, project_id, entity_ref, actor, action, meta_json, created_at)

> The **compiler** will generate project‑scoped tables/joins for each bobbin’s `data.collections` (e.g., Book/Chapter/Scene), plus indexes and FTS triggers as hints require.

---

## 6) Manifest Spec (v0.1, JSON/YAML)
**Location:** `packages/types/manifest.d.ts` + JSON Schema in `packages/types/manifest.schema.json`  
**Top‑level sections:**
- `id`, `name`, `version`, `author`, `description`, `tags`, `license`
- `capabilities` → `publishable`, `external`, `ai`, `customViews`
- `data.collections[]` → `name`, `fields[]`, `relationships[]`, `validations`
- `ui.views[]` → `id`, `type`, `source`, `layout`, `filters`, `actions`
- `interactions.actions[]` / `interactions.triggers[]`
- `external` → `endpoints[]`, `auth`, `permissions`
- `linking` → `entities[]` with `display` rules
- `publish` → `entities`, `fields`, `output` formats
- `compatibility` → `minShellVersion`, `migrations[]`

**Acceptance:** The compiler validates manifests against JSON Schema before install.

---

## 7) Compiler Responsibilities (MVP)
- Parse manifest; validate against schema.
- Compute **diff** vs. installed version (add/rename fields; new relations).
- Generate Drizzle migrations for project‑scoped tables and indices.
- Apply migrations inside a transaction; record in `manifests_versions`.
- Register bobbin **UI views** with the Shell (write to a registry the Shell reads).
- Expose a read‑only **entity map** (collection → table/fields) for the Shell SDK.

---

## 8) Shell Responsibilities (MVP)
- Auth (NextAuth) + Project picker.
- Installed bobbins list; install flow reads manifest, hits API to compile.
- Global chrome: left rail (bobbins/views), top filter bar, right inspector.
- **Manuscript views:** Outline (tree) + Editor (TipTap markdown).
- **Corkboard view:** Board with drag‑to‑reorder (updates `order`, emits to API).
- `@link` autocomplete across linkable entities.
- Basic **Preview/Publish** toggle (calls API to create snapshot stub).
- Provenance panel per entity (read from `provenance_events`).

---

## 9) API Responsibilities (MVP)
- Auth session verification (read NextAuth JWT; enforce project membership).
- Manifest install endpoints: `POST /projects/:id/bobbins/install` (body: manifest)
- Compiler endpoints: apply migrations, register views.
- CRUD endpoints: generic **entity** read/write using entity map (collection‑aware).
- Publish snapshot endpoint: create static bundle stub; write `publish_targets` row.

---

## 10) Security & Sandbox (MVP)
- **Views** run in `iframe` with `sandbox` attrs; strict **CSP** (`connect-src 'none'`) by default.
- **External access** is **off by default**; only via explicit manifest `external` and user approval. All outbound calls route through a server‑side **egress proxy** with allowlist + logs.
- Provenance events are recorded for AI usage, external calls, publish actions.

---

## 11) Milestones & Checklists

### Milestone A — Repository & Infra
- [ ] Monorepo bootstrapped (pnpm, turbo, TS configs)
- [ ] Next.js shell app runs at :3000
- [ ] Fastify API runs at :4000
- [ ] Postgres reachable; Drizzle migrations runner set up
- [ ] .env.example committed; basic README

### Milestone B — Compiler & Install Flow
- [ ] Manifest schema & validator in `packages/types`
- [ ] Compiler: parse → validate → migrate → register (stub tables ok)
- [ ] API: `/install` endpoint wires compiler to a project
- [ ] Shell: “Install Bobbin” flow with manifest upload

### Milestone C — Manuscript + Corkboard (Walking Skeleton)
- [ ] Manuscript manifest accepted; tables created for Book/Chapter/Scene
- [ ] Outline view renders Chapters/Scenes (read via generic entity API)
- [ ] Editor view saves Scene.body
- [ ] Corkboard manifest accepted; board renders Scenes as cards
- [ ] Drag to reorder persists `order`; basic history event recorded

### Milestone D — Snapshot Publish (Stub)
- [ ] API creates a static JSON/HTML bundle for current book (simple template)
- [ ] Upload bundle to storage; record URL in `publish_targets`
- [ ] Shell “Preview / Publish” toggles; preview reads static bundle

---

## 12) CLI Command Cheat‑Sheet (Dev)
```bash
# install deps
pnpm i

# dev (parallel)
pnpm -w dlx turbo run dev

# typecheck, lint, build
pnpm -w dlx turbo run typecheck
pnpm -w dlx turbo run lint
pnpm -w dlx turbo run build

# db migrations (example; finalize when drizzle config added)
# pnpm -C apps/api drizzle-kit generate
# pnpm -C apps/api drizzle-kit migrate
```

---

## 13) OSS & Governance (initial)
- **License:** Apache‑2.0 (core). Include NOTICE file.
- **Contributing:** PRs require manifest validation & a11y check to pass CI.
- **Security:** security.txt at `/.well-known/security.txt`; vulnerability disclosure email.
- **Code of Conduct:** Contributor Covenant.

---

## 14) Definition of Done (MVP)
- Can create project, install Manuscript & Corkboard, edit scene text, reorder scenes on corkboard, and produce a snapshot bundle URL. No manual DB fiddling; all schema created via manifest compiler. Basic provenance recorded. Tests and CI green.

---

### Notes for CLI
- When this blueprint says “add file” or “edit package.json,” the CLI should scaffold minimal placeholders (empty handlers, example routes) without business logic.
- Prefer generating TODO comments over stubs of real code.
- Create GitHub Issues from the Milestone checklists to track work items.
