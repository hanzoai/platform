#!/bin/bash

echo "Applying final Traefik configuration fixes..."

# Create the corrected configuration files
cat > /tmp/platform.yml <<'EOF'
http:
  routers:
    platform:
      rule: "Host(`platform.hanzo.ai`)"
      service: platform-service
      tls:
        certResolver: letsencrypt
      entryPoints:
        - websecure
    platform-http:
      rule: "Host(`platform.hanzo.ai`)"
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
          - url: "http://10.0.1.228:3000"
EOF

cat > /tmp/traefik.yml <<'EOF'
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

echo "Configuration files created in /tmp/"
echo ""
echo "Now run this command with sudo to apply the fixes:"
echo ""
echo "sudo cp /tmp/platform.yml /etc/platform/traefik/dynamic/platform.yml && sudo cp /tmp/traefik.yml /etc/platform/traefik/traefik.yml && docker restart traefik"
echo ""
echo "After running the command, test with:"
echo "curl -k -I https://platform.hanzo.ai"