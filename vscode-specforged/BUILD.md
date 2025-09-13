# SpecForged Extension Build Guide

This document explains how to build, test, and package the SpecForged VS Code extension.

## Prerequisites

- **Node.js** 16.x or later
- **npm** 7.x or later
- **VS Code** 1.74.0 or later
- **Make** (optional, for Makefile usage)

## Quick Start

### Using the Makefile (Recommended)

The project includes a comprehensive Makefile that handles all build tasks:

```bash
# Show all available commands
make help

# Install dependencies
make install

# Build for development
make dev

# Build for production
make build

# Run tests
make test

# Watch for changes
make watch

# Create package
make package

# Create package without running VS Code tests
make package-no-test
# or
SKIP_TESTS=1 make package
```

### Using npm scripts directly

If you prefer npm or don't have Make available:

```bash
# Install dependencies
npm ci

# Build for development (with sourcemaps, no minification)
npm run bundle-dev

# Build for production (minified)
npm run bundle

# Run tests
npm test

# Watch for changes
npm run watch-bundle

# Create package
npm run package

# Create package without running VS Code tests
SKIP_VSCODE_TESTS=1 npm run package
# or
SKIP_TESTS=1 npm run package
```

### Using the build script

For cross-platform compatibility without Make:

```bash
# Make executable (Unix/Linux/macOS)
chmod +x scripts/build.sh

# Build for development
./scripts/build.sh development

# Build for production
./scripts/build.sh production

# Start watch mode
./scripts/build.sh watch
```

## Development Workflow

### 1. Initial Setup

```bash
# Clone and setup
git clone <repository-url>
cd vscode-specforged
make install
```

### 2. Development Build

```bash
# Build for development with sourcemaps
make dev

# Or start watch mode for continuous rebuilding
make watch
```

### 3. Testing

```bash
# Run all tests
make test

# Run only unit tests
make test-unit

# Run only integration tests
make test-integration

# Run tests with verbose output
make test-verbose

# Run tests in watch mode
make test-watch
```

### 4. Code Quality

```bash
# Run linter
make lint

# Run linter and fix issues automatically
make lint-fix

# Run TypeScript compiler check
make typecheck

# Run all pre-commit checks
make pre-commit
```

### 5. Packaging and Publishing

```bash
# Create .vsix package
make package

# Install locally for testing
make install-package

# Publish to marketplace (interactive)
make publish
```

## Environment Variables

### Build Environment

- `NODE_ENV=development` - Enables development mode
- `NODE_ENV=production` - Enables production optimizations (default)

### Testing

- `TEST_LOG_LEVEL=debug` - Enable verbose test output
- `TEST_LOG_LEVEL=warn` - Minimal test output (default)
- `TEST_LOG_LEVEL=silent` - No test output
- `TEST_TYPE=unit` - Run only unit tests
- `TEST_TYPE=integration` - Run only integration tests
- `VSCODE_TEST_VERSION=1.74.0` - Specify VS Code version for testing
- `SKIP_VSCODE_TESTS=1` - Skip downloading/launching VS Code test runner (CI/offline packaging)
- `SKIP_TESTS=1` - Skip running tests entirely during `make package` or `npm test`

### Example Usage

```bash
# Build with development settings
NODE_ENV=development make build

# Run tests with debug output
TEST_LOG_LEVEL=debug make test

# Run only integration tests quietly
TEST_LOG_LEVEL=warn TEST_TYPE=integration make test
```

## Build Targets Explained

### Core Targets

- `make install` - Install dependencies using `npm ci`
- `make build` - Production build (TypeScript → bundled JavaScript)
- `make dev` - Development build (faster, with sourcemaps)
- `make watch` - Continuous build on file changes
- `make test` - Run all tests (unit + integration)
- `make clean` - Remove build artifacts
- `make package` - Create .vsix extension package
  - Supports `SKIP_TESTS=1` to skip tests (and VS Code test runner)
  - See also: `make package-no-test`

### Development Targets

- `make dev-cycle` - Quick cycle: clean → dev build → lint → unit tests
- `make pre-commit` - All checks before committing: typecheck → lint → test
- `make debug` - Build with full debugging support
- `make format` - Format code (if Prettier is installed)

### Quality Assurance

- `make lint` - Run ESLint
- `make lint-fix` - Run ESLint with auto-fix
- `make typecheck` - TypeScript compiler check (no output)
- `make security-audit` - Run `npm audit`
- `make deps-check` - Check for outdated dependencies

### Release Targets

