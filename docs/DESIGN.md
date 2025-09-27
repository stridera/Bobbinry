# Bobbins: Project Overview & Design Decisions

## Vision
Bobbins is a modular, open‑source platform for writers, worldbuilders, and creative makers. The core website is an empty shell that becomes useful once users install **bobbins**—modular tools that add data structures, interfaces, and workflows. Each bobbin manages its own domain (e.g., manuscripts, maps, entities) and can link to other bobbins to create rich, interconnected creative projects.

The goal: empower creators to tailor their writing or worldbuilding environment exactly how they want, while fostering a community ecosystem of bobbin developers.

---

## Core Concepts

### Bobbins
- **Definition**: Self‑contained modules that declare data (collections & fields), UI (views), interactions (actions/scripts), and optional external access.
- **Linking**: Entities in one bobbin can link to entities in another using a standard global ID + resolver (`@bobbin:entity_id`).
- **Extensibility**: Bobbins can provide new UI views, from corkboards to maps to timelines.

### Projects
- A project is a container of bobbins, data, and views.
- Users may have multiple projects, each with its own installed bobbins.
- Free tier projects are limited in storage and features; paid tiers unlock publishing, external integrations, and collaboration.

### Publishing
- Controlled by a dedicated **Publish bobbin** that orchestrates public output across bobbins.
- Modes:
  - **Live**: Always up to date with edits.
  - **Snapshot**: Immutable version for releases/editions.
  - **Preview**: Staged draft for review before release.
- Publishing guarantees provenance, stable links, and optional disclosure of “bobbins used.”

### External Access
- External‑capable bobbins must declare endpoints, scopes, and permissions in their manifest.
- User consent required at install time (OAuth‑style prompts).
- Sandbox execution ensures outbound requests are restricted and logged.
- First‑party examples: “Word Count API (NaNoWriMo),” “Notify (Twitter/Slack).”

### AI Bobbins
- Treated as optional power tools, not defaults.
- Must declare when they generate or edit content.
- Provenance tags attached to all AI‑assisted content.
- Users may choose to disclose bobbin usage on published works.

---

## Design Decisions

### 1. Project Model
- **Hybrid approach**: free users can create multiple projects with limited storage. Paid tiers unlock larger storage, external integrations, AI credits, publishing bandwidth, and team features.

### 2. Schema Abstraction
- Bobbins declare **collections & fields** at a logical level (semantic types like `short_text`, `relation(Scene)`).  
- The platform compiles this into optimized database structures automatically.
- Advanced developers may add optional optimization hints.

### 3. Linking Standard
- All links use **stable relational IDs** with a global resolver.  
- References appear in text as `@bobbin_slug:entity_id` but are stored as relational links under the hood.

### 4. Provenance & Transparency
- Every entity carries provenance metadata (created, edited, AI assisted, external calls).  
- Publishing may display a “Bobbins Used” badge to highlight tools and reassure readers.

### 5. External Access Policy
- **Default deny**: bobbins cannot access the internet unless explicitly declared and approved by the user.  
- External‑access bobbins run in isolated sandboxes with logs and revocable permissions.

### 6. View Extensibility
- Three levels:
  - **Compose**: arrange built‑in widgets declaratively.
  - **Extend**: build novel layouts with the View SDK (sandboxed).
  - **Embed**: ship micro‑frontends (strict sandbox + review).

### 7. Open vs Closed
- **Open source core**: the shell and SDK are free to run locally or self‑host.  
- **Monetization** comes from:
  - Hosted SaaS (easy hosting, updates, scaling).
  - Marketplace revenue share for paid bobbins.
  - Premium features: publishing bandwidth, integrations, collaboration, AI credits.

---

## Growth & Sustainability

### Growth Drivers
- Low barrier entry: free multiple projects encourages experimentation.  
- Ecosystem: community bobbin development fuels variety.  
- Social visibility: publishing, integrations, and “Bobbins Used” badges create organic spread.

### Sustainability
- Text‑heavy use is cheap to host; revenue comes from image storage, publishing, integrations, and team features.  
- Paid tiers align with when users go from “drafting privately” → “sharing publicly.”

---

## Next Steps
1. Draft a **Bobbins Principles Doc** (this file is the start).  
2. Define the **bobbin manifest format** (collections, UI, interactions, external).  
3. Prototype a minimal shell: project creation, bobbin install, Manuscript + Corkboard.  
4. Build toward Publish + External bobbins after MVP.

---

*Bobbins will grow as a community‑driven, open‑source ecosystem, balancing creativity, trust, and sustainability.*
