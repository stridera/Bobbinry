# Bobbinry — CLI Build Blueprint (v0.2)

> **Purpose:** Updated, actionable plan your CLI can follow to scaffold the Bobbinry project with the latest decisions: **offline‑first v1**, **local pub/sub (LEB)**, **extensions/slots**, **manifest v0.2**, and the **tiered storage compiler**. As before: generate structure and stubs only — no app logic beyond a walking skeleton.

---

## 0) Project Summary (what we’re building)

- **Name:** Bobbinry
- **Tagline:** Modular, open‑source tools (“bobbins”) for writers and worldbuilders.
- **Core concept:** A shell app that becomes powerful when users install bobbins that declare data, UI views, interactions, and optional external access.
- **Open‑core:** OSS shell + SDK + compiler. Hosted SaaS and marketplace later.
- **v1 priorities (locked):**
  - ✅ **Offline‑first** editing with local cache + optimistic updates + sync/merge.
  - ✅ **LEB (Local Event Bus)** in the browser for live UI integrations.
  - ✅ **Extensions**: slot‑based contributions (toolbar, right panel, badges, etc.).
  - ✅ **Manifest v0.2** (offline/pubsub/extensions/augmentations).
  - ✅ **Tiered storage**: JSONB by default; promotion to physical tables when hot.
  - 🟨 **PEH (Project Event Hub)** server fan‑out is P1 (scaffold optional).
  - 🟨 **Action Runner + Connectors** scaffold present; workflows first, code later.

**Walking skeleton (v1):**
1) Create a project; install **Manuscript** bobbin.
2) Compiler validates manifest **v0.2**, generates entity map (Tier 1 JSONB).
3) Shell renders Outline + Editor; **offline** editing (Scene.body w/ text deltas).
4) **LEB** publishes selection + wordcount; **Dictionary Panel** extension consumes selection in the **right panel**.
5) Snapshot Publish → static bundle artifact (preview URL).

---

## 1) Tech Stack (locked for v1)

- **Language:** TypeScript (strict)
- **Monorepo:** pnpm + Turborepo
- **Frontend (Shell):** React + Next.js (App Router, SSR/SSG), TipTap editor
- **Offline:** Service Worker + IndexedDB (Dexie) + optimistic queue; CRDT later
- **LEB:** In‑memory event bus + `postMessage` bridge to sandboxed views
- **Backend (API):** Node.js + Fastify (REST), Zod for contracts
- **DB:** PostgreSQL + Drizzle ORM (SQL‑forward)
- **Search:** Postgres FTS (upgrade path to Meilisearch later)
- **Auth:** Auth.js (NextAuth) with email + OAuth; API validates via JWT
- **Storage:** S3‑compatible (R2 in prod; MinIO locally), presigned uploads
- **Compiler:** Manifest v0.2 → migrations (when needed), entity map, UI registry
- **Sandbox:** Views in iframes with strict CSP; data via View SDK bus
- **Publish:** Next SSG → static HTML/JSON bundle → object storage → CDN
- **(P1)** Real‑time hub: WebSocket gateway + Redis/NATS (PEH)
- **CI:** GitHub Actions (lint, typecheck, test, build)
- **License:** Apache‑2.0 for core

---

## 2) Monorepo Layout (updated)

```
bobbinry/
  apps/
    shell/                 # Next.js Shell (offline cache, LEB, slots UI)
    api/                   # Fastify REST API (auth, compiler endpoints, CRUD)
    worker/                # (P1) Action Runner jobs (workflows/actions)
  packages/
    types/                 # Shared types + manifest.schema.json (v0.2)
    compiler/              # Manifest parser, diff, migrations, entity map
    sdk/                   # Shell ↔ API helpers, entity access, auth
    view-sdk/              # PostMessage bridge for sandboxed views/panels
    event-bus/             # LEB implementation + topic registry
    ui/                    # Shared components (cards, board, inspector)
    connectors/            # (P1) First‑party connectors (drive, webhook)
    action-runtime/        # (P1) Sandboxed action SDK (egress proxy)
    config/                # eslint, prettier, tsconfig bases, jest config
  bobbins/
    manuscript/            # Example first‑party bobbin (manifest + assets)
    corkboard/             # UI‑only bobbin
    dictionary-panel/      # Sample panel that consumes selection via LEB
  infra/
    db/                    # migrations, seeds
    scripts/               # bootstrap, local dev helpers
  .github/
    workflows/             # CI pipelines
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

# Web origins (CORS)
WEB_ORIGIN=http://localhost:3000
API_ORIGIN=http://localhost:4000

# Offline/Service Worker
OFFLINE_SW_ENABLED=true

# (P1) PEH — Project Event Hub
WS_PUBLIC_URL=ws://localhost:4500
REDIS_URL=redis://localhost:6379

# CSP
CSP_ENABLE_STRICT=true
```