- `make release-cycle` - Full release preparation: clean → install → build → lint → test → package
- `make ci` - What CI should run: install → typecheck → lint → test → package
- `make publish` - Interactive publish to VS Code marketplace

## File Structure

```
vscode-specforged/
├── src/                    # TypeScript source code
│   ├── extension.ts       # Main extension entry point
│   ├── commands/          # Command implementations
│   ├── services/          # Core services
│   ├── utils/             # Utility functions
│   └── test/              # Test files
├── out/                   # Compiled JavaScript (generated)
│   └── extension.js       # Bundled extension
├── scripts/               # Build scripts
│   └── build.sh          # Cross-platform build script
├── package.json           # Extension manifest and dependencies
├── tsconfig.json          # TypeScript configuration
├── Makefile              # Build automation
└── BUILD.md              # This file
```

## Troubleshooting

### Build Issues

**"Command not found: make"**
- Use npm scripts directly: `npm run build`
- Or use the build script: `./scripts/build.sh production`

**"TypeScript errors during build"**
```bash
# Check TypeScript issues
make typecheck

# Clean and rebuild
make clean
make build
```

**"Tests failing"**
```bash
# Run with verbose output to see details
make test-verbose

# Run specific test type
make test-unit
make test-integration

# Clean test cache
make clean
make test

# Skip VS Code test runner (useful for CI/offline)
SKIP_VSCODE_TESTS=1 make test

# Package without tests (skips VS Code download)
make package-no-test
# or
SKIP_TESTS=1 make package
```

### Development Issues

**"Extension not loading in VS Code"**
1. Check that build completed successfully: `ls -la out/extension.js`
2. Verify package.json main entry points to correct file
3. Check VS Code developer console for errors

**"Changes not reflected"**
- Use watch mode: `make watch`
- Or rebuild manually: `make dev`
- Reload VS Code window: `Ctrl+Shift+P` → "Developer: Reload Window"

**"Out of memory during build"**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
make build
```

## Contributing

### Before Committing

Always run pre-commit checks:

```bash
make pre-commit
```

This runs:
1. TypeScript compilation check
2. ESLint with error checking
3. All tests (unit + integration)

### Pull Request Checklist

- [ ] `make pre-commit` passes
- [ ] New features have tests
- [ ] Documentation updated if needed
- [ ] Version bumped in package.json (if applicable)

### Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md` with new features/fixes
3. Run full release cycle: `make release-cycle`
4. Test the packaged extension: `make install-package`
5. Commit and tag: `git tag v1.2.3`
6. Publish: `make publish`

## Performance Tips

### Faster Development

```bash
# Use development build (faster)
make dev

# Use watch mode (automatic rebuilding)
make watch

# Skip tests during development
make dev-cycle  # includes quick tests only
```

### Faster CI/CD

```bash
# Use npm ci instead of npm install
npm ci

# Use specific test types when appropriate
TEST_TYPE=unit make test
```

## Advanced Usage

### Custom Build Configuration

Create a local `.env` file:

```bash
# .env
NODE_ENV=development
TEST_LOG_LEVEL=debug
VSCODE_TEST_VERSION=1.85.0
SKIP_VSCODE_TESTS=1
SKIP_TESTS=0
```

### Debugging the Extension

1. Build with debug symbols: `make debug`
2. Open in VS Code: `code .`
3. Press `F5` to launch Extension Development Host
4. Set breakpoints in TypeScript source files

## Continuous Integration

This repo includes a GitHub Actions workflow at `.github/workflows/ci.yml` that:
- Installs dependencies with `npm ci`
- Runs typecheck and lint
- Builds the extension with esbuild
- Packages the extension with `vsce`, uploading the `.vsix` as an artifact

The workflow sets `SKIP_VSCODE_TESTS=1` and `SKIP_TESTS=1` by default to avoid downloading/launching the VS Code test runner in CI. If you want to re-enable tests, remove or set those variables to `0` and ensure the runner supports downloading VS Code.

### Publishing from CI (optional)

When you're ready to publish to the Marketplace via CI:
- Create a Personal Access Token (PAT) and add it as a repository secret named `VSCE_PAT`.
- Add a publish job that runs `npx vsce publish` with the secret in the environment.
- Only run on tags (e.g., `v*`) to publish releases.

Until `VSCE_PAT` is configured, you can package locally and publish manually:
```bash
make package-no-test
npx vsce publish   # requires VSCE_PAT in your shell environment
```

### Bundle Analysis

```bash
# Check bundle size
make analyze

# View detailed build info
make info
```

This will show you the size of your bundled extension and help identify optimization opportunities.
