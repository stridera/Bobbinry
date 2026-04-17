# bobbinry

CLI for the [Bobbinry](https://bobbinry.com) writing platform. Access your projects, entities, and stats from the terminal — built for both humans and AI agents.

## Install

```bash
npm install -g bobbinry
```

Or run directly:

```bash
npx bobbinry
```

## Setup

1. Create an API key at [bobbinry.com/settings/api-keys](https://bobbinry.com/settings/api-keys)
2. Configure it:

```bash
bobbinry config set api-key bby_your_key_here
```

## Commands

```
bobbinry projects              List your projects
bobbinry projects get <id>     Project details
bobbinry projects create <n>   Create a new project

bobbinry entities list <coll>  List entities in a collection
bobbinry entities get <id>     Get a single entity
bobbinry entities create       Create an entity
bobbinry entities update <id>  Update an entity
bobbinry entities delete <id>  Delete an entity

bobbinry stats                 Dashboard stats
bobbinry whoami                Current user info

bobbinry discover              Browse published projects
bobbinry read <slug>           Read published content
bobbinry export <id> <format>  Export a project
bobbinry config                Manage CLI configuration
```

## JSON output

Every command supports `--json` for machine-readable output:

```bash
bobbinry projects --json
bobbinry entities list content -p <project-id> --json
```

## Global options

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |
| `--api-url <url>` | Override API base URL |
| `--api-key <key>` | Override API key (one-shot) |
| `--verbose` | Show request/response details |

## API key resolution

The CLI looks for an API key in this order:

1. `--api-key` flag
2. `BOBBINRY_API_KEY` environment variable
3. `~/.config/bobbinry/config.json`
4. `~/.config/bobbinry/.env` (legacy)

## License

AGPL-3.0-only
