# SpecForged Windows Installation Script
# PowerShell script to install SpecForged on Windows systems

param(
    [string]$Method = "",           # Installation method: pip, pipx, uv
    [switch]$Verbose = $false,      # Enable verbose output
    [switch]$DryRun = $false,       # Show what would be done without executing
    [switch]$Force = $false,        # Force installation even if already installed
    [switch]$Help = $false          # Show help message
)

# Configuration
$PackageName = "specforged"
$MinPythonVersion = [version]"3.10.0"
$InstallMethod = $Method

# Colors (if terminal supports them)
$Colors = @{
    Red     = "`e[31m"
    Green   = "`e[32m"
    Yellow  = "`e[33m"
    Blue    = "`e[34m"
    Reset   = "`e[0m"
}

# Fallback for older PowerShell versions or terminals without ANSI support
try {
    Write-Host "$($Colors.Blue)Testing color support...$($Colors.Reset)" -NoNewline
    Write-Host " ✓" -ForegroundColor Green
} catch {
    # Disable colors if not supported
    $Colors = @{
        Red = ""; Green = ""; Yellow = ""; Blue = ""; Reset = ""
    }
}

function Write-Banner {
    Write-Host ""
    Write-Host "$($Colors.Blue)========================================$($Colors.Reset)"
    Write-Host "$($Colors.Blue)    SpecForged Installation Script     $($Colors.Reset)"
    Write-Host "$($Colors.Blue)         Windows PowerShell            $($Colors.Reset)"
    Write-Host "$($Colors.Blue)========================================$($Colors.Reset)"
    Write-Host ""
}

function Write-Success {
    param([string]$Message)
    Write-Host "$($Colors.Green)✓ $Message$($Colors.Reset)"
}

function Write-Error {
    param([string]$Message)
    Write-Host "$($Colors.Red)✗ Error: $Message$($Colors.Reset)"
}

function Write-Warning {
    param([string]$Message)
    Write-Host "$($Colors.Yellow)⚠ Warning: $Message$($Colors.Reset)"
}

function Write-Info {
    param([string]$Message)
    Write-Host "$($Colors.Blue)ℹ $Message$($Colors.Reset)"
}

function Write-Verbose-Log {
    param([string]$Message)
    if ($Verbose) {
        Write-Info $Message
    }
}

function Show-Help {
    Write-Host "SpecForged Windows Installation Script"
    Write-Host ""
    Write-Host "Usage: .\install.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Method <METHOD>    Installation method: pip, pipx, uv (auto-detected if not specified)"
    Write-Host "  -Verbose           Enable verbose output"
    Write-Host "  -DryRun            Show what would be done without actually doing it"
    Write-Host "  -Force             Force installation even if already installed"
    Write-Host "  -Help              Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\install.ps1                     # Auto-detect best installation method"
    Write-Host "  .\install.ps1 -Method pipx        # Force use of pipx"
    Write-Host "  .\install.ps1 -Verbose -DryRun    # Show detailed steps without executing"
    Write-Host ""
}

function Invoke-Execute {
    param(
        [string]$Command,
        [string]$Description = ""
    )

    if ($Description) {
        Write-Verbose-Log $Description
    }

    if ($DryRun) {
        Write-Host "$($Colors.Yellow)[DRY RUN] Would execute: $Command$($Colors.Reset)"
        return $true
    } else {
        if ($Verbose) {
            Write-Host "$($Colors.Blue)Executing: $Command$($Colors.Reset)"
        }

        try {
            Invoke-Expression $Command
            return $LASTEXITCODE -eq 0
        } catch {
            Write-Error "Command failed: $($_.Exception.Message)"
            return $false
        }
    }
}

