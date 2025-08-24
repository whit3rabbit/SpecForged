#!/usr/bin/env python3
"""
Development helper script for SpecForge.
"""

import subprocess
import sys
from pathlib import Path


def run_command(cmd, description):
    """Run a command and handle errors"""
    print(f"\n🔧 {description}")
    print(f"Running: {' '.join(cmd)}")
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode == 0:
        print(f"✅ {description} completed successfully")
        if result.stdout:
            print(result.stdout)
    else:
        print(f"❌ {description} failed")
        if result.stderr:
            print(f"Error: {result.stderr}")
        if result.stdout:
            print(f"Output: {result.stdout}")
        return False
    return True


def main():
    """Main development script"""
    if len(sys.argv) < 2:
        print("Usage: python scripts/dev.py <command>")
        print("\nAvailable commands:")
        print("  install     - Install dependencies")
        print("  test        - Run tests")
        print("  lint        - Run linting")
        print("  format      - Format code")
        print("  type-check  - Run type checking")
        print("  serve       - Run local MCP server")
        print("  serve-http  - Run HTTP server")
        print("  all         - Run all checks (lint, type-check, test)")
        return
    
    command = sys.argv[1]
    
    if command == "install":
        run_command(["pip", "install", "-r", "requirements.txt"], "Installing dependencies")
    
    elif command == "test":
        run_command(["python", "-m", "pytest"], "Running tests")
    
    elif command == "lint":
        run_command(["python", "-m", "flake8", "src/", "tests/"], "Running linting")
    
    elif command == "format":
        run_command(["python", "-m", "black", "src/", "tests/", "main.py", "main_http.py"], "Formatting code")
    
    elif command == "type-check":
        run_command(["python", "-m", "mypy", "src/"], "Running type checking")
    
    elif command == "serve":
        print("\n🚀 Starting SpecForge MCP Server (Local)")
        subprocess.run(["python", "main.py"])
    
    elif command == "serve-http":
        print("\n🌐 Starting SpecForge HTTP Server")
        subprocess.run(["python", "main_http.py"])
    
    elif command == "all":
        success = True
        success &= run_command(["python", "-m", "black", "--check", "src/", "tests/"], "Checking code formatting")
        success &= run_command(["python", "-m", "flake8", "src/", "tests/"], "Running linting")
        success &= run_command(["python", "-m", "mypy", "src/"], "Running type checking")
        success &= run_command(["python", "-m", "pytest"], "Running tests")
        
        if success:
            print("\n🎉 All checks passed!")
        else:
            print("\n💥 Some checks failed!")
            sys.exit(1)
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()