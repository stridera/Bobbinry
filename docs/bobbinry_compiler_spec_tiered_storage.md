
# Bobbinry Compiler Spec — Tiered Storage & Promotion (v0.1)

**Status:** Draft (planning → implementation reference)  
**Audience:** Core platform engineers, SDK authors, bobbin authors (for reference)  
**Purpose:** Define how the compiler ingests manifests, maps logical schemas to storage, and promotes hot collections from a generic JSONB store to dedicated physical tables safely and transparently.

---

## 1) Goals & Non‑Goals

### Goals
- **Fast installs**: installing a bobbin should avoid DDL by default.
- **Tiered storage**: default to **Tier 1 JSONB** with selective promotion to **Tier 2 physical tables**.
- **Safety**: transactional migrations, rollbacks, and provenance for changes.
- **Predictable API**: Shell/SDK query the same way regardless of storage tier.
- **Performance**: auto-indexing & generated columns for hot paths.
- **Multi‑tenant**: project‑scoped data with minimal catalog bloat.

### Non‑Goals (v0.1)
- Cross‑project joins (out of scope).  
- Arbitrary SQL from bobbins.  
- Row‑level security (planned for v0.2+).

---

## 2) Definitions

- **Manifest**: Declarative file describing a bobbin’s collections, fields, views, interactions, external access, publish rules.
- **Collection**: Logical entity type (e.g., `Scene`, `Chapter`).
- **Entity**: A single record instance of a collection.
- **Entity Map**: Routing table describing where each collection lives (Tier 1 vs Tier 2) and how to access it.
- **Promotion**: Migration of a collection from Tier 1 (JSONB) to a Tier 2 dedicated table + indexes.

---

## 3) Storage Model

### 3.1 Tier 1 — Unified Entities (JSONB)
Single set of tables shared by all bobbins and projects.

- `entities`  
  - `project_id` (uuid)  
  - `bobbin_id` (text)  
  - `collection` (text)  
  - `entity_id` (uuid)  
  - `body` (jsonb)  — fields as declared by manifest  
  - `search_vector` (tsvector, nullable)  
  - `created_at` (timestamptz), `updated_at` (timestamptz)  
  - **PK**: `(project_id, bobbin_id, collection, entity_id)`  
  - **Indexes**:  
    - GIN on `body` (jsonb_path_ops) optional  
    - GIN on `search_vector` when any field is `searchable: true`  
    - Optional generated columns (see §7)

- `relations` (soft relations; validated at write)  
  - `project_id`, `src_ref`, `dst_ref`, `type`, `created_at`  
  - `src_ref`/`dst_ref` format: canonical logical identifier (see §5.3).

- `entity_history` (append‑only)  
  - `project_id`, `bobbin_id`, `collection`, `entity_id`, `version`, `diff_json`, `actor`, `created_at`

> **Rationale:** avoids table explosion; allows instant install & iteration.

### 3.2 Tier 2 — Physical Tables (Per Collection)
Created selectively when a collection is “promoted”.

- Naming: `p_<hash>__<bobbin>__<collection>` (stable, collision‑safe).  
- Columns derived from manifest field types (compiler chooses SQL types).  
- Hard FKs for declared relations (within project scope).  
- Indexes from hints and query telemetry.  

### 3.3 Logical Views (Stable Interface)
For each collection, compiler maintains a **logical SQL VIEW** with a fixed column set that projects Tier 1 or Tier 2 into a common shape. SDK/API read through these views to avoid branching.

---

## 4) Metadata & Catalog Tables

- `bobbins_installed` (project‑scoped): installed bobbins + active manifest JSON + status.  
- `manifest_registry` (global): known bobbins/versions, signatures, compatibility.  
- `collections_registry` (project‑scoped): list of collections, current storage tier, view name, routing info.  
- `index_budget` (project‑scoped): caps & current usage for auto indexes.  
- `compiler_events` (project‑scoped): audit trail for promotions, migrations, rollbacks.

---

## 5) Manifest Ingestion (Install/Upgrade)

### 5.1 Validation
- Validate against JSON Schema.  
- Check `compatibility.minShellVersion`.  
- Verify signature if provided (future: trust chain).

