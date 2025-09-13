#!/bin/bash

# SpecForged Extension Build Script
#
# This script provides a platform-independent way to build the extension
# when Make is not available.

set -e

# Colors
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

# Configuration
BUILD_TYPE="${1:-production}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo -e "${CYAN}SpecForged Extension Build Script${RESET}"
echo -e "Build type: ${YELLOW}${BUILD_TYPE}${RESET}"
echo

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo -e "${CYAN}Installing dependencies...${RESET}"
    if [ -f package-lock.json ]; then
        echo -e "Using npm ci (lockfile found)"
        npm ci
    else
        echo -e "No lockfile found; using npm install"
        npm install
    fi
fi

# Clean previous build
echo -e "${CYAN}Cleaning previous build...${RESET}"
rm -rf out
rm -f *.vsix

# Run TypeScript check
echo -e "${CYAN}Running TypeScript check...${RESET}"
./node_modules/.bin/tsc --noEmit

# Run linter
echo -e "${CYAN}Running linter...${RESET}"
npm run lint

# Build based on type
case "$BUILD_TYPE" in
    "development" | "dev")
        echo -e "${CYAN}Building for development...${RESET}"
        npm run bundle-dev
        ;;
    "production" | "prod")
        echo -e "${CYAN}Building for production...${RESET}"
        npm run bundle
        ;;
    "watch")
        echo -e "${CYAN}Starting watch mode...${RESET}"
        npm run watch-bundle
        exit 0
        ;;
    *)
        echo -e "${RED}Unknown build type: $BUILD_TYPE${RESET}"
        echo "Available types: development, production, watch"
        exit 1
        ;;
esac

# Run tests if not in watch mode
if [ "$BUILD_TYPE" != "watch" ]; then
    echo -e "${CYAN}Running tests...${RESET}"
    npm test
fi

echo -e "${GREEN}✓ Build complete!${RESET}"

# Show build info
if [ -f "out/extension.js" ]; then
    SIZE=$(du -h out/extension.js | cut -f1)
    echo -e "Bundle size: ${YELLOW}${SIZE}${RESET}"
fi

echo
echo -e "${GREEN}Build successful!${RESET} You can now:"
echo -e "  • Test the extension: ${YELLOW}code --install-extension .${RESET}"
echo -e "  • Package for distribution: ${YELLOW}make package${RESET} or ${YELLOW}npm run package${RESET}"
echo -e "  • Start development: ${YELLOW}make watch${RESET} or ${YELLOW}npm run watch-bundle${RESET}"
