#!/bin/bash

# Bobbins Development Environment Stop Script
# Kills orphaned dev processes by port and optionally stops Docker containers

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
API_PORT=4100
SHELL_PORT=3100
MINIO_CONTAINER_NAME="bobbins-minio-1"

# Function to kill processes by port using fuser
kill_by_port() {
    local port=$1
    local service_name=$2

    if fuser ${port}/tcp >/dev/null 2>&1; then
        log_info "Killing processes on port $port ($service_name)..."
        fuser -k ${port}/tcp >/dev/null 2>&1 || true
        sleep 1

        # Verify
        if fuser ${port}/tcp >/dev/null 2>&1; then
            log_warning "Force killing remaining processes on port $port..."
            fuser -k -KILL ${port}/tcp >/dev/null 2>&1 || true
        fi

        log_success "Stopped processes on port $port"
    else
        log_info "No processes running on port $port"
    fi
}

# Function to stop Node.js applications
stop_node_apps() {
    log_info "Stopping Node.js applications..."

    kill_by_port $SHELL_PORT "Shell application"
    kill_by_port $API_PORT "API server"
}

# Function to stop Docker containers
stop_docker_containers() {
    local stop_containers=${1:-false}

    if [ "$stop_containers" = true ]; then
        log_info "Stopping Docker containers..."

        cd "$PROJECT_ROOT"

        # Stop MinIO container if running
        if docker ps --format "table {{.Names}}" | grep -q "$MINIO_CONTAINER_NAME"; then
            log_info "Stopping MinIO container..."
            docker stop "$MINIO_CONTAINER_NAME" >/dev/null 2>&1 || true
        fi

        docker compose down >/dev/null 2>&1 || true

        log_success "Docker containers stopped"
    else
        log_info "Docker containers left running (use --containers to stop them)"
    fi
}

# Function to show current status
show_status() {
    echo
    log_info "Current service status:"

    # Check Node.js apps
    if fuser ${SHELL_PORT}/tcp >/dev/null 2>&1; then
        echo "  Shell (port $SHELL_PORT): RUNNING"
    else
        echo "  Shell (port $SHELL_PORT): STOPPED"
    fi

    if fuser ${API_PORT}/tcp >/dev/null 2>&1; then
        echo "  API (port $API_PORT): RUNNING"
    else
        echo "  API (port $API_PORT): STOPPED"
    fi

    # Check PostgreSQL (native)
    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
        echo "  PostgreSQL: RUNNING (native)"
    else
        echo "  PostgreSQL: STOPPED"
    fi

    # Check Docker containers
    if docker ps --format "table {{.Names}}" 2>/dev/null | grep -q "$MINIO_CONTAINER_NAME"; then
        echo "  MinIO: RUNNING (docker)"
    else
        echo "  MinIO: STOPPED"
    fi

    echo
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --containers    Also stop Docker containers (MinIO)"
    echo "  --status        Show current service status"
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

    # Show final status
    show_status

    log_success "Bobbins development environment stopped"

    if [ "$stop_containers" = false ]; then
        log_info "To also stop Docker containers, run: $0 --containers"
    fi
}

# Handle script being called directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
