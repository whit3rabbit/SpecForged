# SpecForged VS Code Extension Makefile
#
# This Makefile provides convenient commands for building, testing, and packaging
# the SpecForged VS Code extension.
#
# Usage:
#   make help        - Show this help message
#   make install     - Install dependencies
#   make build       - Build the extension
#   make dev         - Build for development (with sourcemaps, no minification)
#   make watch       - Watch for changes and rebuild
#   make test        - Run all tests
#   make lint        - Run linter
#   make clean       - Clean build artifacts
#   make package     - Create .vsix package
#   make publish     - Publish to marketplace

# Configuration
NODE_BIN := ./node_modules/.bin
SRC_DIR := src
OUT_DIR := out
TEST_DIR := test
PACKAGE_NAME := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
VSIX_FILE := $(PACKAGE_NAME)-$(VERSION).vsix

# Colors for output
CYAN := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

# Default target
.DEFAULT_GOAL := help

# Help target
.PHONY: help
help:
	@echo "$(CYAN)SpecForged VS Code Extension Build System$(RESET)"
	@echo ""
	@echo "$(GREEN)Available targets:$(RESET)"
	@echo "  $(YELLOW)install$(RESET)      - Install dependencies"
	@echo "  $(YELLOW)build$(RESET)        - Build the extension (production)"
	@echo "  $(YELLOW)dev$(RESET)          - Build for development (with sourcemaps)"
	@echo "  $(YELLOW)watch$(RESET)        - Watch for changes and rebuild"
	@echo "  $(YELLOW)test$(RESET)         - Run all tests"
	@echo "  $(YELLOW)test-unit$(RESET)    - Run unit tests only"
	@echo "  $(YELLOW)test-integration$(RESET) - Run integration tests only"
	@echo "  $(YELLOW)test-watch$(RESET)   - Run tests in watch mode"
	@echo "  $(YELLOW)lint$(RESET)         - Run linter"
	@echo "  $(YELLOW)lint-fix$(RESET)     - Run linter and fix issues"
	@echo "  $(YELLOW)typecheck$(RESET)    - Run TypeScript compiler check"
	@echo "  $(YELLOW)clean$(RESET)        - Clean build artifacts"
	@echo "  $(YELLOW)clean-all$(RESET)    - Clean all artifacts including node_modules"
	@echo "  $(YELLOW)package$(RESET)      - Create .vsix package"
	@echo "  $(YELLOW)install-package$(RESET) - Install the packaged extension locally"
	@echo "  $(YELLOW)publish$(RESET)      - Publish to marketplace"
	@echo "  $(YELLOW)version$(RESET)      - Show version info"
	@echo "  $(YELLOW)deps-check$(RESET)   - Check for outdated dependencies"
	@echo "  $(YELLOW)security-audit$(RESET) - Run security audit"
	@echo ""
	@echo "$(GREEN)Environment variables:$(RESET)"
	@echo "  $(YELLOW)NODE_ENV$(RESET)     - Set to 'development' for dev builds"
	@echo "  $(YELLOW)TEST_LOG_LEVEL$(RESET) - Set test logging level (silent,error,warn,info,debug)"
	@echo "  $(YELLOW)VSCODE_TEST_VERSION$(RESET) - VS Code version for testing"
	@echo ""

# Check if node_modules exists
# Use npm ci when lockfile exists; fall back to npm install
node_modules: package.json
	@echo "$(CYAN)Installing dependencies...$(RESET)"
	@if [ -f package-lock.json ]; then \
		echo "Using npm ci (lockfile found)"; \
		npm ci; \
	else \
		echo "No lockfile found; using npm install"; \
		npm install; \
	fi
	@touch node_modules

# Install dependencies
.PHONY: install
install: node_modules
	@echo "$(GREEN)✓ Dependencies installed$(RESET)"

# TypeScript compilation check (no output)
.PHONY: typecheck
typecheck: node_modules
	@echo "$(CYAN)Running TypeScript compiler check...$(RESET)"
	$(NODE_BIN)/tsc --noEmit
	@echo "$(GREEN)✓ TypeScript check passed$(RESET)"

# Build for production
.PHONY: build
build: clean node_modules typecheck
	@echo "$(CYAN)Building extension (production)...$(RESET)"
	npm run bundle
	@echo "$(GREEN)✓ Production build complete$(RESET)"

