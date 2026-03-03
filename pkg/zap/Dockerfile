# Platform ZAP Server Dockerfile
#
# Multi-stage build for minimal image size
# Based on distroless for security

# Build stage
FROM rust:1.75-bookworm AS builder

# Install Cap'n Proto compiler
RUN apt-get update && apt-get install -y \
    capnproto \
    libcapnp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY schema/ ./schema/

# Create dummy src to build dependencies
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    echo "pub fn lib() {}" > src/lib.rs

# Build dependencies only
RUN cargo build --release && rm -rf src

# Copy actual source
COPY src/ ./src/

# Build the actual binary
RUN touch src/main.rs src/lib.rs && \
    cargo build --release --bin platform-zap

# Runtime stage - using distroless for minimal attack surface
FROM gcr.io/distroless/cc-debian12

# Copy the binary
COPY --from=builder /build/target/release/platform-zap /usr/local/bin/

# Copy configuration
COPY config/ /etc/platform-zap/

# Set environment defaults
ENV PLATFORM_ZAP_LISTEN=0.0.0.0
ENV PLATFORM_ZAP_PORT=9998
ENV PLATFORM_TRPC_URL=http://platform:3000

# Expose ZAP port
EXPOSE 9998

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/platform-zap", "--health-check"] || exit 1

# Run as non-root
USER nonroot:nonroot

# Entry point
ENTRYPOINT ["/usr/local/bin/platform-zap"]
CMD ["-c", "/etc/platform-zap/gateway.toml"]
