#!/bin/bash

# Hanzo Platform Local Development Setup Script
# This script sets up everything needed to run Hanzo Platform locally

set -e

echo "🚀 Hanzo Platform Local Development Setup"
echo "========================================"

# Check prerequisites
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ $1 is not installed. Please install it first."
        exit 1
    fi
}

echo "Checking prerequisites..."
check_command node
check_command pnpm
check_command docker

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "❌ Node.js version 22 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ All prerequisites met!"

# Install dependencies
echo -e "\n📦 Installing dependencies..."
pnpm install

# Setup environment file
echo -e "\n🔧 Setting up environment..."
if [ ! -f app/hanzo/.env ]; then
    cp app/hanzo/.env.example app/hanzo/.env
    echo "✅ Created .env file from example"
else
    echo "✅ .env file already exists"
fi

# Start PostgreSQL and Redis with Docker
echo -e "\n🐳 Starting PostgreSQL and Redis..."

# Stop existing containers if they exist
docker stop hanzo-postgres hanzo-redis 2>/dev/null || true
docker rm hanzo-postgres hanzo-redis 2>/dev/null || true

# Start PostgreSQL
docker run -d \
    --name hanzo-postgres \
    -e POSTGRES_USER=hanzo \
    -e POSTGRES_PASSWORD=amukds4wi9001583845717ad2 \
    -e POSTGRES_DB=hanzo \
    -p 5432:5432 \
    postgres:16

echo "✅ PostgreSQL started"

# Start Redis
docker run -d \
    --name hanzo-redis \
    -p 6379:6379 \
    redis:7-alpine

echo "✅ Redis started"

# Wait for services to be ready
echo -e "\n⏳ Waiting for services to be ready..."
sleep 5

# Build core package
echo -e "\n🔨 Building core package..."
pnpm core:build

# Run setup
echo -e "\n🔧 Running platform setup..."
cd app/hanzo
pnpm run setup

# Run migrations
echo -e "\n🗄️  Running database migrations..."
pnpm run migration:run

cd ../..

echo -e "\n✅ Setup complete!"
echo "========================================"
echo "To start the development server, run:"
echo "  pnpm hanzo:dev"
echo ""
echo "The platform will be available at:"
echo "  http://localhost:3000"
echo ""
echo "To stop the database services later:"
echo "  docker stop hanzo-postgres hanzo-redis"
echo "========================================"