# Build for development
.PHONY: dev
dev: clean node_modules
	@echo "$(CYAN)Building extension (development)...$(RESET)"
	npm run bundle-dev
	@echo "$(GREEN)✓ Development build complete$(RESET)"

# Watch for changes
.PHONY: watch
watch: node_modules
	@echo "$(CYAN)Starting watch mode...$(RESET)"
	npm run watch-bundle

# Watch TypeScript compilation
.PHONY: watch-tsc
watch-tsc: node_modules
	@echo "$(CYAN)Starting TypeScript watch mode...$(RESET)"
	npm run watch

# Lint the code
.PHONY: lint
lint: node_modules
	@echo "$(CYAN)Running linter...$(RESET)"
	npm run lint
	@echo "$(GREEN)✓ Linting complete$(RESET)"

# Lint and fix issues
.PHONY: lint-fix
lint-fix: node_modules
	@echo "$(CYAN)Running linter with auto-fix...$(RESET)"
	npm run lint-fix
	@echo "$(GREEN)✓ Linting and fixes complete$(RESET)"

# Run all tests
.PHONY: test
test: build
	@echo "$(CYAN)Running all tests...$(RESET)"
	npm test
	@echo "$(GREEN)✓ All tests passed$(RESET)"

# Run unit tests only
.PHONY: test-unit
test-unit: build
	@echo "$(CYAN)Running unit tests...$(RESET)"
	TEST_TYPE=unit npm test
	@echo "$(GREEN)✓ Unit tests passed$(RESET)"

# Run integration tests only
.PHONY: test-integration
test-integration: build
	@echo "$(CYAN)Running integration tests...$(RESET)"
	TEST_TYPE=integration npm test
	@echo "$(GREEN)✓ Integration tests passed$(RESET)"

# Run tests in watch mode
.PHONY: test-watch
test-watch: dev
	@echo "$(CYAN)Starting test watch mode...$(RESET)"
	TEST_LOG_LEVEL=info npm test -- --watch

# Run tests with verbose output
.PHONY: test-verbose
test-verbose: build
	@echo "$(CYAN)Running tests with verbose output...$(RESET)"
	TEST_LOG_LEVEL=debug npm test

# Clean build artifacts
.PHONY: clean
clean:
	@echo "$(CYAN)Cleaning build artifacts...$(RESET)"
	npm run clean
	rm -rf .vscode-test
	rm -rf coverage
	rm -rf .nyc_output
	rm -f *.vsix
	@echo "$(GREEN)✓ Clean complete$(RESET)"

# Clean everything including node_modules
.PHONY: clean-all
clean-all: clean
	@echo "$(CYAN)Cleaning all artifacts including dependencies...$(RESET)"
	rm -rf node_modules
	rm -f package-lock.json
	@echo "$(GREEN)✓ Deep clean complete$(RESET)"

# Create package (set SKIP_TESTS=1 to bypass tests)
.PHONY: package
package: build lint
	@if [ "$(SKIP_TESTS)" != "1" ]; then \
		echo "$(CYAN)Running all tests before packaging...$(RESET)"; \
		$(MAKE) test; \
	else \
		echo "$(YELLOW)Skipping tests (SKIP_TESTS=1)$(RESET)"; \
	fi
	@echo "$(CYAN)Creating package...$(RESET)"
	npm run package
	@ls -la *.vsix
	@echo "$(GREEN)✓ Package created: $(VSIX_FILE)$(RESET)"

# Create package without running tests
.PHONY: package-no-test
package-no-test: build lint
	@echo "$(YELLOW)Creating package without tests...$(RESET)"
	npm run package
	@ls -la *.vsix
	@echo "$(GREEN)✓ Package created: $(VSIX_FILE)$(RESET)"

# Install package locally for testing
.PHONY: install-package
install-package: package
	@echo "$(CYAN)Installing package locally...$(RESET)"
	code --install-extension $(VSIX_FILE) --force
	@echo "$(GREEN)✓ Package installed locally$(RESET)"

