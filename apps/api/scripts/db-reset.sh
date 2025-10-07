#!/bin/bash

# Database reset script for development
# WARNING: This will destroy all data in the database!
#
# Usage:
#   ./scripts/db-reset.sh          # Reset database only
#   ./scripts/db-reset.sh --seed   # Reset and seed with test data

set -e

SEED=false
if [ "$1" = "--seed" ]; then
  SEED=true
fi

echo "🗑️  Dropping and recreating database schema..."
docker exec bobbins-postgres-1 psql -U bobbinry -d bobbinry -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO bobbinry; GRANT ALL ON SCHEMA public TO public;"

echo "🧹 Cleaning old migration files..."
rm -rf ../../infra/db/migrations/*.sql
rm -rf ../../infra/db/migrations/meta/*.json

echo "📝 Creating empty migration journal..."
mkdir -p ../../infra/db/migrations/meta
echo '{"version":"7","dialect":"postgresql","entries":[]}' > ../../infra/db/migrations/meta/_journal.json

echo "🔨 Generating fresh migrations..."
pnpm db:generate

if [ "$SEED" = true ]; then
  echo "🌱 Seeding database with test data..."
  # Apply migrations first by running a temporary server startup
  echo "   Applying migrations..."
  pnpm db:migrate

  # Then seed
  pnpm db:seed
fi

echo "✅ Database reset complete!"
if [ "$SEED" = true ]; then
  echo "   Test users have been created (see output above)"
  echo "   Run 'pnpm dev' to start the server"
else
  echo "   Run 'pnpm dev' to apply migrations and start the server"
  echo "   Or run 'pnpm db:seed' to add test users after starting"
fi
