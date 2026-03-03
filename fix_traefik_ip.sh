#!/bin/bash

# Get the current platform container IP
PLATFORM_IP=$(docker inspect platform --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | head -n1)

if [ -z "$PLATFORM_IP" ]; then
    echo "Error: Could not get platform container IP"
    exit 1
fi

echo "Platform container IP: $PLATFORM_IP"

# Update the Traefik configuration
sudo sed -i "s|http://[0-9.]*:3000|http://$PLATFORM_IP:3000|g" /etc/platform/traefik/dynamic/platform.yml

echo "Updated Traefik configuration with IP: $PLATFORM_IP"

# Verify the change
echo "Current configuration:"
grep -A1 "servers:" /etc/platform/traefik/dynamic/platform.yml