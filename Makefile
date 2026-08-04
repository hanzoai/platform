# Hanzo Platform — pnpm workspace (app/*, pkg/*). Every target CALLS a root
# package.json script; the fan-out (`pnpm -r`, `pnpm --filter`) already lives
# there and is not restated here.

PNPM ?= pnpm

.PHONY: help build dev test lint clean

help: ## Show this help.
	@awk 'BEGIN{FS=":.*##";printf "\nUsage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: node_modules ## Build every workspace package (pnpm -r run build).
	$(PNPM) build

dev: node_modules ## Run the platform app locally.
	$(PNPM) platform:dev

test: node_modules ## Run the platform-app suite (vitest).
	$(PNPM) test

# biome, per biome.json — one tool for both jobs, which is why the script is
# named for both. `check` and `format-and-lint:fix` WRITE; this one only reads.
lint: node_modules ## biome check .
	$(PNPM) format-and-lint

# The one target with no script to call, so it is the one that has to state what
# this repo generates. It states exactly what .gitignore already does — dist
# (root :28), .next and *.tsbuildinfo (app/platform/.gitignore :28, :55), .turbo
# (root :20) — so every path it can name is ignored by construction and none of
# them can be tracked. Scoped to the workspace roots from pnpm-workspace.yaml at
# depth 2, which is also what keeps it out of node_modules.
clean: ## Remove build output (.next, dist, .turbo, tsbuildinfo). Keeps node_modules.
	find app pkg -maxdepth 2 \( -name .next -o -name dist -o -name .turbo -o -name '*.tsbuildinfo' \) -prune -exec rm -rf {} +

node_modules: ## Install deps (pnpm install --frozen-lockfile).
	$(PNPM) install --frozen-lockfile
