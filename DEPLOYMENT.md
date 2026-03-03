# Hanzo Platform Deployment Guide

## Quick Update (Recommended)

To update the platform with the latest image:

```bash
cd /home/z/work/hanzo/platform
docker compose pull
docker compose up -d
```

This will:
- Pull the latest `hanzoai/platform:latest` image
- Recreate the container with the same configuration
- Preserve the static IP address (10.0.1.36) for Traefik routing
- Maintain all environment variables

## Manual Docker Run (Not Recommended)

If you must run manually:

```bash
docker pull hanzoai/platform:latest
docker stop platform && docker rm platform
docker run -d \
  --name platform \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /etc/localtime:/etc/localtime:ro \
  --env-file .env \
  --network hanzo-network \
  --ip 10.0.1.36 \
  hanzoai/platform:latest
```

**⚠️ Warning:** Manual runs may require updating Traefik config if IP changes.

## Traefik Configuration

The platform is accessible at `platform.hanzo.ai` via Traefik.

Config location: `/etc/platform/traefik/dynamic/platform.yml`

If the IP address changes, update the service URL in the config:

```yaml
services:
  platform-service:
    loadBalancer:
      servers:
        - url: "http://10.0.1.36:3000"
```

## Checking Status

```bash
# Check container status
docker ps | grep platform

# Check logs
docker logs platform --tail 50

# Check IP address
docker inspect platform | grep -A 20 '"hanzo-network"' | grep IPAddress

# Test direct access
curl http://localhost:3000

# Test via Traefik
curl http://platform.hanzo.ai
```

## Network Configuration

The platform runs on the `hanzo-network` Docker network with static IP `10.0.1.36`.

This ensures consistent routing through Traefik without config updates.
