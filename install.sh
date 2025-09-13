#!/bin/bash

# SpecForged Standalone Installation Script
# Supports Ubuntu/Debian, CentOS/RHEL/Fedora, macOS, and generic Unix systems

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PACKAGE_NAME="specforged"
MIN_PYTHON_VERSION="3.10"
INSTALL_METHOD=""
VERBOSE=false
DRY_RUN=false
FORCE_INSTALL=false

print_banner() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}    SpecForged Installation Script     ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ Error: $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ Warning: $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Command line argument parsing
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            echo "SpecForged Installation Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --method=METHOD    Installation method: pip, pipx, uv (auto-detected if not specified)"
            echo "  --verbose,-v       Enable verbose output"
            echo "  --dry-run         Show what would be done without actually doing it"
            echo "  --force           Force installation even if already installed"
            echo "  --help,-h         Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                    # Auto-detect best installation method"
            echo "  $0 --method=pipx      # Force use of pipx"
            echo "  $0 --verbose --dry-run # Show detailed steps without executing"
            echo ""
            exit 0
            ;;
        --method=*)
            INSTALL_METHOD="${1#*=}"
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force)
            FORCE_INSTALL=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Verbose logging
log_verbose() {
    if [ "$VERBOSE" = true ]; then
        print_info "$1"
    fi
}

# Dry run execution
execute() {
    local cmd="$1"
    local description="$2"

    if [ -n "$description" ]; then
        log_verbose "$description"
    fi

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY RUN] Would execute: $cmd${NC}"
    else
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}Executing: $cmd${NC}"
        fi
        eval "$cmd"
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Python version
check_python_version() {
    local python_cmd="$1"

    if ! command_exists "$python_cmd"; then
        return 1
    fi

    local version
    version=$($python_cmd -c "import sys; print('.'.join(map(str, sys.version_info[:2])))" 2>/dev/null)

    if [ $? -ne 0 ]; then
        return 1
    fi

    # Compare versions
    if [ "$(printf '%s\n' "$MIN_PYTHON_VERSION" "$version" | sort -V | head -n1)" = "$MIN_PYTHON_VERSION" ]; then
        echo "$version"
        return 0
    else
        return 1
    fi
}

# Detect Python installation
detect_python() {
    log_verbose "Detecting Python installation..."

    # Try different Python commands
    for python_cmd in python3 python python3.12 python3.11 python3.10; do
        if version=$(check_python_version "$python_cmd"); then
            print_success "Found Python $version at $(which $python_cmd)"
            echo "$python_cmd"
            return 0
        fi
    done

    return 1
}

# Install Python on different systems
install_python() {
    print_info "Python $MIN_PYTHON_VERSION or higher is required but not found."

    case "$(uname -s)" in
        Linux)
            if command_exists apt-get; then
                # Ubuntu/Debian
                print_info "Installing Python on Ubuntu/Debian system..."
                execute "sudo apt-get update" "Updating package lists"
                execute "sudo apt-get install -y python3 python3-pip python3-venv" "Installing Python 3"
            elif command_exists yum; then
                # CentOS/RHEL (older)
                print_info "Installing Python on CentOS/RHEL system..."
                execute "sudo yum install -y python3 python3-pip" "Installing Python 3"
            elif command_exists dnf; then
                # Fedora/RHEL 8+
                print_info "Installing Python on Fedora/RHEL system..."
                execute "sudo dnf install -y python3 python3-pip" "Installing Python 3"
            elif command_exists pacman; then
                # Arch Linux
                print_info "Installing Python on Arch Linux system..."
                execute "sudo pacman -S --noconfirm python python-pip" "Installing Python 3"
            elif command_exists apk; then
                # Alpine Linux
                print_info "Installing Python on Alpine Linux system..."
                execute "sudo apk add --no-cache python3 py3-pip py3-venv" "Installing Python 3"
            else
                print_error "Unable to automatically install Python on this Linux distribution."
                echo "Please install Python $MIN_PYTHON_VERSION or higher manually and re-run this script."
                exit 1
            fi
            ;;
        Darwin)
            # macOS
            if command_exists brew; then
                print_info "Installing Python using Homebrew..."
                execute "brew install python3" "Installing Python 3"
            else
                print_error "Homebrew not found. Please install Python $MIN_PYTHON_VERSION manually."
                echo "You can install Homebrew from: https://brew.sh/"
                echo "Or install Python from: https://www.python.org/downloads/"
                exit 1
            fi
            ;;
        *)
            print_error "Unable to automatically install Python on this system."
            echo "Please install Python $MIN_PYTHON_VERSION or higher manually and re-run this script."
            exit 1
            ;;
    esac
}

# Detect best installation method
detect_install_method() {
    log_verbose "Detecting best installation method..."

    # Priority order: pipx > uv > pip
    if command_exists pipx; then
        print_success "Found pipx - recommended for isolated installation"
        echo "pipx"
    elif command_exists uv; then
        print_success "Found uv - fast Python package manager"
        echo "uv"
    elif command_exists pip || command_exists pip3; then
        print_success "Found pip - standard Python package manager"
        echo "pip"
    else
        return 1
    fi
}

