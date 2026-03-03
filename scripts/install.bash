#!/bin/bash

install_platform() {
    if [ "$(id -u)" != "0" ]; then
        echo "This script must be run as root" >&2
        exit 1
    fi

    if [ "$(uname)" = "Darwin" ]; then
        echo "This script must be run on Linux" >&2
        exit 1
    fi

    if [ -f /.dockerenv ]; then
        echo "This script must be run on Linux" >&2
        exit 1
    fi

    command_exists() {
      command -v "$@" > /dev/null 2>&1
    }

    if command_exists docker; then
      echo "Docker already installed"
    else
      curl -sSL https://get.docker.com | sh
    fi

    if [ "${IS_CLOUD:-false}" = "true" ]; then
        SERVICE_NAME="cloud"
    else
        SERVICE_NAME="hanzo"
    fi

    docker service rm "$SERVICE_NAME"
    docker service create \
      --name "$SERVICE_NAME" \
      --replicas 1 \
      --network ${NETWORK_NAME:-hanzo-network} \
      --mount type=bind,source=${DOCKER_SOCK_PATH:-/var/run/docker.sock},target=/var/run/docker.sock \
      --mount type=bind,source=${HANZO_CONFIG_DIR:-/etc/hanzo},target=/etc/hanzo \
      --mount type=volume,source=${HANZO_DOCKER_VOLUME:-hanzo-docker-config},target=/root/.docker \
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

    format_ip_for_url() {
        local ip="$1"
        if echo "$ip" | grep -q ':'; then
            echo "[${ip}]"
        else
            echo "${ip}"
        fi
    }

    formatted_addr=$(format_ip_for_url "${ADVERTISE_ADDR:-localhost}")
    echo ""
    printf "${GREEN}Congratulations, Hanzo Platform is installed!${NC}\n"
    printf "${BLUE}Wait 15 seconds for the server to start${NC}\n"
    printf "${YELLOW}Please go to http://${formatted_addr}:${PORT:-3000}${NC}\n\n"
}

update_platform() {
    echo "Updating platform..."
    docker pull hanzoai/platform:${HANZO_IMAGE_TAG:-latest}
    docker service update --image hanzoai/platform:${HANZO_IMAGE_TAG:-latest} ${SERVICE_NAME:-hanzo}
    echo "Hanzo has been updated to the latest version."
}

if [ "$1" = "update" ]; then
    update_platform
else
    install_platform
fi
