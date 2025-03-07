#!/bin/bash

install_platform() {
    # Check for root privileges
    if [ "$(id -u)" != "0" ]; then
        echo "This script must be run as root" >&2
        exit 1
    fi

    # Check for Linux OS
    if [ "$(uname)" = "Darwin" ]; then
        echo "This script must be run on Linux" >&2
        exit 1
    fi

    # Check for docker environment
    if [ -f /.dockerenv ]; then
        echo "This script must be run on Linux" >&2
        exit 1
    fi

    # Check for port conflicts
    if command -v ss >/dev/null 2>&1; then
        if ss -tulnp | grep ':80 ' >/dev/null; then
            echo "Error: something is already running on port 80" >&2
            exit 1
        fi
        if ss -tulnp | grep ':443 ' >/dev/null; then
            echo "Error: something is already running on port 443" >&2
            exit 1
        fi
    fi

    # Helper function to check if a command exists
    command_exists() {
        command -v "$@" >/dev/null 2>&1
    }

    # Install Docker if not already installed
    if command_exists docker; then
        echo "Docker already installed"
    else
        echo "Installing Docker..."
        curl -sSL https://get.docker.com | sh
    fi

    # Start Docker daemon if not running
    if ! docker info >/dev/null 2>&1; then
        echo "Docker daemon not running. Attempting to start docker service..."
        if command -v systemctl >/dev/null 2>&1; then
            systemctl start docker
        elif command -v service >/dev/null 2>&1; then
            service docker start
        else
            echo "Error: Cannot determine how to start docker daemon." >&2
            exit 1
        fi
        sleep 3
        if ! docker info >/dev/null 2>&1; then
            echo "Error: Docker daemon is still not running." >&2
            exit 1
        fi
    fi

    # Determine if we're in cloud mode
    IS_CLOUD=${IS_CLOUD:-false}
    SERVICE_NAME=$([ "$IS_CLOUD" = "true" ] && echo "cloud" || echo "hanzo")
    echo "Installation mode: $([ "$IS_CLOUD" = "true" ] && echo "CLOUD" || echo "HANZO")"
    echo "Service name: $SERVICE_NAME"

    # Check if service already exists and remove it if needed
    if docker service inspect "$SERVICE_NAME" >/dev/null 2>&1; then
        echo "Service $SERVICE_NAME already exists. Removing service..."
        docker service rm "$SERVICE_NAME"
        sleep 5 # Give the service time to be removed
    fi

    # For non-cloud mode, we need to reset the swarm
    if [ "$IS_CLOUD" != "true" ]; then
        # Leave any existing swarm
        docker swarm leave --force 2>/dev/null
    fi

    # Get the server IP
    get_ip() {
        local ip=""
        # Try external services first
        ip=$(curl -4s --connect-timeout 5 https://ifconfig.io 2>/dev/null)
        if [ -z "$ip" ]; then
            ip=$(curl -4s --connect-timeout 5 https://icanhazip.com 2>/dev/null)
        fi
        if [ -z "$ip" ]; then
            ip=$(curl -4s --connect-timeout 5 https://ipecho.net/plain 2>/dev/null)
        fi
        # Check if the external IP is in a private range (10.x.x.x, 172.16.x.x-172.31.x.x, 192.168.x.x)
        if [ -n "$ip" ]; then
            if [[ $ip =~ ^192\.168\. || $ip =~ ^10\. || $ip =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]; then
                echo "$ip"
                return 0
            fi
        fi

        # Fallback: get local IP addresses from hostname -I, excluding 127.0.0.1
        local ips
        ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -Ev '^127\.')
        if [ -n "$ips" ]; then
            # Prioritize addresses starting with 192.
            local local_ip
            local_ip=$(echo "$ips" | grep '^192\.' | head -n 1)
            if [ -n "$local_ip" ]; then
                echo "$local_ip"
                return 0
            fi
            # Otherwise return the first available IP.
            local_ip=$(echo "$ips" | head -n 1)
            if [ -n "$local_ip" ]; then
                echo "$local_ip"
                return 0
            fi
        fi

        echo "Error: Could not determine server IP address automatically." >&2
        echo "Please set the ADVERTISE_ADDR environment variable manually." >&2
        exit 1
    }

    # Set the advertise address
    advertise_addr="${ADVERTISE_ADDR:-$(get_ip)}"
    echo "Using advertise address: $advertise_addr"

    # Initialize Docker Swarm if not already active (needed for both modes)
    if ! docker info | grep -q 'Swarm: active'; then
        docker swarm init --advertise-addr "$advertise_addr"
        if [ $? -ne 0 ]; then
            echo "Error: Failed to initialize Docker Swarm" >&2
            exit 1
        fi
        echo "Swarm initialized"
    fi

    # Create or use network based on mode
    if [ "$IS_CLOUD" != "true" ]; then
        # For non-cloud mode, create a new network
        NETWORK_NAME="$SERVICE_NAME-network"
        docker network rm -f "$NETWORK_NAME" 2>/dev/null
        docker network create --driver overlay --attachable "$NETWORK_NAME"
        echo "Network '$NETWORK_NAME' created"
    else
        # In cloud mode, use existing hanzo network
        NETWORK_NAME="hanzo-network"
        # Ensure the network exists
        if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
            docker network create --driver overlay --attachable "$NETWORK_NAME"
        fi
        echo "Using network: $NETWORK_NAME"
    fi

    # Set up directory
    APP_DIR="${APP_DIR:-/etc/$SERVICE_NAME}"
    mkdir -p "$APP_DIR"
    chmod 777 "$APP_DIR"
    echo "Application directory: $APP_DIR"

    # Pull necessary images
    echo "Pulling required Docker images..."
    docker pull postgres:16
    docker pull redis:7
    docker pull traefik:v3.1.2
    docker pull hanzoai/platform:${HANZO_IMAGE_TAG:-latest}

    # Set default database URL if not provided
    if [ "$IS_CLOUD" != "true" ]; then
        DEFAULT_DB_URL="postgres://$SERVICE_NAME:amukds4wi9001583845717ad2@$SERVICE_NAME-postgres:5432/$SERVICE_NAME"
    else
        DEFAULT_DB_URL="postgres://hanzo:amukds4wi9001583845717ad2@hanzo-postgres:5432/hanzo"
    fi
    DATABASE_URL="${DATABASE_URL:-$DEFAULT_DB_URL}"

    # Create the service
    echo "Creating $SERVICE_NAME service..."

    # Determine docker config volume name based on mode
    if [ "$IS_CLOUD" = "true" ]; then
        DOCKER_CONFIG_VOLUME="hanzo-docker-config" # Always use hanzo-docker-config in cloud mode
    else
        DOCKER_CONFIG_VOLUME="$SERVICE_NAME-docker-config"
    fi

    # Optional mount for development
    MOUNT_FLAGS=""
    if [ "$MOUNT_DEV" = "true" ]; then
        # In development mode, we mount the source code directory to make live changes
        DEV_SRC_DIR="${DEV_SRC_DIR:-$(pwd)/app/hanzo}"
        echo "Mounting development source directory: $DEV_SRC_DIR -> /app"
        MOUNT_FLAGS="$MOUNT_FLAGS --mount type=bind,source=$DEV_SRC_DIR,target=/app"

        # When in development mode, also mount the node_modules to preserve the build
        DEV_NODE_MODULES="${DEV_NODE_MODULES:-$(pwd)/app/hanzo/node_modules}"
        if [ -d "$DEV_NODE_MODULES" ]; then
            echo "Mounting node_modules: $DEV_NODE_MODULES -> /app/node_modules"
            MOUNT_FLAGS="$MOUNT_FLAGS --mount type=bind,source=$DEV_NODE_MODULES,target=/app/node_modules"
        fi

        # Also mount the .next directory if it exists
        DEV_NEXT_DIR="${DEV_NEXT_DIR:-$(pwd)/app/hanzo/.next}"
        if [ -d "$DEV_NEXT_DIR" ]; then
            echo "Mounting .next directory: $DEV_NEXT_DIR -> /app/.next"
            MOUNT_FLAGS="$MOUNT_FLAGS --mount type=bind,source=$DEV_NEXT_DIR,target=/app/.next"
        fi
    fi

    # Create service with all environment variables
    docker service create \
      --name "$SERVICE_NAME" \
      --replicas 1 \
      --network "$NETWORK_NAME" \
      --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
      --mount type=bind,source="$APP_DIR",target=/etc/$SERVICE_NAME \
      --mount type=volume,source="$DOCKER_CONFIG_VOLUME",target=/root/.docker \
      $MOUNT_FLAGS \
      --publish published=${PORT:-3000},target=${PORT:-3000},mode=host \
      --update-parallelism 1 \
      --update-order stop-first \
      --constraint 'node.role == manager' \
      $( [ -n "$ADVERTISE_ADDR" ] && echo "-e ADVERTISE_ADDR=$ADVERTISE_ADDR" ) \
      $( [ -n "$DATABASE_URL" ] && echo "-e DATABASE_URL=$DATABASE_URL" ) \
      $( [ -n "$NODE_ENV" ] && echo "-e NODE_ENV=$NODE_ENV" ) \
      -e IS_CLOUD=${IS_CLOUD:-false} \
      $( [ -n "$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" ] && echo "-e NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" ) \
      $( [ -n "$STRIPE_SECRET_KEY" ] && echo "-e STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY" ) \
      $( [ -n "$STRIPE_WEBHOOK_SECRET" ] && echo "-e STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET" ) \
      $( [ -n "$GITHUB_CLIENT_ID" ] && echo "-e GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID" ) \
      $( [ -n "$GITHUB_CLIENT_SECRET" ] && echo "-e GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET" ) \
      $( [ -n "$GOOGLE_CLIENT_ID" ] && echo "-e GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" ) \
      $( [ -n "$GOOGLE_CLIENT_SECRET" ] && echo "-e GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" ) \
      $( [ -n "$SMTP_FROM_ADDRESS" ] && echo "-e SMTP_FROM_ADDRESS=$SMTP_FROM_ADDRESS" ) \
      $( [ -n "$SMTP_SERVER" ] && echo "-e SMTP_SERVER=$SMTP_SERVER" ) \
      $( [ -n "$SMTP_PORT" ] && echo "-e SMTP_PORT=$SMTP_PORT" ) \
      $( [ -n "$SMTP_USERNAME" ] && echo "-e SMTP_USERNAME=$SMTP_USERNAME" ) \
      $( [ -n "$SMTP_PASSWORD" ] && echo "-e SMTP_PASSWORD=$SMTP_PASSWORD" ) \
      -e PORT=${PORT:-3000} \
      hanzoai/platform:${HANZO_IMAGE_TAG:-latest}

    GREEN="\033[0;32m"
    YELLOW="\033[1;33m"
    BLUE="\033[0;34m"
    NC="\033[0m"

    # Format IP for URL display
    format_ip_for_url() {
        local ip="$1"
        if echo "$ip" | grep -q ':'; then
            echo "[${ip}]"
        else
            echo "${ip}"
        fi
    }

    # Display completion message
    formatted_addr=$(format_ip_for_url "$advertise_addr")
    echo ""
    printf "${GREEN}Congratulations, $([ "$IS_CLOUD" = "true" ] && echo "Cloud" || echo "Hanzo") Platform is installed!${NC}\n"
    printf "${BLUE}Wait 15 seconds for the server to start${NC}\n"
    printf "${YELLOW}Please go to http://${formatted_addr}:${PORT:-3000}${NC}\n\n"
}

update_platform() {
    # Determine if we're in cloud mode for update
    IS_CLOUD=${IS_CLOUD:-false}
    SERVICE_NAME=$([ "$IS_CLOUD" = "true" ] && echo "cloud" || echo "hanzo")

    echo "Updating $([ "$IS_CLOUD" = "true" ] && echo "Cloud" || echo "Hanzo") platform..."
    docker pull hanzoai/platform:${HANZO_IMAGE_TAG:-latest}
    docker service update --image hanzoai/platform:${HANZO_IMAGE_TAG:-latest} "$SERVICE_NAME"
    echo "$([ "$IS_CLOUD" = "true" ] && echo "Cloud" || echo "Hanzo") has been updated to the latest version."
}

# Main script execution
if [ "$1" = "update" ]; then
    update_platform
else
    install_platform
fi

# Usage information (hidden, only shown with help flag)
if [ "$1" = "help" ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: $0 [update]"
    echo ""
    echo "Environment variables:"
    echo "  IS_CLOUD                Set to 'true' for cloud mode (default: false)"
    echo "  ADVERTISE_ADDR          IP address to advertise (default: auto-detected)"
    echo "  PORT                    Port to expose service on (default: 3000)"
    echo "  DATABASE_URL            Custom database URL"
    echo "  NODE_ENV                Node environment (default: production)"
    echo "  HANZO_IMAGE_TAG         Docker image tag to use (default: latest)"
    echo "  APP_DIR                 Application directory (default: /etc/hanzo or /etc/cloud)"
    echo ""
    echo "Development options:"
    echo "  MOUNT_DEV               Set to 'true' to enable development mode with live code changes"
    echo "  DEV_SRC_DIR             Source directory to mount (default: ./app/hanzo)"
    echo "  DEV_NODE_MODULES        Node modules directory (default: ./app/hanzo/node_modules)"
    echo "  DEV_NEXT_DIR            Next.js build directory (default: ./app/hanzo/.next)"
    echo ""
    echo "Authentication variables:"
    echo "  GITHUB_CLIENT_ID        GitHub OAuth client ID"
    echo "  GITHUB_CLIENT_SECRET    GitHub OAuth client secret"
    echo "  GOOGLE_CLIENT_ID        Google OAuth client ID"
    echo "  GOOGLE_CLIENT_SECRET    Google OAuth client secret"
    echo ""
    echo "Payment variables:"
    echo "  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY    Stripe public key"
    echo "  STRIPE_SECRET_KEY                     Stripe secret key"
    echo "  STRIPE_WEBHOOK_SECRET                 Stripe webhook secret"
    echo ""
    echo "Email variables:"
    echo "  SMTP_FROM_ADDRESS       Email sender address"
    echo "  SMTP_SERVER             SMTP server hostname"
    echo "  SMTP_PORT               SMTP server port"
    echo "  SMTP_USERNAME           SMTP authentication username"
    echo "  SMTP_PASSWORD           SMTP authentication password"
    exit 0
fi
