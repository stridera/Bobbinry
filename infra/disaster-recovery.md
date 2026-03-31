# Bobbinry Disaster Recovery Runbook

> **RTO Target**: < 1 hour | **RPO Target**: < 24 hours (pg_dump) / < 5 minutes (Neon PITR)

## Backup Inventory

| Layer | Method | Frequency | Retention | Location |
|-------|--------|-----------|-----------|----------|
| Full DB dump | `pg_dump` via GitHub Actions | Daily 08:00 UTC | 30 days | Cloudflare R2 `s3://bobbinry/backups/` |
| Neon PITR | Continuous WAL archival | Continuous | 7 days | Neon-managed (us-west-2) |
| Application content | Google Drive bobbin | Manual + auto-sync | Indefinite | User's Google Drive |

---

## 1. Restore from R2 pg_dump Backup

Use this when Neon PITR is unavailable or you need a restore point older than 7 days.

### Prerequisites

- AWS CLI configured with R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)
- PostgreSQL client matching the backup version (currently v17)
- Neon project access or a target PostgreSQL instance

### Steps

```bash
# 1. List available backups
aws s3 ls s3://bobbinry/backups/ \
  --endpoint-url https://10b4eb9968acd38f4341ddf74d3ac599.r2.cloudflarestorage.com \
  --region auto

# 2. Download the target backup
BACKUP_FILE="bobbinry-prod-2026-03-30_080000.sql.gz"
aws s3 cp "s3://bobbinry/backups/${BACKUP_FILE}" "./${BACKUP_FILE}" \
  --endpoint-url https://10b4eb9968acd38f4341ddf74d3ac599.r2.cloudflarestorage.com \
  --region auto

# 3. Verify the file is not corrupt
gunzip -t "${BACKUP_FILE}"
ls -lh "${BACKUP_FILE}"  # Should be >1 KB

# 4. Create a fresh Neon branch for the restore (avoids overwriting production)
#    Use the Neon console or CLI:
neonctl branches create --project-id shy-dust-15582829 --name "restore-$(date +%Y%m%d)"

# 5. Get the connection string for the new branch
RESTORE_URL="postgres://...@...neon.tech/neondb?sslmode=require"

# 6. Restore the dump into the new branch
gunzip -c "${BACKUP_FILE}" | psql "${RESTORE_URL}"

# 7. Verify data integrity
psql "${RESTORE_URL}" -c "SELECT count(*) FROM users;"
psql "${RESTORE_URL}" -c "SELECT count(*) FROM entities;"
psql "${RESTORE_URL}" -c "SELECT max(\"createdAt\") FROM entities;"

# 8. If verified, promote the branch to main:
#    - Option A: Update DATABASE_URL on Fly to point to the new branch
#    - Option B: Use Neon console to set the branch as primary
```

### Switching Production to the Restored Branch

```bash
# Update the Fly secret to point to the restored branch
fly secrets set DATABASE_URL="<new-branch-connection-string>" --app bobbinry-api

# Restart the API to pick up the new connection
fly apps restart bobbinry-api

# Verify the API is healthy
curl https://api.bobbinry.com/health
```

---

## 2. Restore from Neon PITR (Branch-Based)

Use this for recent incidents (within 7 days). This is the fastest recovery path.

### Steps

```bash
# 1. Identify the point-in-time to restore to (before the incident)
#    Check API logs, error reports, or monitoring to find the timestamp

# 2. Create a branch from the desired point in time
#    Via Neon Console:
#      → Project shy-dust-15582829 → Branches → Create Branch
#      → Select "From: main" and set the timestamp
#
#    Via CLI:
neonctl branches create \
  --project-id shy-dust-15582829 \
  --name "pitr-restore-$(date +%Y%m%d)" \
  --parent main \
  --timestamp "2026-03-30T10:00:00Z"

# 3. Get the connection string for the new branch
neonctl connection-string \
  --project-id shy-dust-15582829 \
  --branch "pitr-restore-$(date +%Y%m%d)"

# 4. Verify data on the branch
PITR_URL="<branch-connection-string>"
psql "${PITR_URL}" -c "SELECT count(*) FROM users;"
psql "${PITR_URL}" -c "SELECT max(\"createdAt\") FROM entities;"

# 5. If correct, promote to production:
#    Option A (recommended): Reset main branch to this point
#    → Neon Console → Branch → "Reset from parent" or rename branches
#
#    Option B: Update Fly secrets to point to the new branch
fly secrets set DATABASE_URL="${PITR_URL}" --app bobbinry-api
fly apps restart bobbinry-api

# 6. Verify production
curl https://api.bobbinry.com/health
```