### 5.2 Registration
- Record manifest in `bobbins_installed` and `collections_registry` (Tier = `T1` by default).  
- Compute **field map** for each collection (type, searchable, sort_key, etc.).  
- No DDL by default.

### 5.3 Logical IDs & References
- Canonical logical ref: `project_id:bobbin_id:collection:entity_id`.  
- Store and display shorthand `@bobbin.collection:entity_id`, but never rely on it for integrity.  
- The resolver service maps shorthand ↔ canonical for UI.

---

## 6) Read/Write Routing

- **Entity Map** (in memory cache per API instance) describes for each `(project_id, bobbin_id, collection)` whether reads/writes go to Tier 1 or Tier 2 and which view/table to target.  
- Shell/SDK call generic CRUD; API resolves route using the map; compiler updates the map upon promotions.

---

## 7) Indexing & Generated Columns (Tier 1)

### 7.1 Auto Indexer
- When a field is marked `searchable: true`, create/maintain `search_vector` with weighted concatenation.  
- For frequent filters/sorts (`sort_key`, `facet`, `frequently_filtered`), create **generated columns** (e.g., `gc_order int generated always as ((body->>'order')::int) stored`) and B‑tree indexes.  
- Respect **index budget** per project (default caps, e.g., 30). Promote instead of over‑indexing when thresholds are exceeded.

### 7.2 Manifest Hints → Indexes
- `searchable`, `unique`, `sort_key`, `facet`, `timeline`, `prefix_match` map to appropriate indexes or trigram ops.  
- Conflicts with index budget → queues a **proposal** in `compiler_events` (manual approval path).

---

## 8) Promotion Policy

### 8.1 Triggers
A collection becomes a candidate for promotion when one or more is true:
- Row count > **N** (default 50k)  
- P95 latency > **target** (e.g., 200ms) for key queries over **M** requests/day  
- Index budget exceeded with **failed proposals** for that collection  
- Manifest hint: `storage: prefer_physical` or `storage: physical_strict`  
- Manual admin request

### 8.2 Decision
- Compile a **promotion plan**: expected size, DDL, backfill strategy, downtime (should be zero), rollback path.  
- Dry‑run with cost estimates; record plan in `compiler_events`.  
- Execute during low‑traffic window or immediately if size small.

---

## 9) Promotion Execution (Zero/Low Downtime)

1. **Prepare DDL**: create table `p_*` with columns & indexes; maintain `project_id` for tenancy.  
2. **Backfill**: batch copy from `entities` with pagination; verify row counts & checksums.  
3. **Dual‑write (optional)**: for write‑heavy collections, briefly enable dual‑write (Tier 1 + Tier 2) behind a feature flag.  
4. **Cutover**: flip the Entity Map route to Tier 2; update `collections_registry`.  
5. **Post‑verify**: compare sample queries across tiers.  
6. **Cleanup**: mark Tier 1 rows as archived; keep for rollback TTL (e.g., 7 days) then prune.  
7. **Record**: append event to `compiler_events` and provenance for affected entities.

**Rollback**: flip route back to Tier 1 and drop the physical table (or keep as cold).

---

## 10) Integrity Model

### 10.1 Tier 1 (Soft Integrity)
- On write of relations, validate target existence; if missing, mark relation as **unresolved**; surface in UI and **block publish** unless overridden.  
- Background **consistency sweeper** fixes drift when manifests change (renames, splits).

### 10.2 Tier 2 (Hard Integrity)
- Use FKs (`project_id` + PK) for declared relations within the project.  
- Enforce unique constraints and check constraints derived from manifest validations.

---

## 11) Migrations (Manifest Upgrades)

### Supported logical changes (v0.1)
- Add/rename/remove field (with optional transform)  
- Add/rename/remove collection  
- Add/rename/remove relation  
- Change field options (enum add/remove; validator change)

### Process
1. **Diff** old vs new manifest.  
2. **Plan**: Tier 1: update field maps, reindex/search vector if needed; Tier 2: generate DDL migrations.  
3. **Transformers**: optional field transforms declared by manifest (`compute from` or value mapping).  
4. **Transaction**: apply changes; update views; refresh Entity Map.  
5. **Compat layer**: maintain deprecated fields readable until next major version if flagged.  
6. **Record** in `compiler_events` + provenance.

---

