#!/bin/bash

# Bobbins Development Environment Start Script
# This script starts all required services for development

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
API_PORT=4000
SHELL_PORT=3000
DB_CONTAINER_NAME="bobbins-postgres-1"
MINIO_CONTAINER_NAME="bobbins-minio-1"
PID_DIR="$PROJECT_ROOT/.dev-pids"
API_PID_FILE="$PID_DIR/api.pid"
SHELL_PID_FILE="$PID_DIR/shell.pid"

# Create PID directory
mkdir -p "$PID_DIR"

# Cleanup function for graceful shutdown
cleanup() {
    log_info "Cleaning up processes..."
    if [ -f "$API_PID_FILE" ]; then
        API_PID=$(cat "$API_PID_FILE")
        if kill -0 "$API_PID" 2>/dev/null; then
            log_info "Stopping API server (PID: $API_PID)"
            kill "$API_PID" || true
        fi
        rm -f "$API_PID_FILE"
    fi

    if [ -f "$SHELL_PID_FILE" ]; then
        SHELL_PID=$(cat "$SHELL_PID_FILE")
        if kill -0 "$SHELL_PID" 2>/dev/null; then
            log_info "Stopping Shell server (PID: $SHELL_PID)"
            kill "$SHELL_PID" || true
        fi
        rm -f "$SHELL_PID_FILE"
    fi
}

# Set trap for cleanup on script exit
trap cleanup EXIT INT TERM

# Function to wait for service to be ready
wait_for_service() {
    local url=$1
    local service_name=$2
    local max_attempts=30
    local attempt=1

    log_info "Waiting for $service_name to be ready at $url..."

    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            log_success "$service_name is ready!"
            return 0
        fi

        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    log_error "$service_name failed to start within $(($max_attempts * 2)) seconds"
    return 1
}

# Function to check if port is in use
check_port() {
    local port=$1
    local service_name=$2

    if lsof -i :$port >/dev/null 2>&1; then
        log_warning "Port $port is already in use by another process"
        local pid=$(lsof -ti :$port)
        log_warning "Process using port $port: $(ps -p $pid -o comm= 2>/dev/null || echo 'unknown')"
        read -p "Kill the process and continue? [y/N]: " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kill -9 $pid 2>/dev/null || true
            sleep 2
        else
            log_error "Cannot start $service_name on port $port"
            exit 1
        fi
    fi
}

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

# Function to check Node.js and pnpm
check_dependencies() {
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js is not installed"
        exit 1
    fi

    if ! command -v pnpm >/dev/null 2>&1; then
        log_error "pnpm is not installed. Install it with: npm install -g pnpm"
        exit 1
    fi

    log_success "Node.js $(node --version) and pnpm $(pnpm --version) are available"
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

# Function to build packages
build_packages() {
    log_info "Building required packages..."

    cd "$PROJECT_ROOT"

    # Install dependencies if node_modules is missing
    if [ ! -d "node_modules" ]; then
        log_info "Installing dependencies..."
        pnpm install
    fi

    # Build packages in correct order
    log_info "Building types package..."
    pnpm --filter=@bobbinry/types build || {
        log_error "Failed to build types package"
        exit 1
    }

    log_info "Building compiler package..."
    pnpm --filter=@bobbinry/compiler build || {
        log_error "Failed to build compiler package"
        exit 1
    }

    log_info "Building SDK package..."
    pnpm --filter=@bobbinry/sdk build || {
        log_error "Failed to build SDK package"
        exit 1
    }

    # Skip building API in dev mode - it uses tsx which doesn't need compilation
    log_info "Skipping API build (using tsx in dev mode)"

    log_success "All packages built successfully"
}

# Function to start API server
start_api() {
    log_info "Starting API server..."

    check_port $API_PORT "API server"

    cd "$PROJECT_ROOT"

    # Start API server in background using dev command (tsx watch)
    # Note: Migrations run automatically on startup
    # If you encounter migration issues, run: pnpm --filter=api db:reset
    NODE_ENV=development pnpm --filter=api dev > "$PID_DIR/api.log" 2>&1 &
    local api_pid=$!
    echo $api_pid > "$API_PID_FILE"

    log_info "API server starting (PID: $api_pid)..."

    # Wait for API to be ready
    wait_for_service "http://localhost:$API_PORT/health" "API server" || {
        log_error "API server failed to start. Check logs at $PID_DIR/api.log"
        log_error "If migration errors occurred, try: pnpm --filter=api db:reset"
        exit 1
    }

    log_success "API server is running at http://localhost:$API_PORT"
}

# Function to start shell
start_shell() {
    log_info "Starting Shell application..."

    check_port $SHELL_PORT "Shell application"

    cd "$PROJECT_ROOT"

    # Start shell in background
    NODE_ENV=development pnpm --filter=shell dev > "$PID_DIR/shell.log" 2>&1 &
    local shell_pid=$!
    echo $shell_pid > "$SHELL_PID_FILE"

    log_info "Shell application starting (PID: $shell_pid)..."

    # Wait for shell to be ready (Next.js takes longer)
    sleep 5
    wait_for_service "http://localhost:$SHELL_PORT" "Shell application" || {
        log_error "Shell application failed to start. Check logs at $PID_DIR/shell.log"
        exit 1
    }

    log_success "Shell application is running at http://localhost:$SHELL_PORT"
}

# Function to show status
show_status() {
    echo
    log_success "🚀 Bobbins Development Environment is ready!"
    echo
    echo "Services:"
    echo "  📊 Shell Application: http://localhost:$SHELL_PORT"
    echo "  🔧 API Server:        http://localhost:$API_PORT"
    echo "  🗄️  PostgreSQL:        localhost:5432 (docker)"
    echo "  📦 MinIO:             http://localhost:9001 (docker)"
    echo
    echo "Logs:"
    echo "  API:   tail -f $PID_DIR/api.log"
    echo "  Shell: tail -f $PID_DIR/shell.log"
    echo
    echo "To stop all services: ./dev-stop.sh"
    echo
}

# Main execution
main() {
    log_info "Starting Bobbins development environment..."

    # Pre-flight checks
    check_docker
    check_dependencies

    # Start services in order
    start_database
    build_packages
    start_api
    start_shell

    # Show status
    show_status

    # Keep script running to maintain trap
    if [ "$1" != "--detached" ]; then
        log_info "Press Ctrl+C to stop all services"
        # Wait for interrupt
        while true; do
            sleep 1
        done
    fi
}

# Run main function
main "$@"