### Important Notes

- Neon PITR branches are **copy-on-write** — creating one is instant and free
- The branch inherits all data up to the specified timestamp
- PITR is limited to the retention window (currently 7 days on paid tier)

---

## 3. Restore Individual Tables

Use this when only specific tables are corrupted or need rollback.

### From pg_dump Backup

```bash
# 1. Download and extract the backup (see Section 1, steps 1-3)

# 2. Create a temporary restore branch
neonctl branches create --project-id shy-dust-15582829 --name "table-restore-tmp"
TEMP_URL="<temp-branch-connection-string>"

# 3. Restore the full dump into the temporary branch
gunzip -c "${BACKUP_FILE}" | psql "${TEMP_URL}"

# 4. Export only the target table from the temporary branch
pg_dump "${TEMP_URL}" \
  --table=public.entities \
  --data-only \
  --no-owner \
  --no-privileges \
  > entities_data.sql

# 5. On the production database, clear and re-import the table
#    CAUTION: This deletes current data in the table
PROD_URL="<production-connection-string>"
psql "${PROD_URL}" -c "BEGIN; TRUNCATE entities CASCADE; \i entities_data.sql; COMMIT;"

# 6. Verify
psql "${PROD_URL}" -c "SELECT count(*) FROM entities;"

# 7. Clean up the temporary branch
neonctl branches delete "table-restore-tmp" --project-id shy-dust-15582829
```

### From Neon PITR Branch

```bash
# 1. Create a PITR branch at the desired timestamp (see Section 2)

# 2. Copy data between branches using pg_dump/psql pipe
pg_dump "${PITR_URL}" \
  --table=public.entities \
  --data-only \
  --no-owner \
  --no-privileges \
  | psql "${PROD_URL}"

# 3. Clean up the PITR branch
neonctl branches delete "pitr-restore-..." --project-id shy-dust-15582829
```

---

## 4. Contact Escalation Chain

| Priority | Who | Contact | When |
|----------|-----|---------|------|
| P0 — Full outage | Strider (owner) | Direct message / phone | Immediately |
| P1 — Data loss or corruption | Strider | Direct message | Within 15 minutes |
| P2 — Degraded performance | Strider | Email or message | Within 1 hour |
| P3 — Non-critical issue | Strider | GitHub issue | Next business day |

### Service-Specific Escalation

| Service | Dashboard | Support |
|---------|-----------|---------|
| Neon (database) | [console.neon.tech](https://console.neon.tech) | Neon support ticket |
| Fly.io (API hosting) | [fly.io/apps/bobbinry-api](https://fly.io/apps/bobbinry-api) | `fly doctor` / community forum |
| Vercel (frontend) | [vercel.com](https://vercel.com) | Vercel support ticket |
| Cloudflare (DNS/R2) | [dash.cloudflare.com](https://dash.cloudflare.com) | Cloudflare support |
| Stripe (payments) | [dashboard.stripe.com](https://dashboard.stripe.com) | Stripe support |

---

## 5. Recovery Targets

| Metric | Target | Current Capability |
|--------|--------|--------------------|
| **RTO** (Recovery Time Objective) | < 1 hour | ~30 min via Neon PITR, ~45 min via R2 restore |
| **RPO** (Recovery Point Objective) | < 5 min (PITR) / < 24 hr (pg_dump) | Neon PITR: continuous. pg_dump: daily at 08:00 UTC |

### Decision Matrix

| Scenario | Method | Expected Recovery Time |
|----------|--------|----------------------|
| Database corruption (last 7 days) | Neon PITR branch | ~15 minutes |
| Database corruption (older than 7 days) | R2 pg_dump restore | ~30-45 minutes |
| Single table corruption | PITR branch + table-level copy | ~20 minutes |
| Neon outage (full provider failure) | R2 pg_dump to alternate PG host | ~45-60 minutes |
| Accidental data deletion | Neon PITR to exact pre-deletion timestamp | ~15 minutes |

---

## 6. Post-Recovery Checklist

After any restore operation:

- [ ] Verify API health: `curl https://api.bobbinry.com/health`
- [ ] Verify frontend loads: `curl -I https://bobbinry.com`
- [ ] Check migration status in API logs: `fly logs --app bobbinry-api | head -50`
- [ ] Verify user login works (test with a known account)
- [ ] Verify Stripe webhooks are flowing: check Stripe dashboard events
- [ ] Check for orphaned Neon branches and clean up
- [ ] Document the incident: what happened, timeline, root cause, what was restored
- [ ] Update this runbook if any steps were incorrect or missing
