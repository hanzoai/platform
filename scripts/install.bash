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

    if ss -tulnp | grep ':80 ' >/dev/null; then
        echo "Error: something is already running on port 80" >&2
        exit 1
    fi

    if ss -tulnp | grep ':443 ' >/dev/null; then
        echo "Error: something is already running on port 443" >&2
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

    docker swarm leave --force 2>/dev/null

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
        ips=$(hostname -I | tr ' ' '\n' | grep -Ev '^127\.')
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

    advertise_addr="${ADVERTISE_ADDR:-$(get_ip)}"
    echo "Using advertise address: $advertise_addr"

    docker swarm init --advertise-addr $advertise_addr

    if [ $? -ne 0 ]; then
        echo "Error: Failed to initialize Docker Swarm" >&2
        exit 1
    fi

    echo "Swarm initialized"

    docker network rm -f hanzo-network 2>/dev/null
    docker network create --driver overlay --attachable hanzo-network

    echo "Network created"

    mkdir -p /etc/platform
    chmod 777 /etc/platform

    docker pull postgres:16
    docker pull redis:7
    docker pull traefik:v3.1.2
    docker pull hanzoai/platform:latest

    docker service create \
      --name platform \
      --replicas 1 \
      --network hanzo-network \
      --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
      --mount type=bind,source=/etc/platform,target=/etc/platform \
      --mount type=volume,source=platform-docker-config,target=/root/.docker \
      --publish published=3000,target=3000,mode=host \
      --update-parallelism 1 \
      --update-order stop-first \
      --constraint 'node.role == manager' \
      -e ADVERTISE_ADDR=$advertise_addr \
      -e DATABASE_URL="postgres://hanzo:amukds4wi9001583845717ad2@hanzo-postgres:5432/hanzo" \
      -e NODE_ENV=production \
      -e IS_CLOUD=false \
      -e PORT=3000 \
      hanzoai/platform:latest

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

    formatted_addr=$(format_ip_for_url "$advertise_addr")
    echo ""
    printf "${GREEN}Congratulations, Hanzo Platform is installed!${NC}\n"
    printf "${BLUE}Wait 15 seconds for the server to start${NC}\n"
    printf "${YELLOW}Please go to http://${formatted_addr}:3000${NC}\n\n"
}

update_platform() {
    echo "Updating platform..."
    docker pull hanzoai/platform:latest
    docker service update --image hanzoai/platform:latest platform
    echo "platform has been updated to the latest version."
}

if [ "$1" = "update" ]; then
    update_platform
else
    install_platform
fi
