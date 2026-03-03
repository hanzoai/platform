#!/bin/bash

echo "Applying Traefik configuration fixes..."

# Get the current platform container IP
PLATFORM_IP=$(docker inspect platform --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | head -n1)

if [ -z "$PLATFORM_IP" ]; then
    echo "Warning: Could not get platform container IP. Container might not be running."
    echo "Starting platform container..."
    docker start platform 2>/dev/null
    sleep 5
    PLATFORM_IP=$(docker inspect platform --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | head -n1)
fi

echo "Platform container IP: $PLATFORM_IP"

# Create temporary files with correct configurations
cat > /tmp/traefik.yml <<EOF
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

cat > /tmp/platform.yml <<EOF
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
          - url: "http://$PLATFORM_IP:3000"
EOF

echo "Backing up existing configurations..."
sudo cp /etc/platform/traefik/traefik.yml /etc/platform/traefik/traefik.yml.bak 2>/dev/null
sudo cp /etc/platform/traefik/dynamic/platform.yml /etc/platform/traefik/dynamic/platform.yml.bak 2>/dev/null

echo "Applying new configurations..."
sudo cp /tmp/traefik.yml /etc/platform/traefik/traefik.yml
sudo cp /tmp/platform.yml /etc/platform/traefik/dynamic/platform.yml

echo "Restarting Traefik..."
docker restart traefik

echo "Waiting for Traefik to restart..."
sleep 5

echo "Configuration applied successfully!"
echo ""
echo "Verification:"
echo "1. Platform container IP: $PLATFORM_IP"
echo "2. Traefik network configuration:"
grep "network:" /etc/platform/traefik/traefik.yml
echo "3. Platform service URL:"
grep -A1 "servers:" /etc/platform/traefik/dynamic/platform.yml
echo ""
echo "Testing platform.hanzo.ai..."
curl -k -I https://platform.hanzo.ai 2>&1 | head -10