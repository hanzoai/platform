#!/bin/bash
# Hanzo Platform Auto-Deploy Script
# This script pulls latest changes, builds, and restarts the platform

set -e

echo "🚀 Starting Hanzo Platform deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PLATFORM_DIR="/home/z/platform"
DOCKER_IMAGE="hanzoai/platform:local"
CONTAINER_NAME="hanzo-platform"

# Function to check if command was successful
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1${NC}"
    else
        echo -e "${RED}✗ $1 failed${NC}"
        exit 1
    fi
}

# Navigate to platform directory
cd $PLATFORM_DIR
check_status "Changed to platform directory"

# Pull latest changes from git
echo -e "${YELLOW}Pulling latest changes from git...${NC}"
git fetch origin main
git reset --hard origin/main
check_status "Git pull"

# Install/update dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
pnpm install --frozen-lockfile
check_status "Dependency installation"

# Build platform package
echo -e "${YELLOW}Building platform package...${NC}"
pnpm --filter=@hanzo/platform build
check_status "Platform package build"

# Build server
echo -e "${YELLOW}Building server...${NC}"
pnpm --filter=@hanzo/paas build-server
check_status "Server build"

# Build Next.js
echo -e "${YELLOW}Building Next.js application...${NC}"
pnpm --filter=@hanzo/paas build-next
check_status "Next.js build"

# Stop existing container
echo -e "${YELLOW}Stopping existing container...${NC}"
docker stop $CONTAINER_NAME 2>/dev/null || true
docker rm $CONTAINER_NAME 2>/dev/null || true
echo -e "${GREEN}✓ Cleaned up old container${NC}"

# Build new Docker image
echo -e "${YELLOW}Building new Docker image...${NC}"
docker build -t $DOCKER_IMAGE .
check_status "Docker image build"

# Run new container
echo -e "${YELLOW}Starting new container...${NC}"
docker run -d \
    --name $CONTAINER_NAME \
    --restart unless-stopped \
    -p 3000:3000 \
    -e NODE_ENV=production \
    -e DATABASE_URL="postgresql://hanzo:hanzo123@hanzo-postgres:5432/hanzo" \
    -e REDIS_URL="redis://hanzo-redis:6379" \
    -e AUTH_SECRET="hanzo_auth_secret_key_production_2025" \
    -e NEXTAUTH_URL="https://platform.hanzo.ai" \
    -e SERVER_URL="https://platform.hanzo.ai" \
    -e NEXT_PUBLIC_APP_NAME="Hanzo Platform" \
    -e NEXT_PUBLIC_APP_URL="https://platform.hanzo.ai" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v hanzo-postgres-database:/var/lib/postgresql/data \
    -v hanzo-data:/app \
    --network hanzo-network \
    $DOCKER_IMAGE

check_status "Container startup"

# Wait for container to be healthy
echo -e "${YELLOW}Waiting for container to be healthy...${NC}"
sleep 10

# Check if container is running
if docker ps | grep -q $CONTAINER_NAME; then
    echo -e "${GREEN}✓ Container is running${NC}"

    # Test the application
    echo -e "${YELLOW}Testing application...${NC}"
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|302"; then
        echo -e "${GREEN}✓ Application is responding${NC}"
    else
        echo -e "${RED}✗ Application is not responding properly${NC}"
        docker logs $CONTAINER_NAME --tail 50
        exit 1
    fi
else
    echo -e "${RED}✗ Container failed to start${NC}"
    docker logs $CONTAINER_NAME --tail 50
    exit 1
fi

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}Platform is running at: https://platform.hanzo.ai${NC}"

# Optional: Clean up old Docker images
echo -e "${YELLOW}Cleaning up old Docker images...${NC}"
docker image prune -f
echo -e "${GREEN}✓ Cleanup complete${NC}"