## 12) Tenancy & Namespacing

- Single shared schema; **no per‑project schemas**.  
- Every table keyed by `project_id`; enforce access in API layer (RLS later).  
- Physical tables remain shared; `project_id` filters ensure isolation.

---

## 13) Garbage Collection

- **Uninstall bobbin**:  
  - If collection is Tier 2: demote by exporting to Tier 1 (optional) → drop physical table.  
  - Delete/Archive Tier 1 rows for that `bobbin_id`.  
  - Remove views and routing entries.  
- **Orphaned indices**: auto‑drop unused generated columns/indexes after TTL.  
- **Archive policy** configurable per project.

---

## 14) Observability

- Metrics: install latency, promotion count, backfill throughput, query P95/P99 by collection, index budget usage.  
- Logs: promotion plans, DDL statements, errors, rollbacks.  
- Tracing: compiler phases (validate → diff → plan → migrate → cutover).

---

## 15) Security

- Compiler runs with limited DB privileges; DDL only via controlled module.  
- Manifest signatures (optional v0.1; stricter in v0.2+).  
- No arbitrary SQL from bobbins; only declarative schema → compiler‑generated SQL.  
- Data exfiltration: N/A (compiler); external egress handled by the **gateway** service.

---

## 16) Configuration (Defaults; override via env/admin)

- `PROMOTION_ROW_THRESHOLD` (default 50_000)  
- `PROMOTION_P95_MS` (default 200)  
- `INDEX_BUDGET_PER_PROJECT` (default 30)  
- `PROMOTION_BACKFILL_BATCH_SIZE` (default 5_000 rows)  
- `PROMOTION_ROLLBACK_TTL_DAYS` (default 7)  
- `AUTO_INDEXER_ENABLED` (default true)

---

## 17) API & Contracts (Compiler ↔ API ↔ Shell)

- `POST /projects/:id/bobbins/install` → { manifest }  
  - Validates + registers; returns collections list + initial Entity Map entries.
- `GET /projects/:id/entity-map` → current routing (Tier 1/2 per collection).  
- `POST /projects/:id/promotions/plan` → propose plan for a collection (admin/manual).  
- `POST /projects/:id/promotions/apply` → execute approved plan.  
- `GET /projects/:id/compiler/events` → audit entries.  

> SDK uses generic CRUD endpoints; routing is transparent.

---

## 18) Manifest Hints (Storage & Indexing)

At collection level:
```yaml
storage: auto | prefer_physical | physical_strict   # default: auto
index_hints:
  - field: order
    role: sort_key
  - field: title
    role: searchable
  - field: tags
    role: facet
cardinality: high | medium | low                    # guides index choice
```

At field level:
```yaml
searchable: true
unique: true
sort_key: true
facet: true
timeline: true
prefix_match: true
```

Compiler translates hints into generated columns, GIN/GIST/B‑tree indexes, or promotion proposals.

---

## 19) Limitations & Edge Cases

- **Huge JSONB documents** (> 1MB): force `physical_strict` or split into related collections.  
- **Cross‑bobbin FKs** in Tier 2: supported if both promoted; otherwise keep soft FK.  
- **Enums shrinking**: removal of enum values requires explicit migration policy (map/replace).  
- **Circular relations**: allowed; Tier 2 FKs may need deferred constraints.

---

## 20) Appendix — Tier 1 Table Shapes (Illustrative)

### entities
- PK: `(project_id, bobbin_id, collection, entity_id)`  
- Indexes: `(project_id, bobbin_id, collection)` btree; GIN on `body`; optional GIN `search_vector`  
- Generated columns created as needed per project/collection.

### relations
- `(project_id, src_ref, dst_ref, type)`; btree on `(project_id, src_ref)` and `(project_id, dst_ref)`

### entity_history
- `(project_id, bobbin_id, collection, entity_id, version)`; btree on `(project_id, entity_id)`

---

## 21) Rollout Plan

- v0.1 (MVP): Tier 1 default; manual promotions; indexer with budgets; logical views; install/upgrade flow; audit events.  
- v0.2: Auto promotions; dual‑write cutover; RLS policies; promotion UI in Shell.  
- v0.3: Cross‑project exports; advanced analyzers; warehouse sync.

---

**End of Spec**
