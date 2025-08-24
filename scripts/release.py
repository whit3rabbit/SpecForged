#!/usr/bin/env python3
"""
Release management script for SpecForge.

Automates version bumping and release preparation.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path
from datetime import datetime


def get_current_version():
    """Get current version from __init__.py"""
    init_file = Path("src/specforged/__init__.py")
    content = init_file.read_text()
    match = re.search(r'__version__ = "([^"]+)"', content)
    if not match:
        raise ValueError("Could not find version in __init__.py")
    return match.group(1)


def update_version(new_version):
    """Update version in __init__.py"""
    init_file = Path("src/specforged/__init__.py")
    content = init_file.read_text()
    updated = re.sub(
        r'__version__ = "[^"]+"',
        f'__version__ = "{new_version}"',
        content
    )
    init_file.write_text(updated)
    print(f"✓ Updated version to {new_version} in {init_file}")


def bump_version(current_version, bump_type):
    """Bump version according to semver rules"""
    parts = list(map(int, current_version.split('.')))
    
    if bump_type == 'major':
        parts[0] += 1
        parts[1] = 0
        parts[2] = 0
    elif bump_type == 'minor':
        parts[1] += 1
        parts[2] = 0
    elif bump_type == 'patch':
        parts[2] += 1
    else:
        raise ValueError(f"Invalid bump type: {bump_type}")
    
    return '.'.join(map(str, parts))


def update_changelog(version):
    """Update CHANGELOG.md with new version"""
    changelog_file = Path("CHANGELOG.md")
    if not changelog_file.exists():
        print("⚠ CHANGELOG.md not found, skipping update")
        return
    
    content = changelog_file.read_text()
    date_str = datetime.now().strftime("%Y-%m-%d")
    
    # Replace [Unreleased] with new version
    updated = re.sub(
        r'\[Unreleased\]',
        f'[{version}] - {date_str}',
        content,
        count=1
    )
    
    # Add new Unreleased section
    updated = re.sub(
        rf'\[{version}\] - {date_str}',
        f'[Unreleased]\n\n### Added\n### Changed\n### Fixed\n\n## [{version}] - {date_str}',
        updated,
        count=1
    )
    
    changelog_file.write_text(updated)
    print(f"✓ Updated CHANGELOG.md with version {version}")


def run_tests():
    """Run the test suite"""
    print("🧪 Running tests...")
    try:
        subprocess.run(["uv", "run", "pytest", "tests/", "-v"], check=True)
        print("✓ All tests passed")
        return True
    except subprocess.CalledProcessError:
        print("✗ Tests failed")
        return False


def build_package():
    """Build the package"""
    print("📦 Building package...")
    try:
        subprocess.run(["uv", "build"], check=True)
        print("✓ Package built successfully")
        return True
    except subprocess.CalledProcessError:
        print("✗ Package build failed")
        return False


def create_git_tag(version):
    """Create and push git tag"""
    tag_name = f"v{version}"
    print(f"🏷 Creating git tag {tag_name}...")
    
    try:
        # Add changes
        subprocess.run(["git", "add", "."], check=True)
        
        # Commit changes
        subprocess.run([
            "git", "commit", "-m", f"chore: bump version to {version}"
        ], check=True)
        
        # Create tag
        subprocess.run([
            "git", "tag", "-a", tag_name, "-m", f"Release {version}"
        ], check=True)
        
        print(f"✓ Created tag {tag_name}")
        print(f"📌 To push: git push origin main && git push origin {tag_name}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Git operations failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Manage SpecForge releases")
    parser.add_argument(
        "bump_type", 
        choices=["major", "minor", "patch"], 
        help="Type of version bump"
    )
    parser.add_argument(
        "--skip-tests", 
        action="store_true", 
        help="Skip running tests"
    )
    parser.add_argument(
        "--skip-build", 
        action="store_true", 
        help="Skip building package"
    )
    parser.add_argument(
        "--dry-run", 
        action="store_true", 
        help="Show what would be done without making changes"
    )
    
    args = parser.parse_args()
    
    # Get current version
    try:
        current_version = get_current_version()
        print(f"📍 Current version: {current_version}")
    except Exception as e:
        print(f"✗ Error getting current version: {e}")
        sys.exit(1)
    
    # Calculate new version
    new_version = bump_version(current_version, args.bump_type)
    print(f"🎯 New version: {new_version}")
    
    if args.dry_run:
        print("🔍 Dry run - no changes will be made")
        print(f"Would update version from {current_version} to {new_version}")
        return
    
    # Run tests
    if not args.skip_tests:
        if not run_tests():
            print("✗ Stopping due to test failures")
            sys.exit(1)
    
    # Update version
    update_version(new_version)
    
    # Update changelog
    update_changelog(new_version)
    
    # Build package
    if not args.skip_build:
        if not build_package():
            print("✗ Stopping due to build failure")
            sys.exit(1)
    
    # Create git tag
    if not create_git_tag(new_version):
        print("✗ Git operations failed")
        sys.exit(1)
    
    print(f"\n🎉 Release {new_version} prepared successfully!")
    print("\nNext steps:")
    print("1. Review changes: git log --oneline -5")
    print("2. Push changes: git push origin main")
    print(f"3. Push tag: git push origin v{new_version}")
    print("4. Create GitHub release from the tag")
    print("5. GitHub Actions will automatically publish to PyPI")


if __name__ == "__main__":
    main()