#!/bin/bash

echo "=== EMERGENCY FIX FOR PLATFORM.HANZO.AI ==="
echo ""

# Step 1: Get platform container IP
echo "Step 1: Getting platform container IP..."
PLATFORM_IP=$(docker inspect platform --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | head -n1)
echo "Platform IP: $PLATFORM_IP"

if [ -z "$PLATFORM_IP" ]; then
    echo "ERROR: Platform container is not running or has no IP!"
    echo "Starting platform container..."
    docker start platform
    sleep 5
    PLATFORM_IP=$(docker inspect platform --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | head -n1)
    echo "New Platform IP: $PLATFORM_IP"
fi

# Step 2: Test direct connection to platform
echo ""
echo "Step 2: Testing direct connection to platform container..."
curl -I http://$PLATFORM_IP:3000 2>&1 | head -5

# Step 3: Check current Traefik configurations
echo ""
echo "Step 3: Current Traefik configurations..."
echo "Network in traefik.yml:"
grep "network:" /etc/platform/traefik/traefik.yml
echo "Service URL in platform.yml:"
grep -A1 "servers:" /etc/platform/traefik/dynamic/platform.yml

# Step 4: Create corrected configuration files
echo ""
echo "Step 4: Creating corrected configuration files..."

cat > /tmp/platform_fixed.yml <<EOF
http:
  routers:
    platform:
      rule: "Host(\`platform.hanzo.ai\`)"
      service: platform-service
      tls:
        certResolver: letsencrypt
      entryPoints:
        - websecure
    platform-http:
      rule: "Host(\`platform.hanzo.ai\`)"
      service: platform-service
      entryPoints:
        - web
      middlewares:
        - redirect-to-https

  middlewares:
    redirect-to-https:
      redirectScheme:
        scheme: https
        permanent: true

  services:
    platform-service:
      loadBalancer:
        servers:
          - url: "http://${PLATFORM_IP}:3000"
EOF

cat > /tmp/traefik_fixed.yml <<EOF
global:
  sendAnonymousUsage: false
providers:
  swarm:
    exposedByDefault: false
    watch: true
  docker:
    exposedByDefault: false
    watch: true
    network: hanzo-network
  file:
    directory: /etc/platform/traefik/dynamic
    watch: true
entryPoints:
  web:
    address: :80
  websecure:
    address: :443
    http3:
      advertisedPort: 443
    http:
      tls:
        certResolver: letsencrypt
api:
  insecure: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: test@localhost.com
      storage: /etc/platform/traefik/dynamic/acme.json
      httpChallenge:
        entryPoint: web
EOF

echo "Fixed configuration files created in /tmp/"

# Step 5: Instructions for manual application
echo ""
echo "Step 5: MANUAL STEPS REQUIRED:"
echo "==============================="
echo "Run these commands with sudo:"
echo ""
echo "sudo cp /tmp/platform_fixed.yml /etc/platform/traefik/dynamic/platform.yml"
echo "sudo cp /tmp/traefik_fixed.yml /etc/platform/traefik/traefik.yml"
echo "docker restart traefik"
echo ""
echo "Or run this one-liner:"
echo "sudo cp /tmp/platform_fixed.yml /etc/platform/traefik/dynamic/platform.yml && sudo cp /tmp/traefik_fixed.yml /etc/platform/traefik/traefik.yml && docker restart traefik"
echo ""
echo "==============================="

# Step 6: Show what needs to be fixed
echo ""
echo "Step 6: Summary of issues:"
echo "- Platform IP in Traefik config should be: $PLATFORM_IP"
echo "- Network name should be: hanzo-network (not platform-network)"
echo "- These configurations are stored in:"
echo "  - /etc/platform/traefik/traefik.yml"
echo "  - /etc/platform/traefik/dynamic/platform.yml"