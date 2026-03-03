#!/bin/bash
# Run Hanzo Platform locally with minimal setup

echo "🚀 Starting Hanzo Platform Local Development"
echo "==========================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="20.9.0"

echo -e "${YELLOW}Checking Node.js version...${NC}"
echo "Current: v$NODE_VERSION"
echo "Required: v$REQUIRED_VERSION or higher"

# Start PostgreSQL and Redis if not running
echo -e "\n${YELLOW}Starting PostgreSQL and Redis...${NC}"
docker compose -f docker-compose.simple.yml up -d

# Wait for services
echo -e "\n${YELLOW}Waiting for services to be ready...${NC}"
sleep 5

# Setup environment
echo -e "\n${YELLOW}Setting up environment...${NC}"
cd app/hanzo

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cat > .env << EOF
# Database
DATABASE_URL=postgresql://hanzo:hanzo123@localhost:5432/hanzo
REDIS_URL=redis://localhost:6379

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-key-change-in-production

# Platform
NODE_ENV=development
DISABLE_SIGNUP=false

# Admin credentials
ADMIN_EMAIL=admin@localhost
ADMIN_PASSWORD=admin123

# Docker (for platform operations)
DOCKER_HOST=unix:///var/run/docker.sock
EOF
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "\n${YELLOW}Installing dependencies...${NC}"
    cd ../..
    pnpm install
    cd app/hanzo
fi

# Build core package
echo -e "\n${YELLOW}Building core package...${NC}"
cd ../..
pnpm core:build

# Run migrations
echo -e "\n${YELLOW}Running database migrations...${NC}"
cd app/hanzo
pnpm run migration:generate || true
pnpm run migration:run

# Start the platform
echo -e "\n${GREEN}Starting Hanzo Platform...${NC}"
echo -e "Platform will be available at: ${GREEN}http://localhost:3000${NC}"
echo -e "Default credentials:"
echo -e "  Email: ${GREEN}admin@localhost${NC}"
echo -e "  Password: ${GREEN}admin123${NC}"
echo -e "\n${YELLOW}Press Ctrl+C to stop${NC}\n"

# Start dev server
pnpm run dev