---

## 4) CLI Scaffolding Steps (copy/paste)

> **Assumes:** Node 20+, pnpm, Docker (for Postgres/MinIO; Redis optional for P1).

### 4.1 Initialize repo and workspace
```bash
mkdir bobbinry && cd bobbinry
git init
pnpm init -y
pnpm dlx turbo@latest init
```

### 4.2 Workspace manifest
```bash
cat > pnpm-workspace.yaml <<'YAML'
packages:
  - "apps/*"
  - "packages/*"
  - "bobbins/*"
  - "infra/*"
YAML
```

### 4.3 Apps: Shell + API (+ Worker stub)
```bash
# Shell
pnpm dlx create-next-app@latest apps/shell --ts --eslint --src-dir --app --use-pnpm --no-tailwind

# API
mkdir -p apps/api && cd apps/api && pnpm init -y && cd ../..
pnpm -C apps/api add fastify fastify-cors fastify-plugin zod pino drizzle-orm pg postgres
pnpm -C apps/api add -D drizzle-kit typescript tsx @types/node @types/pino

# Worker (P1 stub only)
mkdir -p apps/worker && cd apps/worker && pnpm init -y && cd ../..
pnpm -C apps/worker add pino zod
pnpm -C apps/worker add -D typescript tsx @types/node
```

### 4.4 Packages (updated)
```bash
mkdir -p packages/{types,compiler,sdk,view-sdk,event-bus,ui,connectors,action-runtime,config}

pnpm -C packages/types init -y
pnpm -C packages/compiler init -y
pnpm -C packages/sdk init -y
pnpm -C packages/view-sdk init -y
pnpm -C packages/event-bus init -y
pnpm -C packages/ui init -y
pnpm -C packages/connectors init -y     # P1: connectors are stubs
pnpm -C packages/action-runtime init -y # P1: sandbox SDK stubs
pnpm -C packages/config init -y

pnpm add -D -w typescript eslint prettier turbo tsx zod
```

### 4.5 Offline foundation (shell)
- Add **Service Worker** registration stub (OFFLINE_SW_ENABLED flag).
- Create `packages/sdk/offline/` with: IndexedDB (Dexie) setup, outbox queue, entity cache, conflict resolver hooks (`text_delta`, `field_merge`, `last_write_wins`).
- Provide **Sync Engine** stub in `apps/shell` that:
  - persists entities opened/edited,
  - records operations (OT/delta or whole‑field patches),
  - replays when online,
  - resolves conflicts using manifest v0.2 policies.

### 4.6 Event Bus (LEB)
- `packages/event-bus`: simple pub/sub with topic registry, rate limiting, and state store for `qos: state` topics.
- `packages/view-sdk`: postMessage bridge to iframes; helpers: `subscribe`, `unsubscribe`, `getState`, `announceReady`.

### 4.7 Database & Compiler
```bash
# API deps already installed; ensure Drizzle CLI is configured.
mkdir -p infra/db/migrations infra/db/seeds
```
- **Compiler outputs**: entity map (Tier 1 JSONB), logical views, and UI registry. No DDL at install unless promotion requested.
- Tables to create (system): `users`, `projects`, `memberships`, `bobbins_installed`, `manifests_versions`, `publish_targets`, `provenance_events`, `collections_registry`, `compiler_events`.
- **Entities Tier 1** tables: `entities`, `relations`, `entity_history`.

### 4.8 PEH (P1 — optional now)
- Create `apps/peh` (or fold into API) exposing WS; store last‑state per shared topic in Redis; fan‑out to subscribers.
- CLI should generate config but not enable by default.

---

## 5) Manifest Spec (v0.2)

**Location:** `packages/types/manifest.schema.json` (ships with v0.2).  
Adds:
- **offline** hints (redact/delta/conflict policies)
- **pubsub.produces/consumes** (topics, qos, sensitivity, rate limits, shared)
- **extensions** (target + contributions to slots; optional panel entry)
- **augmentations** (additive fields to host collections)
- Storage hints: `storage: auto|prefer_physical|physical_strict`
- Index hints, interactions (workflows/actions)

CLI task: place schema file and set up validation in compiler.

---

## 6) Compiler Responsibilities (reconfirm)

- Parse + validate manifest v0.2.
- **Tiered storage**: default Tier 1 JSONB; promote to physical tables based on thresholds or hints.
- Generate Drizzle migrations when physicalizing; register logical views for stable access.
- Update **entity map** and **UI registry** (views, slots, contributions).
- Record events in `compiler_events`; provenance for migrations/publish.

---

## 7) Shell Responsibilities (updated for v1)

