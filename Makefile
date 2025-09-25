# Hanzo Platform Makefile
# Easy commands for building, deploying, and managing the platform

.PHONY: all help install build push deploy update clean logs status restart dev prod test

# Default target: build and test
all: build test

# Variables
DOCKER_IMAGE := hanzoai/platform
DOCKER_TAG := latest
DOCKERFILE := docker/hanzo/Dockerfile
SERVICE_NAME := platform-hanzo
NETWORK_NAME := hanzo-network
PORT := 3000

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(GREEN)Hanzo Platform Management Commands$(NC)"
	@echo ""
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-15s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  make build       # Build the Docker image"
	@echo "  make deploy      # Deploy to production"
	@echo "  make update      # Update platform (build + deploy)"
	@echo "  make logs        # View platform logs"

install: ## Install dependencies
	@echo "$(GREEN)Installing dependencies...$(NC)"
	pnpm install --frozen-lockfile

build-dev: ## Build locally for development
	@echo "$(GREEN)Building paas package...$(NC)"
	cd pkg/paas && npm run switch:prod && npm run build
	@echo "$(GREEN)Building hanzo app...$(NC)"
	cd app/hanzo && pnpm build

build: ## Build Docker image
	@echo "$(GREEN)Building Docker image $(DOCKER_IMAGE):$(DOCKER_TAG)...$(NC)"
	docker build -f $(DOCKERFILE) -t $(DOCKER_IMAGE):$(DOCKER_TAG) .
	@echo "$(GREEN)Build complete!$(NC)"

build-prod: ## Build production Docker image with cache
	@echo "$(GREEN)Building production Docker image...$(NC)"
	docker build \
		--build-arg NODE_ENV=production \
		-f docker/hanzo/Dockerfile.production \
		-t $(DOCKER_IMAGE):$(DOCKER_TAG) \
		-t $(DOCKER_IMAGE):$(shell git rev-parse --short HEAD 2>/dev/null || echo "latest") \
		.
	@echo "$(GREEN)Production build complete!$(NC)"

push: ## Push Docker image to registry
	@echo "$(YELLOW)Pushing $(DOCKER_IMAGE):$(DOCKER_TAG) to Docker Hub...$(NC)"
	docker push $(DOCKER_IMAGE):$(DOCKER_TAG)
	@echo "$(GREEN)Push complete!$(NC)"

deploy: ## Deploy platform using Docker Compose
	@echo "$(GREEN)Deploying platform with Docker Compose...$(NC)"
	docker compose -f docker/compose.prod.yml up -d
	@echo "$(GREEN)Platform deployed! Available at https://platform.hanzo.ai$(NC)"
	@echo "$(YELLOW)Use 'make status' to check deployment status$(NC)"

update: build push deploy ## Full update: build, push, and deploy
	@echo "$(GREEN)Platform update complete!$(NC)"


clean: ## Clean up containers and images
	@echo "$(YELLOW)Cleaning up...$(NC)"
	docker service rm $(SERVICE_NAME) 2>/dev/null || true
	docker rmi $(DOCKER_IMAGE):$(DOCKER_TAG) 2>/dev/null || true
	@echo "$(GREEN)Cleanup complete!$(NC)"

logs: ## View platform logs
	@echo "$(GREEN)Fetching logs...$(NC)"
	docker service logs $(SERVICE_NAME) --tail 50 --follow

status: ## Check platform status
	@echo "$(GREEN)Platform Status:$(NC)"
	@docker service ls | grep $(SERVICE_NAME) || echo "$(RED)Service not running$(NC)"
	@echo ""
	@echo "$(GREEN)Service details:$(NC)"
	@docker service ps $(SERVICE_NAME) 2>/dev/null || echo "$(RED)No service found$(NC)"
	@echo ""
	@echo "$(GREEN)Testing platform.hanzo.ai:$(NC)"
	@curl -sI https://platform.hanzo.ai | head -1 || echo "$(RED)Platform not accessible$(NC)"

restart: ## Restart platform service
	@echo "$(YELLOW)Restarting platform...$(NC)"
	docker service update --force $(SERVICE_NAME)
	@echo "$(GREEN)Restart initiated!$(NC)"

dev: ## Run in development mode
	@echo "$(GREEN)Starting development server...$(NC)"
	cd app/hanzo && pnpm dev

prod: ## Run in production mode locally
	@echo "$(GREEN)Starting production server...$(NC)"
	cd app/hanzo && NODE_ENV=production pnpm start

test: ## Run tests
	@echo "$(GREEN)Running tests...$(NC)"
	cd app/hanzo && pnpm test

db-migrate: ## Run database migrations
	@echo "$(GREEN)Running migrations...$(NC)"
	cd app/hanzo && pnpm run migration:run

db-seed: ## Seed database
	@echo "$(GREEN)Seeding database...$(NC)"
	cd app/hanzo && pnpm run db:seed

docker-dev: ## Build and run development Docker image
	@echo "$(GREEN)Building dev Docker image...$(NC)"
	docker build -f docker/hanzo/Dockerfile.dev -t $(DOCKER_IMAGE):dev .
	docker run --rm \
		-p 3000:3000 \
		-e DATABASE_URL="postgresql://hanzo:hanzo123@host.docker.internal:5432/hanzo" \
		-e REDIS_URL="redis://host.docker.internal:6379" \
		-v $(PWD):/app \
		$(DOCKER_IMAGE):dev

check-env: ## Check environment setup
	@echo "$(GREEN)Checking environment...$(NC)"
	@command -v docker >/dev/null && echo "✓ Docker installed" || echo "✗ Docker not found"
	@command -v pnpm >/dev/null && echo "✓ pnpm installed" || echo "✗ pnpm not found"
	@command -v node >/dev/null && echo "✓ Node.js installed ($(shell node -v))" || echo "✗ Node.js not found"
	@docker info >/dev/null 2>&1 && echo "✓ Docker daemon running" || echo "✗ Docker daemon not running"
	@docker network ls | grep -q $(NETWORK_NAME) && echo "✓ Network $(NETWORK_NAME) exists" || echo "✗ Network $(NETWORK_NAME) not found"


# Quick commands
up: update ## Alias for update
down: clean ## Alias for clean
log: logs ## Alias for logs