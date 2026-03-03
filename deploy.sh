#!/bin/bash
# Quick deployment script for Hanzo Platform

cd /home/z/platform

# Ensure dependencies are installed
pnpm install --frozen-lockfile || pnpm install

# Try to build (allow failures)
cd pkg/paas && (pnpm build || echo "Paas build failed, continuing...")
cd /home/z/platform/app/hanzo && (pnpm build || echo "Hanzo build failed, continuing...")

# Ensure .env file exists
if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || echo "DATABASE_URL=postgresql://hanzo:hanzo123@localhost:5432/hanzo" > .env
fi

# Start in production mode
cd /home/z/platform/app/hanzo
NODE_ENV=production PORT=3000 pnpm start