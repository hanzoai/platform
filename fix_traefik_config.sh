#!/bin/bash

echo "Fixing Traefik configuration..."

# 1. Fix the network name in traefik.yml
echo "1. Updating network name in traefik.yml..."
sudo sed -i 's/network: platform-network/network: hanzo-network/g' /etc/platform/traefik/traefik.yml

# 2. Fix the IP in platform.yml
echo "2. Getting platform container IP..."
PLATFORM_IP=$(docker inspect platform --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | head -n1)

if [ -z "$PLATFORM_IP" ]; then
    echo "Error: Could not get platform container IP"
    exit 1
fi

echo "Platform container IP: $PLATFORM_IP"

echo "3. Updating Traefik platform.yml with correct IP..."
sudo sed -i "s|http://[0-9.]*:3000|http://$PLATFORM_IP:3000|g" /etc/platform/traefik/dynamic/platform.yml

echo "4. Verifying changes..."
echo "Network configuration in traefik.yml:"
grep "network:" /etc/platform/traefik/traefik.yml

echo "Service URL in platform.yml:"
grep -A1 "servers:" /etc/platform/traefik/dynamic/platform.yml

echo "Done! Configuration updated."