- **Auth + Project picker**
- **Offline‑first**: SW + IndexedDB cache + outbox + sync engine (delta for editor fields)
- **Editor**: TipTap; emits `selection`/`wordcount` topics to **LEB** under declared rate limits/sensitivity.
- **Slots system**: toolbar, right panel, badges, command palette — render contributions from extensions; permissions UI.
- **Right Panel**: support panel activation & lifecycle; wire **Dictionary Panel** sample.
- Global command palette; entity inspector; link autocomplete (e.g., `@Scene:…`).

---

## 8) API Responsibilities (v1)

- Session verification (NextAuth JWT).
- Manifest install endpoint: `POST /projects/:id/bobbins/install`.
- Compiler driver endpoints (validate → diff → plan → apply).
- CRUD **entity** endpoints that honor the entity map (Tier 1 vs 2).
- Publish snapshot endpoint → static bundle → `publish_targets`.
- (P1) Jobs API, connectors, and egress proxy for workflows/actions.

---

## 9) Security & Sandbox

- Views run in `iframe` with `sandbox` attrs; strict CSP; no network by default.
- External access only via **connectors/egress proxy** with allowlisted domains & scopes → user approval.
- **Provenance** for external calls, promotions, publish, and extension actions.
- Kill‑switch per bobbin; Safe Mode (disable third‑party extensions).

---

## 10) Pub/Sub Topics (initial)

- `manuscript.editor.selection.v1` — realtime (≤10 Hz), sensitivity **medium**, not shared.
- `manuscript.metrics.wordcount.v1` — batch (1s), sensitivity **low**, **shared: true** (PEH eligible).

Shell enforces producer rate limits; consumers declare required sensitivity; permission prompts if `sideEffects: external:*`.

---

## 11) Milestones & Checklists (updated)

### Milestone A — Repo & Infra
- [ ] Monorepo bootstrapped (pnpm, turbo, TS configs)
- [ ] Next.js shell at :3000
- [ ] Fastify API at :4000
- [ ] Postgres reachable; Drizzle migrations runner
- [ ] .env.example committed; basic README

### Milestone B — Compiler & Manifest v0.2
- [ ] v0.2 schema placed in `packages/types`
- [ ] Compiler: parse → validate → entity map (Tier 1) → UI registry
- [ ] System tables created; endpoints wired
- [ ] Install flow accepts **Manuscript**

### Milestone C — Manuscript + Corkboard (Walking Skeleton)
- [ ] Outline view (tree) + Editor view (TipTap)
- [ ] Corkboard board view; drag‑to‑reorder persists `order`
- [ ] Snapshot Publish → static bundle URL

### Milestone D — Offline & LEB (v1 P0)
- [ ] Service Worker registered (feature‑flagged)
- [ ] IndexedDB cache + outbox queue (Dexie)
- [ ] Sync engine applies diffs and resolves conflicts (`text_delta` for Scene.body)
- [ ] LEB implemented; selection + wordcount topics published with rate limits

### Milestone E — Extensions & Right Panel
- [ ] Slots rendered in Shell (toolbar, right panel, badges)
- [ ] Permissions prompt for contributions (read/write scopes)
- [ ] **Dictionary Panel** bobbin installed; panel subscribes to selection and renders local lexicon

### Milestone F — (P1) PEH & Connectors (Optional now)
- [ ] WS gateway behind feature flag
- [ ] Redis/NATS fan‑out for shared topics
- [ ] Connectors stubs + Action Runner skeleton

---

## 12) CLI Command Cheat‑Sheet

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

## 13) Definition of Done (v1)

- **Offline‑first**: edit a Scene offline, close the tab, reopen later online — changes sync and merge correctly (no data loss).  
- **LEB topics**: selection + wordcount published by Manuscript; **Dictionary Panel** consumes selection and updates in real time.  
- **Extensions**: slot contributions render; permissions enforced; actions logged to provenance.  
- **Install/Publish**: can install Manuscript & Corkboard, edit scenes, reorder, and produce a snapshot bundle URL.  
- **Tiered storage**: all schema created via compiler; Tier 1 JSONB by default; promotion path documented.

---

## 14) Appendices

### A) Slot taxonomy (initial)
- `manuscript.editor.toolbar` (button/menu)
- `manuscript.inspector.panel` (right panel; iframe)
- `manuscript.corkboard.card.badge`
- `shell.commandPalette`
- `shell.rightPanel` (alias of inspector panel for cross‑bobbin panels)

### B) Error envelope (stub)
```
{ code: 'EXT_PERMISSION_DENIED', message, hint?, cause? }
```

### C) Topic envelope (stub)
```
{ topic, ts, producer, instance, entityRef?, sensitivity, qos, payload }
```

### D) Conflict Policies
- `text_delta` for long text (TipTap/ProseMirror)
- `field_merge` for structured fields
- `last_write_wins` for counters/derived