function Test-CommandExists {
    param([string]$Command)

    try {
        $null = Get-Command $Command -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Get-PythonVersion {
    param([string]$PythonCommand)

    try {
        $versionOutput = & $PythonCommand -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null
        if ($LASTEXITCODE -eq 0 -and $versionOutput) {
            return [version]$versionOutput
        }
    } catch {
        # Command failed
    }

    return $null
}

function Find-Python {
    Write-Verbose-Log "Searching for Python installation..."

    # Try different Python commands
    $pythonCommands = @("python", "python3", "py")

    foreach ($pythonCmd in $pythonCommands) {
        if (Test-CommandExists $pythonCmd) {
            $version = Get-PythonVersion $pythonCmd
            if ($version -and $version -ge $MinPythonVersion) {
                Write-Success "Found Python $version at: $(Get-Command $pythonCmd | Select-Object -ExpandProperty Source)"
                return $pythonCmd
            } elseif ($version) {
                Write-Warning "Found Python $version but minimum required is $MinPythonVersion"
            }
        }
    }

    return $null
}

function Install-Python {
    Write-Info "Python $MinPythonVersion or higher is required but not found."
    Write-Info "Installing Python using winget (Windows Package Manager)..."

    # Check if winget is available
    if (Test-CommandExists "winget") {
        if (Invoke-Execute "winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements" "Installing Python 3.12 via winget") {
            Write-Success "Python installation completed"

            # Refresh environment variables
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

            return $true
        } else {
            Write-Error "Failed to install Python via winget"
        }
    } else {
        Write-Error "winget not available. Please install Python manually:"
        Write-Host "  1. Visit: https://www.python.org/downloads/windows/"
        Write-Host "  2. Download Python $MinPythonVersion or higher"
        Write-Host "  3. Run the installer and make sure to check 'Add Python to PATH'"
        Write-Host "  4. Restart PowerShell and re-run this script"
        return $false
    }
}

function Find-InstallMethod {
    Write-Verbose-Log "Detecting best installation method..."

    # Priority order: pipx > uv > pip
    if (Test-CommandExists "pipx") {
        Write-Success "Found pipx - recommended for isolated installation"
        return "pipx"
    } elseif (Test-CommandExists "uv") {
        Write-Success "Found uv - fast Python package manager"
        return "uv"
    } elseif (Test-CommandExists "pip") {
        Write-Success "Found pip - standard Python package manager"
        return "pip"
    } else {
        return $null
    }
}

function Install-PackageManager {
    param(
        [string]$Method,
        [string]$PythonCommand
    )

    switch ($Method) {
        "pipx" {
            Write-Info "Installing pipx for isolated package installation..."
            if (Invoke-Execute "$PythonCommand -m pip install --user pipx" "Installing pipx") {
                if (Invoke-Execute "$PythonCommand -m pipx ensurepath" "Adding pipx to PATH") {
                    # Refresh PATH for current session
                    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
                    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
                    $env:PATH = "$userPath;$machinePath"

                    return Test-CommandExists "pipx"
                }
            }
            return $false
        }

        "uv" {
            Write-Info "Installing uv package manager..."

            # Try installing uv via PowerShell (recommended method)
            if (Test-CommandExists "powershell") {
                $uvInstallScript = "powershell -c `"irm https://astral.sh/uv/install.ps1 | iex`""
                if (Invoke-Execute $uvInstallScript "Installing uv via PowerShell") {
                    # Refresh PATH
                    $env:PATH += ";$env:USERPROFILE\.local\bin"
                    return Test-CommandExists "uv"
                }
            }

            # Fallback to pip installation
            Write-Warning "Direct uv installation failed, trying via pip..."
            return Invoke-Execute "$PythonCommand -m pip install --user uv" "Installing uv via pip"
        }

        "pip" {
            Write-Info "Ensuring pip is up to date..."
            return Invoke-Execute "$PythonCommand -m pip install --upgrade pip" "Upgrading pip"
        }

        default {
            Write-Error "Unknown installation method: $Method"
            return $false
        }
    }
}

function Install-SpecForged {
    param(
        [string]$Method,
        [string]$PythonCommand
    )

    Write-Info "Installing SpecForged using $Method..."

    switch ($Method) {
        "pipx" {
            if ($Force) {
                return Invoke-Execute "pipx install --force $PackageName" "Installing SpecForged with pipx (forced)"
            } else {
                return Invoke-Execute "pipx install $PackageName" "Installing SpecForged with pipx"
            }
        }

        "uv" {
            return Invoke-Execute "uv tool install $PackageName" "Installing SpecForged with uv"
        }

        "pip" {
            return Invoke-Execute "$PythonCommand -m pip install --user $PackageName" "Installing SpecForged with pip"
        }

        default {
            Write-Error "Unknown installation method: $Method"
            return $false
        }
    }
}

function Test-Installation {
    Write-Info "Verifying SpecForged installation..."

    # Check if command is available
    if (Test-CommandExists "specforged") {
        try {
            $version = & specforged --version 2>$null | Select-String -Pattern '\d+\.\d+\.\d+' | ForEach-Object { $_.Matches[0].Value }
            if (-not $version) { $version = "unknown" }

            Write-Success "SpecForged installed successfully (version: $version)"

            # Test basic functionality
            if (-not $DryRun) {
                Write-Verbose-Log "Testing SpecForged configuration loading..."
                $configTest = & specforged config show 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "SpecForged is working correctly"
                } else {
                    Write-Warning "SpecForged installed but may have configuration issues"
                }
            }

            return $true
        } catch {
            Write-Error "Error verifying SpecForged installation: $($_.Exception.Message)"
            return $false
        }
    } else {
        Write-Error "SpecForged command not found after installation"
        return $false
    }
}

function Test-ExistingInstallation {
    if (Test-CommandExists "specforged") {
        try {
            $version = & specforged --version 2>$null | Select-String -Pattern '\d+\.\d+\.\d+' | ForEach-Object { $_.Matches[0].Value }
            if (-not $version) { $version = "unknown" }

            if ($Force) {
                Write-Warning "SpecForged $version already installed, but -Force specified. Reinstalling..."
                return $false  # Proceed with installation
            } else {
                Write-Success "SpecForged $version is already installed"
                Write-Host ""
                Write-Host "Use -Force to reinstall, or run 'specforged --help' to get started"
                return $true  # Skip installation
            }
        } catch {
            # If we can't get version, assume it's broken and reinstall
            Write-Warning "SpecForged command exists but appears broken. Reinstalling..."
            return $false
        }
    }

    return $false  # Not installed, proceed
}

function New-InitialConfig {
    if (-not $DryRun) {
        Write-Info "Setting up initial configuration..."

        # Create user config directory if it doesn't exist
        $configDir = "$env:USERPROFILE\.specforged"
        if (-not (Test-Path $configDir)) {
            if (Invoke-Execute "New-Item -ItemType Directory -Path '$configDir' -Force" "Creating user configuration directory") {
                Write-Success "Created configuration directory: $configDir"
            }
        }

        # Ask if user wants to create initial config
        Write-Host ""
        $createConfig = Read-Host "Would you like to create a default user configuration? (y/n)"
        if ($createConfig -match "^[Yy]") {
            try {
                & specforged config show >$null 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "User configuration setup completed"
                } else {
                    Write-Warning "Could not automatically create user configuration"
                }
            } catch {
                Write-Warning "Could not automatically create user configuration"
            }
        }
    }
}

