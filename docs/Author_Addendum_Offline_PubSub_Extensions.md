
# Bobbin Author Addendum — Offline, Pub/Sub, Extensions (v0.2)

This addendum highlights **v1 priorities** and how authors should use the new manifest fields added in v0.2.

## Priorities for v1
**P0**
- Offline-first: cache strategy, conflict policies (use `text_delta` for long text).
- Local Event Bus (LEB): selection + wordcount topics with rate limits.
- Extensions: toolbar/panels/badges via slots; prefer workflows over custom actions.

**P1**
- Project Event Hub (shared topics), team sprints.
- Suggestion mode & comments.
- Auto-indexer proposals UI.

**P2**
- CRDT collaboration, granular RLS, marketplace payments.

## Field-level Offline & Sync hints
```yaml
data:
  collections:
    - name: Scene
      fields:
        - name: body
          type: markdown
          offline: { deltaStrategy: text_delta, conflictPolicy: text_delta }
        - name: synopsis
          type: long_text
          offline: { conflictPolicy: field_merge }
        - name: private_notes
          type: long_text
          offline: { redact: true }
offline:
  defaultCache: open_entities
  excludeFields: [Scene.private_notes]
sync:
  conflictPolicy: field_merge
  fieldPolicies:
    - { path: Scene.body, policy: text_delta }
```

## Pub/Sub producers (examples)
```yaml
pubsub:
  produces:
    - { topic: manuscript.editor.selection.v1, qos: realtime, sensitivity: medium, rateLimitHz: 10, shared: false }
    - { topic: manuscript.metrics.wordcount.v1, qos: batch, batchMs: 1000, sensitivity: low, shared: true }
```

## Panel consuming selection (dictionary)
```yaml
extensions:
  contributions:
    - slot: shell.rightPanel
      type: panel
      id: dict.panel
      title: "Dictionary"
      entry: views/dict/index.html
      pubsub:
        consumes:
          - { topic: manuscript.editor.selection.v1, intent: dictionary-lookup, sensitivityRequired: medium }
      when: { inView: manuscript.editor }
```

## Export without code (workflow)
```yaml
interactions:
  actions:
    - { name: export_to_drive, label: "Export to Drive", trigger: user_button, workflow: workflows/export-drive.yaml }
external:
  services:
    - { id: google-drive, domains: ["www.googleapis.com","oauth2.googleapis.com"], scopes: ["drive.file"] }
```

## Checklist
- [ ] Manifest validates against v0.2 schema
- [ ] Offline hints set; sensitive fields redacted
- [ ] Pub/Sub topics declared with rate limits & sensitivity
- [ ] Permissions minimal; no secrets in package
- [ ] Workflows preferred over custom actions
