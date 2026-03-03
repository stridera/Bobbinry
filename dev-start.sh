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
MINIO_CONTAINER_NAME="bobbins-minio-1"
SHELL_PORT=3100
API_PORT=4100

# Function to check Docker (only needed for MinIO)
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_warning "Docker is not installed - MinIO will not be available"
        return 1
    fi

    if ! docker info >/dev/null 2>&1; then
        log_warning "Docker is not running - MinIO will not be available"
        return 1
    fi

    log_success "Docker is running"
    return 0
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

# Function to check local PostgreSQL
check_postgres() {
    log_info "Checking PostgreSQL..."

    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
        log_success "PostgreSQL is ready!"
    else
        log_error "PostgreSQL is not running. Start it with: sudo systemctl start postgresql"
        exit 1
    fi
}

# Function to start MinIO (still Docker-based)
start_minio() {
    cd "$PROJECT_ROOT"

    if docker ps --format "table {{.Names}}" | grep -q "$MINIO_CONTAINER_NAME"; then
        log_info "MinIO container is already running"
    else
        docker compose up -d minio
        sleep 3
    fi

    log_success "MinIO is running"
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
    check_dependencies
    check_postgres
    ensure_env_symlinks

    # Start MinIO if Docker is available
    if check_docker; then
        start_minio
    fi

    # Install dependencies if node_modules is missing
    cd "$PROJECT_ROOT"
    if [ ! -d "node_modules" ]; then
        log_info "Installing dependencies..."
        bun install
    fi

    # Kill orphaned dev processes from a previous run
    for port in $SHELL_PORT $API_PORT; do
        if fuser ${port}/tcp >/dev/null 2>&1; then
            log_warning "Port $port still in use, killing orphaned process..."
            fuser -k ${port}/tcp >/dev/null 2>&1 || true
            sleep 1
        fi
    done

    # Clean stale .next directories to prevent routes-manifest.json ENOENT on restart
    for next_dir in "$PROJECT_ROOT"/apps/*/.next; do
        if [ -d "$next_dir" ]; then
            log_info "Cleaning stale $(basename "$(dirname "$next_dir")")/.next directory..."
            rm -rf "$next_dir"
        fi
    done

    echo
    log_success "Infrastructure ready. Starting turbo dev..."
    echo
    echo "Services (once ready):"
    echo "  Shell Application: http://bobbins.dev.local  (localhost:3100)"
    echo "  API Server:        http://bobbins-api.dev.local  (localhost:4100)"
    echo "  PostgreSQL:        localhost:5432 (local)"
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
