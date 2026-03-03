#!/bin/bash
set -e

echo "🔧 Fixing platform for local development..."

# Fix missing constants import in paas package
echo "📦 Creating constants.ts in paas package..."
cat > /home/z/platform/pkg/paas/src/constants.ts << 'EOF'
export const IS_CLOUD = process.env.IS_CLOUD === 'true';
export const APPLICATIONS_PATH = '/var/lib/hanzo/applications';
export const DATABASES_PATH = '/var/lib/hanzo/databases';
export const COMPOSE_PATH = process.env.COMPOSE_PATH || '/var/lib/hanzo/compose';
export const MONITORING_PATH = '/var/lib/hanzo/monitoring';
export const LOGS_PATH = '/var/lib/hanzo/logs';
export const BACKUPS_PATH = '/var/lib/hanzo/backups';
export const VOLUMES_PATH = '/var/lib/hanzo/volumes';
export const CERTS_PATH = '/var/lib/hanzo/certs';
EOF

# Ensure paas is in dev mode
echo "🔄 Switching paas to dev mode..."
cd /home/z/platform/pkg/paas
npm run switch:dev

# Install any missing dependencies
echo "📦 Installing missing dependencies..."
cd /home/z/platform/app/hanzo
pnpm add -D @types/node

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "📝 Creating .env file..."
  cat > .env << 'EOF'
DATABASE_URL=postgres://hanzo:amukds4wi9001583845717ad2@hanzo-postgres:5432/hanzo
REDIS_URL=redis://hanzo-redis:6379
NEXTAUTH_SECRET=mysecret
SERVER_URL=http://localhost:3000
EOF
fi

# Start development server
echo "🚀 Starting development server on http://localhost:3000..."
DATABASE_URL="postgres://hanzo:amukds4wi9001583845717ad2@hanzo-postgres:5432/hanzo" \
REDIS_URL="redis://hanzo-redis:6379" \
PORT=3000 \
pnpm dev