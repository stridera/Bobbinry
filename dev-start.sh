#!/bin/bash

# Bobbins Development Environment Start Script
# Runs pre-flight checks, starts infrastructure, then hands off to turbo dev

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
DB_CONTAINER_NAME="bobbins-postgres-1"
MINIO_CONTAINER_NAME="bobbins-minio-1"

# Function to check Docker
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi

    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi

    log_success "Docker is running"
}

# Function to check Node.js and bun
check_dependencies() {
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js is not installed"
        exit 1
    fi

    if ! command -v bun >/dev/null 2>&1; then
        log_error "bun is not installed. Install it with: curl -fsSL https://bun.sh/install | bash"
        exit 1
    fi

    log_success "Node.js $(node --version) and bun $(bun --version) are available"
}

# Function to start database containers
start_database() {
    log_info "Starting database containers..."

    cd "$PROJECT_ROOT"

    # Check if containers are already running
    if docker ps --format "table {{.Names}}" | grep -q "$DB_CONTAINER_NAME"; then
        log_info "Database container is already running"
    else
        docker compose up -d postgres
        sleep 5  # Wait for containers to initialize
    fi

    if docker ps --format "table {{.Names}}" | grep -q "$MINIO_CONTAINER_NAME"; then
        log_info "MinIO container is already running"
    else
        docker compose up -d minio
        sleep 3
    fi

    # Wait for database to be ready
    log_info "Waiting for PostgreSQL to be ready..."
    local attempt=1
    while [ $attempt -le 15 ]; do
        if docker exec "$DB_CONTAINER_NAME" pg_isready -U bobbinry >/dev/null 2>&1; then
            log_success "PostgreSQL is ready!"
            break
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    if [ $attempt -gt 15 ]; then
        log_error "PostgreSQL failed to start"
        exit 1
    fi

    log_success "Database containers are running"
}

# Function to ensure .env symlinks exist for Next.js / app-level env loading
ensure_env_symlinks() {
    for app_dir in "$PROJECT_ROOT/apps/shell" "$PROJECT_ROOT/apps/api"; do
        if [ ! -e "$app_dir/.env" ] && [ -f "$PROJECT_ROOT/.env" ]; then
            ln -s ../../.env "$app_dir/.env"
            log_info "Created .env symlink in $(basename "$app_dir")"
        fi
    done
}

# Main execution
main() {
    log_info "Starting Bobbins development environment..."

    # Pre-flight checks
    check_docker
    check_dependencies
    ensure_env_symlinks

    # Start infrastructure
    start_database

    # Install dependencies if node_modules is missing
    cd "$PROJECT_ROOT"
    if [ ! -d "node_modules" ]; then
        log_info "Installing dependencies..."
        bun install
    fi

    echo
    log_success "Infrastructure ready. Starting turbo dev..."
    echo
    echo "Services (once ready):"
    echo "  Shell Application: http://localhost:3100"
    echo "  API Server:        http://localhost:4100"
    echo "  PostgreSQL:        localhost:5432 (docker)"
    echo "  MinIO:             http://localhost:9001 (docker)"
    echo
    echo "To stop: Ctrl+C (or ./dev-stop.sh for orphan cleanup)"
    echo

    # Hand off to turbo dev - exec replaces this process so Ctrl+C
    # cleanly kills turbo and all its child processes
    exec bun run dev
}

# Run main function
main "$@"
