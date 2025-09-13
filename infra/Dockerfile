# Use Python 3.13 with uv pre-installed to match uv.lock
FROM ghcr.io/astral-sh/uv:python3.13-alpine AS builder

# Set working directory
WORKDIR /app

# Enable bytecode compilation for better performance
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV UV_COMPILE_BYTECODE=1

# Copy from the cache instead of linking since it's a mounted volume
ENV UV_LINK_MODE=copy

# Install the project's dependencies using the lockfile and settings
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

# Then, add the rest of the project source code and install it
# Installing separately from its dependencies allows optimal layer caching
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# Production stage
FROM python:3.13-alpine AS production

# Install system dependencies for health checks and security
RUN apk add --no-cache \
    wget \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1000 specforged && \
    adduser -u 1000 -G specforged -s /bin/sh -D specforged

# Set working directory
WORKDIR /app

# Copy the application and virtual environment from builder
COPY --from=builder --chown=specforged:specforged /app /app

# Create required directories with proper permissions
RUN mkdir -p /workspace/.specifications /app/logs && \
    chown -R specforged:specforged /workspace /app/logs

# Environment variables with sensible defaults
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PATH="/app/.venv/bin:$PATH"

# Server configuration
ENV SPECFORGED_NAME="SpecForged-Docker"
ENV SPECFORGED_HOST="0.0.0.0"
ENV SPECFORGED_PORT="8080"
ENV SPECFORGED_LOG_LEVEL="INFO"

# Project configuration
ENV SPECFORGE_PROJECT_ROOT="/workspace"
ENV SPECFORGE_BASE_DIR="/workspace/.specifications"

# Security settings
ENV SPECFORGED_SECURITY_AUDIT="true"
ENV SPECFORGED_RATE_LIMITING="true"
ENV SPECFORGED_MAX_REQUESTS="100"

# HTTP settings
ENV SPECFORGED_CORS_ENABLED="true"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

# Use non-root user
USER specforged

# Expose the port
EXPOSE 8080

# Add metadata labels
LABEL org.opencontainers.image.title="SpecForged MCP Server"
LABEL org.opencontainers.image.description="Specification-driven development MCP server"
LABEL org.opencontainers.image.source="https://github.com/whit3rabbit/SpecForge"
LABEL org.opencontainers.image.vendor="SpecForge Team"
LABEL org.opencontainers.image.licenses="MIT"

# Create volume for specifications persistence
VOLUME ["/workspace"]

# Default command - can be overridden
CMD ["python", "main_http.py"]

# Development stage (for debugging)
FROM production AS development

USER root

# Install development tools
RUN apk add --no-cache \
    git \
    bash \
    vim \
    && rm -rf /var/cache/apk/*

# Install development dependencies
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --dev

ENV SPECFORGED_DEBUG="true"
ENV SPECFORGED_LOG_LEVEL="DEBUG"

USER specforged

# Override command for development
CMD ["python", "-m", "src.specforged.cli", "serve"]
