# Platform ZAP Server Makefile

.PHONY: all build test clean run dev bench schema check fmt lint install help

# Default target
all: build

# Build the server
build:
	cargo build --release

# Build in debug mode
debug:
	cargo build

# Run tests
test:
	cargo test

# Run integration tests (requires running Platform tRPC)
test-integration:
	cargo test --features integration

# Clean build artifacts
clean:
	cargo clean

# Run the server
run: build
	./target/release/platform-zap

# Run in development mode with verbose logging
dev:
	RUST_LOG=platform_zap=debug cargo run -- -v

# Run benchmarks
bench:
	cargo bench

# Generate Cap'n Proto schema
schema:
	capnp compile -o rust:src schema/platform.capnp

# Check code without building
check:
	cargo check

# Format code
fmt:
	cargo fmt

# Run clippy linter
lint:
	cargo clippy -- -D warnings

# Install locally
install:
	cargo install --path .

# Generate a test token
token:
	cargo run -- --generate-token --subject test-user --org test-org

# Run with TLS
run-tls:
	./target/release/platform-zap --config config/server.toml

# Docker build
docker-build:
	docker build -t platform-zap:latest .

# Docker run
docker-run:
	docker run -p 9998:9998 platform-zap:latest

# Generate documentation
docs:
	cargo doc --no-deps --open

# Show help
help:
	@echo "Platform ZAP Server"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  build            Build release binary"
	@echo "  debug            Build debug binary"
	@echo "  test             Run unit tests"
	@echo "  test-integration Run integration tests"
	@echo "  clean            Clean build artifacts"
	@echo "  run              Run the server"
	@echo "  dev              Run in development mode"
	@echo "  bench            Run benchmarks"
	@echo "  schema           Compile Cap'n Proto schema"
	@echo "  check            Check code without building"
	@echo "  fmt              Format code"
	@echo "  lint             Run clippy linter"
	@echo "  install          Install binary locally"
	@echo "  token            Generate a test token"
	@echo "  docker-build     Build Docker image"
	@echo "  docker-run       Run Docker container"
	@echo "  docs             Generate documentation"
	@echo "  help             Show this help"
