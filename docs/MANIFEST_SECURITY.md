# Manifest Security Principles

## Core Principle: Manifests are Untrusted Input

**All bobbin manifests must be treated as potentially malicious external input**, even if they claim to be from trusted sources. This document defines what manifests can and cannot control.

---

## Trust Boundary

```
┌─────────────────────────────────────────────────────┐
│ UNTRUSTED (From Manifest)                          │
│ • Data schema (collections, fields, relationships) │
│ • UI definitions (views, layouts)                  │
│ • Publish configuration                            │
│ • Interaction workflows                            │
│ • Metadata (name, version, description)           │
└─────────────────────────────────────────────────────┘
                         ↓
              ┌──────────────────┐
              │  VALIDATION &    │
              │  SANITIZATION    │
              └──────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│ TRUSTED (Platform Controlled)                       │
│ • Execution mode (native vs sandboxed)             │
│ • Storage tier (JSONB vs physical tables)          │
│ • Resource limits (CPU, memory, disk)              │
│ • Network access permissions                        │
│ • Database promotion decisions                      │
│ • Provenance and signatures                         │
└─────────────────────────────────────────────────────┘
```

---

## What Manifests CAN Declare

### ✅ Safe to Trust (After Validation)

1. **Data Schema**
   - Collection names and field definitions
   - Field types and constraints
   - Relationships between collections
   - Computed fields and validations

2. **UI Definitions**
   - View types and layouts
   - Display fields and formatting
   - Actions and interactions

3. **Publishing Rules**
   - Which entities to include in published output
   - Output formats (HTML, JSON, RSS)
   - Static site generation config

4. **Metadata**
   - Name, version, description
   - Author, license, tags
   - Compatibility requirements

---

## What Manifests CANNOT Control

### ❌ Never Trust from Manifest

1. **Execution Mode**
   - Native vs sandboxed execution
   - **Why**: Native bobbins run with full system access
   - **Decision**: Determined by provenance + admin approval

2. **Storage Tier**
   - Physical table promotion
   - Index budgets and priorities
   - **Why**: DDL operations are expensive and can cause DoS
   - **Decision**: Based on actual usage metrics + admin config

3. **Resource Limits**
   - CPU/memory quotas
   - Rate limiting
   - **Why**: Prevents resource exhaustion attacks
   - **Decision**: Platform-wide policies + per-bobbin overrides

4. **Network Access**
   - External API calls
   - Webhook endpoints
   - **Why**: Security and compliance requirements
   - **Decision**: Explicit admin approval required

5. **Permissions**
   - File system access
   - Database admin operations
   - **Why**: Privilege escalation risks
   - **Decision**: Based on trust level + sandboxing

---

## Provenance and Trust Levels

### Trust Levels

1. **First-Party** (`bobbins/` directory)
   - Maintained by Bobbins core team
   - Can use native execution
   - Auto-promoted to physical storage
   - Example: `manuscript`, `corkboard`

2. **Verified Third-Party**
   - Signed by known publishers
   - Code review completed
   - Sandboxed execution only
   - Tier 1 storage with performance-based promotion

3. **Community/Unverified**
   - Unknown or unsigned sources
   - Strict sandboxing enforced
   - Tier 1 storage only
   - No auto-promotion

### Configuration Files

**First-party bobbins** have companion `.config.json` files:

```json
{
  "bobbinId": "manuscript",
  "trust": {
    "level": "first-party",
    "verified": true
  },
  "execution": {
    "mode": "native"
  },
  "storage": {
    "tier": "physical",
    "autoPromote": true
  }
}
```

**External bobbins** have configuration stored in `bobbins_installed` table, controlled by admins.

---

## Installation Flow

### External Bobbin Installation

```
1. User requests bobbin installation
   ↓
2. Fetch manifest from source
   ↓
3. Validate against JSON Schema
   ↓
4. Scan for security issues
   ↓
5. Store manifest in bobbins_installed
   ↓
6. Create admin configuration (sandboxed, Tier 1)
   ↓
7. Generate Tier 1 migrations only
   ↓
8. Register views (sandboxed)
   ↓
9. Monitor performance metrics
   ↓
10. Admin can manually promote if needed
```

