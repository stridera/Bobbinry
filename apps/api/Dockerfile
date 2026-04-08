# ---- Build stage ----
FROM node:22-slim AS builder

# Install bun
RUN npm install -g bun@1.3.10

WORKDIR /app

# Copy workspace structure for dependency resolution
COPY package.json bun.lock turbo.json ./

# Apps
COPY apps/api/package.json apps/api/
COPY apps/shell/package.json apps/shell/

# Packages
COPY packages/action-runtime/package.json packages/action-runtime/
COPY packages/compiler/package.json packages/compiler/
COPY packages/config/package.json packages/config/
COPY packages/connectors/package.json packages/connectors/
COPY packages/event-bus/package.json packages/event-bus/
COPY packages/sdk/package.json packages/sdk/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/ui-components/package.json packages/ui-components/

# Bobbins
COPY bobbins/ai-tools/package.json bobbins/ai-tools/
COPY bobbins/cat/package.json bobbins/cat/
COPY bobbins/corkboard/package.json bobbins/corkboard/
COPY bobbins/dictionary-panel/package.json bobbins/dictionary-panel/
COPY bobbins/discord-notifier/package.json bobbins/discord-notifier/
COPY bobbins/discord-roles/package.json bobbins/discord-roles/
COPY bobbins/entities/package.json bobbins/entities/
COPY bobbins/export/package.json bobbins/export/
COPY bobbins/feedback/package.json bobbins/feedback/
COPY bobbins/goals/package.json bobbins/goals/
COPY bobbins/google-drive-backup/package.json bobbins/google-drive-backup/
COPY bobbins/hello-world/package.json bobbins/hello-world/
COPY bobbins/manuscript/package.json bobbins/manuscript/
COPY bobbins/notes/package.json bobbins/notes/
COPY bobbins/relationships/package.json bobbins/relationships/
COPY bobbins/timeline/package.json bobbins/timeline/
COPY bobbins/web-publisher/package.json bobbins/web-publisher/

# Install all dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/types/ packages/types/
COPY packages/compiler/ packages/compiler/
COPY packages/action-runtime/ packages/action-runtime/
COPY apps/api/ apps/api/
COPY infra/db/ infra/db/
COPY bobbins/ bobbins/
COPY tsconfig.base.json ./

# Build dependencies first, then API
RUN npx turbo build --filter=api

# Compile google-drive-backup actions (dynamically imported by API, not a turbo dependency)
RUN npx tsc -p bobbins/google-drive-backup/tsconfig.actions.json

# ---- Runtime stage ----
FROM node:22-slim AS runtime

WORKDIR /app

# Copy package files for module resolution
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY packages/compiler/package.json packages/compiler/
COPY packages/types/package.json packages/types/
COPY packages/action-runtime/package.json packages/action-runtime/

# Copy compiled output
COPY --from=builder /app/apps/api/dist/ apps/api/dist/
COPY --from=builder /app/packages/compiler/dist/ packages/compiler/dist/
COPY --from=builder /app/packages/types/dist/ packages/types/dist/
COPY --from=builder /app/packages/action-runtime/dist/ packages/action-runtime/dist/

# Copy migrations
COPY --from=builder /app/infra/db/migrations/ infra/db/migrations/

# Copy bobbin manifests (needed at runtime for compiler)
COPY --from=builder /app/bobbins/ bobbins/

# Copy node_modules (production deps)
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/apps/api/node_modules/ apps/api/node_modules/
COPY --from=builder /app/packages/compiler/node_modules/ packages/compiler/node_modules/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
