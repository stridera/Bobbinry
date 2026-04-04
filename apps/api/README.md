# Bobbinry API

Fastify-based backend for Bobbinry. See **[docs/API.md](../../docs/API.md)** for the full endpoint reference.

## Quick Start

```bash
# From monorepo root
bun install
bun run dev          # Starts API on port 4100 + shell on port 3100
```

## Structure

```
src/
├── index.ts              # Entry point, migration runner
├── server.ts             # Fastify setup, plugin registration
├── db/                   # Schema, connection, seeds
├── routes/               # Route plugins
├── middleware/auth.ts     # JWT + API key auth
├── lib/                  # Shared utilities
└── jobs/                 # Background handlers
```
