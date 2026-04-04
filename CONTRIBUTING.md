# Contributing to Bobbinry

Thanks for your interest in contributing! Bobbinry is modular, open-source tooling for writers and worldbuilders. Whether you're fixing a bug, building a bobbin, or improving docs — we appreciate the help.

## Ways to contribute

- **Report bugs** — Use the [Bug Report](https://github.com/stridera/Bobbinry/issues/new?template=bug_report.yml) template
- **Request features** — Use the [Feature Request](https://github.com/stridera/Bobbinry/issues/new?template=feature_request.yml) template
- **Build a bobbin** — Create a new plugin module for writers (see [Bobbin development](#bobbin-development) below)
- **Improve documentation** — Fix typos, clarify guides, add examples
- **Share feedback** — Use the [Feedback](https://github.com/stridera/Bobbinry/issues/new?template=feedback.yml) template

## Prerequisites

- [Bun](https://bun.sh/) (package manager & runtime)
- [Node.js](https://nodejs.org/) 20+
- [PostgreSQL](https://www.postgresql.org/) 15+

## Getting started

```bash
git clone https://github.com/stridera/Bobbinry.git
cd Bobbinry
bun install
cp .env.example .env  # Configure your environment
```

## Project structure

| Directory | Description |
|-----------|-------------|
| `apps/shell/` | Next.js frontend (port 3100) |
| `apps/api/` | Fastify API server (port 4100) |
| `packages/` | Shared libraries — compiler, SDK, types, UI components |
| `bobbins/` | Plugin modules — manuscript, corkboard, entities, timeline, etc. |
| `infra/` | Database migrations and deployment config |

## Development workflow

1. **Discuss first** — Open an issue describing the problem or proposal before starting work.
2. **Fork & branch** — Use descriptive branch names:
   - `feat/add-word-count-panel`
   - `fix/corkboard-drag-offset`
   - `docs/update-api-reference`
3. **Make your changes** — Keep PRs focused and reasonably sized.
4. **Run checks before submitting:**

```bash
bun run typecheck      # TypeScript checking across all packages
bun run lint           # ESLint + schema drift check
bun run lint:bobbins   # Manifest validation
bun run test           # Run tests
```

5. **Submit a PR** — Link related issues, explain context, include screenshots for UI changes.

## Database migrations

If your changes modify `schema.ts`:

```bash
cd apps/api
bunx drizzle-kit generate --name descriptive_name
```

Always include the generated migration files in your PR. Production relies on these files — `drizzle-kit push` only applies locally.

## Bobbin development

Bobbins are self-contained plugin modules in the `bobbins/` directory. Each bobbin has its own manifest, UI components, and API routes. Check existing bobbins like `notes` or `goals` for reference on structure and conventions.

To create a new bobbin:

1. Open a [Feature Request](https://github.com/stridera/Bobbinry/issues/new?template=feature_request.yml) with "New Bobbin idea" selected
2. Discuss the design and scope
3. Use an existing bobbin as a template for the file structure
4. Include a valid bobbin manifest (`manifest.yaml`)
5. Run `bun run lint:bobbins` to validate your manifest

## Guidelines

- Keep PRs focused and reasonably sized
- Security-relevant changes must include a rationale
- Document user-facing changes
- Write tests for new functionality

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Security

To report a security vulnerability, please see our [Security Policy](SECURITY.md). Do not open a public issue for security concerns.
