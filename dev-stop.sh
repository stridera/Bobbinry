#!/bin/bash

# Bobbins Development Environment Stop Script
# This script cleanly stops all development services

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

# Function to kill process by PID file
kill_service() {
    local pid_file=$1
    local service_name=$2
    local timeout=${3:-10}

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log_info "Stopping $service_name (PID: $pid)..."

            # Try graceful shutdown first
            kill -TERM "$pid" 2>/dev/null || true

            # Wait for graceful shutdown
            local count=0
            while kill -0 "$pid" 2>/dev/null && [ $count -lt $timeout ]; do
                sleep 1
                count=$((count + 1))
            done

            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                log_warning "$service_name didn't stop gracefully, force killing..."
                kill -KILL "$pid" 2>/dev/null || true
                sleep 1
            fi

            if ! kill -0 "$pid" 2>/dev/null; then
                log_success "$service_name stopped successfully"
            else
                log_error "Failed to stop $service_name"
            fi
        else
            log_info "$service_name was not running"
        fi
        rm -f "$pid_file"
    else
        log_info "No PID file found for $service_name"
    fi
}

# Function to kill processes by port
kill_by_port() {
    local port=$1
    local service_name=$2

    local pids=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
        log_info "Killing processes on port $port ($service_name)..."
        echo "$pids" | xargs -r kill -TERM
        sleep 2

        # Force kill if still running
        pids=$(lsof -ti :$port 2>/dev/null || true)
        if [ -n "$pids" ]; then
            log_warning "Force killing remaining processes on port $port..."
            echo "$pids" | xargs -r kill -KILL
        fi

        log_success "Stopped processes on port $port"
    else
        log_info "No processes running on port $port"
    fi
}

# Function to stop Node.js applications
stop_node_apps() {
    log_info "Stopping Node.js applications..."

    # Stop via PID files first
    kill_service "$SHELL_PID_FILE" "Shell application" 15
    kill_service "$API_PID_FILE" "API server" 10

    # Fallback: kill by port
    kill_by_port $SHELL_PORT "Shell application"
    kill_by_port $API_PORT "API server"

    # Kill any remaining Node.js processes that might be related
    local node_pids=$(pgrep -f "next dev\|node.*dist/index\.js" 2>/dev/null || true)
    if [ -n "$node_pids" ]; then
        log_info "Stopping remaining Node.js processes..."
        echo "$node_pids" | xargs -r kill -TERM
        sleep 2

        # Force kill if needed
        node_pids=$(pgrep -f "next dev\|node.*dist/index\.js" 2>/dev/null || true)
        if [ -n "$node_pids" ]; then
            log_warning "Force killing remaining Node.js processes..."
            echo "$node_pids" | xargs -r kill -KILL
        fi
    fi
}

# Function to stop Docker containers
stop_docker_containers() {
    local stop_containers=${1:-false}

    if [ "$stop_containers" = true ]; then
        log_info "Stopping Docker containers..."

        cd "$PROJECT_ROOT"

        # Stop containers if they're running
        if docker ps --format "table {{.Names}}" | grep -q "$DB_CONTAINER_NAME"; then
            log_info "Stopping PostgreSQL container..."
            docker stop "$DB_CONTAINER_NAME" >/dev/null 2>&1 || true
        fi

        if docker ps --format "table {{.Names}}" | grep -q "$MINIO_CONTAINER_NAME"; then
            log_info "Stopping MinIO container..."
            docker stop "$MINIO_CONTAINER_NAME" >/dev/null 2>&1 || true
        fi

        # Alternative: stop all via docker-compose
        docker compose down >/dev/null 2>&1 || true

        log_success "Docker containers stopped"
    else
        log_info "Docker containers left running (use --containers to stop them)"
    fi
}

# Function to clean up PID directory and logs
cleanup_files() {
    if [ -d "$PID_DIR" ]; then
        log_info "Cleaning up PID files and logs..."
        rm -rf "$PID_DIR"
        log_success "Cleanup completed"
    fi
}

# Function to show current status
show_status() {
    echo
    log_info "Current service status:"

    # Check Node.js apps
    if lsof -i :$SHELL_PORT >/dev/null 2>&1; then
        echo "  🟢 Shell (port $SHELL_PORT): RUNNING"
    else
        echo "  🔴 Shell (port $SHELL_PORT): STOPPED"
    fi

    if lsof -i :$API_PORT >/dev/null 2>&1; then
        echo "  🟢 API (port $API_PORT): RUNNING"
    else
        echo "  🔴 API (port $API_PORT): STOPPED"
    fi

    # Check Docker containers
    if docker ps --format "table {{.Names}}" | grep -q "$DB_CONTAINER_NAME"; then
        echo "  🟢 PostgreSQL: RUNNING"
    else
        echo "  🔴 PostgreSQL: STOPPED"
    fi

    if docker ps --format "table {{.Names}}" | grep -q "$MINIO_CONTAINER_NAME"; then
        echo "  🟢 MinIO: RUNNING"
    else
        echo "  🔴 MinIO: STOPPED"
    fi

    echo
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --containers    Also stop Docker containers (PostgreSQL, MinIO)"
    echo "  --status        Show current service status"
    echo "  --force         Force kill all processes (no graceful shutdown)"
    echo "  --help          Show this help message"
    echo
    echo "Examples:"
    echo "  $0                     # Stop Node.js apps only"
    echo "  $0 --containers        # Stop Node.js apps and Docker containers"
    echo "  $0 --status            # Show current status"
    echo
}

# Main execution
main() {
    local stop_containers=false
    local show_status_only=false
    local force_kill=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --containers)
                stop_containers=true
                shift
                ;;
            --status)
                show_status_only=true
                shift
                ;;
            --force)
                force_kill=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    if [ "$show_status_only" = true ]; then
        show_status
        exit 0
    fi

    log_info "Stopping Bobbins development environment..."

    # Stop services
    stop_node_apps
    stop_docker_containers $stop_containers
    cleanup_files

    # Show final status
    show_status

    log_success "🛑 Bobbins development environment stopped"

    if [ "$stop_containers" = false ]; then
        log_info "To also stop Docker containers, run: $0 --containers"
    fi
}

# Handle script being called directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi