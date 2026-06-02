# Platform ZAP Server Dockerfile
#
# Multi-stage build for minimal image size
# Based on distroless for security

# Build stage
FROM rust:1.93-bookworm AS builder

# Install Cap'n Proto compiler
RUN apt-get update && apt-get install -y \
    capnproto \
    libcapnp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock* ./
COPY build.rs ./
COPY schema/ ./schema/

# Create dummy src/benches/examples to build dependencies
RUN mkdir -p src benches examples && \
    echo "fn main() {}" > src/main.rs && \
    echo "pub fn lib() {}" > src/lib.rs && \
    echo "fn main() {}" > benches/rpc_benchmark.rs && \
    echo "fn main() {}" > examples/client.rs

# Build dependencies only
RUN cargo build --release 2>/dev/null; true
RUN rm -rf src benches examples

# Copy actual source + benches + examples
COPY src/ ./src/
COPY benches/ ./benches/
COPY examples/ ./examples/

# Build the actual binary
RUN touch src/main.rs src/lib.rs && \
    cargo build --release --bin platform-zap

# Runtime stage — hanzo-mirrored cc-debian12 (distroless equivalent).
# Rust binary needs libc/libgcc_s so we cannot drop to scratch.
FROM ghcr.io/hanzoai/debian12:cc-nonroot

# Copy the binary
COPY --from=builder /build/target/release/platform-zap /usr/local/bin/

# Set environment defaults (config via env, no config file needed)
ENV PLATFORM_ZAP_LISTEN=0.0.0.0
ENV PLATFORM_ZAP_PORT=9998
ENV PLATFORM_TRPC_URL=http://platform:4000

# Expose ZAP port
EXPOSE 9998

# Run as non-root
USER nonroot:nonroot

# Entry point - uses Config::from_env() by default (no -c flag)
ENTRYPOINT ["/usr/local/bin/platform-zap"]

# TODO(ghcr-auth): CI workflows building this image must `docker login`
# to ghcr.io/hanzoai with a PAT (secret: GHCR_PULL_TOKEN) — the default
# GITHUB_TOKEN scopes to the repo's own package only.
