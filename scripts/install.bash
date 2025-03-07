#!/bin/bash

install_platform() {
    if [ "$(uname)" != "Linux" ]; then
        echo "This script must be run on Linux" >&2
        exit 1
    fi
    if [ -f /.dockerenv ]; then
        echo "This script must be run on a non-containerized Linux host" >&2
        exit 1
    fi
    # For non-cloud mode, check for port conflicts.
    if [ "$IS_CLOUD" != "true" ] && command -v ss >/dev/null 2>&1; then
        if ss -tulnp | grep ':80 ' >/dev/null; then
            echo "Error: something is already running on port 80" >&2
            exit 1
        fi
        if ss -tulnp | grep ':443 ' >/dev/null; then
            echo "Error: something is already running on port 443" >&2
            exit 1
        fi
    fi

    FORCE=${FORCE:-false}

    # Set mode and network
    if [ "$IS_CLOUD" = "true" ]; then
        SERVICE_NAME="cloud"
        echo "Mode: CLOUD"
        advertise_addr="${ADVERTISE_ADDR:-localhost}"
        NETWORK_NAME="hanzo-network"
        if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
            echo "Creating network $NETWORK_NAME"
            docker network create --driver overlay --attachable "$NETWORK_NAME"
        fi
    else
        SERVICE_NAME="hanzo"
        echo "Mode: HANZO"
        docker swarm leave --force 2>/dev/null
        get_ip() {
            local ip
            ip=$(curl -4s --connect-timeout 5 https://ifconfig.io 2>/dev/null)
            [ -z "$ip" ] && ip=$(curl -4s --connect-timeout 5 https://icanhazip.com 2>/dev/null)
            [ -z "$ip" ] && ip=$(curl -4s --connect-timeout 5 https://ipecho.net/plain 2>/dev/null)
            if [ -n "$ip" ]; then
                if [[ $ip =~ ^192\.168\. || $ip =~ ^10\. || $ip =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]; then
                    echo "$ip"
                    return 0
                fi
            fi
            local ips
            ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -Ev '^127\.')
            if [ -n "$ips" ]; then
                local local_ip
                local_ip=$(echo "$ips" | grep '^192\.' | head -n 1)
                [ -n "$local_ip" ] && echo "$local_ip" && return 0
                local_ip=$(echo "$ips" | head -n 1)
                [ -n "$local_ip" ] && echo "$local_ip" && return 0
            fi
            echo "Error: Could not determine server IP address automatically." >&2
            echo "Please set ADVERTISE_ADDR manually." >&2
            exit 1
        }
        advertise_addr="${ADVERTISE_ADDR:-$(get_ip)}"
        echo "IP: $advertise_addr"
        docker swarm init --advertise-addr "$advertise_addr"
        if [ $? -ne 0 ]; then
            echo "Error: Swarm init failed" >&2
            exit 1
        fi
        NETWORK_NAME="$SERVICE_NAME-network"
        docker network rm -f "$NETWORK_NAME" 2>/dev/null
        docker network create --driver overlay --attachable "$NETWORK_NAME"
        echo "Network: $NETWORK_NAME"
    fi

    # Process DEV_MODE: set image tag and mount workspace if applicable.
    if [ "$DEV_MODE" = "true" ]; then
        echo "Dev mode enabled"
        HANZO_IMAGE_TAG="dev"
        NODE_ENV="${NODE_ENV:-development}"
        if [ -d "$(pwd)" ]; then
            echo "Mounting workspace: $(pwd) -> /workspace"
            MOUNT_FLAGS="--mount type=bind,source=$(pwd),target=/workspace"
        fi
    else
        MOUNT_FLAGS=""
    fi

    # Build list of allowed env variables to pass through.
    [ -z "$ADVERTISE_ADDR" ] && ADVERTISE_ADDR="$advertise_addr"
    allowed_vars="ADVERTISE_ADDR DATABASE_URL NODE_ENV IS_CLOUD NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SMTP_FROM_ADDRESS SMTP_SERVER SMTP_PORT SMTP_USERNAME SMTP_PASSWORD PORT"
    extra_env=""
    for var in $allowed_vars; do
        value="${!var}"
        if [ -n "$value" ]; then
            extra_env="$extra_env -e $var=$value"
        fi
    done

    if ! docker info >/dev/null 2>&1; then
        echo "Docker daemon not running. Starting docker..."
        if command -v systemctl >/dev/null 2>&1; then
            systemctl start docker
        elif command -v service >/dev/null 2>&1; then
            service docker start
        else
            echo "Error: Cannot start docker daemon." >&2
            exit 1
        fi
        sleep 3
        if ! docker info >/dev/null 2>&1; then
            echo "Error: Docker daemon is still not running." >&2
            exit 1
        fi
    fi

    # Check if service exists; update if it does.
    if docker service inspect "$SERVICE_NAME" >/dev/null 2>&1; then
        if [ "$FORCE" != "true" ]; then
            echo "Service $SERVICE_NAME exists. Updating..."
            docker pull hanzoai/platform:${HANZO_IMAGE_TAG:-latest}
            docker service update --image hanzoai/platform:${HANZO_IMAGE_TAG:-latest} "$SERVICE_NAME"
            exit 0
        fi
        echo "Removing existing service..."
        docker service rm "$SERVICE_NAME"
        sleep 5
    fi

    HANZO_DIR="${HANZO_DIR:-$HOME/hanzo}"
    mkdir -p "$HANZO_DIR"
    chmod 777 "$HANZO_DIR"
    APP_DIR="${APP_DIR:-/etc/$SERVICE_NAME}"
    mkdir -p "$APP_DIR"
    chmod 777 "$APP_DIR"

    if [ "$IS_CLOUD" = "true" ]; then
        docker pull hanzoai/platform:${HANZO_IMAGE_TAG:-latest}
    else
        echo "Pulling images..."
        docker pull postgres:16
        docker pull redis:7
        docker pull traefik:v3.1.2
        docker pull hanzoai/platform:${HANZO_IMAGE_TAG:-latest}
    fi

    DEFAULT_DB_URL="postgres://hanzo:amukds4wi9001583845717ad2@hanzo-postgres:5432/hanzo"
    DATABASE_URL="${DATABASE_URL:-$DEFAULT_DB_URL}"

    echo "Creating service: $SERVICE_NAME"
    docker service create \
      --name "$SERVICE_NAME" \
      --replicas 1 \
      --network "$NETWORK_NAME" \
      --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
      --mount type=bind,source="$HANZO_DIR",target=/etc/hanzo \
      --mount type=volume,source=hanzo-docker-config,target=/root/.docker \
      $MOUNT_FLAGS \
      --publish published=${PORT:-3000},target=3000,mode=host \
      --update-parallelism 1 \
      --update-order stop-first \
      --constraint 'node.role == manager' \
      $extra_env \
      hanzoai/platform:${HANZO_IMAGE_TAG:-latest}

    if echo "$advertise_addr" | grep -q ':'; then
        formatted_addr="[$advertise_addr]"
    else
        formatted_addr="$advertise_addr"
    fi

    echo ""
    echo -e "\033[0;32mSuccess! $([ "$IS_CLOUD" = "true" ] && echo "Hanzo Cloud" || echo "Hanzo Platform") installed.\033[0m"
    echo -e "\033[0;34mWait 15 seconds for startup...\033[0m"
    echo -e "\033[1;33mAccess at: http://${formatted_addr}:${PORT:-3000}\033[0m"
    echo ""
}

update_platform() {
    if [ "$IS_CLOUD" = "true" ]; then
        SERVICE_NAME="cloud"
    else
        SERVICE_NAME="hanzo"
    fi
    echo "Updating $SERVICE_NAME..."
    docker pull hanzoai/platform:${HANZO_IMAGE_TAG:-latest}
    docker service update --image hanzoai/platform:${HANZO_IMAGE_TAG:-latest} "$SERVICE_NAME"
    echo "Update complete."
}

if [ "$1" = "update" ]; then
    update_platform
else
    install_platform
fi

if [ "$1" = "help" ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: $0 [update]"
    echo ""
    echo "Options:"
    echo "  FORCE=true      Force recreation"
    echo "  IS_CLOUD=true   Cloud mode (only runs hanzoai/platform container)"
    echo "  DEV_MODE=true   Development mode (mounts current directory)"
    echo ""
    echo "Variables:"
    echo "  ADVERTISE_ADDR  Server IP"
    echo "  PORT            Service port (default: 3000)"
    echo "  DATABASE_URL    Database connection"
    echo "  HANZO_IMAGE_TAG Docker tag (default: latest)"
    exit 0
fi