# Install package manager
install_package_manager() {
    local method="$1"
    local python_cmd="$2"

    case "$method" in
        pipx)
            print_info "Installing pipx for isolated package installation..."
            execute "$python_cmd -m pip install --user pipx" "Installing pipx"
            execute "$python_cmd -m pipx ensurepath" "Adding pipx to PATH"

            # Check if pipx is in PATH after installation
            if ! command_exists pipx; then
                print_warning "pipx installed but not in PATH. Adding to current session..."
                export PATH="$HOME/.local/bin:$PATH"
            fi
            ;;
        uv)
            print_info "Installing uv package manager..."
            if command_exists curl; then
                execute "curl -LsSf https://astral.sh/uv/install.sh | sh" "Installing uv via curl"
            elif command_exists wget; then
                execute "wget -qO- https://astral.sh/uv/install.sh | sh" "Installing uv via wget"
            else
                execute "$python_cmd -m pip install --user uv" "Installing uv via pip"
            fi

            # Source the environment to get uv in PATH
            if [ -f "$HOME/.local/bin/uv" ]; then
                export PATH="$HOME/.local/bin:$PATH"
            fi
            ;;
        pip)
            # pip should already be available, but let's make sure it's up to date
            print_info "Ensuring pip is up to date..."
            execute "$python_cmd -m pip install --upgrade pip" "Upgrading pip"
            ;;
    esac
}

# Install SpecForged
install_specforged() {
    local method="$1"
    local python_cmd="$2"

    print_info "Installing SpecForged using $method..."

    case "$method" in
        pipx)
            if [ "$FORCE_INSTALL" = true ]; then
                execute "pipx install --force $PACKAGE_NAME" "Installing SpecForged with pipx (forced)"
            else
                execute "pipx install $PACKAGE_NAME" "Installing SpecForged with pipx"
            fi
            ;;
        uv)
            execute "uv tool install $PACKAGE_NAME" "Installing SpecForged with uv"
            ;;
        pip)
            execute "$python_cmd -m pip install --user $PACKAGE_NAME" "Installing SpecForged with pip"
            ;;
    esac
}

# Verify installation
verify_installation() {
    print_info "Verifying SpecForged installation..."

    # Check if command is available
    if command_exists specforged; then
        local version
        version=$(specforged --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
        print_success "SpecForged installed successfully (version: $version)"

        # Test basic functionality
        if [ "$DRY_RUN" = false ]; then
            log_verbose "Testing SpecForged configuration loading..."
            if specforged config show >/dev/null 2>&1; then
                print_success "SpecForged is working correctly"
            else
                print_warning "SpecForged installed but may have configuration issues"
            fi
        fi

        return 0
    else
        print_error "SpecForged command not found after installation"
        return 1
    fi
}

# Check if already installed
check_existing_installation() {
    if command_exists specforged; then
        local version
        version=$(specforged --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")

        if [ "$FORCE_INSTALL" = true ]; then
            print_warning "SpecForged $version already installed, but --force specified. Reinstalling..."
            return 1  # Proceed with installation
        else
            print_success "SpecForged $version is already installed"
            echo ""
            echo "Use --force to reinstall, or run 'specforged --help' to get started"
            return 0  # Skip installation
        fi
    fi

    return 1  # Not installed, proceed
}

# Create initial configuration
create_initial_config() {
    if [ "$DRY_RUN" = false ]; then
        print_info "Setting up initial configuration..."

        # Create user config directory if it doesn't exist
        local config_dir="$HOME/.specforged"
        if [ ! -d "$config_dir" ]; then
            execute "mkdir -p '$config_dir'" "Creating user configuration directory"
        fi

        # Ask if user wants to create initial config
        echo ""
        read -p "Would you like to create a default user configuration? (y/n): " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if specforged config edit --user >/dev/null 2>&1; then
                print_success "User configuration setup completed"
            else
                print_warning "Could not automatically create user configuration"
            fi
        fi
    fi
}

# Show next steps
show_next_steps() {
    echo ""
    print_success "Installation completed successfully!"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Initialize a project:     ${GREEN}specforged init${NC}"
    echo "  2. Check project status:     ${GREEN}specforged status${NC}"
    echo "  3. Start MCP server:         ${GREEN}specforged serve${NC}"
    echo "  4. View configuration:       ${GREEN}specforged config show${NC}"
    echo "  5. Get help:                 ${GREEN}specforged --help${NC}"
    echo ""
    echo -e "${BLUE}For more information, visit:${NC}"
    echo "  • Documentation: https://github.com/whit3rabbit/SpecForge#readme"
    echo "  • PyPI Package:  https://pypi.org/project/specforged/"
    echo ""
}

# Main installation process
main() {
    print_banner

    # Check if already installed (unless forced)
    if check_existing_installation; then
        exit 0
    fi

    # Detect or install Python
    python_cmd=""
    if python_cmd=$(detect_python); then
        log_verbose "Using Python command: $python_cmd"
    else
        print_warning "Python $MIN_PYTHON_VERSION or higher not found"
        install_python

        # Re-detect after installation
        if python_cmd=$(detect_python); then
            log_verbose "Using Python command after installation: $python_cmd"
        else
            print_error "Failed to install or detect Python"
            exit 1
        fi
    fi

    # Determine installation method
    if [ -z "$INSTALL_METHOD" ]; then
        if INSTALL_METHOD=$(detect_install_method); then
            log_verbose "Auto-detected installation method: $INSTALL_METHOD"
        else
            print_warning "No suitable package manager found, will install pipx"
            INSTALL_METHOD="pipx"
        fi
    else
        log_verbose "Using specified installation method: $INSTALL_METHOD"
    fi

    # Install package manager if needed
    if ! command_exists "$INSTALL_METHOD"; then
        install_package_manager "$INSTALL_METHOD" "$python_cmd"

        # Verify package manager is now available
        if ! command_exists "$INSTALL_METHOD"; then
            print_error "Failed to install $INSTALL_METHOD"
            exit 1
        fi
    fi

    # Install SpecForged
    install_specforged "$INSTALL_METHOD" "$python_cmd"

    # Verify installation
    if verify_installation; then
        create_initial_config
        show_next_steps
    else
        print_error "Installation verification failed"
        exit 1
    fi
}

# Handle errors
trap 'print_error "Installation failed due to an error. Check the output above for details."; exit 1' ERR

# Run main installation
main "$@"