function Show-NextSteps {
    Write-Host ""
    Write-Success "Installation completed successfully!"
    Write-Host ""
    Write-Host "$($Colors.Blue)Next steps:$($Colors.Reset)"
    Write-Host "  1. Initialize a project:     $($Colors.Green)specforged init$($Colors.Reset)"
    Write-Host "  2. Check project status:     $($Colors.Green)specforged status$($Colors.Reset)"
    Write-Host "  3. Start MCP server:         $($Colors.Green)specforged serve$($Colors.Reset)"
    Write-Host "  4. View configuration:       $($Colors.Green)specforged config show$($Colors.Reset)"
    Write-Host "  5. Get help:                 $($Colors.Green)specforged --help$($Colors.Reset)"
    Write-Host ""
    Write-Host "$($Colors.Blue)For more information, visit:$($Colors.Reset)"
    Write-Host "  • Documentation: https://github.com/whit3rabbit/SpecForge#readme"
    Write-Host "  • PyPI Package:  https://pypi.org/project/specforged/"
    Write-Host ""
}

function Main {
    # Show help if requested
    if ($Help) {
        Show-Help
        exit 0
    }

    Write-Banner

    # Check if already installed (unless forced)
    if (Test-ExistingInstallation) {
        exit 0
    }

    # Find or install Python
    $pythonCmd = Find-Python
    if (-not $pythonCmd) {
        Write-Warning "Python $MinPythonVersion or higher not found"
        if (Install-Python) {
            $pythonCmd = Find-Python
            if (-not $pythonCmd) {
                Write-Error "Failed to install or detect Python"
                exit 1
            }
        } else {
            exit 1
        }
    }

    Write-Verbose-Log "Using Python command: $pythonCmd"

    # Determine installation method
    if (-not $InstallMethod) {
        $InstallMethod = Find-InstallMethod
        if (-not $InstallMethod) {
            Write-Warning "No suitable package manager found, will install pipx"
            $InstallMethod = "pipx"
        }
        Write-Verbose-Log "Auto-detected installation method: $InstallMethod"
    } else {
        Write-Verbose-Log "Using specified installation method: $InstallMethod"
    }

    # Install package manager if needed
    if (-not (Test-CommandExists $InstallMethod)) {
        if (-not (Install-PackageManager $InstallMethod $pythonCmd)) {
            Write-Error "Failed to install $InstallMethod"
            exit 1
        }

        # Verify package manager is now available
        if (-not (Test-CommandExists $InstallMethod)) {
            Write-Error "$InstallMethod is still not available after installation"
            exit 1
        }
    }

    # Install SpecForged
    if (-not (Install-SpecForged $InstallMethod $pythonCmd)) {
        Write-Error "SpecForged installation failed"
        exit 1
    }

    # Verify installation
    if (Test-Installation) {
        New-InitialConfig
        Show-NextSteps
    } else {
        Write-Error "Installation verification failed"
        exit 1
    }
}

# Error handling
trap {
    Write-Error "Installation failed due to an error: $($_.Exception.Message)"
    exit 1
}

# Run main installation
Main