### First-Party Bobbin Installation

```
1. Bobbin exists in bobbins/ directory
   ↓
2. Load manifest + .config.json
   ↓
3. Validate trust signatures
   ↓
4. Apply trusted configuration
   ↓
5. Generate Tier 2 migrations (physical tables)
   ↓
6. Register native views
   ↓
7. No sandboxing applied
```

---

## Attack Vectors Prevented

### 1. Resource Exhaustion
- **Attack**: Manifest claims `storage: physical_strict` with 100 collections
- **Prevention**: Ignore storage hints, enforce Tier 1 default

### 2. Privilege Escalation
- **Attack**: Manifest claims `execution: native` to escape sandbox
- **Prevention**: Execution mode determined by provenance, not manifest

### 3. Network Access Abuse
- **Attack**: Manifest enables `external: true` to phone home
- **Prevention**: External access requires explicit admin approval

### 4. Index Bombing
- **Attack**: Manifest requests indexes on every field
- **Prevention**: Index budget limits + admin approval for overages

### 5. DDL DoS
- **Attack**: Manifest triggers expensive table promotions on install
- **Prevention**: Promotion based on usage metrics, not manifest hints

---

## Admin Controls

### Bobbin Configuration Screen (Future)

Admins should be able to:
- ✅ Approve/deny native execution for trusted bobbins
- ✅ Manually promote collections to physical storage
- ✅ Set custom resource limits per bobbin
- ✅ Enable/disable external network access
- ✅ Review and approve index proposals
- ✅ View performance metrics and promotion triggers

### Database Schema

```sql
-- Admin-controlled configuration
ALTER TABLE bobbins_installed ADD COLUMN
  execution_mode TEXT DEFAULT 'sandboxed'  -- 'sandboxed' | 'native'
  CHECK (execution_mode IN ('sandboxed', 'native'));

ALTER TABLE bobbins_installed ADD COLUMN
  trust_level TEXT DEFAULT 'community'  -- 'first-party' | 'verified' | 'community'
  CHECK (trust_level IN ('first-party', 'verified', 'community'));

-- Track promotion decisions
ALTER TABLE collections_registry ADD COLUMN
  promotion_status TEXT DEFAULT 'tier1'  -- 'tier1' | 'promoted' | 'pending_approval'
  promotion_approved_by UUID REFERENCES users(id),
  promotion_approved_at TIMESTAMPTZ;
```

---

## Validation Rules

### Manifest Validation Checklist

- [ ] Valid JSON Schema
- [ ] No SQL injection in collection/field names
- [ ] Field types are recognized
- [ ] Relationship targets exist
- [ ] View sources reference valid collections
- [ ] No circular dependencies
- [ ] Reasonable size limits (< 100 collections)
- [ ] No suspicious patterns (eval, system calls, etc.)

### Code Examples

```typescript
// ✅ CORRECT: Determine execution from config
const config = await loadBobbinConfig(bobbinId)
const executionMode = config.execution.mode // controlled by us

// ❌ WRONG: Trust manifest
const executionMode = manifest.execution?.mode // untrusted input
```

---

## Summary

**Golden Rule**: If a manifest field affects security, performance, or resource allocation, it must be validated and overridden by platform configuration, not trusted directly.

| Manifest Field | Trust Level | Enforcement |
|----------------|-------------|-------------|
| collections | Validate | Schema validation |
| fields | Validate | Type checking |
| views | Validate | XSS prevention |
| execution.mode | ❌ NEVER | Admin config only |
| storage.tier | ❌ NEVER | Usage-based |
| external | Validate | Admin approval |
| permissions | ❌ NEVER | Trust level |

**Remember**: Bobbins are plugins. Treat them like user-uploaded files, not trusted code.