# Publish to marketplace
.PHONY: publish
publish: package
	@echo "$(CYAN)Publishing to marketplace...$(RESET)"
	@read -p "Are you sure you want to publish version $(VERSION)? [y/N] " confirm && \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		npm run publish; \
		echo "$(GREEN)✓ Published version $(VERSION)$(RESET)"; \
	else \
		echo "$(YELLOW)Publish cancelled$(RESET)"; \
	fi

# Show version information
.PHONY: version
version:
	@echo "$(CYAN)Version Information:$(RESET)"
	@echo "  Extension: $(PACKAGE_NAME) v$(VERSION)"
	@echo "  Node.js: $$(node --version)"
	@echo "  npm: $$(npm --version)"
	@echo "  TypeScript: $$($(NODE_BIN)/tsc --version)"
	@echo "  VS Code Engine: $$(node -p "require('./package.json').engines.vscode")"

# Check for outdated dependencies
.PHONY: deps-check
deps-check: node_modules
	@echo "$(CYAN)Checking for outdated dependencies...$(RESET)"
	npm outdated || true
	@echo "$(GREEN)✓ Dependency check complete$(RESET)"

# Run security audit
.PHONY: security-audit
security-audit: node_modules
	@echo "$(CYAN)Running security audit...$(RESET)"
	npm audit
	@echo "$(GREEN)✓ Security audit complete$(RESET)"

# Development server (if you have a dev server setup)
.PHONY: dev-server
dev-server: dev
	@echo "$(CYAN)Starting development server...$(RESET)"
	# Add your dev server command here if needed
	@echo "$(YELLOW)No dev server configured$(RESET)"

# Pre-commit checks
.PHONY: pre-commit
pre-commit: typecheck lint test
	@echo "$(GREEN)✓ All pre-commit checks passed$(RESET)"

# CI checks (what CI should run)
.PHONY: ci
ci: install typecheck lint test package
	@echo "$(GREEN)✓ All CI checks passed$(RESET)"

# Format code (if you have prettier or similar)
.PHONY: format
format: node_modules
	@echo "$(CYAN)Formatting code...$(RESET)"
	@if [ -f "$(NODE_BIN)/prettier" ]; then \
		$(NODE_BIN)/prettier --write "$(SRC_DIR)/**/*.{ts,js,json}"; \
		echo "$(GREEN)✓ Code formatted$(RESET)"; \
	else \
		echo "$(YELLOW)Prettier not installed, skipping formatting$(RESET)"; \
	fi

# Debug build with full source maps
.PHONY: debug
debug: clean node_modules
	@echo "$(CYAN)Building debug version...$(RESET)"
	NODE_ENV=development npm run bundle-dev
	@echo "$(GREEN)✓ Debug build complete$(RESET)"

# Bundle analysis (if you want to analyze bundle size)
.PHONY: analyze
analyze: node_modules
	@echo "$(CYAN)Analyzing bundle...$(RESET)"
	@echo "Bundle size:"
	@du -h $(OUT_DIR)/extension.js 2>/dev/null || echo "Build first with 'make build'"
	@echo "Source map size:"
	@du -h $(OUT_DIR)/extension.js.map 2>/dev/null || echo "No source map found"

# Show build info
.PHONY: info
info:
	@echo "$(CYAN)Build Information:$(RESET)"
	@echo "  Source directory: $(SRC_DIR)/"
	@echo "  Output directory: $(OUT_DIR)/"
	@echo "  Test directory: $(TEST_DIR)/"
	@echo "  Package file: $(VSIX_FILE)"
	@echo "  Node binaries: $(NODE_BIN)/"
	@echo ""
	@make version

# Quick development cycle
.PHONY: dev-cycle
dev-cycle: clean dev lint test-unit
	@echo "$(GREEN)✓ Development cycle complete$(RESET)"

# Full release cycle
.PHONY: release-cycle
release-cycle: clean-all install build lint test package
	@echo "$(GREEN)✓ Release cycle complete - ready for publish$(RESET)"

# Force targets (don't check for file timestamps)
.PHONY: force-build
force-build:
	@$(MAKE) clean
	@$(MAKE) build

.PHONY: force-test
force-test:
	@$(MAKE) clean
	@$(MAKE) test

# Pattern rule to handle any npm script
npm-%: node_modules
	@echo "$(CYAN)Running npm script: $*$(RESET)"
	npm run $*
